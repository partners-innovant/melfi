import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Link2, Loader2, CheckCircle2, AlertCircle, Globe2, AlertTriangle } from "lucide-react";
import { chunkText } from "@/lib/pdf";
import { findDuplicateByUrl, deleteDocumentAndChunks, formatDate, type DuplicateDoc } from "@/lib/duplicates";

type Status = "queued" | "checking" | "duplicate" | "downloading" | "processing" | "done" | "error" | "skipped";
type DupAction = "pending" | "reimport" | "skip";

interface QItem {
  id: string;
  url: string;
  status: Status;
  message: string;
  duplicate?: DuplicateDoc | null;
  dupAction?: DupAction;
}

function truncate(s: string, n = 60) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function UrlImportDialog({
  isAdmin,
  onImported,
  initialUrl,
  forceOpen,
  onOpenChange,
}: {
  isAdmin: boolean;
  onImported: () => void;
  initialUrl?: string;
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [items, setItems] = useState<QItem[]>([]);
  const [busy, setBusy] = useState(false);

  // Open + prefill when an external URL is requested
  useEffect(() => {
    if (forceOpen && initialUrl) {
      setText((prev) => (prev.trim() ? prev : initialUrl));
      setOpen(true);
    }
  }, [forceOpen, initialUrl]);

  function update(id: string, patch: Partial<QItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function reset() {
    setText("");
    setItems([]);
    setIsGlobal(false);
  }

  async function processOne(it: QItem, userId: string): Promise<boolean> {
    update(it.id, { status: "downloading", message: "Descargando…" });
    try {
      // If user chose "reimport", delete the existing record + chunks first.
      if (it.duplicate && it.dupAction === "reimport") {
        update(it.id, { message: "Eliminando importación previa…" });
        try {
          await deleteDocumentAndChunks(it.duplicate);
        } catch (e: any) {
          console.warn("[url-import] delete previous failed:", e?.message);
        }
      }

      const { data, error } = await supabase.functions.invoke("fetch-url-document", {
        body: { url: it.url },
      });
      if (error) throw new Error(error.message ?? "Error de servidor");
      if (!data?.ok) {
        update(it.id, { status: "error", message: data?.error ?? "Error desconocido" });
        return false;
      }

      update(it.id, { status: "processing", message: "Generando embeddings…" });

      const chunks = chunkText(data.text);
      if (chunks.length === 0) {
        update(it.id, { status: "error", message: "Sin contenido para indexar" });
        return false;
      }

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          psychologist_id: userId,
          title: data.title || it.url,
          author: data.author || null,
          year: data.year || null,
          document_type: data.document_type || "articulo_cientifico",
          is_global: isGlobal && isAdmin,
          storage_path: null,
          source_url: data.source_url || it.url,
          import_source: 'url',
        } as any)
        .select()
        .single();
      if (docErr) throw docErr;

      const batchSize = 8;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        update(it.id, { message: `Lote ${batchNum}/${totalBatches} (${chunks.length} fragmentos)` });
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
      }

      update(it.id, { status: "done", message: `✓ ${chunks.length} fragmentos indexados` });
      return true;
    } catch (e: any) {
      console.error("[url-import] failed:", e);
      update(it.id, { status: "error", message: e?.message ?? "Error" });
      return false;
    }
  }

  // Phase 1: parse URLs, validate, and check each against existing documents.
  async function handleCheck() {
    const urls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (urls.length === 0) {
      toast.error("Agrega al menos una URL");
      return;
    }

    const initial: QItem[] = urls.map((u) => {
      try {
        const parsed = new URL(u);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("protocolo");
        return { id: crypto.randomUUID(), url: u, status: "checking" as Status, message: "Comprobando duplicados…" };
      } catch {
        return { id: crypto.randomUUID(), url: u, status: "error" as Status, message: "URL inválida" };
      }
    });
    setItems(initial);

    setBusy(true);
    try {
      for (const it of initial) {
        if (it.status === "error") continue;
        try {
          const dup = await findDuplicateByUrl(it.url);
          if (dup) {
            update(it.id, {
              status: "duplicate",
              duplicate: dup,
              dupAction: "pending",
              message: `Ya importado el ${formatDate(dup.created_at)} como: ${dup.title}`,
            });
          } else {
            update(it.id, { status: "queued", message: "Listo para importar" });
          }
        } catch (e) {
          console.warn("[url-import] dup check failed:", e);
          update(it.id, { status: "queued", message: "Listo para importar" });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // Phase 2: actually import all queued items + duplicates flagged "reimport".
  async function handleImport() {
    setBusy(true);
    let success = 0, failed = 0, skipped = 0;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const live = await new Promise<QItem[]>((resolve) => {
        setItems((prev) => { resolve(prev); return prev; });
      });
      for (const it of live) {
        if (it.status === "queued") {
          const ok = await processOne(it, user.id);
          if (ok) success++; else failed++;
        } else if (it.status === "duplicate" && it.dupAction === "reimport") {
          const ok = await processOne(it, user.id);
          if (ok) success++; else failed++;
        } else if (it.status === "duplicate" && it.dupAction === "skip") {
          update(it.id, { status: "skipped", message: "Saltado (ya existía)" });
          skipped++;
        }
      }
      const parts = [`${success} importado${success === 1 ? "" : "s"}`, `${failed} con error${failed === 1 ? "" : "es"}`];
      if (skipped > 0) parts.push(`${skipped} saltado${skipped === 1 ? "" : "s"}`);
      toast.success(parts.join(", "));
      if (success > 0) onImported();
    } catch (e: any) {
      toast.error(e?.message ?? "Error general");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && !busy) reset();
        onOpenChange?.(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Link2 className="h-4 w-4" />Importar desde URL
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar documentos desde URLs</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="urls">URLs (una por línea)</Label>
            <Textarea
              id="urls"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              rows={6}
              placeholder={`Pega uno o más URLs de documentos PDF, uno por línea.\nEjemplo:\nhttps://www.nice.org.uk/guidance/cg113/resources/...\nhttps://pmc.ncbi.nlm.nih.gov/articles/PMC3383087/pdf/...`}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Soporta PDFs y artículos HTML públicos. Los documentos detrás de paywall no funcionarán.
            </p>
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="url-global" className="text-sm font-medium flex items-center gap-2">
                  <Globe2 className="h-4 w-4" />
                  Documento global — visible para todos los psicólogos
                </Label>
                <p className="text-xs text-muted-foreground">Aplica a todos los URLs de esta cola.</p>
              </div>
              <Switch
                id="url-global"
                checked={isGlobal}
                onCheckedChange={setIsGlobal}
                disabled={busy}
              />
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Cola ({items.length})</div>
              {items.map((it) => (
                <div key={it.id} className="rounded-md border p-2 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={it.status} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono">{truncate(it.url, 70)}</div>
                      <div className={`mt-0.5 ${it.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {it.message}
                      </div>
                    </div>
                  </div>
                  {it.status === "duplicate" && it.duplicate && (
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs space-y-2">
                      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="flex-1">
                          <span className="font-medium">⚠️ Este documento ya fue importado el {formatDate(it.duplicate.created_at)} como: </span>
                          <span className="font-semibold">{it.duplicate.title}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm" variant={it.dupAction === "reimport" ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => update(it.id, { dupAction: "reimport", message: "Listo para reimportar (reemplazará el existente)" })}
                          disabled={busy}
                        >Reimportar</Button>
                        <Button
                          size="sm" variant={it.dupAction === "skip" ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => update(it.id, { dupAction: "skip", message: "Se saltará en la importación" })}
                          disabled={busy}
                        >Saltar</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cerrar
          </Button>
          {items.length === 0 ? (
            <Button onClick={handleCheck} disabled={busy || text.trim().length === 0}>
              {busy ? "Comprobando…" : "Procesar URLs"}
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={
                busy ||
                items.some((it) => it.status === "duplicate" && (!it.dupAction || it.dupAction === "pending"))
              }
            >
              {busy ? "Importando…" : "Importar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "checking" || status === "downloading" || status === "processing")
    return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "duplicate") return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />;
  if (status === "skipped") return <X className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />;
}
}
