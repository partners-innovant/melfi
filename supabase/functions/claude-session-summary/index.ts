import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Psicoasist. Se te proporciona el registro completo de una sesión terapéutica. Genera la respuesta en español, con formato Markdown limpio, dividida EXACTAMENTE en estas tres secciones (con esos títulos):

## 1. RESUMEN DE SESIÓN
Un resumen clínico estructurado de lo ocurrido en la sesión (máximo 300 palabras). Incluye: temas trabajados, estado emocional del paciente, intervenciones realizadas, respuesta del paciente.

## 2. FEEDBACK AL TERAPEUTA
Análisis honesto y constructivo de la sesión:
- **Intervenciones efectivas**: qué funcionó bien y por qué
- **Oportunidades perdidas**: momentos donde se podría haber intervenido de forma diferente
- **Sugerencias específicas**: otras intervenciones que podrían haber sido útiles
- **Observaciones clínicas**: patrones o señales que merecen atención

## 3. PLAN PRÓXIMA SESIÓN
- 3-4 temas o áreas a trabajar en la próxima sesión
- Preguntas específicas para retomar
- Aspectos a monitorear

Sé honesto pero constructivo en el feedback. El objetivo es el desarrollo profesional del terapeuta. Cita ejemplos específicos extraídos del registro de la sesión.`;

function splitSummary(text: string): { summary: string; feedback: string; nextPlan: string } {
  if (!text) return { summary: "", feedback: "", nextPlan: "" };
  const re = /##\s*1\.\s*RESUMEN DE SESIÓN([\s\S]*?)##\s*2\.\s*FEEDBACK AL TERAPEUTA([\s\S]*?)##\s*3\.\s*PLAN PRÓXIMA SESIÓN([\s\S]*)/i;
  const m = text.match(re);
  if (m) {
    return {
      summary: m[1].trim(),
      feedback: m[2].trim(),
      nextPlan: m[3].trim(),
    };
  }
  // Fallback: dump everything to summary
  return { summary: text.trim(), feedback: "", nextPlan: "" };
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
    const { session_id, audio_transcript } = body ?? {};
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await userClient.from("sessions").select("*").eq("id", session_id).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ error: "Sesión no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patientId = session.patient_id;
    const { data: patient } = patientId
      ? await userClient.from("patients").select("*").eq("id", patientId).maybeSingle()
      : { data: null } as any;

    const profileBlock = patient ? `
Nombre: ${patient.first_name} ${patient.last_name}
Diagnóstico: ${patient.diagnosis ?? "(sin registrar)"}
Problema actual: ${patient.presenting_problem ?? "(sin registrar)"}
Historia clínica: ${patient.clinical_history ?? "(sin registrar)"}
Objetivos terapéuticos: ${patient.therapeutic_goals ?? "(sin registrar)"}
Notas: ${patient.notes ?? "(sin notas)"}
`.trim() : "(sin perfil)";

    const patientEntries = (session.patient_interventions ?? []) as any[];
    const therapistEntries = (session.therapist_notes_live ?? []) as any[];
    const used = (session.claude_suggestions_used ?? []) as any[];
    const merged = [
      ...patientEntries.map((e) => ({ ...e, who: "Paciente" })),
      ...therapistEntries.map((e) => ({ ...e, who: "Terapeuta" })),
    ].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

    const log = merged.length
      ? merged.map((e) => `[${e.who}] ${e.text}`).join("\n")
      : "(sin entradas registradas)";

    const usedBlock = used.length
      ? used.map((s: any) => `- (${s.kind ?? "?"}) ${s.text ?? s}`).join("\n")
      : "(ninguna)";

    const complement = [
      session.therapist_text_complement ? `Texto complementario:\n${session.therapist_text_complement}` : null,
      audio_transcript ? `Transcripción de audio del terapeuta:\n${audio_transcript}` : null,
    ].filter(Boolean).join("\n\n") || "(sin complemento)";

    const userMessage = `Perfil del paciente:
${profileBlock}

Estado emocional reportado: ${session.emotional_state ?? "(no registrado)"}
Fecha de la sesión: ${session.session_date}
Número de sesión: ${session.session_number ?? "?"}

Registro completo (cronológico):
${log}

Sugerencias de Claude utilizadas por el terapeuta:
${usedBlock}

Complemento del terapeuta:
${complement}

Genera el resumen, feedback y plan según las tres secciones requeridas.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error", resp.status, errText);
      return new Response(JSON.stringify({ error: "Error de Claude", details: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text ?? "";
    const parts = splitSummary(text);

    return new Response(JSON.stringify({
      raw: text,
      summary: parts.summary,
      clinical_feedback: parts.feedback,
      next_session_plan: parts.nextPlan,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
