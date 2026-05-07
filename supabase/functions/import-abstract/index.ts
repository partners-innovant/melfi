import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLINICAL_AREAS = [
  "regulacion_emocional_afectivos",
  "neurodesarrollo_cognitivo",
  "identidad_personalidad_self",
  "juicio_realidad_pensamiento",
  "adaptativos_crisis_vitales",
  "alimentarios_imagen_corporal",
  "sustancias_conductas_adictivas",
  "somaticos_psicosomaticos",
  "intervenciones_psicoterapias",
  "neuropsicologia_evaluacion",
  "psicologia_desarrollo",
  "salud_mental_perinatal",
  "salud_mental_laboral",
  "etica_deontologia",
  "otro",
];

const EVIDENCE_LEVELS = [
  "meta_analisis",
  "revision_sistematica",
  "ensayo_clinico_rct",
  "estudio_cohorte",
  "guia_practica_clinica",
  "consenso_expertos",
  "reporte_caso",
  "opinion_experto",
  "otro",
];

async function classify(title: string, abstract: string, LOVABLE_API_KEY: string) {
  const prompt = `Analiza este abstract científico y responde SOLO con JSON exacto:

{
  "clinical_areas": ["1-3 valores de: ${CLINICAL_AREAS.join(", ")}"],
  "evidence_level": "${EVIDENCE_LEVELS.join("|")}",
  "geographic_relevance": "chile|latinoamerica|internacional",
  "language": "español|ingles|otro"
}

Título: ${title}
Abstract: ${abstract.slice(0, 3000)}`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const txt = d.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch (_e) {
    return null;
  }
}

async function embed(text: string, VOYAGE_API_KEY: string): Promise<number[] | null> {
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3", input: [text], input_type: "document", output_dimension: 1024 }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.data?.[0]?.embedding ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader)
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user)
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const body = await req.json();
    const {
      title,
      authors,
      journal,
      year,
      publication_date,
      abstract_text,
      doi,
      pubmed_id,
      pmc_id,
      europepmc_id,
      source_url,
      repository,
      repository_id,
      source_institution,
      impact_factor,
      document_type,
      citations_count,
      is_global,
      clinical_areas: ca_in,
      evidence_level: el_in,
      geographic_relevance: gr_in,
      language: lang_in,
    } = body ?? {};

    function calcRelevance(ev: string | null, cites: number, yr: number | null, geo: string | null): number {
      const ev_s: Record<string, number> = {
        meta_analisis: 100,
        revision_sistematica: 90,
        ensayo_clinico_rct: 80,
        guia_practica_clinica: 75,
        estudio_cohorte: 60,
        consenso_expertos: 50,
        opinion_experto: 30,
        reporte_caso: 20,
        otro: 10,
      };
      const evScore = ev_s[ev ?? "otro"] ?? 10;
      const citScore = Math.min((cites || 0) / 10, 100);
      const yearDiff = new Date().getFullYear() - (yr || 2000);
      const recScore = Math.max(0, 100 - yearDiff * 10);
      const geo_s: Record<string, number> = { chile: 100, latinoamerica: 75, internacional: 50 };
      const geoScore = geo_s[geo ?? "internacional"] ?? 50;
      const total = evScore * 0.4 + citScore * 0.25 + recScore * 0.2 + geoScore * 0.15;
      return Math.round(total * 10) / 10;
    }

    if (!title || !abstract_text) {
      return new Response(JSON.stringify({ error: "title y abstract_text requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Dedupe by identifier
    if (pubmed_id || pmc_id || europepmc_id || doi) {
      const ors: string[] = [];
      if (pubmed_id) ors.push(`pubmed_id.eq.${pubmed_id}`);
      if (pmc_id) ors.push(`pmc_id.eq.${pmc_id}`);
      if (europepmc_id) ors.push(`europepmc_id.eq.${europepmc_id}`);
      if (doi) ors.push(`doi.eq.${doi}`);
      const { data: existing } = await userClient
        .from("abstracts")
        .select("id")
        .or(ors.join(","))
        .limit(1)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({ ok: true, abstract_id: existing.id, duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY") ?? "";

    let clinical_areas = Array.isArray(ca_in) ? ca_in : null;
    let evidence_level = el_in ?? null;
    let geographic_relevance = gr_in ?? null;
    let language = lang_in ?? null;

    if (!clinical_areas || !evidence_level || !geographic_relevance || !language) {
      const ai = await classify(title, abstract_text, LOVABLE_API_KEY);
      if (ai) {
        clinical_areas = clinical_areas ?? (Array.isArray(ai.clinical_areas) ? ai.clinical_areas : []);
        evidence_level = evidence_level ?? ai.evidence_level ?? null;
        geographic_relevance = geographic_relevance ?? ai.geographic_relevance ?? "internacional";
        language = language ?? ai.language ?? "ingles";
      }
    }

    const yearNum = year ? Number(year) : null;
    let citNum = citations_count != null ? Number(citations_count) : 0;
    if (!citations_count && pubmed_id) {
      try {
        const epmc = await fetch(
          `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${pubmed_id}&format=json`,
        );
        if (epmc.ok) {
          const epd = await epmc.json();
          citNum = epd.resultList?.result?.[0]?.citedByCount ?? 0;
        }
      } catch (_e) {
        console.error("[import-abstract] citations fetch error", _e);
      }
    }
    const relevance_score = calcRelevance(evidence_level, citNum, yearNum, geographic_relevance);

    const insertRow: Record<string, unknown> = {
      psychologist_id: user.id,
      is_global: !!is_global,
      title,
      authors: authors ?? null,
      journal: journal ?? null,
      year: yearNum,
      publication_date: publication_date ?? null,
      abstract_text,
      doi: doi ?? null,
      pubmed_id: pubmed_id ?? null,
      pmc_id: pmc_id ?? null,
      europepmc_id: europepmc_id ?? null,
      source_url: source_url ?? null,
      repository: repository ?? "PubMed / EuropePMC",
      repository_id: repository_id ?? pubmed_id ?? pmc_id ?? doi ?? null,
      source_institution: source_institution ?? null,
      impact_factor: impact_factor ?? null,
      document_type: document_type ?? "articulo_cientifico",
      citations_count: citNum,
      clinical_areas: clinical_areas ?? [],
      evidence_level,
      geographic_relevance: geographic_relevance ?? "internacional",
      language: language ?? "ingles",
      relevance_score,
    };

    const { data: inserted, error: insErr } = await userClient
      .from("abstracts")
      .insert(insertRow)
      .select("id")
      .single();
    if (insErr) throw insErr;
    const abstractId = inserted.id as string;

    // Embed and insert chunk
    const chunkText = `${title}\n\n${abstract_text}`;
    const emb = await embed(chunkText, VOYAGE_API_KEY);
    if (emb) {
      const { error: chunkErr } = await userClient.from("abstract_chunks").insert({
        abstract_id: abstractId,
        psychologist_id: user.id,
        is_global: !!is_global,
        content: chunkText,
        embedding: emb as unknown as string,
        clinical_areas: clinical_areas ?? [],
        evidence_level,
      });
      if (chunkErr) console.error("[import-abstract] chunk err", chunkErr);
    }

    return new Response(JSON.stringify({ ok: true, abstract_id: abstractId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[import-abstract] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
