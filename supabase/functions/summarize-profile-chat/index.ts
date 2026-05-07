import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Melfi, asistente clínico especializado en redacción de fichas psicológicas. Se te proporciona una conversación completa entre un psicólogo y el asistente clínico sobre un paciente.

Tu tarea es generar un texto clínico estructurado y profesional que resuma toda la información relevante discutida en la conversación, apropiado para agregar a la ficha psicológica del paciente.

El texto debe:
- Estar escrito en tercera persona
- Usar lenguaje clínico preciso pero comprensible
- Organizar la información en categorías cuando corresponda (motivo de consulta, antecedentes, dinámica relacional, presentación clínica, objetivos terapéuticos, etc.)
- Incluir SOLO la información que el psicólogo proporcionó — no inventar ni inferir
- Ser conciso pero completo — máximo 400 palabras
- No incluir las preguntas del asistente, solo la información del paciente

Responde SOLO con el texto redactado, sin explicaciones ni comentarios adicionales.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { patient_id } = await req.json();
    if (!patient_id) throw new Error("patient_id required");

    const [{ data: chat }, { data: patient }] = await Promise.all([
      supabase.from("patient_profile_chat").select("role, content").eq("patient_id", patient_id).order("created_at", { ascending: true }),
      supabase.from("patients").select("notes, presenting_problem, clinical_history, family_context, work_context, previous_treatments, relevant_history, personal_resources, therapeutic_goals, diagnosis").eq("id", patient_id).maybeSingle(),
    ]);

    const messages = chat ?? [];
    const conversationText = messages
      .map((m: any) => `${m.role === "user" ? "Psicólogo" : "Asistente"}: ${m.content}`)
      .join("\n\n");

    const currentProfile = patient
      ? Object.entries(patient).filter(([_, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "(sin información previa)";

    const userMessage = `Conversación:\n${conversationText}\n\nPerfil actual del paciente (para no repetir información ya registrada):\n${currentProfile}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Using Haiku — Profile Builder summary/opening greeting, lightweight task
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API error: ${errText}`);
    }
    const data = await resp.json();
    const summary = data.content?.[0]?.text ?? "";

    return new Response(JSON.stringify({ summary, message_count: messages.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
