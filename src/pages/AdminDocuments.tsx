import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Database, Search, Eye, Trash2, Pencil, AlertTriangle, ChevronLeft, ChevronRight,
  Check, X, Plus, FileText, Sparkles, Loader2, RotateCw, ScanEye, Calendar as CalendarIcon, Filter, ChevronsUpDown,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format as formatDateFn } from "date-fns";
import { extractPdfText, extractTxtText, chunkText, renderPdfPagesToBase64 } from "@/lib/pdf";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { DOC_TYPES, DOC_TYPE_LABELS, formatAuthor, type DocType } from "@/lib/clinical";
import {
  CLINICAL_AREAS_NICE, CLINICAL_AREAS_TRANSVERSAL, MAX_CLINICAL_AREAS,
  clinicalAreaLabel, clinicalAreaColor,
  SOURCE_INSTITUTIONS, sourceIconFor, type SourceInstitutionType,
  SOURCE_INSTITUTION_TYPE_LABELS, shortInstitutionName,
} from "@/lib/clinical-areas";
import { ClassifyPreviewDialog, type ClassifyTarget } from "@/components/ClassifyPreviewDialog";
import {
  EVIDENCE_LEVELS, EVIDENCE_LEVEL_LABELS, evidenceLevelBadge, evidenceLevelDot, type EvidenceLevel,
  GEOGRAPHIC_RELEVANCES, GEOGRAPHIC_RELEVANCE_LABELS, geographicIcon, type GeographicRelevance,
  impactFactorForJournal,
} from "@/lib/document-relevance";

type LangCode = "es" | "en" | "otro";
const LANG_LABELS: Record<LangCode, string> = { es: "Español", en: "Inglés", otro: "Otro" };
const ANY = "__any__";
const PAGE_SIZE = 200;

interface DocRow {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  publication_date: string | null;
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
  abstract: string | null;
  pubmed_id: string | null;
  pmc_id: string | null;
  journal: string | null;
  repository: string | null;
  repository_id: string | null;
  evidence_level: string | null;
  geographic_relevance: string | null;
  citations_count: number | null;
  impact_factor: number | null;
}

export default function AdminDocuments() {
  const { profile, loading: authLoading } = useAuth();

  const [rows, setRows] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [unclassifiedOnly, setUnclassifiedOnly] = useState(false);
  // Snapshot-based "Sin chunks" filter — only updates when user clicks the button
  const [noChunksSnapshot, setNoChunksSnapshot] = useState<Set<string> | null>(null);
  const [noChunksSearchAt, setNoChunksSearchAt] = useState<Date | null>(null);
  const [, setNowTick] = useState(0);

  // Per-column filters (debounced text inputs)
  const [colTitle, setColTitle] = useState("");
  const [colTitleDebounced, setColTitleDebounced] = useState("");
  const [colAuthor, setColAuthor] = useState("");
  const [colAuthorDebounced, setColAuthorDebounced] = useState("");
  const [colYearFrom, setColYearFrom] = useState("");
  const [colYearTo, setColYearTo] = useState("");
  const [colType, setColType] = useState<string>(ANY);
  const [colAreas, setColAreas] = useState<string[]>([]);
  const [colSourceCol, setColSourceCol] = useState<string>(ANY);
  const [colLang, setColLang] = useState<string>(ANY);
  const [colChunks, setColChunks] = useState<string>(ANY); // ANY | "0" | "1+"
  const [colOrigin, setColOrigin] = useState<string>(ANY);
  const [colDateFrom, setColDateFrom] = useState<Date | undefined>(undefined);
  const [colDateTo, setColDateTo] = useState<Date | undefined>(undefined);
  const [sortDate, setSortDate] = useState<"none" | "asc" | "desc">("none");
  // New column filters / sort
  const [colRepository, setColRepository] = useState<string>(ANY);
  const [colCitations, setColCitations] = useState<string>(ANY); // ANY | "none" | "1-50" | "51-200" | "200+"
  const [colRegion, setColRegion] = useState<string>(ANY);
  const [sortCitations, setSortCitations] = useState<"none" | "asc" | "desc">("none");

  // Debounce title/author 300ms
  useEffect(() => {
    const t = setTimeout(() => setColTitleDebounced(colTitle), 300);
    return () => clearTimeout(t);
  }, [colTitle]);
  useEffect(() => {
    const t = setTimeout(() => setColAuthorDebounced(colAuthor), 300);
    return () => clearTimeout(t);
  }, [colAuthor]);


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

  // EuropePMC enrichment
  type EnrichStatus = "pending" | "querying" | "done" | "skipped" | "error";
  interface EnrichItem {
    id: string;
    title: string;
    status: EnrichStatus;
    fields?: string[];
    error?: string;
  }
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [enrichItems, setEnrichItems] = useState<EnrichItem[]>([]);
  const [enrichProgress, setEnrichProgress] = useState<{ current: number; total: number } | null>(null);
  const [enrichSkippedNoId, setEnrichSkippedNoId] = useState(0);

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

  // Auto-classify (preview-based flow)
  const [classifyTargets, setClassifyTargets] = useState<ClassifyTarget[]>([]);
  const [classifyOpen, setClassifyOpen] = useState(false);

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
      .select("id,title,author,year,publication_date,document_type,clinical_areas,source_institution,source_institution_type,language,is_global,import_source,storage_path,source_url,created_at,processing_mode,abstract,pubmed_id,pmc_id,journal,repository,repository_id,evidence_level,geographic_relevance,citations_count,impact_factor")
      .eq("is_global", true)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Error cargando documentos");
      setLoading(false);
      return;
    }

    // Fetch chunk counts via aggregated DB function (LEFT JOIN + COUNT) to
    // avoid the 1000-row default limit that previously caused docs with many
    // siblings in the same batch to incorrectly report 0 chunks.
    const counts: Record<string, number> = {};
    {
      const { data: countRows, error: countErr } = await supabase
        .rpc("admin_document_chunk_counts");
      if (countErr) {
        console.warn("[admin-docs] chunk count rpc failed:", countErr);
      }
      for (const r of (countRows ?? []) as Array<{ document_id: string; chunk_count: number }>) {
        counts[r.document_id] = Number(r.chunk_count) || 0;
      }
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
    const tq = colTitleDebounced.trim().toLowerCase();
    const aq = colAuthorDebounced.trim().toLowerCase();
    const yFrom = colYearFrom ? parseInt(colYearFrom, 10) : null;
    const yTo = colYearTo ? parseInt(colYearTo, 10) : null;
    const result = rows.filter((d) => {
      if (unclassifiedOnly && d.clinical_areas.length > 0 && !!d.document_type) return false;
      if (noChunksSnapshot && !noChunksSnapshot.has(d.id)) return false;
      // Column filters
      if (tq && !d.title.toLowerCase().includes(tq)) return false;
      if (aq && !(d.author ?? "").toLowerCase().includes(aq)) return false;
      if (yFrom !== null) {
        const y = d.year ? parseInt(d.year, 10) : NaN;
        if (isNaN(y) || y < yFrom) return false;
      }
      if (yTo !== null) {
        const y = d.year ? parseInt(d.year, 10) : NaN;
        if (isNaN(y) || y > yTo) return false;
      }
      if (colType !== ANY && d.document_type !== colType) return false;
      if (colAreas.length > 0 && !colAreas.some((a) => d.clinical_areas.includes(a))) return false;
      if (colSourceCol !== ANY && (d.source_institution ?? "") !== colSourceCol) return false;
      if (colChunks === "0" && d.chunk_count !== 0) return false;
      if (colChunks === "1+" && d.chunk_count < 1) return false;
      if (colOrigin !== ANY && (d.import_source ?? "upload") !== colOrigin) return false;
      if (colRepository !== ANY && (d.repository ?? "") !== colRepository) return false;
      if (colRegion !== ANY && (d.geographic_relevance ?? "") !== colRegion) return false;
      if (colCitations !== ANY) {
        const c = d.citations_count ?? 0;
        if (colCitations === "none" && c !== 0) return false;
        if (colCitations === "1-50" && !(c >= 1 && c <= 50)) return false;
        if (colCitations === "51-200" && !(c >= 51 && c <= 200)) return false;
        if (colCitations === "200+" && !(c > 200)) return false;
      }
      return true;
    });
    if (sortCitations !== "none") {
      result.sort((a, b) => {
        const ca = a.citations_count ?? -1;
        const cb = b.citations_count ?? -1;
        return sortCitations === "asc" ? ca - cb : cb - ca;
      });
    } else if (sortDate !== "none") {
      result.sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return sortDate === "asc" ? ta - tb : tb - ta;
      });
    }
    return result;
  }, [rows, unclassifiedOnly, noChunksSnapshot,
      colTitleDebounced, colAuthorDebounced, colYearFrom, colYearTo, colType, colAreas, colSourceCol, colChunks, colOrigin, colRepository, colCitations, colRegion, sortDate, sortCitations]);

  // Reset to page 1 when column filters change
  useEffect(() => { setPage(1); }, [colTitleDebounced, colAuthorDebounced, colYearFrom, colYearTo, colType, colAreas, colSourceCol, colChunks, colOrigin]);

  // Active column filter count + clear-all
  const activeColFilterCount = useMemo(() => {
    let n = 0;
    if (colTitleDebounced) n++;
    if (colAuthorDebounced) n++;
    if (colYearFrom) n++;
    if (colYearTo) n++;
    if (colType !== ANY) n++;
    if (colAreas.length > 0) n++;
    if (colSourceCol !== ANY) n++;
    if (colChunks !== ANY) n++;
    if (colOrigin !== ANY) n++;
    if (colRepository !== ANY) n++;
    if (colCitations !== ANY) n++;
    if (colRegion !== ANY) n++;
    return n;
  }, [colTitleDebounced, colAuthorDebounced, colYearFrom, colYearTo, colType, colAreas, colSourceCol, colChunks, colOrigin, colRepository, colCitations, colRegion]);

  function clearAllColFilters() {
    setColTitle(""); setColAuthor("");
    setColYearFrom(""); setColYearTo("");
    setColType(ANY); setColAreas([]);
    setColSourceCol(ANY);
    setColChunks(ANY); setColOrigin(ANY);
    setColRepository(ANY); setColCitations(ANY); setColRegion(ANY);
  }

  // Distinct institutions present in rows (for Fuente column dropdown)
  const distinctInstitutions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.source_institution) s.add(r.source_institution);
    return Array.from(s).sort();
  }, [rows]);

  // Distinct origins
  const distinctOrigins = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.import_source ?? "upload");
    return Array.from(s).sort();
  }, [rows]);

  // Distinct repositories
  const distinctRepositories = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.repository) s.add(r.repository);
    return Array.from(s).sort();
  }, [rows]);


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

  function toClassifyTarget(d: DocRow): ClassifyTarget {
    return {
      id: d.id,
      title: d.title,
      author: d.author,
      year: d.year,
      document_type: d.document_type,
      clinical_areas: d.clinical_areas,
      source_institution: d.source_institution,
      source_institution_type: d.source_institution_type,
      language: d.language,
      storage_path: d.storage_path,
      source_url: d.source_url,
      journal: d.journal,
      evidence_level: d.evidence_level,
      geographic_relevance: d.geographic_relevance,
    };
  }

  function openBulkClassify() {
    const ids = Array.from(selected);
    const docs = rows.filter((r) => ids.includes(r.id));
    if (docs.length === 0) return;
    setClassifyTargets(docs.map(toClassifyTarget));
    setClassifyOpen(true);
  }

  function classifySingle(d: DocRow) {
    setClassifyTargets([toClassifyTarget(d)]);
    setClassifyOpen(true);
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


  async function enrichOneFromEuropePMC(d: DocRow): Promise<{ ok: boolean; updatedFields?: string[]; error?: string; skipped?: boolean }> {
    const rawId = d.pubmed_id || (d.pmc_id ? d.pmc_id.replace(/^PMC/i, "") : null);
    if (!rawId) return { ok: false, skipped: true };
    const source = d.pmc_id ? "PMC" : "MED";
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${encodeURIComponent(rawId)}%20AND%20SRC:${source}&format=json&resultType=core`;
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      const article = json?.resultList?.result?.[0];
      if (!article) return { ok: false, error: "No encontrado en EuropePMC" };

      const updates: Record<string, any> = {};
      const updatedFields: string[] = [];
      if (!d.journal && article.journalTitle) {
        updates.journal = article.journalTitle;
        updatedFields.push(`Revista: ${article.journalTitle}`);
      }
      if ((d.citations_count == null) && typeof article.citedByCount === "number") {
        updates.citations_count = article.citedByCount;
        updatedFields.push(`Citas: ${article.citedByCount}`);
      }
      if (!d.author && article.authorString) {
        updates.author = formatAuthor(article.authorString);
        updatedFields.push(`Autor`);
      }
      if (!d.publication_date && article.firstPublicationDate) {
        updates.publication_date = article.firstPublicationDate;
        updatedFields.push(`Fecha pub.`);
      }
      if (!d.abstract && article.abstractText) {
        updates.abstract = article.abstractText;
        updatedFields.push(`Abstract`);
      }
      if (!d.repository) {
        updates.repository = "PubMed / EuropePMC";
        updatedFields.push(`Repositorio`);
      }
      if (!d.repository_id) {
        const rid = article.pmid || article.pmcid || rawId;
        if (rid) {
          updates.repository_id = String(rid);
          updatedFields.push(`ID repo.`);
        }
      }
      const journalForIF = updates.journal ?? d.journal;
      if (d.impact_factor == null && journalForIF) {
        const ifv = impactFactorForJournal(journalForIF);
        if (ifv != null) {
          updates.impact_factor = ifv;
          updatedFields.push(`IF: ${ifv}`);
        }
      }

      if (Object.keys(updates).length === 0) {
        return { ok: true, updatedFields: [] };
      }

      const { error } = await supabase.from("documents").update(updates as any).eq("id", d.id);
      if (error) return { ok: false, error: error.message };

      setRows((rs) => rs.map((r) => (r.id === d.id ? { ...r, ...updates } : r)));
      return { ok: true, updatedFields };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Error de red" };
    }
  }

  async function runEnrichment(targets: DocRow[], skippedNoId = 0) {
    if (targets.length === 0 && skippedNoId === 0) {
      toast.info("No hay documentos con PubMed/PMC ID para enriquecer");
      return;
    }
    setEnrichSkippedNoId(skippedNoId);
    setEnrichItems(targets.map((d) => ({ id: d.id, title: d.title, status: "pending" as EnrichStatus })));
    setEnrichProgress({ current: 0, total: targets.length });
    setEnrichOpen(true);

    for (let i = 0; i < targets.length; i++) {
      const d = targets[i];
      setEnrichProgress({ current: i + 1, total: targets.length });
      setEnrichItems((items) => items.map((it) => it.id === d.id ? { ...it, status: "querying" } : it));
      const res = await enrichOneFromEuropePMC(d);
      setEnrichItems((items) => items.map((it) => {
        if (it.id !== d.id) return it;
        if (res.skipped) return { ...it, status: "skipped" };
        if (!res.ok) return { ...it, status: "error", error: res.error };
        return { ...it, status: "done", fields: res.updatedFields };
      }));
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }
    setEnrichProgress(null);
  }

  function enrichSelected() {
    const sel = rows.filter((r) => selected.has(r.id));
    const withId = sel.filter((r) => r.pubmed_id || r.pmc_id);
    const skipped = sel.length - withId.length;
    runEnrichment(withId, skipped);
  }

  function enrichAllMissing() {
    const targets = rows.filter((r) =>
      (r.pubmed_id || r.pmc_id) &&
      (r.citations_count == null || !r.journal || r.impact_factor == null || !r.author || !r.publication_date)
    );
    runEnrichment(targets, 0);
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

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setUnclassifiedOnly((v) => !v); setPage(1); }}
          className={cn(
            "h-8 rounded-full text-xs",
            unclassifiedOnly && "bg-teal-500/10 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20",
          )}
        >
          Sin clasificar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={runNoChunksSearch}
          className={cn(
            "h-8 rounded-full text-xs",
            noChunksSnapshot && "bg-teal-500/10 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20",
          )}
        >
          <Search className="h-3.5 w-3.5 mr-1" />
          Sin chunks
          {noChunksSnapshot && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setNoChunksSnapshot(null);
                setNoChunksSearchAt(null);
                setPage(1);
              }}
              className="ml-1 hover:text-foreground inline-flex items-center"
              aria-label="Limpiar"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={enrichAllMissing}
          disabled={enrichOpen}
          className="h-8 rounded-full text-xs border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
        >
          🔄 Enriquecer desde EuropePMC
        </Button>
        {noChunksSearchAt && (
          <span className="text-[11px] text-muted-foreground">
            {noChunksSnapshot?.size ?? 0} resultado(s) · {formatRelative(noChunksSearchAt)}
          </span>
        )}
        {activeColFilterCount > 0 && (
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              <Filter className="inline h-3 w-3 mr-1" />
              Filtros activos: <span className="font-medium text-foreground">{activeColFilterCount}</span>
            </span>
            <button type="button" onClick={clearAllColFilters} className="text-primary hover:underline">
              Limpiar todos
            </button>
          </div>
        )}
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
          <Button size="sm" variant="outline" onClick={openBulkClassify}>
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
          <Button size="sm" variant="outline" onClick={enrichSelected} disabled={enrichOpen}
            className="border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10">
            🔄 Enriquecer desde EuropePMC
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirmBulkDelete(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Eliminar seleccionados
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpiar</Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: "3%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left">
                <Checkbox checked={allOnPageSelected} onCheckedChange={(v) => toggleAllOnPage(!!v)} />
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Título" active={!!colTitle} activeText={colTitle || undefined} onClear={() => setColTitle("")}>
                  <Label className="text-xs">Buscar por título</Label>
                  <Input autoFocus value={colTitle} onChange={(e) => setColTitle(e.target.value)} placeholder="Texto contenido..." className="h-8 text-xs mt-1" />
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Autor" active={!!colAuthor} activeText={colAuthor || undefined} onClear={() => setColAuthor("")}>
                  <Label className="text-xs">Buscar por autor</Label>
                  <Input autoFocus value={colAuthor} onChange={(e) => setColAuthor(e.target.value)} placeholder="Nombre..." className="h-8 text-xs mt-1" />
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Año" active={!!(colYearFrom || colYearTo)} activeText={colYearFrom || colYearTo ? `${colYearFrom || "…"}–${colYearTo || "…"}` : undefined} onClear={() => { setColYearFrom(""); setColYearTo(""); }}>
                  <div className="space-y-2">
                    <div><Label className="text-xs">Desde</Label><Input type="number" value={colYearFrom} onChange={(e) => setColYearFrom(e.target.value)} className="h-8 text-xs mt-1" /></div>
                    <div><Label className="text-xs">Hasta</Label><Input type="number" value={colYearTo} onChange={(e) => setColYearTo(e.target.value)} className="h-8 text-xs mt-1" /></div>
                  </div>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Tipo" active={colType !== ANY} activeText={colType !== ANY ? DOC_TYPE_LABELS[colType as DocType] : undefined} onClear={() => setColType(ANY)}>
                  <Select value={colType} onValueChange={setColType}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Todos</SelectItem>
                      {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Área(s) clínica(s)" active={colAreas.length > 0} activeText={colAreas.length > 0 ? `${colAreas.length} sel.` : undefined} onClear={() => setColAreas([])}>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {colAreas.length > 0 && (
                      <button type="button" onClick={() => setColAreas([])} className="text-xs text-primary hover:underline mb-1">Limpiar selección</button>
                    )}
                    {[...CLINICAL_AREAS_NICE, ...CLINICAL_AREAS_TRANSVERSAL].map((a) => {
                      const checked = colAreas.includes(a);
                      return (
                        <label key={a} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                          <Checkbox checked={checked} onCheckedChange={(v) => { if (v) setColAreas([...colAreas, a]); else setColAreas(colAreas.filter((x) => x !== a)); }} />
                          <span className="truncate">{clinicalAreaLabel(a)}</span>
                        </label>
                      );
                    })}
                  </div>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Fuente" active={colSourceCol !== ANY} activeText={colSourceCol !== ANY ? shortInstitutionName(colSourceCol) : undefined} onClear={() => setColSourceCol(ANY)}>
                  <Select value={colSourceCol} onValueChange={setColSourceCol}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={ANY}>Todas</SelectItem>
                      {distinctInstitutions.map((s) => <SelectItem key={s} value={s}>{sourceIconFor(s)} {shortInstitutionName(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Chunks" active={colChunks !== ANY} activeText={colChunks === "0" ? "Sin (0)" : colChunks === "1+" ? "Con (1+)" : undefined} onClear={() => setColChunks(ANY)}>
                  <Select value={colChunks} onValueChange={setColChunks}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Todos</SelectItem>
                      <SelectItem value="0">Sin chunks (0)</SelectItem>
                      <SelectItem value="1+">Con chunks (1+)</SelectItem>
                    </SelectContent>
                  </Select>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <HeaderFilter label="Origen" active={colOrigin !== ANY} activeText={colOrigin !== ANY ? colOrigin : undefined} onClear={() => setColOrigin(ANY)}>
                  <Select value={colOrigin} onValueChange={setColOrigin}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Todos</SelectItem>
                      {distinctOrigins.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </HeaderFilter>
              </th>
              <th className="px-2 py-2 text-left">
                <button
                  type="button"
                  onClick={() => setSortDate((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none")}
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium hover:bg-muted",
                    sortDate !== "none" && "text-teal-700 dark:text-teal-300 bg-teal-500/10"
                  )}
                  title={sortDate === "none" ? "Sin ordenar" : sortDate === "asc" ? "Más antiguos primero" : "Más recientes primero"}
                >
                  <span>Subido</span>
                  <span>{sortDate === "none" ? "↕" : sortDate === "asc" ? "↑" : "↓"}</span>
                </button>
              </th>
              <th className="px-2 py-2 text-left">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">Cargando…</td></tr>
            ) : paged.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">No hay documentos</td></tr>
            ) : paged.map((d) => (
              <tr key={d.id} className={cn(
                "border-t hover:bg-muted/30 transition-colors",
                selected.has(d.id) && "bg-primary/5",
                recentlyProcessed[d.id] && "bg-emerald-500/10 transition-colors duration-1000",
              )}
              style={{ minHeight: "3.5rem" }}>
                <td className="px-2 py-2 align-middle">
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
                </td>
                <td className="px-2 py-2 align-middle" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                  <InlineText value={d.title} onSave={(v) => updateField(d.id, { title: v })} />
                </td>
                <td className="px-2 py-2 align-middle" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                  <InlineText value={d.author ?? ""} placeholder="—" onSave={(v) => updateField(d.id, { author: v || null })} />
                </td>
                <td className="px-2 py-2 align-middle text-xs">
                  {d.publication_date
                    ? (/-01-01$/.test(d.publication_date)
                        ? d.publication_date.slice(0, 4)
                        : new Date(d.publication_date).toLocaleDateString("es-CL"))
                    : (d.year ?? "—")}
                </td>
                <td className="px-2 py-2 align-middle">
                  <InlineSelect
                    value={d.document_type}
                    options={DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_LABELS[t] }))}
                    onSave={(v) => updateField(d.id, { document_type: v as DocType })}
                    renderValue={(v) => DOC_TYPE_LABELS[v as DocType] ?? "—"}
                  />
                </td>
                <td className="px-2 py-2 align-middle">
                  <InlineAreas value={d.clinical_areas} onSave={(v) => updateClinicalAreas(d.id, v)} />
                </td>
                <td className="px-2 py-2 align-middle" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
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
                </td>
                <td className="px-2 py-2 align-middle text-center text-sm tabular-nums">
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
                        ✅ {d.chunk_count}
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
                                <X className="h-3 w-3" />
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
                            <RotateCw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </TooltipProvider>
                  ) : (
                    d.chunk_count
                  )}
                </td>
                <td className="px-2 py-2 align-middle">
                  <Badge variant="secondary" className="text-[10px]">{d.import_source ?? "upload"}</Badge>
                </td>
                <td className="px-2 py-2 align-middle text-xs whitespace-nowrap">
                  <div className="flex flex-col leading-tight">
                    <span>{formatDateFn(new Date(d.created_at), "dd-MM-yyyy")}</span>
                    <span className="text-[10px] text-muted-foreground">{formatDateFn(new Date(d.created_at), "HH:mm")}</span>
                  </div>
                </td>
                <td className="px-2 py-2 align-middle">
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => classifySingle(d)}
                      title="Auto-clasificar"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                      onClick={() => setConfirmVision(d)}
                      disabled={reprocessing.has(d.id) || !d.storage_path}
                      title="Re-procesar con OCR y visión"
                    >
                      {reprocessing.has(d.id) && visionProgress[d.id]
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <ScanEye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openViewer(d)} title="Ver documento">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(d)} title="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {/* Fullscreen Viewer */}
      {viewDoc && (
        <FullscreenDocViewer
          doc={viewDoc}
          viewUrl={viewUrl}
          onClose={() => { setViewDoc(null); setViewUrl(null); }}
          onPatch={async (patch) => {
            const ok = await updateField(viewDoc.id, patch);
            if (ok) setViewDoc({ ...viewDoc, ...patch });
            return !!ok;
          }}
          onAreasChange={async (areas) => {
            await updateClinicalAreas(viewDoc.id, areas);
            setViewDoc({ ...viewDoc, clinical_areas: areas });
          }}
          onClassified={(patch) => {
            setViewDoc((d) => (d ? { ...d, ...patch } : d));
            setRows((rs) => rs.map((r) => (r.id === viewDoc.id ? { ...r, ...patch } : r)));
          }}
        />
      )}

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

      {/* Auto-classify preview (bulk + single) */}
      <ClassifyPreviewDialog
        open={classifyOpen}
        onOpenChange={(o) => {
          setClassifyOpen(o);
          if (!o) {
            setClassifyTargets([]);
          }
        }}
        targets={classifyTargets}
        onSaved={() => {
          setSelected(new Set());
          setClassifyTargets([]);
          load();
        }}
      />

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

      {/* Confirm vision reprocess (single) */}
      <AlertDialog open={!!confirmVision} onOpenChange={(o) => !o && setConfirmVision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ScanEye className="h-5 w-5 text-purple-600" /> ¿Re-procesar con OCR y visión?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se analizará cada página del documento como imagen, capturando diagramas, tablas y gráficos.
              Los chunks actuales serán reemplazados. Este proceso es más lento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={() => {
                const d = confirmVision;
                setConfirmVision(null);
                if (d) reprocessVisionSingle(d);
              }}
            >
              Re-procesar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm vision reprocess (bulk) */}
      <AlertDialog open={confirmVisionBulk} onOpenChange={setConfirmVisionBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ScanEye className="h-5 w-5 text-purple-600" /> ¿Re-procesar {selected.size} documento(s) con visión?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cada página de cada documento se analizará como imagen para capturar diagramas, tablas y gráficos.
              Los chunks actuales serán reemplazados. Este proceso es más lento y se ejecuta secuencialmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={() => {
                setConfirmVisionBulk(false);
                reprocessVisionBulk();
              }}
            >
              Re-procesar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* EuropePMC enrichment progress */}
      <Dialog open={enrichOpen} onOpenChange={(o) => { if (!o && !enrichProgress) { setEnrichOpen(false); load(); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>🔄 Enriqueciendo desde EuropePMC</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {enrichProgress && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando {enrichProgress.current} de {enrichProgress.total}...
              </div>
            )}
            {enrichSkippedNoId > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                {enrichSkippedNoId} documento(s) omitido(s) por no tener PubMed ID
              </div>
            )}
            <div className="max-h-[50vh] overflow-y-auto border rounded-md divide-y">
              {enrichItems.map((it) => (
                <div key={it.id} className="px-3 py-2 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0">
                      {it.status === "pending" && "⏸"}
                      {it.status === "querying" && "⏳"}
                      {it.status === "done" && "✅"}
                      {it.status === "skipped" && "⚪"}
                      {it.status === "error" && "❌"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{it.title}</div>
                      {it.status === "done" && it.fields && it.fields.length > 0 && (
                        <div className="text-muted-foreground mt-0.5">
                          {it.fields.map((f) => `✓ ${f}`).join(" · ")}
                        </div>
                      )}
                      {it.status === "done" && (!it.fields || it.fields.length === 0) && (
                        <div className="text-muted-foreground mt-0.5">Sin campos nuevos para enriquecer</div>
                      )}
                      {it.status === "error" && <div className="text-destructive mt-0.5">{it.error}</div>}
                    </div>
                  </div>
                </div>
              ))}
              {enrichItems.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground">Sin documentos con PubMed/PMC ID</div>
              )}
            </div>
            {!enrichProgress && enrichItems.length > 0 && (
              <div className="text-sm pt-1">
                ✅ {enrichItems.filter((i) => i.status === "done").length} enriquecidos
                {" · "}⚪ {enrichItems.filter((i) => i.status === "skipped").length + enrichSkippedNoId} sin PubMed ID
                {" · "}❌ {enrichItems.filter((i) => i.status === "error").length} error(es)
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!enrichProgress}
              onClick={() => { setEnrichOpen(false); load(); }}
            >
              Cerrar
            </Button>
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

// ---------- Column filter components ----------
function HeaderFilter({
  label, active, activeText, onClear, children, align = "start",
}: {
  label: string;
  active: boolean;
  activeText?: string;
  onClear?: () => void;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted text-xs font-medium",
              active && "text-teal-700 dark:text-teal-300 bg-teal-500/10",
            )}
          >
            <span>{label}</span>
            <ChevronsUpDown className="h-3 w-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align={align}>
          {children}
        </PopoverContent>
      </Popover>
      {active && (
        <>
          {activeText && (
            <span className="text-[10px] text-teal-700 dark:text-teal-300 truncate max-w-[80px]" title={activeText}>
              {activeText}
            </span>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Limpiar filtro"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ColTextFilter({ value, onChange, placeholder, type, compact }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  compact?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-7 text-[12px] px-2", compact ? "w-full" : "w-full", value && "pr-6")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Limpiar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ColSelectFilter({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const isActive = value !== ANY;
  return (
    <div className="relative">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cn("h-7 text-[12px] px-2", isActive && "pr-7")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[400px]">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isActive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(ANY); }}
          className="absolute right-6 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
          aria-label="Limpiar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ColAreasFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const all = [...CLINICAL_AREAS_NICE, ...CLINICAL_AREAS_TRANSVERSAL];
  const isActive = value.length > 0;
  function toggle(a: string) {
    onChange(value.includes(a) ? value.filter((x) => x !== a) : [...value, a]);
  }
  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "h-7 text-[12px] px-2 w-full text-left rounded-md border border-input bg-background hover:bg-accent/50",
              isActive && "pr-7",
            )}
          >
            {value.length === 0 ? "Todas" : `${value.length} área(s)`}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar área…" className="h-8 text-xs" />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>Sin resultados</CommandEmpty>
              <CommandGroup>
                {all.map((a) => (
                  <CommandItem key={a} value={a} onSelect={() => toggle(a)} className="text-xs">
                    <Checkbox checked={value.includes(a)} className="mr-2" />
                    {clinicalAreaLabel(a)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isActive && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
          aria-label="Limpiar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function ColDateRangeFilter({ from, to, onFromChange, onToChange }: {
  from: Date | undefined;
  to: Date | undefined;
  onFromChange: (d: Date | undefined) => void;
  onToChange: (d: Date | undefined) => void;
}) {
  const isActive = !!(from || to);
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-7 text-[11px] px-2 rounded-md border border-input bg-background hover:bg-accent/50 inline-flex items-center gap-1 flex-1 min-w-0"
          >
            <CalendarIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{from ? formatDateFn(from, "dd-MM-yy") : "Desde"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={from} onSelect={onFromChange} initialFocus className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-7 text-[11px] px-2 rounded-md border border-input bg-background hover:bg-accent/50 inline-flex items-center gap-1 flex-1 min-w-0"
          >
            <CalendarIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{to ? formatDateFn(to, "dd-MM-yy") : "Hasta"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={to} onSelect={onToChange} initialFocus className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
      {isActive && (
        <button
          type="button"
          onClick={() => { onFromChange(undefined); onToChange(undefined); }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Limpiar"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ---------- Fullscreen Document Viewer ----------
function FullscreenDocViewer({
  doc, viewUrl, onClose, onPatch, onAreasChange, onClassified,
}: {
  doc: DocRow;
  viewUrl: string | null;
  onClose: () => void;
  onPatch: (patch: Partial<DocRow>) => Promise<boolean>;
  onAreasChange: (areas: string[]) => Promise<void>;
  onClassified: (patch: Partial<DocRow>) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [autoClassifying, setAutoClassifying] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleSaveAll() {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      // Flush any pending debounced auto-saves from focused inputs
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();
      await new Promise((r) => setTimeout(r, 350));

      const ok = await onPatch({
        title: doc.title,
        author: doc.author ?? null,
        journal: (doc as any).journal ?? null,
        year: doc.year ?? null,
        publication_date: doc.publication_date ?? null,
        document_type: doc.document_type,
        clinical_areas: doc.clinical_areas,
        source_institution: doc.source_institution ?? null,
        source_institution_type: (doc as any).source_institution_type ?? null,
        evidence_level: doc.evidence_level ?? null,
        citations_count: doc.citations_count ?? null,
        impact_factor: doc.impact_factor ?? null,
        geographic_relevance: doc.geographic_relevance ?? null,
        language: doc.language ?? null,
        abstract: doc.abstract ?? null,
        pubmed_id: doc.pubmed_id ?? null,
        pmc_id: doc.pmc_id ?? null,
        is_global: doc.is_global,
      } as any);
      if (!ok) throw new Error("No se pudo guardar");
      setSaveState("saved");
      setTimeout(() => onClose(), 700);
    } catch (err) {
      console.error("Save error:", err);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2000);
    }
  }

  async function runAutoClassify() {
    if (autoClassifying) return;
    setAutoClassifying(true);
    try {
      // Get first few chunks for context
      const { data: chunks } = await supabase
        .from("document_chunks")
        .select("content")
        .eq("document_id", doc.id)
        .order("chunk_index", { ascending: true })
        .limit(3);
      let content = (chunks ?? []).map((c: any) => c.content).join(" ").slice(0, 1000);
      if (!content.trim()) {
        // Fallback: title + abstract
        content = [doc.title, doc.abstract ?? ""].filter(Boolean).join("\n\n").slice(0, 1000);
      }
      const text = `Title: ${doc.title}\nContent fragment: ${content}`;

      const { data: ai, error } = await supabase.functions.invoke("extract-metadata", { body: { text } });
      if (error) throw new Error(error.message ?? "Error de IA");
      if (ai?.error) throw new Error(ai.error);

      const patch: Partial<DocRow> = {};
      if ((!doc.document_type || doc.document_type === ("otro" as DocType)) &&
          typeof ai.document_type === "string" &&
          (DOC_TYPES as readonly string[]).includes(ai.document_type)) {
        patch.document_type = ai.document_type as DocType;
      }
      if (!doc.year && ai.year != null && String(ai.year).trim()) {
        patch.year = String(ai.year).trim();
      }
      if (!doc.publication_date && typeof ai.publication_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ai.publication_date)) {
        patch.publication_date = ai.publication_date;
        if (!patch.year) patch.year = ai.publication_date.slice(0, 4);
      }
      if (!doc.author && typeof ai.author === "string" && ai.author.trim()) {
        patch.author = ai.author.trim();
      }
      if (!doc.language && typeof ai.language === "string") {
        const l = ai.language.trim().toLowerCase();
        if (l.startsWith("espa")) patch.language = "es";
        else if (l.startsWith("ing") || l.startsWith("eng")) patch.language = "en";
        else if (l) patch.language = "otro";
      }
      if ((!doc.clinical_areas || doc.clinical_areas.length === 0) && Array.isArray(ai.clinical_areas) && ai.clinical_areas.length > 0) {
        patch.clinical_areas = (ai.clinical_areas as string[]).slice(0, 3);
      }
      if (!doc.source_institution && typeof ai.source_institution === "string" && ai.source_institution.trim()) {
        patch.source_institution = ai.source_institution.trim();
        if (typeof ai.source_institution_type === "string") {
          patch.source_institution_type = ai.source_institution_type;
        }
      }
      if (!doc.journal && typeof ai.journal === "string" && ai.journal.trim()) {
        patch.journal = ai.journal.trim();
      }
      if (!doc.repository && typeof ai.repository === "string" && ai.repository.trim()) {
        patch.repository = ai.repository.trim();
      }
      if (!doc.repository_id && typeof ai.repository_id === "string" && ai.repository_id.trim()) {
        patch.repository_id = ai.repository_id.trim();
      }
      if (!doc.evidence_level && typeof ai.evidence_level === "string" &&
          (EVIDENCE_LEVELS as readonly string[]).includes(ai.evidence_level)) {
        patch.evidence_level = ai.evidence_level;
      }
      if (!doc.geographic_relevance && typeof ai.geographic_relevance === "string" &&
          (GEOGRAPHIC_RELEVANCES as readonly string[]).includes(ai.geographic_relevance)) {
        patch.geographic_relevance = ai.geographic_relevance;
      }

      if (Object.keys(patch).length === 0) {
        toast.info("No se detectaron campos nuevos para clasificar");
        return;
      }

      // Persist the diff
      const { error: upErr } = await supabase.from("documents").update(patch as any).eq("id", doc.id);
      if (upErr) throw upErr;

      // Propagate relevant fields to chunks
      const chunkPatch: Record<string, unknown> = {};
      if (patch.document_type) chunkPatch.document_type = patch.document_type;
      if (patch.clinical_areas) chunkPatch.clinical_areas = patch.clinical_areas;
      if (patch.source_institution !== undefined) chunkPatch.source_institution = patch.source_institution;
      if (patch.source_institution_type !== undefined) chunkPatch.source_institution_type = patch.source_institution_type;
      if (patch.language) chunkPatch.language = patch.language;
      if (patch.evidence_level) chunkPatch.evidence_level = patch.evidence_level;
      if (patch.geographic_relevance) chunkPatch.geographic_relevance = patch.geographic_relevance;
      if (Object.keys(chunkPatch).length > 0) {
        await supabase.from("document_chunks").update(chunkPatch as any).eq("document_id", doc.id);
      }

      onClassified(patch);
      toast.success(`✨ ${Object.keys(patch).length} campo(s) clasificado(s)`);
    } catch (err: any) {
      console.error("Auto-classify error:", err);
      toast.error(`Error al clasificar: ${err?.message ?? String(err)}`);
    } finally {
      setAutoClassifying(false);
    }
  }

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function flash(field: string) {
    setSavedFlash(field);
    setTimeout(() => setSavedFlash((f) => (f === field ? null : f)), 1500);
  }

  async function save<K extends keyof DocRow>(field: K, value: DocRow[K]) {
    const ok = await onPatch({ [field]: value } as Partial<DocRow>);
    if (ok) flash(String(field));
    return ok;
  }

  const originLabels: Record<string, string> = {
    upload: "📤 Upload", google_drive: "📁 Google Drive", url: "🔗 URL",
    web_search: "🌐 Web search", pubmed: "🧬 PubMed",
  };

  return (
    <div
      className="fixed inset-0 bg-background/95 backdrop-blur-sm flex"
      style={{ zIndex: 9999 }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex w-full h-full transition-transform duration-300 ease-out"
        style={{ transform: mounted ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Left: metadata */}
        <div className="w-[35%] min-w-[380px] h-full border-r bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <h2 className="text-sm font-semibold truncate">Detalles del documento</h2>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Cerrar">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <Field label="Título" saved={savedFlash === "title"}>
              <AutoSaveTextarea
                value={doc.title}
                rows={3}
                onSave={(v) => save("title", v)}
              />
            </Field>

            <Field label="Autor" saved={savedFlash === "author"}>
              <AutoSaveInput
                value={doc.author ?? ""}
                onSave={(v) => save("author", (v || null) as any)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Solo primer autor + et al. Ej: Barlow, D.H. et al.</p>
            </Field>

            <Field label="Fecha de publicación" saved={savedFlash === "publication_date"}>
              <Input
                type="date"
                value={doc.publication_date ?? ""}
                onChange={async (e) => {
                  const v = e.target.value || null;
                  const yr = v ? v.slice(0, 4) : doc.year;
                  const ok = await onPatch({ publication_date: v, year: yr } as any);
                  if (ok) flash("publication_date");
                }}
                className="h-9 text-sm"
              />
            </Field>

            <Field label="Tipo de documento" saved={savedFlash === "document_type"}>
              <Select
                value={doc.document_type}
                onValueChange={(v) => save("document_type", v as DocType)}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Área(s) clínica(s)" saved={savedFlash === "clinical_areas"}>
              <div className="rounded-md border bg-background">
                <AreaPicker
                  value={doc.clinical_areas}
                  onChange={async (v) => { await onAreasChange(v); flash("clinical_areas"); }}
                />
              </div>
            </Field>

            <Field label="Fuente / Institución" saved={savedFlash === "source_institution"}>
              <SourcePicker
                value={doc.source_institution ?? ""}
                onSave={async (name) => {
                  const m = SOURCE_INSTITUTIONS.find((s) => s.name === name);
                  const ok = await onPatch({
                    source_institution: name || null,
                    source_institution_type: (m?.type ?? null) as any,
                  });
                  if (ok) flash("source_institution");
                }}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nivel de evidencia" saved={savedFlash === "evidence_level"}>
                <Select
                  value={doc.evidence_level ?? ""}
                  onValueChange={(v) => save("evidence_level", (v || null) as any)}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_LEVELS.map((l) => <SelectItem key={l} value={l}>{EVIDENCE_LEVEL_LABELS[l]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Relevancia geográfica" saved={savedFlash === "geographic_relevance"}>
                <Select
                  value={doc.geographic_relevance ?? ""}
                  onValueChange={(v) => save("geographic_relevance", (v || null) as any)}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {GEOGRAPHIC_RELEVANCES.map((g) => (
                      <SelectItem key={g} value={g}>{geographicIcon(g)} {GEOGRAPHIC_RELEVANCE_LABELS[g]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="N° de citas" saved={savedFlash === "citations_count"}>
                <Input
                  type="number"
                  value={doc.citations_count ?? ""}
                  readOnly={!!doc.pubmed_id || !!doc.pmc_id}
                  onChange={(e) => {
                    const n = e.target.value === "" ? null : Number(e.target.value);
                    onPatch({ citations_count: n } as any).then((ok) => { if (ok) flash("citations_count"); });
                  }}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="Factor de impacto" saved={savedFlash === "impact_factor"}>
                <Input
                  type="number"
                  step="0.1"
                  value={doc.impact_factor ?? ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? null : Number(e.target.value);
                    onPatch({ impact_factor: n } as any).then((ok) => { if (ok) flash("impact_factor"); });
                  }}
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            <Field label="Idioma" saved={savedFlash === "language"}>
              <Select
                value={doc.language ?? ""}
                onValueChange={(v) => save("language", v as any)}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">Inglés</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Abstract" saved={savedFlash === "abstract"}>
              <AutoSaveTextarea
                value={doc.abstract ?? ""}
                rows={5}
                placeholder="Sin abstract"
                onSave={(v) => save("abstract", (v || null) as any)}
              />
            </Field>

            <Field label="PubMed ID" saved={savedFlash === "pubmed_id"}>
              <AutoSaveInput
                value={doc.pubmed_id ?? ""}
                onSave={(v) => save("pubmed_id", (v || null) as any)}
              />
            </Field>

            <Field label="PMC ID" saved={savedFlash === "pmc_id"}>
              <AutoSaveInput
                value={doc.pmc_id ?? ""}
                onSave={(v) => save("pmc_id", (v || null) as any)}
              />
            </Field>

            <Field label="URL de origen">
              {doc.source_url ? (
                <a
                  href={doc.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline break-all"
                >
                  {doc.source_url}
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Origen">
                <Badge variant="secondary" className="text-[11px]">
                  {originLabels[doc.import_source ?? "upload"] ?? doc.import_source ?? "—"}
                </Badge>
              </Field>
              <Field label="Modo de procesamiento">
                <Badge variant="secondary" className="text-[11px]">
                  {doc.processing_mode === "vision" ? "🔍 Visión" : "⚡ Texto"}
                </Badge>
              </Field>
              <Field label="Chunks indexados">
                <span className="text-sm font-medium">{doc.chunk_count}</span>
              </Field>
              <Field label="Fecha de subida">
                <span className="text-sm">{new Date(doc.created_at).toLocaleDateString("es-CL")}</span>
              </Field>
            </div>

            <Field label="Global" saved={savedFlash === "is_global"}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={doc.is_global}
                  onChange={(e) => save("is_global", e.target.checked as any)}
                  className="h-4 w-4"
                />
                <span className="text-xs text-muted-foreground">
                  {doc.is_global ? "Visible para todos" : "Solo admin"}
                </span>
              </div>
            </Field>
          </div>

          <div className="px-4 py-3 border-t shrink-0 bg-background flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={runAutoClassify}
              disabled={autoClassifying || saveState === "saving"}
            >
              {autoClassifying ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> ✨ Clasificando...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2 text-primary" /> ✨ Auto-clasificar</>
              )}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSaveAll}
              disabled={saveState === "saving" || autoClassifying}
            >
              {saveState === "saving" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 💾 Guardando...</>
              ) : saveState === "saved" ? (
                <>✅ Guardado</>
              ) : saveState === "error" ? (
                <>❌ Error al guardar</>
              ) : (
                <>💾 Guardar cambios</>
              )}
            </Button>
          </div>
        </div>

        {/* Right: PDF / abstract */}
        <div className="flex-1 h-full bg-muted">
          {viewUrl ? (
            <iframe
              src={`${viewUrl}#toolbar=0&navpanes=0&view=FitH&page=1`}
              style={{ width: "100%", height: "100%", border: "none", margin: 0, padding: 0, display: "block" }}
              title={doc.title}
            />
          ) : doc.abstract ? (
            <div className="h-full overflow-y-auto p-8 bg-background">
              <h3 className="text-lg font-semibold mb-2">{doc.title}</h3>
              {doc.author && <p className="text-sm text-muted-foreground mb-4">{doc.author}{doc.year ? ` · ${doc.year}` : ""}</p>}
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Abstract</h4>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{doc.abstract}</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No hay archivo ni abstract disponible para este documento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, saved, children }: { label: string; saved?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</label>
        {saved && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 animate-fade-in">✓ Guardado</span>}
      </div>
      {children}
    </div>
  );
}

function AutoSaveInput({
  value, onSave, placeholder, type = "text",
}: { value: string; onSave: (v: string) => void | Promise<boolean | void>; placeholder?: string; type?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <Input
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); }
        else if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      className="h-9 text-sm"
    />
  );
}

function AutoSaveTextarea({
  value, onSave, placeholder, rows = 3,
}: { value: string; onSave: (v: string) => void | Promise<boolean | void>; placeholder?: string; rows?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
    />
  );
}

function SourcePicker({ value, onSave }: { value: string; onSave: (v: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const icon = sourceIconFor(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent/30"
        >
          <span className="truncate">
            {value ? `${icon} ${shortInstitutionName(value)}` : <span className="text-muted-foreground">Seleccionar fuente…</span>}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
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
