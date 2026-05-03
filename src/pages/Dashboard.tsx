import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import FeedbackButton from "@/components/FeedbackButton";
import { DashboardEthicalDisclaimer } from "@/components/EthicalDisclaimer";
import { PubMedSearchDialog } from "@/components/PubMedSearchDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  Play, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw, ExternalLink,
  FlaskConical, Newspaper,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------- Feature cards ---------------- */
type Feature = {
  emoji: string; title: string; description: string; cta: string;
  to?: string; feedback?: boolean;
};
const FEATURES: Feature[] = [
  { emoji: "✨", title: "Asistente IA", description: "Consulta literatura clínica y debate diagnósticos con IA basada en evidencia.", cta: "Ir al Asistente", to: "/assistant" },
  { emoji: "👤", title: "Adultos", description: "Gestiona fichas clínicas, construye perfiles y registra sesiones.", cta: "Ver pacientes", to: "/patients" },
  { emoji: "🧒", title: "Infanto-Juvenil", description: "Fichas especializadas con tests, informes y seguimiento.", cta: "Ver pacientes", to: "/children" },
  { emoji: "📄", title: "Documentos", description: "Sube y organiza guías clínicas y artículos científicos.", cta: "Ver documentos", to: "/documents" },
  { emoji: "📅", title: "Calendario", description: "Agenda y sincroniza sesiones con Google Calendar.", cta: "Ver calendario", to: "/calendar" },
  { emoji: "💬", title: "Feedback", description: "Comparte ideas o reporta errores para mejorar Psicoasist.", cta: "Enviar feedback", feedback: true },
];

function FeatureCard({ f }: { f: Feature }) {
  const button = (
    <Button variant="outline" size="sm"
      className="w-full h-7 text-xs border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary">
      {f.cta}
    </Button>
  );
  return (
    <Card className="rounded-xl p-3 flex flex-col h-full border-border hover:border-primary/50 hover:shadow-md transition-all">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="h-7 w-7 rounded-full bg-primary-soft flex items-center justify-center text-sm">
          <span aria-hidden>{f.emoji}</span>
        </div>
        <h3 className="font-semibold text-xs">{f.title}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug mb-2 flex-1 line-clamp-2">{f.description}</p>
      {f.feedback ? <FeedbackButton trigger={button} /> : <Link to={f.to!} className="block">{button}</Link>}
    </Card>
  );
}

/* ---------------- Café de la mañana ---------------- */
const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
const DAY_LABELS: Record<string, string> = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves",
  viernes: "Viernes", sabado: "Sábado", domingo: "Domingo",
};
function todayKey(): string {
  const d = new Date().getDay();
  return ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][d];
}
function dateForDay(dayKey: string): Date {
  const today = new Date();
  const todayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1; // make Mon=0
  const targetIdx = DAY_KEYS.indexOf(dayKey as any);
  const diff = targetIdx - todayIdx;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d;
}

type SchedPatient = {
  id: string; first_name: string; last_name: string;
  diagnosis: string | null; session_day: string | null; session_time: string | null;
};

function PatientSelectorDialog({
  open, onOpenChange, onPick,
}: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void }) {
  const [patients, setPatients] = useState<SchedPatient[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, diagnosis, session_day, session_time")
        .order("first_name");
      setPatients((data as SchedPatient[]) ?? []);
    })();
  }, [open]);
  const filtered = patients.filter((p) =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Selecciona un paciente</DialogTitle></DialogHeader>
        <Input placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[400px] overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin resultados</p>
          ) : filtered.map((p) => (
            <button key={p.id}
              onClick={() => { onPick(p.id); onOpenChange(false); }}
              className="w-full text-left py-2.5 px-2 hover:bg-muted rounded-md flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {p.first_name[0]}{p.last_name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p.first_name} {p.last_name}</div>
                {p.diagnosis && <div className="text-xs text-muted-foreground truncate">{p.diagnosis}</div>}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CafeSidebar({
  patients, onStartSession, onOpenPicker,
}: {
  patients: SchedPatient[];
  onStartSession: (id: string) => void;
  onOpenPicker: () => void;
}) {
  const navigate = useNavigate();
  const [dayIdx, setDayIdx] = useState(() => {
    const t = DAY_KEYS.indexOf(todayKey() as any);
    return t === -1 ? 0 : t;
  });
  const dayKey = DAY_KEYS[dayIdx];
  const dayDate = dateForDay(dayKey);
  const dateLabel = `${DAY_LABELS[dayKey]} ${dayDate.getDate()} ${dayDate.toLocaleString("es", { month: "short" })}`;

  const dayPatients = useMemo(() => {
    return patients
      .filter((p) => p.session_day === dayKey)
      .sort((a, b) => (a.session_time ?? "99:99").localeCompare(b.session_time ?? "99:99"));
  }, [patients, dayKey]);

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
      <Card className="rounded-xl p-4">
        <h2 className="text-base font-semibold mb-3">☕ Café de la mañana</h2>

        <div className="flex items-center justify-between mb-3 bg-muted/40 rounded-lg px-1 py-1">
          <Button size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => setDayIdx((i) => (i + 6) % 7)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-semibold capitalize">{dateLabel}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7"
            onClick={() => setDayIdx((i) => (i + 1) % 7)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1.5 max-h-[420px] overflow-y-auto -mx-1 px-1">
          {dayPatients.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Sin pacientes agendados</p>
          ) : dayPatients.map((p) => (
            <div key={p.id}
              className="group flex items-center gap-2 p-2 rounded-lg hover:bg-muted/60 transition-colors">
              <div className="h-8 w-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-[11px] font-semibold flex-shrink-0">
                {p.first_name[0]}{p.last_name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold truncate">{p.first_name} {p.last_name}</span>
                  {p.session_time && (
                    <span className="text-[10px] tabular-nums text-muted-foreground ml-auto flex-shrink-0">
                      {String(p.session_time).slice(0, 5)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{p.diagnosis ?? "—"}</div>
                <div className="hidden group-hover:flex gap-1 mt-1">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2"
                    onClick={() => navigate(`/patients/${p.id}`)}>
                    <FileText className="h-3 w-3" /> Ver ficha
                  </Button>
                  <Button size="sm" className="h-6 text-[10px] gap-1 px-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => onStartSession(p.id)}>
                    <Play className="h-3 w-3" /> Sesión
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Link to="/calendar"
          className="block mt-3 text-xs text-primary hover:underline text-center">
          ➕ Agendar paciente
        </Link>
      </Card>

      <Card className="rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-2">Acciones rápidas</h3>
        <div className="space-y-2">
          <button onClick={onOpenPicker}
            className="w-full rounded-lg p-3 bg-teal-600 hover:bg-teal-700 text-white text-left transition-colors flex items-center gap-2 text-sm font-medium">
            <Play className="h-4 w-4" /> Iniciar nueva sesión
          </button>
          <Link to="/patients?new=1"
            className="w-full rounded-lg p-3 bg-primary/10 hover:bg-primary/20 text-primary text-left transition-colors flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4" /> Nuevo paciente
          </Link>
        </div>
      </Card>
    </aside>
  );
}

/* ---------------- PubMed feed ---------------- */
type PubMedItem = {
  id: string; pmid?: string; pmcid?: string; doi?: string;
  title: string; authors: string; journal: string; date: string;
  hasPdf: boolean; pdfUrl: string | null; articleUrl: string;
  source: string;
};

function PubMedFeed({ onImport, onSeeMore }: {
  onImport: (item: PubMedItem) => void;
  onSeeMore: () => void;
}) {
  const [items, setItems] = useState<PubMedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const q = `(psychology OR psychiatry OR psychotherapy OR CBT OR DBT) AND FIRST_PDATE:[${twoWeeksAgo} TO ${today}]`;
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=6&sort=CITED&resultType=core`;
      const res = await fetch(url);
      const data = await res.json();
      const mapped: PubMedItem[] = (data.resultList?.result ?? []).map((a: any) => {
        const hasPdf = a.hasPDF === "Y" && !!a.pmcid;
        return {
          id: a.id,
          pmid: a.pmid, pmcid: a.pmcid, doi: a.doi,
          title: a.title ?? "Sin título",
          authors: (a.authorString ?? "").split(",")[0] + (a.authorString?.includes(",") ? " et al." : ""),
          journal: a.journalTitle ?? "",
          date: a.firstPublicationDate ?? a.pubYear ?? "",
          hasPdf,
          pdfUrl: hasPdf ? `https://pmc.ncbi.nlm.nih.gov/articles/${a.pmcid}/pdf/` : null,
          articleUrl: `https://europepmc.org/article/${a.source}/${a.id}`,
          source: a.source ?? "MED",
        };
      });
      setItems(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="rounded-xl p-5">
      <div className="flex items-start justify-between mb-1 gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Publicaciones recientes en PubMed
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Últimos 14 días · Psicología clínica</p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-primary" onClick={onSeeMore}>
            Ver más <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
        {loading && !items ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : error ? (
          <p className="text-xs text-destructive col-span-full">{error}</p>
        ) : items?.length === 0 ? (
          <p className="text-xs text-muted-foreground col-span-full">Sin resultados recientes.</p>
        ) : items?.map((it) => (
          <div key={it.id} className="border rounded-lg p-3 flex flex-col gap-1.5 hover:border-primary/50 transition-colors">
            <a href={it.pdfUrl ?? it.articleUrl} target="_blank" rel="noreferrer"
              className="text-xs font-semibold leading-snug line-clamp-2 hover:text-primary">
              {it.title}
            </a>
            <div className="text-[10px] text-muted-foreground truncate">{it.authors}</div>
            <div className="text-[10px] text-muted-foreground truncate">{it.journal} · {it.date}</div>
            <div className="flex items-center gap-1 mt-auto pt-1.5 flex-wrap">
              {it.hasPdf && <Badge variant="secondary" className="text-[9px] py-0 px-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">PDF</Badge>}
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onImport(it)}>
                <Plus className="h-3 w-3 mr-0.5" /> Importar
              </Button>
              <a href={it.articleUrl} target="_blank" rel="noreferrer"
                className="text-[10px] text-primary hover:underline ml-auto">
                Ver en PubMed ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- News feed ---------------- */
type NewsItem = {
  title: string; source: string; url: string; summary: string;
  date: string; category: string;
};
const NEWS_CACHE_KEY = "psych-news:v1";
const NEWS_TTL_MS = 6 * 60 * 60 * 1000;
const CAT_COLORS: Record<string, string> = {
  investigación: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  clínica: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  política_salud: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  neurociencia: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  otro: "bg-muted text-muted-foreground",
};
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / (60 * 60 * 1000));
  if (h < 1) return "hace unos minutos";
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function NewsFeed() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(NEWS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.ts < NEWS_TTL_MS) {
            setItems(parsed.items); setUpdatedAt(parsed.ts); return;
          }
        }
      } catch {}
    }
    setLoading(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-psych-news", { body: {} });
      if (error) throw error;
      const list = (data?.items ?? []) as NewsItem[];
      setItems(list);
      const ts = Date.now();
      setUpdatedAt(ts);
      localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({ ts, items: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="rounded-xl p-5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" /> Noticias en psicología
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fuentes científicas seleccionadas{updatedAt ? ` · Actualizado ${relativeTime(updatedAt)}` : ""}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="space-y-2">
        {loading && !items ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : items?.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin noticias disponibles.</p>
        ) : items?.map((n, i) => (
          <div key={i} className="border rounded-lg p-3 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-2 mb-1 flex-wrap">
              <Badge className={cn("text-[9px] py-0 px-1.5 capitalize border-transparent", CAT_COLORS[n.category] ?? CAT_COLORS.otro)}>
                {n.category?.replace("_", " ")}
              </Badge>
              <a href={n.url} target="_blank" rel="noreferrer"
                className="text-sm font-semibold hover:text-primary leading-snug flex-1 min-w-0">
                {n.title}
              </a>
            </div>
            <div className="text-[10px] text-muted-foreground mb-1">{n.source} · {n.date}</div>
            <p className="text-xs text-muted-foreground line-clamp-2">{n.summary}</p>
            <a href={n.url} target="_blank" rel="noreferrer"
              className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 mt-1">
              Leer más ↗
            </a>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Page ---------------- */
export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const name = profile?.first_name ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pubmedDialogOpen, setPubmedDialogOpen] = useState(false);
  const [pubmedQuery, setPubmedQuery] = useState("");
  const [allPatients, setAllPatients] = useState<SchedPatient[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, diagnosis, session_day, session_time");
      setAllPatients((data as SchedPatient[]) ?? []);
    })();
  }, []);

  const startSession = (id: string) => navigate(`/patients/${id}?session=1`);

  const handleImportPubMed = (it: PubMedItem) => {
    // Open PubMed dialog with the title as query so the user can import via the existing flow
    setPubmedQuery(it.title);
    setPubmedDialogOpen(true);
  };

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Bienvenido{name ? `, ${name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">¿En qué quieres trabajar hoy?</p>
      </header>

      <DashboardEthicalDisclaimer />

      <div className="space-y-5 mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {FEATURES.map((f) => <FeatureCard key={f.title} f={f} />)}
        </div>

        <Card className="rounded-xl p-5">
          <h2 className="text-base font-semibold mb-3">Acciones rápidas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button onClick={() => setPickerOpen(true)}
              className="rounded-lg p-4 bg-teal-600 hover:bg-teal-700 text-white text-left transition-colors flex items-center gap-2 text-sm font-medium">
              <Play className="h-4 w-4" /> Iniciar nueva sesión
            </button>
            <Link to="/patients?new=1"
              className="rounded-lg p-4 bg-primary/10 hover:bg-primary/20 text-primary text-left transition-colors flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4" /> Nuevo paciente
            </Link>
          </div>
        </Card>
      </div>

      <PatientSelectorDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={startSession} />
      <PubMedSearchDialog
        open={pubmedDialogOpen}
        onOpenChange={setPubmedDialogOpen}
        initialQuery={pubmedQuery}
        autoSearch
      />
    </div>
  );
}
