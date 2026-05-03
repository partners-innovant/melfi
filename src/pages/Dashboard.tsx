import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import FeedbackButton from "@/components/FeedbackButton";
import { DashboardEthicalDisclaimer } from "@/components/EthicalDisclaimer";
import { supabase } from "@/integrations/supabase/client";
import { Play, Plus } from "lucide-react";

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
  { emoji: "☕", title: "Café", description: "Pacientes del día, publicaciones y noticias en psicología.", cta: "Abrir Café", to: "/cafe" },
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

type SchedPatient = { id: string; first_name: string; last_name: string; diagnosis: string | null };

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
        .select("id, first_name, last_name, diagnosis")
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

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const name = profile?.first_name ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);

  const startSession = (id: string) => navigate(`/patients/${id}?session=1`);

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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
    </div>
  );
}
