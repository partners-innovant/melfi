import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un supervisor clínico experto apoyando a un psicólogo durante una sesión en tiempo real. El psicólogo va anotando lo que dice el paciente y sus propias intervenciones.

Tu rol es:
1. Sugerir preguntas específicas que el terapeuta podría hacer a continuación
2. Señalar patrones clínicos relevantes que estén emergiendo
3. Proponer hipótesis diagnósticas o confirmar/cuestionar las existentes
4. Alertar sobre temas importantes que no se han explorado
5. Sugerir técnicas o intervenciones apropiadas para este momento de la sesión

Reglas:
- Sé muy conciso — el terapeuta está en sesión, no puede leer textos largos
- Usa frases breves
- Prioriza las sugerencias más urgentes o relevantes
- No repitas sugerencias anteriores
- Basa tus observaciones en el perfil del paciente y lo que emerge en la sesión

DEBES responder ÚNICAMENTE con un JSON válido con esta forma exacta (sin texto adicional, sin markdown, sin \`\`\`):
{
  "questions": ["pregunta 1", "pregunta 2", "pregunta 3"],
  "patterns": ["patrón clínico 1", "patrón clínico 2"],
  "interventions": ["técnica/intervención 1", "técnica/intervención 2"],
  "unexplored": ["tema no explorado 1", "tema no explorado 2"]
}

Cada array puede tener entre 0 y 4 elementos. Cada elemento debe ser una frase corta (máx 20 palabras). Si no hay nada relevante para una categoría, devuelve un array vacío.`;

function tryParseJson(text: string): any | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
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
    const { patient_id, session_id, previous_used_suggestions } = body ?? {};
    if (!patient_id || !session_id) {
      return new Response(JSON.stringify({ error: "patient_id y session_id requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch patient profile
    const { data: patient } = await userClient.from("patients").select("*").eq("id", patient_id).maybeSingle();
    if (!patient) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch current session
    const { data: session } = await userClient.from("sessions").select("*").eq("id", session_id).maybeSingle();
    if (!session) {
      return new Response(JSON.stringify({ error: "Sesión no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active medications
    const { data: meds } = await userClient
      .from("patient_medications").select("name, dose, frequency")
      .eq("patient_id", patient_id).eq("is_active", true);

    const profileBlock = `
Nombre: ${patient.first_name} ${patient.last_name}
Diagnóstico: ${patient.diagnosis ?? "(sin registrar)"}
Problema actual: ${patient.presenting_problem ?? "(sin registrar)"}
Historia clínica: ${patient.clinical_history ?? "(sin registrar)"}
Contexto familiar: ${patient.family_context ?? "(sin registrar)"}
Objetivos terapéuticos: ${patient.therapeutic_goals ?? "(sin registrar)"}
Recursos personales: ${patient.personal_resources ?? "(sin registrar)"}
Notas: ${patient.notes ?? "(sin notas)"}
Medicación activa: ${(meds ?? []).map((m: any) => `${m.name}${m.dose ? ` ${m.dose}` : ""}`).join(", ") || "(ninguna)"}
`.trim();

    const patientEntries = (session.patient_interventions ?? []) as any[];
    const therapistEntries = (session.therapist_notes_live ?? []) as any[];
    const merged = [
      ...patientEntries.map((e) => ({ ...e, who: "Paciente" })),
      ...therapistEntries.map((e) => ({ ...e, who: "Terapeuta" })),
    ].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

    const sessionLog = merged.length
      ? merged.map((e) => `[${e.who}] ${e.text}`).join("\n")
      : "(sin entradas todavía)";

    const lastEntry = merged.length ? merged[merged.length - 1] : null;
    const lastEntryBlock = lastEntry ? `[${lastEntry.who}] ${lastEntry.text}` : "(ninguna)";

    const previousUsedBlock = Array.isArray(previous_used_suggestions) && previous_used_suggestions.length
      ? previous_used_suggestions.map((s: any) => `- ${s}`).join("\n")
      : "(ninguna aún)";

    const userMessage = `Perfil del paciente:
${profileBlock}

Historial de la sesión actual:
${sessionLog}

Última entrada:
${lastEntryBlock}

Sugerencias ya utilizadas por el terapeuta (no las repitas):
${previousUsedBlock}

Genera tus sugerencias según el formato JSON especificado.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1200,
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
    const parsed = tryParseJson(text) ?? { questions: [], patterns: [], interventions: [], unexplored: [] };

    return new Response(JSON.stringify({
      suggestions: {
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        interventions: Array.isArray(parsed.interventions) ? parsed.interventions : [],
        unexplored: Array.isArray(parsed.unexplored) ? parsed.unexplored : [],
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
