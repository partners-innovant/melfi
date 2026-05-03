const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLINICAL_AREAS = [
  "addiction","alcohol_use_disorders","anxiety","attention_deficit_disorder","autism",
  "bipolar_disorder","delirium","dementia","depression","drug_misuse","eating_disorders",
  "mental_health_services","personality_disorders","psychosis_and_schizophrenia",
  "self_harm","suicide_prevention","intervenciones_psicoterapias","neuropsicologia_evaluacion",
  "psicologia_desarrollo","salud_mental_perinatal","salud_mental_laboral","psicologia_salud",
  "etica_deontologia","trauma_estres","trastornos_disociativos","disfunciones_sexuales",
  "trastornos_sueno","trastornos_neurocognitivos","otro",
];

const DOC_TYPES = [
  "articulo_cientifico","guia_clinica","manual_diagnostico","libro_academico",
  "codigo_etico","informe_consenso","otro",
];

const INSTITUTION_TYPES = [
  "organizacion_internacional","asociacion_profesional","gobierno_ministerio",
  "universidad","revista_cientifica","autor_independiente","otro",
];

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

    const snippet = text.slice(0, 1000);

    const userPrompt = `Analiza este fragmento de documento clínico psicológico. Responde SOLO con este JSON exacto sin texto adicional:

{
  "document_type": "articulo_cientifico|guia_clinica|manual_diagnostico|libro_academico|codigo_etico|informe_consenso|otro",
  "clinical_areas": ["1 to 3 values from: ${CLINICAL_AREAS.join(", ")}"],
  "source_institution": "universidad, hospital u organización que produjo el documento — NO la revista. Null si no aplica",
  "source_institution_type": "organizacion_internacional|asociacion_profesional|gobierno_ministerio|universidad|revista_cientifica|autor_independiente|otro",
  "journal": "nombre de la revista científica donde se publicó — solo si es un artículo. Null si no aplica",
  "repository": "base de datos o repositorio donde se encuentra: PubMed, Cochrane, APA PsycNET, NICE, OMS, etc. Null si no se identifica",
  "repository_id": "PMID, DOI, PMC ID u otro identificador único. Null si no se identifica",
  "title": "suggested title or null",
  "author": "Solo el primer autor en formato 'Apellido, Iniciales.' seguido de 'et al.' si hay más de un autor. Ejemplo: 'Barlow, D.H. et al.' o 'Beck, A.T.' si es autor único",
  "publication_date": "fecha completa en formato YYYY-MM-DD si se puede identificar, o solo el año como YYYY-01-01 si solo hay año disponible",
  "year": "año de publicación como número entero (4 dígitos) o null",
  "language": "español|ingles|otro",
  "evidence_level": "meta_analisis|revision_sistematica|ensayo_clinico_rct|estudio_cohorte|guia_practica_clinica|consenso_expertos|reporte_caso|opinion_experto|otro",
  "geographic_relevance": "chile|latinoamerica|internacional — chile si el estudio es con población chilena o emitido por institución chilena, latinoamerica si es con población o institución latinoamericana, internacional para el resto"
}

FRAGMENTO:
${snippet}`;

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
              "Eres un clasificador de documentos clínicos psicológicos. Responde siempre con JSON válido sin texto adicional ni markdown.",
          },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_classification",
              description: "Devuelve la clasificación clínica del documento",
              parameters: {
                type: "object",
                properties: {
                  document_type: { type: "string", enum: DOC_TYPES },
                  clinical_areas: {
                    type: "array",
                    items: { type: "string", enum: CLINICAL_AREAS },
                    minItems: 1,
                    maxItems: 3,
                  },
                  source_institution: { type: ["string", "null"] },
                  source_institution_type: { type: ["string", "null"], enum: [...INSTITUTION_TYPES, null] },
                  journal: { type: ["string", "null"] },
                  repository: { type: ["string", "null"] },
                  repository_id: { type: ["string", "null"] },
                  title: { type: ["string", "null"] },
                  author: { type: ["string", "null"] },
                  year: { type: ["string", "null"] },
                  publication_date: { type: ["string", "null"] },
                  language: { type: "string", enum: ["español", "ingles", "otro"] },
                  evidence_level: {
                    type: ["string", "null"],
                    enum: [
                      "meta_analisis","revision_sistematica","ensayo_clinico_rct","estudio_cohorte",
                      "guia_practica_clinica","consenso_expertos","reporte_caso","opinion_experto","otro", null,
                    ],
                  },
                  geographic_relevance: {
                    type: ["string", "null"],
                    enum: ["chile", "latinoamerica", "internacional", null],
                  },
                },
                required: ["document_type", "clinical_areas"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_classification" } },
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
    let meta: Record<string, unknown> = {
      title: "",
      author: "",
      year: "",
      publication_date: null,
      document_type: "",
      clinical_areas: [],
      source_institution: null,
      source_institution_type: null,
      journal: null,
      repository: null,
      repository_id: null,
      language: null,
      evidence_level: null,
      geographic_relevance: null,
    };
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        meta = { ...meta, ...parsed };
        // Normalize: empty -> "" / null
        meta.title = meta.title ?? "";
        meta.author = meta.author ?? "";
        meta.year = meta.year ?? "";
        // Validate publication_date is YYYY-MM-DD
        if (typeof meta.publication_date === "string") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.publication_date)) meta.publication_date = null;
        } else {
          meta.publication_date = null;
        }
        if (!Array.isArray(meta.clinical_areas)) meta.clinical_areas = [];
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
