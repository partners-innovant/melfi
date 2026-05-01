const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un asistente especializado en literatura clínica psicológica. El psicólogo necesita encontrar fuentes adicionales sobre el tema consultado.

Busca y entrega entre 4-6 fuentes reales, públicas y accesibles sobre el tema. Para cada fuente incluye:
- Título exacto del documento o artículo
- Autores principales
- Año
- Fuente (PubMed, NICE, WHO, APA, MINSAL, etc.)
- URL directa y real donde se puede acceder o descargar
- Una línea explicando por qué es relevante

IMPORTANTE: Solo incluye URLs que realmente existen y son de acceso público. Prioriza PubMed Central (pmc.ncbi.nlm.nih.gov), NICE (nice.org.uk), WHO IRIS (iris.who.int), APA (apa.org) y repositorios de acceso abierto. No inventes URLs.

Devuelve la respuesta utilizando la herramienta return_sources con la estructura solicitada.`;

const TOOL = {
  name: "return_sources",
  description: "Devuelve la lista de fuentes web sugeridas.",
  input_schema: {
    type: "object",
    properties: {
      sources: {
        type: "array",
        description: "Entre 4 y 6 fuentes web reales y accesibles.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            authors: { type: "string" },
            year: { type: "string" },
            source: { type: "string", description: "PubMed, NICE, WHO, APA, MINSAL, etc." },
            url: { type: "string", description: "URL directa y pública." },
            relevance: { type: "string", description: "Por qué es relevante (una línea)." },
          },
          required: ["title", "authors", "year", "source", "url", "relevance"],
        },
      },
    },
    required: ["sources"],
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string" || !question.trim()) {
      return new Response(JSON.stringify({ error: "question requerida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 3072,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "return_sources" },
        messages: [
          {
            role: "user",
            content: `Pregunta del psicólogo:\n\n${question.trim().slice(0, 2000)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[web-sources] anthropic error", resp.status, t);
      return new Response(JSON.stringify({ error: `Anthropic ${resp.status}: ${t.slice(0, 500)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const toolUse = (data?.content ?? []).find((b: any) => b.type === "tool_use");
    const sources = toolUse?.input?.sources ?? [];

    return new Response(JSON.stringify({ sources }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[web-sources] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
