import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Analiza las notas de esta sesión clínica y sugiere actualizaciones al perfil del paciente.
Identifica: nuevos síntomas mencionados, cambios en el estado del paciente, información nueva sobre su historia, cambios en diagnóstico que podrían ser relevantes.
Sé conservador — solo sugiere cambios cuando hay evidencia clara en las notas. Máximo 4 sugerencias.
Usa la herramienta suggest_profile_updates para devolver tus sugerencias.`;

const ADULT_FIELDS = ["diagnosis", "notes", "occupation", "marital_status"];
const CHILD_FIELDS = [
  "medical_diagnosis", "current_medication", "specialist_name",
  "notes", "referral_reason", "school", "grade", "homeroom_teacher",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "Falta session_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await supabase.from("sessions").select("*")
      .eq("id", session_id).eq("psychologist_id", user.id).maybeSingle();
    if (!session) throw new Error("Sesión no encontrada");

    const isChild = !!session.child_patient_id;
    const fields = isChild ? CHILD_FIELDS : ADULT_FIELDS;
    let profile: any = null;
    if (isChild) {
      const { data } = await supabase.from("child_patients").select("*")
        .eq("id", session.child_patient_id).maybeSingle();
      profile = data;
    } else {
      const { data } = await supabase.from("patients").select("*")
        .eq("id", session.patient_id).maybeSingle();
      profile = data;
    }
    if (!profile) throw new Error("Perfil no encontrado");

    const profileSummary = fields.map((f) => `${f}: ${profile[f] ?? "(vacío)"}`).join("\n");

    const userMessage = `PERFIL ACTUAL DEL PACIENTE (${isChild ? "infanto-juvenil" : "adulto"}):
${profileSummary}

NOTAS DE LA SESIÓN ${session.session_number} (${session.session_date}):
- Estado emocional: ${session.emotional_state ?? "—"}
- ¿Qué ocurrió?: ${session.what_happened ?? "—"}
- Intervenciones realizadas: ${session.interventions_used ?? "—"}
- Tarea asignada: ${session.assigned_task ?? "—"}
- Plan para próxima sesión: ${session.next_session_plan ?? "—"}
- Notas adicionales: ${session.post_session_notes ?? "—"}

Sugiere solo cambios al perfil cuando haya evidencia clara en las notas.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_profile_updates",
            description: "Devuelve sugerencias conservadoras de actualización del perfil del paciente.",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string", enum: fields, description: "Nombre exacto del campo a actualizar" },
                      current_value: { type: "string", description: "Valor actual del campo (vacío si no existe)" },
                      suggested_value: { type: "string", description: "Nuevo valor completo a guardar (reemplazará el actual)" },
                      suggested_addition: { type: "string", description: "Texto a APPENDEAR al campo en lugar de reemplazar (úsalo solo para 'notes')" },
                      reason: { type: "string", description: "Justificación clínica breve basada en las notas" },
                    },
                    required: ["field", "reason"],
                    additionalProperties: false,
                  },
                  maxItems: 4,
                },
              },
              required: ["suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_profile_updates" } },
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta en unos segundos." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "Sin créditos en Lovable AI. Agrega fondos en Settings → Workspace → Usage." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      throw new Error(`AI gateway ${aiResp.status}`);
    }

    const data = await aiResp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    let suggestions: any[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        suggestions = (parsed.suggestions ?? []).filter((s: any) =>
          fields.includes(s.field) && (s.suggested_value || s.suggested_addition)
        );
      } catch (e) {
        console.error("Failed to parse tool args", e);
      }
    }

    // Persist suggestions on the session row
    await supabase.from("sessions")
      .update({ profile_update_suggestions: suggestions })
      .eq("id", session_id);

    return new Response(JSON.stringify({ suggestions, kind: isChild ? "child" : "adult" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("session-analyze error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
