// PDF text extraction using pdfjs-dist + chunking helpers
import * as pdfjs from "pdfjs-dist";
// @ts-ignore - vite worker import
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfMetadata {
  title?: string;
  author?: string;
  year?: string;
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it: any) => it.str).join(" ");
    text += pageText + "\n\n";
  }
  return text;
}

/** Extract text and built-in metadata from a PDF in one pass. */
export async function extractPdfTextAndMeta(file: File): Promise<{ text: string; meta: PdfMetadata }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => it.str).join(" ") + "\n\n";
  }
  const meta: PdfMetadata = {};
  try {
    const md: any = await pdf.getMetadata();
    const info = md?.info ?? {};
    if (info.Title && typeof info.Title === "string") meta.title = info.Title.trim();
    if (info.Author && typeof info.Author === "string") meta.author = info.Author.trim();
    const dateStr: string | undefined = info.CreationDate || info.ModDate;
    // PDF dates often look like "D:20210315120000Z"
    const yearMatch = dateStr?.match(/(\d{4})/);
    if (yearMatch) meta.year = yearMatch[1];
  } catch (e) {
    console.warn("[pdf] could not read metadata", e);
  }
  return { text, meta };
}

export async function extractTxtText(file: File): Promise<string> {
  return await file.text();
}

export interface Chunk {
  index: number;
  content: string;
  page_number: number;
}

/** Split into ~500-word chunks with 50-word overlap. Estimate 400 words/page. */
export function chunkText(text: string, chunkSize = 500, overlap = 50): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const slice = words.slice(start, end).join(" ");
    const midWord = start + Math.floor((end - start) / 2);
    const page = Math.max(1, Math.floor(midWord / 400) + 1);
    chunks.push({ index: idx++, content: slice, page_number: page });
    if (end === words.length) break;
    start = end - overlap;
  }
  return chunks;
}
