import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACT_PROMPT = `Eres un sistema de memoria para un asistente de IA. Se te proporciona una conversación reciente entre el asistente y un psicólogo.

Tu tarea es extraer información relevante para recordar en futuras conversaciones. Responde SOLO con este JSON exacto, sin texto adicional, sin markdown:

{
  "new_facts": ["hecho 1", "hecho 2"],
  "new_preferences": {"key": "value"},
  "memory_update": "resumen breve de 2-3 oraciones de lo más importante de esta conversación para recordar en el futuro"
}

Extrae:
- Hechos personales o profesionales mencionados (nombre, especialidad, intereses, proyectos)
- Preferencias de comunicación o trabajo
- Temas recurrentes o importantes
- Cualquier contexto útil para futuras conversaciones

NO incluyas contenido clínico de pacientes — solo información sobre el terapeuta mismo.
Si no hay nada relevante para guardar, devuelve listas/objetos vacíos y memory_update como string vacío.`;

const MAX_FACTS = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const convoText = messages
      .map((m: any) => `${m.role === "user" ? "Psicólogo" : "Claude"}: ${String(m.content ?? "")}`)
      .join("\n\n");

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Using Haiku — memory fact extraction from conversations, simple structured task
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: EXTRACT_PROMPT,
        messages: [{ role: "user", content: `Conversación:\n\n${convoText}` }],
      }),
    });

    if (!claudeResp.ok) {
      const t = await claudeResp.text().catch(() => "");
      throw new Error(`Claude ${claudeResp.status}: ${t.slice(0, 300)}`);
    }
    const json = await claudeResp.json();
    const text: string = json?.content?.[0]?.text ?? "";
    let parsed: { new_facts?: string[]; new_preferences?: Record<string, any>; memory_update?: string } = {};
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }

    const newFacts = Array.isArray(parsed.new_facts) ? parsed.new_facts.map(String).filter(Boolean) : [];
    const newPrefs = parsed.new_preferences && typeof parsed.new_preferences === "object" ? parsed.new_preferences : {};
    const memoryUpdate = typeof parsed.memory_update === "string" ? parsed.memory_update.trim() : "";

    // Fetch existing
    const { data: existing } = await userClient
      .from("general_chat_memory")
      .select("memory_summary, key_facts, preferences")
      .eq("psychologist_id", user.id)
      .maybeSingle();

    const prevFacts: string[] = Array.isArray(existing?.key_facts) ? existing!.key_facts as string[] : [];
    const prevPrefs: Record<string, any> = (existing?.preferences && typeof existing.preferences === "object") ? existing!.preferences as any : {};

    const mergedFactsRaw = [...prevFacts, ...newFacts];
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const f of mergedFactsRaw) {
      const key = f.toLowerCase().trim();
      if (!seen.has(key) && key.length > 0) { seen.add(key); dedup.push(f); }
    }
    const trimmedFacts = dedup.length > MAX_FACTS ? dedup.slice(dedup.length - MAX_FACTS) : dedup;
    const mergedPrefs = { ...prevPrefs, ...newPrefs };
    const finalSummary = memoryUpdate || existing?.memory_summary || "";

    const { error: upErr } = await userClient
      .from("general_chat_memory")
      .upsert({
        psychologist_id: user.id,
        memory_summary: finalSummary,
        key_facts: trimmedFacts,
        preferences: mergedPrefs,
        updated_at: new Date().toISOString(),
      }, { onConflict: "psychologist_id" });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      memory_summary: finalSummary,
      key_facts: trimmedFacts,
      preferences: mergedPrefs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[claude-memory-update] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
