import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-sonnet-4-5-20250929";

type Kind = "text" | "image" | "audio" | "whatsapp";

function buildPrompt(kind: Kind, name: string, filename: string, textContent?: string) {
  if (kind === "image") {
    return `El psicólogo ha compartido una imagen relacionada con el paciente ${name}. Puede ser una foto de notas escritas a mano, un dibujo de test psicológico, una captura de conversación, o cualquier otro material clínico. Describe lo que ves y extrae toda la información relevante para el perfil clínico del paciente.

Al final, si encuentras información concreta que debería agregarse al perfil clínico, indícalo claramente con una sección "**Información para agregar al perfil:**" seguida de los puntos.`;
  }
  if (kind === "audio") {
    return `El psicólogo ha compartido una grabación de audio relacionada con el paciente ${name}. Puede ser una nota de voz, un fragmento de conversación, o cualquier grabación clínicamente relevante.

Por favor:
1. Transcribe el contenido del audio completo
2. Analiza la transcripción y extrae toda la información clínicamente relevante para el perfil psicológico del paciente
3. Identifica: estado emocional, patrones de comunicación, eventos importantes mencionados, relaciones interpersonales, cambios de ánimo, y cualquier elemento útil para el perfil clínico

Responde en este formato exacto:

**Transcripción:**
[transcripción completa del audio]

**Análisis clínico:**
[insights clínicos organizados por categorías]

**Información para agregar al perfil:**
[lista de puntos concretos que deberían incorporarse al perfil del paciente]`;
  }
  if (kind === "whatsapp") {
    return `El psicólogo ha compartido una exportación de conversación de WhatsApp relacionada con o del paciente ${name}. Analiza los mensajes y extrae información clínicamente relevante: patrones de comunicación, estado emocional, relaciones interpersonales, eventos importantes mencionados, cambios de ánimo, y cualquier otro elemento útil para el perfil psicológico. No reproduzcas los mensajes — solo extrae insights clínicos.

Al final, incluye una sección "**Información para agregar al perfil:**" con los puntos concretos.

CONVERSACIÓN (${filename}):
${textContent ?? ""}`;
  }
  // text (PDF/DOCX/TXT)
  return `El psicólogo ha subido un documento relacionado con el paciente ${name}. Analiza el contenido y extrae toda la información clínicamente relevante sobre el paciente. Luego preséntala de forma organizada indicando qué nueva información aporta al perfil clínico y qué campos del perfil deberían actualizarse.

Al final, incluye una sección "**Información para agregar al perfil:**" con los puntos concretos.

DOCUMENTO (${filename}):
${textContent ?? ""}`;
}

function detectWhatsApp(text: string): boolean {
  // Lines like: "12/3/24, 14:32 - Name: message" or "[12/3/24, 14:32:01] Name: msg"
  const lines = text.split("\n").slice(0, 60);
  let matches = 0;
  for (const l of lines) {
    if (
      /^\[?\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]+\d{1,2}:\d{2}/.test(l) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*[-–]\s+/.test(l)
    ) {
      matches++;
    }
  }
  return matches >= 3;
}

function audioMediaType(mime: string, filename: string): string | null {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "audio/mpeg";
  if (m.includes("wav")) return "audio/wav";
  if (m.includes("ogg")) return "audio/ogg";
  if (m.includes("webm")) return "audio/webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "audio/mp4";
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "webm") return "audio/webm";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  return null;
}

function imageMediaType(mime: string, filename: string): string | null {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "image/png";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("webp")) return "image/webp";
  if (m.includes("gif")) return "image/gif";
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return null;
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      patient_id,
      filename,
      mime_type,
      kind,           // "text" | "image" | "audio"
      text_content,   // for text/whatsapp
      base64_content, // for image/audio
    } = body as {
      patient_id: string;
      filename: string;
      mime_type: string;
      kind: "text" | "image" | "audio";
      text_content?: string;
      base64_content?: string;
    };

    if (!patient_id || !filename || !kind) {
      return new Response(JSON.stringify({ error: "Parámetros requeridos faltantes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: patient } = await supabase
      .from("patients")
      .select("first_name, last_name")
      .eq("id", patient_id)
      .eq("psychologist_id", user.id)
      .maybeSingle();
    if (!patient) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const name = `${patient.first_name} ${patient.last_name}`.trim();

    let effectiveKind: Kind = kind;
    if (kind === "text" && text_content && detectWhatsApp(text_content)) {
      effectiveKind = "whatsapp";
    }

    const prompt = buildPrompt(effectiveKind, name, filename, text_content);

    let userContent: any;
    if (effectiveKind === "image") {
      const mt = imageMediaType(mime_type, filename);
      if (!mt || !base64_content) {
        return new Response(JSON.stringify({ error: "Imagen inválida" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userContent = [
        { type: "image", source: { type: "base64", media_type: mt, data: base64_content } },
        { type: "text", text: prompt },
      ];
    } else if (effectiveKind === "audio") {
      const mt = audioMediaType(mime_type, filename);
      if (!mt || !base64_content) {
        return new Response(JSON.stringify({ error: "Audio inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userContent = [
        { type: "input_audio", source: { type: "base64", media_type: mt, data: base64_content } },
        { type: "text", text: prompt },
      ];
    } else {
      userContent = prompt;
    }

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!claudeResp.ok) {
      const txt = await claudeResp.text();
      console.error("Claude error", claudeResp.status, txt);
      return new Response(
        JSON.stringify({ error: `Claude API ${claudeResp.status}: ${txt.slice(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await claudeResp.json();
    const analysis: string = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    // Persist a synthetic chat exchange so it appears in conversation history
    const userTag =
      effectiveKind === "image" ? "📎 Imagen subida"
      : effectiveKind === "audio" ? "📎 Audio subido"
      : effectiveKind === "whatsapp" ? "📎 Conversación de WhatsApp subida"
      : "📎 Documento subido";
    const userMsg = `${userTag}: ${filename}`;
    const assistantMsg = `📎 **Análisis de ${filename}**\n\n${analysis}`;

    await supabase.from("patient_profile_chat").insert([
      { patient_id, psychologist_id: user.id, role: "user", content: userMsg },
      { patient_id, psychologist_id: user.id, role: "assistant", content: assistantMsg },
    ]);

    const hasProfileSuggestion = /informaci[oó]n para agregar al perfil/i.test(analysis);

    return new Response(
      JSON.stringify({
        analysis,
        kind: effectiveKind,
        user_message: userMsg,
        assistant_message: assistantMsg,
        suggest_profile_update: hasProfileSuggestion,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyze-patient-file error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
