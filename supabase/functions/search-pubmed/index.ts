// Search PubMed via NCBI E-utilities. Returns article metadata + abstract.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PdfStatus = "available" | "abstract_only" | "no_open_access";

interface ArticleSummary {
  pubmed_id: string;
  pmc_id: string | null;
  doi: string | null;
  title: string;
  authors: string;
  journal: string | null;
  year: string | null;
  has_free_pdf: boolean;
  pdf_status: PdfStatus;
  abstract: string | null;
  url: string;
  pmc_url: string | null;
}

/**
 * Use the PMC OA Web Service to verify whether a PMC article truly has a
 * freely-downloadable PDF. Returns the resolved PDF URL or null.
 * Docs: https://www.ncbi.nlm.nih.gov/pmc/tools/oa-service/
 */
async function resolvePmcPdfUrl(pmcId: string): Promise<string | null> {
  const cleanId = pmcId.replace(/^PMC/i, "");
  try {
    const oaRes = await fetch(
      `https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=PMC${cleanId}&format=pdf`,
      {
        headers: {
          "User-Agent": "PsicoasistBot/1.0 (clinical research; mailto:support@psicoasist.com)",
        },
      },
    );
    if (!oaRes.ok) return null;
    const oaText = await oaRes.text();
    if (/<error\b/i.test(oaText)) return null;
    const linkMatch = oaText.match(/<link[^>]*format="pdf"[^>]*href="([^"]+)"/i)
      ?? oaText.match(/href="([^"]*\.pdf[^"]*)"/i);
    if (!linkMatch) return null;
    return linkMatch[1].replace(/^ftp:\/\//i, "https://");
  } catch (e) {
    console.warn("[search-pubmed] OA lookup failed for PMC", pmcId, e);
    return null;
  }
}

function parseAbstracts(xml: string): Record<string, string> {
  // Very small XML extractor for <PubmedArticle>…</PubmedArticle> blocks
  const out: Record<string, string> = {};
  const articleRegex = /<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g;
  const articles = xml.match(articleRegex) ?? [];
  for (const block of articles) {
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch?.[1];
    if (!pmid) continue;
    const absMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
    if (absMatches.length === 0) continue;
    const text = absMatches
      .map((m) => {
        const inner = m[0];
        const labelMatch = inner.match(/Label="([^"]+)"/);
        const body = m[1].replace(/<[^>]+>/g, "").trim();
        return labelMatch ? `${labelMatch[1]}: ${body}` : body;
      })
      .join("\n\n")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    out[pmid] = text;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const query: string = String(body.query ?? "").trim();
    const onlyFree: boolean = body.onlyFree !== false;
    const years: string = String(body.years ?? "all");
    const language: string = String(body.language ?? "any");
    const retmax: number = Math.min(Number(body.retmax ?? 15), 30);

    if (!query) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let term = query;
    if (onlyFree) term += " AND free full text[filter]";
    if (years && years !== "all") term += ` AND ("last ${years} years"[PDat])`;
    if (language === "español" || language === "spanish") term += " AND Spanish[lang]";
    if (language === "ingles" || language === "english") term += " AND English[lang]";

    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${retmax}&retmode=json&sort=relevance`;
    const searchRes = await fetch(esearchUrl);
    if (!searchRes.ok) throw new Error(`PubMed esearch ${searchRes.status}`);
    const searchData = await searchRes.json();
    const ids: string[] = searchData?.esearchresult?.idlist ?? [];

    if (ids.length === 0) {
      return new Response(JSON.stringify({ articles: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const idStr = ids.join(",");
    const [summaryRes, fetchRes] = await Promise.all([
      fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idStr}&retmode=json`),
      fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idStr}&rettype=abstract&retmode=xml`),
    ]);

    const summaryData = await summaryRes.json();
    const xml = await fetchRes.text();
    const abstracts = parseAbstracts(xml);

    const baseArticles = ids.map((id) => {
      const s = summaryData?.result?.[id] ?? {};
      const articleids: Array<{ idtype: string; value: string }> = s.articleids ?? [];
      const pmcRaw = articleids.find((a) => a.idtype === "pmc")?.value ?? null;
      const pmcId = pmcRaw ? pmcRaw.replace(/^PMC/i, "") : null;
      const doi = articleids.find((a) => a.idtype === "doi")?.value ?? null;
      const authors: Array<{ name: string }> = s.authors ?? [];
      const authorList = authors.slice(0, 3).map((a) => a.name).join(", ") +
        (authors.length > 3 ? " et al." : "");
      const year = s.pubdate ? String(s.pubdate).split(" ")[0] : null;
      return {
        pubmed_id: id,
        pmc_id: pmcId,
        doi,
        title: s.title ?? "(sin título)",
        authors: authorList,
        journal: s.fulljournalname ?? s.source ?? null,
        year,
        abstract: abstracts[id] ?? null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        pmc_url: pmcId ? `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/` : null,
      };
    });

    // Verify PDF availability via PMC OA service in parallel for articles with a PMC ID.
    const articles: ArticleSummary[] = await Promise.all(
      baseArticles.map(async (a) => {
        let pdf_status: PdfStatus = "no_open_access";
        if (a.pmc_id) {
          const pdfUrl = await resolvePmcPdfUrl(a.pmc_id);
          pdf_status = pdfUrl ? "available" : "abstract_only";
        }
        return { ...a, has_free_pdf: pdf_status === "available", pdf_status };
      }),
    );

    return new Response(JSON.stringify({ articles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("search-pubmed error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
