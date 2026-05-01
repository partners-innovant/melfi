import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Pill, Plus, Pencil, ChevronDown, ChevronRight, PowerOff } from "lucide-react";

type Kind = "adult" | "child";

type Medication = {
  id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  prescribed_by: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
};

type FormState = {
  name: string;
  dose: string;
  frequency: string;
  prescribed_by: string;
  start_date: string;
  end_date: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "", dose: "", frequency: "", prescribed_by: "",
  start_date: "", end_date: "", notes: "",
};

export default function MedicationsSection({ kind, patientId }: { kind: Kind; patientId: string }) {
  const table = kind === "child" ? "child_patient_medications" : "patient_medications";
  const fk = kind === "child" ? "child_patient_id" : "patient_id";

  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(table as any)
      .select("*")
      .eq(fk, patientId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setMeds((data as any) ?? []);
    setLoading(false);
  }, [table, fk, patientId]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(m: Medication) {
    setEditing(m);
    setForm({
      name: m.name,
      dose: m.dose ?? "",
      frequency: m.frequency ?? "",
      prescribed_by: m.prescribed_by ?? "",
      start_date: m.start_date ?? "",
      end_date: m.end_date ?? "",
      notes: m.notes ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) return toast.error("El nombre del medicamento es obligatorio");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      name: form.name.trim(),
      dose: form.dose || null,
      frequency: form.frequency || null,
      prescribed_by: form.prescribed_by || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes || null,
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from(table as any).update(payload).eq("id", editing.id));
    } else {
      payload[fk] = patientId;
      payload.psychologist_id = user!.id;
      ({ error } = await supabase.from(table as any).insert(payload));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Medicamento actualizado" : "Medicamento agregado");
    setOpen(false);
    setForm(EMPTY_FORM);
    setEditing(null);
    load();
  }

  async function toggleActive(m: Medication) {
    const { error } = await supabase
      .from(table as any)
      .update({ is_active: !m.is_active, end_date: !m.is_active ? null : (m.end_date ?? new Date().toISOString().slice(0, 10)) })
      .eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success(m.is_active ? "Marcado como inactivo" : "Reactivado");
    load();
  }

  const active = meds.filter((m) => m.is_active);
  const inactive = meds.filter((m) => !m.is_active);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Pill className="h-4 w-4" />Medicamentos
        </h2>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(EMPTY_FORM); } }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" />Agregar medicamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar medicamento" : "Nuevo medicamento"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Sertralina" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Dosis</Label>
                  <Input value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} placeholder="Ej. 50mg" />
                </div>
                <div>
                  <Label>Frecuencia</Label>
                  <Input value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} placeholder="Ej. 1 vez al día" />
                </div>
              </div>
              <div>
                <Label>Prescrito por</Label>
                <Input value={form.prescribed_by} onChange={(e) => setForm({ ...form, prescribed_by: e.target.value })} placeholder="Dr. / Dra." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Fecha de inicio</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div>
                  <Label>Fecha de término</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground mt-1">Dejar vacío si es continuo</p>
                </div>
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin medicamentos activos.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {active.map((m) => (
            <MedCard key={m.id} m={m} onEdit={() => openEdit(m)} onToggle={() => toggleActive(m)} />
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <Collapsible open={showInactive} onOpenChange={setShowInactive} className="mt-4 pt-4 border-t border-border">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              {showInactive ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Medicamentos anteriores ({inactive.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid sm:grid-cols-2 gap-3">
              {inactive.map((m) => (
                <MedCard key={m.id} m={m} onEdit={() => openEdit(m)} onToggle={() => toggleActive(m)} inactive />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function MedCard({
  m, onEdit, onToggle, inactive = false,
}: {
  m: Medication; onEdit: () => void; onToggle: () => void; inactive?: boolean;
}) {
  return (
    <div className={`border border-border rounded-lg p-3 ${inactive ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            {m.name}
            {m.dose && <Badge variant="secondary" className="text-[10px]">{m.dose}</Badge>}
            {inactive && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
          </div>
          {m.frequency && <div className="text-xs text-muted-foreground mt-0.5">{m.frequency}</div>}
        </div>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {m.prescribed_by && <div>Prescrito por: <span className="text-foreground">{m.prescribed_by}</span></div>}
        {m.start_date && <div>Inicio: <span className="text-foreground">{new Date(m.start_date).toLocaleDateString("es-CL")}</span></div>}
        {m.end_date && <div>Término: <span className="text-foreground">{new Date(m.end_date).toLocaleDateString("es-CL")}</span></div>}
      </div>
      {m.notes && <p className="text-xs mt-2 whitespace-pre-wrap">{m.notes}</p>}
      <div className="flex gap-2 mt-3">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onEdit}>
          <Pencil className="h-3 w-3" />Editar
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onToggle}>
          <PowerOff className="h-3 w-3" />{m.is_active ? "Marcar inactivo" : "Reactivar"}
        </Button>
      </div>
    </div>
  );
}
