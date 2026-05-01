import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import { Upload, Trash2, FileText, Globe2, Loader2, CheckCircle2, AlertCircle, X, Sparkles, Eye } from "lucide-react";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import { extractPdfTextAndMeta, extractTxtText, chunkText } from "@/lib/pdf";
import GoogleDriveImport from "@/components/GoogleDriveImport";

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
}

export default function Documents() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const global = docs.filter((d) => d.is_global);
  const own = docs.filter((d) => !d.is_global && d.psychologist_id === user?.id);
  const selectedCount = selected.size;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Documentos</h1>
          <p className="text-muted-foreground text-sm mt-1">Base de conocimiento clínica</p>
        </div>
        <div className="flex items-center gap-2">
          <GoogleDriveImport isAdmin={isAdmin} onImported={load} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Upload className="h-4 w-4" />Subir documentos</Button>
            </DialogTrigger>
            <UploadDialog onClose={() => { setOpen(false); load(); }} isAdmin={isAdmin} />
          </Dialog>
        </div>
      </header>

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
  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}</div>;
  if (docs.length === 0) return <Card className="p-6 text-center text-sm text-muted-foreground">Sin documentos en esta sección.</Card>;
  return (
    <div className="grid gap-2">
      {docs.map((d) => {
        const canDelete = canDeleteDoc(d);
        const isSelected = selected.has(d.id);
        return (
          <Card
            key={d.id}
            className={`p-4 flex items-center gap-3 transition-colors ${isSelected ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
          >
            {canDelete ? (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggle(d.id)}
                aria-label={`Seleccionar ${d.title}`}
              />
            ) : (
              <div className="w-4" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => onView(d)}
              className="h-10 w-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center flex-shrink-0 hover:opacity-80 transition"
              aria-label="Ver documento"
            >
              <FileText className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onView(d)}
                  className="font-medium truncate text-left hover:underline focus:outline-none focus:underline"
                >
                  {d.title}
                </button>
                <Badge variant="secondary" className="text-[10px]">{DOC_TYPE_LABELS[d.document_type]}</Badge>
              </div>
              <div className="text-sm text-muted-foreground truncate">
                {d.author ?? "Autor desconocido"}{d.year ? ` · ${d.year}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => onView(d)} aria-label="Ver">
              <Eye className="h-4 w-4" />
            </Button>
            {canDelete && (
              <Button variant="ghost" size="icon" onClick={() => onDelete(d.id)} aria-label="Eliminar">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </Card>
        );
      })}
    </div>
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

interface QueueItem {
  id: string;
  file: File;
  title: string;
  author: string;
  year: string;
  docType: DocType;
  isGlobal: boolean;
  status: QueueStatus;
  progress: number;
  statusText: string;
  error?: string;
  // cached extracted text so we don't re-parse during upload
  cachedText?: string;
}

function UploadDialog({ onClose, isAdmin }: { onClose: () => void; isAdmin: boolean }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);

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

      if (item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf")) {
        const { text: t, meta } = await extractPdfTextAndMeta(item.file);
        text = t;
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
        if (meta.year) year = meta.year;
      } else {
        text = await extractTxtText(item.file);
      }

      // If any field is missing, ask AI
      if (!title || !author || !year) {
        update(item.id, { statusText: "Completando metadatos con IA..." });
        try {
          const { data, error } = await supabase.functions.invoke("extract-metadata", {
            body: { text },
          });
          if (!error && data && !data.error) {
            if (!title && data.title) title = data.title;
            if (!author && data.author) author = data.author;
            if (!year && data.year) year = data.year;
          } else if (error || data?.error) {
            console.warn("[upload] metadata AI failed:", error ?? data?.error);
          }
        } catch (e) {
          console.warn("[upload] metadata AI exception:", e);
        }
      }

      update(item.id, {
        status: "ready",
        statusText: "Listo para subir",
        title,
        author,
        year,
        cachedText: text,
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
      status: "pending",
      progress: 0,
      statusText: "En cola",
    }));
    setItems((prev) => [...prev, ...next]);
    // Kick off analysis sequentially to avoid CPU/memory spike on large PDFs
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
          title: item.title,
          author: item.author || null,
          year: item.year || null,
          document_type: item.docType,
          is_global: item.isGlobal && isAdmin,
          storage_path: storagePath,
        })
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
        }));
        const { error: insErr } = await supabase.from("document_chunks").insert(rows);
        if (insErr) throw insErr;

        if (batchNum < totalBatches) {
          update(item.id, { statusText: `Esperando límite Voyage (${batchNum}/${totalBatches})...` });
          await new Promise((r) => setTimeout(r, 22000));
        }
      }
      update(item.id, { status: "done", progress: 100, statusText: `${chunks.length} fragmentos indexados` });
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
    setBusy(true);
    let success = 0;
    let failed = 0;
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
        } catch (e) {
          failed++;
          console.error("[upload] unexpected:", e);
        }
      }
      toast.success(`${success} documento${success === 1 ? "" : "s"} procesado${success === 1 ? "" : "s"} correctamente, ${failed} con error${failed === 1 ? "" : "es"}.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error general");
    } finally {
      setBusy(false);
    }
  }

  const readyCount = items.filter((it) => it.status === "ready").length;
  const doneCount = items.filter((it) => it.status === "done").length;
  const allDone = items.length > 0 && items.every((it) => it.status === "done" || it.status === "error");

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
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

      {item.status === "error" && item.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive break-words">
          {item.error}
        </div>
      )}

      {(item.status === "ready" || item.status === "done") && (
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 pt-1">
          <div className="sm:col-span-3">
            <Label className="text-xs">Título *</Label>
            <Input
              value={item.title}
              onChange={(e) => onChange({ title: e.target.value })}
              disabled={!editable || disabled}
              className="h-8 text-sm"
            />
          </div>
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
          <div className="sm:col-span-3">
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
          {isAdmin && (
            <div className="sm:col-span-3 flex items-end gap-2 pb-1">
              <Switch
                checked={item.isGlobal}
                onCheckedChange={(v) => onChange({ isGlobal: v })}
                disabled={!editable || disabled}
              />
              <span className="text-xs text-muted-foreground">Global</span>
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
