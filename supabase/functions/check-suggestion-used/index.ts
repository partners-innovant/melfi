// Determine whether the therapist used a given Claude suggestion based on a transcript snippet.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const { transcription, suggestion } = await req.json().catch(() => ({}));
    if (!transcription || !suggestion) {
      return new Response(JSON.stringify({ used: false, confidence: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Determina si el terapeuta hizo esta pregunta o intervención durante la transcripción reciente.

Sugerencia: "${suggestion}"

Transcripción reciente:
"""
${String(transcription).slice(0, 4000)}
"""

Considera que puede haberse formulado de forma diferente pero con la misma intención. Sé estricto: solo marca como usada si hay evidencia clara.

Responde SOLO con este JSON:
{"used": true|false, "confidence": 0.0-1.0}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Using Haiku — simple yes/no detection task, no clinical reasoning needed
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic error", resp.status, errText);
      return new Response(JSON.stringify({ used: false, confidence: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: any = { used: false, confidence: 0 };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* keep */ } }
    }

    return new Response(JSON.stringify({
      used: !!parsed?.used,
      confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ used: false, confidence: 0, error: e?.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
