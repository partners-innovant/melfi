import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Database, Search, Eye, Trash2, Pencil, AlertTriangle, ChevronLeft, ChevronRight,
  Check, X, Plus, FileText, Sparkles, Loader2, RotateCw, ScanEye,
} from "lucide-react";
import { extractPdfText, extractTxtText, chunkText, renderPdfPagesToBase64 } from "@/lib/pdf";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@/lib/clinical";
import {
  CLINICAL_AREAS_NICE, CLINICAL_AREAS_TRANSVERSAL, MAX_CLINICAL_AREAS,
  clinicalAreaLabel, clinicalAreaColor,
  SOURCE_INSTITUTIONS, sourceIconFor, type SourceInstitutionType,
  SOURCE_INSTITUTION_TYPE_LABELS, shortInstitutionName,
} from "@/lib/clinical-areas";

type LangCode = "es" | "en" | "otro";
const LANG_LABELS: Record<LangCode, string> = { es: "Español", en: "Inglés", otro: "Otro" };
const ANY = "__any__";
const PAGE_SIZE = 200;

interface DocRow {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  document_type: DocType;
  clinical_areas: string[];
  source_institution: string | null;
  source_institution_type: string | null;
  language: string | null;
  is_global: boolean;
  import_source: string | null;
  storage_path: string | null;
  source_url: string | null;
  created_at: string;
  chunk_count: number;
  processing_mode: "text" | "vision" | null;
}

export default function AdminDocuments() {
  const { profile, loading: authLoading } = useAuth();

  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>(ANY);
  const [filterArea, setFilterArea] = useState<string>(ANY);
  const [filterSource, setFilterSource] = useState<string>(ANY);
  const [filterLang, setFilterLang] = useState<string>(ANY);
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(false);
  // Snapshot-based "Sin chunks" filter — only updates when user clicks the button
  const [noChunksSnapshot, setNoChunksSnapshot] = useState<Set<string> | null>(null);
  const [noChunksSearchAt, setNoChunksSearchAt] = useState<Date | null>(null);
  const [, setNowTick] = useState(0);

  // Reprocessing
  const [reprocessing, setReprocessing] = useState<Set<string>>(new Set());
  const [reprocessErrors, setReprocessErrors] = useState<Record<string, string>>({});
  // Recently processed (for green flash + "Procesado" label). Map id -> timestamp ms
  const [recentlyProcessed, setRecentlyProcessed] = useState<Record<string, number>>({});
  // Bulk progress
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // Vision reprocessing
  const [visionProgress, setVisionProgress] = useState<Record<string, { current: number; total: number }>>({});
  const [confirmVision, setConfirmVision] = useState<DocRow | null>(null);
  const [confirmVisionBulk, setConfirmVisionBulk] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);

  // Dialogs
  const [viewDoc, setViewDoc] = useState<DocRow | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocRow | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Bulk dialogs
  const [bulkAreaOpen, setBulkAreaOpen] = useState(false);
  const [bulkSourceOpen, setBulkSourceOpen] = useState(false);
  const [bulkTypeOpen, setBulkTypeOpen] = useState(false);
  const [bulkAreas, setBulkAreas] = useState<string[]>([]);
  const [bulkSource, setBulkSource] = useState<string>("");
  const [bulkType, setBulkType] = useState<DocType>("otro");

  // Auto-classify
  type ClassifyStatus = "pending" | "processing" | "done" | "error";
  interface ClassifyJob { id: string; title: string; status: ClassifyStatus; error?: string }
  const [confirmClassifyOpen, setConfirmClassifyOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyJobs, setClassifyJobs] = useState<ClassifyJob[]>([]);
  const [classifyRunning, setClassifyRunning] = useState(false);
  const [singleClassifyId, setSingleClassifyId] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.is_admin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.is_admin]);

  // Tick every 30s so "hace X min" stays fresh
  useEffect(() => {
    if (!noChunksSearchAt) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [noChunksSearchAt]);

  // Auto-clear "recently processed" highlight after 3s
  useEffect(() => {
    const ids = Object.keys(recentlyProcessed);
    if (ids.length === 0) return;
    const timers = ids.map((id) => {
      const elapsed = Date.now() - recentlyProcessed[id];
      const remaining = Math.max(0, 3000 - elapsed);
      return setTimeout(() => {
        setRecentlyProcessed((prev) => {
          if (!(id in prev)) return prev;
          const n = { ...prev };
          delete n[id];
          return n;
        });
      }, remaining);
    });
    return () => timers.forEach(clearTimeout);
  }, [recentlyProcessed]);

  function formatRelative(d: Date): string {
    const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (sec < 60) return "hace unos segundos";
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    return d.toLocaleString("es-CL");
  }

  function runNoChunksSearch() {
    const ids = new Set(rows.filter((r) => r.chunk_count === 0).map((r) => r.id));
    setNoChunksSnapshot(ids);
    setNoChunksSearchAt(new Date());
    setPage(1);
    if (ids.size === 0) {
      toast.success("No hay documentos sin chunks 🎉");
    } else {
      toast.info(`${ids.size} documento(s) sin chunks`);
    }
  }


  async function load() {
    setLoading(true);
    // Pull all global documents
    const { data: docs, error } = await supabase
      .from("documents")
      .select("id,title,author,year,document_type,clinical_areas,source_institution,source_institution_type,language,is_global,import_source,storage_path,source_url,created_at,processing_mode")
      .eq("is_global", true)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Error cargando documentos");
      setLoading(false);
      return;
    }

    // Fetch chunk counts in batch
    const ids = (docs ?? []).map((d) => d.id);
    const counts: Record<string, number> = {};
    if (ids.length) {
      // Run in parallel chunks of 100 ids each to keep queries small
      await Promise.all(
        chunk(ids, 100).map(async (batch) => {
          const { data } = await supabase
            .from("document_chunks")
            .select("document_id")
            .in("document_id", batch);
          for (const r of data ?? []) {
            counts[r.document_id] = (counts[r.document_id] ?? 0) + 1;
          }
        }),
      );
    }

    setRows(
      (docs ?? []).map((d) => ({
        ...(d as any),
        clinical_areas: (d.clinical_areas as string[]) ?? [],
        chunk_count: counts[d.id] ?? 0,
      })),
    );
    setLoading(false);
  }

  // Filtering
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (q) {
        const hay = `${d.title} ${d.author ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterType !== ANY && d.document_type !== filterType) return false;
      if (filterArea !== ANY && !d.clinical_areas.includes(filterArea)) return false;
      if (filterSource !== ANY && d.source_institution !== filterSource) return false;
      if (filterLang !== ANY && (d.language ?? "") !== filterLang) return false;
      if (unclassifiedOnly && d.clinical_areas.length > 0 && !!d.document_type) return false;
      if (noChunksSnapshot && !noChunksSnapshot.has(d.id)) return false;
      return true;
    });
  }, [rows, search, filterType, filterArea, filterSource, filterLang, unclassifiedOnly, noChunksSnapshot]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // Stats
  const stats = useMemo(() => {
    const total = rows.length;
    const noArea = rows.filter((d) => d.clinical_areas.length === 0).length;
    const noSource = rows.filter((d) => !d.source_institution).length;
    const totalChunks = rows.reduce((sum, d) => sum + d.chunk_count, 0);
    return { total, noArea, noSource, totalChunks };
  }, [rows]);

  // Auth gates (after hooks)
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!profile?.is_admin) return <Navigate to="/" replace />;

  // ---- Mutations (auto-save) ----
  async function updateField(id: string, patch: Partial<DocRow>) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("documents").update(patch as any).eq("id", id);
    if (error) {
      setRows(prev);
      toast.error("No se pudo guardar");
      return false;
    }
    toast.success("✓ Guardado");
    return true;
  }

  async function updateClinicalAreas(id: string, areas: string[]) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, clinical_areas: areas } : r)));
    const { error } = await supabase
      .from("documents")
      .update({ clinical_areas: areas })
      .eq("id", id);
    if (error) {
      setRows(prev);
      toast.error("No se pudo guardar");
      return;
    }
    // Cascade to chunks
    const { error: chunkErr } = await supabase
      .from("document_chunks")
      .update({ clinical_areas: areas })
      .eq("document_id", id);
    if (chunkErr) {
      toast.warning("Documento guardado, error al actualizar chunks");
    } else {
      toast.success("✓ Guardado");
    }
  }

  async function deleteDoc(d: DocRow) {
    // Delete chunks first
    await supabase.from("document_chunks").delete().eq("document_id", d.id);
    if (d.storage_path) {
      await supabase.storage.from("documents").remove([d.storage_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", d.id);
    if (error) {
      toast.error("Error al eliminar");
      return;
    }
    setRows((rs) => rs.filter((r) => r.id !== d.id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(d.id);
      return n;
    });
    toast.success("Documento eliminado");
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    const { data: docs } = await supabase
      .from("documents")
      .select("id,storage_path")
      .in("id", ids);
    await supabase.from("document_chunks").delete().in("document_id", ids);
    const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("documents").remove(paths);
    const { error } = await supabase.from("documents").delete().in("id", ids);
    if (error) {
      toast.error("Error eliminando");
      return;
    }
    setRows((rs) => rs.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
    toast.success(`${ids.length} documento(s) eliminado(s)`);
    setConfirmBulkDelete(false);
  }

  async function applyBulkAreas() {
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("documents")
      .update({ clinical_areas: bulkAreas })
      .in("id", ids);
    if (error) { toast.error("Error al aplicar"); return; }
    await supabase
      .from("document_chunks")
      .update({ clinical_areas: bulkAreas })
      .in("document_id", ids);
    setRows((rs) => rs.map((r) => selected.has(r.id) ? { ...r, clinical_areas: bulkAreas } : r));
    toast.success(`Áreas aplicadas a ${ids.length} documento(s)`);
    setBulkAreaOpen(false);
    setBulkAreas([]);
  }

  async function applyBulkSource() {
    const ids = Array.from(selected);
    const match = SOURCE_INSTITUTIONS.find((s) => s.name === bulkSource);
    const patch: any = {
      source_institution: bulkSource || null,
      source_institution_type: (match?.type ?? null) as SourceInstitutionType | null,
    };
    const { error } = await supabase.from("documents").update(patch).in("id", ids);
    if (error) { toast.error("Error al aplicar"); return; }
    await supabase.from("document_chunks").update(patch).in("document_id", ids);
    setRows((rs) => rs.map((r) => selected.has(r.id) ? { ...r, ...patch } : r));
    toast.success(`Fuente aplicada a ${ids.length} documento(s)`);
    setBulkSourceOpen(false);
    setBulkSource("");
  }

  async function applyBulkType() {
    const ids = Array.from(selected);
    const { error } = await supabase
      .from("documents")
      .update({ document_type: bulkType })
      .in("id", ids);
    if (error) { toast.error("Error al aplicar"); return; }
    await supabase.from("document_chunks").update({ document_type: bulkType }).in("document_id", ids);
    setRows((rs) => rs.map((r) => selected.has(r.id) ? { ...r, document_type: bulkType } : r));
    toast.success(`Tipo aplicado a ${ids.length} documento(s)`);
    setBulkTypeOpen(false);
  }

  // ---- Auto-classification ----
  function normalizeLanguage(v: unknown): "es" | "en" | "otro" | null {
    if (typeof v !== "string") return null;
    const s = v.trim().toLowerCase();
    if (s === "es" || s.startsWith("espa")) return "es";
    if (s === "en" || s.startsWith("ing") || s.startsWith("eng")) return "en";
    if (s === "otro" || s === "other") return "otro";
    return null;
  }

  async function classifyOne(doc: DocRow): Promise<void> {
    const { data: chunkRows } = await supabase
      .from("document_chunks")
      .select("content")
      .eq("document_id", doc.id)
      .order("chunk_index", { ascending: true })
      .limit(1);
    const fragment = (chunkRows?.[0]?.content ?? "").toString().slice(0, 1000);
    const text = `Title: ${doc.title}\nContent fragment: ${fragment}`;

    const { data: ai, error } = await supabase.functions.invoke("extract-metadata", { body: { text } });
    if (error) throw new Error(error.message ?? "Error de IA");
    if (ai?.error) throw new Error(ai.error);

    const patch: Record<string, unknown> = {};
    if (!doc.title?.trim() && typeof ai.title === "string" && ai.title.trim()) patch.title = ai.title.trim();
    if (!doc.author && typeof ai.author === "string" && ai.author.trim()) patch.author = ai.author.trim();
    if (!doc.year && ai.year != null && String(ai.year).trim()) patch.year = String(ai.year).trim();
    if ((!doc.document_type || doc.document_type === ("otro" as DocType)) &&
        typeof ai.document_type === "string" &&
        (DOC_TYPES as readonly string[]).includes(ai.document_type)) {
      patch.document_type = ai.document_type;
    }
    if ((!doc.clinical_areas || doc.clinical_areas.length === 0) &&
        Array.isArray(ai.clinical_areas) && ai.clinical_areas.length > 0) {
      patch.clinical_areas = (ai.clinical_areas as string[]).slice(0, MAX_CLINICAL_AREAS);
    }
    if (!doc.source_institution && typeof ai.source_institution === "string" && ai.source_institution.trim()) {
      patch.source_institution = ai.source_institution.trim();
      if (typeof ai.source_institution_type === "string" && ai.source_institution_type) {
        patch.source_institution_type = ai.source_institution_type;
      }
    }
    if (!doc.language) {
      const lang = normalizeLanguage(ai.language);
      if (lang) patch.language = lang;
    }

    if (Object.keys(patch).length === 0) return;

    const { error: upErr } = await supabase.from("documents").update(patch as any).eq("id", doc.id);
    if (upErr) throw new Error(upErr.message);

    const chunkPatch: Record<string, unknown> = {};
    if (patch.clinical_areas) chunkPatch.clinical_areas = patch.clinical_areas;
    if (patch.source_institution) chunkPatch.source_institution = patch.source_institution;
    if (patch.source_institution_type) chunkPatch.source_institution_type = patch.source_institution_type;
    if (patch.document_type) chunkPatch.document_type = patch.document_type;
    if (patch.language) chunkPatch.language = patch.language;
    if (Object.keys(chunkPatch).length > 0) {
      await supabase.from("document_chunks").update(chunkPatch as any).eq("document_id", doc.id);
    }

    setRows((rs) => rs.map((r) => (r.id === doc.id ? { ...r, ...(patch as Partial<DocRow>) } : r)));
  }

  async function runBulkClassify() {
    const ids = Array.from(selected);
    const docs = rows.filter((r) => ids.includes(r.id));
    setClassifyJobs(docs.map((d) => ({ id: d.id, title: d.title, status: "pending" })));
    setConfirmClassifyOpen(false);
    setClassifyOpen(true);
    setClassifyRunning(true);
    for (const d of docs) {
      setClassifyJobs((js) => js.map((j) => (j.id === d.id ? { ...j, status: "processing" } : j)));
      try {
        await classifyOne(d);
        setClassifyJobs((js) => js.map((j) => (j.id === d.id ? { ...j, status: "done" } : j)));
      } catch (e: any) {
        setClassifyJobs((js) =>
          js.map((j) => (j.id === d.id ? { ...j, status: "error", error: e?.message ?? "Error" } : j)),
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setClassifyRunning(false);
  }

  async function classifySingle(d: DocRow) {
    setSingleClassifyId(d.id);
    const tid = toast.loading("✨ Clasificando...");
    try {
      await classifyOne(d);
      toast.success("✅ Clasificado", { id: tid });
    } catch (e: any) {
      toast.error(`Error: ${e?.message ?? "no se pudo clasificar"}`, { id: tid });
    } finally {
      setSingleClassifyId(null);
    }
  }

  async function reprocessDoc(d: DocRow): Promise<{ ok: boolean; count?: number; error?: string }> {
    if (!d.storage_path) return { ok: false, error: "El documento no tiene archivo en storage" };
    setReprocessing((s) => { const n = new Set(s); n.add(d.id); return n; });
    setReprocessErrors((e) => { const n = { ...e }; delete n[d.id]; return n; });
    try {
      // Download file
      const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(d.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "No se pudo descargar el archivo");

      // Extract text
      const lower = d.storage_path.toLowerCase();
      const isPdf = lower.endsWith(".pdf") || blob.type === "application/pdf";
      const file = new File([blob], d.storage_path.split("/").pop() ?? "doc", { type: blob.type });
      const text = isPdf ? await extractPdfText(file) : await extractTxtText(file);
      if (!text.trim()) throw new Error("No se pudo extraer texto del archivo");

      const chunks = chunkText(text);
      if (chunks.length === 0) throw new Error("No se generaron fragmentos");

      // Clear any existing chunks for this document first
      await supabase.from("document_chunks").delete().eq("document_id", d.id);

      // Embed in batches and insert
      const batchSize = 8;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
          body: { input: batch.map((c) => c.content), input_type: "document" },
        });
        if (embErr) throw embErr;
        if (embData?.error) throw new Error(embData.error);
        const embeddings: number[][] = embData.embeddings;
        const insertRows = batch.map((c, idx) => ({
          document_id: d.id,
          psychologist_id: profile!.id,
          chunk_index: c.index,
          content: c.content,
          page_number: c.page_number,
          embedding: embeddings[idx] as any,
          clinical_areas: d.clinical_areas ?? [],
          source_institution: d.source_institution ?? null,
          source_institution_type: d.source_institution_type ?? null,
          document_type: d.document_type,
          is_global: d.is_global,
        }));
        const { error: insErr } = await supabase.from("document_chunks").insert(insertRows);
        if (insErr) throw insErr;
      }

      setRows((rs) => rs.map((r) => (r.id === d.id ? { ...r, chunk_count: chunks.length } : r)));
      setRecentlyProcessed((p) => ({ ...p, [d.id]: Date.now() }));
      return { ok: true, count: chunks.length };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setReprocessErrors((er) => ({ ...er, [d.id]: msg }));
      return { ok: false, error: msg };
    } finally {
      setReprocessing((s) => { const n = new Set(s); n.delete(d.id); return n; });
    }
  }

  async function reprocessSingle(d: DocRow) {
    const tid = toast.loading(`↻ Re-procesando "${d.title}"...`);
    const res = await reprocessDoc(d);
    if (res.ok) {
      toast.success(`✅ ${res.count} fragmentos indexados`, { id: tid });
    } else {
      toast.error(`❌ ${res.error}`, { id: tid });
    }
  }

  async function reprocessSelectedNoChunks() {
    const targets = rows.filter((r) => selected.has(r.id) && r.chunk_count === 0);
    if (targets.length === 0) {
      toast.info("Ningún documento seleccionado tiene 0 chunks");
      return;
    }
    let ok = 0;
    let fail = 0;
    setBulkProgress({ current: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length });
      const res = await reprocessDoc(targets[i]);
      if (res.ok) ok++; else fail++;
    }
    setBulkProgress(null);
    if (fail === 0) {
      toast.success(`✅ ${ok} documento(s) procesado(s)`);
    } else {
      toast.warning(`✅ ${ok} documentos procesados · ❌ ${fail} con error`);
    }
  }

  async function reprocessWithVision(d: DocRow): Promise<{ ok: boolean; count?: number; error?: string }> {
    if (!d.storage_path) return { ok: false, error: "El documento no tiene archivo en storage" };
    const lower = d.storage_path.toLowerCase();
    if (!(lower.endsWith(".pdf"))) {
      return { ok: false, error: "El procesamiento con visión solo soporta archivos PDF" };
    }
    setReprocessing((s) => { const n = new Set(s); n.add(d.id); return n; });
    setReprocessErrors((e) => { const n = { ...e }; delete n[d.id]; return n; });
    setVisionProgress((p) => ({ ...p, [d.id]: { current: 0, total: 0 } }));
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(d.storage_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "No se pudo descargar el archivo");

      const file = new File([blob], d.storage_path.split("/").pop() ?? "doc.pdf", {
        type: blob.type || "application/pdf",
      });

      // Render every page to base64 PNG
      const pages = await renderPdfPagesToBase64(file, {
        scale: 1.5,
        onProgress: (current, total) => {
          setVisionProgress((p) => ({ ...p, [d.id]: { current, total } }));
        },
      });
      if (pages.length === 0) throw new Error("PDF sin páginas");

      // Extract text per page using Claude vision (sequential to keep things controlled)
      const pageTexts: { content: string; page_number: number; index: number }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        setVisionProgress((vp) => ({ ...vp, [d.id]: { current: i + 1, total: pages.length } }));
        const { data: vData, error: vErr } = await supabase.functions.invoke("vision-extract-page", {
          body: {
            image_base64: p.base64,
            media_type: "image/png",
            page_number: p.pageNumber,
          },
        });
        if (vErr) throw vErr;
        if (vData?.error) throw new Error(vData.error);
        const text = String(vData?.text ?? "").trim();
        if (text) {
          pageTexts.push({ content: text, page_number: p.pageNumber, index: i });
        }
      }

      if (pageTexts.length === 0) throw new Error("Visión no extrajo contenido de ninguna página");

      // Replace existing chunks
      await supabase.from("document_chunks").delete().eq("document_id", d.id);

      // Embed via Voyage in batches and insert
      const batchSize = 8;
      for (let i = 0; i < pageTexts.length; i += batchSize) {
        const batch = pageTexts.slice(i, i + batchSize);
        const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
          body: { input: batch.map((c) => c.content), input_type: "document" },
        });
        if (embErr) throw embErr;
        if (embData?.error) throw new Error(embData.error);
        const embeddings: number[][] = embData.embeddings;
        const insertRows = batch.map((c, idx) => ({
          document_id: d.id,
          psychologist_id: profile!.id,
          chunk_index: c.index,
          content: c.content,
          page_number: c.page_number,
          embedding: embeddings[idx] as any,
          clinical_areas: d.clinical_areas ?? [],
          source_institution: d.source_institution ?? null,
          source_institution_type: d.source_institution_type ?? null,
          document_type: d.document_type,
          is_global: d.is_global,
        }));
        const { error: insErr } = await supabase.from("document_chunks").insert(insertRows);
        if (insErr) throw insErr;
      }

      // Mark document as vision-processed
      await supabase.from("documents").update({ processing_mode: "vision" } as any).eq("id", d.id);

      setRows((rs) => rs.map((r) =>
        r.id === d.id ? { ...r, chunk_count: pageTexts.length, processing_mode: "vision" } : r,
      ));
      setRecentlyProcessed((p) => ({ ...p, [d.id]: Date.now() }));
      return { ok: true, count: pageTexts.length };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setReprocessErrors((er) => ({ ...er, [d.id]: msg }));
      return { ok: false, error: msg };
    } finally {
      setReprocessing((s) => { const n = new Set(s); n.delete(d.id); return n; });
      setVisionProgress((p) => { const n = { ...p }; delete n[d.id]; return n; });
    }
  }

  async function reprocessVisionSingle(d: DocRow) {
    const tid = toast.loading(`🔍 Procesando "${d.title}" con visión...`);
    const res = await reprocessWithVision(d);
    if (res.ok) {
      toast.success(`✅ ${res.count} página(s) indexada(s) con visión`, { id: tid });
    } else {
      toast.error(`❌ ${res.error}`, { id: tid });
    }
  }

  async function reprocessVisionBulk() {
    const targets = rows.filter((r) => selected.has(r.id));
    if (targets.length === 0) return;
    let ok = 0;
    let fail = 0;
    setBulkProgress({ current: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length });
      const res = await reprocessWithVision(targets[i]);
      if (res.ok) ok++; else fail++;
    }
    setBulkProgress(null);
    if (fail === 0) {
      toast.success(`✅ ${ok} documento(s) procesado(s) con visión`);
    } else {
      toast.warning(`✅ ${ok} con visión · ❌ ${fail} con error`);
    }
  }


  async function openViewer(d: DocRow) {
    setViewDoc(d);
    if (d.storage_path) {
      const { data } = await supabase.storage.from("documents").createSignedUrl(d.storage_path, 60 * 10);
      setViewUrl(data?.signedUrl ?? null);
    } else if (d.source_url) {
      setViewUrl(d.source_url);
    } else {
      setViewUrl(null);
    }
  }

  // Selection helpers
  const allOnPageSelected = paged.length > 0 && paged.every((r) => selected.has(r.id));
  function toggleAllOnPage(v: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const r of paged) v ? n.add(r.id) : n.delete(r.id);
      return n;
    });
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          Gestor de documentos globales
        </h1>
        <p className="text-sm text-muted-foreground">
          Administra y etiqueta todos los documentos de la biblioteca global.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total documentos globales" value={stats.total} />
        <StatCard label="Sin área clínica" value={stats.noArea} warn={stats.noArea > 0} />
        <StatCard label="Sin fuente asignada" value={stats.noSource} warn={stats.noSource > 0} />
        <StatCard label="Total chunks indexados" value={stats.totalChunks} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título o autor..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 w-[260px]"
          />
        </div>
        <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos los tipos</SelectItem>
            {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterArea} onValueChange={(v) => { setFilterArea(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Área clínica" /></SelectTrigger>
          <SelectContent className="max-h-[400px]">
            <SelectItem value={ANY}>Todas las áreas</SelectItem>
            {[...CLINICAL_AREAS_NICE, ...CLINICAL_AREAS_TRANSVERSAL].map((a) => (
              <SelectItem key={a} value={a}>{clinicalAreaLabel(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={(v) => { setFilterSource(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Fuente" /></SelectTrigger>
          <SelectContent className="max-h-[400px]">
            <SelectItem value={ANY}>Todas las fuentes</SelectItem>
            {SOURCE_INSTITUTIONS.map((s) => (
              <SelectItem key={s.name} value={s.name}>{s.icon} {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterLang} onValueChange={(v) => { setFilterLang(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Idioma" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos los idiomas</SelectItem>
            <SelectItem value="es">Español</SelectItem>
            <SelectItem value="en">Inglés</SelectItem>
            <SelectItem value="otro">Otro</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm ml-2">
          <Checkbox
            checked={unclassifiedOnly}
            onCheckedChange={(v) => { setUnclassifiedOnly(!!v); setPage(1); }}
          />
          Sin clasificar
        </label>
        <div className="flex flex-col gap-1 ml-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={noChunksSnapshot ? "default" : "outline"}
              onClick={runNoChunksSearch}
            >
              <Search className="h-3.5 w-3.5 mr-1" />
              {noChunksSnapshot ? "Actualizar búsqueda sin chunks" : "Buscar documentos sin chunks"}
            </Button>
            {noChunksSnapshot && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setNoChunksSnapshot(null); setNoChunksSearchAt(null); setPage(1); }}
                title="Limpiar filtro"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {noChunksSearchAt && (
            <span className="text-[11px] text-muted-foreground">
              Última búsqueda: {formatRelative(noChunksSearchAt)} · {noChunksSnapshot?.size ?? 0} resultado(s)
            </span>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-primary/5">
          <span className="text-sm font-medium">{selected.size} documento(s) seleccionado(s)</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => { setBulkAreas([]); setBulkAreaOpen(true); }}>
            Asignar área clínica
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setBulkSource(""); setBulkSourceOpen(true); }}>
            Asignar fuente
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setBulkType("otro"); setBulkTypeOpen(true); }}>
            Asignar tipo
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmClassifyOpen(true)}>
            <Sparkles className="h-4 w-4 mr-1 text-primary" /> Auto-clasificar seleccionados
          </Button>
          <Button size="sm" variant="outline" onClick={reprocessSelectedNoChunks} disabled={!!bulkProgress}>
            {bulkProgress ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Procesando {bulkProgress.current} de {bulkProgress.total}...</>
            ) : (
              <><RotateCw className="h-4 w-4 mr-1" /> Re-procesar documentos sin chunks</>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmVisionBulk(true)}
            disabled={!!bulkProgress}
            className="border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
          >
            <ScanEye className="h-4 w-4 mr-1" /> Re-procesar seleccionados con visión
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmBulkDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Eliminar seleccionados
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpiar</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allOnPageSelected} onCheckedChange={(v) => toggleAllOnPage(!!v)} />
              </TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Autor</TableHead>
              <TableHead className="w-20">Año</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead style={{ width: "25%" }}>Área(s) clínica(s)</TableHead>
              <TableHead>Fuente</TableHead>
              <TableHead>Idioma</TableHead>
              <TableHead className="w-20 text-center">Chunks</TableHead>
              <TableHead className="w-24">Modo</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Subido</TableHead>
              <TableHead className="w-32">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
            ) : paged.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No hay documentos</TableCell></TableRow>
            ) : paged.map((d) => (
              <TableRow key={d.id} className={cn(
                selected.has(d.id) && "bg-primary/5",
                recentlyProcessed[d.id] && "bg-emerald-500/10 transition-colors duration-1000",
              )}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(d.id)}
                    onCheckedChange={(v) => {
                      setSelected((s) => {
                        const n = new Set(s);
                        v ? n.add(d.id) : n.delete(d.id);
                        return n;
                      });
                    }}
                  />
                </TableCell>
                <TableCell className="min-w-[220px] max-w-[320px]">
                  <InlineText value={d.title} onSave={(v) => updateField(d.id, { title: v })} />
                </TableCell>
                <TableCell className="min-w-[140px] max-w-[200px]">
                  <InlineText value={d.author ?? ""} placeholder="—" onSave={(v) => updateField(d.id, { author: v || null })} />
                </TableCell>
                <TableCell>
                  <InlineText
                    value={d.year ?? ""}
                    placeholder="—"
                    type="number"
                    onSave={(v) => updateField(d.id, { year: v || null })}
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    value={d.document_type}
                    options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] }))}
                    onSave={(v) => updateField(d.id, { document_type: v as DocType })}
                    renderValue={(v) => DOC_TYPE_LABELS[v as DocType] ?? "—"}
                  />
                </TableCell>
                <TableCell style={{ width: "25%" }} className="min-w-[260px]">
                  <InlineAreas value={d.clinical_areas} onSave={(v) => updateClinicalAreas(d.id, v)} />
                </TableCell>
                <TableCell className="min-w-[180px]">
                  <InlineSource
                    value={d.source_institution ?? ""}
                    onSave={(name) => {
                      const m = SOURCE_INSTITUTIONS.find((s) => s.name === name);
                      return updateField(d.id, {
                        source_institution: name || null,
                        source_institution_type: m?.type ?? null,
                      });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    value={d.language ?? ""}
                    options={[
                      { value: "es", label: "Español" },
                      { value: "en", label: "Inglés" },
                      { value: "otro", label: "Otro" },
                    ]}
                    placeholder="—"
                    onSave={(v) => updateField(d.id, { language: v || null })}
                    renderValue={(v) => LANG_LABELS[v as LangCode] ?? "—"}
                  />
                </TableCell>
                <TableCell className="text-center text-sm tabular-nums">
                  {reprocessing.has(d.id) ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-[11px]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {visionProgress[d.id] && visionProgress[d.id].total > 0
                        ? <>🔍 {visionProgress[d.id].current} de {visionProgress[d.id].total}</>
                        : "…"}
                    </span>
                  ) : recentlyProcessed[d.id] && d.chunk_count > 0 ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        ✅ {d.chunk_count} fragmentos
                      </span>
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-0.5">
                        <Check className="h-3 w-3" /> Procesado
                      </span>
                    </div>
                  ) : d.chunk_count === 0 ? (
                    <TooltipProvider delayDuration={150}>
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-destructive font-semibold">0</span>
                        {reprocessErrors[d.id] ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => reprocessSingle(d)}
                                disabled={!d.storage_path}
                                className="text-[11px] text-destructive hover:underline inline-flex items-center gap-0.5"
                              >
                                <X className="h-3 w-3" /> Error
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[320px] text-xs">
                              {reprocessErrors[d.id]}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <button
                            type="button"
                            onClick={() => reprocessSingle(d)}
                            disabled={!d.storage_path}
                            title={d.storage_path ? "Re-procesar documento" : "Sin archivo en storage"}
                            className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 disabled:opacity-50 disabled:no-underline"
                          >
                            <RotateCw className="h-3 w-3" /> Re-procesar
                          </button>
                        )}
                      </div>
                    </TooltipProvider>
                  ) : (
                    d.chunk_count
                  )}
                </TableCell>
                <TableCell>
                  {d.processing_mode === "vision" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                      🔍 Visión
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                      ⚡ Texto
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">{d.import_source ?? "upload"}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(d.created_at).toLocaleDateString("es-CL")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      onClick={() => classifySingle(d)}
                      disabled={singleClassifyId === d.id}
                      title="Auto-clasificar"
                    >
                      {singleClassifyId === d.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Sparkles className="h-4 w-4 text-primary" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                      onClick={() => setConfirmVision(d)}
                      disabled={reprocessing.has(d.id) || !d.storage_path}
                      title="Re-procesar con OCR y visión"
                    >
                      {reprocessing.has(d.id) && visionProgress[d.id]
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <ScanEye className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openViewer(d)} title="Ver documento">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(d)} title="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Mostrando {paged.length} de {filtered.length} documento(s)
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">Página {pageSafe} de {totalPages}</span>
          <Button size="sm" variant="outline" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Viewer */}
      <Dialog open={!!viewDoc} onOpenChange={(o) => { if (!o) { setViewDoc(null); setViewUrl(null); } }}>
        <DialogContent className="w-[95vw] max-w-[1200px] h-[85vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-4 pb-2 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              {viewDoc?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 h-full bg-muted">
            {viewUrl ? (
              <iframe src={viewUrl} className="w-full h-full" title={viewDoc?.title} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No hay archivo disponible para este documento.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm single delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar documento</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{confirmDelete?.title}" y todos sus chunks indexados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDelete) { deleteDoc(confirmDelete); setConfirmDelete(null); } }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm bulk delete */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {selected.size} documento(s)</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán todos los documentos seleccionados y sus chunks. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={bulkDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm auto-classify */}
      <AlertDialog open={confirmClassifyOpen} onOpenChange={setConfirmClassifyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Auto-clasificar documentos
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se analizará el contenido de {selected.size} documento(s) seleccionado(s) y se completará
              automáticamente la información faltante (título, autor, año, tipo, área clínica, fuente e idioma).
              Los campos que ya tienen información no serán modificados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runBulkClassify}>Clasificar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Auto-classify progress */}
      <Dialog
        open={classifyOpen}
        onOpenChange={(o) => {
          if (!o && !classifyRunning) {
            setClassifyOpen(false);
            setClassifyJobs([]);
            setSelected(new Set());
            load();
          }
        }}
      >
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Auto-clasificación en curso
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const total = classifyJobs.length;
            const doneCount = classifyJobs.filter((j) => j.status === "done").length;
            const errCount = classifyJobs.filter((j) => j.status === "error").length;
            const processedCount = doneCount + errCount;
            const currentIndex = classifyRunning
              ? Math.min(processedCount + 1, total)
              : processedCount;
            const pct = total === 0 ? 0 : Math.round((processedCount / total) * 100);
            return (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {classifyRunning
                    ? `Procesando ${currentIndex} de ${total}...`
                    : `Completado: ${processedCount} de ${total}`}
                </div>
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="max-h-[320px] overflow-y-auto border rounded-md divide-y">
                  {classifyJobs.map((j) => (
                    <div key={j.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-shrink-0 w-5 text-center">
                        {j.status === "pending" && <span className="text-muted-foreground">·</span>}
                        {j.status === "processing" && <Loader2 className="h-4 w-4 animate-spin inline" />}
                        {j.status === "done" && <span>✅</span>}
                        {j.status === "error" && <span>❌</span>}
                      </span>
                      <span className="flex-1 truncate" title={j.title}>{j.title}</span>
                      {j.status === "error" && j.error && (
                        <span className="text-xs text-destructive truncate max-w-[180px]" title={j.error}>
                          {j.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {!classifyRunning && (
                  <div className="text-sm">
                    ✅ {doneCount} documento(s) clasificado(s) correctamente.
                    {errCount > 0 && <> ❌ {errCount} con errores.</>}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              disabled={classifyRunning}
              onClick={() => {
                setClassifyOpen(false);
                setClassifyJobs([]);
                setSelected(new Set());
                load();
              }}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk areas dialog */}
      <Dialog open={bulkAreaOpen} onOpenChange={setBulkAreaOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar área(s) clínica(s)</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Reemplaza las áreas en {selected.size} documento(s) y todos sus chunks.
          </p>
          <AreaPicker value={bulkAreas} onChange={setBulkAreas} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAreaOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkAreas}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk source dialog */}
      <Dialog open={bulkSourceOpen} onOpenChange={setBulkSourceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar fuente / institución</DialogTitle></DialogHeader>
          <Select value={bulkSource || undefined} onValueChange={setBulkSource}>
            <SelectTrigger><SelectValue placeholder="Selecciona una fuente" /></SelectTrigger>
            <SelectContent className="max-h-[400px]">
              {SOURCE_INSTITUTIONS.map((s) => (
                <SelectItem key={s.name} value={s.name}>{s.icon} {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSourceOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkSource} disabled={!bulkSource}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk type dialog */}
      <Dialog open={bulkTypeOpen} onOpenChange={setBulkTypeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar tipo de documento</DialogTitle></DialogHeader>
          <Select value={bulkType} onValueChange={(v) => setBulkType(v as DocType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTypeOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkType}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Sub-components ----------

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", warn && value > 0 && "border-amber-500/40")}>
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {warn && value > 0 && <AlertTriangle className="h-3 w-3 text-amber-500" />}
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function InlineText({
  value, onSave, placeholder, type = "text",
}: { value: string; onSave: (v: string) => Promise<boolean> | void; placeholder?: string; type?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft !== value) await onSave(draft);
          setEditing(false);
        }}
        onKeyDown={async (e) => {
          if (e.key === "Enter") {
            if (draft !== value) await onSave(draft);
            setEditing(false);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-8 text-sm"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1 text-left w-full text-sm hover:text-primary truncate"
    >
      <span className="truncate">{value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </button>
  );
}

function InlineSelect({
  value, options, onSave, renderValue, placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => Promise<boolean> | void;
  renderValue?: (v: string) => string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <Select
        defaultOpen
        value={value || undefined}
        onValueChange={async (v) => { await onSave(v); setOpen(false); }}
        onOpenChange={(o) => !o && setOpen(false)}
      >
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="group flex items-center gap-1 text-left w-full text-sm hover:text-primary truncate"
    >
      <span className="truncate">{value ? (renderValue ? renderValue(value) : value) : <span className="text-muted-foreground">{placeholder ?? "—"}</span>}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
    </button>
  );
}

function InlineAreas({ value, onSave }: { value: string[]; onSave: (v: string[]) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="group flex flex-wrap items-center gap-1 text-left w-full hover:text-primary min-h-[28px]">
          {value.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">Sin clasificar</span>
          ) : (
            value.map((a) => (
              <span key={a} className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border", clinicalAreaColor(a))}>
                {clinicalAreaLabel(a)}
              </span>
            ))
          )}
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <AreaPicker
          value={value}
          onChange={async (v) => { await onSave(v); }}
        />
      </PopoverContent>
    </Popover>
  );
}

function AreaPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function toggle(area: string) {
    if (value.includes(area)) {
      onChange(value.filter((a) => a !== area));
    } else {
      if (value.length >= MAX_CLINICAL_AREAS) {
        toast.warning(`Máximo ${MAX_CLINICAL_AREAS} áreas`);
        return;
      }
      onChange([...value, area]);
    }
  }
  return (
    <div className="max-h-[400px] overflow-y-auto">
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Categorías NICE</div>
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {CLINICAL_AREAS_NICE.map((a) => (
          <AreaChip key={a} area={a} active={value.includes(a)} onClick={() => toggle(a)} />
        ))}
      </div>
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-t">Categorías transversales</div>
      <div className="flex flex-wrap gap-1 px-3 pb-3">
        {CLINICAL_AREAS_TRANSVERSAL.map((a) => (
          <AreaChip key={a} area={a} active={value.includes(a)} onClick={() => toggle(a)} />
        ))}
      </div>
    </div>
  );
}

function AreaChip({ area, active, onClick }: { area: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors",
        active ? clinicalAreaColor(area) : "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
      )}
    >
      {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      {clinicalAreaLabel(area)}
    </button>
  );
}

function InlineSource({ value, onSave }: { value: string; onSave: (v: string) => void | Promise<boolean | void> }) {
  const [open, setOpen] = useState(false);
  const icon = sourceIconFor(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="group flex items-center gap-1 text-left w-full text-sm hover:text-primary truncate" title={value || undefined}>
          <span className="truncate">
            {value ? `${icon} ${shortInstitutionName(value)}` : <span className="text-muted-foreground">—</span>}
          </span>
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar fuente..." />
          <CommandList>
            <CommandEmpty>No encontrado</CommandEmpty>
            {value && (
              <CommandGroup heading="Acción">
                <CommandItem onSelect={async () => { await onSave(""); setOpen(false); }}>
                  <X className="h-4 w-4 mr-2" /> Quitar fuente
                </CommandItem>
              </CommandGroup>
            )}
            {Array.from(new Set(SOURCE_INSTITUTIONS.map((s) => s.group))).map((group) => (
              <CommandGroup key={group} heading={group}>
                {SOURCE_INSTITUTIONS.filter((s) => s.group === group).map((s) => (
                  <CommandItem key={s.name} value={s.name} onSelect={async () => { await onSave(s.name); setOpen(false); }}>
                    <span className="mr-2">{s.icon}</span>{s.name}
                    {value === s.name && <Check className="h-4 w-4 ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Utils ----------
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
