// EuropePMC RESTful API integration.
// Actions:
//   - "search":       run an EuropePMC query, return articles with PDF availability
//   - "download_pdf": download the full-text PDF for a given source/id pair
//   - "get_abstract": fetch full abstract for a given source/id pair
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "Psicoasist/1.0 (clinical research; mailto:support@psicoasist.com)";

type PdfStatus = "pdf_available" | "abstract_only" | "no_access";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildSearchQuery(
  query: string,
  onlyFree: boolean,
  years: string,
  language: string,
): string {
  let q = query.trim();
  if (onlyFree) q += " AND OPEN_ACCESS:y";
  if (years && years !== "all") {
    const n = parseInt(years, 10);
    if (!Number.isNaN(n)) {
      const now = new Date().getFullYear();
      q += ` AND (PUB_YEAR:[${now - n} TO ${now}])`;
    }
  }
  if (language === "español" || language === "spanish") q += " AND LANG:spa";
  if (language === "ingles" || language === "english") q += " AND LANG:eng";
  return q;
}

async function handleSearch(body: Record<string, unknown>): Promise<Response> {
  const query = String(body.query ?? "").trim();
  if (!query) return jsonResponse({ error: "query is required" }, 400);

  const onlyFree = body.onlyFree !== false;
  const years = String(body.years ?? "all");
  const language = String(body.language ?? "any");
  const pageSize = Math.min(Number(body.retmax ?? 15), 30);

  const searchQuery = buildSearchQuery(query, onlyFree, years, language);
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(searchQuery)}&format=json&pageSize=${pageSize}&sort=RELEVANCE&resultType=core`;

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`EuropePMC search ${res.status}`);
  const data = await res.json();

  const articles = (data?.resultList?.result ?? []).map((article: Record<string, unknown>) => {
    const hasPdf = article.hasPDF === "Y";
    const isOpenAccess = article.isOpenAccess === "Y";
    const pdf_status: PdfStatus =
      hasPdf && isOpenAccess
        ? "pdf_available"
        : isOpenAccess
        ? "abstract_only"
        : "no_access";

    const source = String(article.source ?? "");
    const europepmc_id = String(article.id ?? "");
    const pmid = article.pmid ? String(article.pmid) : null;
    const pmcid = article.pmcid ? String(article.pmcid) : null;
    const doi = article.doi ? String(article.doi) : null;

    return {
      pubmed_id: pmid,
      pmc_id: pmcid,
      europepmc_id,
      source,
      doi,
      title: String(article.title ?? "(sin título)"),
      authors: String(article.authorString ?? ""),
      journal: String(article.journalTitle ?? "") || null,
      year: article.pubYear ? String(article.pubYear) : null,
      abstract: article.abstractText ? String(article.abstractText) : null,
      has_pdf: hasPdf,
      is_open_access: isOpenAccess,
      pdf_status,
      // Legacy field for backwards compatibility with existing UI fallbacks
      has_free_pdf: pdf_status === "pdf_available",
      url: pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        : `https://europepmc.org/article/${source}/${europepmc_id}`,
      pmc_url: pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/` : null,
      europepmc_url: `https://europepmc.org/article/${source}/${europepmc_id}`,
    };
  });

  return jsonResponse({ articles });
}

async function handleDownloadPdf(body: Record<string, unknown>): Promise<Response> {
  const source = String(body.source ?? "").trim();
  const europepmc_id = String(body.europepmc_id ?? body.europepmcId ?? "").trim();
  if (!source || !europepmc_id) {
    return jsonResponse({ success: false, error: "source and europepmc_id are required" }, 400);
  }

  const pdfUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(source)}/${encodeURIComponent(europepmc_id)}/fullTextPDF`;
  const pdfRes = await fetch(pdfUrl, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/pdf",
    },
  });

  if (!pdfRes.ok) {
    return jsonResponse({ success: false, error: `PDF no disponible: ${pdfRes.status}` });
  }
  const contentType = pdfRes.headers.get("content-type") || "";
  const buffer = await pdfRes.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const looksLikePdf =
    contentType.includes("pdf") ||
    (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  if (!looksLikePdf) {
    return jsonResponse({ success: false, error: "La respuesta no es un PDF válido" });
  }

  // Encode to base64 in chunks (avoid call-stack issues for large PDFs)
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  return jsonResponse({ success: true, pdf_base64: base64, source_url: pdfUrl });
}

async function handleGetAbstract(body: Record<string, unknown>): Promise<Response> {
  const source = String(body.source ?? "").trim();
  const europepmc_id = String(body.europepmc_id ?? body.europepmcId ?? "").trim();
  const pubmed_id = String(body.pubmed_id ?? body.pubmedId ?? "").trim();

  let url: string;
  if (source && europepmc_id) {
    url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`EXT_ID:${europepmc_id} AND SRC:${source}`)}&format=json&resultType=core`;
  } else if (pubmed_id) {
    url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`EXT_ID:${pubmed_id} AND SRC:MED`)}&format=json&resultType=core`;
  } else {
    return jsonResponse({ error: "source+europepmc_id or pubmed_id required" }, 400);
  }

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return jsonResponse({ error: `EuropePMC ${res.status}` }, 502);
  const data = await res.json();
  const article = data?.resultList?.result?.[0];
  return jsonResponse({ abstract: article?.abstractText || "Abstract no disponible" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "search");
    if (action === "search") return await handleSearch(body);
    if (action === "download_pdf") return await handleDownloadPdf(body);
    if (action === "get_abstract") return await handleGetAbstract(body);
    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("search-pubmed error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
