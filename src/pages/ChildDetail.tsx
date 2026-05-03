import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowLeft, Pencil, Sparkles, Plus, Phone, Mail, Users, Calendar,
  ChevronDown, ChevronRight, FileText, Filter, MessageCircle, Send,
} from "lucide-react";
import TransferChildPatientDialog from "@/components/TransferChildPatientDialog";
import {
  calcAge, ageRangeColor, GOAL_STATUSES, GOAL_STATUS_LABELS,
  TASK_RESPONSIBLES, WISC_VERSIONS, CONTACT_TYPES, CONTACT_WITH, capitalize,
} from "@/lib/clinical";
import { ChildForm } from "./Children";
import { SessionsTab, LastSessionCard } from "@/components/SessionsTab";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import ExtendedNotesEditor from "@/components/ExtendedNotesEditor";
import MedicationsSection from "@/components/MedicationsSection";
import { ChildDocumentsTab, ChildSessionNotesTab, ChildTestsTab } from "@/components/ChildExtraTabs";
import TreatmentTeamTab from "@/components/TreatmentTeamTab";

const BEHAVIOR_COLORS = ["hsl(174 72% 46%)", "hsl(38 92% 50%)", "hsl(260 70% 60%)", "hsl(210 80% 55%)", "hsl(340 75% 55%)", "hsl(150 60% 45%)"];

export default function ChildDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [child, setChild] = useState<any>(null);
  const [guardians, setGuardians] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [editGuardians, setEditGuardians] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("profile");
  const [refreshKey, setRefreshKey] = useState(0);
  const [transferOpen, setTransferOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: c } = await supabase.from("child_patients").select("*").eq("id", id).maybeSingle();
    setChild(c);
    if (c) {
      setForm({
        first_name: c.first_name, last_name: c.last_name, birth_date: c.birth_date,
        sex: c.sex ?? "", school: c.school ?? "", grade: c.grade ?? "",
        homeroom_teacher: c.homeroom_teacher ?? "", modality: c.modality ?? "",
        referral_source: c.referral_source ?? "", referral_reason: c.referral_reason ?? "",
        medical_diagnosis: c.medical_diagnosis ?? "", current_medication: c.current_medication ?? "",
        specialist_name: c.specialist_name ?? "", notes: c.notes ?? "",
      });
    }
    const { data: g } = await supabase.from("guardians").select("*").eq("child_patient_id", id).order("created_at");
    setGuardians(g ?? []);
    setEditGuardians([{ full_name: "", relationship: "", phone: "", email: "", involvement_level: "" }]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function saveEdit() {
    setSaving(true);
    const payload: any = { ...form };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    const { error } = await supabase.from("child_patients").update(payload).eq("id", id!);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Paciente actualizado");
    setEditOpen(false);
    load();
  }

  if (loading) return <div className="p-10 text-center text-muted-foreground">Cargando...</div>;
  if (!child) return <div className="p-10 text-center">Paciente no encontrado</div>;

  const age = calcAge(child.birth_date);
  const range = ageRangeColor(age);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto">
      <button onClick={() => navigate("/children")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" />Volver a Infanto-Juvenil
      </button>

      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-full ${range.bg} ${range.text} flex items-center justify-center text-lg font-semibold`}>
              {child.first_name[0]}{child.last_name[0]}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{child.first_name} {child.last_name}</h1>
              <div className="flex flex-wrap gap-2 mt-1">
                <Badge variant="secondary" className={`${range.bg} ${range.text} border-0`}>{age} años · {range.label}</Badge>
                {child.modality && <Badge variant="secondary" className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-0">{child.modality}</Badge>}
                {child.grade && <Badge variant="outline">{child.grade}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />Transferir a otro terapeuta
            </Button>
            <Link to={`/assistant?patient=${child.id}&kind=child`}>
              <Button variant="outline" size="sm" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />Consultar IA</Button>
            </Link>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-5 md:grid-cols-11 w-full">
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="team">Equipo</TabsTrigger>
          <TabsTrigger value="sessions">Sesiones</TabsTrigger>
          <TabsTrigger value="notes">Apuntes</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="behavior">Conductual</TabsTrigger>
          <TabsTrigger value="evals">Evaluaciones</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="documents">Documentos</TabsTrigger>
          <TabsTrigger value="comms">Comunicaciones</TabsTrigger>
          <TabsTrigger value="ai">Asistente IA</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-4">
          <LastSessionCard
            key={refreshKey}
            kind="child"
            patientId={child.id}
            onClick={() => setTab("sessions")}
          />
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="font-semibold">Información del paciente</h2>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />Editar
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Field label="Sexo" value={child.sex ?? "—"} />
              <Field label="Fecha nacimiento" value={child.birth_date ? new Date(child.birth_date).toLocaleDateString("es-CL") : "—"} />
              <Field label="Colegio" value={child.school ?? "—"} />
              <Field label="Curso" value={child.grade ?? "—"} />
              <Field label="Profesor jefe" value={child.homeroom_teacher ?? "—"} />
              <Field label="Modalidad" value={child.modality ?? "—"} />
              <Field label="Origen derivación" value={child.referral_source ?? "—"} />
              <Field label="Diagnóstico médico" value={child.medical_diagnosis ?? "—"} />
              <Field label="Medicación" value={child.current_medication ?? "—"} />
              <Field label="Especialista" value={child.specialist_name ?? "—"} />
            </div>
            {child.referral_reason && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Motivo de derivación</div>
                <p className="text-sm whitespace-pre-wrap">{child.referral_reason}</p>
              </div>
            )}
            {child.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Notas</div>
                <p className="text-sm whitespace-pre-wrap">{child.notes}</p>
              </div>
            )}
          </Card>

          <ExtendedNotesEditor
            table="child_patients"
            rowId={child.id}
            initialValue={child.extended_notes ?? null}
            currentMainNotes={child.notes ?? null}
            onMainNotesUpdated={(newNotes) => {
              setChild((c: any) => c ? { ...c, notes: newNotes, extended_notes: null } : c);
            }}
          />

          <MedicationsSection kind="child" patientId={child.id} />

          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" />Apoderados</h2>
              <AddGuardianButton childId={id!} onAdded={load} />
            </div>
            {guardians.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin apoderados registrados.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {guardians.map((g) => (
                  <div key={g.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{g.full_name}</div>
                      {g.involvement_level && (
                        <Badge variant="secondary" className={cn(
                          "border-0 text-[10px]",
                          g.involvement_level === "alto" && "bg-green-500/15 text-green-700 dark:text-green-300",
                          g.involvement_level === "medio" && "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
                          g.involvement_level === "bajo" && "bg-red-500/15 text-red-700 dark:text-red-300",
                        )}>
                          Implicación {g.involvement_level}
                        </Badge>
                      )}
                    </div>
                    {g.relationship && <div className="text-xs text-muted-foreground capitalize">{g.relationship}</div>}
                    <div className="mt-2 space-y-1 text-sm">
                      {g.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{g.phone}</div>}
                      {g.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" />{g.email}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <TreatmentTeamTab patientId={child.id} kind="child" />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab kind="child" patientId={child.id} onProfileUpdated={() => { load(); setRefreshKey((k) => k + 1); }} />
        </TabsContent>

        <TabsContent value="roadmap" className="mt-4">
          <RoadmapTab childId={id!} />
        </TabsContent>

        <TabsContent value="behavior" className="mt-4">
          <BehaviorTab childId={id!} />
        </TabsContent>

        <TabsContent value="evals" className="mt-4 space-y-6">
          <WiscSection childId={id!} />
          <OtherEvalsSection childId={id!} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <ChildSessionNotesTab childId={id!} />
        </TabsContent>

        <TabsContent value="tests" className="mt-4">
          <ChildTestsTab childId={id!} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <ChildDocumentsTab childId={id!} />
        </TabsContent>

        <TabsContent value="comms" className="mt-4">
          <CommsTab childId={id!} />
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card className="p-6 text-center">
            <Sparkles className="h-10 w-10 text-primary mx-auto mb-3" />
            <h3 className="font-semibold mb-1">Asistente IA con contexto del paciente</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Las respuestas se adaptarán a intervenciones infanto-juveniles considerando edad, contexto escolar y familiar.
            </p>
            <Link to={`/assistant?patient=${child.id}&kind=child`}>
              <Button className="gap-2"><Sparkles className="h-4 w-4" />Abrir asistente</Button>
            </Link>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar paciente</DialogTitle></DialogHeader>
          <ChildForm form={form} setForm={setForm} guardians={editGuardians} setGuardians={setEditGuardians} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransferChildPatientDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        patient={{
          id: child.id,
          first_name: child.first_name,
          last_name: child.last_name,
          birth_date: child.birth_date,
          diagnosis: child.medical_diagnosis ?? null,
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function AddGuardianButton({ childId, onAdded }: { childId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [g, setG] = useState({ full_name: "", relationship: "", phone: "", email: "", involvement_level: "" });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!g.full_name) return toast.error("Nombre obligatorio");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("guardians").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      full_name: g.full_name, relationship: g.relationship || null,
      phone: g.phone || null, email: g.email || null,
      involvement_level: g.involvement_level || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Apoderado agregado");
    setOpen(false);
    setG({ full_name: "", relationship: "", phone: "", email: "", involvement_level: "" });
    onAdded();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1"><Plus className="h-3.5 w-3.5" />Agregar</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuevo apoderado</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nombre completo</Label><Input value={g.full_name} onChange={(e) => setG({ ...g, full_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Relación</Label>
              <Select value={g.relationship} onValueChange={(v) => setG({ ...g, relationship: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{["madre", "padre", "abuela/o", "tía/o", "otro"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Implicación</Label>
              <Select value={g.involvement_level} onValueChange={(v) => setG({ ...g, involvement_level: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{["alto", "medio", "bajo"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Teléfono</Label><Input value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====== Roadmap Tab ======
function RoadmapTab({ childId }: { childId: string }) {
  const [goals, setGoals] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: "", description: "", estimated_date: "" });
  const [taskGoalId, setTaskGoalId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", assigned_date: "", responsible: "", session_date: "" });

  const load = useCallback(async () => {
    const [{ data: g }, { data: t }] = await Promise.all([
      supabase.from("intervention_goals").select("*").eq("child_patient_id", childId).order("created_at"),
      supabase.from("goal_tasks").select("*").eq("child_patient_id", childId).order("created_at"),
    ]);
    setGoals(g ?? []);
    setTasks(t ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  async function saveGoal() {
    if (!goalForm.title) return toast.error("Título obligatorio");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("intervention_goals").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      title: goalForm.title, description: goalForm.description || null,
      estimated_date: goalForm.estimated_date || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Objetivo creado");
    setGoalOpen(false);
    setGoalForm({ title: "", description: "", estimated_date: "" });
    load();
  }

  async function saveTask() {
    if (!taskForm.title || !taskGoalId) return toast.error("Título obligatorio");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("goal_tasks").insert({
      goal_id: taskGoalId, child_patient_id: childId, psychologist_id: user!.id,
      title: taskForm.title, description: taskForm.description || null,
      assigned_date: taskForm.assigned_date || null,
      responsible: taskForm.responsible || null,
      session_date: taskForm.session_date || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Tarea creada");
    setTaskGoalId(null);
    setTaskForm({ title: "", description: "", assigned_date: "", responsible: "", session_date: "" });
    load();
  }

  async function toggleTask(t: any) {
    const newStatus = t.status === "realizada" ? "pendiente" : "realizada";
    await supabase.from("goal_tasks").update({ status: newStatus }).eq("id", t.id);
    load();
    // If all tasks done, suggest marking goal as logrado
    const goalTasks = tasks.filter((x) => x.goal_id === t.goal_id).map((x) => x.id === t.id ? { ...x, status: newStatus } : x);
    if (goalTasks.length > 0 && goalTasks.every((x) => x.status === "realizada")) {
      const g = goals.find((g) => g.id === t.goal_id);
      if (g && g.status !== "logrado") {
        toast("Todas las tareas completadas", {
          description: `¿Marcar "${g.title}" como logrado?`,
          action: {
            label: "Marcar logrado",
            onClick: async () => {
              await supabase.from("intervention_goals").update({ status: "logrado", achieved_date: new Date().toISOString().slice(0, 10) }).eq("id", g.id);
              load();
            },
          },
        });
      }
    }
  }

  async function setGoalStatus(goalId: string, status: string) {
    const update: any = { status };
    if (status === "logrado") update.achieved_date = new Date().toISOString().slice(0, 10);
    await supabase.from("intervention_goals").update(update).eq("id", goalId);
    load();
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Nuevo objetivo</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nuevo objetivo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Título *</Label><Input value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} /></div>
              <div><Label>Descripción</Label><Textarea rows={3} value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} /></div>
              <div><Label>Fecha estimada</Label><Input type="date" value={goalForm.estimated_date} onChange={(e) => setGoalForm({ ...goalForm, estimated_date: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setGoalOpen(false)}>Cancelar</Button>
              <Button onClick={saveGoal}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Sin objetivos definidos. Crea el primero para construir el roadmap de intervención.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const goalTasks = tasks.filter((t) => t.goal_id === g.id);
            const done = goalTasks.filter((t) => t.status === "realizada").length;
            const pct = goalTasks.length === 0 ? 0 : Math.round((done / goalTasks.length) * 100);
            const isOpen = expanded.has(g.id);
            const statusColor =
              g.status === "logrado" ? "bg-green-500/15 text-green-700 dark:text-green-300" :
              g.status === "en_progreso" ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" :
              "bg-muted text-muted-foreground";
            return (
              <Card key={g.id} className="overflow-hidden">
                <button
                  type="button"
                  className="w-full p-4 text-left hover:bg-accent/30 transition-colors"
                  onClick={() => setExpanded((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                >
                  <div className="flex items-start gap-3">
                    {isOpen ? <ChevronDown className="h-5 w-5 mt-0.5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 mt-0.5 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold">{g.title}</h3>
                        <Badge className={`${statusColor} border-0`}>{GOAL_STATUS_LABELS[g.status]}</Badge>
                        {g.estimated_date && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />{new Date(g.estimated_date).toLocaleDateString("es-CL")}
                          </span>
                        )}
                      </div>
                      {g.description && <p className="text-sm text-muted-foreground mt-1">{g.description}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <Progress value={pct} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground tabular-nums">{done}/{goalTasks.length}</span>
                      </div>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border p-4 bg-surface space-y-2">
                    {goalTasks.length === 0 && <p className="text-sm text-muted-foreground">Sin tareas aún.</p>}
                    {goalTasks.map((t) => (
                      <div key={t.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-card">
                        <Checkbox checked={t.status === "realizada"} onCheckedChange={() => toggleTask(t)} className="mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className={cn("text-sm font-medium", t.status === "realizada" && "line-through text-muted-foreground")}>{t.title}</div>
                          {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                            {t.responsible && <span>Resp: {t.responsible}</span>}
                            {t.session_date && <span>Sesión: {new Date(t.session_date).toLocaleDateString("es-CL")}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => setTaskGoalId(g.id)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nueva tarea</Button>
                      <Select value={g.status} onValueChange={(v) => setGoalStatus(g.id, v)}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{GOAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{GOAL_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!taskGoalId} onOpenChange={(o) => !o && setTaskGoalId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva tarea</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Título *</Label><Input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} /></div>
            <div><Label>Descripción</Label><Textarea rows={2} value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Fecha asignación</Label><Input type="date" value={taskForm.assigned_date} onChange={(e) => setTaskForm({ ...taskForm, assigned_date: e.target.value })} /></div>
              <div><Label>Sesión</Label><Input type="date" value={taskForm.session_date} onChange={(e) => setTaskForm({ ...taskForm, session_date: e.target.value })} /></div>
            </div>
            <div>
              <Label>Responsable</Label>
              <Select value={taskForm.responsible} onValueChange={(v) => setTaskForm({ ...taskForm, responsible: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{TASK_RESPONSIBLES.map((r) => <SelectItem key={r} value={r}>{capitalize(r)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTaskGoalId(null)}>Cancelar</Button>
            <Button onClick={saveTask}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====== Behavior Tab ======
function BehaviorTab({ childId }: { childId: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [newBehavior, setNewBehavior] = useState("");
  const [scoreOpen, setScoreOpen] = useState<string | null>(null);
  const [scoreForm, setScoreForm] = useState({ score: 3, tracking_date: new Date().toISOString().slice(0, 10), notes: "" });

  const load = useCallback(async () => {
    const { data } = await supabase.from("behavioral_tracking").select("*").eq("child_patient_id", childId).order("tracking_date");
    setEntries(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  const behaviors = useMemo(() => Array.from(new Set(entries.map((e) => e.behavior_name))), [entries]);

  const chartData = useMemo(() => {
    const dates = Array.from(new Set(entries.map((e) => e.tracking_date))).sort();
    return dates.map((d) => {
      const row: any = { date: new Date(d).toLocaleDateString("es-CL", { month: "short", day: "numeric" }) };
      for (const b of behaviors) {
        const entry = entries.find((e) => e.tracking_date === d && e.behavior_name === b);
        if (entry) row[b] = entry.score;
      }
      return row;
    });
  }, [entries, behaviors]);

  async function addBehavior() {
    if (!newBehavior.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("behavioral_tracking").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      behavior_name: newBehavior.trim(), score: 3,
      tracking_date: new Date().toISOString().slice(0, 10),
    });
    if (error) return toast.error(error.message);
    toast.success("Conducta agregada");
    setBehaviorOpen(false);
    setNewBehavior("");
    load();
  }

  async function saveScore() {
    if (!scoreOpen) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("behavioral_tracking").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      behavior_name: scoreOpen, score: scoreForm.score,
      tracking_date: scoreForm.tracking_date, notes: scoreForm.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Puntuación registrada");
    setScoreOpen(null);
    setScoreForm({ score: 3, tracking_date: new Date().toISOString().slice(0, 10), notes: "" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold">Seguimiento conductual</h2>
        <Dialog open={behaviorOpen} onOpenChange={setBehaviorOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Agregar conducta</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nueva conducta a seguir</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Label>Nombre de la conducta</Label>
              <Input value={newBehavior} onChange={(e) => setNewBehavior(e.target.value)} placeholder="ej. Atención sostenida" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBehaviorOpen(false)}>Cancelar</Button>
              <Button onClick={addBehavior}>Crear</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {behaviors.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Define las conductas a seguir en este paciente.</p>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              {behaviors.map((b) => (
                <Button key={b} size="sm" variant="outline" onClick={() => setScoreOpen(b)} className="gap-1.5">
                  <Plus className="h-3 w-3" />{b}
                </Button>
              ))}
            </div>
          </Card>

          {chartData.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium text-sm mb-3">Evolución</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {behaviors.map((b, i) => (
                      <Line key={b} type="monotone" dataKey={b} stroke={BEHAVIOR_COLORS[i % BEHAVIOR_COLORS.length]} strokeWidth={2} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!scoreOpen} onOpenChange={(o) => !o && setScoreOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Puntuar: {scoreOpen}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Puntuación (1-5)</Label>
              <div className="flex gap-2 mt-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScoreForm({ ...scoreForm, score: n })}
                    className={cn(
                      "flex-1 h-10 rounded-lg border font-semibold transition-colors",
                      scoreForm.score === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    )}
                  >{n}</button>
                ))}
              </div>
            </div>
            <div><Label>Fecha</Label><Input type="date" value={scoreForm.tracking_date} onChange={(e) => setScoreForm({ ...scoreForm, tracking_date: e.target.value })} /></div>
            <div><Label>Notas</Label><Textarea rows={2} value={scoreForm.notes} onChange={(e) => setScoreForm({ ...scoreForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScoreOpen(null)}>Cancelar</Button>
            <Button onClick={saveScore}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====== Evaluations ======
function WiscSection({ childId }: { childId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ version: "WISC-V", evaluation_date: "", cit: "", icv: "", irp: "", imt: "", ivp: "", irf: "", observations: "" });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("wisc_evaluations").select("*").eq("child_patient_id", childId).order("evaluation_date", { ascending: false });
    setList(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.evaluation_date) return toast.error("Fecha obligatoria");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    let report_path: string | null = null;
    if (file) {
      const path = `child-reports/${user!.id}/wisc-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) { setSaving(false); return toast.error(upErr.message); }
      report_path = path;
    }
    const numOrNull = (v: string) => v === "" ? null : parseInt(v);
    const { error } = await supabase.from("wisc_evaluations").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      version: form.version, evaluation_date: form.evaluation_date,
      cit: numOrNull(form.cit), icv: numOrNull(form.icv), irp: numOrNull(form.irp),
      imt: numOrNull(form.imt), ivp: numOrNull(form.ivp),
      irf: form.version === "WISC-V" ? numOrNull(form.irf) : null,
      observations: form.observations || null, report_path,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Evaluación guardada");
    setOpen(false);
    setForm({ version: "WISC-V", evaluation_date: "", cit: "", icv: "", irp: "", imt: "", ivp: "", irf: "", observations: "" });
    setFile(null);
    load();
  }

  async function viewReport(path: string) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const latest = list[0];
  const chartData = latest ? [
    { name: "ICV", value: latest.icv ?? 0 },
    { name: "IRP", value: latest.irp ?? 0 },
    { name: "IMT", value: latest.imt ?? 0 },
    { name: "IVP", value: latest.ivp ?? 0 },
    ...(latest.version === "WISC-V" ? [{ name: "IRF", value: latest.irf ?? 0 }] : []),
  ] : [];

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Evaluaciones WISC</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Agregar evaluación WISC</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nueva evaluación WISC</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Versión</Label>
                  <Select value={form.version} onValueChange={(v) => setForm({ ...form, version: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{WISC_VERSIONS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Fecha *</Label><Input type="date" value={form.evaluation_date} onChange={(e) => setForm({ ...form, evaluation_date: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>CIT</Label><Input type="number" value={form.cit} onChange={(e) => setForm({ ...form, cit: e.target.value })} /></div>
                <div><Label>ICV</Label><Input type="number" value={form.icv} onChange={(e) => setForm({ ...form, icv: e.target.value })} /></div>
                <div><Label>IRP</Label><Input type="number" value={form.irp} onChange={(e) => setForm({ ...form, irp: e.target.value })} /></div>
                <div><Label>IMT</Label><Input type="number" value={form.imt} onChange={(e) => setForm({ ...form, imt: e.target.value })} /></div>
                <div><Label>IVP</Label><Input type="number" value={form.ivp} onChange={(e) => setForm({ ...form, ivp: e.target.value })} /></div>
                {form.version === "WISC-V" && <div><Label>IRF</Label><Input type="number" value={form.irf} onChange={(e) => setForm({ ...form, irf: e.target.value })} /></div>}
              </div>
              <div><Label>Observaciones</Label><Textarea rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></div>
              <div><Label>Informe (PDF)</Label><Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {latest && (
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-2">Última evaluación: {latest.version} · {new Date(latest.evaluation_date).toLocaleDateString("es-CL")} · CIT: <strong>{latest.cit ?? "—"}</strong></div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" domain={[40, 160]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
                <Tooltip />
                <ReferenceLine x={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "Media (100)", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin evaluaciones registradas.</p>
      ) : (
        <div className="space-y-2">
          {list.map((w) => (
            <div key={w.id} className="border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium text-sm">{w.version} · {new Date(w.evaluation_date).toLocaleDateString("es-CL")}</div>
                <div className="text-xs text-muted-foreground">
                  CIT: {w.cit ?? "—"} · ICV: {w.icv ?? "—"} · IRP: {w.irp ?? "—"} · IMT: {w.imt ?? "—"} · IVP: {w.ivp ?? "—"}
                  {w.version === "WISC-V" && ` · IRF: ${w.irf ?? "—"}`}
                </div>
              </div>
              {w.report_path && (
                <Button size="sm" variant="ghost" onClick={() => viewReport(w.report_path)}><FileText className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OtherEvalsSection({ childId }: { childId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ test_name: "", evaluation_date: "", results: "", observations: "" });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("other_evaluations").select("*").eq("child_patient_id", childId).order("evaluation_date", { ascending: false });
    setList(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.test_name || !form.evaluation_date) return toast.error("Nombre y fecha obligatorios");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    let report_path: string | null = null;
    if (file) {
      const path = `child-reports/${user!.id}/eval-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) { setSaving(false); return toast.error(upErr.message); }
      report_path = path;
    }
    const { error } = await supabase.from("other_evaluations").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      test_name: form.test_name, evaluation_date: form.evaluation_date,
      results: form.results || null, observations: form.observations || null,
      report_path,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Evaluación guardada");
    setOpen(false);
    setForm({ test_name: "", evaluation_date: "", results: "", observations: "" });
    setFile(null);
    load();
  }

  async function viewReport(path: string) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Otras evaluaciones</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" />Agregar</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nueva evaluación</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nombre del test *</Label><Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} /></div>
              <div><Label>Fecha *</Label><Input type="date" value={form.evaluation_date} onChange={(e) => setForm({ ...form, evaluation_date: e.target.value })} /></div>
              <div><Label>Resultados</Label><Textarea rows={3} value={form.results} onChange={(e) => setForm({ ...form, results: e.target.value })} /></div>
              <div><Label>Observaciones</Label><Textarea rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></div>
              <div><Label>Informe (PDF)</Label><Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin otras evaluaciones.</p>
      ) : (
        <div className="space-y-2">
          {list.map((e) => (
            <div key={e.id} className="border border-border rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium text-sm">{e.test_name}</div>
                  <div className="text-xs text-muted-foreground">{new Date(e.evaluation_date).toLocaleDateString("es-CL")}</div>
                  {e.results && <p className="text-sm mt-1 whitespace-pre-wrap">{e.results}</p>}
                  {e.observations && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{e.observations}</p>}
                </div>
                {e.report_path && (
                  <Button size="sm" variant="ghost" onClick={() => viewReport(e.report_path)}><FileText className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ====== Communications ======
const CONTACT_ICONS: Record<string, string> = {
  llamada: "📞", email: "📧", reunión: "🤝", citación: "📝", whatsapp: "💬",
};

function CommsTab({ childId }: { childId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contact_date: new Date().toISOString().slice(0, 10), contact_type: "", contact_with: "", summary: "", agreements: "" });
  const [filterType, setFilterType] = useState<string>("__all__");
  const [filterWith, setFilterWith] = useState<string>("__all__");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase.from("communication_log").select("*").eq("child_patient_id", childId).order("contact_date", { ascending: false });
    setList(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.summary || !form.contact_date) return toast.error("Fecha y resumen obligatorios");
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("communication_log").insert({
      child_patient_id: childId, psychologist_id: user!.id,
      contact_date: form.contact_date,
      contact_type: form.contact_type || null,
      contact_with: form.contact_with || null,
      summary: form.summary, agreements: form.agreements || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Comunicación registrada");
    setOpen(false);
    setForm({ contact_date: new Date().toISOString().slice(0, 10), contact_type: "", contact_with: "", summary: "", agreements: "" });
    load();
  }

  const filtered = list.filter((c) =>
    (filterType === "__all__" || c.contact_type === filterType) &&
    (filterWith === "__all__" || c.contact_with === filterWith)
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos los tipos</SelectItem>
              {CONTACT_TYPES.map((t) => <SelectItem key={t} value={t}>{capitalize(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterWith} onValueChange={setFilterWith}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos los contactos</SelectItem>
              {CONTACT_WITH.map((w) => <SelectItem key={w} value={w}>{capitalize(w.replace(/_/g, " "))}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Registrar comunicación</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Nueva comunicación</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Fecha *</Label><Input type="date" value={form.contact_date} onChange={(e) => setForm({ ...form, contact_date: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Tipo</Label>
                  <Select value={form.contact_type} onValueChange={(v) => setForm({ ...form, contact_type: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{CONTACT_TYPES.map((t) => <SelectItem key={t} value={t}>{capitalize(t)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Contacto</Label>
                  <Select value={form.contact_with} onValueChange={(v) => setForm({ ...form, contact_with: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{CONTACT_WITH.map((w) => <SelectItem key={w} value={w}>{capitalize(w.replace(/_/g, " "))}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Resumen *</Label><Textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
              <div><Label>Acuerdos</Label><Textarea rows={2} value={form.agreements} onChange={(e) => setForm({ ...form, agreements: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <MessageCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Sin comunicaciones registradas.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const isOpen = expanded.has(c.id);
            return (
              <Card key={c.id} className="p-3">
                <button
                  className="w-full text-left flex items-start gap-3"
                  onClick={() => setExpanded((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                >
                  <div className="text-xl">{CONTACT_ICONS[c.contact_type] ?? "📌"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{new Date(c.contact_date).toLocaleDateString("es-CL")}</span>
                      {c.contact_type && <Badge variant="outline" className="text-[10px]">{c.contact_type}</Badge>}
                      {c.contact_with && <span className="text-xs text-muted-foreground">con {c.contact_with.replace(/_/g, " ")}</span>}
                    </div>
                    <p className={cn("text-sm mt-1", !isOpen && "line-clamp-1")}>{c.summary}</p>
                    {isOpen && c.agreements && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">Acuerdos</div>
                        <p className="text-sm whitespace-pre-wrap">{c.agreements}</p>
                      </div>
                    )}
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
