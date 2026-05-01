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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Trash2, FileText, Globe2 } from "lucide-react";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import { extractPdfText, extractTxtText, chunkText } from "@/lib/pdf";

interface Doc {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  document_type: DocType;
  is_global: boolean;
  psychologist_id: string;
  created_at: string;
}

export default function Documents() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    setDocs((data as Doc[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este documento y todos sus fragmentos?")) return;
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Documento eliminado");
    load();
  }

  const global = docs.filter((d) => d.is_global);
  const own = docs.filter((d) => !d.is_global && d.psychologist_id === user?.id);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Documentos</h1>
          <p className="text-muted-foreground text-sm mt-1">Base de conocimiento clínica</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Upload className="h-4 w-4" />Subir documento</Button>
          </DialogTrigger>
          <UploadDialog onClose={() => { setOpen(false); load(); }} isAdmin={!!profile?.is_admin} />
        </Dialog>
      </header>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Globe2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Documentos globales</h2>
          <span className="text-xs text-muted-foreground">({global.length})</span>
        </div>
        <DocList docs={global} loading={loading} ownUserId={user?.id} onDelete={handleDelete} canDelete={false} />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Mis documentos</h2>
          <span className="text-xs text-muted-foreground">({own.length})</span>
        </div>
        <DocList docs={own} loading={loading} ownUserId={user?.id} onDelete={handleDelete} canDelete />
      </section>
    </div>
  );
}

function DocList({ docs, loading, onDelete, canDelete }: { docs: Doc[]; loading: boolean; ownUserId?: string; onDelete: (id: string) => void; canDelete: boolean }) {
  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}</div>;
  if (docs.length === 0) return <Card className="p-6 text-center text-sm text-muted-foreground">Sin documentos en esta sección.</Card>;
  return (
    <div className="grid gap-2">
      {docs.map((d) => (
        <Card key={d.id} className="p-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center flex-shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{d.title}</span>
              <Badge variant="secondary" className="text-[10px]">{DOC_TYPE_LABELS[d.document_type]}</Badge>
            </div>
            <div className="text-sm text-muted-foreground truncate">
              {d.author ?? "Autor desconocido"}{d.year ? ` · ${d.year}` : ""}
            </div>
          </div>
          {canDelete && (
            <Button variant="ghost" size="icon" onClick={() => onDelete(d.id)} aria-label="Eliminar">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function UploadDialog({ onClose, isAdmin }: { onClose: () => void; isAdmin: boolean }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [docType, setDocType] = useState<DocType>("articulo_cientifico");
  const [isGlobal, setIsGlobal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleUpload() {
    if (!file || !title) { toast.error("Título y archivo son obligatorios"); return; }
    setBusy(true);
    setErrorMsg(null);
    setStatus("Extrayendo texto...");
    setProgress(2);
    console.log("[upload] start", { name: file.name, size: file.size, type: file.type });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      console.log("[upload] authenticated user", user.id);

      console.log("[upload] extracting text...");
      const text = file.type === "application/pdf" || file.name.endsWith(".pdf")
        ? await extractPdfText(file)
        : await extractTxtText(file);
      console.log("[upload] extracted text length:", text.length);

      console.log("[upload] chunking started");
      const chunks = chunkText(text);
      console.log("[upload] chunking complete:", chunks.length, "chunks");
      if (chunks.length === 0) throw new Error("No se pudo extraer texto del archivo");

      setStatus("Creando documento...");
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          psychologist_id: user.id,
          title, author: author || null, year: year || null,
          document_type: docType, is_global: isGlobal && isAdmin,
        })
        .select()
        .single();
      if (docErr) { console.error("[upload] insert document error:", docErr); throw docErr; }
      console.log("[upload] document created:", doc.id);

      // Embed in batches of 8. Voyage free tier = 3 RPM, so pace ~22s between batches.
      const batchSize = 8;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        setStatus(`Procesando lote ${batchNum} de ${totalBatches} (${chunks.length} fragmentos)...`);
        setProgress(Math.round((i / chunks.length) * 95) + 2);

        console.log(`[upload] embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks) → voyage-embed`);
        const t0 = performance.now();
        const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
          body: { input: batch.map((c) => c.content), input_type: "document" },
        });
        const dt = Math.round(performance.now() - t0);
        if (embErr) { console.error(`[upload] voyage-embed invoke error (batch ${batchNum}, ${dt}ms):`, embErr); throw embErr; }
        if (embData?.error) { console.error(`[upload] voyage-embed returned error (batch ${batchNum}):`, embData.error); throw new Error(embData.error); }
        const embeddings: number[][] = embData.embeddings;
        console.log(`[upload] received ${embeddings?.length ?? 0} embeddings for batch ${batchNum} in ${dt}ms`);

        const rows = batch.map((c, idx) => ({
          document_id: doc.id,
          psychologist_id: user.id,
          chunk_index: c.index,
          content: c.content,
          page_number: c.page_number,
          embedding: embeddings[idx] as any,
        }));
        console.log(`[upload] saving ${rows.length} chunks to Supabase (batch ${batchNum})`);
        const { error: insErr } = await supabase.from("document_chunks").insert(rows);
        if (insErr) { console.error(`[upload] insert chunks error (batch ${batchNum}):`, insErr); throw insErr; }
        console.log(`[upload] saved batch ${batchNum}/${totalBatches}`);

        // Pace requests to stay under Voyage free-tier limit (3 RPM)
        if (batchNum < totalBatches) {
          setStatus(`Esperando límite de tasa de Voyage (lote ${batchNum}/${totalBatches} listo)...`);
          await new Promise((r) => setTimeout(r, 22000));
        }
      }

      setProgress(100);
      console.log("[upload] complete:", chunks.length, "chunks indexed");
      toast.success(`Documento procesado: ${chunks.length} fragmentos indexados`);
      onClose();
    } catch (e: any) {
      console.error("[upload] FAILED:", e);
      const msg = e?.message ?? e?.error_description ?? JSON.stringify(e) ?? "Error al procesar documento";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Subir documento</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Título *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Autor</Label><Input value={author} onChange={(e) => setAuthor(e.target.value)} disabled={busy} /></div>
          <div><Label>Año</Label><Input value={year} onChange={(e) => setYear(e.target.value)} disabled={busy} /></div>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={docType} onValueChange={(v) => setDocType(v as DocType)} disabled={busy}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Archivo (PDF o TXT)</Label>
          <Input type="file" accept=".pdf,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
        </div>
        {isAdmin && (
          <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
            <div>
              <div className="text-sm font-medium">Documento global</div>
              <div className="text-xs text-muted-foreground">Visible para todos los psicólogos</div>
            </div>
            <Switch checked={isGlobal} onCheckedChange={setIsGlobal} disabled={busy} />
          </div>
        )}
        {busy && (
          <div className="space-y-1 pt-2">
            <Progress value={progress} />
            <div className="text-xs text-muted-foreground">{status}</div>
          </div>
        )}
        {errorMsg && !busy && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <div className="font-medium mb-1">Error al procesar documento</div>
            <div className="text-xs break-words whitespace-pre-wrap">{errorMsg}</div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={handleUpload} disabled={busy}>{busy ? "Procesando..." : "Subir"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
