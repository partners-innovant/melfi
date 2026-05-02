import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Se te proporciona un resumen de contexto que un psicólogo exportó desde otra IA. Extrae la información relevante para construir una memoria inicial para este asistente.

Responde SOLO con este JSON exacto, sin texto adicional, sin markdown:
{
  "memory_summary": "resumen de 3-4 oraciones sobre quién es esta persona y cómo trabaja",
  "key_facts": ["hecho 1", "hecho 2", "hecho 3"],
  "preferences": {
    "communication_style": "...",
    "frequent_topics": "...",
    "professional_context": "...",
    "response_preferences": "..."
  }
}`;

const MAX_FACTS = 30;

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

    const { imported_text } = await req.json();
    const text = String(imported_text ?? "").trim();
    if (text.length < 20) {
      return new Response(JSON.stringify({ error: "El texto importado está vacío o es demasiado corto." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (text.length > 50_000) {
      return new Response(JSON.stringify({ error: "El texto importado es demasiado largo (máximo 50.000 caracteres)." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Using Haiku — memory import/extraction, simple structured task
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Contexto importado:\n\n${text}` }],
      }),
    });

    if (!claudeResp.ok) {
      const t = await claudeResp.text().catch(() => "");
      throw new Error(`Claude ${claudeResp.status}: ${t.slice(0, 300)}`);
    }
    const json = await claudeResp.json();
    const raw: string = json?.content?.[0]?.text ?? "";
    let parsed: { memory_summary?: string; key_facts?: string[]; preferences?: Record<string, any> } = {};
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }

    const newSummary = typeof parsed.memory_summary === "string" ? parsed.memory_summary.trim() : "";
    const newFacts = Array.isArray(parsed.key_facts)
      ? parsed.key_facts.map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    const newPrefs: Record<string, any> = (parsed.preferences && typeof parsed.preferences === "object")
      ? Object.fromEntries(
          Object.entries(parsed.preferences).filter(([_, v]) =>
            v != null && (typeof v !== "string" || v.trim().length > 0),
          ),
        )
      : {};

    if (!newSummary && newFacts.length === 0 && Object.keys(newPrefs).length === 0) {
      return new Response(JSON.stringify({
        error: "No se pudo extraer información del texto importado. Intenta con un resumen más detallado.",
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Merge with existing memory (don't overwrite).
    const { data: existing } = await userClient
      .from("general_chat_memory")
      .select("memory_summary, key_facts, preferences")
      .eq("psychologist_id", user.id)
      .maybeSingle();

    const prevFacts: string[] = Array.isArray(existing?.key_facts) ? existing!.key_facts as string[] : [];
    const prevPrefs: Record<string, any> = (existing?.preferences && typeof existing.preferences === "object")
      ? existing!.preferences as any : {};
    const prevSummary: string = typeof existing?.memory_summary === "string" ? existing!.memory_summary : "";

    // Dedupe facts (case-insensitive).
    const mergedRaw = [...prevFacts, ...newFacts];
    const seen = new Set<string>();
    const dedupFacts: string[] = [];
    for (const f of mergedRaw) {
      const key = f.toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); dedupFacts.push(f); }
    }
    const trimmedFacts = dedupFacts.length > MAX_FACTS
      ? dedupFacts.slice(dedupFacts.length - MAX_FACTS)
      : dedupFacts;

    // Merge preferences: existing values win on key conflict (don't overwrite).
    const mergedPrefs = { ...newPrefs, ...prevPrefs };

    // Merge summary: append imported context if previous exists.
    let finalSummary = newSummary;
    if (prevSummary && newSummary) {
      finalSummary = `${prevSummary}\n\n[Contexto importado] ${newSummary}`;
    } else if (prevSummary && !newSummary) {
      finalSummary = prevSummary;
    }

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
      imported_facts_count: newFacts.length,
      total_facts_count: trimmedFacts.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[claude-memory-import] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
