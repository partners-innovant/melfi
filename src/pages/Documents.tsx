import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { Upload, Trash2, FileText, Globe2, Loader2, CheckCircle2, AlertCircle, X, Sparkles, Eye, AlertTriangle, Filter } from "lucide-react";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import {
  CLINICAL_AREAS, CLINICAL_AREAS_NICE, CLINICAL_AREAS_TRANSVERSAL,
  CLINICAL_AREA_LABELS, MAX_CLINICAL_AREAS, clinicalAreaColor, clinicalAreaLabel,
  SOURCE_INSTITUTIONS, SOURCE_INSTITUTION_TYPE_LABELS, sourceIconFor,
  type ClinicalArea, type SourceInstitutionType,
} from "@/lib/clinical-areas";
import { extractPdfTextAndMeta, extractTxtText, chunkText } from "@/lib/pdf";
import GoogleDriveImport from "@/components/GoogleDriveImport";
import RecommendDocumentsButton from "@/components/RecommendDocumentsButton";
import UrlImportDialog from "@/components/UrlImportDialog";
import { findDuplicateByTitle, deleteDocumentAndChunks, nextAvailableTitle, formatDate, type DuplicateDoc } from "@/lib/duplicates";

type ImportSource = 'upload' | 'google_drive' | 'url' | 'web_search';

interface Doc {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  document_type: DocType;
  is_global: boolean;
  psychologist_id: string;
  storage_path: string | null;
  created_at: string;
  import_source?: ImportSource | null;
  source_url?: string | null;
  clinical_areas?: string[] | null;
  source_institution?: string | null;
  source_institution_type?: string | null;
}

const IMPORT_SOURCE_META: Record<ImportSource, { icon: string; label: string }> = {
  upload: { icon: '📁', label: 'Subida manual' },
  google_drive: { icon: '🔗', label: 'Google Drive' },
  url: { icon: '🌐', label: 'URL' },
  web_search: { icon: '🔍', label: 'Búsqueda web' },
};

export default function Documents() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const importUrlParam = searchParams.get("import_url") ?? undefined;

  const isAdmin = !!profile?.is_admin;

  async function load() {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    setDocs((data as Doc[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function canDeleteDoc(d: Doc) {
    if (isAdmin) return true;
    return !d.is_global && d.psychologist_id === user?.id;
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  async function performDelete(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const targets = docs.filter((d) => ids.includes(d.id) && canDeleteDoc(d));
      const paths = targets.map((d) => d.storage_path).filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("documents").remove(paths);
      }
      const targetIds = targets.map((d) => d.id);
      // Delete chunks first (no FK cascade in DB)
      const { error: chunksError } = await supabase
        .from("document_chunks")
        .delete()
        .in("document_id", targetIds);
      if (chunksError) console.warn("[delete] chunks:", chunksError);
      const { data: deleted, error } = await supabase
        .from("documents")
        .delete()
        .in("id", targetIds)
        .select("id");
      if (error) throw error;
      const n = deleted?.length ?? 0;
      if (n === 0) {
        toast.error("No se eliminó ningún documento. Verifica permisos.");
      } else {
        toast.success(`${n} documento${n === 1 ? "" : "s"} eliminado${n === 1 ? "" : "s"}`);
      }
      clearSelection();
      setConfirmIds(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  const ANY = "__any__";
  const [filterType, setFilterType] = useState<string>(ANY);
  const [filterArea, setFilterArea] = useState<string>(ANY);
  const [filterSource, setFilterSource] = useState<string>(ANY);
  const [filterScope, setFilterScope] = useState<"all" | "global" | "mine">("all");

  const filtered = docs.filter((d) => {
    if (filterType !== ANY && d.document_type !== filterType) return false;
    if (filterArea !== ANY && !(d.clinical_areas ?? []).includes(filterArea)) return false;
    if (filterSource !== ANY && d.source_institution !== filterSource) return false;
    if (filterScope === "global" && !d.is_global) return false;
    if (filterScope === "mine" && (d.is_global || d.psychologist_id !== user?.id)) return false;
    return true;
  });

  const allSourcesInUse = Array.from(new Set(docs.map((d) => d.source_institution).filter((v): v is string => !!v))).sort();

  const global = filtered.filter((d) => d.is_global);
  const own = filtered.filter((d) => !d.is_global && d.psychologist_id === user?.id);
  const selectedCount = selected.size;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 w-full">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Documentos</h1>
          <p className="text-muted-foreground text-sm mt-1">Base de conocimiento clínica</p>
        </div>
        <div className="flex items-center gap-2">
          <RecommendDocumentsButton />
          <UrlImportDialog
            isAdmin={isAdmin}
            onImported={load}
            initialUrl={importUrlParam}
            forceOpen={!!importUrlParam}
            onOpenChange={(o) => {
              if (!o && importUrlParam) {
                searchParams.delete("import_url");
                setSearchParams(searchParams, { replace: true });
              }
            }}
          />
          <GoogleDriveImport isAdmin={isAdmin} onImported={load} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Upload className="h-4 w-4" />Subir documentos</Button>
            </DialogTrigger>
            <UploadDialog onClose={() => { setOpen(false); load(); }} isAdmin={isAdmin} />
          </Dialog>
        </div>
      </header>

      {/* Filter bar */}
      <Card className="p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
          <Filter className="h-3.5 w-3.5" /> Filtros:
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos los tipos</SelectItem>
            {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterArea} onValueChange={setFilterArea}>
          <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue placeholder="Área clínica" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ANY}>Todas las áreas</SelectItem>
            {CLINICAL_AREAS.map((a) => (
              <SelectItem key={a} value={a}>{CLINICAL_AREA_LABELS[a]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue placeholder="Fuente" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ANY}>Todas las fuentes</SelectItem>
            {allSourcesInUse.map((s) => (
              <SelectItem key={s} value={s}>{sourceIconFor(s)} {s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterScope} onValueChange={(v: any) => setFilterScope(v)}>
          <SelectTrigger className="h-8 text-xs w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="global">Solo globales</SelectItem>
            <SelectItem value="mine">Mis documentos</SelectItem>
          </SelectContent>
        </Select>
        {(filterType !== ANY || filterArea !== ANY || filterSource !== ANY || filterScope !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => { setFilterType(ANY); setFilterArea(ANY); setFilterSource(ANY); setFilterScope("all"); }}
          >
            Limpiar
          </Button>
        )}
      </Card>

      {selectedCount > 0 && (
        <div className="sticky top-2 z-10 mb-4 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2 shadow-sm">
          <div className="text-sm">
            <span className="font-medium">{selectedCount}</span> seleccionado{selectedCount === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>Limpiar</Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => setConfirmIds(Array.from(selected))}
            >
              <Trash2 className="h-4 w-4" />Eliminar seleccionados
            </Button>
          </div>
        </div>
      )}

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Globe2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Documentos globales</h2>
          <span className="text-xs text-muted-foreground">({global.length})</span>
        </div>
        <DocList
          docs={global} loading={loading}
          onDelete={(id) => setConfirmIds([id])}
          onView={setViewing}
          canDeleteDoc={canDeleteDoc}
          selected={selected} onToggle={toggleSelect}
        />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Mis documentos</h2>
          <span className="text-xs text-muted-foreground">({own.length})</span>
        </div>
        <DocList
          docs={own} loading={loading}
          onDelete={(id) => setConfirmIds([id])}
          onView={setViewing}
          canDeleteDoc={canDeleteDoc}
          selected={selected} onToggle={toggleSelect}
        />
      </section>

      <ViewerSheet doc={viewing} onClose={() => setViewing(null)} />

      <AlertDialog open={!!confirmIds} onOpenChange={(o) => { if (!o && !deleting) setConfirmIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán {confirmIds?.length ?? 0} documento{(confirmIds?.length ?? 0) === 1 ? "" : "s"} y todos sus fragmentos indexados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); if (confirmIds) performDelete(confirmIds); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DocList({
  docs, loading, onDelete, onView, canDeleteDoc, selected, onToggle,
}: {
  docs: Doc[];
  loading: boolean;
  onDelete: (id: string) => void;
  onView: (d: Doc) => void;
  canDeleteDoc: (d: Doc) => boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 bg-card rounded-xl animate-pulse" />)}</div>;
  if (docs.length === 0) return <Card className="p-6 text-center text-sm text-muted-foreground">Sin documentos en esta sección.</Card>;
  return (
    <Card className="w-full overflow-hidden">
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-10" />
            <col style={{ width: "35%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
          </colgroup>
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left"></th>
              <th className="px-3 py-2 text-left font-medium">Nombre</th>
              <th className="px-3 py-2 text-left font-medium">Área(s) clínica(s)</th>
              <th className="px-3 py-2 text-left font-medium">Fuente</th>
              <th className="px-3 py-2 text-left font-medium">Año</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const canDelete = canDeleteDoc(d);
              const isSelected = selected.has(d.id);
              const areas = (d.clinical_areas ?? []) as string[];
              const visibleAreas = areas.slice(0, 2);
              const extraAreas = areas.slice(2);
              return (
                <tr
                  key={d.id}
                  className={`border-t hover:bg-muted/30 transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                >
                  <td className="px-3 py-2 align-middle">
                    {canDelete ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggle(d.id)}
                        aria-label={`Seleccionar ${d.title}`}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-middle min-w-0">
                    <button
                      type="button"
                      onClick={() => onView(d)}
                      className="flex items-center gap-2 min-w-0 w-full text-left hover:underline focus:outline-none focus:underline"
                    >
                      <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="font-medium truncate">{d.title}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {visibleAreas.map((a) => (
                        <span
                          key={a}
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${clinicalAreaColor(a)}`}
                          title={clinicalAreaLabel(a)}
                        >
                          {clinicalAreaLabel(a)}
                        </span>
                      ))}
                      {extraAreas.length > 0 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground cursor-help"
                          title={extraAreas.map(clinicalAreaLabel).join(", ")}
                        >
                          +{extraAreas.length} más
                        </span>
                      )}
                      {areas.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-xs">
                    {d.source_institution ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>{sourceIconFor(d.source_institution, d.source_institution_type)}</span>
                        <span className="truncate">{d.source_institution}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle text-muted-foreground">
                    {d.year ?? "—"}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <Badge variant="secondary" className="text-[10px] whitespace-nowrap">
                      {DOC_TYPE_LABELS[d.document_type]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onView(d)} aria-label="Ver">
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canDelete && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(d.id)} aria-label="Eliminar">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ViewerSheet({ doc, onClose }: { doc: Doc | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) { setUrl(null); setError(null); return; }
    if (!doc.storage_path) {
      setUrl(null);
      setError("Este documento no tiene archivo original almacenado (subido antes de habilitar el visor).");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.storage_path!, 60 * 60);
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message ?? "No se pudo cargar el archivo");
        setUrl(null);
      } else {
        setUrl(data.signedUrl);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [doc]);

  const isPdf = doc?.storage_path?.toLowerCase().endsWith(".pdf");

  return (
    <Sheet open={!!doc} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col p-0">
        {doc && (
          <>
            <SheetHeader className="p-6 pb-3 border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">{doc.title}</SheetTitle>
                  <SheetDescription className="mt-1">
                    {doc.author ?? "Autor desconocido"}{doc.year ? ` · ${doc.year}` : ""}
                  </SheetDescription>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">{DOC_TYPE_LABELS[doc.document_type]}</Badge>
                    <Badge variant={doc.is_global ? "default" : "outline"} className="text-[10px] gap-1">
                      {doc.is_global ? <><Globe2 className="h-3 w-3" />Global</> : "Privado"}
                    </Badge>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
              </div>
            </SheetHeader>
            <div className="flex-1 min-h-0 bg-muted">
              {loading && (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando archivo...
                </div>
              )}
              {error && !loading && (
                <div className="h-full flex items-center justify-center p-6 text-sm text-muted-foreground text-center">
                  {error}
                </div>
              )}
              {url && !loading && !error && (
                isPdf ? (
                  <iframe
                    src={url}
                    title={doc.title}
                    className="w-full h-full border-0"
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
                    <p className="text-sm text-muted-foreground">Vista previa no disponible para este formato.</p>
                    <a href={url} target="_blank" rel="noreferrer" className="text-primary underline text-sm">
                      Abrir archivo en pestaña nueva
                    </a>
                  </div>
                )
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

type QueueStatus = "pending" | "analyzing" | "ready" | "uploading" | "done" | "error";
type DupAction = "pending" | "replace" | "keep_both";

interface QueueItem {
  id: string;
  file: File;
  title: string;
  author: string;
  year: string;
  docType: DocType;
  isGlobal: boolean;
  clinicalAreas: string[];
  sourceInstitution: string;
  sourceInstitutionType: string;
  // Track which fields were auto-filled by the AI
  autoFilled: { docType: boolean; clinicalAreas: boolean; sourceInstitution: boolean };
  status: QueueStatus;
  progress: number;
  statusText: string;
  error?: string;
  cachedText?: string;
  duplicate?: DuplicateDoc | null;
  dupAction?: DupAction;
  chunksCount?: number;
}

interface UploadResults {
  success: number;
  failed: number;
  totalChunks: number;
  errors: { name: string; error: string }[];
}

function UploadDialog({ onClose, isAdmin }: { onClose: () => void; isAdmin: boolean }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResults | null>(null);

  function update(id: string, patch: Partial<QueueItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function analyzeFile(item: QueueItem) {
    update(item.id, { status: "analyzing", statusText: "Extrayendo texto y metadatos..." });
    try {
      let text = "";
      let title = item.file.name.replace(/\.(pdf|txt)$/i, "");
      let author = "";
      let year = "";
      let docType: DocType = "articulo_cientifico";
      let clinicalAreas: string[] = [];
      let sourceInstitution = "";
      let sourceInstitutionType = "";
      const autoFilled = { docType: false, clinicalAreas: false, sourceInstitution: false };

      if (item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf")) {
        const { text: t, meta } = await extractPdfTextAndMeta(item.file);
        text = t;
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
        if (meta.year) year = meta.year;
      } else {
        text = await extractTxtText(item.file);
      }

      // Always call AI for clinical classification (in addition to bibliographic metadata).
      update(item.id, { statusText: "Clasificando con IA..." });
      try {
        const { data, error } = await supabase.functions.invoke("extract-metadata", {
          body: { text },
        });
        if (!error && data && !data.error) {
          if (!title && data.title) title = data.title;
          if (!author && data.author) author = data.author;
          if (!year && data.year) year = data.year;
          if (data.document_type && (DOC_TYPES as readonly string[]).includes(data.document_type)) {
            docType = data.document_type as DocType;
            autoFilled.docType = true;
          }
          if (Array.isArray(data.clinical_areas) && data.clinical_areas.length > 0) {
            clinicalAreas = (data.clinical_areas as string[])
              .filter((a) => (CLINICAL_AREAS as readonly string[]).includes(a))
              .slice(0, MAX_CLINICAL_AREAS);
            autoFilled.clinicalAreas = clinicalAreas.length > 0;
          }
          if (data.source_institution) {
            sourceInstitution = String(data.source_institution);
            autoFilled.sourceInstitution = true;
          }
          if (data.source_institution_type) sourceInstitutionType = String(data.source_institution_type);
        } else if (error || data?.error) {
          console.warn("[upload] metadata AI failed:", error ?? data?.error);
        }
      } catch (e) {
        console.warn("[upload] metadata AI exception:", e);
      }

      // Duplicate detection by title (case-insensitive, owner + global docs).
      let duplicate: DuplicateDoc | null = null;
      try {
        duplicate = await findDuplicateByTitle(title);
      } catch (e) {
        console.warn("[upload] duplicate check failed:", e);
      }

      update(item.id, {
        status: "ready",
        statusText: duplicate ? "Duplicado detectado — elige una acción" : "Listo para subir",
        title,
        author,
        year,
        docType,
        clinicalAreas,
        sourceInstitution,
        sourceInstitutionType,
        autoFilled,
        cachedText: text,
        duplicate,
        dupAction: duplicate ? "pending" : undefined,
      });
    } catch (e: any) {
      console.error("[upload] analyze failed:", e);
      update(item.id, { status: "error", error: e?.message ?? "Error al analizar", statusText: "Error" });
    }
  }

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: QueueItem[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      title: file.name.replace(/\.(pdf|txt)$/i, ""),
      author: "",
      year: "",
      docType: "articulo_cientifico",
      isGlobal: false,
      clinicalAreas: [],
      sourceInstitution: "",
      sourceInstitutionType: "",
      autoFilled: { docType: false, clinicalAreas: false, sourceInstitution: false },
      status: "pending",
      progress: 0,
      statusText: "En cola",
    }));
    setItems((prev) => [...prev, ...next]);
    (async () => {
      for (const it of next) await analyzeFile(it);
    })();
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function processOne(item: QueueItem, userId: string): Promise<boolean> {
    update(item.id, { status: "uploading", progress: 2, statusText: "Subiendo archivo..." });
    try {
      const text = item.cachedText ?? "";
      const chunks = chunkText(text);
      if (chunks.length === 0) throw new Error("No se pudo extraer texto del archivo");

      // Apply duplicate action chosen by the user.
      let finalTitle = item.title;
      if (item.duplicate) {
        if (item.dupAction === "replace") {
          update(item.id, { statusText: "Eliminando documento previo..." });
          await deleteDocumentAndChunks(item.duplicate);
        } else if (item.dupAction === "keep_both") {
          update(item.id, { statusText: "Calculando título único..." });
          finalTitle = await nextAvailableTitle(item.title);
        } else {
          throw new Error("Resuelve el aviso de duplicado antes de subir");
        }
      }

      // Upload original file to storage (path: <userId>/<uuid>.<ext>)
      const ext = item.file.name.toLowerCase().endsWith(".pdf") ? "pdf"
        : item.file.name.toLowerCase().endsWith(".txt") ? "txt"
        : (item.file.name.split(".").pop() ?? "bin").toLowerCase();
      const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, item.file, {
          contentType: item.file.type || (ext === "pdf" ? "application/pdf" : "text/plain"),
          upsert: false,
        });
      if (upErr) throw new Error(`Storage: ${upErr.message}`);

      update(item.id, { progress: 5, statusText: "Creando documento..." });
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          psychologist_id: userId,
          title: finalTitle,
          author: item.author || null,
          year: item.year || null,
          document_type: item.docType,
          is_global: item.isGlobal && isAdmin,
          storage_path: storagePath,
          source_url: item.file.name,
          import_source: 'upload',
          clinical_areas: item.clinicalAreas,
          source_institution: item.sourceInstitution || null,
          source_institution_type: item.sourceInstitutionType || null,
        } as any)
        .select()
        .single();
      if (docErr) {
        // rollback uploaded file
        await supabase.storage.from("documents").remove([storagePath]);
        throw docErr;
      }

      const batchSize = 8;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        update(item.id, {
          progress: Math.round((i / chunks.length) * 95) + 2,
          statusText: `Lote ${batchNum}/${totalBatches} (${chunks.length} fragmentos)`,
        });
        const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
          body: { input: batch.map((c) => c.content), input_type: "document" },
        });
        if (embErr) throw embErr;
        if (embData?.error) throw new Error(embData.error);
        const embeddings: number[][] = embData.embeddings;
        const rows = batch.map((c, idx) => ({
          document_id: doc.id,
          psychologist_id: userId,
          chunk_index: c.index,
          content: c.content,
          page_number: c.page_number,
          embedding: embeddings[idx] as any,
          // Denormalized classification copied from parent doc:
          clinical_areas: item.clinicalAreas,
          source_institution: item.sourceInstitution || null,
          source_institution_type: item.sourceInstitutionType || null,
          document_type: item.docType,
          is_global: item.isGlobal && isAdmin,
        }));
        const { error: insErr } = await supabase.from("document_chunks").insert(rows);
        if (insErr) throw insErr;

      }
      update(item.id, { status: "done", progress: 100, statusText: `${chunks.length} fragmentos indexados`, chunksCount: chunks.length });
      return true;
    } catch (e: any) {
      console.error("[upload] failed:", e);
      const msg = e?.message ?? e?.error_description ?? JSON.stringify(e) ?? "Error";
      update(item.id, { status: "error", error: msg, statusText: "Error" });
      return false;
    }
  }

  async function handleUploadAll() {
    const ready = items.filter((it) => it.status === "ready");
    if (ready.length === 0) {
      toast.error("No hay documentos listos para subir");
      return;
    }
    const missingTitle = ready.find((it) => !it.title.trim());
    if (missingTitle) {
      toast.error(`Falta el título en: ${missingTitle.file.name}`);
      return;
    }
    const unresolved = ready.find((it) => it.duplicate && (!it.dupAction || it.dupAction === "pending"));
    if (unresolved) {
      toast.error(`Resuelve el aviso de duplicado en: ${unresolved.file.name}`);
      return;
    }
    setBusy(true);
    let success = 0;
    let failed = 0;
    const processedIds: string[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      // Sequential to respect Voyage rate limits. Continue on individual failures.
      for (const it of ready) {
        // Re-read latest state for this item (user may have edited fields)
        const live = await new Promise<QueueItem>((resolve) => {
          setItems((prev) => {
            resolve(prev.find((x) => x.id === it.id) ?? it);
            return prev;
          });
        });
        try {
          const ok = await processOne(live, user.id);
          if (ok) success++; else failed++;
          processedIds.push(it.id);
        } catch (e) {
          failed++;
          processedIds.push(it.id);
          console.error("[upload] unexpected:", e);
        }
      }
      // Build results from latest state
      const latest = await new Promise<QueueItem[]>((resolve) => {
        setItems((prev) => { resolve(prev); return prev; });
      });
      const processed = latest.filter((x) => processedIds.includes(x.id));
      const totalChunks = processed.reduce((acc, x) => acc + (x.chunksCount ?? 0), 0);
      const errors = processed
        .filter((x) => x.status === "error")
        .map((x) => ({ name: x.file.name, error: x.error ?? x.statusText ?? "Error desconocido" }));
      setResults({ success, failed, totalChunks, errors });
    } catch (e: any) {
      toast.error(e?.message ?? "Error general");
    } finally {
      setBusy(false);
    }
  }

  function handleResultsClose() {
    setResults(null);
    onClose();
  }

  const readyCount = items.filter(
    (it) => it.status === "ready" && (!it.duplicate || (it.dupAction && it.dupAction !== "pending")),
  ).length;
  const doneCount = items.filter((it) => it.status === "done").length;
  const allDone = items.length > 0 && items.every((it) => it.status === "done" || it.status === "error");

  return (
    <>
    <DialogContent className="w-[95vw] max-w-[1400px] sm:max-w-[1400px] h-auto max-h-[90vh] overflow-y-auto rounded-lg shadow-lg">
      <DialogHeader>
        <DialogTitle>Subir documentos</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label>Archivos (PDF o TXT) — selección múltiple</Label>
          <Input
            type="file"
            accept=".pdf,.txt"
            multiple
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Los metadatos se rellenarán automáticamente (PDF + IA). Puedes editarlos antes de subir.
          </p>
        </div>

        {items.length > 0 && (
          <div className="space-y-2">
            {isAdmin && (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="bulk-global" className="text-sm font-medium flex items-center gap-2">
                    <Globe2 className="h-4 w-4" />
                    Documentos globales — visibles para todos los psicólogos
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Aplica a todos los archivos de esta cola.
                  </p>
                </div>
                <Switch
                  id="bulk-global"
                  checked={items.every((it) => it.isGlobal)}
                  onCheckedChange={(v) => setItems((prev) => prev.map((it) => ({ ...it, isGlobal: v })))}
                  disabled={busy}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Cola ({items.length})</span>
              <span className="text-muted-foreground text-xs">
                {readyCount} listos · {doneCount} completados
              </span>
            </div>
            {items.map((it) => (
              <QueueRow
                key={it.id}
                item={it}
                isAdmin={isAdmin}
                disabled={busy}
                onChange={(patch) => update(it.id, patch)}
                onRemove={() => removeItem(it.id)}
              />
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {allDone ? "Cerrar" : "Cancelar"}
        </Button>
        <Button onClick={handleUploadAll} disabled={busy || readyCount === 0}>
          {busy ? "Procesando..." : `Subir ${readyCount > 0 ? `(${readyCount})` : ""}`}
        </Button>
      </DialogFooter>
    </DialogContent>

    <Dialog open={!!results} onOpenChange={(o) => { if (!o) handleResultsClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {results && results.failed === 0 ? "✅ Carga completada" : "⚠️ Carga completada con errores"}
          </DialogTitle>
        </DialogHeader>
        {results && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">✅ Documentos indexados</span>
                <span className="text-3xl font-bold text-teal-600">{results.success}</span>
              </div>
              {results.failed > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">❌ Documentos con errores</span>
                  <span className="text-3xl font-bold text-destructive">{results.failed}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">📄 Total fragmentos indexados</span>
                <span className="text-2xl font-bold">{results.totalChunks}</span>
              </div>
            </div>

            {results.errors.length > 0 && (
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium text-destructive">
                  Ver archivos con errores ({results.errors.length})
                </summary>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {results.errors.map((e, i) => (
                    <li key={i} className="border-l-2 border-destructive/40 pl-2">
                      <div className="font-medium truncate">{e.name}</div>
                      <div className="text-muted-foreground">{e.error}</div>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <Button
              className="w-full bg-teal-600 hover:bg-teal-700 text-white"
              onClick={handleResultsClose}
            >
              Cerrar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

function QueueRow({
  item, isAdmin, disabled, onChange, onRemove,
}: {
  item: QueueItem;
  isAdmin: boolean;
  disabled: boolean;
  onChange: (patch: Partial<QueueItem>) => void;
  onRemove: () => void;
}) {
  const editable = item.status === "ready" || item.status === "pending";
  const showProgress = item.status === "uploading" || item.status === "analyzing";

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <StatusIcon status={item.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{item.file.name}</span>
            <span className="text-xs text-muted-foreground">{(item.file.size / 1024).toFixed(0)} KB</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            {item.status === "analyzing" && <Sparkles className="h-3 w-3" />}
            {item.statusText}
          </div>
        </div>
        {item.status !== "uploading" && item.status !== "analyzing" && (
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={onRemove} disabled={disabled} aria-label="Quitar"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {showProgress && <Progress value={item.progress} className="h-1.5" />}

      {item.status === "ready" && item.duplicate && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs space-y-2">
          <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <span className="font-medium">⚠️ Ya existe un documento con este nombre: </span>
              <span className="font-semibold">{item.duplicate.title}</span>
              <span> — subido el {formatDate(item.duplicate.created_at)}. ¿Deseas reemplazarlo o mantener ambos?</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant={item.dupAction === "replace" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => onChange({ dupAction: "replace", statusText: "Listo (reemplazará el existente)" })}
              disabled={disabled}
            >
              Reemplazar
            </Button>
            <Button
              size="sm" variant={item.dupAction === "keep_both" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => onChange({ dupAction: "keep_both", statusText: "Listo (se subirá con sufijo)" })}
              disabled={disabled}
            >
              Mantener ambos
            </Button>
            <Button
              size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={onRemove} disabled={disabled}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {item.status === "error" && item.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive break-words">
          {item.error}
        </div>
      )}

      {(item.status === "ready" || item.status === "done") && (
        <div className="space-y-2 pt-1">
          {/* Row 1: Título (full width) */}
          <div>
            <Label className="text-xs">Título *</Label>
            <Input
              value={item.title}
              onChange={(e) => onChange({ title: e.target.value })}
              disabled={!editable || disabled}
              className="h-8 text-sm"
            />
          </div>

          {/* Row 1b: Autor + Año (auxiliary) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">Autor</Label>
              <Input
                value={item.author}
                onChange={(e) => onChange({ author: e.target.value })}
                disabled={!editable || disabled}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Año</Label>
              <Input
                value={item.year}
                onChange={(e) => onChange({ year: e.target.value })}
                disabled={!editable || disabled}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Row 2: Tipo (1/3) | Fuente / Institución (2/3) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select
                value={item.docType}
                onValueChange={(v) => onChange({ docType: v as DocType })}
                disabled={!editable || disabled}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Fuente / Institución</Label>
              <SourceInstitutionPicker
                value={item.sourceInstitution}
                onChange={(name, type) =>
                  onChange({
                    sourceInstitution: name,
                    sourceInstitutionType: type ?? item.sourceInstitutionType,
                  })
                }
                disabled={!editable || disabled}
              />
            </div>
          </div>

          {/* Row 3: Áreas clínicas (full width multi-select with chips) */}
          <div>
            <Label className="text-xs">Área(s) clínica(s)</Label>
            <ClinicalAreasPicker
              value={item.clinicalAreas}
              onChange={(areas) => onChange({ clinicalAreas: areas })}
              disabled={!editable || disabled}
            />
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={item.isGlobal}
                onCheckedChange={(v) => onChange({ isGlobal: v })}
                disabled={!editable || disabled}
              />
              <span className="text-xs text-muted-foreground">Documento global</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function StatusIcon({ status }: { status: QueueStatus }) {
  if (status === "analyzing" || status === "uploading")
    return <Loader2 className="h-4 w-4 mt-0.5 text-primary animate-spin" />;
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />;
  if (status === "error")
    return <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />;
  if (status === "ready")
    return <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground" />;
  return <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />;
}

function ClinicalAreasPicker({
  value, onChange, disabled,
}: {
  value: string[];
  onChange: (areas: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  function toggle(area: string) {
    const next = new Set(selected);
    if (next.has(area)) {
      next.delete(area);
    } else {
      if (next.size >= MAX_CLINICAL_AREAS) {
        toast.error(`Máximo ${MAX_CLINICAL_AREAS} áreas clínicas`);
        return;
      }
      next.add(area);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[28px] items-center">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">Sin áreas seleccionadas</span>
        )}
        {value.map((a) => (
          <span
            key={a}
            className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${clinicalAreaColor(a)}`}
          >
            {clinicalAreaLabel(a)}
            {!disabled && (
              <button
                type="button"
                onClick={() => toggle(a)}
                className="hover:opacity-70"
                aria-label={`Quitar ${clinicalAreaLabel(a)}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-8 text-xs justify-between w-full sm:w-auto"
          >
            <span>Agregar / quitar áreas ({value.length}/{MAX_CLINICAL_AREAS})</span>
            <ChevronsUpDown className="h-3 w-3 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar área clínica..." className="h-8" />
            <CommandList className="max-h-72">
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup heading="Categorías NICE">
                {CLINICAL_AREAS_NICE.map((a) => {
                  const isSel = selected.has(a);
                  return (
                    <CommandItem key={a} value={CLINICAL_AREA_LABELS[a]} onSelect={() => toggle(a)}>
                      <Check className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`} />
                      {CLINICAL_AREA_LABELS[a]}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandGroup heading="Categorías transversales">
                {CLINICAL_AREAS_TRANSVERSAL.map((a) => {
                  const isSel = selected.has(a);
                  return (
                    <CommandItem key={a} value={CLINICAL_AREA_LABELS[a]} onSelect={() => toggle(a)}>
                      <Check className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`} />
                      {CLINICAL_AREA_LABELS[a]}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SourceInstitutionPicker({
  value, onChange, disabled,
}: {
  value: string;
  onChange: (name: string, type?: SourceInstitutionType) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const grouped = SOURCE_INSTITUTIONS.reduce<Record<string, typeof SOURCE_INSTITUTIONS>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-8 text-sm justify-between w-full font-normal"
        >
          <span className="truncate">
            {value ? `${sourceIconFor(value)} ${value}` : "Seleccionar fuente o escribir..."}
          </span>
          <ChevronsUpDown className="h-3 w-3 opacity-50 ml-2 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Buscar o escribir fuente..."
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.currentTarget.value ?? "").trim();
                if (v) {
                  onChange(v, "otro");
                  setOpen(false);
                }
              }
            }}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              <div className="text-xs text-muted-foreground p-2">
                Pulsa Enter para usar el texto escrito como fuente personalizada.
              </div>
            </CommandEmpty>
            {value && (
              <CommandGroup heading="Acción">
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange("", undefined); setOpen(false); }}
                >
                  <X className="mr-2 h-4 w-4" /> Quitar fuente
                </CommandItem>
              </CommandGroup>
            )}
            {Object.entries(grouped).map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((s) => (
                  <CommandItem
                    key={s.name}
                    value={s.name}
                    onSelect={() => { onChange(s.name, s.type); setOpen(false); }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${value.toLowerCase() === s.name.toLowerCase() ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="mr-1">{s.icon}</span> {s.name}
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
