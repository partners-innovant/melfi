import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import FeedbackButton from "@/components/FeedbackButton";
import { DashboardEthicalDisclaimer } from "@/components/EthicalDisclaimer";
import { supabase } from "@/integrations/supabase/client";
import { Play, ChevronLeft, ChevronRight, FileText, Brain, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Feature = {
  emoji: string;
  title: string;
  description: string;
  cta: string;
  to?: string;
  feedback?: boolean;
};

const FEATURES: Feature[] = [
  {
    emoji: "✨",
    title: "Asistente IA",
    description: "Consulta literatura clínica y debate diagnósticos con IA basada en evidencia.",
    cta: "Ir al Asistente",
    to: "/assistant",
  },
  {
    emoji: "👤",
    title: "Pacientes",
    description: "Gestiona fichas clínicas, construye perfiles y registra sesiones.",
    cta: "Ver pacientes",
    to: "/patients",
  },
  {
    emoji: "🧒",
    title: "Infanto-Juvenil",
    description: "Fichas especializadas con tests, informes y seguimiento conductual.",
    cta: "Ver pacientes",
    to: "/children",
  },
  {
    emoji: "📄",
    title: "Base de conocimiento",
    description: "Sube y organiza guías clínicas y artículos científicos.",
    cta: "Ver documentos",
    to: "/documents",
  },
  {
    emoji: "📅",
    title: "Calendario",
    description: "Agenda y sincroniza sesiones con Google Calendar.",
    cta: "Ver calendario",
    to: "/calendar",
  },
  {
    emoji: "💬",
    title: "Sugerencias y mejoras",
    description: "Comparte ideas o reporta errores para mejorar Psicoasist.",
    cta: "Enviar feedback",
    feedback: true,
  },
];

function FeatureCard({ f }: { f: Feature }) {
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="w-full border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary"
    >
      {f.cta}
    </Button>
  );

  return (
    <Card className="rounded-xl p-4 flex flex-col h-full transition-all border-border hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-full bg-primary-soft flex items-center justify-center text-base">
          <span aria-hidden>{f.emoji}</span>
        </div>
        <h3 className="font-semibold text-sm">{f.title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-snug mb-3 flex-1 line-clamp-2">
        {f.description}
      </p>
      {f.feedback ? (
        <FeedbackButton trigger={button} />
      ) : (
        <Link to={f.to!} className="block">{button}</Link>
      )}
    </Card>
  );
}

const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
const DAY_LABELS: Record<string, string> = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves",
  viernes: "Viernes", sabado: "Sábado", domingo: "Domingo",
};

// JS getDay(): 0=Sun..6=Sat → map to our keys
function todayKey(): string {
  const d = new Date().getDay();
  return ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][d];
}

type SchedPatient = {
  id: string;
  first_name: string;
  last_name: string;
  diagnosis: string | null;
  session_day: string | null;
  session_time: string | null;
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
            <button
              key={p.id}
              onClick={() => { onPick(p.id); onOpenChange(false); }}
              className="w-full text-left py-2.5 px-2 hover:bg-muted rounded-md flex items-center gap-3"
            >
              <div className="h-8 w-8 rounded-full bg-primary-soft text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
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

function CafeDeLaMañana({ patients, onStartSession }: {
  patients: SchedPatient[];
  onStartSession: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [dayIdx, setDayIdx] = useState(() => DAY_KEYS.indexOf(todayKey() as any));
  const dayKey = DAY_KEYS[dayIdx];
  const today = todayKey();

  const dayPatients = useMemo(() => {
    return patients
      .filter((p) => p.session_day === dayKey)
      .sort((a, b) => (a.session_time ?? "99:99").localeCompare(b.session_time ?? "99:99"));
  }, [patients, dayKey]);

  return (
    <Card className="rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold">☕ Café de la mañana</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {DAY_KEYS.map((k, i) => (
            <button
              key={k}
              onClick={() => setDayIdx(i)}
              className={cn(
                "text-xs px-2 py-1 rounded-md border transition-colors",
                i === dayIdx
                  ? "bg-teal-600 text-white border-teal-600"
                  : k === today
                  ? "border-teal-500/50 text-teal-700 dark:text-teal-300"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {DAY_LABELS[k].slice(0, 3)}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => setDayIdx((i) => (i + 6) % 7)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium w-20 text-center">{DAY_LABELS[dayKey]}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => setDayIdx((i) => (i + 1) % 7)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {dayPatients.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No hay pacientes agendados para este día
        </p>
      ) : (
        <div className="space-y-2">
          {dayPatients.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/40 transition-colors">
              <div className="h-9 w-9 rounded-full bg-primary-soft text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {p.first_name[0]}{p.last_name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p.first_name} {p.last_name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.diagnosis ?? "—"}</div>
              </div>
              {p.session_time && (
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {String(p.session_time).slice(0, 5)}
                </span>
              )}
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                  onClick={() => navigate(`/patients/${p.id}`)}>
                  <FileText className="h-3.5 w-3.5" /> Ver ficha
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                  onClick={() => {
                    const q = `Debatamos el diagnóstico de ${p.first_name} ${p.last_name}${p.diagnosis ? ` (${p.diagnosis})` : ""}. ¿Qué diagnósticos diferenciales y consideraciones basadas en evidencia debería tener en cuenta?`;
                    navigate(`/assistant?patient=${p.id}&q=${encodeURIComponent(q)}`);
                  }}>
                  <Brain className="h-3.5 w-3.5" /> Sugerencias
                </Button>
                <Button size="sm" className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => onStartSession(p.id)}>
                  <Play className="h-3.5 w-3.5" /> Iniciar sesión
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const name = profile?.first_name ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
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

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Bienvenido{name ? `, ${name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">¿En qué quieres trabajar hoy?</p>
      </header>

      <DashboardEthicalDisclaimer />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 auto-rows-fr mb-8">
        {FEATURES.map((f) => <FeatureCard key={f.title} f={f} />)}
      </div>

      {/* Acciones rápidas */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Acciones rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() => setPickerOpen(true)}
            className="rounded-xl p-4 bg-teal-600 hover:bg-teal-700 text-white text-left transition-colors flex items-center gap-3 shadow-sm"
          >
            <div className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center text-lg flex-shrink-0">
              ▶️
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm">Iniciar nueva sesión</div>
              <div className="text-xs text-white/80 truncate">Selecciona un paciente y empieza</div>
            </div>
          </button>
        </div>
      </section>

      <CafeDeLaMañana patients={allPatients} onStartSession={startSession} />

      <PatientSelectorDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={startSession} />
    </div>
  );
}
