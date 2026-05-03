import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PubMedSearchDialog } from "@/components/PubMedSearchDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  Play, ChevronLeft, ChevronRight, FileText, Brain, RefreshCw,
  ExternalLink, FlaskConical, Newspaper, Coffee, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const todayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const targetIdx = DAY_KEYS.indexOf(dayKey as any);
  const diff = targetIdx - todayIdx;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d;
}
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hace instantes";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

type SchedPatient = {
  id: string; first_name: string; last_name: string;
  diagnosis: string | null; session_day: string | null; session_time: string | null;
};

/* ---------------- Section 1: Patients of the day ---------------- */
function PatientsSection({ patients }: { patients: SchedPatient[] }) {
  const navigate = useNavigate();
  const [dayIdx, setDayIdx] = useState(() => {
    const t = DAY_KEYS.indexOf(todayKey() as any);
    return t === -1 ? 0 : t;
  });
  const dayKey = DAY_KEYS[dayIdx];
  const dayDate = dateForDay(dayKey);
  const dateLabel = `${DAY_LABELS[dayKey]} ${dayDate.getDate()} ${dayDate.toLocaleString("es", { month: "short" })}`;
  const todayStr = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

  const dayPatients = useMemo(() =>
    patients
      .filter((p) => p.session_day === dayKey)
      .sort((a, b) => (a.session_time ?? "99:99").localeCompare(b.session_time ?? "99:99")),
    [patients, dayKey],
  );

  const startSession = (id: string) => navigate(`/patients/${id}?session=1`);
  const goSuggestions = (p: SchedPatient) => {
    const q = encodeURIComponent(
      `Debate diagnóstico para paciente ${p.first_name} ${p.last_name}${p.diagnosis ? ` (${p.diagnosis})` : ""}: hipótesis diagnósticas, diferenciales y enfoques de tratamiento basados en evidencia.`,
    );
    navigate(`/assistant?q=${q}`);
  };

  return (
    <Card className="rounded-xl p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Coffee className="h-5 w-5 text-primary" /> Café de la mañana
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 capitalize">{todayStr}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 bg-muted/40 rounded-lg px-2 py-1.5 max-w-sm">
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => setDayIdx((i) => (i + 6) % 7)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold capitalize">{dateLabel}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => setDayIdx((i) => (i + 1) % 7)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {dayPatients.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Sin pacientes agendados para este día
          </p>
        ) : dayPatients.map((p) => (
          <div key={p.id}
            className="flex items-center gap-3 p-3 rounded-lg border hover:border-primary/40 hover:bg-muted/30 transition-all">
            <div className="h-10 w-10 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
              {p.first_name[0]}{p.last_name[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold truncate">{p.first_name} {p.last_name}</span>
                {p.session_time && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(p.session_time).slice(0, 5)}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{p.diagnosis ?? "Sin diagnóstico registrado"}</div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                onClick={() => navigate(`/patients/${p.id}`)}>
                <FileText className="h-3 w-3" /> Ver ficha
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                onClick={() => goSuggestions(p)}>
                <Brain className="h-3 w-3" /> Sugerencias
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => startSession(p.id)}>
                <Play className="h-3 w-3" /> Iniciar sesión
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Section 2: PubMed feed ---------------- */
type PubMedItem = {
  id: string; pmid?: string; pmcid?: string; doi?: string;
  title: string; authors: string; journal: string; date: string;
  hasPdf: boolean; pdfUrl: string | null; articleUrl: string;
  source: string; year?: string; citedByCount?: number;
};
const PUBMED_CACHE_KEY = "cafe-pubmed:v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function PubMedSection({ onImport, onSeeMore }: {
  onImport: (it: PubMedItem) => void;
  onSeeMore: () => void;
}) {
  const [items, setItems] = useState<PubMedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(PUBMED_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Date.now() - parsed.ts < CACHE_TTL_MS) {
            setItems(parsed.items); setUpdatedAt(parsed.ts); return;
          }
        }
      } catch {}
    }
    setLoading(true); setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const q = `(MeSH_TERM:"Mental Disorders" OR MeSH_TERM:"Psychotherapy" OR MeSH_TERM:"Psychiatry" OR MeSH_TERM:"Psychology, Clinical") AND OPEN_ACCESS:y AND FIRST_PDATE:[${twoWeeksAgo} TO ${today}]`;
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=8&sort=CITED&resultType=core`;
      const res = await fetch(url);
      const data = await res.json();
      const mapped: PubMedItem[] = (data.resultList?.result ?? []).map((a: any) => {
        const hasPdf = a.hasPDF === "Y" && !!a.pmcid;
        return {
          id: a.id, pmid: a.pmid, pmcid: a.pmcid, doi: a.doi,
          title: a.title ?? "Sin título",
          authors: (a.authorString ?? "").split(",")[0] + (a.authorString?.includes(",") ? " et al." : ""),
          journal: a.journalTitle ?? "",
          date: a.firstPublicationDate ?? a.pubYear ?? "",
          year: a.pubYear,
          citedByCount: a.citedByCount,
          hasPdf,
          pdfUrl: hasPdf ? `https://pmc.ncbi.nlm.nih.gov/articles/${a.pmcid}/pdf/` : null,
          articleUrl: `https://europepmc.org/article/${a.source}/${a.id}`,
          source: a.source ?? "MED",
        };
      });
      setItems(mapped);
      const ts = Date.now();
      setUpdatedAt(ts);
      localStorage.setItem(PUBMED_CACHE_KEY, JSON.stringify({ ts, items: mapped }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="rounded-xl p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> Publicaciones recientes
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            PubMed · Últimos 14 días{updatedAt ? ` · Actualizado ${relativeTime(updatedAt)}` : ""}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading && !items ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : error ? (
          <p className="text-sm text-destructive col-span-full">{error}</p>
        ) : items?.length === 0 ? (
          <p className="text-sm text-muted-foreground col-span-full">Sin resultados recientes.</p>
        ) : items?.map((it) => (
          <div key={it.id} className="border rounded-lg p-3 flex flex-col gap-1.5 hover:border-primary/50 transition-colors">
            <a href={it.pdfUrl ?? it.articleUrl} target="_blank" rel="noreferrer"
              className="text-sm font-semibold leading-snug line-clamp-2 hover:text-primary">
              {it.title}
            </a>
            <div className="text-xs text-muted-foreground truncate">{it.authors} · {it.journal}</div>
            <div className="text-xs text-muted-foreground">
              {it.date}
              {typeof it.citedByCount === "number" && it.citedByCount > 0 && (
                <span className="ml-2">· {it.citedByCount} citas</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-auto pt-1.5 flex-wrap">
              {it.hasPdf && (
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  🟢 PDF disponible
                </Badge>
              )}
              {it.hasPdf && it.pdfUrl && (
                <a href={it.pdfUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2">
                    📄 Abrir PDF ↗
                  </Button>
                </a>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => onImport(it)}>
                <Plus className="h-3 w-3 mr-0.5" /> Importar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-right">
        <button onClick={onSeeMore} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          Ver más en PubMed <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    </Card>
  );
}

/* ---------------- Section 3: Psych news ---------------- */
type NewsItem = {
  title: string; title_es?: string; source: string; url: string;
  summary?: string; summary_es?: string; date: string; category: string;
};
const NEWS_CACHE_KEY = "cafe-psych-news:v1";
const CAT_COLORS: Record<string, string> = {
  investigación: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  clínica: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  neurociencia: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  política_salud: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  farmacología: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  otro: "bg-muted text-muted-foreground",
};
const CAT_EMOJI: Record<string, string> = {
  investigación: "🔵", clínica: "🟢", neurociencia: "🟣",
  política_salud: "🟡", farmacología: "🟠", otro: "⚪",
};

function NewsSection() {
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
          if (Date.now() - parsed.ts < CACHE_TTL_MS) {
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
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary" /> Noticias en psicología
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fuentes científicas · Últimos 14 días{updatedAt ? ` · Actualizado ${relativeTime(updatedAt)}` : ""}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Actualizar
        </Button>
      </div>

      <div className="space-y-2.5">
        {loading && !items ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin noticias disponibles.</p>
        ) : items?.map((n, i) => {
          const cat = n.category || "otro";
          const title = n.title_es || n.title;
          const summary = n.summary_es || n.summary || "";
          return (
            <div key={i} className="border rounded-lg p-3 hover:border-primary/40 transition-colors">
              <div className="flex items-start gap-2 mb-1 flex-wrap">
                <Badge className={cn("text-[10px] py-0 px-1.5 capitalize border-transparent", CAT_COLORS[cat] ?? CAT_COLORS.otro)}>
                  {CAT_EMOJI[cat] ?? "⚪"} {cat.replace("_", " ")}
                </Badge>
                <a href={n.url} target="_blank" rel="noreferrer"
                  className="text-sm font-semibold hover:text-primary leading-snug flex-1 min-w-0">
                  {title}
                </a>
              </div>
              <div className="text-xs text-muted-foreground mb-1">{n.source} · {n.date}</div>
              <p className="text-xs text-muted-foreground line-clamp-2">{summary}</p>
              <a href={n.url} target="_blank" rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 mt-1">
                Leer artículo ↗
              </a>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- Page ---------------- */
export default function Cafe() {
  const [patients, setPatients] = useState<SchedPatient[]>([]);
  const [pubmedDialogOpen, setPubmedDialogOpen] = useState(false);
  const [pubmedQuery, setPubmedQuery] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, diagnosis, session_day, session_time");
      setPatients((data as SchedPatient[]) ?? []);
    })();
  }, []);

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto space-y-5">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          ☕ Café
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pacientes del día, publicaciones y noticias en psicología.
        </p>
      </header>

      <PatientsSection patients={patients} />
      <PubMedSection
        onImport={(it) => { setPubmedQuery(it.title); setPubmedDialogOpen(true); }}
        onSeeMore={() => { setPubmedQuery("psychology psychiatry"); setPubmedDialogOpen(true); }}
      />
      <NewsSection />

      <PubMedSearchDialog
        open={pubmedDialogOpen}
        onOpenChange={setPubmedDialogOpen}
        initialQuery={pubmedQuery}
        autoSearch
      />
    </div>
  );
}
