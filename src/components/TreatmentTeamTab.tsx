import { useEffect, useState } from "react";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, Mail, Phone, MapPin, Pencil, Trash2, Star, ChevronDown, ChevronUp, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  professional_name: string;
  professional_role: string;
  specialty: string | null;
  institution: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_primary_contact: boolean;
};

const ROLES = [
  "Psiquiatra",
  "Neurólogo",
  "Médico general/Médico de cabecera",
  "Terapeuta ocupacional",
  "Fonoaudiólogo",
  "Nutricionista",
  "Kinesiólogo",
  "Profesor/Educador diferencial",
  "Asistente social",
  "Otro",
];

// Map role -> tailwind color classes (badge bg/text + avatar bg)
const ROLE_STYLE: Record<string, { badge: string; avatar: string; emoji: string }> = {
  Psiquiatra:           { badge: "bg-purple-100 text-purple-800 border-purple-200", avatar: "bg-purple-500", emoji: "🟣" },
  Neurólogo:            { badge: "bg-blue-100 text-blue-800 border-blue-200",       avatar: "bg-blue-500",   emoji: "🔵" },
  "Médico general/Médico de cabecera": { badge: "bg-green-100 text-green-800 border-green-200", avatar: "bg-green-500", emoji: "🟢" },
  "Terapeuta ocupacional": { badge: "bg-yellow-100 text-yellow-800 border-yellow-200", avatar: "bg-yellow-500", emoji: "🟡" },
  Fonoaudiólogo:        { badge: "bg-orange-100 text-orange-800 border-orange-200", avatar: "bg-orange-500", emoji: "🟠" },
  Nutricionista:        { badge: "bg-red-100 text-red-800 border-red-200",          avatar: "bg-red-500",    emoji: "🔴" },
  Kinesiólogo:          { badge: "bg-teal-100 text-teal-800 border-teal-200",       avatar: "bg-teal-500",   emoji: "🟢" },
  "Profesor/Educador diferencial": { badge: "bg-indigo-100 text-indigo-800 border-indigo-200", avatar: "bg-indigo-500", emoji: "🔵" },
  "Asistente social":   { badge: "bg-pink-100 text-pink-800 border-pink-200",       avatar: "bg-pink-500",   emoji: "🟣" },
  Otro:                 { badge: "bg-gray-100 text-gray-800 border-gray-200",       avatar: "bg-gray-500",   emoji: "⚪" },
};

const styleFor = (role: string) => ROLE_STYLE[role] ?? ROLE_STYLE.Otro;

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase() ?? "").join("");

type Props = {
  patientId: string;
  kind: "adult" | "child";
};

const emptyForm = {
  professional_name: "",
  professional_role: "",
  specialty: "",
  institution: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  is_primary_contact: false,
};

export default function TreatmentTeamTab({ patientId, kind }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    const col = kind === "child" ? "child_patient_id" : "patient_id";
    const { data, error } = await supabase
      .from("treatment_team")
      .select("*")
      .eq(col, patientId)
      .order("is_primary_contact", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setMembers((data ?? []) as Member[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [patientId, kind]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(m: Member) {
    setEditing(m);
    setForm({
      professional_name: m.professional_name,
      professional_role: m.professional_role,
      specialty: m.specialty ?? "",
      institution: m.institution ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
      address: m.address ?? "",
      notes: m.notes ?? "",
      is_primary_contact: m.is_primary_contact,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.professional_name.trim()) return toast.error("Nombre requerido");
    if (!form.professional_role) return toast.error("Rol requerido");

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return toast.error("No autenticado"); }

    const col = kind === "child" ? "child_patient_id" : "patient_id";

    // If marking as primary, clear previous primary first
    if (form.is_primary_contact) {
      await supabase
        .from("treatment_team")
        .update({ is_primary_contact: false })
        .eq(col, patientId)
        .eq("is_primary_contact", true);
    }

    const payload: any = {
      professional_name: form.professional_name.trim(),
      professional_role: form.professional_role,
      specialty: form.specialty.trim() || null,
      institution: form.institution.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      is_primary_contact: form.is_primary_contact,
    };

    let error;
    if (editing) {
      ({ error } = await supabase.from("treatment_team").update(payload).eq("id", editing.id));
    } else {
      payload.psychologist_id = user.id;
      payload[col] = patientId;
      ({ error } = await supabase.from("treatment_team").insert(payload));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Profesional actualizado" : "Profesional agregado");
    setOpen(false);
    load();
  }

  async function remove(m: Member) {
    if (!confirm(`¿Eliminar a ${m.professional_name} del equipo tratante?`)) return;
    const { error } = await supabase.from("treatment_team").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success("Profesional eliminado");
    load();
  }

  if (loading) return <div className="p-6 text-center text-muted-foreground text-sm">Cargando…</div>;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Equipo tratante</h2>
          <span className="text-xs text-muted-foreground">({members.length})</span>
        </div>
        <Button size="sm" onClick={openNew} className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5">
          <Plus className="h-4 w-4" />Agregar profesional
        </Button>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No hay profesionales registrados aún. Agrega al equipo tratante (psiquiatras, médicos, terapeutas, etc.) para que el asistente IA pueda considerarlos en sus recomendaciones.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {members.map((m) => {
            const s = styleFor(m.professional_role);
            const isExpanded = expanded[m.id];
            const noteFirstLine = m.notes?.split("\n")[0] ?? "";
            const hasMoreNotes = !!m.notes && (m.notes.includes("\n") || m.notes.length > 80);
            return (
              <div key={m.id} className="rounded-lg border border-border bg-card p-4 relative">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={cn("h-11 w-11 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0", s.avatar)}>
                      {initials(m.professional_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-semibold truncate">{m.professional_name}</h3>
                        {m.is_primary_contact && (
                          <span title="Contacto principal" className="text-amber-500">
                            <Star className="h-4 w-4 fill-amber-400" />
                          </span>
                        )}
                      </div>
                      <Badge variant="outline" className={cn("mt-1 text-xs font-medium", s.badge)}>
                        {s.emoji} {m.professional_role}
                      </Badge>
                      {m.specialty && (
                        <p className="text-xs text-muted-foreground mt-1">{m.specialty}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(m)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(m)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {m.institution && (
                  <p className="text-sm text-muted-foreground mb-2">{m.institution}</p>
                )}

                <div className="space-y-1.5 text-sm">
                  {m.email && (
                    <a href={`mailto:${m.email}`} className="flex items-center gap-2 text-primary hover:underline break-all">
                      <Mail className="h-3.5 w-3.5 shrink-0" />{m.email}
                    </a>
                  )}
                  {m.phone && (
                    <a href={`tel:${m.phone}`} className="flex items-center gap-2 text-primary hover:underline">
                      <Phone className="h-3.5 w-3.5 shrink-0" />{m.phone}
                    </a>
                  )}
                  {m.address && (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{m.address}</span>
                    </div>
                  )}
                </div>

                {m.notes && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {isExpanded ? m.notes : noteFirstLine}
                    </p>
                    {hasMoreNotes && (
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [m.id]: !isExpanded }))}
                        className="text-xs text-primary mt-1 flex items-center gap-1 hover:underline"
                      >
                        {isExpanded ? <><ChevronUp className="h-3 w-3" />Ver menos</> : <><ChevronDown className="h-3 w-3" />Ver más</>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar profesional" : "Agregar profesional"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre completo *</Label>
              <Input
                value={form.professional_name}
                onChange={(e) => setForm((f) => ({ ...f, professional_name: e.target.value }))}
                maxLength={120}
              />
            </div>
            <div>
              <Label>Rol *</Label>
              <Select
                value={form.professional_role}
                onValueChange={(v) => setForm((f) => ({ ...f, professional_role: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Selecciona un rol" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Especialidad</Label>
              <Input
                value={form.specialty}
                onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                placeholder="Ej: Neuropsiquiatría infanto-juvenil"
              />
            </div>
            <div>
              <Label>Institución / Centro</Label>
              <Input
                value={form.institution}
                onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Dirección</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder='Ej: "Solo disponible martes y jueves", "Derivó al paciente por…"'
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="cursor-pointer">Contacto principal</Label>
                <p className="text-xs text-muted-foreground">Solo uno por paciente</p>
              </div>
              <Switch
                checked={form.is_primary_contact}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_primary_contact: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
