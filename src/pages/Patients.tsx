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
import { calcAge, SEX_OPTIONS, MARITAL_OPTIONS, capitalize } from "@/lib/clinical";

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
  session_day: string | null;
  session_time: string | null;
}

const DAY_LABELS: Record<string, string> = {
  lunes: "Lunes", martes: "Martes", miercoles: "Miércoles", jueves: "Jueves",
  viernes: "Viernes", sabado: "Sábado", domingo: "Domingo",
};
const DAY_ORDER: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
};

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
  const [sortMode, setSortMode] = useState<"recent" | "schedule">("recent");
  const [transferredMap, setTransferredMap] = useState<Record<string, string>>({}); // patientId -> ISO date received
  const [incoming, setIncoming] = useState<IncomingTransfer[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("patients")
      .select("id, first_name, last_name, birth_date, diagnosis, session_day, session_time")
      .order("created_at", { ascending: false });
    setPatients((data as Patient[]) ?? []);

    if (user) {
      // Transfers received by this therapist
      const { data: trs } = await supabase
        .from("patient_transfers")
        .select("id, new_patient_id, transferred_at, from_psychologist_id, snapshot")
        .eq("to_psychologist_id", user.id)
        .order("transferred_at", { ascending: false });

      const map: Record<string, string> = {};
      const incomingList: IncomingTransfer[] = [];
      const fromIds = Array.from(
        new Set((trs ?? []).map((t: any) => t.from_psychologist_id).filter(Boolean)),
      );
      let fromProfiles: Record<string, { first_name: string; last_name: string }> = {};
      if (fromIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", fromIds);
        (profs ?? []).forEach((p: any) => {
          fromProfiles[p.id] = { first_name: p.first_name, last_name: p.last_name };
        });
      }

      (trs ?? []).forEach((t: any) => {
        if (t.new_patient_id) map[t.new_patient_id] = t.transferred_at;
        const from = fromProfiles[t.from_psychologist_id];
        const patientName = t.snapshot?.patient
          ? `${t.snapshot.patient.first_name ?? ""} ${t.snapshot.patient.last_name ?? ""}`.trim()
          : "Paciente transferido";
        incomingList.push({
          id: t.id,
          new_patient_id: t.new_patient_id,
          transferred_at: t.transferred_at,
          from_first_name: from?.first_name ?? null,
          from_last_name: from?.last_name ?? null,
          patient_name: patientName,
        });
      });
      setTransferredMap(map);
      setIncoming(incomingList);
    }

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
        <div className="flex items-center gap-2">
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as any)}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Más recientes</SelectItem>
              <SelectItem value="schedule">Ordenar por día y hora de sesión</SelectItem>
            </SelectContent>
          </Select>
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
        </div>
      </header>

      {/* Incoming transfer banners */}
      {incoming
        .filter((i) => !dismissed.has(i.id))
        .slice(0, 3)
        .map((i) => {
          const fromName =
            [i.from_first_name, i.from_last_name].filter(Boolean).join(" ").trim() ||
            "otro terapeuta";
          return (
            <div
              key={i.id}
              className="mb-3 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary-soft/40 p-3 text-sm"
            >
              <Inbox className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                📋 Tienes un nuevo paciente transferido:{" "}
                <strong>{i.patient_name}</strong> — enviado por <strong>{fromName}</strong>
              </div>
              <button
                onClick={() => {
                  const next = new Set(dismissed);
                  next.add(i.id);
                  setDismissed(next);
                  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(next)));
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}

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
          {[...patients].sort((a, b) => {
            if (sortMode !== "schedule") return 0;
            const ad = a.session_day ? DAY_ORDER[a.session_day] ?? 99 : 99;
            const bd = b.session_day ? DAY_ORDER[b.session_day] ?? 99 : 99;
            if (ad !== bd) return ad - bd;
            const at = a.session_time ?? "99:99";
            const bt = b.session_time ?? "99:99";
            return at.localeCompare(bt);
          }).map((p) => {
            const age = calcAge(p.birth_date);
            const transferDate = transferredMap[p.id];
            const dl = p.session_day ? DAY_LABELS[p.session_day] : null;
            const tl = p.session_time ? String(p.session_time).slice(0, 5) : null;
            return (
              <Link key={p.id} to={`/patients/${p.id}`}>
                <Card className="p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary-soft text-primary flex items-center justify-center font-semibold flex-shrink-0">
                    {p.first_name[0]}{p.last_name[0]}
                  </div>
                  <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <span className="break-words">{p.first_name} {p.last_name}</span>
                      {transferDate && (
                        <span className="text-[10px] uppercase tracking-wide bg-primary-soft text-primary px-1.5 py-0.5 rounded whitespace-nowrap">
                          Transferido · {new Date(transferDate).toLocaleDateString("es-CL")}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const line = age !== null ? `${age} años` : "";
                      return (
                        <div
                          className="text-sm text-muted-foreground max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                          title={line}
                        >
                          {line}
                        </div>
                      );
                    })()}
                    {dl && tl && (
                      <div className="text-xs text-primary mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">📅 {dl} {tl}</div>
                    )}
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
            <SelectContent>{SEX_OPTIONS.map((s) => <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Estado civil</Label>
          <Select value={form.marital_status} onValueChange={(v) => u("marital_status", v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{MARITAL_OPTIONS.map((m) => <SelectItem key={m} value={m}>{capitalize(m)}</SelectItem>)}</SelectContent>
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
