// Duplicate-document detection helpers.
// Title match is exact (case-insensitive, trimmed). URL match is exact string.
import { supabase } from "@/integrations/supabase/client";

export interface DuplicateDoc {
  id: string;
  title: string;
  created_at: string;
  source_url: string | null;
  storage_path: string | null;
  is_global: boolean;
  psychologist_id: string;
}

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase();
}

/** Find an existing document whose title matches `title` (case-insensitive)
 *  among the current user's docs OR global docs. Returns the most recent. */
export async function findDuplicateByTitle(title: string): Promise<DuplicateDoc | null> {
  const t = normalizeTitle(title);
  if (!t) return null;
  // ilike with the exact normalized title; RLS already restricts to own + global.
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, created_at, source_url, storage_path, is_global, psychologist_id")
    .ilike("title", t)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[duplicates] title lookup failed:", error.message);
    return null;
  }
  const row = (data ?? [])[0];
  return row ? (row as DuplicateDoc) : null;
}

/** Find an existing document whose `source_url` matches the given URL exactly. */
export async function findDuplicateByUrl(url: string): Promise<DuplicateDoc | null> {
  const u = url.trim();
  if (!u) return null;
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, created_at, source_url, storage_path, is_global, psychologist_id")
    .eq("source_url", u)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[duplicates] url lookup failed:", error.message);
    return null;
  }
  const row = (data ?? [])[0];
  return row ? (row as DuplicateDoc) : null;
}

/** Delete a document, its chunks (cascade via chunk RLS owner) and its storage file. */
export async function deleteDocumentAndChunks(doc: DuplicateDoc): Promise<void> {
  // Chunks first (so we don't leave orphans if RLS blocks the doc delete).
  const { error: chunkErr } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", doc.id);
  if (chunkErr) throw new Error(`No se pudieron borrar los fragmentos: ${chunkErr.message}`);

  if (doc.storage_path) {
    const { error: stErr } = await supabase.storage.from("documents").remove([doc.storage_path]);
    if (stErr) console.warn("[duplicates] storage remove failed:", stErr.message);
  }
  const { error: docErr } = await supabase.from("documents").delete().eq("id", doc.id);
  if (docErr) throw new Error(`No se pudo borrar el documento existente: ${docErr.message}`);
}

/** Suggest a non-conflicting title by appending " (n)" until no duplicate exists. */
export async function nextAvailableTitle(baseTitle: string): Promise<string> {
  const base = baseTitle.trim() || "Documento";
  let n = 2;
  // Cap iterations to avoid runaway loops.
  for (let i = 0; i < 50; i++) {
    const candidate = `${base} (${n})`;
    const dup = await findDuplicateByTitle(candidate);
    if (!dup) return candidate;
    n++;
  }
  return `${base} (${Date.now()})`;
}

export function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
