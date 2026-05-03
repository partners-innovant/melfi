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
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2, Search, ExternalLink, ChevronDown, ChevronUp, AlertCircle, FlaskConical, FileText, Upload,
} from "lucide-react";

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
  publication_date?: string | null;
  abstract: string;
  has_pdf: boolean;
  is_open_access: boolean;
  pdf_url: string | null;
  article_url: string;
}

export interface PubMedUploadPrefill {
  title: string;
  author: string;
  year: string;
  publication_date?: string | null;
  abstract: string;
  pmc_id: string | null;
  pubmed_id: string | null;
  europepmc_id: string;
  europepmc_source: string;
  source_url: string | null;
  source_institution: string;
  source_institution_type: string;
  clinical_areas?: string[];
  language?: string | null;
  ai_classified?: boolean;
}

export function PubMedSearchDialog({
  open,
  onOpenChange,
  onRequestUpload,
  initialQuery,
  autoSearch = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRequestUpload?: (prefill: PubMedUploadPrefill) => void;
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
          onRequestUpload={onRequestUpload}
          isAdmin
        />
      </DialogContent>
    </Dialog>
  );
}

export function PubMedPanel({
  initialQuery = "",
  autoSearch = false,
  onRequestUpload,
  isAdmin = false,
  className,
}: {
  initialQuery?: string;
  autoSearch?: boolean;
  onRequestUpload?: (prefill: PubMedUploadPrefill) => void;
  isAdmin?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [onlyPdf, setOnlyPdf] = useState(true);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PubMedArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());

  const autoRan = useRef(false);
  useEffect(() => {
    if (autoSearch && !autoRan.current && initialQuery.trim()) {
      autoRan.current = true;
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, initialQuery]);

  async function refreshExisting(articles: PubMedArticle[]) {
    const pmcIds = articles.map((a) => a.pmc_id).filter((x): x is string => !!x);
    const pubmedIds = articles.map((a) => a.pubmed_id).filter((x): x is string => !!x);
    const europeIds = articles.map((a) => a.europepmc_id).filter(Boolean);
    const ors: string[] = [];
    if (pmcIds.length) ors.push(`pmc_id.in.(${pmcIds.join(",")})`);
    if (pubmedIds.length) ors.push(`pubmed_id.in.(${pubmedIds.join(",")})`);
    if (europeIds.length) ors.push(`europepmc_id.in.(${europeIds.join(",")})`);
    if (ors.length === 0) { setExisting(new Set()); return; }
    const { data } = await supabase
      .from("documents")
      .select("pubmed_id, pmc_id, europepmc_id")
      .or(ors.join(","));
    const ids = new Set<string>();
    for (const r of (data ?? []) as Array<{ pubmed_id: string | null; pmc_id: string | null; europepmc_id: string | null }>) {
      if (r.pubmed_id) ids.add(`pmid:${r.pubmed_id}`);
      if (r.pmc_id) ids.add(`pmc:${r.pmc_id}`);
      if (r.europepmc_id) ids.add(`epmc:${r.europepmc_id}`);
    }
    setExisting(ids);
  }

  async function runSearch() {
    if (!query.trim()) {
      toast.error("Escribe un término de búsqueda");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("search-pubmed", {
        body: { action: "search", query, onlyPdf },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      const articles = (data?.articles ?? []) as PubMedArticle[];
      setResults(articles);
      await refreshExisting(articles);
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
    return false;
  }

  function markImported(a: PubMedArticle) {
    setExisting((prev) => {
      const next = new Set(prev);
      if (a.pubmed_id) next.add(`pmid:${a.pubmed_id}`);
      if (a.pmc_id) next.add(`pmc:${a.pmc_id}`);
      if (a.europepmc_id) next.add(`epmc:${a.europepmc_id}`);
      return next;
    });
  }

  function pdfDirectUrl(a: PubMedArticle): string | null {
    if (a.pmc_id) return `https://pmc.ncbi.nlm.nih.gov/articles/${a.pmc_id}/pdf/`;
    return a.pdf_url;
  }

  async function handleUploadClick(a: PubMedArticle) {
    if (!onRequestUpload) return;
    const basePrefill: PubMedUploadPrefill = {
      title: a.title,
      author: a.authors,
      year: a.year,
      publication_date: a.publication_date ?? null,
      abstract: a.abstract,
      pmc_id: a.pmc_id,
      pubmed_id: a.pubmed_id,
      europepmc_id: a.europepmc_id,
      europepmc_source: a.source,
      source_url: pdfDirectUrl(a),
      source_institution: a.journal || "PubMed / NCBI",
      source_institution_type: "revista_cientifica",
    };
    // Fire-and-forget AI classification using title + abstract
    const classifyPromise = (async () => {
      try {
        const text = `Título: ${a.title}\n\nAbstract: ${a.abstract || "(sin abstract)"}`;
        const { data, error } = await supabase.functions.invoke("extract-metadata", { body: { text } });
        if (error || !data || data.error) return null;
        return {
          clinical_areas: Array.isArray(data.clinical_areas) ? data.clinical_areas as string[] : [],
          language: (data.language as string) ?? null,
        };
      } catch { return null; }
    })();
    const toastId = toast.loading("Clasificando artículo con IA...");
    const ai = await classifyPromise;
    toast.dismiss(toastId);
    onRequestUpload({
      ...basePrefill,
      clinical_areas: ai?.clinical_areas ?? [],
      language: ai?.language ?? null,
      ai_classified: !!ai,
    });
    markImported(a);
  }

  return (
    <TooltipProvider>
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
              pdfUrl={pdfDirectUrl(a)}
              onUploadClick={() => handleUploadClick(a)}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

function ArticleCard({
  article,
  inLibrary,
  pdfUrl,
  onUploadClick,
}: {
  article: PubMedArticle;
  inLibrary: boolean;
  pdfUrl: string | null;
  onUploadClick: () => void;
}) {
  const [showAbstract, setShowAbstract] = useState(false);
  const titleHref = pdfUrl ?? article.article_url;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={titleHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm leading-snug hover:underline inline-flex items-start gap-1"
          >
            {article.title}
            <ExternalLink className="h-3 w-3 mt-0.5 opacity-60 shrink-0" />
          </a>
          {inLibrary && (
            <Badge className="ml-2 text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15 align-middle">
              ✅ Ya en biblioteca
            </Badge>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            {article.authors}
            {article.journal ? ` · ${article.journal}` : ""}
            {article.year ? ` · ${article.year}` : ""}
          </div>
        </div>
        {pdfUrl && (
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
        {pdfUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")}
                className="h-7 px-3 text-xs gap-1"
              >
                <FileText className="h-3 w-3" /> 📄 Abrir PDF
                <ExternalLink className="h-3 w-3 opacity-60" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              Abre el PDF — luego usa "⬆️ Subir a Psicoasist" para indexarlo
            </TooltipContent>
          </Tooltip>
        )}
        {inLibrary ? (
          <Button size="sm" disabled className="h-7 px-3 text-xs gap-1 bg-muted text-muted-foreground">
            ✅ Importado
          </Button>
        ) : pdfUrl ? (
          <Button
            size="sm"
            onClick={onUploadClick}
            className="h-7 px-3 text-xs gap-1 bg-teal-600 hover:bg-teal-700 text-white"
          >
            <Upload className="h-3 w-3" /> ⬆️ Subir a Psicoasist
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
