import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Psicoasist, un asistente clínico para psicólogos. El psicólogo está haciendo una consulta que no está cubierta por los documentos de su biblioteca. Responde basándote en tu conocimiento general de psicología clínica y la literatura científica.

IMPORTANTE: Al inicio de tu respuesta incluye siempre este aviso: "⚠️ Esta respuesta está basada en conocimiento general y no en los documentos de tu biblioteca. Verifica esta información con fuentes primarias antes de aplicarla clínicamente."

Luego responde de forma profesional, citando cuando sea posible autores o guías clínicas conocidas (APA, OMS, DSM-5, etc.) aunque no estén en la biblioteca del psicólogo.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { question, patient_id = null, conversation_id = null } = body;
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "question requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        // Using Sonnet — clinical reasoning required
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!claudeResp.ok) {
      const txt = await claudeResp.text();
      console.error("[claude-general] Claude error", claudeResp.status, txt);
      return new Response(
        JSON.stringify({ error: `Claude API ${claudeResp.status}: ${txt.slice(0, 500)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await claudeResp.json();
    const answer: string = (data?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    const convId = conversation_id || crypto.randomUUID();
    const { data: consultation } = await userClient
      .from("consultations")
      .insert({
        psychologist_id: user.id,
        patient_id: patient_id || null,
        question,
        answer,
        citations: [],
        conversation_id: convId,
        conversation_title: conversation_id ? null : question.slice(0, 80),
        is_general_knowledge: true,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        answer,
        consultation_id: consultation?.id ?? null,
        conversation_id: convId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[claude-general] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
