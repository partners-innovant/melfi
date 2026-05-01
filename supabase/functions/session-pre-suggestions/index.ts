import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un asistente clínico preparando al psicólogo para su próxima sesión.
Basándote en el historial del paciente y las sesiones anteriores, sugiere:
1. Puntos de seguimiento de la sesión anterior
2. Tareas pendientes a revisar
3. Posibles intervenciones a trabajar en esta sesión
4. Señales de alerta a observar
Responde en español, en formato Markdown con listas claras y concisas. Máximo 300 palabras.`;

function calcAge(birthDate: string | null): string {
  if (!birthDate) return "desconocida";
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

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

    const { patient_id, child_patient_id } = await req.json();
    if (!patient_id && !child_patient_id) {
      return new Response(JSON.stringify({ error: "Falta patient_id o child_patient_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let context = "";

    if (patient_id) {
      const { data: p } = await supabase.from("patients").select("*")
        .eq("id", patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (!p) throw new Error("Paciente no encontrado");
      const { data: lastSessions } = await supabase.from("sessions")
        .select("session_number, session_date, emotional_state, what_happened, interventions_used, assigned_task, next_session_plan")
        .eq("patient_id", patient_id).eq("status", "realizada")
        .order("session_date", { ascending: false }).limit(3);

      context = `PACIENTE ADULTO:
Nombre: ${p.first_name} ${p.last_name}
Edad: ${calcAge(p.birth_date)}
Sexo: ${p.sex ?? "no especificado"}
Diagnóstico: ${p.diagnosis ?? "no registrado"}
Notas clínicas: ${p.notes ?? "ninguna"}

ÚLTIMAS ${lastSessions?.length ?? 0} SESIONES:
${(lastSessions ?? []).map((s: any) => `
- Sesión ${s.session_number} (${s.session_date}) — Estado emocional: ${s.emotional_state ?? "—"}
  Qué ocurrió: ${s.what_happened ?? "—"}
  Intervenciones: ${s.interventions_used ?? "—"}
  Tarea asignada: ${s.assigned_task ?? "—"}
  Plan próxima sesión: ${s.next_session_plan ?? "—"}`).join("\n") || "  (sin sesiones previas)"}`;
    } else {
      const { data: c } = await supabase.from("child_patients").select("*")
        .eq("id", child_patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (!c) throw new Error("Paciente no encontrado");

      const [{ data: lastSessions }, { data: goals }, { data: behaviors }, { data: pendingTasks }] = await Promise.all([
        supabase.from("sessions")
          .select("session_number, session_date, emotional_state, what_happened, interventions_used, assigned_task, next_session_plan")
          .eq("child_patient_id", child_patient_id).eq("status", "realizada")
          .order("session_date", { ascending: false }).limit(3),
        supabase.from("intervention_goals")
          .select("title, status, estimated_date").eq("child_patient_id", child_patient_id)
          .neq("status", "logrado").order("created_at", { ascending: false }).limit(10),
        supabase.from("behavioral_tracking")
          .select("behavior_name, score, tracking_date").eq("child_patient_id", child_patient_id)
          .order("tracking_date", { ascending: false }).limit(10),
        supabase.from("goal_tasks")
          .select("title, responsible, status").eq("child_patient_id", child_patient_id)
          .eq("status", "pendiente").order("created_at", { ascending: false }).limit(10),
      ]);

      context = `PACIENTE INFANTO-JUVENIL:
Nombre: ${c.first_name} ${c.last_name}
Edad: ${calcAge(c.birth_date)} — Sexo: ${c.sex ?? "—"}
Colegio: ${c.school ?? "—"} — Curso: ${c.grade ?? "—"} — Modalidad: ${c.modality ?? "—"}
Diagnóstico: ${c.medical_diagnosis ?? "no registrado"}
Medicación: ${c.current_medication ?? "ninguna"}
Motivo derivación: ${c.referral_reason ?? "—"}
Notas: ${c.notes ?? "—"}

OBJETIVOS ACTIVOS:
${(goals ?? []).map((g: any) => `- ${g.title} [${g.status}]${g.estimated_date ? ` (estimado ${g.estimated_date})` : ""}`).join("\n") || "- (sin objetivos activos)"}

TAREAS PENDIENTES:
${(pendingTasks ?? []).map((t: any) => `- ${t.title} (responsable: ${t.responsible ?? "—"})`).join("\n") || "- (sin tareas pendientes)"}

PUNTUACIONES CONDUCTUALES RECIENTES:
${(behaviors ?? []).map((b: any) => `- ${b.tracking_date} · ${b.behavior_name}: ${b.score}/5`).join("\n") || "- (sin registros)"}

ÚLTIMAS ${lastSessions?.length ?? 0} SESIONES:
${(lastSessions ?? []).map((s: any) => `
- Sesión ${s.session_number} (${s.session_date}) — Estado emocional: ${s.emotional_state ?? "—"}
  Qué ocurrió: ${s.what_happened ?? "—"}
  Intervenciones: ${s.interventions_used ?? "—"}
  Tarea asignada: ${s.assigned_task ?? "—"}
  Plan próxima sesión: ${s.next_session_plan ?? "—"}`).join("\n") || "  (sin sesiones previas)"}`;
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: context },
        ],
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
    const suggestions = data?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("session-pre-suggestions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
