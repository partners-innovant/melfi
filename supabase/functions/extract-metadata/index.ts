const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const snippet = text.slice(0, 500);

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "Extraes metadatos bibliográficos de fragmentos iniciales de documentos académicos o clínicos. Devuelve siempre cadenas vacías si no estás seguro.",
          },
          {
            role: "user",
            content: `Extrae el título, autor(es) y año de publicación del siguiente fragmento. Si no aparece alguno, deja el campo vacío.\n\n---\n${snippet}\n---`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_metadata",
              description: "Devuelve los metadatos extraídos del documento",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Título del documento" },
                  author: { type: "string", description: "Autor o autores, separados por coma" },
                  year: { type: "string", description: "Año de publicación, 4 dígitos" },
                },
                required: ["title", "author", "year"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_metadata" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit excedido. Intenta de nuevo en unos segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Sin créditos en Lovable AI." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway ${resp.status}: ${t}`);
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let meta = { title: "", author: "", year: "" };
    if (toolCall?.function?.arguments) {
      try {
        meta = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Could not parse tool args:", toolCall.function.arguments);
      }
    }
    return new Response(JSON.stringify(meta), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-metadata error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
