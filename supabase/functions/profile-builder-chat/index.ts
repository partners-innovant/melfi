import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROFILE_FIELDS = [
  "presenting_problem",
  "clinical_history",
  "family_context",
  "work_context",
  "previous_treatments",
  "relevant_history",
  "personal_resources",
  "therapeutic_goals",
  "diagnosis",
  "notes",
] as const;

const FIELD_LABELS: Record<string, string> = {
  presenting_problem: "Motivo de consulta",
  clinical_history: "Historia clínica",
  family_context: "Contexto familiar",
  work_context: "Contexto laboral / ocupacional",
  previous_treatments: "Tratamientos previos",
  relevant_history: "Antecedentes relevantes",
  personal_resources: "Recursos personales",
  therapeutic_goals: "Objetivos terapéuticos",
  diagnosis: "Diagnóstico / hipótesis",
  notes: "Notas clínicas",
};

const SYSTEM_PROMPT = `Eres un asistente clínico especializado en construir perfiles de pacientes adultos para psicólogos. Tu rol es ayudar al psicólogo a estructurar y completar el perfil clínico del paciente mediante una conversación natural.

REGLAS GENERALES:
- Responde siempre en español, en tono profesional y empático.
- Haz UNA pregunta a la vez, breve y concreta. No abrumes con varias preguntas.
- Adapta las preguntas al contexto del paciente y a la información ya disponible.
- Si el psicólogo dice "Ya tengo informes subidos, analízalos", revisa los documentos del paciente y propón actualizaciones de perfil basadas en ellos.
- Cuando tengas información suficiente para llenar o actualizar uno o más campos del perfil, USA la herramienta "update_patient_profile" para proponer las actualizaciones. NO inventes información: solo propón cambios cuando el psicólogo haya proporcionado datos concretos o cuando estén explícitamente en los documentos.
- Después de proponer una actualización, continúa la conversación preguntando por el siguiente aspecto que falta del perfil.
- Áreas a cubrir progresivamente: motivo de consulta, historia clínica, contexto familiar, contexto laboral, tratamientos previos, antecedentes relevantes, recursos personales, objetivos terapéuticos, diagnóstico/hipótesis.

RAZONAMIENTO DIAGNÓSTICO:
Cuando el psicólogo comparte síntomas o un diagnóstico tentativo:
- Contrasta con criterios DSM-5-TR de forma explícita (menciona qué criterios se cumplen y cuáles no según lo descrito)
- Propone diagnósticos diferenciales relevantes (2-3) con sus criterios distintivos
- Hace preguntas específicas para discriminar entre diagnósticos (1-2 por mensaje)
- Señala comorbilidades posibles cuando el cuadro lo sugiere
- Sugiere instrumentos de evaluación cuando corresponde (escalas, tests, entrevistas estructuradas — ej. CAARS, DIVA 2.0, PHQ-9, GAD-7, MMPI-2, SCID-5, etc.)
- Debate con el psicólogo como un colega clínico, no como un oráculo
- Siempre termina con una pregunta que devuelva la iniciativa al psicólogo
- Nunca afirmes un diagnóstico con certeza — siempre como hipótesis clínica

Campos disponibles: ${PROFILE_FIELDS.map((f) => `${f} (${FIELD_LABELS[f]})`).join(", ")}.`;

const SUGGEST_DIAGNOSIS_PROMPT = `El psicólogo te pide que generes una hipótesis diagnóstica completa basada en TODA la información disponible (perfil clínico, documentos, conversación previa).

Responde exactamente con esta estructura en markdown, en español:

Basándome en toda la información disponible sobre [nombre del paciente], incluyendo su perfil clínico y lo conversado, mi hipótesis diagnóstica es:

**Diagnóstico principal:** [diagnóstico con código DSM-5-TR entre paréntesis]
**Criterios que se cumplen:** [lista breve con guiones]
**Criterios pendientes de confirmar:** [lista breve con guiones]

**Diagnósticos a descartar:**
- [alternativa 1]: [razón para considerarlo / razón para descartarlo]
- [alternativa 2]: [razón para considerarlo / razón para descartarlo]

**Recomendaría explorar:** [preguntas específicas o evaluaciones/tests que ayudarían]

¿Qué opinas? ¿Hay algo que no encaje con lo que observas en sesión?

No uses la herramienta de actualización de perfil en esta respuesta — solo entrega la hipótesis para discutirla.`;

const TOOLS = [
  {
    name: "update_patient_profile",
    description:
      "Propone actualizaciones a uno o más campos del perfil del paciente. Usar solo cuando el psicólogo haya proporcionado información concreta o esté explícita en documentos.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          description: "Lista de actualizaciones de campos del perfil",
          items: {
            type: "object",
            properties: {
              field: {
                type: "string",
                enum: PROFILE_FIELDS as unknown as string[],
                description: "Nombre del campo a actualizar",
              },
              value: {
                type: "string",
                description: "Nuevo valor sugerido para el campo (texto completo, no parcial)",
              },
              reason: {
                type: "string",
                description: "Breve justificación basada en lo dicho por el psicólogo o documentos",
              },
            },
            required: ["field", "value", "reason"],
          },
        },
      },
      required: ["updates"],
    },
  },
];

function calcAge(birthDate: string | null): string {
  if (!birthDate) return "desconocida";
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
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
    const { patient_id, message, mode } = body as { patient_id: string; message: string; mode?: string };
    if (!patient_id || !message?.trim()) {
      return new Response(JSON.stringify({ error: "patient_id y message requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership + load patient
    const { data: patient } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patient_id)
      .eq("psychologist_id", user.id)
      .maybeSingle();
    if (!patient) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load documents for context
    const { data: docs } = await supabase
      .from("adult_documents")
      .select("title, document_type, professional_name, professional_role, document_date, notes")
      .eq("patient_id", patient_id)
      .order("document_date", { ascending: false, nullsFirst: false })
      .limit(15);

    // Load prior chat history
    const { data: history } = await supabase
      .from("patient_profile_chat")
      .select("role, content")
      .eq("patient_id", patient_id)
      .order("created_at", { ascending: true })
      .limit(60);

    // Persist user message
    await supabase.from("patient_profile_chat").insert({
      patient_id,
      psychologist_id: user.id,
      role: "user",
      content: message,
    });

    const profileSummary = PROFILE_FIELDS.map((f) => {
      const v = (patient as any)[f];
      return `- ${FIELD_LABELS[f]}: ${v ? String(v).slice(0, 250) : "(vacío)"}`;
    }).join("\n");

    const docsSummary = (docs ?? []).length > 0
      ? (docs ?? []).map((d: any) =>
        `- ${d.document_date ?? "s/f"} · ${d.title}${d.document_type ? ` (${d.document_type})` : ""}${
          d.professional_name ? ` — ${d.professional_name}${d.professional_role ? `, ${d.professional_role}` : ""}` : ""
        }${d.notes ? ` · ${String(d.notes).slice(0, 200)}` : ""}`
      ).join("\n")
      : "(sin documentos cargados)";

    const contextBlock = `PACIENTE:
Nombre: ${patient.first_name} ${patient.last_name}
Edad: ${calcAge(patient.birth_date)}
Sexo: ${patient.sex ?? "no especificado"}
Estado civil: ${patient.marital_status ?? "no especificado"}
Ocupación: ${patient.occupation ?? "no especificada"}

ESTADO ACTUAL DEL PERFIL:
${profileSummary}

DOCUMENTOS CARGADOS DEL PACIENTE:
${docsSummary}`;

    const isSuggestDiagnosis = mode === "suggest_diagnosis";
    const finalSystem = isSuggestDiagnosis
      ? `${SYSTEM_PROMPT}\n\n${SUGGEST_DIAGNOSIS_PROMPT}`
      : SYSTEM_PROMPT;

    const messages = [
      { role: "user" as const, content: contextBlock + "\n\n(Inicia o continúa la conversación según corresponda.)" },
      ...((history ?? []).length === 0
        ? [{ role: "assistant" as const, content: "Entendido. Estoy listo para ayudarte a construir el perfil." }]
        : (history ?? []).map((h: any) => ({ role: h.role as "user" | "assistant", content: h.content }))),
      { role: "user" as const, content: message },
    ];

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: finalSystem,
        tools: isSuggestDiagnosis ? [] : TOOLS,
        stream: true,
        messages,
      }),
    });

    if (!claudeResp.ok || !claudeResp.body) {
      const txt = await claudeResp.text();
      console.error("Claude error", claudeResp.status, txt);
      return new Response(JSON.stringify({ error: `Claude API ${claudeResp.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";
        const toolBlocks: Record<number, { name: string; jsonStr: string }> = {};

        try {
          const reader = claudeResp.body!.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload);
                if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
                  toolBlocks[evt.index] = { name: evt.content_block.name, jsonStr: "" };
                } else if (evt.type === "content_block_delta") {
                  if (evt.delta?.type === "text_delta") {
                    const t = evt.delta.text ?? "";
                    assistantText += t;
                    controller.enqueue(encoder.encode(sse("delta", { text: t })));
                  } else if (evt.delta?.type === "input_json_delta") {
                    const tb = toolBlocks[evt.index];
                    if (tb) tb.jsonStr += evt.delta.partial_json ?? "";
                  }
                }
              } catch (_e) { /* ignore */ }
            }
          }

          // Process tool calls
          const proposals: any[] = [];
          for (const tb of Object.values(toolBlocks)) {
            if (tb.name !== "update_patient_profile") continue;
            try {
              const parsed = JSON.parse(tb.jsonStr || "{}");
              for (const u of parsed.updates ?? []) {
                if (PROFILE_FIELDS.includes(u.field) && typeof u.value === "string") {
                  proposals.push({
                    field: u.field,
                    label: FIELD_LABELS[u.field],
                    value: u.value,
                    reason: u.reason ?? "",
                  });
                }
              }
            } catch (e) {
              console.error("tool json parse", e, tb.jsonStr);
            }
          }

          if (proposals.length > 0) {
            controller.enqueue(encoder.encode(sse("proposals", { proposals })));
          }

          // Persist assistant message
          if (assistantText.trim() || proposals.length > 0) {
            const finalContent = assistantText.trim() ||
              "He preparado algunas propuestas de actualización del perfil basadas en la información disponible.";
            await supabase.from("patient_profile_chat").insert({
              patient_id,
              psychologist_id: user.id,
              role: "assistant",
              content: finalContent,
            });
          }

          controller.enqueue(encoder.encode(sse("done", { ok: true })));
          controller.close();
        } catch (e) {
          console.error("stream error", e);
          controller.enqueue(encoder.encode(sse("error", { error: String(e) })));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("profile-builder-chat error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
