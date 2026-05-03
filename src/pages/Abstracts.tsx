import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Eye, ExternalLink, Trash2, Plus, FlaskConical, Copy, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { CLINICAL_AREAS, CLINICAL_AREA_LABELS, clinicalAreaColor, clinicalAreaLabel } from "@/lib/clinical-areas";
import { PubMedPanel, type PubMedArticle } from "@/components/PubMedSearchDialog";
import { cn } from "@/lib/utils";

const EVIDENCE_LEVELS = [
  "meta_analisis","revision_sistematica","ensayo_clinico_rct",
  "estudio_cohorte","guia_practica_clinica","consenso_expertos",
  "reporte_caso","opinion_experto","otro",
] as const;
const EVIDENCE_LABELS: Record<string, string> = {
  meta_analisis: "Meta-análisis",
  revision_sistematica: "Revisión sistemática",
  ensayo_clinico_rct: "RCT",
  estudio_cohorte: "Cohorte",
  guia_practica_clinica: "Guía clínica",
  consenso_expertos: "Consenso",
  reporte_caso: "Reporte de caso",
  opinion_experto: "Opinión experto",
  otro: "Otro",
};

interface Abstract {
  id: string;
  psychologist_id: string;
  is_global: boolean;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  publication_date: string | null;
  abstract_text: string;
  doi: string | null;
  pubmed_id: string | null;
  pmc_id: string | null;
  europepmc_id: string | null;
  source_url: string | null;
  repository: string | null;
  clinical_areas: string[] | null;
  evidence_level: string | null;
  geographic_relevance: string | null;
  citations_count: number | null;
  language: string | null;
  created_at: string;
}

const ANY = "__any__";

export default function AbstractsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<Abstract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterArea, setFilterArea] = useState<string>(ANY);
  const [filterEvidence, setFilterEvidence] = useState<string>(ANY);
  const [filterYear, setFilterYear] = useState<string>(ANY);
  const [filterLang, setFilterLang] = useState<string>(ANY);
  const [viewing, setViewing] = useState<Abstract | null>(null);
  const [pubmedOpen, setPubmedOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("abstracts" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setList(((data ?? []) as unknown) as Abstract[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((a) => {
      if (q) {
        const hay = `${a.title} ${a.authors ?? ""} ${a.journal ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterArea !== ANY && !(a.clinical_areas ?? []).includes(filterArea)) return false;
      if (filterEvidence !== ANY && a.evidence_level !== filterEvidence) return false;
      if (filterYear !== ANY) {
        const y = a.year ?? 0;
        const fromY = parseInt(filterYear);
        if (y < fromY) return false;
      }
      if (filterLang !== ANY && a.language !== filterLang) return false;
      return true;
    });
  }, [list, search, filterArea, filterEvidence, filterYear, filterLang]);

  const stats = useMemo(() => {
    const total = list.length;
    const globals = list.filter((a) => a.is_global).length;
    const mine = list.filter((a) => a.psychologist_id === user?.id && !a.is_global).length;
    return { total, globals, mine, indexed: total };
  }, [list, user?.id]);

  async function handleDelete(id: string) {
    const { error } = await supabase.from("abstracts" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Abstract eliminado");
    setConfirmDelete(null);
    if (viewing?.id === id) setViewing(null);
    void load();
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 w-full max-w-[1500px] mx-auto">
      <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Abstracts</h1>
          <p className="text-muted-foreground text-sm mt-1">Biblioteca de abstracts científicos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setPubmedOpen(true)}>
            <FlaskConical className="h-4 w-4" /> Buscar en PubMed
          </Button>
          <Button className="gap-2" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" /> Agregar abstract
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total abstracts" value={stats.total} />
        <StatCard label="Globales" value={stats.globals} />
        <StatCard label="Mis abstracts" value={stats.mine} />
        <StatCard label="Total indexados" value={stats.indexed} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Buscar por título, autor o revista..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Select value={filterArea} onValueChange={setFilterArea}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Área clínica" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todas las áreas</SelectItem>
            {CLINICAL_AREAS.map((a) => (
              <SelectItem key={a} value={a}>{clinicalAreaLabel(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterEvidence} onValueChange={setFilterEvidence}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Evidencia" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Cualquier evidencia</SelectItem>
            {EVIDENCE_LEVELS.map((e) => (
              <SelectItem key={e} value={e}>{EVIDENCE_LABELS[e]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Año" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Cualquier año</SelectItem>
            <SelectItem value="2024">≥ 2024</SelectItem>
            <SelectItem value="2020">≥ 2020</SelectItem>
            <SelectItem value="2015">≥ 2015</SelectItem>
            <SelectItem value="2010">≥ 2010</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterLang} onValueChange={setFilterLang}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Idioma" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Cualquiera</SelectItem>
            <SelectItem value="español">Español</SelectItem>
            <SelectItem value="ingles">Inglés</SelectItem>
            <SelectItem value="otro">Otro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-3" style={{ width: "30%" }}>Título</th>
                <th className="text-left p-3" style={{ width: "12%" }}>Autores</th>
                <th className="text-left p-3" style={{ width: "12%" }}>Revista</th>
                <th className="text-left p-3" style={{ width: "5%" }}>Año</th>
                <th className="text-left p-3" style={{ width: "18%" }}>Áreas</th>
                <th className="text-left p-3" style={{ width: "8%" }}>Evidencia</th>
                <th className="text-left p-3" style={{ width: "5%" }}>Citas</th>
                <th className="text-left p-3" style={{ width: "10%" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t"><td colSpan={8} className="p-3"><Skeleton className="h-8 w-full" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">
                  No hay abstracts. Importa desde PubMed o agrega uno manualmente.
                </td></tr>
              ) : filtered.map((a) => (
                <tr key={a.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <button
                      onClick={() => setViewing(a)}
                      className="text-left font-medium line-clamp-2 hover:text-primary"
                    >
                      {a.title}
                    </button>
                    {a.is_global && <Badge variant="secondary" className="ml-1 text-[9px]">Global</Badge>}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground truncate">{a.authors ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground truncate">{a.journal ?? "—"}</td>
                  <td className="p-3 text-xs">{a.year ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(a.clinical_areas ?? []).slice(0, 3).map((ca) => (
                        <span key={ca} className={cn("text-[10px] px-1.5 py-0.5 rounded", clinicalAreaColor(ca))}>
                          {clinicalAreaLabel(ca)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3">
                    {a.evidence_level && (
                      <Badge variant="outline" className="text-[10px]">{EVIDENCE_LABELS[a.evidence_level] ?? a.evidence_level}</Badge>
                    )}
                  </td>
                  <td className="p-3 text-xs tabular-nums">{a.citations_count ?? 0}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewing(a)} title="Ver abstract">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {(a.source_url || a.doi) && (
                        <a href={a.source_url ?? `https://doi.org/${a.doi}`} target="_blank" rel="noreferrer">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Fuente">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      )}
                      {(a.psychologist_id === user?.id || profile?.is_admin) && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setConfirmDelete(a.id)} title="Eliminar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Reader panel */}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[450px] overflow-y-auto">
          {viewing && <ReaderContent a={viewing} onAssistant={() => navigate(`/assistant?q=${encodeURIComponent(`Analiza este abstract: ${viewing.title}\n\n${viewing.abstract_text}`)}`)} />}
        </SheetContent>
      </Sheet>

      {/* PubMed fullscreen search */}
      {pubmedOpen && (
        <PubMedFullscreenSearch
          existingIds={list}
          onClose={() => setPubmedOpen(false)}
          onImported={load}
        />
      )}

      {/* Manual entry */}
      <ManualAbstractDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        isAdmin={!!profile?.is_admin}
        onSaved={() => { setManualOpen(false); load(); }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar abstract?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && handleDelete(confirmDelete)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}

function ReaderContent({ a, onAssistant }: { a: Abstract; onAssistant: () => void }) {
  const sourceUrl = a.source_url ?? (a.doi ? `https://doi.org/${a.doi}` : null);
  const formatted = useMemo(() => formatAbstract(a.abstract_text), [a.abstract_text]);
  return (
    <div className="space-y-4 pt-4">
      <h2 className="text-lg font-semibold leading-snug">{a.title}</h2>
      <div className="text-sm text-muted-foreground space-y-0.5">
        {a.authors && <div>{a.authors}</div>}
        <div>
          {a.journal && <span>{a.journal}</span>}
          {a.year && <span> · {a.year}</span>}
        </div>
        {a.doi && (
          <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 text-xs">
            DOI: {a.doi} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {(a.clinical_areas ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(a.clinical_areas ?? []).map((ca) => (
            <span key={ca} className={cn("text-[10px] px-1.5 py-0.5 rounded", clinicalAreaColor(ca))}>
              {clinicalAreaLabel(ca)}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        {a.evidence_level && <Badge variant="outline">{EVIDENCE_LABELS[a.evidence_level] ?? a.evidence_level}</Badge>}
        <Badge variant="secondary">📊 {a.citations_count ?? 0} citas</Badge>
      </div>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          <Button variant="outline" className="gap-2 w-full"><ExternalLink className="h-4 w-4" /> Ver fuente original</Button>
        </a>
      )}
      <div className="border-t pt-4">
        <div className="text-sm leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatted }} />
      </div>
      <div className="flex flex-col gap-2 sticky bottom-0 bg-background pt-3 border-t">
        <Button variant="outline" className="gap-2" onClick={() => { navigator.clipboard.writeText(a.abstract_text); toast.success("Abstract copiado"); }}>
          <Copy className="h-4 w-4" /> Copiar abstract
        </Button>
        <Button className="gap-2" onClick={onAssistant}>
          <Sparkles className="h-4 w-4" /> Buscar en Asistente IA
        </Button>
      </div>
    </div>
  );
}

function formatAbstract(text: string): string {
  // Highlight section headers in teal
  const headers = ["Objective", "Objectives", "Background", "Methods", "Method", "Results", "Conclusions", "Conclusion", "Discussion", "Aim", "Aims", "Findings", "Setting", "Participants", "Design", "Introduction", "Purpose"];
  let html = text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] ?? c));
  for (const h of headers) {
    const re = new RegExp(`(^|\\n|\\s)(${h}s?:)`, "g");
    html = html.replace(re, '$1<strong class="text-teal-600 dark:text-teal-400">$2</strong>');
  }
  return html;
}

function PubMedAbstractImporter({ onImported }: { onImported: () => void }) {
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  async function importArticle(a: PubMedArticle) {
    setBusy(a.europepmc_id);
    try {
      const { error } = await supabase.functions.invoke("import-abstract", {
        body: {
          title: a.title,
          authors: a.authors,
          journal: a.journal,
          year: a.year ? parseInt(a.year) : null,
          publication_date: a.publication_date ?? null,
          abstract_text: a.abstract,
          doi: a.doi,
          pubmed_id: a.pubmed_id,
          pmc_id: a.pmc_id,
          europepmc_id: a.europepmc_id,
          source_url: a.article_url,
          citations_count: a.citations_count ?? 0,
        },
      });
      if (error) throw error;
      setImported((s) => new Set(s).add(a.europepmc_id));
      toast.success("Abstract importado");
      onImported();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al importar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <PubMedPanel
      onRequestUpload={(prefill) => {
        // We hijack the prefill-based flow and import abstract directly
        const fakeArticle: PubMedArticle = {
          europepmc_id: prefill.europepmc_id,
          source: prefill.europepmc_source,
          pubmed_id: prefill.pubmed_id,
          pmc_id: prefill.pmc_id,
          doi: null,
          title: prefill.title,
          authors: prefill.author,
          journal: prefill.journal ?? "",
          year: prefill.year,
          publication_date: prefill.publication_date ?? null,
          abstract: prefill.abstract,
          has_pdf: false,
          is_open_access: false,
          pdf_url: null,
          article_url: prefill.source_url ?? "",
          citations_count: prefill.citations_count ?? null,
        };
        void importArticle(fakeArticle);
      }}
    />
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void imported; void busy;
}

function ManualAbstractDialog({
  open, onOpenChange, isAdmin, onSaved,
}: { open: boolean; onOpenChange: (o: boolean) => void; isAdmin: boolean; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [journal, setJournal] = useState("");
  const [year, setYear] = useState("");
  const [doi, setDoi] = useState("");
  const [pubmedId, setPubmedId] = useState("");
  const [abstractText, setAbstractText] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<string>(ANY);
  const [isGlobal, setIsGlobal] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle(""); setAuthors(""); setJournal(""); setYear(""); setDoi("");
    setPubmedId(""); setAbstractText(""); setAreas([]); setEvidence(ANY); setIsGlobal(false);
  }

  async function fetchFromPubmed() {
    if (!pubmedId.trim()) return;
    try {
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${pubmedId.trim()}+AND+SRC:MED&format=json&resultType=core`;
      const r = await fetch(url);
      const d = await r.json();
      const a = d.resultList?.result?.[0];
      if (!a) { toast.error("No se encontró el artículo"); return; }
      setTitle(a.title ?? "");
      setAuthors(a.authorString ?? "");
      setJournal(a.journalTitle ?? "");
      setYear(a.pubYear ?? "");
      setDoi(a.doi ?? "");
      setAbstractText(a.abstractText ?? "");
      toast.success("Metadatos cargados desde PubMed");
    } catch (_e) {
      toast.error("Error al consultar PubMed");
    }
  }

  async function save() {
    if (!title.trim() || !abstractText.trim()) {
      toast.error("Título y abstract son obligatorios"); return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("import-abstract", {
        body: {
          title: title.trim(),
          authors: authors.trim() || null,
          journal: journal.trim() || null,
          year: year ? parseInt(year) : null,
          doi: doi.trim() || null,
          pubmed_id: pubmedId.trim() || null,
          abstract_text: abstractText.trim(),
          clinical_areas: areas,
          evidence_level: evidence !== ANY ? evidence : null,
          is_global: isGlobal,
          source_url: doi ? `https://doi.org/${doi.trim()}` : null,
        },
      });
      if (error) throw error;
      toast.success("Abstract guardado");
      reset();
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Agregar abstract</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Autores</Label><Input value={authors} onChange={(e) => setAuthors(e.target.value)} /></div>
            <div><Label>Revista</Label><Input value={journal} onChange={(e) => setJournal(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Año</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
            <div><Label>DOI / URL</Label><Input value={doi} onChange={(e) => setDoi(e.target.value)} /></div>
            <div>
              <Label>PubMed ID</Label>
              <div className="flex gap-1">
                <Input value={pubmedId} onChange={(e) => setPubmedId(e.target.value)} />
                <Button type="button" size="sm" variant="outline" onClick={fetchFromPubmed}>↓</Button>
              </div>
            </div>
          </div>
          <div>
            <Label>Abstract *</Label>
            <Textarea value={abstractText} onChange={(e) => setAbstractText(e.target.value)} className="min-h-[200px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nivel de evidencia</Label>
              <Select value={evidence} onValueChange={setEvidence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>—</SelectItem>
                  {EVIDENCE_LEVELS.map((e) => <SelectItem key={e} value={e}>{EVIDENCE_LABELS[e]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Áreas clínicas (clic para alternar)</Label>
              <div className="border rounded-md p-2 max-h-24 overflow-y-auto flex flex-wrap gap-1">
                {CLINICAL_AREAS.map((ca) => {
                  const sel = areas.includes(ca);
                  return (
                    <button key={ca} type="button"
                      onClick={() => setAreas((s) => sel ? s.filter((x) => x !== ca) : [...s, ca])}
                      className={cn("text-[10px] px-1.5 py-0.5 rounded border", sel ? clinicalAreaColor(ca) : "bg-muted text-muted-foreground border-transparent")}>
                      {clinicalAreaLabel(ca)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch id="global" checked={isGlobal} onCheckedChange={setIsGlobal} />
              <Label htmlFor="global">Documento global (visible para todos)</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
