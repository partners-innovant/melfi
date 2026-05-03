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

const DIARIZE_PROMPT = `Dado este fragmento de transcripción de una sesión terapéutica, identifica qué partes corresponden al terapeuta y cuáles al paciente. El terapeuta típicamente pregunta, refleja, interviene; el paciente narra, responde, expresa.

Debes devolver EXACTAMENTE la misma cantidad de segmentos que recibes, en el mismo orden, sin modificar el texto. Solo asigna el campo "speaker" a "TERAPEUTA" o "PACIENTE" (en mayúsculas). Si no estás seguro, usa tu mejor inferencia según el contenido — no uses "Hablante".

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "segments": [
    {"speaker": "TERAPEUTA" | "PACIENTE", "text": "..."}
  ]
}`;

function fmtTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `[${mm}:${ss}]`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Bullets-only prompt (Haiku) — pure summarization, no clinical reasoning required
const BULLETS_SYSTEM = `Eres un asistente clínico que resume un fragmento de sesión terapéutica EN CURSO.

Genera 3 listas de bullets MUY CORTOS (máximo 8 palabras cada bullet, frases clave, no oraciones completas):

1) "patient_bullets": qué dijo o hizo el paciente en este fragmento (máx 6 bullets).
2) "therapist_bullets": intervenciones/preguntas del terapeuta en este fragmento (máx 6 bullets).
3) "summary_bullets": resumen general del fragmento, pero SOLO incluye elementos INCONSISTENTES o que representen un CAMBIO respecto al perfil del paciente y a los resúmenes previos. NO incluyas lo esperado o consistente con la historia. Si todo es consistente, devuelve [].

Tercera persona, lenguaje clínico, sin "•" ni numeración, solo el texto plano del bullet.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "patient_bullets": ["..."],
  "therapist_bullets": ["..."],
  "summary_bullets": ["..."]
}`;

// Suggestions + insights prompt (Sonnet) — requires deeper clinical reasoning
const ANALYZE_SYSTEM = `Eres un supervisor clínico analizando una sesión terapéutica en curso.

Analiza el material y genera:

1. SUGERENCIAS DE APOYO (suggestions): orientación CORTA para los próximos minutos de la sesión. Cada una con tipo y rationale breve.
2. SUGERENCIAS DETECTADAS (suggestions_addressed): IDs de las sugerencias activas que parecen abordadas.
3. TÓPICOS ABORDADOS (topics_addressed): IDs de los tópicos sugeridos (lista \"topic_suggestions\") que el terapeuta ya cubrió en la conversación.
4. INSIGHT DE SESIÓN (session_insights): observación clínica de 1-2 oraciones.

Responde SOLO con JSON válido (sin markdown, sin \`\`\`):
{
  "suggestions": [{"type":"question|intervention|pattern|alert","text":"...","rationale":"..."}],
  "suggestions_addressed": ["id1"],
  "topics_addressed": ["tid1"],
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

    // ===== TRANSCRIBE (Whisper for audio→text+timestamps, Claude Haiku for speaker diarization) =====
    if (action === "transcribe") {
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        return new Response(JSON.stringify({ success: false, error: "OPENAI_API_KEY no configurada", segments: [] }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { audio, mime_type, audioMediaType } = body ?? {};
      if (!audio || typeof audio !== "string") {
        return new Response(JSON.stringify({ success: false, error: "audio (base64) requerido", segments: [] }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rawMime = (audioMediaType || mime_type || "audio/webm").split(";")[0];
      const ext = rawMime.includes("mp4") || rawMime.includes("m4a") ? "mp4"
        : rawMime.includes("mpeg") || rawMime.includes("mp3") ? "mp3"
        : rawMime.includes("ogg") ? "ogg"
        : rawMime.includes("wav") ? "wav"
        : "webm";

      const bytes = base64ToBytes(audio);
      const audioBlob = new Blob([bytes], { type: rawMime || "audio/webm" });

      const formData = new FormData();
      formData.append("file", audioBlob, `audio.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "es");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      console.log("whisper: audio bytes =", bytes.length, "mime =", rawMime);

      const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });

      if (!whisperResp.ok) {
        const errText = await whisperResp.text();
        console.error("Whisper error", whisperResp.status, errText);
        return new Response(JSON.stringify({ success: false, error: `whisper_${whisperResp.status}: ${errText.slice(0, 300)}`, segments: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const whisperData = await whisperResp.json();
      const fullText: string = whisperData?.text ?? "";
      const rawSegments: Array<{ start: number; end: number; text: string }> = Array.isArray(whisperData?.segments) ? whisperData.segments : [];

      if (!rawSegments.length && !fullText.trim()) {
        return new Response(JSON.stringify({ success: true, segments: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const timestampedSegments = rawSegments.map((s) => ({
        timestamp: fmtTimestamp(s.start),
        text: (s.text ?? "").trim(),
      }));

      if (!timestampedSegments.length) {
        return new Response(JSON.stringify({
          success: true,
          segments: [{ speaker: "Hablante", timestamp: "[00:00]", text: fullText.trim() }],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Ask Claude Haiku to assign speakers per segment, preserving timestamps and text.
      const diarizeUserMsg = `Segmentos transcritos (orden y texto se deben preservar tal cual):\n\n${timestampedSegments
        .map((s, i) => `${i + 1}. ${s.timestamp} ${s.text}`)
        .join("\n")}`;

      let diarizedSegments: Array<{ speaker: string; timestamp: string; text: string }> = [];
      try {
        const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: HAIKU_MODEL,
            max_tokens: 2000,
            system: DIARIZE_PROMPT,
            messages: [{ role: "user", content: diarizeUserMsg }],
          }),
        });
        const claudeJson = await claudeResp.json();
        const text: string = claudeJson?.content?.[0]?.text ?? "";
        const parsed = tryParseJson(text);
        const arr = Array.isArray(parsed?.segments) ? parsed.segments : [];
        if (arr.length === timestampedSegments.length) {
          diarizedSegments = arr.map((s: any, i: number) => ({
            speaker: typeof s.speaker === "string" ? s.speaker : "Hablante",
            timestamp: timestampedSegments[i].timestamp,
            text: timestampedSegments[i].text,
          }));
        }
      } catch (e) {
        console.error("Diarization failed, returning segments without speaker:", e);
      }

      const finalSegments = diarizedSegments.length
        ? diarizedSegments
        : timestampedSegments.map((s) => ({ speaker: "Hablante", ...s }));

      return new Response(JSON.stringify({ success: true, segments: finalSegments, full_text: fullText }), {
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
      topic_suggestions,
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

    const topicList = Array.isArray(topic_suggestions) ? topic_suggestions : [];
    const topicBlock = topicList.length
      ? topicList.map((s: any) => `- [${s.id}] ${s.text}`).join("\n")
      : "(ninguno)";

    const recentBullets = Array.isArray(recent_summary_bullets)
      ? recent_summary_bullets.slice(0, 10)
      : [];
    const bulletsBlock = recentBullets.length
      ? recentBullets.map((b: string) => `• ${b}`).join("\n")
      : "(sin resúmenes previos)";

    const userMessage = `Resumen previo acumulado de la sesión (bullets ya registrados):
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

Tópicos sugeridos pendientes:
${topicBlock}

Devuelve el JSON pedido.`;

    // Run bullets (Haiku) and suggestions+insights (Sonnet) in parallel
    const [bulletsResp, analyzeResp] = await Promise.all([
      callAnthropic(HAIKU_MODEL, {
        max_tokens: 1200,
        system: BULLETS_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      }, ANTHROPIC_API_KEY),
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
      patient_bullets: Array.isArray(bulletsParsed.patient_bullets) ? bulletsParsed.patient_bullets : [],
      therapist_bullets: Array.isArray(bulletsParsed.therapist_bullets) ? bulletsParsed.therapist_bullets : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      suggestions_addressed: Array.isArray(parsed.suggestions_addressed) ? parsed.suggestions_addressed : [],
      topics_addressed: Array.isArray(parsed.topics_addressed) ? parsed.topics_addressed : [],
      session_insights: typeof parsed.session_insights === "string" ? parsed.session_insights : "",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
