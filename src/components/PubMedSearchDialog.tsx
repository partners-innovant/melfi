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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Search, ExternalLink, Plus, Check, ChevronDown, ChevronUp, AlertCircle, FlaskConical,
} from "lucide-react";
import { ClassifyPreviewDialog, type ClassifyTarget } from "@/components/ClassifyPreviewDialog";
import { extractPdfText, chunkText } from "@/lib/pdf";
import type { DocType } from "@/lib/clinical";

export type PubMedPdfStatus = "pdf_available" | "abstract_only" | "no_access";

export interface PubMedArticle {
  pubmed_id: string;
  pmc_id: string | null;
  doi: string | null;
  title: string;
  authors: string;
  journal: string | null;
  year: string | null;
  has_free_pdf: boolean;
  pdf_status?: PubMedPdfStatus;
  pdf_url?: string | null;
  abstract: string | null;
  url: string;
  pmc_url: string | null;
}

interface SearchPayload {
  query: string;
  onlyFree: boolean;
  years: "5" | "10" | "all";
  language: "any" | "english" | "español";
  retmax?: number;
}

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
  const [query, setQuery] = useState(initialQuery ?? "");
  const [onlyFree, setOnlyFree] = useState(true);
  const [years, setYears] = useState<"5" | "10" | "all">("5");
  const [language, setLanguage] = useState<"any" | "english" | "español">("any");

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
          initial={{ query, onlyFree, years, language }}
          showFilters
          autoSearch={autoSearch}
          onQueryStateChange={(s) => {
            setQuery(s.query);
            setOnlyFree(s.onlyFree);
            setYears(s.years);
            setLanguage(s.language);
          }}
          onImported={onImported}
          isAdmin
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reusable PubMed search panel. Used inside the modal and inline in the AI Assistant.
 */
export function PubMedPanel({
  initial,
  showFilters = true,
  onQueryStateChange,
  onImported,
  autoSearch = false,
  isAdmin = false,
  className,
}: {
  initial: SearchPayload;
  showFilters?: boolean;
  onQueryStateChange?: (s: SearchPayload) => void;
  onImported?: () => void;
  autoSearch?: boolean;
  isAdmin?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(initial.query);
  const [onlyFree, setOnlyFree] = useState(initial.onlyFree);
  const [years, setYears] = useState(initial.years);
  const [language, setLanguage] = useState(initial.language);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PubMedArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingPubmedIds, setExistingPubmedIds] = useState<Set<string>>(new Set());
  const [classifyTarget, setClassifyTarget] = useState<ClassifyTarget | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);

  // notify parent of state changes
  useEffect(() => {
    onQueryStateChange?.({ query, onlyFree, years, language });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onlyFree, years, language]);

  const autoRan = useRef(false);
  useEffect(() => {
    if (autoSearch && !autoRan.current && initial.query.trim()) {
      autoRan.current = true;
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, initial.query]);

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
          body: { query, onlyFree, years, language },
        }),
        supabase.from("documents").select("pubmed_id").not("pubmed_id", "is", null),
      ]);
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setResults((data?.articles ?? []) as PubMedArticle[]);
      const ids = new Set<string>();
      for (const r of (libRes.data ?? []) as Array<{ pubmed_id: string | null }>) {
        if (r.pubmed_id) ids.add(String(r.pubmed_id));
      }
      setExistingPubmedIds(ids);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleAfterImport(article: PubMedArticle, target: ClassifyTarget) {
    setExistingPubmedIds((prev) => {
      const next = new Set(prev);
      next.add(article.pubmed_id);
      return next;
    });
    setClassifyTarget(target);
    setClassifyOpen(true);
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 gap-3 ${className ?? ""}`}>
      {showFilters && (
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
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Switch id="pubmed-free" checked={onlyFree} onCheckedChange={setOnlyFree} />
              <Label htmlFor="pubmed-free" className="text-xs cursor-pointer">
                Solo acceso libre (PMC)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Últimos:</Label>
              <Select value={years} onValueChange={(v) => setYears(v as typeof years)}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 años</SelectItem>
                  <SelectItem value="10">10 años</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Idioma:</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
                <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Cualquiera</SelectItem>
                  <SelectItem value="english">Inglés</SelectItem>
                  <SelectItem value="español">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

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
            key={a.pubmed_id}
            article={a}
            inLibrary={existingPubmedIds.has(a.pubmed_id)}
            isAdmin={isAdmin}
            onImported={(t) => handleAfterImport(a, t)}
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
  isAdmin,
  onImported,
}: {
  article: PubMedArticle;
  inLibrary: boolean;
  isAdmin: boolean;
  onImported: (target: ClassifyTarget) => void;
}) {
  const [showAbstract, setShowAbstract] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [statusText, setStatusText] = useState<string>("");

  async function handleImport() {
    setImporting(true);
    try {
      const { target } = await importPubMedArticle(article, isAdmin, setStatusText);
      setDone(true);
      onImported(target);
      toast.success("✅ Abstract importado correctamente");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setImporting(false);
      setStatusText("");
    }
  }

  const alreadyIn = inLibrary || done;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={article.url}
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
        <div className="flex flex-col items-end gap-1 shrink-0">
          {(() => {
            const status: PubMedPdfStatus =
              article.pdf_status ?? (article.has_free_pdf ? "pdf_available" : article.pmc_id ? "abstract_only" : "no_access");
            if (status === "pdf_available") {
              return (
                <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15">
                  🟢 PDF Open Access
                </Badge>
              );
            }
            if (status === "abstract_only") {
              return (
                <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/15">
                  🟡 Solo abstract
                </Badge>
              );
            }
            return (
              <Badge className="text-[10px] bg-muted text-muted-foreground border-border hover:bg-muted">
                ⚪ Sin acceso libre
              </Badge>
            );
          })()}
        </div>
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
        {alreadyIn ? (
          <Badge className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            ✅ Ya en biblioteca
          </Badge>
        ) : (
          <Button
            size="sm"
            disabled={importing}
            onClick={handleImport}
            className="h-7 px-3 text-xs gap-1 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {importing ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> {statusText || "Importando..."}</>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Importar abstract
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Imports a PubMed article into the documents library (global if admin)
 * as an abstract-only document. PDF download is currently disabled —
 * we always import the abstract text.
 */
async function importPubMedArticle(
  article: PubMedArticle,
  isAdmin: boolean,
  setStatus: (s: string) => void,
): Promise<{ target: ClassifyTarget; usedPdf: boolean }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const storagePath: string | null = null;
  let docText = "";
  const usedPdf = false;

  // Always import as abstract for now
  let abstractText = article.abstract ?? "";
  if (!abstractText.trim()) {
    try {
      setStatus("Obteniendo abstract...");
      const { data } = await supabase.functions.invoke("search-pubmed", {
        body: { action: "get_abstract", pubmed_id: article.pubmed_id },
      });
      if (data?.abstract && typeof data.abstract === "string") {
        abstractText = data.abstract;
      }
    } catch (e) {
      console.warn("[pubmed] get_abstract failed:", e);
    }
  }
  const note = "Documento importado como abstract";
  const parts = [
    `# ${article.title}`,
    article.authors ? `Autores: ${article.authors}` : "",
    article.journal ? `Revista: ${article.journal}` : "",
    article.year ? `Año: ${article.year}` : "",
    article.doi ? `DOI: ${article.doi}` : "",
    article.url ? `PubMed: ${article.url}` : "",
    "",
    `> ${note}`,
    "",
    abstractText.trim() || "(Sin abstract disponible)",
  ].filter(Boolean);
  docText = parts.join("\n");

  setStatus("Indexando...");
  const chunks = chunkText(docText);
  if (chunks.length === 0) throw new Error("Sin contenido para indexar");

  // Initial AI classification (best-effort) so the preview opens with suggestions
  let initial: {
    document_type?: DocType;
    clinical_areas?: string[];
    source_institution?: string | null;
    source_institution_type?: string | null;
    language?: string | null;
  } = {};
  try {
    const fragment = `Title: ${article.title}\nAbstract: ${(article.abstract ?? "").slice(0, 1000)}`;
    const { data: ai } = await supabase.functions.invoke("extract-metadata", { body: { text: fragment } });
    if (ai && !ai.error) {
      initial = {
        document_type: (ai.document_type as DocType) ?? undefined,
        clinical_areas: Array.isArray(ai.clinical_areas) ? ai.clinical_areas : undefined,
        source_institution: ai.source_institution ?? null,
        source_institution_type: ai.source_institution_type ?? null,
        language: ai.language ?? null,
      };
    }
  } catch (e) {
    console.warn("[pubmed] auto-classify failed:", e);
  }

  // Create document row
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      psychologist_id: user.id,
      title: article.title,
      author: article.authors || null,
      year: article.year || null,
      document_type: initial.document_type ?? "articulo_cientifico",
      is_global: isAdmin,
      storage_path: storagePath,
      source_url: article.url,
      import_source: "pubmed",
      pubmed_id: article.pubmed_id,
      pmc_id: article.pmc_id,
      abstract: article.abstract,
      clinical_areas: initial.clinical_areas ?? [],
      source_institution: initial.source_institution ?? "PubMed / NCBI",
      source_institution_type: initial.source_institution_type ?? "revista_cientifica",
      language: initial.language ?? null,
    } as any)
    .select()
    .single();
  if (docErr) {
    if (storagePath) await supabase.storage.from("documents").remove([storagePath]);
    throw docErr;
  }

  // Embed and insert chunks
  const batchSize = 8;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
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
      document_type: doc.document_type,
      clinical_areas: doc.clinical_areas,
      source_institution: doc.source_institution,
      source_institution_type: doc.source_institution_type,
      language: doc.language,
    }));
    const { error: insErr } = await supabase.from("document_chunks").insert(rows);
    if (insErr) throw insErr;
  }

  return {
    target: {
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
    },
    usedPdf,
  };
}
