import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, Plus, Power, Search, Trash2, Upload, X, Save, UserPlus, History } from "lucide-react";
import { Navigate } from "react-router-dom";
import TransferPatientDialog from "@/components/TransferPatientDialog";
import TransferHistoryPanel from "@/components/TransferHistoryPanel";

type Therapist = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  specialty: string | null;
  phone: string | null;
  institution: string | null;
  is_active: boolean;
  invited_at: string;
  joined_at: string | null;
  notes: string | null;
};

const SPECIALTIES = [
  "Psicología clínica",
  "Psicología infanto-juvenil",
  "Neuropsicología",
  "Psicología educacional",
  "Otra",
];

type StatusFilter = "todos" | "activos" | "pendientes" | "inactivos";

function statusOf(t: Therapist): "activo" | "pendiente" | "inactivo" {
  if (!t.is_active) return "inactivo";
  if (t.joined_at) return "activo";
  return "pendiente";
}

function StatusBadge({ t }: { t: Therapist }) {
  const s = statusOf(t);
  if (s === "activo") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">🟢 Activo</Badge>;
  if (s === "pendiente") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">🟡 Pendiente</Badge>;
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Inactivo</Badge>;
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("es-CL");
  } catch {
    return v;
  }
}

export default function AdminTherapists() {
  const { profile } = useAuth();
  const [list, setList] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("todas");
  const [patientCounts, setPatientCounts] = useState<Record<string, number>>({});

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    email: "",
    first_name: "",
    last_name: "",
    specialty: "",
    institution: "",
    phone: "",
    notes: "",
  });
  const [adding, setAdding] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Therapist>>({});

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Therapist | null>(null);

  // Transfer
  const [transferTarget, setTransferTarget] = useState<Therapist | null>(null);

  // History
  const [historyTarget, setHistoryTarget] = useState<Therapist | null>(null);
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);

  // CSV
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<
    | {
        rows: Array<{
          email: string;
          first_name?: string;
          last_name?: string;
          specialty?: string;
          institution?: string;
        }>;
        invalid: string[];
      }
    | null
  >(null);
  const [importing, setImporting] = useState(false);

  if (profile && !profile.is_admin) return <Navigate to="/" replace />;

  async function fetchAll() {
    setLoading(true);
    const { data, error } = await supabase
      .from("allowed_therapists")
      .select("*")
      .order("invited_at", { ascending: false });
    if (error) {
      toast.error("Error al cargar terapeutas: " + error.message);
    } else {
      setList((data ?? []) as Therapist[]);
    }
    setLoading(false);
  }

  async function fetchPatientCounts(emails: string[]) {
    if (emails.length === 0) return;
    // Map emails -> psychologist user ids via auth.users isn't accessible from client.
    // Use profiles + a small helper: rely on admin RPC? We'll skip per-user counts and
    // count by psychologist_id grouping via profiles join is not possible client-side.
    // Instead: query patients grouped by psychologist_id, then map ids to emails via profiles.
    // Profiles table doesn't expose email; auth.users not exposed. So we can only get counts
    // per psychologist_id. We map by joined_at presence: if a therapist hasn't joined we have no id link.
    // Best-effort: fetch profiles ids that have patients, plus patient counts, and skip mapping.
    // For now, leave counts empty (display 0) — counts require a server function.
    setPatientCounts({});
  }

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    fetchPatientCounts(list.map((l) => l.email));
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((t) => {
      if (statusFilter !== "todos") {
        const s = statusOf(t);
        if (statusFilter === "activos" && s !== "activo") return false;
        if (statusFilter === "pendientes" && s !== "pendiente") return false;
        if (statusFilter === "inactivos" && s !== "inactivo") return false;
      }
      if (specialtyFilter !== "todas" && t.specialty !== specialtyFilter) return false;
      if (q) {
        const hay = `${t.email} ${t.first_name ?? ""} ${t.last_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, search, statusFilter, specialtyFilter]);

  const stats = useMemo(() => {
    let total = list.length;
    let activos = 0;
    let pendientes = 0;
    let inactivos = 0;
    list.forEach((t) => {
      const s = statusOf(t);
      if (s === "activo") activos++;
      else if (s === "pendiente") pendientes++;
      else inactivos++;
    });
    return { total, activos, pendientes, inactivos };
  }, [list]);

  async function handleAdd() {
    if (!addForm.email.trim()) {
      toast.error("El email es obligatorio");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("allowed_therapists").insert({
      email: addForm.email.trim().toLowerCase(),
      first_name: addForm.first_name || null,
      last_name: addForm.last_name || null,
      specialty: addForm.specialty || null,
      institution: addForm.institution || null,
      phone: addForm.phone || null,
      notes: addForm.notes || null,
      created_by: profile?.id ?? null,
    });
    setAdding(false);
    if (error) {
      toast.error("Error al agregar: " + error.message);
      return;
    }
    toast.success("Terapeuta agregado");
    setAddOpen(false);
    setAddForm({
      email: "",
      first_name: "",
      last_name: "",
      specialty: "",
      institution: "",
      phone: "",
      notes: "",
    });
    fetchAll();
  }

  function startEdit(t: Therapist) {
    setEditingId(t.id);
    setEditForm({
      first_name: t.first_name ?? "",
      last_name: t.last_name ?? "",
      specialty: t.specialty ?? "",
      institution: t.institution ?? "",
      phone: t.phone ?? "",
      notes: t.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    const { error } = await supabase
      .from("allowed_therapists")
      .update({
        first_name: editForm.first_name || null,
        last_name: editForm.last_name || null,
        specialty: editForm.specialty || null,
        institution: editForm.institution || null,
        phone: editForm.phone || null,
        notes: editForm.notes || null,
      })
      .eq("id", id);
    if (error) {
      toast.error("Error al guardar: " + error.message);
      return;
    }
    toast.success("Cambios guardados");
    setEditingId(null);
    fetchAll();
  }

  async function toggleActive(t: Therapist) {
    const { error } = await supabase
      .from("allowed_therapists")
      .update({ is_active: !t.is_active })
      .eq("id", t.id);
    if (error) {
      toast.error("Error: " + error.message);
      return;
    }
    toast.success(t.is_active ? "Terapeuta desactivado" : "Terapeuta activado");
    fetchAll();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("allowed_therapists").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error("Error al eliminar: " + error.message);
      return;
    }
    toast.success("Terapeuta eliminado de la lista");
    setDeleteTarget(null);
    fetchAll();
  }

  async function openHistory(t: Therapist) {
    setHistoryTarget(t);
    setHistoryUserId(null);
    const { data } = await supabase.rpc("get_user_id_by_email", { _email: t.email });
    setHistoryUserId((data as string | null) ?? null);
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        toast.error("CSV vacío");
        return;
      }
      const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const iEmail = idx("email");
      if (iEmail === -1) {
        toast.error("El CSV debe tener una columna 'email'");
        return;
      }
      const iFn = idx("first_name");
      const iLn = idx("last_name");
      const iSp = idx("specialty");
      const iIn = idx("institution");
      const rows: any[] = [];
      const invalid: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const email = (cols[iEmail] ?? "").toLowerCase();
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
          invalid.push(lines[i]);
          continue;
        }
        rows.push({
          email,
          first_name: iFn >= 0 ? cols[iFn] : "",
          last_name: iLn >= 0 ? cols[iLn] : "",
          specialty: iSp >= 0 ? cols[iSp] : "",
          institution: iIn >= 0 ? cols[iIn] : "",
        });
      }
      setCsvPreview({ rows, invalid });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function importCsv() {
    if (!csvPreview || csvPreview.rows.length === 0) return;
    setImporting(true);
    const payload = csvPreview.rows.map((r) => ({
      email: r.email,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      specialty: r.specialty || null,
      institution: r.institution || null,
      created_by: profile?.id ?? null,
    }));
    // Upsert on email to avoid duplicate key errors
    const { error } = await supabase
      .from("allowed_therapists")
      .upsert(payload, { onConflict: "email" });
    setImporting(false);
    if (error) {
      toast.error("Error al importar: " + error.message);
      return;
    }
    toast.success(`${payload.length} terapeutas importados`);
    setCsvPreview(null);
    fetchAll();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terapeutas</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los psicólogos autorizados a acceder a Psicoasist.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvFile}
          />
          <Button variant="outline" onClick={() => csvInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Importar desde CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Agregar terapeuta
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total autorizados" value={stats.total} />
        <StatCard label="Activos" value={stats.activos} accent="text-green-700" />
        <StatCard label="Pendientes" value={stats.pendientes} accent="text-yellow-700" />
        <StatCard label="Inactivos" value={stats.inactivos} accent="text-red-700" />
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="pendientes">Pendientes</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
            </SelectContent>
          </Select>
          <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las especialidades</SelectItem>
              {SPECIALTIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre completo</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Especialidad</th>
                <th className="px-3 py-2 font-medium">Institución</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Invitación</th>
                <th className="px-3 py-2 font-medium">Ingreso</th>
                <th className="px-3 py-2 font-medium">Pacientes</th>
                <th className="px-3 py-2 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    No hay terapeutas que coincidan con los filtros.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((t) => {
                  const isEditing = editingId === t.id;
                  const fullName = [t.first_name, t.last_name].filter(Boolean).join(" ");
                  return (
                    <tr key={t.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Input
                              className="h-8"
                              placeholder="Nombre"
                              value={editForm.first_name ?? ""}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, first_name: e.target.value }))
                              }
                            />
                            <Input
                              className="h-8"
                              placeholder="Apellido"
                              value={editForm.last_name ?? ""}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, last_name: e.target.value }))
                              }
                            />
                          </div>
                        ) : fullName ? (
                          fullName
                        ) : (
                          <span className="text-muted-foreground italic">Sin registrar</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{t.email}</td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <Select
                            value={editForm.specialty ?? ""}
                            onValueChange={(v) =>
                              setEditForm((f) => ({ ...f, specialty: v }))
                            }
                          >
                            <SelectTrigger className="h-8 w-[180px]">
                              <SelectValue placeholder="Especialidad" />
                            </SelectTrigger>
                            <SelectContent>
                              {SPECIALTIES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          t.specialty ?? "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <Input
                            className="h-8"
                            value={editForm.institution ?? ""}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, institution: e.target.value }))
                            }
                          />
                        ) : (
                          t.institution ?? "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge t={t} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(t.invited_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t.joined_at ? fmtDate(t.joined_at) : (
                          <span className="italic">Aún no ha ingresado</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{patientCounts[t.email] ?? 0}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => saveEdit(t.id)}>
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Editar"
                                onClick={() => startEdit(t)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Transferir paciente"
                                onClick={() => setTransferTarget(t)}
                              >
                                <UserPlus className="h-4 w-4 text-primary" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Ver historial de transferencias"
                                onClick={() => openHistory(t)}
                              >
                                <History className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title={t.is_active ? "Desactivar" : "Activar"}
                                onClick={() => toggleActive(t)}
                              >
                                <Power
                                  className={`h-4 w-4 ${
                                    t.is_active ? "text-red-600" : "text-green-600"
                                  }`}
                                />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Eliminar"
                                onClick={() => setDeleteTarget(t)}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar terapeuta</DialogTitle>
            <DialogDescription>
              Ingresa el email del terapeuta a autorizar. Los demás campos son opcionales y
              pueden completarse luego.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre</Label>
                <Input
                  value={addForm.first_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Apellido</Label>
                <Input
                  value={addForm.last_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Especialidad</Label>
              <Select
                value={addForm.specialty}
                onValueChange={(v) => setAddForm((f) => ({ ...f, specialty: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una especialidad" />
                </SelectTrigger>
                <SelectContent>
                  {SPECIALTIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Institución</Label>
                <Input
                  value={addForm.institution}
                  onChange={(e) => setAddForm((f) => ({ ...f, institution: e.target.value }))}
                />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea
                value={addForm.notes}
                onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV preview modal */}
      <Dialog open={!!csvPreview} onOpenChange={(o) => !o && setCsvPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Previsualización de importación</DialogTitle>
            <DialogDescription>
              {csvPreview?.rows.length ?? 0} filas válidas
              {csvPreview?.invalid.length ? `, ${csvPreview.invalid.length} filas inválidas` : ""}.
              Columnas esperadas: <code>email, first_name, last_name, specialty, institution</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left sticky top-0">
                <tr>
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Nombre</th>
                  <th className="px-2 py-1">Apellido</th>
                  <th className="px-2 py-1">Especialidad</th>
                  <th className="px-2 py-1">Institución</th>
                </tr>
              </thead>
              <tbody>
                {csvPreview?.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1">{r.email}</td>
                    <td className="px-2 py-1">{r.first_name}</td>
                    <td className="px-2 py-1">{r.last_name}</td>
                    <td className="px-2 py-1">{r.specialty}</td>
                    <td className="px-2 py-1">{r.institution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvPreview(null)}>
              Cancelar
            </Button>
            <Button onClick={importCsv} disabled={importing || !csvPreview?.rows.length}>
              {importing ? "Importando..." : `Importar ${csvPreview?.rows.length ?? 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar terapeuta</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar a <strong>{deleteTarget?.email}</strong> de la lista de autorizados? Esto
              bloqueará su acceso futuro pero no eliminará sus datos clínicos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer dialog */}
      <TransferPatientDialog
        open={!!transferTarget}
        onOpenChange={(o) => !o && setTransferTarget(null)}
        therapist={
          transferTarget
            ? {
                id: transferTarget.id,
                email: transferTarget.email,
                first_name: transferTarget.first_name,
                last_name: transferTarget.last_name,
              }
            : undefined
        }
        onTransferred={() => setTransferTarget(null)}
      />

      {/* Transfer history */}
      <TransferHistoryPanel
        open={!!historyTarget}
        onOpenChange={(o) => !o && setHistoryTarget(null)}
        therapistUserId={historyUserId}
        therapistEmail={historyTarget?.email}
        therapistLabel={
          historyTarget
            ? [historyTarget.first_name, historyTarget.last_name]
                .filter(Boolean)
                .join(" ")
                .trim() || historyTarget.email
            : undefined
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}
