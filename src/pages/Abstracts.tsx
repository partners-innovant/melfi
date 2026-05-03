import { Fragment, useEffect, useMemo, useState } from "react";
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
import { X, Search as SearchIcon } from "lucide-react";
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

      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[450px] overflow-y-auto">
          {viewing && <ReaderContent a={viewing} onAssistant={() => navigate(`/assistant?q=${encodeURIComponent(`Analiza este abstract: ${viewing.title}\n\n${viewing.abstract_text}`)}`)} />}
        </SheetContent>
      </Sheet>

      {pubmedOpen && (
        <PubMedFullscreenSearch
          existingIds={list}
          onClose={() => setPubmedOpen(false)}
          onImported={load}
        />
      )}

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
  const headers = ["Objective", "Objectives", "Background", "Methods", "Method", "Results", "Conclusions", "Conclusion", "Discussion", "Aim", "Aims", "Findings", "Setting", "Participants", "Design", "Introduction", "Purpose"];
  let html = text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] ?? c));
  for (const h of headers) {
    const re = new RegExp(`(^|\\n|\\s)(${h}s?:)`, "g");
    html = html.replace(re, '$1<strong class="text-teal-600 dark:text-teal-400">$2</strong>');
  }
  return html;
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

interface EpmcArticle {
  id: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: Array<{ authorAffiliationDetailsList?: { authorAffiliation?: Array<{ affiliation?: string }> } }> };
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  abstractText?: string;
  citedByCount?: number;
  language?: string;
  pubTypeList?: { pubType?: string[] };
  meshHeadingList?: { meshHeading?: Array<{ descriptorName?: string }> };
  fullTextUrlList?: { fullTextUrl?: Array<{ url?: string; documentStyle?: string; availabilityCode?: string }> };
}

interface ScoredArticle extends EpmcArticle {
  relevance_score: number;
}

const PUB_TYPE_EVIDENCE: Record<string, number> = {
  "Meta-Analysis": 100,
  "Systematic Review": 90,
  "Practice Guideline": 75,
  "Randomized Controlled Trial": 80,
  "Review": 70,
  "Journal Article": 50,
};

function detectDocumentType(types: string[]): string {
  if (types.includes("Meta-Analysis")) return "meta_analisis";
  if (types.includes("Systematic Review")) return "revision_sistematica";
  if (types.includes("Randomized Controlled Trial")) return "ensayo_clinico_rct";
  if (types.includes("Practice Guideline")) return "guia_practica_clinica";
  if (types.includes("Review")) return "revision_sistematica";
  return "articulo_cientifico";
}
function detectEvidenceLevel(types: string[]): string {
  if (types.includes("Meta-Analysis")) return "meta_analisis";
  if (types.includes("Systematic Review")) return "revision_sistematica";
  if (types.includes("Randomized Controlled Trial")) return "ensayo_clinico_rct";
  if (types.includes("Review")) return "revision_sistematica";
  if (types.includes("Practice Guideline")) return "guia_practica_clinica";
  return "estudio_cohorte";
}
function detectClinicalAreas(mesh: string[]): string[] {
  const t = mesh.map((m) => m.toLowerCase());
  const areas: string[] = [];
  if (t.some((x) => x.includes("anxiety"))) areas.push("anxiety");
  if (t.some((x) => x.includes("depress"))) areas.push("depression");
  if (t.some((x) => x.includes("attention deficit"))) areas.push("attention_deficit_disorder");
  if (t.some((x) => x.includes("bipolar"))) areas.push("bipolar_disorder");
  if (t.some((x) => x.includes("schizophrenia") || x.includes("psychosis"))) areas.push("psychosis_and_schizophrenia");
  if (t.some((x) => x.includes("eating disorder"))) areas.push("eating_disorders");
  if (t.some((x) => x.includes("personality disorder"))) areas.push("personality_disorders");
  if (t.some((x) => x.includes("substance") || x.includes("addiction"))) areas.push("addiction");
  if (t.some((x) => x.includes("autism"))) areas.push("autism");
  if (t.some((x) => x.includes("trauma") || x.includes("ptsd"))) areas.push("trauma_estres");
  if (t.some((x) => x.includes("suicide"))) areas.push("suicide_prevention");
  if (t.some((x) => x.includes("self-harm"))) areas.push("self_harm");
  if (areas.length === 0) areas.push("intervenciones_psicoterapias");
  return areas.slice(0, 3);
}

function previewScore(a: EpmcArticle): number {
  const types = a.pubTypeList?.pubType ?? [];
  const evidenceScore = types.length > 0
    ? Math.max(...types.map((t) => PUB_TYPE_EVIDENCE[t] ?? 10))
    : 10;
  const citationsScore = Math.min((a.citedByCount || 0) / 10, 100);
  const yearDiff = new Date().getFullYear() - (parseInt(a.pubYear ?? "2000") || 2000);
  const recencyScore = Math.max(0, 100 - yearDiff * 10);
  return Math.round(evidenceScore * 0.4 + citationsScore * 0.25 + recencyScore * 0.35);
}

function shortLabel(t: string): string {
  if (t.includes("Meta-Analysis")) return "Meta-análisis";
  if (t.includes("Systematic Review")) return "Revisión";
  if (t.includes("Randomized Controlled Trial")) return "RCT";
  if (t.includes("Practice Guideline")) return "Guía";
  if (t.includes("Review")) return "Revisión";
  return "Artículo";
}

function pdfUrlOf(a: EpmcArticle): string | null {
  const fts = a.fullTextUrlList?.fullTextUrl ?? [];
  const oa = fts.find((x) => x.availabilityCode === "OA" && x.documentStyle === "pdf");
  if (oa?.url) return oa.url;
  if (a.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${a.pmcid}/pdf/`;
  return null;
}

function PubMedFullscreenSearch({
  existingIds, onClose, onImported,
}: {
  existingIds: Abstract[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [term, setTerm] = useState("");
  const [years, setYears] = useState<string>("5");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [minCitations, setMinCitations] = useState("");
  const [language, setLanguage] = useState<string>("all");
  const [onlyPDF, setOnlyPDF] = useState(false);
  const [sortBy, setSortBy] = useState<"relevancia" | "citaciones" | "recientes">("relevancia");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScoredArticle[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());

  const existingKeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of existingIds) {
      if (a.pubmed_id) s.add(`pmid:${a.pubmed_id}`);
      if (a.pmc_id) s.add(`pmc:${a.pmc_id}`);
      if (a.europepmc_id) s.add(`epmc:${a.europepmc_id}`);
    }
    return s;
  }, [existingIds]);

  function isAlreadyImported(a: EpmcArticle): boolean {
    if (a.pmid && existingKeys.has(`pmid:${a.pmid}`)) return true;
    if (a.pmcid && existingKeys.has(`pmc:${a.pmcid}`)) return true;
    if (a.id && existingKeys.has(`epmc:${a.id}`)) return true;
    if (a.pmid && imported.has(`pmid:${a.pmid}`)) return true;
    if (a.id && imported.has(`epmc:${a.id}`)) return true;
    return false;
  }

  async function runSearch() {
    if (!term.trim()) { toast.error("Escribe un término de búsqueda"); return; }
    setLoading(true);
    try {
      const currentYear = new Date().getFullYear();
      let q = term.trim();
      q += " AND NOT SRC:PPR";
      if (yearFrom && yearTo) {
        q += ` AND PUB_YEAR:[${yearFrom} TO ${yearTo}]`;
      } else if (years && years !== "all") {
        const fromY = currentYear - parseInt(years);
        q += ` AND PUB_YEAR:[${fromY} TO ${currentYear}]`;
      }
      if (language === "español") q += " AND LANG:spa";
      if (language === "ingles") q += " AND LANG:eng";
      if (onlyPDF) q += " AND OPEN_ACCESS:y AND HAS_FT:y";
      if (minCitations) q += ` AND CITED_BY_COUNT:[${minCitations} TO *]`;

      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=50&resultType=core`;
      const r = await fetch(url);
      const d = await r.json();
      const list: EpmcArticle[] = d.resultList?.result ?? [];
      setTotalCount(d.hitCount ?? list.length);
      const withScores: ScoredArticle[] = list.map((a) => ({ ...a, relevance_score: previewScore(a) }));
      let sorted = withScores;
      if (sortBy === "citaciones") sorted = [...withScores].sort((a, b) => (b.citedByCount || 0) - (a.citedByCount || 0));
      else if (sortBy === "recientes") sorted = [...withScores].sort((a, b) => new Date(b.firstPublicationDate || 0).getTime() - new Date(a.firstPublicationDate || 0).getTime());
      else sorted = [...withScores].sort((a, b) => b.relevance_score - a.relevance_score);
      setResults(sorted.slice(0, 15));
    } catch (e: any) {
      toast.error(e?.message ?? "Error al buscar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!results) return;
    let sorted = [...results];
    if (sortBy === "citaciones") sorted.sort((a, b) => (b.citedByCount || 0) - (a.citedByCount || 0));
    else if (sortBy === "recientes") sorted.sort((a, b) => new Date(b.firstPublicationDate || 0).getTime() - new Date(a.firstPublicationDate || 0).getTime());
    else sorted.sort((a, b) => b.relevance_score - a.relevance_score);
    setResults(sorted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  function buildImportBody(a: ScoredArticle) {
    const types = a.pubTypeList?.pubType ?? [];
    const mesh = (a.meshHeadingList?.meshHeading ?? []).map((h) => h.descriptorName ?? "").filter(Boolean);
    const aff = a.authorList?.author?.[0]?.authorAffiliationDetailsList?.authorAffiliation?.[0]?.affiliation ?? null;
    return {
      title: a.title ?? "",
      authors: a.authorString ?? null,
      journal: a.journalTitle ?? null,
      source_institution: aff,
      year: a.pubYear ? parseInt(a.pubYear) : null,
      publication_date: a.firstPublicationDate ?? null,
      abstract_text: (a.abstractText ?? "").replace(/<[^>]*>/g, ""),
      doi: a.doi ?? null,
      pubmed_id: a.pmid ?? null,
      pmc_id: a.pmcid ?? null,
      europepmc_id: a.id,
      repository: "PubMed / EuropePMC",
      repository_id: a.pmid ?? a.pmcid ?? a.doi ?? a.id,
      source_url: a.doi ? `https://doi.org/${a.doi}` : null,
      citations_count: a.citedByCount || 0,
      document_type: detectDocumentType(types),
      evidence_level: detectEvidenceLevel(types),
      clinical_areas: detectClinicalAreas(mesh),
      language: a.language === "eng" ? "ingles" : a.language === "spa" ? "español" : "otro",
      geographic_relevance: "internacional",
    };
  }

  async function importOne(a: ScoredArticle) {
    if (!a.abstractText) { toast.error("Este artículo no tiene abstract disponible"); return; }
    setImporting((s) => new Set(s).add(a.id));
    try {
      const { error } = await supabase.functions.invoke("import-abstract", { body: buildImportBody(a) });
      if (error) throw error;
      setImported((s) => {
        const n = new Set(s);
        if (a.pmid) n.add(`pmid:${a.pmid}`);
        n.add(`epmc:${a.id}`);
        return n;
      });
      toast.success("Abstract importado");
      onImported();
    } catch (e: any) {
      toast.error(e?.message ?? "Error al importar");
    } finally {
      setImporting((s) => { const n = new Set(s); n.delete(a.id); return n; });
    }
  }

  async function importBulk() {
    if (!results) return;
    const targets = results.filter((a) => selected.has(a.id) && !isAlreadyImported(a) && a.abstractText);
    if (targets.length === 0) { toast.error("Nada para importar"); return; }
    toast.info(`Importando ${targets.length} abstracts...`);
    for (const a of targets) {
      await importOne(a);
    }
    setSelected(new Set());
  }

  const sortLabel = sortBy === "citaciones" ? "más citados" : sortBy === "recientes" ? "más recientes" : "relevancia";

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
      <div className="border-b px-6 py-3 flex items-center gap-4">
        <div className="font-semibold flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" /> Buscar abstracts en PubMed
        </div>
        <div className="flex-1 flex justify-center">
          <div className="flex gap-2 w-full max-w-[500px]">
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Tema, diagnóstico, técnica..."
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
              className="flex-1"
            />
            <Button onClick={runSearch} disabled={loading} className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />} Buscar
            </Button>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose} className="gap-1.5"><X className="h-4 w-4" /> Cerrar</Button>
      </div>

      <div className="border-b px-6 py-2 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Período:</span>
          <Select value={years} onValueChange={setYears}>
            <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="1">Último año</SelectItem>
              <SelectItem value="2">Últimos 2 años</SelectItem>
              <SelectItem value="5">Últimos 5 años</SelectItem>
              <SelectItem value="10">Últimos 10 años</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {years === "custom" && (
            <>
              <Input placeholder="Desde" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} className="w-[80px] h-8" />
              <Input placeholder="Hasta" value={yearTo} onChange={(e) => setYearTo(e.target.value)} className="w-[80px] h-8" />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch id="pdf" checked={onlyPDF} onCheckedChange={setOnlyPDF} />
          <Label htmlFor="pdf" className="cursor-pointer">📄 Solo con PDF</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Mín. citas:</span>
          <Input
            type="number"
            placeholder="Ej: 50"
            value={minCitations}
            onChange={(e) => setMinCitations(e.target.value)}
            className="w-[80px] h-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Idioma:</span>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="ingles">Inglés</SelectItem>
              <SelectItem value="español">Español</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 ml-auto bg-muted/50 rounded-md p-0.5">
          {([
            ["relevancia", "⭐ Relevancia"],
            ["citaciones", "📊 Más citados"],
            ["recientes", "📅 Más recientes"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setSortBy(v)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium",
                sortBy === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!results && !loading && (
          <div className="p-20 text-center text-muted-foreground text-sm">
            Escribe un término clínico arriba y presiona Buscar.
          </div>
        )}
        {loading && (
          <div className="p-6 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}
        {results && (
          <div>
            <div className="px-6 py-2 text-xs text-muted-foreground border-b bg-muted/20">
              {totalCount.toLocaleString()} resultados encontrados · Mostrando top {results.length} · Ordenado por {sortLabel}
            </div>
            {results.length === 0 ? (
              <div className="p-20 text-center text-muted-foreground text-sm">No se encontraron resultados.</div>
            ) : (
              <table className="w-full text-xs table-fixed">
                <thead className="bg-muted/40 text-[11px] text-muted-foreground sticky top-0">
                  <tr>
                    <th className="p-2" style={{ width: "3%" }}></th>
                    <th className="p-2 text-left" style={{ width: "5%" }}>Score</th>
                    <th className="p-2 text-left" style={{ width: "20%" }}>Título</th>
                    <th className="p-2 text-left" style={{ width: "9%" }}>Autores</th>
                    <th className="p-2 text-left" style={{ width: "9%" }}>Revista</th>
                    <th className="p-2 text-left" style={{ width: "8%" }}>Institución</th>
                    <th className="p-2 text-left" style={{ width: "4%" }}>Año</th>
                    <th className="p-2 text-left" style={{ width: "7%" }}>Tipo</th>
                    <th className="p-2 text-left" style={{ width: "9%" }}>Área clínica</th>
                    <th className="p-2 text-left" style={{ width: "6%" }}>Evidencia</th>
                    <th className="p-2 text-left" style={{ width: "4%" }}>Citas</th>
                    <th className="p-2 text-left" style={{ width: "4%" }}>PDF</th>
                    <th className="p-2 text-left" style={{ width: "12%" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((a) => {
                    const isExp = expanded.has(a.id);
                    const types = a.pubTypeList?.pubType ?? [];
                    const mesh = (a.meshHeadingList?.meshHeading ?? []).map((h) => h.descriptorName ?? "").filter(Boolean);
                    const areas = detectClinicalAreas(mesh);
                    const ev = detectEvidenceLevel(types);
                    const aff = a.authorList?.author?.[0]?.authorAffiliationDetailsList?.authorAffiliation?.[0]?.affiliation ?? "";
                    const pdf = pdfUrlOf(a);
                    const already = isAlreadyImported(a);
                    const isImporting = importing.has(a.id);
                    const sc = a.relevance_score;
                    const scColor = sc > 70 ? "bg-emerald-500" : sc >= 40 ? "bg-amber-400" : "bg-red-400";
                    return (
                      <Fragment key={a.id}>
                        <tr className="border-t hover:bg-muted/20 align-top">
                          <td className="p-2 pt-3">
                            <input
                              type="checkbox"
                              disabled={already || !a.abstractText}
                              checked={selected.has(a.id)}
                              onChange={(e) => {
                                setSelected((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(a.id); else n.delete(a.id);
                                  return n;
                                });
                              }}
                            />
                          </td>
                          <td className="p-2 pt-3">
                            <div className={cn("inline-flex items-center justify-center h-7 w-7 rounded-full text-white text-[10px] font-semibold", scColor)}>
                              {sc}
                            </div>
                          </td>
                          <td className="p-2 pt-3">
                            <button
                              className="text-left font-medium leading-snug line-clamp-2 hover:text-primary"
                              onClick={() => setExpanded((s) => {
                                const n = new Set(s);
                                if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                                return n;
                              })}
                            >
                              {a.title}
                            </button>
                            {already && <Badge className="ml-1 text-[9px] bg-emerald-500/15 text-emerald-700 border-emerald-500/30">✅ Ya importado</Badge>}
                          </td>
                          <td className="p-2 pt-3 text-muted-foreground truncate" title={a.authorString}>
                            {(a.authorString ?? "").split(",")[0]}{(a.authorString ?? "").includes(",") && " et al."}
                          </td>
                          <td className="p-2 pt-3 text-muted-foreground truncate" title={a.journalTitle}>{a.journalTitle ?? "—"}</td>
                          <td className="p-2 pt-3 text-muted-foreground truncate" title={aff}>{aff || "—"}</td>
                          <td className="p-2 pt-3">{a.pubYear ?? "—"}</td>
                          <td className="p-2 pt-3">
                            <Badge variant="outline" className="text-[9px]">{shortLabel(types.join(" "))}</Badge>
                          </td>
                          <td className="p-2 pt-3">
                            <div className="flex flex-wrap gap-0.5">
                              {areas.slice(0, 2).map((ca) => (
                                <span key={ca} className={cn("text-[9px] px-1 py-0.5 rounded", clinicalAreaColor(ca))}>
                                  {clinicalAreaLabel(ca)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-2 pt-3">
                            <Badge variant="outline" className="text-[9px]">{EVIDENCE_LABELS[ev] ?? ev}</Badge>
                          </td>
                          <td className={cn("p-2 pt-3 tabular-nums", (a.citedByCount || 0) > 50 && "text-amber-600 font-semibold")}>
                            {a.citedByCount ?? 0}
                          </td>
                          <td className="p-2 pt-3">
                            {pdf ? <span title="PDF disponible">🟢</span> : <span title="Solo abstract">📝</span>}
                          </td>
                          <td className="p-2 pt-2">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                disabled={already || isImporting || !a.abstractText}
                                onClick={() => importOne(a)}
                                className="h-7 px-2 text-[10px] bg-teal-600 hover:bg-teal-700 text-white"
                              >
                                {isImporting ? <Loader2 className="h-3 w-3 animate-spin" /> : already ? "✅" : "➕ Importar"}
                              </Button>
                              
                                href={a.doi ? `https://doi.org/${a.doi}` : (pdf ?? `https://europepmc.org/article/${a.source ?? "MED"}/${a.id}`)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]">🔗 ↗</Button>
                              </a>
                            </div>
                          </td>
                        </tr>
                        {isExp && (
                          <tr className="bg-muted/10 border-t">
                            <td colSpan={13} className="p-4">
                              <div
                                className="text-xs leading-relaxed whitespace-pre-wrap mb-3"
                                dangerouslySetInnerHTML={{ __html: formatAbstract((a.abstractText ?? "").replace(/<[^>]*>/g, "")) }}
                              />
                              <div className="flex flex-wrap gap-2 items-center">
                                {a.doi && (
                                  <a href={`https://doi.org/${a.doi}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                                    DOI: {a.doi}
                                  </a>
                                )}
                                <Button
                                  size="sm"
                                  disabled={already || isImporting || !a.abstractText}
                                  onClick={() => importOne(a)}
                                  className="h-7 px-3 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                                >
                                  {already ? "✅ Importado" : "➕ Importar abstract"}
                                </Button>
                                {pdf && (
                                  <a href={pdf} target="_blank" rel="noreferrer">
                                    <Button size="sm" variant="outline" className="h-7 px-3 text-xs gap-1">
                                      📄 Abrir PDF <ExternalLink className="h-3 w-3" />
                                    </Button>
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="border-t px-6 py-3 flex items-center justify-between bg-background">
          <div className="text-sm">{selected.size} abstracts seleccionados</div>
          <Button onClick={importBulk} className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5">
            <Plus className="h-4 w-4" /> Importar todos
          </Button>
        </div>
      )}
    </div>
  );
}