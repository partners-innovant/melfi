import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Sparkles } from "lucide-react";
import { calcAge, timeInTherapy } from "@/lib/clinical";
import { PatientForm } from "./Patients";
import { SessionsTab, LastSessionCard } from "@/components/SessionsTab";
import ExtendedNotesEditor from "@/components/ExtendedNotesEditor";
import MedicationsSection from "@/components/MedicationsSection";
import { PatientProfileBuilderTab, PatientDocumentsTab } from "@/components/PatientExtraTabs";
import PatientProfileBuilderPanel from "@/components/PatientProfileBuilderPanel";
import ConsolidateNotesButton from "@/components/ConsolidateNotesButton";

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<any>(null);
  const [consults, setConsults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("builder");
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    if (!id) return;
    const { data: p } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
    setPatient(p);
    if (p) {
      setForm({
        first_name: p.first_name, last_name: p.last_name,
        birth_date: p.birth_date ?? "", sex: p.sex ?? "",
        marital_status: p.marital_status ?? "", occupation: p.occupation ?? "",
        start_date: p.start_date ?? "", diagnosis: p.diagnosis ?? "", notes: p.notes ?? "",
      });
    }
    const { data: c } = await supabase
      .from("consultations").select("id, question, created_at")
      .eq("patient_id", id).order("created_at", { ascending: false });
    setConsults(c ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function saveEdit() {
    setSaving(true);
    const payload = {
      ...form,
      birth_date: form.birth_date || null,
      sex: form.sex || null,
      marital_status: form.marital_status || null,
      start_date: form.start_date || null,
      occupation: form.occupation || null,
      diagnosis: form.diagnosis || null,
      notes: form.notes || null,
    };
    const { error } = await supabase.from("patients").update(payload).eq("id", id!);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Paciente actualizado");
    setEditOpen(false);
    load();
  }

  if (loading) return <div className="p-10 text-center text-muted-foreground">Cargando...</div>;
  if (!patient) return <div className="p-10 text-center">Paciente no encontrado</div>;

  const age = calcAge(patient.birth_date);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-4xl mx-auto">
      <button onClick={() => navigate("/patients")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" />Volver a pacientes
      </button>

      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary-soft text-primary flex items-center justify-center text-lg font-semibold">
              {patient.first_name[0]}{patient.last_name[0]}
            </div>
            <div>
              <h1 className="text-2xl font-semibold">{patient.first_name} {patient.last_name}</h1>
              <p className="text-sm text-muted-foreground">{patient.diagnosis ?? "Sin diagnóstico registrado"}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />Editar
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Field label="Edad" value={age !== null ? `${age} años` : "—"} />
          <Field label="Sexo" value={patient.sex ?? "—"} />
          <Field label="Estado civil" value={patient.marital_status ?? "—"} />
          <Field label="Ocupación" value={patient.occupation ?? "—"} />
          <Field label="Inicio terapia" value={patient.start_date ? new Date(patient.start_date).toLocaleDateString("es-CL") : "—"} />
          <Field label="Tiempo en terapia" value={timeInTherapy(patient.start_date)} />
        </div>

        {patient.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Notas</div>
              <ConsolidateNotesButton
                patientId={patient.id}
                notes={patient.notes}
                onConsolidated={(newNotes) => setPatient((p: any) => p ? { ...p, notes: newNotes } : p)}
              />
            </div>
            <p className="text-sm whitespace-pre-wrap">{patient.notes}</p>
          </div>
        )}

        <div className="mt-5">
          <Link to={`/assistant?patient=${patient.id}`}>
            <Button className="gap-2"><Sparkles className="h-4 w-4" />Consultar IA sobre este paciente</Button>
          </Link>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start">
          <TabsTrigger value="builder">Constructor de Perfil</TabsTrigger>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="sessions">Sesiones</TabsTrigger>
          <TabsTrigger value="documents">Documentos e Informes</TabsTrigger>
          <TabsTrigger value="history">Consultas</TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="mt-4">
          <PatientProfileBuilderTab patientId={patient.id} onProfileUpdated={() => { load(); setRefreshKey((k) => k + 1); }} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <PatientDocumentsTab patientId={patient.id} />
        </TabsContent>

        <TabsContent value="profile" className="mt-4 space-y-4">
          <LastSessionCard
            key={refreshKey}
            kind="adult"
            patientId={patient.id}
            onClick={() => setTab("sessions")}
          />
          <ExtendedNotesEditor
            table="patients"
            rowId={patient.id}
            initialValue={patient.extended_notes ?? null}
            currentMainNotes={patient.notes ?? null}
            onMainNotesUpdated={(newNotes) => {
              setPatient((p: any) => p ? { ...p, notes: newNotes, extended_notes: null } : p);
            }}
          />
          <MedicationsSection kind="adult" patientId={patient.id} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab kind="adult" patientId={patient.id} onProfileUpdated={() => { load(); setRefreshKey((k) => k + 1); }} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="p-6">
            <h2 className="font-semibold mb-3">Historial de consultas</h2>
            {consults.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin consultas previas para este paciente.</p>
            ) : (
              <ul className="divide-y divide-border">
                {consults.map((c) => (
                  <li key={c.id} className="py-3">
                    <p className="text-sm">{c.question}</p>
                    <p className="text-xs text-muted-foreground mt-1">{new Date(c.created_at).toLocaleString("es-CL")}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar paciente</DialogTitle></DialogHeader>
          <PatientForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
