// Bidirectional Google Calendar sync.
// Actions:
//   - "push_session": create/update Google event for a Psicoasist session
//   - "delete_session": delete Google event for a session
//   - "pull": fetch upcoming Google events in a date range
//   - "disconnect": clear stored Google tokens
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TokenRecord {
  access_token: string;
  refresh_token: string | null;
  scope?: string;
  token_type?: string;
  expires_at: number;
}

async function refreshIfNeeded(token: TokenRecord): Promise<TokenRecord> {
  if (Date.now() < token.expires_at - 60_000) return token;
  if (!token.refresh_token) throw new Error("token_expired_no_refresh");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "refresh_failed");
  return {
    ...token,
    access_token: j.access_token,
    expires_at: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
}

function buildEventBody(sess: any, patientName: string) {
  const startDate = sess.session_date as string;
  const time = (sess.session_time as string | null) || "10:00";
  const dur = sess.duration_minutes ?? 50;
  const startISO = new Date(`${startDate}T${time}:00`);
  const endISO = new Date(startISO.getTime() + dur * 60_000);
  return {
    summary: `Sesión #${sess.session_number} — ${patientName}`,
    description: sess.pre_session_notes || "",
    start: { dateTime: startISO.toISOString() },
    end: { dateTime: endISO.toISOString() },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const jwt = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(jwt);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const action: string = body.action;

    if (action === "disconnect") {
      await admin.from("profiles").update({
        google_calendar_token: null, google_calendar_id: null,
      }).eq("id", userId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load profile + token
    const { data: profile } = await admin.from("profiles")
      .select("google_calendar_token, google_calendar_id")
      .eq("id", userId).maybeSingle();
    if (!profile?.google_calendar_token) {
      return new Response(JSON.stringify({ error: "not_connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let token: TokenRecord;
    try {
      token = await refreshIfNeeded(profile.google_calendar_token as TokenRecord);
    } catch (e) {
      return new Response(JSON.stringify({ error: "token_expired", detail: String(e) }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (token !== profile.google_calendar_token) {
      await admin.from("profiles").update({ google_calendar_token: token }).eq("id", userId);
    }
    const calendarId = profile.google_calendar_id || "primary";
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    if (action === "push_session") {
      const { sessionId } = body;
      const { data: sess, error } = await admin.from("sessions").select("*").eq("id", sessionId).eq("psychologist_id", userId).maybeSingle();
      if (error || !sess) {
        return new Response(JSON.stringify({ error: "session_not_found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Resolve patient name
      let patientName = "Paciente";
      if (sess.patient_id) {
        const { data: p } = await admin.from("patients").select("first_name,last_name").eq("id", sess.patient_id).maybeSingle();
        if (p) patientName = `${p.first_name} ${p.last_name}`;
      } else if (sess.child_patient_id) {
        const { data: c } = await admin.from("child_patients").select("first_name,last_name").eq("id", sess.child_patient_id).maybeSingle();
        if (c) patientName = `${c.first_name} ${c.last_name}`;
      }

      const eventBody = buildEventBody(sess, patientName);
      const isUpdate = !!sess.google_event_id;
      const url = isUpdate ? `${baseUrl}/${encodeURIComponent(sess.google_event_id)}` : baseUrl;
      const res = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      const j = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "google_api", detail: j }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isUpdate && j.id) {
        await admin.from("sessions").update({ google_event_id: j.id }).eq("id", sessionId);
      }
      return new Response(JSON.stringify({ ok: true, event_id: j.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_session") {
      const { sessionId } = body;
      const { data: sess } = await admin.from("sessions").select("google_event_id").eq("id", sessionId).eq("psychologist_id", userId).maybeSingle();
      if (sess?.google_event_id) {
        await fetch(`${baseUrl}/${encodeURIComponent(sess.google_event_id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        await admin.from("sessions").update({ google_event_id: null }).eq("id", sessionId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pull") {
      const { timeMin, timeMax } = body;
      const params = new URLSearchParams({
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      const res = await fetch(`${baseUrl}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const j = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "google_api", detail: j }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const events = (j.items ?? []).map((e: any) => ({
        id: e.id,
        summary: e.summary ?? "(sin título)",
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        htmlLink: e.htmlLink,
        allDay: !!e.start?.date,
      }));
      return new Response(JSON.stringify({ events }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
