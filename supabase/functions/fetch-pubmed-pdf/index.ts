// Fetch a PMC article PDF. Returns base64-encoded PDF on success.
// Falls back to {ok: false} when the PDF cannot be retrieved.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function tryFetchPdf(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // Polite UA — NCBI requests one
        "User-Agent": "PsicoasistBot/1.0 (clinical research; mailto:support@psicoasist.com)",
        "Accept": "application/pdf,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    // Detect PDF magic bytes (%PDF)
    if (buf.length < 5 || buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      console.warn("Not a PDF response:", ct, buf.length, "bytes");
      return null;
    }
    return buf;
  } catch (e) {
    console.warn("PDF fetch failed:", url, e);
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  // chunked to avoid stack overflow for large files
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { pmc_id } = await req.json();
    if (!pmc_id || typeof pmc_id !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "pmc_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const id = pmc_id.replace(/^PMC/i, "");
    const candidates = [
      `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${id}/pdf/`,
      `https://europepmc.org/articles/PMC${id}?pdf=render`,
      `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${id}&blobtype=pdf`,
    ];
    for (const url of candidates) {
      const bytes = await tryFetchPdf(url);
      if (bytes) {
        return new Response(JSON.stringify({
          ok: true,
          base64: toBase64(bytes),
          size: bytes.length,
          source_url: url,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ ok: false, error: "PDF no disponible" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-pubmed-pdf error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
