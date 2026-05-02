import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Shuffle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const DAY_OPTIONS = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miercoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

const FREQ_OPTIONS = [
  { value: "semanal", label: "Semanal" },
  { value: "quincenal", label: "Quincenal" },
  { value: "mensual", label: "Mensual" },
  { value: "a_demanda", label: "A demanda" },
];

const REASON_CHIPS = [
  { value: "Paciente enfermo", icon: "🤒" },
  { value: "Viaje del paciente", icon: "✈️" },
  { value: "Emergencia", icon: "🏥" },
  { value: "Conflicto de agenda", icon: "📅" },
  { value: "Cambio permanente de horario", icon: "🔄" },
];

export interface PatientSchedule {
  session_day: string | null;
  session_time: string | null;
  session_frequency: string | null;
  session_duration: number | null;
}

interface Props {
  patientId: string;
  patientName: string;
  schedule: PatientSchedule;
  onUpdated: () => void;
}

function dayLabel(d: string | null) {
  return DAY_OPTIONS.find((o) => o.value === d)?.label ?? null;
}
function freqLabel(f: string | null) {
  return FREQ_OPTIONS.find((o) => o.value === f)?.label ?? null;
}
function timeLabel(t: string | null) {
  if (!t) return null;
  return String(t).slice(0, 5);
}

type Suggestion = {
  date: string;
  time: string;
  iso_date?: string;
  day_key?: string;
  reason?: string;
  is_permanent?: boolean;
};

export default function SessionSchedulePill({
  patientId,
  patientName,
  schedule,
  onUpdated,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);

  // Edit form
  const [form, setForm] = useState({
    session_day: schedule.session_day ?? "",
    session_time: timeLabel(schedule.session_time) ?? "",
    session_frequency: schedule.session_frequency ?? "semanal",
    session_duration: String(schedule.session_duration ?? 50),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      session_day: schedule.session_day ?? "",
      session_time: timeLabel(schedule.session_time) ?? "",
      session_frequency: schedule.session_frequency ?? "semanal",
      session_duration: String(schedule.session_duration ?? 50),
    });
  }, [schedule.session_day, schedule.session_time, schedule.session_frequency, schedule.session_duration]);

  async function saveSchedule() {
    setSaving(true);
    const { error } = await supabase
      .from("patients")
      .update({
        session_day: form.session_day || null,
        session_time: form.session_time || null,
        session_frequency: form.session_frequency || null,
        session_duration: form.session_duration ? Number(form.session_duration) : null,
      })
      .eq("id", patientId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Horario actualizado");
    setEditOpen(false);
    onUpdated();
  }

  // Pill
  const dl = dayLabel(schedule.session_day);
  const tl = timeLabel(schedule.session_time);
  const fl = freqLabel(schedule.session_frequency);
  const hasSchedule = !!(dl && tl);
  const pillText = hasSchedule
    ? `📅 ${dl} ${tl}${fl ? ` · ${fl}` : ""}`
    : "📅 Sin horario asignado";

  return (
    <>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            hasSchedule
              ? "bg-primary-soft text-primary border-primary/30 hover:bg-primary/15"
              : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
          }`}
        >
          {pillText}
        </button>
        <button
          type="button"
          onClick={() => setReschedOpen(true)}
          className="text-xs px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted inline-flex items-center gap-1"
          title="Reagendar sesión"
        >
          <Shuffle className="h-3 w-3" />
          Reagendar
        </button>
      </div>

      <ScheduleEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        form={form}
        setForm={setForm}
        onSave={saveSchedule}
        saving={saving}
      />

      <RescheduleDialog
        open={reschedOpen}
        onOpenChange={setReschedOpen}
        patientId={patientId}
        patientName={patientName}
        schedule={schedule}
        onDone={() => {
          setReschedOpen(false);
          onUpdated();
        }}
      />
    </>
  );
}

/* ------------ Edit modal ------------ */
function ScheduleEditDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  form: any;
  setForm: (f: any) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const u = (k: string, v: string) => setForm({ ...form, [k]: v });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Horario de sesión</DialogTitle>
          <DialogDescription>
            Define el día y la hora habituales de las sesiones del paciente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Día de la semana</Label>
            <Select value={form.session_day} onValueChange={(v) => u("session_day", v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Hora</Label>
              <Input
                type="time"
                value={form.session_time}
                onChange={(e) => u("session_time", e.target.value)}
              />
            </div>
            <div>
              <Label>Duración</Label>
              <Select value={form.session_duration} onValueChange={(v) => u("session_duration", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="50">50 min</SelectItem>
                  <SelectItem value="60">60 min</SelectItem>
                  <SelectItem value="90">90 min</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Frecuencia</Label>
            <Select value={form.session_frequency} onValueChange={(v) => u("session_frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQ_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------ Reschedule modal ------------ */
function RescheduleDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  schedule,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: string;
  patientName: string;
  schedule: PatientSchedule;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [otherReason, setOtherReason] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [aiNote, setAiNote] = useState<string>("");
  const [chosen, setChosen] = useState<Suggestion | null>(null);
  const [notify, setNotify] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedReason("");
      setOtherReason("");
      setSuggestions([]);
      setAiNote("");
      setChosen(null);
      setNotify(false);
    }
  }, [open]);

  const reasonText = selectedReason === "Otro" ? otherReason.trim() : selectedReason;

  async function fetchSuggestions() {
    if (!reasonText) {
      toast.error("Selecciona o describe un motivo");
      return;
    }
    setLoadingAi(true);
    setSuggestions([]);
    setAiNote("");
    try {
      const { data, error } = await supabase.functions.invoke("reschedule-suggestions", {
        body: { patient_id: patientId, reason: reasonText },
      });
      if (error) throw error;
      const list: Suggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      if (list.length === 0) throw new Error("La IA no devolvió sugerencias");
      setSuggestions(list);
      setAiNote(data?.note ?? "");
      setStep(2);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No se pudieron obtener sugerencias");
    } finally {
      setLoadingAi(false);
    }
  }

  async function confirm() {
    if (!chosen) return;
    setConfirming(true);
    try {
      // Permanent change → update patient row
      if (chosen.is_permanent) {
        const updates: any = {};
        if (chosen.day_key) updates.session_day = chosen.day_key;
        if (chosen.time) updates.session_time = chosen.time;
        if (Object.keys(updates).length > 0) {
          const { error } = await supabase.from("patients").update(updates).eq("id", patientId);
          if (error) throw error;
        }
      } else {
        // One-time → create a session entry
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("No autenticado");
        const isoDate = chosen.iso_date ?? null;
        if (!isoDate) {
          // Best-effort: skip if AI didn't return iso_date
          toast.warning("Sin fecha ISO; no se creó la sesión, pero puedes crearla manualmente.");
        } else {
          const { error } = await supabase.from("sessions").insert({
            psychologist_id: user.id,
            patient_id: patientId,
            session_date: isoDate,
            session_time: chosen.time,
            duration_minutes: schedule.session_duration ?? 50,
            status: "programada",
            pre_session_notes: `Reagendada — motivo: ${reasonText}`,
          });
          if (error) throw error;
        }
      }
      toast.success("Sesión reagendada");
      onDone();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Error al confirmar");
    } finally {
      setConfirming(false);
    }
  }

  const originalLabel = (() => {
    const dl = dayLabel(schedule.session_day);
    const tl = timeLabel(schedule.session_time);
    return dl && tl ? `${dl} ${tl}` : "horario actual";
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reagendar sesión de {patientName}</DialogTitle>
          <DialogDescription>
            {step === 1 && "¿Por qué necesitas reagendar?"}
            {step === 2 && "Sugerencias generadas por IA"}
            {step === 3 && "Confirma el cambio"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {REASON_CHIPS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setSelectedReason(c.value)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    selectedReason === c.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {c.icon} {c.value}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedReason("Otro")}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  selectedReason === "Otro"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                ✏️ Otro
              </button>
            </div>
            {selectedReason === "Otro" && (
              <Input
                placeholder="Describe el motivo"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
              />
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={fetchSuggestions} disabled={loadingAi || !reasonText}>
                {loadingAi ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Buscando opciones...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Generar sugerencias</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            {aiNote && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{aiNote}</p>
            )}
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const isChosen = chosen === s;
                return (
                  <Card
                    key={i}
                    className={`p-3 cursor-pointer transition-colors ${
                      isChosen ? "border-primary bg-primary-soft/30" : "hover:border-primary/40"
                    }`}
                    onClick={() => setChosen(s)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
                          <div className="font-semibold text-base">
                            {s.date} · {s.time}
                          </div>
                          {s.is_permanent && (
                            <Badge variant="secondary" className="text-[10px]">Permanente</Badge>
                          )}
                        </div>
                        {s.reason && (
                          <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={isChosen ? "default" : "outline"}
                        onClick={(e) => { e.stopPropagation(); setChosen(s); setStep(3); }}
                      >
                        Seleccionar
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep(1)}>Atrás</Button>
              <Button onClick={() => chosen && setStep(3)} disabled={!chosen}>Continuar</Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && chosen && (
          <div className="space-y-3">
            <Card className="p-3 bg-muted/40">
              <div className="text-sm">
                Sesión de <strong>{patientName}</strong> movida de{" "}
                <strong>{originalLabel}</strong> a{" "}
                <strong>{chosen.date} · {chosen.time}</strong>
                {chosen.is_permanent && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">Permanente</Badge>
                )}
              </div>
              {chosen.is_permanent && (
                <p className="text-xs text-muted-foreground mt-2">
                  Se actualizará el horario habitual del paciente.
                </p>
              )}
              {!chosen.is_permanent && (
                <p className="text-xs text-muted-foreground mt-2">
                  Se creará una sesión puntual en la fecha indicada.
                </p>
              )}
            </Card>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="text-sm">
                <div className="font-medium">Notificar al paciente</div>
                <div className="text-xs text-muted-foreground">
                  Próximamente: enviar aviso por correo o WhatsApp.
                </div>
              </div>
              <Switch checked={notify} onCheckedChange={setNotify} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep(2)}>Atrás</Button>
              <Button onClick={confirm} disabled={confirming}>
                {confirming ? "Confirmando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
