import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RutInput } from "@/components/RutInput";
import { validateRUT } from "@/lib/rut";
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
import { Pencil, Plus, Power, Search, Trash2, Upload, X, Save, UserPlus, History, Mail } from "lucide-react";
import { Navigate } from "react-router-dom";
import AdminTransferWizard from "@/components/AdminTransferWizard";
import TransferHistoryPanel from "@/components/TransferHistoryPanel";

type RegisteredTherapist = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  rut: string | null;
  phone: string | null;
  is_admin: boolean;
  created_at: string;
  patient_count: number;
  // Local UI flag — admins can deactivate by toggling allowed_therapists.is_active
  whitelist_active?: boolean;
};

type WhitelistEntry = {
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

function fmtDate(v: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("es-CL");
  } catch {
    return v;
  }
}

function fullNameOf(t: { first_name: string | null; last_name: string | null }) {
  return [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
}

export default function AdminTherapists() {
  const { profile } = useAuth();

  const [registered, setRegistered] = useState<RegisteredTherapist[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"todos" | "admin" | "terapeuta">("todos");

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

  // Edit (registered profile)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    first_name: string;
    last_name: string;
    phone: string;
    rut: string;
  }>({ first_name: "", last_name: "", phone: "", rut: "" });

  // Delete (whitelist only)
  const [deleteTarget, setDeleteTarget] = useState<WhitelistEntry | null>(null);

  // Transfer
  const [transferTarget, setTransferTarget] = useState<RegisteredTherapist | null>(null);

  // History
  const [historyTarget, setHistoryTarget] = useState<RegisteredTherapist | null>(null);

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
    const [{ data: reg, error: regErr }, { data: wl, error: wlErr }] = await Promise.all([
      supabase.rpc("admin_list_therapists"),
      supabase.from("allowed_therapists").select("*").order("invited_at", { ascending: false }),
    ]);
    if (regErr) toast.error("Error al cargar terapeutas: " + regErr.message);
    if (wlErr) toast.error("Error al cargar lista de acceso: " + wlErr.message);

    const wlList = (wl ?? []) as WhitelistEntry[];
    const wlByEmail = new Map(wlList.map((w) => [w.email.toLowerCase(), w]));
    const regList = ((reg ?? []) as RegisteredTherapist[]).map((r) => ({
      ...r,
      whitelist_active: r.email
        ? (wlByEmail.get(r.email.toLowerCase())?.is_active ?? true)
        : true,
    }));

    setRegistered(regList);
    setWhitelist(wlList);
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
  }, []);

  // Section 2: pending = whitelist entries whose email is NOT in registered profiles
  const pending = useMemo(() => {
    const regEmails = new Set(
      registered.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean),
    );
    return whitelist.filter((w) => !regEmails.has(w.email.toLowerCase()));
  }, [registered, whitelist]);

  // Filtering for registered
  const filteredRegistered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registered.filter((r) => {
      if (roleFilter === "admin" && !r.is_admin) return false;
      if (roleFilter === "terapeuta" && r.is_admin) return false;
      if (q) {
        const hay = `${r.email ?? ""} ${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [registered, search, roleFilter]);

  const stats = useMemo(() => {
    const total = registered.length;
    const admins = registered.filter((r) => r.is_admin).length;
    const pendientes = pending.length;
    const totalPatients = registered.reduce((acc, r) => acc + (r.patient_count ?? 0), 0);
    return { total, admins, pendientes, totalPatients };
  }, [registered, pending]);

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
    toast.success("Terapeuta agregado a la lista de acceso");
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

  function startEdit(r: RegisteredTherapist) {
    setEditingId(r.id);
    setEditForm({
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      phone: r.phone ?? "",
      rut: r.rut ?? "",
    });
  }

  async function saveEdit(id: string) {
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: editForm.first_name || "",
        last_name: editForm.last_name || "",
        phone: editForm.phone || null,
        rut: editForm.rut || null,
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

  async function toggleRegisteredActive(r: RegisteredTherapist) {
    if (!r.email) {
      toast.error("Este perfil no tiene email vinculado");
      return;
    }
    const newActive = !r.whitelist_active;
    // Upsert whitelist entry to reflect status (admin-only RLS already enforced)
    const { error } = await supabase
      .from("allowed_therapists")
      .upsert(
        {
          email: r.email.toLowerCase(),
          first_name: r.first_name,
          last_name: r.last_name,
          phone: r.phone,
          is_active: newActive,
          created_by: profile?.id ?? null,
        },
        { onConflict: "email" },
      );
    if (error) {
      toast.error("Error: " + error.message);
      return;
    }
    toast.success(newActive ? "Terapeuta activado" : "Terapeuta desactivado");
    fetchAll();
  }

  async function toggleWhitelistActive(w: WhitelistEntry) {
    const { error } = await supabase
      .from("allowed_therapists")
      .update({ is_active: !w.is_active })
      .eq("id", w.id);
    if (error) {
      toast.error("Error: " + error.message);
      return;
    }
    fetchAll();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("allowed_therapists").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error("Error al eliminar: " + error.message);
      return;
    }
    toast.success("Eliminado de la lista de acceso");
    setDeleteTarget(null);
    fetchAll();
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
            Psicólogos registrados y lista de acceso a Psicoasist.
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
            <Plus className="h-4 w-4 mr-2" /> Agregar a lista de acceso
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Terapeutas registrados" value={stats.total} />
        <StatCard label="Admins" value={stats.admins} accent="text-teal-700" />
        <StatCard label="Pendientes de registro" value={stats.pendientes} accent="text-yellow-700" />
        <StatCard label="Pacientes en plataforma" value={stats.totalPatients} />
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
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los roles</SelectItem>
              <SelectItem value="admin">Solo admins</SelectItem>
              <SelectItem value="terapeuta">Solo terapeutas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Section 1: Registered therapists */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Terapeutas registrados</h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">RUT</th>
                  <th className="px-3 py-2 font-medium">Teléfono</th>
                  <th className="px-3 py-2 font-medium">Rol</th>
                  <th className="px-3 py-2 font-medium">Registrado</th>
                  <th className="px-3 py-2 font-medium text-center">Pacientes</th>
                  <th className="px-3 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      Cargando...
                    </td>
                  </tr>
                )}
                {!loading && filteredRegistered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      No hay terapeutas registrados.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filteredRegistered.map((r) => {
                    const isEditing = editingId === r.id;
                    const fullName = fullNameOf(r);
                    return (
                      <tr key={r.id} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <div className="flex gap-1">
                              <Input
                                className="h-8"
                                placeholder="Nombre"
                                value={editForm.first_name}
                                onChange={(e) =>
                                  setEditForm((f) => ({ ...f, first_name: e.target.value }))
                                }
                              />
                              <Input
                                className="h-8"
                                placeholder="Apellido"
                                value={editForm.last_name}
                                onChange={(e) =>
                                  setEditForm((f) => ({ ...f, last_name: e.target.value }))
                                }
                              />
                            </div>
                          ) : (
                            fullName || (
                              <span className="text-muted-foreground italic">Sin nombre</span>
                            )
                          )}
                        </td>
                        <td className="px-3 py-2">{r.email ?? "—"}</td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <Input
                              className="h-8"
                              value={editForm.rut}
                              onChange={(e) => setEditForm((f) => ({ ...f, rut: e.target.value }))}
                            />
                          ) : (
                            r.rut ?? "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <Input
                              className="h-8"
                              value={editForm.phone}
                              onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                            />
                          ) : (
                            r.phone ?? "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.is_admin ? (
                            <Badge className="bg-teal-100 text-teal-800 hover:bg-teal-100">
                              Admin
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Terapeuta</Badge>
                          )}
                          {!r.whitelist_active && (
                            <Badge className="ml-1 bg-red-100 text-red-800 hover:bg-red-100">
                              Inactivo
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.created_at)}</td>
                        <td className="px-3 py-2 text-center font-medium">{r.patient_count}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            {isEditing ? (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => saveEdit(r.id)}>
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
                                  onClick={() => startEdit(r)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Transferir paciente"
                                  onClick={() => setTransferTarget(r)}
                                >
                                  <UserPlus className="h-4 w-4 text-primary" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Ver historial de transferencias"
                                  onClick={() => setHistoryTarget(r)}
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title={r.whitelist_active ? "Desactivar" : "Activar"}
                                  onClick={() => toggleRegisteredActive(r)}
                                >
                                  <Power
                                    className={`h-4 w-4 ${
                                      r.whitelist_active ? "text-red-600" : "text-green-600"
                                    }`}
                                  />
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
      </section>

      {/* Section 2: Whitelist (pending registration) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Lista de acceso (pendientes de registro)
        </h2>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Especialidad</th>
                  <th className="px-3 py-2 font-medium">Institución</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Invitado</th>
                  <th className="px-3 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      Cargando...
                    </td>
                  </tr>
                )}
                {!loading && pending.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No hay invitaciones pendientes.
                    </td>
                  </tr>
                )}
                {!loading &&
                  pending.map((w) => (
                    <tr key={w.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">{w.email}</td>
                      <td className="px-3 py-2">
                        {fullNameOf(w) || (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{w.specialty ?? "—"}</td>
                      <td className="px-3 py-2">{w.institution ?? "—"}</td>
                      <td className="px-3 py-2">
                        {w.is_active ? (
                          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                            ⏳ Pendiente de registro
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
                            Inactivo
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtDate(w.invited_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title={w.is_active ? "Desactivar" : "Activar"}
                            onClick={() => toggleWhitelistActive(w)}
                          >
                            <Power
                              className={`h-4 w-4 ${
                                w.is_active ? "text-red-600" : "text-green-600"
                              }`}
                            />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Eliminar"
                            onClick={() => setDeleteTarget(w)}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar a la lista de acceso</DialogTitle>
            <DialogDescription>
              Autoriza un email para que pueda registrarse en Psicoasist. El terapeuta aparecerá
              en "Pendientes" hasta que cree su cuenta.
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

      {/* Delete confirm (whitelist only) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar de la lista de acceso</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar a <strong>{deleteTarget?.email}</strong> de la lista de autorizados? Esto
              bloqueará su acceso futuro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transfer wizard (admin) */}
      <AdminTransferWizard
        open={!!transferTarget}
        onOpenChange={(o) => !o && setTransferTarget(null)}
        fromTherapist={
          transferTarget
            ? {
                id: transferTarget.id,
                email: transferTarget.email,
                first_name: transferTarget.first_name,
                last_name: transferTarget.last_name,
              }
            : null
        }
        allTherapists={registered.map((r) => ({
          id: r.id,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          patient_count: r.patient_count,
        }))}
        onTransferred={() => {
          setTransferTarget(null);
          fetchAll();
        }}
      />

      {/* Transfer history */}
      <TransferHistoryPanel
        open={!!historyTarget}
        onOpenChange={(o) => !o && setHistoryTarget(null)}
        therapistUserId={historyTarget?.id ?? null}
        therapistEmail={historyTarget?.email ?? undefined}
        therapistLabel={
          historyTarget
            ? fullNameOf(historyTarget) || historyTarget.email || undefined
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
