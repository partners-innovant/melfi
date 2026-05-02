import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, query, onlyFree, years, language, source, europepmc_id } = body

    if (action === 'search') {
      let searchQuery = query || 'psychology therapy'
      if (onlyFree) searchQuery += ' AND OPEN_ACCESS:y'
      if (years && years !== 'all') {
        const fromYear = new Date().getFullYear() - parseInt(years)
        searchQuery += ` AND PUB_YEAR:[${fromYear} TO ${new Date().getFullYear()}]`
      }
      if (language === 'español') searchQuery += ' AND LANG:spa'
      if (language === 'ingles') searchQuery += ' AND LANG:eng'

      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(searchQuery)}&format=json&pageSize=15&sort=RELEVANCE&resultType=core`

      console.log('Searching EuropePMC:', url)

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Psicoasist/1.0' }
      })

      if (!res.ok) {
        return new Response(
          JSON.stringify({ articles: [], error: `EuropePMC error: ${res.status}` }),
          { headers: corsHeaders }
        )
      }

      const data = await res.json()
      console.log('EuropePMC results:', data.resultList?.result?.length || 0)

      const articles = (data.resultList?.result || []).map((article: any) => ({
        pubmed_id: article.pmid || null,
        pmc_id: article.pmcid || null,
        europepmc_id: article.id,
        source: article.source,
        title: article.title || 'Sin título',
        authors: article.authorString || '',
        journal: article.journalTitle || '',
        year: article.pubYear || '',
        abstract: article.abstractText || '',
        has_pdf: article.hasPDF === 'Y',
        is_open_access: article.isOpenAccess === 'Y',
        pdf_status: (article.hasPDF === 'Y' && article.isOpenAccess === 'Y')
          ? 'pdf_available'
          : article.isOpenAccess === 'Y'
            ? 'abstract_only'
            : 'no_access',
        europepmc_url: `https://europepmc.org/article/${article.source}/${article.id}`
      }))

      return new Response(
        JSON.stringify({ articles }),
        { headers: corsHeaders }
      )
    }

    if (action === 'download_pdf') {
      const pdfUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${source}/${europepmc_id}/fullTextPDF`
      console.log('Downloading PDF:', pdfUrl)

      const pdfRes = await fetch(pdfUrl, {
        headers: {
          'User-Agent': 'Psicoasist/1.0',
          'Accept': 'application/pdf'
        }
      })

      if (!pdfRes.ok) {
        return new Response(
          JSON.stringify({ success: false, error: `PDF error: ${pdfRes.status}` }),
          { headers: corsHeaders }
        )
      }

      const buffer = await pdfRes.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const base64 = btoa(binary)

      return new Response(
        JSON.stringify({ success: true, pdf_base64: base64, source_url: pdfUrl }),
        { headers: corsHeaders }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { headers: corsHeaders }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error), articles: [] }),
      { headers: corsHeaders }
    )
  }
})
