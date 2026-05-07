// Server-side fetch of a remote document (PDF or HTML), extract text, and
// return suggested metadata. Avoids browser CORS limitations.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB hard cap
const MIN_TEXT_CHARS = 500;

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(html: string): string {
  // Remove script/style/nav/header/footer/aside blocks entirely
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  // Prefer <article> or <main> if present
  const articleMatch = s.match(/<article[\s\S]*?<\/article>/i);
  const mainMatch = s.match(/<main[\s\S]*?<\/main>/i);
  if (articleMatch) s = articleMatch[0];
  else if (mainMatch) s = mainMatch[0];

  // Strip tags
  s = s.replace(/<[^>]+>/g, " ");

  // Decode common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function extractHtmlTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1].trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1]) return t[1].replace(/\s+/g, " ").trim();
  return "";
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // unpdf is Deno-compatible (no native canvas dependency).
  const { extractText } = await import("https://esm.sh/unpdf@0.12.1");
  const { text } = await extractText(bytes, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function aiMetadata(snippet: string): Promise<{ title: string; author: string; year: string; document_type: string }> {
  const empty = { title: "", author: "", year: "", document_type: "articulo_cientifico" };
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return empty;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Extraes metadatos bibliográficos de fragmentos iniciales de documentos. Devuelve cadenas vacías si no estás seguro." },
          { role: "user", content: `Extrae título, autor(es), año y clasifica el tipo del documento.\n\n---\n${snippet.slice(0, 1000)}\n---` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_metadata",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string" },
                author: { type: "string" },
                year: { type: "string" },
                document_type: {
                  type: "string",
                  enum: ["articulo_cientifico", "guia_clinica", "manual_diagnostico", "libro_academico", "codigo_etico", "informe_consenso", "otro"],
                },
              },
              required: ["title", "author", "year", "document_type"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_metadata" } },
      }),
    });
    if (!resp.ok) return empty;
    const data = await resp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return empty;
    return { ...empty, ...JSON.parse(args) };
  } catch (e) {
    console.warn("[fetch-url-document] aiMetadata failed:", e);
    return empty;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") return jsonResp({ error: "url is required" }, 400);

    let parsed: URL;
    try { parsed = new URL(url); } catch { return jsonResp({ error: "URL inválida" }, 400); }
    if (!/^https?:$/.test(parsed.protocol)) return jsonResp({ error: "Solo se admiten URLs http(s)" }, 400);

    let resp: Response;
    try {
      const urlLower = parsed.toString().toLowerCase();
      const isPmc = urlLower.includes("pmc.ncbi.nlm.nih.gov") || urlLower.includes("ncbi.nlm.nih.gov") || urlLower.includes("europepmc.org");
      const browserHeaders: Record<string, string> = isPmc ? {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://pmc.ncbi.nlm.nih.gov/",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      } : {
        "User-Agent": "Mozilla/5.0 (compatible; Melfi/1.0)",
        "Accept": "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
      };
      console.log("[fetch-url-document] Fetching URL:", parsed.toString(), "isPmc:", isPmc);
      resp = await fetch(parsed.toString(), { redirect: "follow", headers: browserHeaders });
      console.log("[fetch-url-document] Response status:", resp.status, "final URL:", resp.url);
      console.log("[fetch-url-document] Response headers:", JSON.stringify(Object.fromEntries(resp.headers.entries())));
    } catch (e: any) {
      console.error("[fetch-url-document] fetch threw:", e?.message ?? e);
      return jsonResp({ error: `No se pudo descargar: ${e?.message ?? e}` }, 502);
    }

    if (!resp.ok) {
      const bodyPreview = await resp.text().catch(() => "");
      console.error("[fetch-url-document] non-OK", resp.status, bodyPreview.slice(0, 200));
      if (resp.status === 403 || resp.status === 401 || resp.status === 404) {
        return jsonResp({ error: `URL no accesible (HTTP ${resp.status}) — el sitio puede requerir autenticación` }, 200);
      }
      return jsonResp({ error: `HTTP ${resp.status} al descargar` }, 200);
    }

    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    console.log("[fetch-url-document] Content-Type:", contentType);
    const buf = new Uint8Array(await resp.arrayBuffer());
    console.log("[fetch-url-document] Bytes received:", buf.byteLength);
    if (buf.byteLength > MAX_BYTES) return jsonResp({ error: "Archivo demasiado grande (>30MB)" }, 200);

    const looksPdfMagic = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
    const urlLowerForCheck = parsed.toString().toLowerCase();
    const looksPdf =
      contentType.includes("pdf") ||
      contentType.includes("octet-stream") ||
      urlLowerForCheck.endsWith(".pdf") ||
      urlLowerForCheck.includes("/pdf/") ||
      looksPdfMagic;
    const looksHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");

    if (!looksPdf && !looksHtml) {
      const preview = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, 200));
      console.error("[fetch-url-document] Unknown format, first 200 bytes:", preview);
    }

    let text = "";
    let suggestedTitle = "";
    let kind: "pdf" | "html" = "pdf";

    if (looksPdf) {
      kind = "pdf";
      try {
        text = await extractPdfText(buf);
      } catch (e: any) {
        console.error("[fetch-url-document] pdf extract failed:", e);
        return jsonResp({ error: "No se pudo leer el PDF" }, 200);
      }
    } else if (looksHtml) {
      kind = "html";
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      suggestedTitle = extractHtmlTitle(html);
      text = stripHtml(html);
    } else {
      return jsonResp({ error: "Formato no compatible" }, 200);
    }

    text = text.replace(/\s+/g, " ").trim();
    if (text.length < MIN_TEXT_CHARS) {
      return jsonResp({ error: "Contenido insuficiente para indexar" }, 200);
    }

    const meta = await aiMetadata(text);
    if (!meta.title && suggestedTitle) meta.title = suggestedTitle;
    if (!meta.title) {
      // Fallback: derive from URL
      const last = parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
      meta.title = decodeURIComponent(last).replace(/\.(pdf|html?)$/i, "").slice(0, 200);
    }

    return jsonResp({
      ok: true,
      kind,
      text,
      title: meta.title,
      author: meta.author,
      year: meta.year,
      document_type: meta.document_type,
      source_url: parsed.toString(),
    });
  } catch (e: any) {
    console.error("[fetch-url-document] error:", e);
    return jsonResp({ error: e?.message ?? String(e) }, 500);
  }
});
