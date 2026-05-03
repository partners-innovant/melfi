// Two-step session helper:
//   action="transcribe" → Claude Haiku, audio in, segments out (cheap).
//   action="analyze"    → Claude Sonnet, condensed text context in, summary + suggestions out.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-5-20250929";

const TRANSCRIBE_PROMPT = `Transcribe este audio de una sesión terapéutica. Identifica quién habla: "Terapeuta" o "Paciente" basándote en los patrones de conversación (el terapeuta pregunta e interviene, el paciente narra y responde). Si no puedes identificar al hablante usa "Hablante".

Responde SOLO con JSON:
{
  "segments": [
    {"speaker": "Terapeuta|Paciente|Hablante", "text": "transcripción"}
  ]
}`;

// Bullets-only prompt (Haiku) — pure summarization, no clinical reasoning required
const BULLETS_SYSTEM = `Eres un asistente clínico que resume una sesión terapéutica en curso.

Genera un RESUMEN EN BULLETS (summary_bullets): máximo 8 puntos de no más de 15 palabras cada uno resumiendo lo conversado. Tercera persona, lenguaje clínico conciso.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "summary_bullets": ["..."]
}`;

// Suggestions + insights prompt (Sonnet) — requires deeper clinical reasoning
const ANALYZE_SYSTEM = `Eres un supervisor clínico analizando una sesión terapéutica en curso.

Analiza el material y genera:

1. SUGERENCIAS ACTUALIZADAS (suggestions): basadas en lo que REALMENTE se ha dicho. Cada una con tipo y rationale breve.
2. SUGERENCIAS DETECTADAS (suggestions_addressed): IDs de las sugerencias activas que parecen abordadas.
3. INSIGHT DE SESIÓN (session_insights): observación clínica de 1-2 oraciones.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "suggestions": [{"type":"question|intervention|pattern|alert","text":"...","rationale":"..."}],
  "suggestions_addressed": ["id1"],
  "session_insights": "..."
}`;

function tryParseJson(text: string): any {
  if (!text) return {};
  try { return JSON.parse(text); } catch { /* */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* */ } }
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch { /* */ } }
  return {};
}

async function callAnthropic(model: string, body: any, apiKey: string) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, ...body }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`anthropic_${resp.status}: ${errText}`);
  }
  return await resp.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const body = await req.json().catch(() => ({}));
    const action = (body?.action ?? "transcribe") as "transcribe" | "analyze";

    // ===== TRANSCRIBE (Haiku, audio only) =====
    if (action === "transcribe") {
      const { audio, mime_type, audioMediaType } = body ?? {};
      if (!audio || typeof audio !== "string") {
        return new Response(JSON.stringify({ success: false, error: "audio (base64) requerido", segments: [] }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rawMime = (audioMediaType || mime_type || "audio/webm").split(";")[0];
      // Anthropic accepts a limited set; map common recorder MIMEs
      const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"];
      const mediaType = allowed.includes(rawMime) ? rawMime : "audio/webm";
      console.log("transcribe: audio base64 length =", audio.length, "mediaType =", mediaType, "(raw:", rawMime, ")");

      async function tryWithMedia(mt: string) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: HAIKU_MODEL,
            max_tokens: 2000,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: TRANSCRIBE_PROMPT },
                { type: "document", source: { type: "base64", media_type: mt, data: audio } },
              ],
            }],
          }),
        });
        const json = await resp.json();
        return { ok: resp.ok, status: resp.status, json };
      }

      let result = await tryWithMedia(mediaType);
      console.log("Claude response status:", result.status, "body:", JSON.stringify(result.json).slice(0, 800));
      if (!result.ok && mediaType !== "audio/mp4") {
        console.log("Retrying with audio/mp4 fallback");
        result = await tryWithMedia("audio/mp4");
        console.log("Claude retry response:", result.status, JSON.stringify(result.json).slice(0, 800));
      }
      if (!result.ok || result.json?.error) {
        const msg = result.json?.error?.message || `anthropic_${result.status}`;
        return new Response(JSON.stringify({ success: false, error: msg, segments: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text: string = result.json?.content?.[0]?.text ?? "";
      const parsed = tryParseJson(text);
      const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
      return new Response(JSON.stringify({ success: true, segments }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== ANALYZE (Sonnet, condensed text context only) =====
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

    const {
      patient_id,
      transcript_text,
      therapist_notes,
      patient_notes,
      active_suggestions,
      recent_summary_bullets,
    } = body ?? {};
    if (!patient_id) {
      return new Response(JSON.stringify({ error: "patient_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Condensed patient profile (diagnosis + truncated notes only)
    const { data: patient } = await userClient
      .from("patients")
      .select("first_name, last_name, diagnosis, notes")
      .eq("id", patient_id)
      .maybeSingle();
    const truncatedNotes = (patient?.notes ?? "").slice(0, 500);
    const profileBlock = patient
      ? `Paciente: ${patient.first_name ?? ""} ${patient.last_name ?? ""}\nDiagnóstico: ${patient.diagnosis ?? "(sin registrar)"}\nNotas: ${truncatedNotes || "(sin notas)"}`
      : "(sin perfil)";

    const sugList = Array.isArray(active_suggestions) ? active_suggestions : [];
    const sugBlock = sugList.length
      ? sugList.map((s: any) => `- [${s.id}] (${s.type}) ${s.text}`).join("\n")
      : "(ninguna)";

    const recentBullets = Array.isArray(recent_summary_bullets)
      ? recent_summary_bullets.slice(0, 3)
      : [];
    const bulletsBlock = recentBullets.length
      ? recentBullets.map((b: string) => `• ${b}`).join("\n")
      : "(sin resúmenes previos)";

    const userMessage = `Resumen reciente de la sesión (últimos 3 bullets):
${bulletsBlock}

Transcripción nueva (último fragmento):
${transcript_text || "(sin transcripción)"}

Notas del terapeuta (sesión actual):
${therapist_notes || "(sin notas)"}

Notas del paciente (sesión actual):
${patient_notes || "(sin notas)"}

Perfil resumido del paciente:
${profileBlock}

Sugerencias activas actuales:
${sugBlock}

Devuelve el JSON pedido.`;

    // Run bullets (Haiku) and suggestions+insights (Sonnet) in parallel
    const [bulletsResp, analyzeResp] = await Promise.all([
      // Using Haiku — summary bullets are pure summarization, no clinical reasoning needed
      callAnthropic(HAIKU_MODEL, {
        max_tokens: 1000,
        system: BULLETS_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      }, ANTHROPIC_API_KEY),
      // Using Sonnet — clinical suggestions + insights require deeper reasoning
      callAnthropic(SONNET_MODEL, {
        max_tokens: 1500,
        system: ANALYZE_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      }, ANTHROPIC_API_KEY),
    ]);

    const bulletsParsed = tryParseJson(bulletsResp?.content?.[0]?.text ?? "");
    const parsed = tryParseJson(analyzeResp?.content?.[0]?.text ?? "");
    return new Response(JSON.stringify({
      summary_bullets: Array.isArray(bulletsParsed.summary_bullets) ? bulletsParsed.summary_bullets : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      suggestions_addressed: Array.isArray(parsed.suggestions_addressed) ? parsed.suggestions_addressed : [],
      session_insights: typeof parsed.session_insights === "string" ? parsed.session_insights : "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
