import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Users as UsersIcon, Inbox, X } from "lucide-react";
import { calcAge, SEX_OPTIONS, MARITAL_OPTIONS } from "@/lib/clinical";

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
}

interface IncomingTransfer {
  id: string;
  new_patient_id: string | null;
  transferred_at: string;
  from_first_name: string | null;
  from_last_name: string | null;
  patient_name: string;
}

const DISMISSED_KEY = "transfers:dismissed";

const empty = {
  first_name: "", last_name: "", birth_date: "", sex: "",
  marital_status: "", occupation: "", start_date: "", diagnosis: "", notes: "",
};

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("patients")
      .select("id, first_name, last_name, birth_date, diagnosis")
      .order("created_at", { ascending: false });
    setPatients((data as Patient[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.first_name || !form.last_name) {
      toast.error("Nombre y apellido son obligatorios");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload: any = {
      psychologist_id: user.id,
      first_name: form.first_name,
      last_name: form.last_name,
      birth_date: form.birth_date || null,
      sex: form.sex || null,
      marital_status: form.marital_status || null,
      occupation: form.occupation || null,
      start_date: form.start_date || null,
      diagnosis: form.diagnosis || null,
      notes: form.notes || null,
    };
    const { error } = await supabase.from("patients").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Paciente creado");
    setOpen(false);
    setForm(empty);
    load();
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Pacientes</h1>
          <p className="text-muted-foreground text-sm mt-1">{patients.length} {patients.length === 1 ? "paciente" : "pacientes"}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Nuevo paciente</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo paciente</DialogTitle></DialogHeader>
            <PatientForm form={form} setForm={setForm} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}</div>
      ) : patients.length === 0 ? (
        <Card className="p-10 text-center">
          <UsersIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium mb-1">Aún no tienes pacientes</p>
          <p className="text-sm text-muted-foreground mb-4">Comienza agregando tu primer paciente.</p>
          <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Nuevo paciente</Button>
        </Card>
      ) : (
        <div className="grid gap-2">
          {patients.map((p) => {
            const age = calcAge(p.birth_date);
            return (
              <Link key={p.id} to={`/patients/${p.id}`}>
                <Card className="p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary-soft text-primary flex items-center justify-center font-semibold flex-shrink-0">
                    {p.first_name[0]}{p.last_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{p.first_name} {p.last_name}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {age !== null && `${age} años`}{age !== null && p.diagnosis && " · "}{p.diagnosis ?? (age === null ? "Sin información" : "")}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PatientForm({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const u = (k: string, v: string) => setForm({ ...form, [k]: v });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Nombre *</Label><Input value={form.first_name} onChange={(e) => u("first_name", e.target.value)} /></div>
        <div><Label>Apellido *</Label><Input value={form.last_name} onChange={(e) => u("last_name", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Fecha de nacimiento</Label><Input type="date" value={form.birth_date} onChange={(e) => u("birth_date", e.target.value)} /></div>
        <div>
          <Label>Sexo</Label>
          <Select value={form.sex} onValueChange={(v) => u("sex", v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{SEX_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Estado civil</Label>
          <Select value={form.marital_status} onValueChange={(v) => u("marital_status", v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{MARITAL_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Ocupación</Label><Input value={form.occupation} onChange={(e) => u("occupation", e.target.value)} /></div>
      </div>
      <div><Label>Inicio de terapia</Label><Input type="date" value={form.start_date} onChange={(e) => u("start_date", e.target.value)} /></div>
      <div><Label>Diagnóstico</Label><Input value={form.diagnosis} onChange={(e) => u("diagnosis", e.target.value)} /></div>
      <div><Label>Notas clínicas</Label><Textarea rows={3} value={form.notes} onChange={(e) => u("notes", e.target.value)} /></div>
    </div>
  );
}
