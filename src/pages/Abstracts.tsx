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