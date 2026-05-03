import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { action = 'search', query, onlyPdf = true } = await req.json()

    if (action !== 'search') {
      return new Response(JSON.stringify({ error: 'Unknown action' }), { headers: corsHeaders })
    }

    let q = (query || '').trim()
    if (!q) {
      return new Response(JSON.stringify({ articles: [], error: 'Empty query' }), { headers: corsHeaders })
    }
    if (onlyPdf) q += ' AND OPEN_ACCESS:y AND HAS_FT:y'

    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=20&resultType=core`
    console.log('[search-pubmed]', url)

    const res = await fetch(url, { headers: { 'User-Agent': 'Psicoasist/1.0' } })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error('[search-pubmed] EuropePMC error', res.status, txt.slice(0, 300))
      return new Response(JSON.stringify({ articles: [], error: `EuropePMC error: ${res.status}` }), { headers: corsHeaders })
    }

    const data = await res.json()
    const formatAuthor = (s: string): string => {
      if (!s) return ''
      const parts = s.split(/\s*,\s*/).filter(Boolean)
      if (parts.length <= 1) return s
      return `${parts[0]} et al.`
    }
    const toIsoDate = (s: string | undefined | null, fallbackYear: string | undefined | null): string | null => {
      if (s) {
        // Accept YYYY-MM-DD or YYYY-MM or YYYY
        const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/)
        if (m) {
          const yy = m[1]
          const mm = m[2] ?? '01'
          const dd = m[3] ?? '01'
          return `${yy}-${mm}-${dd}`
        }
      }
      if (fallbackYear && /^\d{4}$/.test(String(fallbackYear))) return `${fallbackYear}-01-01`
      return null
    }
    const articles = (data.resultList?.result || []).map((a: any) => {
      const hasPdf = a.hasPDF === 'Y' && !!a.pmcid
      const pdfUrl = hasPdf ? `https://pmc.ncbi.nlm.nih.gov/articles/${a.pmcid}/pdf/` : null
      const pubDate = toIsoDate(a.firstPublicationDate || a.pubDate, a.pubYear)
      // Best-effort affiliation -> institution
      let institution: string | null = null
      const aff = a.authorAffiliations?.affiliation || a.affiliation || null
      if (typeof aff === 'string' && aff.trim()) institution = aff.trim().split(/[;.]/)[0].slice(0, 200)
      const repoId = a.pmid || a.pmcid || a.doi || a.id || null
      return {
        europepmc_id: a.id,
        source: a.source,
        pubmed_id: a.pmid || null,
        pmc_id: a.pmcid || null,
        doi: a.doi || null,
        title: a.title || 'Sin título',
        authors: formatAuthor(a.authorString || ''),
        journal: a.journalTitle || '',
        institution,
        repository: 'PubMed / EuropePMC',
        repository_id: repoId,
        year: a.pubYear || '',
        publication_date: pubDate,
        abstract: a.abstractText || '',
        has_pdf: hasPdf,
        is_open_access: a.isOpenAccess === 'Y',
        pdf_url: pdfUrl,
        article_url: `https://europepmc.org/article/${a.source}/${a.id}`,
      }
    })

    return new Response(JSON.stringify({ articles }), { headers: corsHeaders })
  } catch (error) {
    console.error('[search-pubmed] error:', error)
    return new Response(
      JSON.stringify({ articles: [], error: error instanceof Error ? error.message : String(error) }),
      { headers: corsHeaders },
    )
  }
})
