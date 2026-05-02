// Transcribe a short audio chunk from a live therapy session using Anthropic Claude.
// Returns segments labeled by speaker (Terapeuta / Paciente / Hablante).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const body = await req.json().catch(() => ({}));
    const { audio, mime_type, context, patient_name } = body ?? {};
    if (!audio || typeof audio !== "string") {
      return new Response(JSON.stringify({ error: "audio (base64) requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctxList = Array.isArray(context) ? context.slice(-6) : [];
    const ctxBlock = ctxList.length
      ? ctxList.map((s: any) => `${s.speaker ?? "?"}: ${s.text ?? ""}`).join("\n")
      : "(sin contexto previo)";

    const prompt = `Transcribe este fragmento de audio de una sesión terapéutica${patient_name ? ` con el paciente ${patient_name}` : ""}.

Contexto previo de la sesión:
${ctxBlock}

Instrucciones:
- Identifica quién habla: "Terapeuta" o "Paciente" basándote en el contexto y patrones de conversación terapéutica (el terapeuta hace preguntas, refleja, interviene; el paciente narra, responde, explora).
- Si no puedes determinar quién habla con certeza, usa "Hablante".
- Transcribe fielmente lo que se dice en español.
- Ignora muletillas excesivas (eee, mmm) pero mantén pausas significativas con [pausa].
- Si hay silencio prolongado, indica [silencio].
- Si el fragmento no contiene voz audible, devuelve segments: [].

Responde SOLO con este JSON, sin texto adicional ni \`\`\`:
{"segments":[{"speaker":"Terapeuta|Paciente|Hablante","text":"..."}]}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: mime_type || "audio/webm",
                data: audio,
              },
            },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error", resp.status, errText);
      return new Response(JSON.stringify({ error: "claude_error", details: errText, status: resp.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: any = { segments: [] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* keep empty */ }
      }
    }
    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];

    return new Response(JSON.stringify({ segments }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
