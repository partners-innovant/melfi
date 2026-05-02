const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres un experto en psicología clínica y conoces la literatura científica más relevante. El psicólogo te pide recomendaciones de documentos reales que debería agregar a su base de conocimiento clínico.

Responde con una lista de 8-10 documentos reales y específicos (con autores, año y fuente donde encontrarlos) organizados por categoría. Para cada documento incluye:
- Título exacto
- Autores principales
- Año de publicación
- Dónde encontrarlo (PubMed, APA, WHO, MINSAL, etc.) con URL si es posible
- Por qué es relevante (1 línea)

Solo recomienda documentos que realmente existen y son de acceso público o ampliamente conocidos en la literatura clínica. No inventes títulos ni autores.

Devuelve la respuesta utilizando la herramienta return_recommendations con la estructura solicitada.`;

const TOOL = {
  name: "return_recommendations",
  description: "Devuelve la lista de documentos clínicos recomendados.",
  input_schema: {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        description: "Entre 8 y 10 documentos recomendados.",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: "Categoría clínica del documento." },
            title: { type: "string", description: "Título exacto del documento." },
            authors: { type: "string", description: "Autores principales." },
            year: { type: "string", description: "Año de publicación." },
            source: { type: "string", description: "Fuente donde encontrarlo (PubMed, APA, WHO, MINSAL, etc.)." },
            url: { type: "string", description: "URL pública si está disponible. Cadena vacía si no." },
            relevance: { type: "string", description: "Por qué es relevante (una línea)." },
          },
          required: ["category", "title", "authors", "year", "source", "url", "relevance"],
        },
      },
    },
    required: ["recommendations"],
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { topic } = await req.json();
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return new Response(JSON.stringify({ error: "topic requerido" }), {
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
        // Using Sonnet — clinical reasoning required
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "return_recommendations" },
        messages: [
          {
            role: "user",
            content: `Áreas clínicas sobre las que necesito documentación:\n\n${topic.trim().slice(0, 2000)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[recommend-documents] anthropic error", resp.status, t);
      return new Response(JSON.stringify({ error: `Anthropic ${resp.status}: ${t.slice(0, 500)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const toolUse = (data?.content ?? []).find((b: any) => b.type === "tool_use");
    const recommendations = toolUse?.input?.recommendations ?? [];

    return new Response(JSON.stringify({ recommendations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[recommend-documents] error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
