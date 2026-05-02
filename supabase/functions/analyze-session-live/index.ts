// Analyze a live session: takes transcript + manual notes + patient profile + active suggestions
// Returns summary bullets, refreshed suggestions, addressed suggestion ids, and a clinical insight.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un supervisor clínico analizando una sesión terapéutica en curso.

Analiza el material y genera:

1. RESUMEN EN BULLETS (summary_bullets): máximo 8 puntos de no más de 15 palabras cada uno resumiendo lo conversado. Escribe en tercera persona, lenguaje clínico conciso.

2. SUGERENCIAS ACTUALIZADAS (suggestions): basadas en lo que REALMENTE se ha dicho en la sesión, no solo en el perfil general. Para cada sugerencia incluye su tipo y una justificación breve basada en la transcripción.

3. SUGERENCIAS DETECTADAS (suggestions_addressed): IDs de las sugerencias actuales que parecen haber sido abordadas en la transcripción.

4. INSIGHT DE SESIÓN (session_insights): observación clínica breve de 1-2 oraciones sobre lo que está emergiendo.

Responde SOLO con JSON válido, sin markdown ni \`\`\`:
{
  "summary_bullets": ["bullet 1 máx 15 palabras", "bullet 2"],
  "suggestions": [
    { "type": "question|intervention|pattern|alert", "text": "sugerencia específica basada en la conversación actual", "rationale": "por qué es relevante basado en lo transcrito" }
  ],
  "suggestions_addressed": ["suggestion_id_1"],
  "session_insights": "observación clínica breve"
}`;

function tryParseJson(text: string): any | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* */ } }
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch { /* */ } }
  return null;
}

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

    const body = await req.json();
    const { patient_id, transcript_text, therapist_notes, patient_notes, active_suggestions } = body ?? {};
    if (!patient_id) {
      return new Response(JSON.stringify({ error: "patient_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: patient } = await userClient.from("patients").select("*").eq("id", patient_id).maybeSingle();
    const profileBlock = patient ? `
Nombre: ${patient.first_name} ${patient.last_name}
Diagnóstico: ${patient.diagnosis ?? "(sin registrar)"}
Problema actual: ${patient.presenting_problem ?? "(sin registrar)"}
Historia clínica: ${patient.clinical_history ?? "(sin registrar)"}
Objetivos terapéuticos: ${patient.therapeutic_goals ?? "(sin registrar)"}
Notas: ${patient.notes ?? "(sin notas)"}
`.trim() : "(sin perfil)";

    const sugList = Array.isArray(active_suggestions) ? active_suggestions : [];
    const sugBlock = sugList.length
      ? sugList.map((s: any) => `- [${s.id}] (${s.type}) ${s.text}`).join("\n")
      : "(ninguna)";

    const userMessage = `Transcripción:
${transcript_text || "(sin transcripción aún)"}

Notas del terapeuta:
${therapist_notes || "(sin notas)"}

Notas del paciente:
${patient_notes || "(sin notas)"}

Perfil del paciente:
${profileBlock}

Sugerencias activas actuales:
${sugBlock}

Genera el JSON con summary_bullets, suggestions, suggestions_addressed y session_insights.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error", resp.status, errText);
      return new Response(JSON.stringify({ error: "claude_error", details: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const parsed = tryParseJson(text) ?? {};
    return new Response(JSON.stringify({
      summary_bullets: Array.isArray(parsed.summary_bullets) ? parsed.summary_bullets : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      suggestions_addressed: Array.isArray(parsed.suggestions_addressed) ? parsed.suggestions_addressed : [],
      session_insights: typeof parsed.session_insights === "string" ? parsed.session_insights : "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
