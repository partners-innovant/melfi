import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Loader2, FileText, X, FolderOpen } from "lucide-react";
import { chunkText } from "@/lib/pdf";
import * as pdfjs from "pdfjs-dist";
// @ts-ignore
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type Status = "pending" | "downloading" | "analyzing" | "uploading" | "done" | "error";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

interface QueueItem {
  driveId: string;
  name: string;
  status: Status;
  progress: number;
  statusText: string;
  error?: string;
}

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let gapiLoaded = false;
let gisLoaded = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}

async function ensurePicker(): Promise<void> {
  if (!gapiLoaded) {
    await loadScript("https://apis.google.com/js/api.js");
    await new Promise<void>((resolve) => window.gapi.load("picker", () => resolve()));
    gapiLoaded = true;
  }
  if (!gisLoaded) {
    await loadScript("https://accounts.google.com/gsi/client");
    gisLoaded = true;
  }
}

export default function GoogleDriveImport({
  isAdmin: _isAdmin,
  onImported,
}: {
  isAdmin: boolean;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);
  const accessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setConnected(false);
      const { data } = await supabase
        .from("profiles")
        .select("google_calendar_token")
        .eq("id", user.id)
        .maybeSingle();
      setConnected(!!data?.google_calendar_token);
    })();
  }, []);

  function update(driveId: string, patch: Partial<QueueItem>) {
    setItems((prev) => prev.map((it) => (it.driveId === driveId ? { ...it, ...patch } : it)));
  }

  async function openPicker() {
    setOpening(true);
    try {
      await ensurePicker();
      const { data, error } = await supabase.functions.invoke("calendar-sync", {
        body: { action: "get_picker_config" },
      });
      if (error || !data || data.error) {
        const code = data?.error;
        if (code === "not_connected" || code === "token_expired") {
          toast.error("Conecta tu cuenta de Google primero (Calendario → Conectar Google).");
        } else {
          toast.error(data?.error ?? error?.message ?? "Error obteniendo token");
        }
        return;
      }
      const accessToken: string = data.access_token;
      const apiKey: string = data.api_key;
      const scopes: string[] = data.scopes ?? [];
      if (!apiKey) {
        toast.error("Falta GOOGLE_PICKER_API_KEY en el servidor.");
        return;
      }
      if (!scopes.includes("https://www.googleapis.com/auth/drive.readonly")) {
        toast.error("Tu sesión de Google no tiene permiso de Drive. Reconecta Google Calendar para conceder acceso a Drive.");
        return;
      }
      accessTokenRef.current = accessToken;

      const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setMimeTypes("application/pdf")
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const sharedView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setMimeTypes("application/pdf")
        .setEnableDrives(true)
        .setIncludeFolders(true);

      const picker = new window.google.picker.PickerBuilder()
        .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
        .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .addView(view)
        .addView(sharedView)
        .setCallback((result: any) => {
          if (result.action === window.google.picker.Action.PICKED) {
            const docs = (result.docs ?? []) as any[];
            const files: DriveFile[] = docs.map((d) => ({
              id: d.id,
              name: d.name,
              mimeType: d.mimeType,
              sizeBytes: d.sizeBytes ? Number(d.sizeBytes) : undefined,
            }));
            const queued: QueueItem[] = files.map((f) => ({
              driveId: f.id,
              name: f.name,
              status: "pending",
              progress: 0,
              statusText: "En cola",
            }));
            setItems((prev) => [...prev, ...queued]);
            setOpen(true);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e: any) {
      console.error("[drive-picker] error:", e);
      toast.error(e?.message ?? "Error abriendo Google Picker");
    } finally {
      setOpening(false);
    }
  }

  async function downloadDriveFile(fileId: string, accessToken: string): Promise<{ blob: Blob }> {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Drive ${res.status}: ${t.slice(0, 200)}`);
    }
    const blob = await res.blob();
    return { blob };
  }

  async function extractText(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str).join(" ") + "\n\n";
    }
    return text;
  }

  async function processOne(item: QueueItem, userId: string): Promise<boolean> {
    const accessToken = accessTokenRef.current;
    if (!accessToken) throw new Error("No access token");
    try {
      update(item.driveId, { status: "downloading", progress: 5, statusText: "Descargando de Drive..." });
      const { blob } = await downloadDriveFile(item.driveId, accessToken);

      update(item.driveId, { status: "analyzing", progress: 15, statusText: "Extrayendo texto..." });
      const text = await extractText(blob);
      const chunks = chunkText(text);
      if (chunks.length === 0) throw new Error("PDF sin texto extraíble");

      // Try AI metadata
      let title = item.name.replace(/\.pdf$/i, "");
      let author = "";
      let year = "";
      try {
        const { data, error } = await supabase.functions.invoke("extract-metadata", {
          body: { text: text.slice(0, 2000) },
        });
        if (!error && data && !data.error) {
          if (data.title) title = data.title;
          if (data.author) author = data.author;
          if (data.year) year = data.year;
        }
      } catch (e) {
        console.warn("[drive-import] metadata AI:", e);
      }

      update(item.driveId, { status: "uploading", progress: 25, statusText: "Subiendo archivo..." });
      const storagePath = `${userId}/${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, blob, { contentType: "application/pdf", upsert: false });
      if (upErr) throw new Error(`Storage: ${upErr.message}`);

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          psychologist_id: userId,
          title,
          author: author || null,
          year: year || null,
          document_type: "articulo_cientifico",
          is_global: false,
          storage_path: storagePath,
        })
        .select()
        .single();
      if (docErr) {
        await supabase.storage.from("documents").remove([storagePath]);
        throw docErr;
      }

      const batchSize = 8;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        update(item.driveId, {
          progress: 25 + Math.round((i / chunks.length) * 70),
          statusText: `Embedding lote ${batchNum}/${totalBatches}`,
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
          update(item.driveId, { statusText: `Esperando límite Voyage (${batchNum}/${totalBatches})...` });
          await new Promise((r) => setTimeout(r, 22000));
        }
      }

      update(item.driveId, { status: "done", progress: 100, statusText: `${chunks.length} fragmentos indexados` });
      return true;
    } catch (e: any) {
      console.error("[drive-import] failed:", e);
      update(item.driveId, { status: "error", error: e?.message ?? "Error", statusText: "Error" });
      return false;
    }
  }

  async function processAll() {
    const pending = items.filter((it) => it.status === "pending");
    if (pending.length === 0) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      let success = 0, failed = 0;
      for (const it of pending) {
        const ok = await processOne(it, user.id);
        if (ok) success++; else failed++;
      }
      toast.success(`${success} importado${success === 1 ? "" : "s"}, ${failed} con error${failed === 1 ? "" : "es"}.`);
      onImported();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.driveId !== id));
  }

  if (connected === false) {
    return (
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => toast.info("Conecta tu cuenta de Google desde Calendario para importar desde Drive.")}
      >
        <FolderOpen className="h-4 w-4" />
        Importar desde Google Drive
      </Button>
    );
  }

  const pendingCount = items.filter((it) => it.status === "pending").length;
  const allDone = items.length > 0 && items.every((it) => it.status === "done" || it.status === "error");

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={openPicker} disabled={opening || connected === null}>
        <FolderOpen className="h-4 w-4" />
        {opening ? "Abriendo..." : "Importar desde Google Drive"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar desde Google Drive</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {items.length} archivo{items.length === 1 ? "" : "s"} seleccionado{items.length === 1 ? "" : "s"}
            </div>
            {items.map((it) => (
              <Card key={it.driveId} className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <StatusIcon status={it.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{it.statusText}</div>
                  </div>
                  {it.status === "pending" && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(it.driveId)} disabled={busy}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {(it.status === "downloading" || it.status === "analyzing" || it.status === "uploading") && (
                  <Progress value={it.progress} className="h-1.5" />
                )}
                {it.status === "error" && it.error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive break-words">
                    {it.error}
                  </div>
                )}
              </Card>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {allDone ? "Cerrar" : "Cancelar"}
            </Button>
            <Button onClick={processAll} disabled={busy || pendingCount === 0}>
              {busy ? "Procesando..." : `Importar ${pendingCount > 0 ? `(${pendingCount})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "downloading" || status === "analyzing" || status === "uploading")
    return <Loader2 className="h-4 w-4 mt-0.5 text-primary animate-spin" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />;
  return <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />;
}
