// PubMed integration using NCBI E-utilities + PMC OA Web Service.
// Three actions:
//   - "search":       run a PubMed query, return articles + verified pdf_status
//   - "download_pdf": download a PMC OA PDF (verified via OA service first)
//   - "get_abstract": fetch the abstract text for a single PubMed ID
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PdfStatus = "pdf_available" | "abstract_only" | "no_access";

interface ArticleResult {
  pubmed_id: string;
  pmc_id: string | null;
  doi: string | null;
  title: string;
  authors: string;
  journal: string | null;
  year: string | null;
  abstract: string | null;
  url: string;
  pmc_url: string | null;
  pdf_status: PdfStatus;
  pdf_url: string | null;
  // Backwards-compat with older callers
  has_free_pdf: boolean;
}

const UA = "Psicoasist/1.0 (clinical research; mailto:support@psicoasist.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Look up a PMC article in the OA Web Service.
 * Returns a usable HTTPS PDF URL or null when the article is not in the OA subset.
 */
async function resolveOaPdfUrl(pmcId: string): Promise<string | null> {
  const cleanId = pmcId.replace(/^PMC/i, "");
  try {
    const oaRes = await fetch(
      `https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=PMC${cleanId}&format=pdf`,
      { headers: { "User-Agent": UA } },
    );
    if (!oaRes.ok) return null;
    const oaText = await oaRes.text();
    if (/<error\b/i.test(oaText)) return null;

    // Only treat as available if OA explicitly returns a PDF link.
    // Look for <link format="pdf" href="..."> specifically.
    const pdfLinkMatch = oaText.match(/<link[^>]*format="pdf"[^>]*href="([^"]+)"/i)
      || oaText.match(/href="([^"]+\.pdf[^"]*)"[^>]*format="pdf"/i);
    let pdfHref: string | null = pdfLinkMatch?.[1] ?? null;

    // Fallback: any href ending in .pdf (some responses order attributes differently)
    if (!pdfHref) {
      const anyPdfHref = oaText.match(/href="((?:https?|ftp):\/\/[^"]+\.pdf[^"]*)"/i);
      pdfHref = anyPdfHref?.[1] ?? null;
    }

    if (!pdfHref) return null;

    // Edge runtime cannot fetch ftp://. NCBI's FTP host serves the same paths over HTTPS.
    if (pdfHref.startsWith("ftp://")) {
      pdfHref = pdfHref.replace(/^ftp:\/\//i, "https://");
    }
    return pdfHref;
  } catch (e) {
    console.warn("[search-pubmed] OA lookup failed for PMC", pmcId, e);
    return null;
  }
}

function parseAbstracts(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const articles = xml.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) ?? [];
  for (const block of articles) {
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;
    const absMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
    if (absMatches.length === 0) continue;
    const text = absMatches
      .map((m) => {
        const label = m[0].match(/Label="([^"]+)"/)?.[1];
        const body = m[1].replace(/<[^>]+>/g, "").trim();
        return label ? `${label}: ${body}` : body;
      })
      .join("\n\n")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    out[pmid] = text;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function handleSearch(body: Record<string, unknown>): Promise<Response> {
  const query = String(body.query ?? "").trim();
  const onlyFree = body.onlyFree !== false;
  const years = String(body.years ?? "all");
  const language = String(body.language ?? "any");
  const retmax = Math.min(Number(body.retmax ?? 15), 30);

  if (!query) return jsonResponse({ error: "query is required" }, 400);

  let term = query;
  if (onlyFree) term += " AND free full text[filter]";
  if (years && years !== "all") term += ` AND ("last ${years} years"[PDat])`;
  if (language === "español" || language === "spanish") term += " AND Spanish[lang]";
  if (language === "ingles" || language === "english") term += " AND English[lang]";

  const esearchRes = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${retmax}&retmode=json&sort=relevance`,
    { headers: { "User-Agent": UA } },
  );
  if (!esearchRes.ok) throw new Error(`PubMed esearch ${esearchRes.status}`);
  const searchData = await esearchRes.json();
  const ids: string[] = searchData?.esearchresult?.idlist ?? [];
  if (ids.length === 0) return jsonResponse({ articles: [] });

  const idStr = ids.join(",");
  const [summaryRes, fetchRes] = await Promise.all([
    fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idStr}&retmode=json`, { headers: { "User-Agent": UA } }),
    fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idStr}&rettype=abstract&retmode=xml`, { headers: { "User-Agent": UA } }),
  ]);
  const summaryData = await summaryRes.json();
  const abstracts = parseAbstracts(await fetchRes.text());

  const articles: ArticleResult[] = await Promise.all(ids.map(async (id) => {
    const s = summaryData?.result?.[id] ?? {};
    const articleids: Array<{ idtype: string; value: string }> = s.articleids ?? [];
    const pmcRaw = articleids.find((a) => a.idtype === "pmc")?.value ?? null;
    const pmcId = pmcRaw ? pmcRaw.replace(/^PMC/i, "") : null;
    const doi = articleids.find((a) => a.idtype === "doi")?.value ?? null;
    const authors: Array<{ name: string }> = s.authors ?? [];
    const authorList = authors.slice(0, 3).map((a) => a.name).join(", ") +
      (authors.length > 3 ? " et al." : "");
    const year = s.pubdate ? String(s.pubdate).split(" ")[0] : null;

    let pdf_status: PdfStatus = "no_access";
    let pdf_url: string | null = null;
    if (pmcId) {
      const url = await resolveOaPdfUrl(pmcId);
      if (url) {
        pdf_status = "pdf_available";
        pdf_url = url;
      } else {
        pdf_status = "abstract_only";
      }
    }

    return {
      pubmed_id: id,
      pmc_id: pmcId ? `PMC${pmcId}` : null,
      doi,
      title: s.title ?? "(sin título)",
      authors: authorList,
      journal: s.fulljournalname ?? s.source ?? null,
      year,
      abstract: abstracts[id] ?? null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      pmc_url: pmcId ? `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/` : null,
      pdf_status,
      pdf_url,
      has_free_pdf: pdf_status === "pdf_available",
    };
  }));

  return jsonResponse({ articles });
}

async function handleDownloadPdf(body: Record<string, unknown>): Promise<Response> {
  const pmcRaw = typeof body.pmc_id === "string" ? body.pmc_id : (typeof body.pmcId === "string" ? body.pmcId : null);
  let downloadUrl = typeof body.pdf_url === "string" ? body.pdf_url : (typeof body.pdfUrl === "string" ? body.pdfUrl : null);

  // Always re-verify via the OA service to make sure the URL is fresh and the
  // article is still in the OA subset.
  if (pmcRaw) {
    const verified = await resolveOaPdfUrl(pmcRaw);
    if (verified) downloadUrl = verified;
    else downloadUrl = null;
  }

  if (!downloadUrl) {
    return jsonResponse({ success: false, error: "PDF no disponible en PMC Open Access" }, 404);
  }

  const pdfRes = await fetch(downloadUrl, {
    redirect: "follow",
    headers: { "User-Agent": UA, "Accept": "application/pdf,*/*;q=0.8" },
  });
  if (!pdfRes.ok) {
    return jsonResponse({ success: false, error: `Error descargando PDF: ${pdfRes.status}` }, 502);
  }
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  // Validate PDF magic bytes (%PDF)
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return jsonResponse({ success: false, error: "El servidor devolvió contenido no-PDF" }, 502);
  }
  return jsonResponse({
    success: true,
    pdf_base64: toBase64(bytes),
    size: bytes.length,
    url: downloadUrl,
  });
}

async function handleGetAbstract(body: Record<string, unknown>): Promise<Response> {
  const pubmedId = String(body.pubmed_id ?? body.pubmedId ?? "").trim();
  if (!pubmedId) return jsonResponse({ error: "pubmed_id is required" }, 400);
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pubmedId)}&rettype=abstract&retmode=text`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return jsonResponse({ error: `efetch ${res.status}` }, 502);
  const abstract = await res.text();
  return jsonResponse({ abstract });
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
