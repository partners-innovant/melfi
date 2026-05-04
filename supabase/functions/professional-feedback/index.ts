import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un supervisor clínico experto con amplia experiencia en psicología clínica y psicoterapia. Tu rol es proporcionar feedback constructivo, honesto y específico para el desarrollo profesional del terapeuta.

Analiza la información proporcionada (notas de sesión, transcripciones, resúmenes, perfil del paciente) y genera feedback estructurado en estas dimensiones según el tipo de análisis solicitado.

Para SESIÓN PUNTUAL evalúa:
1. MANEJO DE LA SESIÓN — momentos clave, oportunidades no aprovechadas, intervenciones efectivas.
2. CALIDAD DE LAS PREGUNTAS — análisis del estilo, 3-5 preguntas alternativas concretas, patrones.
3. ALIANZA TERAPÉUTICA — señales de fortaleza/tensión, sugerencias para próxima sesión.
4. COHERENCIA TEÓRICA — coherencia con enfoque, técnicas vs evidencia, oportunidades.

Para POR PACIENTE agrega:
5. PROGRESO DEL PACIENTE — evolución, indicadores, ajustes al plan.
6. PATRONES EN EL TRABAJO CON ESTE PACIENTE — tendencias del terapeuta, dinámicas relacionales.

Para ANÁLISIS GLOBAL agrega:
7. PATRONES GLOBALES DEL TERAPEUTA — estilo, fortalezas vs áreas de mejora.
8. RECOMENDACIONES DE FORMACIÓN — áreas a profundizar, supervisión, lecturas.

IMPORTANTE:
- Usa ejemplos específicos de las notas y transcripciones cuando sea posible
- Sé constructivo pero honesto — evita el feedback genérico
- Cada sugerencia debe ser concreta y accionable
- Escribe en español, tono profesional pero cálido
- Termina SIEMPRE con un resumen de 3 fortalezas y 3 áreas de mejora prioritarias

Responde EXCLUSIVAMENTE con JSON válido (sin markdown ni texto extra) con esta estructura:
{
  "dimensions": [
    {
      "id": "manejo|preguntas|alianza|coherencia|progreso|patrones_paciente|patrones_global|formacion",
      "title": "string",
      "icon": "emoji",
      "rating": "fortaleza|mejora|atencion",
      "summary": "string",
      "observations": ["string"],
      "suggestions": ["string"],
      "quotes": ["string"]
    }
  ],
  "strengths": ["string","string","string"],
  "improvements": ["string","string","string"],
  "recommended_reading": ["string"],
  "overall_summary": "string"
}`;

function extractJSON(text: string): any {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
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
    const {
      feedback_type,
      patient_id,
      child_patient_id,
      session_id,
      date_from,
      date_to,
    } = body ?? {};

    if (!feedback_type || !["sesion", "paciente", "global"].includes(feedback_type)) {
      return new Response(JSON.stringify({ error: "feedback_type inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Therapist profile
    const { data: profile } = await userClient.from("profiles").select("specialty,theoretical_approach,years_experience,first_name,last_name").eq("id", user.id).maybeSingle();

    // Patient profile (adult or child)
    let patientProfile: any = null;
    let medications: any[] = [];
    if (patient_id) {
      const { data: p } = await userClient.from("patients").select("*").eq("id", patient_id).maybeSingle();
      if (p) {
        patientProfile = {
          name: `${p.first_name} ${p.last_name}`,
          diagnosis: p.diagnosis,
          notes: (p.notes ?? "").slice(0, 2000),
          presenting_problem: p.presenting_problem,
          start_date: p.start_date,
          kind: "adult",
        };
        const { data: meds } = await userClient.from("patient_medications").select("name,dose,frequency,is_active").eq("patient_id", patient_id).eq("is_active", true);
        medications = meds ?? [];
      }
    } else if (child_patient_id) {
      const { data: cp } = await userClient.from("child_patients").select("*").eq("id", child_patient_id).maybeSingle();
      if (cp) {
        patientProfile = {
          name: `${cp.first_name} ${cp.last_name}`,
          diagnosis: cp.medical_diagnosis,
          notes: (cp.notes ?? "").slice(0, 2000),
          referral_reason: cp.referral_reason,
          kind: "child",
        };
      }
    }

    // Sessions
    let sessions: any[] = [];
    if (feedback_type === "sesion" && session_id) {
      const { data } = await userClient.from("sessions").select("*").eq("id", session_id).limit(1);
      sessions = data ?? [];
    } else {
      let q = userClient.from("sessions").select("*").eq("psychologist_id", user.id).order("session_date", { ascending: true }).limit(50);
      if (patient_id) q = q.eq("patient_id", patient_id);
      else if (child_patient_id) q = q.eq("child_patient_id", child_patient_id);
      if (date_from) q = q.gte("session_date", date_from);
      if (date_to) q = q.lte("session_date", date_to);
      const { data } = await q;
      sessions = data ?? [];
    }

    const sessionsCompact = sessions.map((s: any) => ({
      date: s.session_date,
      session_number: s.session_number,
      emotional_state: s.emotional_state,
      what_happened: (s.what_happened ?? "").slice(0, 1500),
      interventions_used: (s.interventions_used ?? "").slice(0, 800),
      assigned_task: s.assigned_task,
      next_session_plan: (s.next_session_plan ?? "").slice(0, 600),
      session_summary: (s.session_summary ?? "").slice(0, 1500),
      clinical_feedback: (s.clinical_feedback ?? "").slice(0, 1000),
      patient_interventions: (s.patient_interventions ?? []).slice(0, 30),
      therapist_notes_live: (s.therapist_notes_live ?? []).slice(0, 30),
      live_transcript: (s.live_transcript ?? []).slice(0, 60),
      claude_suggestions_used: s.claude_suggestions_used ?? [],
    }));

    const analysisInput = {
      feedback_type,
      therapist_profile: profile ?? {},
      patient_profile: patientProfile,
      medications: medications.map((m) => `${m.name}${m.dose ? " " + m.dose : ""}`),
      date_range: { from: date_from ?? null, to: date_to ?? null },
      sessions_count: sessionsCompact.length,
      sessions: sessionsCompact,
    };

    const userMessage = `Tipo de análisis solicitado: ${feedback_type.toUpperCase()}

Datos para el análisis (JSON):
${JSON.stringify(analysisInput, null, 2)}

Genera el feedback siguiendo EXACTAMENTE el esquema JSON indicado en las instrucciones. Responde SOLO con JSON válido.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 6000,
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
    const parsed = extractJSON(text);

    if (!parsed) {
      return new Response(JSON.stringify({ error: "Respuesta no parseable", raw: text }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      feedback: parsed,
      analysis_input: analysisInput,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
