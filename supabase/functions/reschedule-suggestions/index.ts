// Suggest 3 alternative slots for rescheduling a session via Claude.
// Returns JSON: { suggestions: [...], note?: string }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const DAY_LABEL: Record<string, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });

    const {
      patient_id,
      reason,
    }: { patient_id: string; reason: string } = await req.json();

    if (!patient_id || !reason) {
      return new Response(JSON.stringify({ error: "patient_id and reason are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load target patient + all patients with schedules (RLS scopes to current therapist)
    const { data: target, error: tErr } = await supabase
      .from("patients")
      .select("id, first_name, last_name, session_day, session_time, session_frequency, session_duration")
      .eq("id", patient_id)
      .maybeSingle();
    if (tErr || !target) {
      return new Response(JSON.stringify({ error: tErr?.message ?? "Patient not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: others } = await supabase
      .from("patients")
      .select("id, first_name, last_name, session_day, session_time")
      .not("session_day", "is", null)
      .not("session_time", "is", null);

    const today = new Date();
    const todayStr = today.toLocaleDateString("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const patientName = `${target.first_name} ${target.last_name}`;
    const dayLabel = target.session_day ? DAY_LABEL[target.session_day] ?? target.session_day : "—";
    const timeLabel = target.session_time ? String(target.session_time).slice(0, 5) : "—";

    const schedule = (others ?? [])
      .map((p: any) => {
        const dn = DAY_LABEL[p.session_day] ?? p.session_day;
        const tt = String(p.session_time ?? "").slice(0, 5);
        const isSelf = p.id === target.id ? " (este paciente)" : "";
        return `- ${p.first_name} ${p.last_name}: ${dn} ${tt}${isSelf}`;
      })
      .join("\n") || "(sin pacientes con horario asignado)";

    const userPrompt = `Eres un asistente de agenda para un psicólogo. El paciente ${patientName} tiene su sesión habitual los ${dayLabel} a las ${timeLabel}. Necesita reagendar por: ${reason}.

Hoy es ${todayStr}.

El psicólogo tiene los siguientes pacientes con sus horarios:
${schedule}

Sugiere 3 opciones de horarios alternativos que:
1. No colisionen con otros pacientes
2. Sean en horario laboral razonable (8:00 - 20:00)
3. Estén dentro de los próximos 7 días
4. Si es un cambio permanente, sugiere días/horas disponibles de forma recurrente

Responde ONLY con JSON válido (sin markdown, sin texto antes ni después), con esta forma exacta:
{
  "suggestions": [
    {
      "date": "Miércoles 6 de mayo",
      "time": "16:00",
      "iso_date": "2026-05-06",
      "day_key": "miercoles",
      "reason": "Hay disponibilidad y es próximo a su horario habitual",
      "is_permanent": false
    }
  ],
  "note": "observación general si corresponde"
}

El campo "day_key" debe ser uno de: lunes, martes, miercoles, jueves, viernes, sabado, domingo (sin tildes).
El campo "iso_date" debe ser AAAA-MM-DD.
El campo "time" debe ser HH:MM en formato 24h.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Using Haiku — slot suggestion is scheduling logic, no clinical reasoning needed
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const txt = await claudeResp.text();
      console.error("Claude error", claudeResp.status, txt);
      return new Response(JSON.stringify({ error: "AI error", detail: txt }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await claudeResp.json();
    const text: string = data?.content?.[0]?.text ?? "";

    // Try to extract JSON robustly
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {}
      }
    }

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return new Response(
        JSON.stringify({ error: "Invalid AI response", raw: text }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reschedule-suggestions error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
