import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FeedbackButton from "@/components/FeedbackButton";
import { ImprovePromptButton } from "@/components/ImprovePromptButton";
import { DashboardEthicalDisclaimer } from "@/components/EthicalDisclaimer";
import { supabase } from "@/integrations/supabase/client";
import { Play, FileEdit, Coffee, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Feature = {
  emoji: string; title: string; description: string; cta: string;
  to?: string; feedback?: boolean;
};
const FEATURES: Feature[] = [
  { emoji: "✨", title: "Asistente IA", description: "Consulta literatura clínica y debate diagnósticos con IA basada en evidencia.", cta: "Ir al Asistente", to: "/assistant" },
  { emoji: "👤", title: "Pacientes", description: "Gestiona fichas clínicas, construye perfiles y registra sesiones.", cta: "Ver pacientes", to: "/patients" },
  { emoji: "🧒", title: "Infanto-Juvenil", description: "Fichas especializadas con tests, informes y seguimiento.", cta: "Ver pacientes", to: "/children" },
  { emoji: "📚", title: "Base de conocimiento", description: "Documentos, abstracts y guías clínicas indexadas para tu IA.", cta: "Ver biblioteca", to: "/documents" },
  { emoji: "📅", title: "Calendario", description: "Agenda y sincroniza sesiones con Google Calendar.", cta: "Ver calendario", to: "/calendar" },
  { emoji: "💬", title: "Sugerencias", description: "Comparte ideas o reporta errores para mejorar Psicoasist.", cta: "Enviar feedback", feedback: true },
];

function FeatureCard({ f }: { f: Feature }) {
  const button = (
    <Button variant="outline" size="sm"
      className="w-full h-8 text-xs border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary">
      {f.cta}
    </Button>
  );
  return (
    <Card className="rounded-xl p-4 flex flex-col h-full bg-card border-border hover:border-primary/50 hover:shadow-md transition-all">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="h-9 w-9 rounded-full bg-primary-soft flex items-center justify-center text-base">
          <span aria-hidden>{f.emoji}</span>
        </div>
        <h3 className="font-semibold text-sm">{f.title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-snug mb-3 flex-1 line-clamp-2">{f.description}</p>
      {f.feedback ? <FeedbackButton trigger={button} /> : <Link to={f.to!} className="block">{button}</Link>}
    </Card>
  );
}

type SchedPatient = { id: string; first_name: string; last_name: string; diagnosis: string | null; kind: "adult" | "child" };

function PatientSelectorDialog({
  open, onOpenChange, onPick, includeChildren = false, title = "Selecciona un paciente",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (p: SchedPatient) => void;
  includeChildren?: boolean;
  title?: string;
}) {
  const [patients, setPatients] = useState<SchedPatient[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    (async () => {
      const adultsRes = await supabase.from("patients").select("id, first_name, last_name, diagnosis").order("first_name");
      const adults: SchedPatient[] = (adultsRes.data ?? []).map((p: any) => ({ ...p, kind: "adult" as const }));
      let kids: SchedPatient[] = [];
      if (includeChildren) {
        const kidsRes = await supabase.from("child_patients").select("id, first_name, last_name, medical_diagnosis").order("first_name");
        kids = (kidsRes.data ?? []).map((p: any) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name, diagnosis: p.medical_diagnosis ?? null, kind: "child" as const }));
      }
      setPatients([...adults, ...kids]);
    })();
  }, [open, includeChildren]);

  const filtered = useMemo(() => patients.filter((p) =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(q.toLowerCase()),
  ), [patients, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Input placeholder="Buscar por nombre..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="max-h-[400px] overflow-y-auto divide-y">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin resultados</p>
          ) : filtered.map((p) => (
            <button key={`${p.kind}-${p.id}`}
              onClick={() => { onPick(p); onOpenChange(false); }}
              className="w-full text-left py-2.5 px-2 hover:bg-muted rounded-md flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
                {p.first_name[0]}{p.last_name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {p.first_name} {p.last_name}
                  {p.kind === "child" && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Niñ@</span>}
                </div>
                {p.diagnosis && <div className="text-xs text-muted-foreground truncate">{p.diagnosis}</div>}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddNoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<SchedPatient | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked(null);
      setNote("");
      setPickerOpen(true);
    }
  }, [open]);

  async function save() {
    if (!picked || !note.trim()) {
      toast.error("Selecciona un paciente y escribe la nota");
      return;
    }
    setSaving(true);
    try {
      const table = picked.kind === "child" ? "child_patients" : "patients";
      const { data: existing, error: e1 } = await supabase
        .from(table).select("notes").eq("id", picked.id).single();
      if (e1) throw e1;
      const stamp = new Date().toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const sep = `\n\n--- Nota agregada el ${stamp} ---\n`;
      const newNotes = `${(existing?.notes ?? "").trim()}${sep}${note.trim()}`;
      const { error: e2 } = await supabase.from(table).update({ notes: newNotes }).eq("id", picked.id);
      if (e2) throw e2;
      toast.success(`✓ Nota agregada a ${picked.first_name} ${picked.last_name}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar la nota");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PatientSelectorDialog
        open={pickerOpen}
        onOpenChange={(o) => { setPickerOpen(o); if (!o && !picked) onOpenChange(false); }}
        onPick={(p) => setPicked(p)}
        includeChildren
        title="¿A qué paciente?"
      />
      <Dialog open={open && !!picked} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nota para {picked?.first_name} {picked?.last_name}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escribe tu nota clínica..."
            className="min-h-[180px]"
            autoFocus
          />
          <div className="flex justify-end">
            <ImprovePromptButton value={note} onChange={setNote} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !note.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar nota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionCard({ icon, label, onClick, to }: { icon: React.ReactNode; label: string; onClick?: () => void; to?: string }) {
  const cls = "h-[80px] rounded-xl bg-teal-600 hover:bg-teal-700 text-white px-4 flex items-center gap-3 transition-colors text-left shadow-sm";
  const content = (
    <>
      <div className="h-10 w-10 rounded-full bg-white/15 flex items-center justify-center text-lg">{icon}</div>
      <span className="font-semibold text-sm">{label}</span>
    </>
  );
  if (to) return <Link to={to} className={cls}>{content}</Link>;
  return <button onClick={onClick} className={cls}>{content}</button>;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const name = profile?.first_name ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const startSession = (p: SchedPatient) => {
    if (p.kind === "child") navigate(`/children/${p.id}?session=1`);
    else navigate(`/patients/${p.id}?session=1`);
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
        {/* Acciones rápidas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ActionCard icon={<Play className="h-5 w-5" />} label="Iniciar nueva sesión" onClick={() => setPickerOpen(true)} />
          <ActionCard icon={<FileEdit className="h-5 w-5" />} label="Agregar nota a paciente" onClick={() => setNoteOpen(true)} />
          <ActionCard icon={<Coffee className="h-5 w-5" />} label="Café de la mañana" to="/cafe" />
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURES.map((f) => <FeatureCard key={f.title} f={f} />)}
        </div>
      </div>

      <PatientSelectorDialog open={pickerOpen} onOpenChange={setPickerOpen} onPick={startSession} title="Selecciona un paciente" />
      <AddNoteDialog open={noteOpen} onOpenChange={setNoteOpen} />
    </div>
  );
}
