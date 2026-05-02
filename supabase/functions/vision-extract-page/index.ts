// Calls Claude with a single PDF page image (base64) and returns extracted structured text.
// Designed to be invoked once per page so the client can show progress.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `Analiza esta página de un documento clínico psicológico. Extrae TODO el contenido:
- Texto completo tal como aparece
- Descripción detallada de cualquier diagrama, figura o ilustración
- Contenido completo de tablas (todas las filas y columnas con sus valores)
- Gráficos (describe ejes, valores, tendencias y conclusiones)
- Fórmulas, escalas de puntuación, baremos normativos
- Cualquier otro elemento visual relevante

Presenta el contenido de forma estructurada y completa.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const reqId = crypto.randomUUID().slice(0, 8);
  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const body = await req.json();
    const { image_base64, media_type = "image/png", page_number } = body ?? {};

    if (!image_base64 || typeof image_base64 !== "string") {
      return new Response(JSON.stringify({ error: "image_base64 requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[vision-extract-page:${reqId}] page=${page_number} bytes=${image_base64.length}`);

    const t0 = Date.now();
    let resp: Response | null = null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Using Haiku — document title/metadata extraction is a simple classification task
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type, data: image_base64 },
                },
                { type: "text", text: PROMPT },
              ],
            },
          ],
        }),
      });
      if (resp.status !== 429 && resp.status !== 529) break;
      const wait = Math.min(20000, 4000 * attempt);
      console.warn(`[vision-extract-page:${reqId}] ${resp.status} retry ${attempt}/${maxAttempts}, wait ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
    const dt = Date.now() - t0;
    console.log(`[vision-extract-page:${reqId}] claude responded ${resp!.status} in ${dt}ms`);

    if (!resp!.ok) {
      const txt = await resp!.text();
      console.error(`[vision-extract-page:${reqId}] error ${resp!.status}:`, txt);
      return new Response(JSON.stringify({ error: `Claude error ${resp!.status}: ${txt}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp!.json();
    const text = (data.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    return new Response(JSON.stringify({ text, page_number }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`[vision-extract-page:${reqId}] error:`, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
