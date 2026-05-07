import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Melfi. Un psicólogo está a punto de consultar sobre este paciente. Genera exactamente 4 preguntas clínicas que un terapeuta haría sobre este caso específico — preguntas que un psicólogo haría para entender mejor al paciente, decidir intervenciones, preparar sesiones o tomar decisiones clínicas.

Las preguntas deben:
- Ser específicas al caso de este paciente (usar su diagnóstico, situación, tiempo en terapia)
- Reflejar lo que un terapeuta realmente necesita saber
- Cubrir distintos ángulos: intervención, pronóstico, técnicas, decisiones clínicas
- Ser preguntas que se puedan responder con documentación clínica
- Incluir el nombre del paciente cuando sea natural

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "suggestions": ["pregunta 1", "pregunta 2", "pregunta 3", "pregunta 4"]
}`;

function calcAge(birthDate: string | null): string {
  if (!birthDate) return "desconocida";
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

function monthsSince(dateStr: string | null): string {
  if (!dateStr) return "desconocido";
  const d = new Date(dateStr);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "menos de 1 mes";
  if (months < 12) return `${months} meses`;
  const y = Math.floor(months / 12);
  const r = months % 12;
  return r === 0 ? `${y} año(s)` : `${y} año(s) y ${r} mes(es)`;
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

    const { patient_id, patient_kind } = await req.json();
    if (!patient_id) {
      return new Response(JSON.stringify({ error: "Falta patient_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let profile = "";
    if (patient_kind === "child") {
      const { data: c } = await supabase.from("child_patients").select("*")
        .eq("id", patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (!c) throw new Error("Paciente no encontrado");
      const { count: sessionCount } = await supabase.from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("child_patient_id", patient_id).eq("status", "realizada");
      profile = `PACIENTE INFANTO-JUVENIL:
Nombre: ${c.first_name} ${c.last_name}
Edad: ${calcAge(c.birth_date)} — Sexo: ${c.sex ?? "—"}
Diagnóstico: ${c.medical_diagnosis ?? "no registrado"}
Motivo derivación: ${c.referral_reason ?? "—"}
Medicación: ${c.current_medication ?? "ninguna"}
Colegio/curso: ${c.school ?? "—"} / ${c.grade ?? "—"}
Notas: ${c.notes ?? "—"}
Sesiones realizadas: ${sessionCount ?? 0}`;
    } else {
      const { data: p } = await supabase.from("patients").select("*")
        .eq("id", patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (!p) throw new Error("Paciente no encontrado");
      const { count: sessionCount } = await supabase.from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("patient_id", patient_id).eq("status", "realizada");
      profile = `PACIENTE ADULTO:
Nombre: ${p.first_name} ${p.last_name}
Edad: ${calcAge(p.birth_date)} — Sexo: ${p.sex ?? "—"}
Diagnóstico: ${p.diagnosis ?? "no registrado"}
Tiempo en terapia: ${monthsSince(p.start_date)}
Motivo de consulta: ${p.presenting_problem ?? "—"}
Historia clínica: ${p.clinical_history ?? "—"}
Contexto familiar: ${p.family_context ?? "—"}
Tratamientos previos: ${p.previous_treatments ?? "—"}
Objetivos terapéuticos: ${p.therapeutic_goals ?? "—"}
Notas: ${p.notes ?? "—"}
Sesiones realizadas: ${sessionCount ?? 0}`;
    }

    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Using Haiku — generating 4 suggested questions, lightweight ideation task
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Perfil del paciente:\n\n${profile}` }],
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, t);
      throw new Error(`Anthropic ${aiResp.status}`);
    }

    const data = await aiResp.json();
    const text = data?.content?.[0]?.text ?? "";
    let suggestions: string[] = [];
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions.slice(0, 4) : [];
    } catch (e) {
      console.error("Parse error:", e, text);
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("patient-suggestions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
