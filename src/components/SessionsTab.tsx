import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Sparkles, RefreshCw, Calendar, Clock, ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

export type PatientKind = "adult" | "child";

export const EMOTIONAL_STATES = [
  { value: "muy_bajo", emoji: "😔", label: "Muy bajo" },
  { value: "bajo", emoji: "😟", label: "Bajo" },
  { value: "moderado", emoji: "😐", label: "Moderado" },
  { value: "bueno", emoji: "🙂", label: "Bueno" },
  { value: "muy_bueno", emoji: "😊", label: "Muy bueno" },
] as const;

export const STATUS_LABELS: Record<string, string> = {
  programada: "Programada",
  realizada: "Realizada",
  cancelada: "Cancelada",
  no_asistió: "No asistió",
};
export const STATUS_COLORS: Record<string, string> = {
  programada: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  realizada: "bg-green-500/15 text-green-700 dark:text-green-300",
  cancelada: "bg-muted text-muted-foreground",
  no_asistió: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function emotionMeta(value: string | null) {
  return EMOTIONAL_STATES.find((s) => s.value === value);
}

export function firstLine(text: string | null | undefined) {
  if (!text) return "";
  return text.split("\n")[0].slice(0, 120);
}

export interface Session {
  id: string;
  session_number: number;
  session_date: string;
  duration_minutes: number | null;
  status: string;
  pre_session_notes: string | null;
  pre_session_suggestions: string | null;
  emotional_state: string | null;
  what_happened: string | null;
  interventions_used: string | null;
  assigned_task: string | null;
  next_session_plan: string | null;
  post_session_notes: string | null;
  profile_update_suggestions: any;
  patient_id: string | null;
  child_patient_id: string | null;
}

export async function fetchLastSession(kind: PatientKind, id: string): Promise<Session | null> {
  const col = kind === "child" ? "child_patient_id" : "patient_id";
  const { data } = await supabase
    .from("sessions")
    .select("*")
    .eq(col, id)
    .eq("status", "realizada")
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Session) ?? null;
}

export function SessionsTab({ kind, patientId, onProfileUpdated }: {
  kind: PatientKind;
  patientId: string;
  onProfileUpdated?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    const col = kind === "child" ? "child_patient_id" : "patient_id";
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq(col, patientId)
      .order("session_date", { ascending: false });
    if (error) toast.error(error.message);
    setSessions((data as Session[]) ?? []);
    setLoading(false);
  }, [kind, patientId]);

  useEffect(() => { load(); }, [load]);

  if (activeId) {
    return (
      <SessionDetail
        sessionId={activeId}
        kind={kind}
        onBack={() => { setActiveId(null); load(); }}
        onProfileUpdated={onProfileUpdated}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">Sesiones ({sessions.length})</h2>
        <Button onClick={() => setNewOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Nueva sesión</Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}</div>
      ) : sessions.length === 0 ? (
        <Card className="p-10 text-center">
          <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Sin sesiones registradas.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const em = emotionMeta(s.emotional_state);
            return (
              <Card key={s.id} className="p-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
                onClick={() => setActiveId(s.id)}>
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center font-semibold flex-shrink-0">
                    #{s.session_number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{new Date(s.session_date).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                      <Badge className={`${STATUS_COLORS[s.status] ?? ""} border-0`}>{STATUS_LABELS[s.status]}</Badge>
                      {em && <span title={em.label} className="text-lg leading-none">{em.emoji}</span>}
                    </div>
                    {s.what_happened && <p className="text-sm text-muted-foreground mt-1 truncate">{firstLine(s.what_happened)}</p>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <SessionModal
        open={newOpen}
        onOpenChange={setNewOpen}
        kind={kind}
        patientId={patientId}
        onSaved={(sid) => { setNewOpen(false); load(); setActiveId(sid); }}
      />
    </div>
  );
}

// =================== SessionModal (create new pre-session) ===================
function SessionModal({
  open, onOpenChange, kind, patientId, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: PatientKind;
  patientId: string;
  onSaved: (id: string) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState(50);
  const [preNotes, setPreNotes] = useState("");
  const [suggestions, setSuggestions] = useState<string>("");
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = useCallback(async () => {
    setLoadingSuggest(true);
    try {
      const body = kind === "child" ? { child_patient_id: patientId } : { patient_id: patientId };
      const { data, error } = await supabase.functions.invoke("session-pre-suggestions", { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSuggestions((data as any)?.suggestions ?? "");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al generar sugerencias");
    } finally {
      setLoadingSuggest(false);
    }
  }, [kind, patientId]);

  useEffect(() => {
    if (open) {
      setSuggestions("");
      setPreNotes("");
      setDate(new Date().toISOString().slice(0, 10));
      setDuration(50);
      generate();
    }
  }, [open, generate]);

  async function save() {
    if (!date) return toast.error("Fecha obligatoria");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      psychologist_id: user!.id,
      session_date: date,
      duration_minutes: duration,
      status: "programada",
      pre_session_notes: preNotes || null,
      pre_session_suggestions: suggestions || null,
    };
    if (kind === "child") payload.child_patient_id = patientId;
    else payload.patient_id = patientId;

    const { data, error } = await supabase.from("sessions").insert(payload).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Sesión #${data.session_number} programada`);
    onSaved(data.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Preparación de sesión</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 50)} />
            </div>
          </div>

          <Card className="p-4 bg-primary-soft/40 border-primary/30">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />Sugerencias de Claude para esta sesión
              </h3>
              <Button variant="ghost" size="sm" onClick={generate} disabled={loadingSuggest} className="gap-1">
                <RefreshCw className={cn("h-3.5 w-3.5", loadingSuggest && "animate-spin")} />
                Regenerar
              </Button>
            </div>
            {loadingSuggest ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />Generando sugerencias...
              </div>
            ) : suggestions ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown>{suggestions}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin sugerencias disponibles.</p>
            )}
          </Card>

          <div>
            <Label>Notas previas a la sesión</Label>
            <Textarea rows={4} value={preNotes} onChange={(e) => setPreNotes(e.target.value)}
              placeholder="Tus notas de preparación..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Programar sesión"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== SessionDetail (view + post-session form) ===================
function SessionDetail({
  sessionId, kind, onBack, onProfileUpdated,
}: {
  sessionId: string;
  kind: PatientKind;
  onBack: () => void;
  onProfileUpdated?: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [postOpen, setPostOpen] = useState(false);
  const [analysisSuggestions, setAnalysisSuggestions] = useState<any[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    setSession(data as Session);
    setLoading(false);
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);

  if (loading || !session) return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;

  const em = emotionMeta(session.emotional_state);

  async function changeStatus(s: string) {
    if (!session) return;
    await supabase.from("sessions").update({ status: s }).eq("id", session.id);
    load();
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("session-analyze", { body: { session_id: sessionId } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const sg = (data as any)?.suggestions ?? [];
      setAnalysisSuggestions(sg);
      if (sg.length === 0) toast.info("Claude no sugiere cambios al perfil.");
    } catch (e: any) {
      toast.error(e?.message ?? "Error al analizar la sesión");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" />Volver a sesiones
      </button>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Sesión #{session.session_number}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{new Date(session.session_date).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
              {session.duration_minutes && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{session.duration_minutes} min</span>}
            </div>
          </div>
          <Badge className={`${STATUS_COLORS[session.status] ?? ""} border-0`}>{STATUS_LABELS[session.status]}</Badge>
        </div>

        {session.status === "programada" && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Button onClick={() => setPostOpen(true)} className="gap-2"><Sparkles className="h-4 w-4" />Registrar sesión realizada</Button>
            <Button variant="outline" onClick={() => changeStatus("cancelada")}>Cancelar sesión</Button>
            <Button variant="outline" onClick={() => changeStatus("no_asistió")}>No asistió</Button>
          </div>
        )}

        {session.pre_session_suggestions && (
          <Card className="p-4 bg-primary-soft/40 border-primary/30 mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />Sugerencias para la sesión
            </h3>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
              <ReactMarkdown>{session.pre_session_suggestions}</ReactMarkdown>
            </div>
          </Card>
        )}

        {session.pre_session_notes && (
          <SectionBlock title="Notas previas" content={session.pre_session_notes} />
        )}

        {session.status === "realizada" && (
          <div className="space-y-3 pt-2">
            {em && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Estado emocional</div>
                <div className="text-base flex items-center gap-2"><span className="text-2xl">{em.emoji}</span>{em.label}</div>
              </div>
            )}
            <SectionBlock title="¿Qué ocurrió?" content={session.what_happened} />
            <SectionBlock title="Intervenciones realizadas" content={session.interventions_used} />
            <SectionBlock title="Tarea asignada" content={session.assigned_task} />
            <SectionBlock title="Plan próxima sesión" content={session.next_session_plan} />
            <SectionBlock title="Notas adicionales" content={session.post_session_notes} />

            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={runAnalysis} disabled={analyzing} className="gap-2">
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Re-analizar y sugerir actualizaciones
              </Button>
            </div>
          </div>
        )}
      </Card>

      <PostSessionModal
        open={postOpen}
        onOpenChange={setPostOpen}
        session={session}
        onSaved={async () => {
          setPostOpen(false);
          await load();
          // Auto-trigger analysis
          setAnalyzing(true);
          try {
            const { data, error } = await supabase.functions.invoke("session-analyze", { body: { session_id: sessionId } });
            if (error) throw error;
            if ((data as any)?.error) throw new Error((data as any).error);
            setAnalysisSuggestions((data as any)?.suggestions ?? []);
          } catch (e: any) {
            toast.error(e?.message ?? "Error al analizar la sesión");
          } finally {
            setAnalyzing(false);
          }
        }}
      />

      <SuggestionsModal
        open={analysisSuggestions !== null}
        onOpenChange={(o) => !o && setAnalysisSuggestions(null)}
        suggestions={analysisSuggestions ?? []}
        kind={kind}
        patientId={session.patient_id ?? session.child_patient_id ?? ""}
        onApplied={() => { onProfileUpdated?.(); }}
      />
    </div>
  );
}

function SectionBlock({ title, content }: { title: string; content: string | null | undefined }) {
  if (!content) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">{title}</div>
      <p className="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  );
}

// =================== Post-Session Modal ===================
function PostSessionModal({
  open, onOpenChange, session, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session & { patient_id?: string | null; child_patient_id?: string | null };
  onSaved: () => void;
}) {
  const [emotionalState, setEmotionalState] = useState<string>(session.emotional_state ?? "");
  const [whatHappened, setWhatHappened] = useState(session.what_happened ?? "");
  const [interventions, setInterventions] = useState(session.interventions_used ?? "");
  const [assignedTask, setAssignedTask] = useState(session.assigned_task ?? "");
  const [nextPlan, setNextPlan] = useState(session.next_session_plan ?? "");
  const [postNotes, setPostNotes] = useState(session.post_session_notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEmotionalState(session.emotional_state ?? "");
      setWhatHappened(session.what_happened ?? "");
      setInterventions(session.interventions_used ?? "");
      setAssignedTask(session.assigned_task ?? "");
      setNextPlan(session.next_session_plan ?? "");
      setPostNotes(session.post_session_notes ?? "");
    }
  }, [open, session]);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("sessions").update({
      status: "realizada",
      emotional_state: emotionalState || null,
      what_happened: whatHappened || null,
      interventions_used: interventions || null,
      assigned_task: assignedTask || null,
      next_session_plan: nextPlan || null,
      post_session_notes: postNotes || null,
    }).eq("id", session.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Sesión registrada");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar sesión realizada</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Estado emocional del paciente</Label>
            <div className="grid grid-cols-5 gap-2 mt-2">
              {EMOTIONAL_STATES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setEmotionalState(s.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors",
                    emotionalState === s.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-accent"
                  )}
                >
                  <span className="text-2xl">{s.emoji}</span>
                  <span className="text-[10px] font-medium leading-tight text-center">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div><Label>¿Qué ocurrió en la sesión?</Label><Textarea rows={5} value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} /></div>
          <div>
            <Label>Intervenciones realizadas</Label>
            <Textarea rows={3} value={interventions} onChange={(e) => setInterventions(e.target.value)}
              placeholder="Ej: Reestructuración cognitiva, técnica de respiración, juego de roles..." />
          </div>
          <div><Label>Tarea asignada</Label><Textarea rows={2} value={assignedTask} onChange={(e) => setAssignedTask(e.target.value)} /></div>
          <div><Label>Plan para próxima sesión</Label><Textarea rows={2} value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} /></div>
          <div><Label>Notas adicionales</Label><Textarea rows={2} value={postNotes} onChange={(e) => setPostNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar sesión"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Suggestions Modal (post-analysis) ===================
function SuggestionsModal({
  open, onOpenChange, suggestions, kind, patientId, onApplied,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  suggestions: any[];
  kind: PatientKind;
  patientId: string;
  onApplied: () => void;
}) {
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [ignored, setIgnored] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) { setApplied(new Set()); setIgnored(new Set()); }
  }, [open]);

  const table = kind === "child" ? "child_patients" : "patients";

  async function apply(idx: number, s: any) {
    let newValue: string;
    if (s.suggested_addition) {
      // Append to current
      const { data: row } = await supabase.from(table).select(s.field).eq("id", patientId).maybeSingle();
      const current = (row as any)?.[s.field] ?? "";
      newValue = current ? `${current}\n\n${s.suggested_addition}` : s.suggested_addition;
    } else {
      newValue = s.suggested_value;
    }
    const { error } = await (supabase.from(table) as any).update({ [s.field]: newValue }).eq("id", patientId);
    if (error) return toast.error(error.message);
    toast.success(`Campo "${s.field}" actualizado`);
    setApplied((p) => new Set(p).add(idx));
    onApplied();
  }

  function ignore(idx: number) {
    setIgnored((p) => new Set(p).add(idx));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />Sugerencias de actualización del perfil
          </DialogTitle>
        </DialogHeader>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Claude no sugiere cambios al perfil basados en estas notas.</p>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              const isApplied = applied.has(i);
              const isIgnored = ignored.has(i);
              const dimmed = isApplied || isIgnored;
              return (
                <Card key={i} className={cn("p-4", dimmed && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{s.field}</Badge>
                      {isApplied && <Badge className="bg-green-500/15 text-green-700 dark:text-green-300 border-0">Aplicado</Badge>}
                      {isIgnored && <Badge variant="secondary">Ignorado</Badge>}
                    </div>
                  </div>
                  {s.current_value && (
                    <div className="mb-2">
                      <div className="text-[10px] uppercase font-semibold text-muted-foreground">Actual</div>
                      <p className="text-sm">{s.current_value}</p>
                    </div>
                  )}
                  <div className="mb-2">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                      {s.suggested_addition ? "Texto a agregar" : "Sugerido"}
                    </div>
                    <p className="text-sm font-medium">{s.suggested_addition ?? s.suggested_value}</p>
                  </div>
                  <div className="mb-3">
                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">Razón</div>
                    <p className="text-sm text-muted-foreground italic">{s.reason}</p>
                  </div>
                  {!dimmed && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => apply(i, s)} className="gap-1"><Sparkles className="h-3 w-3" />Aplicar</Button>
                      <Button size="sm" variant="outline" onClick={() => ignore(i)}>Ignorar</Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================== Last Session Card (for profile tab) ===================
export function LastSessionCard({ kind, patientId, onClick }: {
  kind: PatientKind;
  patientId: string;
  onClick: () => void;
}) {
  const [last, setLast] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetchLastSession(kind, patientId).then((s) => {
      if (!cancel) { setLast(s); setLoading(false); }
    });
    return () => { cancel = true; };
  }, [kind, patientId]);

  if (loading) return <Card className="p-4 h-20 animate-pulse" />;
  if (!last) return null;
  const em = emotionMeta(last.emotional_state);

  return (
    <Card className="p-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center">
          <Calendar className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase font-semibold text-muted-foreground">Última sesión</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">#{last.session_number} · {new Date(last.session_date).toLocaleDateString("es-CL")}</span>
            {em && <span title={em.label} className="text-base leading-none">{em.emoji}</span>}
          </div>
          {last.what_happened && <p className="text-xs text-muted-foreground truncate mt-0.5">{firstLine(last.what_happened)}</p>}
        </div>
      </div>
    </Card>
  );
}
