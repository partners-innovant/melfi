import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Baby, Search, Trash2 } from "lucide-react";
import {
  calcAge, ageRangeColor, CHILD_SEX, MODALITIES, REFERRAL_SOURCES,
  RELATIONSHIPS, INVOLVEMENT_LEVELS,
} from "@/lib/clinical";

interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  grade: string | null;
  school: string | null;
  modality: string | null;
}

const emptyChild = {
  first_name: "", last_name: "", birth_date: "", sex: "",
  school: "", grade: "", homeroom_teacher: "", modality: "",
  referral_source: "", referral_reason: "",
  medical_diagnosis: "", current_medication: "", specialist_name: "",
  notes: "",
};
const emptyGuardian = { full_name: "", relationship: "", phone: "", email: "", involvement_level: "" };

export default function Children() {
  const [rows, setRows] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyChild);
  const [guardians, setGuardians] = useState<typeof emptyGuardian[]>([{ ...emptyGuardian }]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("child_patients")
      .select("id, first_name, last_name, birth_date, grade, school, modality")
      .order("created_at", { ascending: false });
    setRows((data as ChildRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      (r.school ?? "").toLowerCase().includes(q) ||
      (r.grade ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function save() {
    if (!form.first_name || !form.last_name || !form.birth_date) {
      toast.error("Nombre, apellido y fecha de nacimiento son obligatorios");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const payload: any = {
      psychologist_id: user.id,
      first_name: form.first_name, last_name: form.last_name,
      birth_date: form.birth_date,
      sex: form.sex || null,
      school: form.school || null, grade: form.grade || null,
      homeroom_teacher: form.homeroom_teacher || null,
      modality: form.modality || null,
      referral_source: form.referral_source || null,
      referral_reason: form.referral_reason || null,
      medical_diagnosis: form.medical_diagnosis || null,
      current_medication: form.current_medication || null,
      specialist_name: form.specialist_name || null,
      notes: form.notes || null,
    };
    const { data: child, error } = await supabase
      .from("child_patients").insert(payload).select().single();
    if (error) { setSaving(false); toast.error(error.message); return; }

    const validG = guardians.filter((g) => g.full_name.trim());
    if (validG.length > 0) {
      await supabase.from("guardians").insert(
        validG.map((g) => ({
          child_patient_id: child.id,
          psychologist_id: user.id,
          full_name: g.full_name,
          relationship: g.relationship || null,
          phone: g.phone || null,
          email: g.email || null,
          involvement_level: g.involvement_level || null,
        }))
      );
    }

    setSaving(false);
    toast.success("Paciente infanto-juvenil creado");
    setOpen(false);
    setForm(emptyChild);
    setGuardians([{ ...emptyGuardian }]);
    load();
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Baby className="h-6 w-6 text-primary" />Infanto-Juvenil
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {rows.length} {rows.length === 1 ? "paciente" : "pacientes"} (3-17 años)
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Nuevo paciente infanto-juvenil</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo paciente infanto-juvenil</DialogTitle></DialogHeader>
            <ChildForm form={form} setForm={setForm} guardians={guardians} setGuardians={setGuardians} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, colegio o curso..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-card rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <Baby className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium mb-1">{rows.length === 0 ? "Aún no tienes pacientes infanto-juveniles" : "Sin resultados"}</p>
          <p className="text-sm text-muted-foreground mb-4">
            {rows.length === 0 ? "Comienza agregando el primero." : "Prueba con otra búsqueda."}
          </p>
          {rows.length === 0 && (
            <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Nuevo paciente</Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-2">
          {filtered.map((p) => {
            const age = calcAge(p.birth_date);
            const range = ageRangeColor(age);
            return (
              <Link key={p.id} to={`/children/${p.id}`}>
                <Card className="p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer flex items-center gap-4">
                  <div className={`h-10 w-10 rounded-full ${range.bg} ${range.text} flex items-center justify-center font-semibold flex-shrink-0`}>
                    {p.first_name[0]}{p.last_name[0]}
                  </div>
                  <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                    <div className="font-medium break-words">{p.first_name} {p.last_name}</div>
                    {(() => {
                      const line = `${age !== null ? `${age} años` : "—"}${p.grade ? ` · ${p.grade}` : ""}${p.school ? ` · ${p.school}` : ""}`;
                      return (
                        <div
                          className="text-sm text-muted-foreground max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                          title={line}
                        >
                          {line}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${range.bg} ${range.text}`}>
                      {range.label}
                    </span>
                    {p.modality && (
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300">
                        {p.modality}
                      </span>
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

export function ChildForm({
  form, setForm, guardians, setGuardians,
}: {
  form: any; setForm: (f: any) => void;
  guardians: any[]; setGuardians: (g: any[]) => void;
}) {
  const u = (k: string, v: string) => setForm({ ...form, [k]: v });
  const ug = (i: number, k: string, v: string) =>
    setGuardians(guardians.map((g, j) => (j === i ? { ...g, [k]: v } : g)));

  return (
    <Tabs defaultValue="personal" className="mt-2">
      <TabsList className="grid grid-cols-4 w-full">
        <TabsTrigger value="personal">Personales</TabsTrigger>
        <TabsTrigger value="school">Escolares</TabsTrigger>
        <TabsTrigger value="referral">Derivación</TabsTrigger>
        <TabsTrigger value="guardians">Apoderados</TabsTrigger>
      </TabsList>

      <TabsContent value="personal" className="space-y-3 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nombre *</Label><Input value={form.first_name} onChange={(e) => u("first_name", e.target.value)} /></div>
          <div><Label>Apellido *</Label><Input value={form.last_name} onChange={(e) => u("last_name", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Fecha de nacimiento *</Label><Input type="date" value={form.birth_date} onChange={(e) => u("birth_date", e.target.value)} /></div>
          <div>
            <Label>Sexo</Label>
            <Select value={form.sex} onValueChange={(v) => u("sex", v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
              <SelectContent>{CHILD_SEX.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="school" className="space-y-3 pt-3">
        <div><Label>Colegio</Label><Input value={form.school} onChange={(e) => u("school", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Curso</Label><Input value={form.grade} onChange={(e) => u("grade", e.target.value)} placeholder="ej. 4° básico" /></div>
          <div><Label>Profesor jefe</Label><Input value={form.homeroom_teacher} onChange={(e) => u("homeroom_teacher", e.target.value)} /></div>
        </div>
        <div>
          <Label>Modalidad</Label>
          <Select value={form.modality} onValueChange={(v) => u("modality", v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{MODALITIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </TabsContent>

      <TabsContent value="referral" className="space-y-3 pt-3">
        <div>
          <Label>Origen de derivación</Label>
          <Select value={form.referral_source} onValueChange={(v) => u("referral_source", v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>{REFERRAL_SOURCES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Motivo de derivación</Label><Textarea rows={2} value={form.referral_reason} onChange={(e) => u("referral_reason", e.target.value)} /></div>
        <div><Label>Diagnóstico médico</Label><Input value={form.medical_diagnosis} onChange={(e) => u("medical_diagnosis", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Medicación actual</Label><Input value={form.current_medication} onChange={(e) => u("current_medication", e.target.value)} /></div>
          <div><Label>Especialista tratante</Label><Input value={form.specialist_name} onChange={(e) => u("specialist_name", e.target.value)} /></div>
        </div>
        <div><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={(e) => u("notes", e.target.value)} /></div>
      </TabsContent>

      <TabsContent value="guardians" className="space-y-3 pt-3">
        {guardians.map((g, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-2 relative">
            {guardians.length > 1 && (
              <button
                type="button"
                onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}
                className="absolute top-2 right-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <div className="text-xs uppercase font-semibold text-muted-foreground">Apoderado {i + 1}</div>
            <div><Label>Nombre completo</Label><Input value={g.full_name} onChange={(e) => ug(i, "full_name", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Relación</Label>
                <Select value={g.relationship} onValueChange={(v) => ug(i, "relationship", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Implicación</Label>
                <Select value={g.involvement_level} onValueChange={(v) => ug(i, "involvement_level", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{INVOLVEMENT_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Teléfono</Label><Input value={g.phone} onChange={(e) => ug(i, "phone", e.target.value)} /></div>
              <div><Label>Email</Label><Input type="email" value={g.email} onChange={(e) => ug(i, "email", e.target.value)} /></div>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setGuardians([...guardians, { ...emptyGuardian }])}>
          <Plus className="h-3.5 w-3.5" /> Agregar apoderado
        </Button>
      </TabsContent>
    </Tabs>
  );
}
