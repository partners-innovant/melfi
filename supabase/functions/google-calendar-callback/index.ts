// Google OAuth redirect target. Exchanges the code for tokens and stores them
// on profiles.google_calendar_token, then redirects back to the app /calendar page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlRedirect(url: string, _message: string) {
  // 302 redirect directly — avoids HTML/meta-refresh and any charset mojibake.
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  let origin = "";
  let userId = "";
  let returnTo = "";
  try {
    if (stateRaw) {
      const padded = stateRaw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((stateRaw.length + 3) % 4);
      const decoded = JSON.parse(atob(padded));
      origin = decoded.origin || "";
      userId = decoded.uid || "";
      returnTo = decoded.return_to || "";
    }
  } catch (_) { /* ignore */ }

  // Build base URL: origin + (returnTo path or default /calendar)
  // returnTo is a path like "/documents?gcal=connected&from=drive"
  let back = "/";
  if (origin) {
    if (returnTo && returnTo.startsWith("/")) {
      // Strip any pre-existing gcal/reason params; we'll re-append below.
      try {
        const u = new URL(returnTo, origin);
        u.searchParams.delete("gcal");
        u.searchParams.delete("reason");
        back = `${origin}${u.pathname}${u.search ? u.search + "&" : "?"}`;
        // back already ends with ? or &; downstream code appends "gcal=..."
        // Convert format so downstream `${back}${sep}gcal=...` works uniformly:
        // Trim trailing ? or & and let the caller re-add via ?
        if (back.endsWith("?") || back.endsWith("&")) back = back.slice(0, -1);
      } catch {
        back = `${origin}/calendar`;
      }
    } else {
      back = `${origin}/calendar`;
    }
  }

  const sep = back.includes("?") ? "&" : "?";

  if (errorParam) return htmlRedirect(`${back}${sep}gcal=error&reason=${encodeURIComponent(errorParam)}`, "Conexión cancelada.");
  if (!code || !userId) return htmlRedirect(`${back}${sep}gcal=error&reason=missing_code`, "Faltan parámetros.");

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const projectId = Deno.env.get("SUPABASE_URL")!.split("//")[1].split(".")[0];
    const redirectUri = `https://${projectId}.functions.supabase.co/google-calendar-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      return htmlRedirect(`${back}${sep}gcal=error&reason=${encodeURIComponent(tokenJson.error || "token_exchange_failed")}`, "Error al obtener tokens.");
    }

    // Fetch primary calendar id
    let calendarId = "primary";
    try {
      const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (calRes.ok) {
        const cal = await calRes.json();
        if (cal.id) calendarId = cal.id;
      }
    } catch (_) { /* ignore */ }

    const expiresAt = Date.now() + (tokenJson.expires_in ?? 3600) * 1000;
    const tokenRecord = {
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token ?? null,
      scope: tokenJson.scope,
      token_type: tokenJson.token_type,
      expires_at: expiresAt,
    };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error: updErr } = await admin.from("profiles").update({
      google_calendar_token: tokenRecord,
      google_calendar_id: calendarId,
    }).eq("id", userId);

    if (updErr) return htmlRedirect(`${back}${sep}gcal=error&reason=${encodeURIComponent(updErr.message)}`, "Error guardando credenciales.");

    return htmlRedirect(`${back}${sep}gcal=connected`, "¡Conectado! Redirigiendo…");
  } catch (e) {
    return htmlRedirect(`${back}${sep}gcal=error&reason=${encodeURIComponent(String(e))}`, "Error inesperado.");
  }
});
