import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Search, ExternalLink, ChevronDown, ChevronUp, AlertCircle, FlaskConical, FileText,
} from "lucide-react";
import { ClassifyPreviewDialog, type ClassifyTarget } from "@/components/ClassifyPreviewDialog";
import { chunkText } from "@/lib/pdf";
import type { DocType } from "@/lib/clinical";

export interface PubMedArticle {
  europepmc_id: string;
  source: string;
  pubmed_id: string | null;
  pmc_id: string | null;
  doi: string | null;
  title: string;
  authors: string;
  journal: string;
  year: string;
  abstract: string;
  has_pdf: boolean;
  is_open_access: boolean;
  pdf_url: string | null;
  article_url: string;
}

const DOWNLOAD_DELAY_MS = 2000;

export function PubMedSearchDialog({
  open,
  onOpenChange,
  onImported,
  initialQuery,
  autoSearch = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: () => void;
  initialQuery?: string;
  autoSearch?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[1100px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Buscar en PubMed
          </DialogTitle>
        </DialogHeader>
        <PubMedPanel
          initialQuery={initialQuery ?? ""}
          autoSearch={autoSearch}
          onImported={onImported}
          isAdmin
        />
      </DialogContent>
    </Dialog>
  );
}

export function PubMedPanel({
  initialQuery = "",
  autoSearch = false,
  onImported,
  isAdmin = false,
  className,
}: {
  initialQuery?: string;
  autoSearch?: boolean;
  onImported?: () => void;
  isAdmin?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [onlyPdf, setOnlyPdf] = useState(true);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PubMedArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState<Record<string, string>>({});
  const [classifyTarget, setClassifyTarget] = useState<ClassifyTarget | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);

  // Serialize PDF downloads with delay between them
  const downloadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastDownloadAtRef = useRef<number>(0);

  const autoRan = useRef(false);
  useEffect(() => {
    if (autoSearch && !autoRan.current && initialQuery.trim()) {
      autoRan.current = true;
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, initialQuery]);

  async function runSearch() {
    if (!query.trim()) {
      toast.error("Escribe un término de búsqueda");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data, error: fnErr }, libRes] = await Promise.all([
        supabase.functions.invoke("search-pubmed", {
          body: { action: "search", query, onlyPdf },
        }),
        supabase
          .from("documents")
          .select("pubmed_id, pmc_id, europepmc_id, source_url"),
      ]);
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setResults((data?.articles ?? []) as PubMedArticle[]);
      const ids = new Set<string>();
      for (const r of (libRes.data ?? []) as Array<{ pubmed_id: string | null; pmc_id: string | null; europepmc_id: string | null; source_url: string | null }>) {
        if (r.pubmed_id) ids.add(`pmid:${r.pubmed_id}`);
        if (r.pmc_id) ids.add(`pmc:${r.pmc_id}`);
        if (r.europepmc_id) ids.add(`epmc:${r.europepmc_id}`);
        if (r.source_url) ids.add(`url:${r.source_url}`);
      }
      setExisting(ids);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function isInLibrary(a: PubMedArticle): boolean {
    if (a.pubmed_id && existing.has(`pmid:${a.pubmed_id}`)) return true;
    if (a.pmc_id && existing.has(`pmc:${a.pmc_id}`)) return true;
    if (a.europepmc_id && existing.has(`epmc:${a.europepmc_id}`)) return true;
    if (a.pdf_url && existing.has(`url:${a.pdf_url}`)) return true;
    return false;
  }

  async function handleImportPdf(article: PubMedArticle) {
    if (!article.pdf_url) return;
    setImportingIds((s) => new Set(s).add(article.europepmc_id));
    setImportStatus((m) => ({ ...m, [article.europepmc_id]: "En cola..." }));

    // Chain into the serial queue with a 2s gap between downloads
    const job = downloadQueueRef.current.then(async () => {
      const wait = Math.max(0, DOWNLOAD_DELAY_MS - (Date.now() - lastDownloadAtRef.current));
      if (wait > 0) {
        setImportStatus((m) => ({ ...m, [article.europepmc_id]: `Esperando ${Math.ceil(wait / 1000)}s...` }));
        await new Promise((r) => setTimeout(r, wait));
      }
      lastDownloadAtRef.current = Date.now();
      try {
        const target = await importArticlePdf(article, isAdmin, (s) =>
          setImportStatus((m) => ({ ...m, [article.europepmc_id]: s })),
        );
        setExisting((prev) => {
          const next = new Set(prev);
          if (article.pubmed_id) next.add(`pmid:${article.pubmed_id}`);
          if (article.pmc_id) next.add(`pmc:${article.pmc_id}`);
          if (article.europepmc_id) next.add(`epmc:${article.europepmc_id}`);
          if (article.pdf_url) next.add(`url:${article.pdf_url}`);
          return next;
        });
        setClassifyTarget(target);
        setClassifyOpen(true);
        toast.success("✅ PDF importado correctamente");
      } catch (e) {
        console.error("[pubmed] import failed", e);
        toast.error(e instanceof Error ? e.message : "Error al importar");
      } finally {
        setImportingIds((s) => {
          const next = new Set(s);
          next.delete(article.europepmc_id);
          return next;
        });
        setImportStatus((m) => {
          const next = { ...m };
          delete next[article.europepmc_id];
          return next;
        });
      }
    });
    downloadQueueRef.current = job.catch(() => {});
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 gap-3 ${className ?? ""}`}>
      <div className="space-y-2 shrink-0">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca artículos clínicos por tema, diagnóstico o técnica..."
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            className="flex-1"
          />
          <Button onClick={runSearch} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="pubmed-pdf" checked={onlyPdf} onCheckedChange={setOnlyPdf} />
          <Label htmlFor="pubmed-pdf" className="text-xs cursor-pointer">
            Solo con PDF disponible
          </Label>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        {!results && !loading && !error && (
          <div className="text-sm text-muted-foreground text-center py-10">
            Escribe una búsqueda para ver artículos.
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {results && results.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-10">
            No se encontraron artículos para esta búsqueda.
          </div>
        )}
        {results?.map((a) => (
          <ArticleCard
            key={a.europepmc_id}
            article={a}
            inLibrary={isInLibrary(a)}
            importing={importingIds.has(a.europepmc_id)}
            statusText={importStatus[a.europepmc_id] || ""}
            onImport={() => handleImportPdf(a)}
          />
        ))}
      </div>

      {classifyTarget && (
        <ClassifyPreviewDialog
          open={classifyOpen}
          onOpenChange={(o) => {
            setClassifyOpen(o);
            if (!o) setClassifyTarget(null);
          }}
          targets={[classifyTarget]}
          onSaved={() => onImported?.()}
        />
      )}
    </div>
  );
}

function ArticleCard({
  article,
  inLibrary,
  importing,
  statusText,
  onImport,
}: {
  article: PubMedArticle;
  inLibrary: boolean;
  importing: boolean;
  statusText: string;
  onImport: () => void;
}) {
  const [showAbstract, setShowAbstract] = useState(false);
  const canImportPdf = !!article.pdf_url && article.has_pdf;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={article.article_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm leading-snug hover:underline inline-flex items-start gap-1"
          >
            {article.title}
            <ExternalLink className="h-3 w-3 mt-0.5 opacity-60 shrink-0" />
          </a>
          <div className="text-xs text-muted-foreground mt-0.5">
            {article.authors}
            {article.journal ? ` · ${article.journal}` : ""}
            {article.year ? ` · ${article.year}` : ""}
          </div>
        </div>
        {canImportPdf && (
          <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15 shrink-0">
            🟢 PDF
          </Badge>
        )}
      </div>

      {article.abstract && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setShowAbstract((v) => !v)}
        >
          {showAbstract ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showAbstract ? "Ocultar abstract" : "Ver abstract"}
        </button>
      )}
      {showAbstract && article.abstract && (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2 whitespace-pre-line max-h-48 overflow-y-auto">
          {article.abstract}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        {inLibrary ? (
          <Badge className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            ✅ Ya en biblioteca
          </Badge>
        ) : canImportPdf ? (
          <Button
            size="sm"
            disabled={importing}
            onClick={onImport}
            className="h-7 px-3 text-xs gap-1 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {importing ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> {statusText || "Importando..."}</>
            ) : (
              <><FileText className="h-3 w-3" /> 📄 Importar PDF</>
            )}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Imports a PMC article PDF using the existing fetch-url-document pipeline,
 * inserts a document row + embedded chunks, and returns a ClassifyTarget so
 * the caller can show the classification preview.
 */
async function importArticlePdf(
  article: PubMedArticle,
  isAdmin: boolean,
  setStatus: (s: string) => void,
): Promise<ClassifyTarget> {
  if (!article.pdf_url) throw new Error("Sin PDF disponible");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  setStatus("Descargando PDF...");
  const { data, error } = await supabase.functions.invoke("fetch-url-document", {
    body: { url: article.pdf_url },
  });
  if (error) throw new Error(error.message ?? "Error de servidor");
  if (!data?.ok) throw new Error(data?.error || "No se pudo descargar el PDF");

  setStatus("Indexando...");
  const chunks = chunkText(data.text);
  if (chunks.length === 0) throw new Error("Sin contenido para indexar");

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      psychologist_id: user.id,
      title: data.title || article.title,
      author: data.author || article.authors || null,
      year: data.year || article.year || null,
      document_type: data.document_type || "articulo_cientifico",
      is_global: isAdmin,
      storage_path: null,
      source_url: article.pdf_url,
      import_source: "pubmed",
      pubmed_id: article.pubmed_id,
      pmc_id: article.pmc_id,
      europepmc_id: article.europepmc_id,
      europepmc_source: article.source,
      abstract: article.abstract || null,
      source_institution: "PubMed / NCBI",
      source_institution_type: "revista_cientifica",
    } as any)
    .select()
    .single();
  if (docErr) throw docErr;

  const batchSize = 8;
  const totalBatches = Math.ceil(chunks.length / batchSize);
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    setStatus(`Embeddings ${Math.floor(i / batchSize) + 1}/${totalBatches}`);
    const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
      body: { input: batch.map((c) => c.content), input_type: "document" },
    });
    if (embErr) throw embErr;
    if (embData?.error) throw new Error(embData.error);
    const embeddings: number[][] = embData.embeddings;
    const rows = batch.map((c, idx) => ({
      document_id: doc.id,
      psychologist_id: user.id,
      chunk_index: c.index,
      content: c.content,
      page_number: c.page_number,
      embedding: embeddings[idx] as any,
      is_global: isAdmin,
    }));
    const { error: insErr } = await supabase.from("document_chunks").insert(rows);
    if (insErr) throw insErr;
  }

  return {
    id: doc.id,
    title: doc.title,
    author: doc.author,
    year: doc.year,
    document_type: doc.document_type as DocType,
    clinical_areas: doc.clinical_areas ?? [],
    source_institution: doc.source_institution,
    source_institution_type: doc.source_institution_type,
    language: doc.language,
    storage_path: doc.storage_path,
    source_url: doc.source_url,
  };
}
