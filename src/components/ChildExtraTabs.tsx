import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, FileText, Trash2, Eye, Sparkles, Brain, Download, Calendar as CalIcon, ChevronDown, ChevronRight, Loader2, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import jsPDF from "jspdf";

// ===================== Shared =====================
const BUCKET = "child-files";

async function uploadChildFile(file: File, subfolder: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No auth");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${subfolder}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

async function openFile(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) { toast.error("No se pudo abrir el archivo"); return; }
  window.open(data.signedUrl, "_blank");
}

// ===================== TAB 1: Documentos =====================
const DOC_TYPES: { value: string; label: string }[] = [
  { value: "informe_psicologico", label: "Informe psicológico" },
  { value: "informe_neurologico", label: "Informe neurológico" },
  { value: "informe_pedagogico", label: "Informe pedagógico" },
  { value: "informe_fonoaudiologico", label: "Informe fonoaudiológico" },
  { value: "informe_terapia_ocupacional", label: "Informe terapia ocupacional" },
  { value: "informe_psiquiatrico", label: "Informe psiquiátrico" },
  { value: "evaluacion_externa", label: "Evaluación externa" },
  { value: "otro", label: "Otro" },
];
const docLabel = (v?: string | null) => DOC_TYPES.find(d => d.value === v)?.label ?? "Otro";

export function ChildDocumentsTab({ childId }: { childId: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", document_type: "", professional_name: "", professional_role: "",
    document_date: "", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("child_documents")
      .select("*").eq("child_patient_id", childId)
      .order("document_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setDocs(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  function reset() {
    setForm({ title: "", document_type: "", professional_name: "", professional_role: "", document_date: "", notes: "" });
    setFile(null);
  }

  async function save() {
    if (!form.title.trim()) return toast.error("Título obligatorio");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let file_path: string | null = null;
      if (file) file_path = await uploadChildFile(file, "documents");
      const { error } = await supabase.from("child_documents").insert({
        child_patient_id: childId,
        psychologist_id: user!.id,
        title: form.title.trim(),
        document_type: form.document_type || null,
        professional_name: form.professional_name || null,
        professional_role: form.professional_role || null,
        document_date: form.document_date || null,
        notes: form.notes || null,
        file_path,
      });
      if (error) throw error;
      toast.success("Documento guardado");
      setOpen(false); reset(); load();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally { setSaving(false); }
  }

  async function remove(d: any) {
    if (!confirm(`¿Eliminar "${d.title}"?`)) return;
    if (d.file_path) await supabase.storage.from(BUCKET).remove([d.file_path]);
    const { error } = await supabase.from("child_documents").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("Documento eliminado");
    load();
  }

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const d of docs) {
      const k = d.document_type ?? "otro";
      (g[k] ??= []).push(d);
    }
    return g;
  }, [docs]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-semibold">Documentos e informes</h2>
          <p className="text-sm text-muted-foreground">Informes externos, evaluaciones y documentos de apoyo.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Subir informe</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo documento</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Título *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div>
                <Label>Tipo de documento</Label>
                <Select value={form.document_type} onValueChange={(v) => setForm({ ...form, document_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Profesional</Label><Input value={form.professional_name} onChange={(e) => setForm({ ...form, professional_name: e.target.value })} placeholder="Nombre" /></div>
                <div><Label>Rol</Label><Input value={form.professional_role} onChange={(e) => setForm({ ...form, professional_role: e.target.value })} placeholder="ej. Neuróloga pediatra" /></div>
              </div>
              <div><Label>Fecha del documento</Label><Input type="date" value={form.document_date} onChange={(e) => setForm({ ...form, document_date: e.target.value })} /></div>
              <div>
                <Label>Archivo (PDF, DOCX, imagen)</Label>
                <Input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {docs.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Aún no hay documentos cargados.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([type, list]) => (
            <div key={type}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">{docLabel(type)}</div>
              <div className="grid gap-2">
                {list.map((d) => (
                  <Card key={d.id} className="p-4 flex items-start gap-3">
                    <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{d.title}</span>
                        <Badge variant="secondary" className="border-0 text-[10px]">{docLabel(d.document_type)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {d.professional_name && <span>{d.professional_name}{d.professional_role ? ` · ${d.professional_role}` : ""}</span>}
                        {d.document_date && <span>{new Date(d.document_date).toLocaleDateString("es-CL")}</span>}
                      </div>
                      {d.notes && <p className="text-sm text-muted-foreground mt-1">{d.notes}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {d.file_path && (
                        <Button size="sm" variant="outline" onClick={() => openFile(d.file_path)} className="gap-1">
                          <Eye className="h-3.5 w-3.5" />Ver
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => remove(d)} className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== TAB 2: Apuntes de sesión =====================
const EMOTIONS: { value: string; emoji: string; label: string }[] = [
  { value: "muy_bajo", emoji: "😔", label: "Muy bajo" },
  { value: "bajo", emoji: "😟", label: "Bajo" },
  { value: "moderado", emoji: "😐", label: "Moderado" },
  { value: "bueno", emoji: "🙂", label: "Bueno" },
  { value: "muy_bueno", emoji: "😊", label: "Muy bueno" },
];
const emotionOf = (v?: string | null) => EMOTIONS.find(e => e.value === v);

export function ChildSessionNotesTab({ childId }: { childId: string }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    session_date: new Date().toISOString().slice(0, 10),
    emotional_state: "",
    raw_notes: "",
    techniques_used: "",
    assigned_task: "",
    next_session_plan: "",
  });

  const load = useCallback(async () => {
    const { data } = await supabase.from("child_session_notes")
      .select("*").eq("child_patient_id", childId)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });
    setNotes(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  function reset() {
    setForm({
      session_date: new Date().toISOString().slice(0, 10),
      emotional_state: "", raw_notes: "", techniques_used: "",
      assigned_task: "", next_session_plan: "",
    });
  }

  async function save() {
    if (!form.raw_notes.trim()) return toast.error("Escribe al menos los apuntes");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nextNum = (notes[0]?.session_number ?? 0) + 1;
      const { error } = await supabase.from("child_session_notes").insert({
        child_patient_id: childId,
        psychologist_id: user!.id,
        session_date: form.session_date,
        session_number: nextNum,
        raw_notes: form.raw_notes.trim(),
        emotional_state: form.emotional_state || null,
        techniques_used: form.techniques_used || null,
        assigned_task: form.assigned_task || null,
        next_session_plan: form.next_session_plan || null,
      });
      if (error) throw error;
      toast.success("Apuntes guardados");
      setOpen(false); reset(); load();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally { setSaving(false); }
  }

  async function remove(n: any) {
    if (!confirm("¿Eliminar estos apuntes?")) return;
    const { error } = await supabase.from("child_session_notes").delete().eq("id", n.id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-semibold">Apuntes de sesión</h2>
          <p className="text-sm text-muted-foreground">Bitácora rápida de sesiones de este paciente.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Nueva sesión</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevos apuntes de sesión</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Fecha *</Label><Input type="date" value={form.session_date} onChange={(e) => setForm({ ...form, session_date: e.target.value })} /></div>
              <div>
                <Label>Estado emocional</Label>
                <div className="flex gap-2 mt-2">
                  {EMOTIONS.map(em => (
                    <button
                      key={em.value} type="button"
                      onClick={() => setForm({ ...form, emotional_state: em.value })}
                      className={cn(
                        "flex-1 h-12 rounded-lg border text-2xl transition-colors",
                        form.emotional_state === em.value ? "bg-primary/10 border-primary" : "border-border hover:bg-accent"
                      )}
                      title={em.label}
                    >{em.emoji}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Apuntes *</Label>
                <Textarea rows={6} value={form.raw_notes} onChange={(e) => setForm({ ...form, raw_notes: e.target.value })} placeholder="Escribe tus apuntes de la sesión..." />
              </div>
              <div><Label>Técnicas usadas</Label><Input value={form.techniques_used} onChange={(e) => setForm({ ...form, techniques_used: e.target.value })} /></div>
              <div><Label>Tarea asignada</Label><Input value={form.assigned_task} onChange={(e) => setForm({ ...form, assigned_task: e.target.value })} /></div>
              <div><Label>Plan próxima sesión</Label><Textarea rows={2} value={form.next_session_plan} onChange={(e) => setForm({ ...form, next_session_plan: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar apuntes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {notes.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Aún no hay apuntes registrados.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const em = emotionOf(n.emotional_state);
            const isOpen = expanded.has(n.id);
            const text = n.refined_notes ?? n.raw_notes;
            const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;
            return (
              <Card key={n.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(s => { const ns = new Set(s); ns.has(n.id) ? ns.delete(n.id) : ns.add(n.id); return ns; })}
                  className="w-full text-left p-4 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {isOpen ? <ChevronDown className="h-5 w-5 mt-0.5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 mt-0.5 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {em && <span className="text-xl" title={em.label}>{em.emoji}</span>}
                        <span className="font-medium text-sm">Sesión #{n.session_number ?? "—"}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <CalIcon className="h-3 w-3" />{new Date(n.session_date).toLocaleDateString("es-CL")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{isOpen ? text : preview}</p>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border p-4 bg-surface space-y-2 text-sm">
                    {n.techniques_used && <div><span className="font-semibold">Técnicas:</span> {n.techniques_used}</div>}
                    {n.assigned_task && <div><span className="font-semibold">Tarea:</span> {n.assigned_task}</div>}
                    {n.next_session_plan && <div><span className="font-semibold">Próxima sesión:</span> {n.next_session_plan}</div>}
                    <div className="flex justify-end pt-2">
                      <Button size="sm" variant="ghost" onClick={() => remove(n)} className="text-destructive hover:text-destructive gap-1">
                        <Trash2 className="h-3.5 w-3.5" />Eliminar
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===================== TAB 3: Tests =====================
const TEST_OPTIONS: { value: string; icon: string; label: string }[] = [
  { value: "wisc", icon: "🧠", label: "WISC" },
  { value: "htp", icon: "🎨", label: "HTP" },
  { value: "figura_humana", icon: "👤", label: "Figura humana" },
  { value: "familia", icon: "👨‍👩‍👧", label: "Test de la familia" },
  { value: "persona_bajo_lluvia", icon: "🌧️", label: "Persona bajo la lluvia" },
  { value: "bender", icon: "📐", label: "Bender" },
  { value: "conners", icon: "📋", label: "Conners" },
  { value: "raven", icon: "📊", label: "Raven" },
  { value: "otro", icon: "🔍", label: "Otro" },
];
const testLabel = (v?: string | null) => TEST_OPTIONS.find(t => t.value === v)?.label ?? v ?? "—";

export function ChildTestsTab({ childId }: { childId: string }) {
  const [tests, setTests] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<string>("");
  const [reportOpen, setReportOpen] = useState<any | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("child_tests")
      .select("*").eq("child_patient_id", childId)
      .order("evaluation_date", { ascending: false });
    setTests(data ?? []);
  }, [childId]);
  useEffect(() => { load(); }, [load]);

  function close() { setOpen(false); setStep(1); setSelectedType(""); }

  async function remove(t: any) {
    if (!confirm(`¿Eliminar "${t.test_name}"?`)) return;
    if (t.report_pdf_path) await supabase.storage.from(BUCKET).remove([t.report_pdf_path]);
    const { error } = await supabase.from("child_tests").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-semibold">Tests y evaluaciones</h2>
          <p className="text-sm text-muted-foreground">Aplicación, resultados e informes generados con IA.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => o ? setOpen(true) : close()}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Agregar test</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{step === 1 ? "Selecciona el test" : `Resultados — ${testLabel(selectedType)}`}</DialogTitle>
            </DialogHeader>
            {step === 1 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TEST_OPTIONS.map(t => (
                  <button
                    key={t.value} type="button"
                    onClick={() => { setSelectedType(t.value); setStep(2); }}
                    className="border border-border rounded-lg p-4 text-center hover:bg-accent hover:border-primary transition-colors"
                  >
                    <div className="text-2xl mb-1">{t.icon}</div>
                    <div className="text-sm font-medium">{t.label}</div>
                  </button>
                ))}
              </div>
            ) : selectedType === "wisc" ? (
              <WiscForm childId={childId} onClose={() => { close(); load(); }} onBack={() => setStep(1)} />
            ) : (
              <GenericTestForm
                childId={childId}
                testType={selectedType}
                testLabel={testLabel(selectedType)}
                onClose={() => { close(); load(); }}
                onBack={() => setStep(1)}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>

      {tests.length === 0 ? (
        <Card className="p-10 text-center">
          <Brain className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Aún no hay tests registrados.</p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {tests.map(t => {
            const opt = TEST_OPTIONS.find(o => o.value === t.test_type);
            return (
              <Card key={t.id} className="p-4 flex items-start gap-3">
                <div className="text-2xl flex-shrink-0">{opt?.icon ?? "🔬"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.test_name}</span>
                    <Badge variant="secondary" className="border-0 text-[10px]">{testLabel(t.test_type)}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(t.evaluation_date).toLocaleDateString("es-CL")}</span>
                  </div>
                  {t.results_raw && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.results_raw}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {t.generated_report && (
                    <Button size="sm" variant="outline" onClick={() => setReportOpen(t)} className="gap-1">
                      <Eye className="h-3.5 w-3.5" />Informe
                    </Button>
                  )}
                  {t.report_pdf_path && (
                    <Button size="sm" variant="ghost" onClick={() => openFile(t.report_pdf_path)} className="gap-1">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(t)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!reportOpen} onOpenChange={(o) => !o && setReportOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{reportOpen?.test_name}</DialogTitle></DialogHeader>
          <div className="text-sm whitespace-pre-wrap">{reportOpen?.generated_report}</div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportOpen(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- WISC form ---
function WiscForm({ childId, onClose, onBack }: { childId: string; onClose: () => void; onBack: () => void }) {
  const [form, setForm] = useState({
    version: "WISC-V", evaluation_date: new Date().toISOString().slice(0, 10),
    cit: "", icv: "", irp: "", imt: "", ivp: "", irf: "", observations: "",
  });
  const [saving, setSaving] = useState(false);
  const numOrNull = (v: string) => v === "" ? null : Number(v);

  const chartData = useMemo(() => {
    const fields = [
      { k: "cit", label: "CIT" }, { k: "icv", label: "ICV" }, { k: "irp", label: "IRP" },
      { k: "imt", label: "IMT" }, { k: "ivp", label: "IVP" },
      ...(form.version === "WISC-V" ? [{ k: "irf", label: "IRF" }] : []),
    ];
    return fields.map(f => ({ name: f.label, valor: (form as any)[f.k] === "" ? null : Number((form as any)[f.k]) }));
  }, [form]);

  async function save() {
    if (!form.evaluation_date) return toast.error("Fecha obligatoria");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const structured = {
        version: form.version,
        cit: numOrNull(form.cit), icv: numOrNull(form.icv), irp: numOrNull(form.irp),
        imt: numOrNull(form.imt), ivp: numOrNull(form.ivp),
        irf: form.version === "WISC-V" ? numOrNull(form.irf) : null,
      };
      const { error } = await supabase.from("child_tests").insert({
        child_patient_id: childId,
        psychologist_id: user!.id,
        test_name: `WISC (${form.version})`,
        test_type: "wisc",
        evaluation_date: form.evaluation_date,
        results_structured: structured,
        notes: form.observations || null,
      });
      if (error) throw error;
      toast.success("Test guardado");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Versión</Label>
          <Select value={form.version} onValueChange={(v) => setForm({ ...form, version: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="WISC-IV">WISC-IV</SelectItem>
              <SelectItem value="WISC-V">WISC-V</SelectItem>
            </SelectContent>
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
        {form.version === "WISC-V" && (
          <div><Label>IRF</Label><Input type="number" value={form.irf} onChange={(e) => setForm({ ...form, irf: e.target.value })} /></div>
        )}
      </div>
      {chartData.some(d => d.valor !== null) && (
        <div className="h-56 border border-border rounded-lg p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[40, 160]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "Media (100)", fontSize: 10, position: "right" }} />
              <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div><Label>Observaciones cualitativas</Label><Textarea rows={3} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></div>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack}>Atrás</Button>
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? "Guardando..." : <><Sparkles className="h-4 w-4" />Guardar</>}
        </Button>
      </DialogFooter>
    </div>
  );
}

// --- Generic / Otro form ---
function GenericTestForm({
  childId, testType, testLabel, onClose, onBack,
}: { childId: string; testType: string; testLabel: string; onClose: () => void; onBack: () => void }) {
  const [form, setForm] = useState({
    test_name: testLabel,
    evaluation_date: new Date().toISOString().slice(0, 10),
    results_raw: "",
    notes: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.test_name.trim()) return toast.error("Nombre del test obligatorio");
    if (!form.evaluation_date) return toast.error("Fecha obligatoria");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let report_pdf_path: string | null = null;
      if (file) report_pdf_path = await uploadChildFile(file, "tests");
      const { error } = await supabase.from("child_tests").insert({
        child_patient_id: childId,
        psychologist_id: user!.id,
        test_name: form.test_name.trim(),
        test_type: testType,
        evaluation_date: form.evaluation_date,
        results_raw: form.results_raw || null,
        notes: form.notes || null,
        report_pdf_path,
      });
      if (error) throw error;
      toast.success("Test guardado");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nombre del test *</Label><Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} /></div>
        <div><Label>Fecha *</Label><Input type="date" value={form.evaluation_date} onChange={(e) => setForm({ ...form, evaluation_date: e.target.value })} /></div>
      </div>
      <div>
        <Label>Resultados / observaciones</Label>
        <Textarea rows={5} value={form.results_raw} onChange={(e) => setForm({ ...form, results_raw: e.target.value })} placeholder="Describe los resultados..." />
      </div>
      <div>
        <Label>Archivo (PDF, imagen)</Label>
        <Input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="text-xs text-muted-foreground mt-1">Útil para subir el dibujo del test proyectivo o el informe.</p>
      </div>
      <div><Label>Notas adicionales</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack}>Atrás</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
      </DialogFooter>
    </div>
  );
}
