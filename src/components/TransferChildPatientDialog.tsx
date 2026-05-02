import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Search, User, Pill, Users } from "lucide-react";
import { calcAge } from "@/lib/clinical";

type Therapist = {
  id?: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  user_id?: string | null;
};

type ChildPatientLite = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-select a specific child patient (used from child profile header) */
  patient?: ChildPatientLite;
  onTransferred?: () => void;
}

function therapistName(t: Therapist) {
  const n = [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return n || t.email;
}

export default function TransferChildPatientDialog({
  open,
  onOpenChange,
  patient,
  onTransferred,
}: Props) {
  const { profile } = useAuth();

  const [therapistOptions, setTherapistOptions] = useState<Therapist[]>([]);
  const [selectedTherapist, setSelectedTherapist] = useState<Therapist | null>(null);
  const [therapistSearch, setTherapistSearch] = useState("");

  const [medCount, setMedCount] = useState(0);
  const [guardianCount, setGuardianCount] = useState(0);

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedTherapist(null);
      setNotes("");
      setTherapistSearch("");
    }
  }, [open]);

  // Load therapist options
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase
        .from("allowed_therapists")
        .select("id, email, first_name, last_name")
        .eq("is_active", true)
        .order("first_name");
      setTherapistOptions((data as Therapist[]) ?? []);
    })();
  }, [open]);

  // Counts for summary
  useEffect(() => {
    if (!patient) return;
    (async () => {
      const [{ count: m }, { count: g }] = await Promise.all([
        supabase
          .from("child_patient_medications")
          .select("*", { count: "exact", head: true })
          .eq("child_patient_id", patient.id),
        supabase
          .from("guardians")
          .select("*", { count: "exact", head: true })
          .eq("child_patient_id", patient.id),
      ]);
      setMedCount(m ?? 0);
      setGuardianCount(g ?? 0);
    })();
  }, [patient]);

  const filteredTherapists = useMemo(() => {
    const q = therapistSearch.trim().toLowerCase();
    if (!q) return therapistOptions.slice(0, 30);
    return therapistOptions
      .filter((t) =>
        `${t.email} ${t.first_name ?? ""} ${t.last_name ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [therapistOptions, therapistSearch]);

  async function resolveRecipientUserId(t: Therapist): Promise<string | null> {
    if (t.user_id) return t.user_id;
    const { data, error } = await supabase.rpc("get_user_id_by_email", { _email: t.email });
    if (error) {
      console.error(error);
      return null;
    }
    return (data as string | null) ?? null;
  }

  async function handleTransfer() {
    if (!patient || !selectedTherapist || !profile) return;

    setSubmitting(true);
    try {
      const recipientUserId = await resolveRecipientUserId(selectedTherapist);
      if (!recipientUserId) {
        toast.error(
          "El terapeuta receptor aún no ha creado su cuenta. Pídele que ingrese al menos una vez antes de transferirle un paciente.",
        );
        return;
      }
      if (recipientUserId === profile.id) {
        toast.error("No puedes transferirte un paciente a ti mismo.");
        return;
      }

      // Use the admin RPC if the user is admin (handles everything atomically).
      // Non-admin therapists also have access to this RPC's logic via the same path:
      // we attempt the admin RPC first; if it fails because the user is not admin,
      // we fall back to a client-side flow mirroring the adult transfer dialog.
      const { error: rpcErr } = await supabase.rpc("admin_transfer_child_patient", {
        _child_patient_id: patient.id,
        _to_therapist_id: recipientUserId,
        _transfer_notes: notes.trim() || null,
      });

      if (rpcErr) {
        // Fallback: client-side flow (will only work if RLS allows, e.g. admin)
        const { data: orig } = await supabase
          .from("child_patients").select("*").eq("id", patient.id).maybeSingle();
        if (!orig) {
          toast.error("No se pudo leer el paciente: " + rpcErr.message);
          return;
        }

        const fromName =
          [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "tu terapeuta";
        const dateStr = new Date().toLocaleDateString("es-CL");
        const header = `--- Paciente transferido desde ${fromName} el ${dateStr} ---\n\n`;
        const userNote = notes.trim() ? `Notas del terapeuta anterior:\n${notes.trim()}\n\n` : "";
        const previousNotes = orig.notes ? `--- Perfil original ---\n\n${orig.notes}` : "";

        const { data: newChild, error: insErr } = await supabase
          .from("child_patients")
          .insert({
            psychologist_id: recipientUserId,
            first_name: orig.first_name,
            last_name: orig.last_name,
            birth_date: orig.birth_date,
            sex: orig.sex,
            school: orig.school,
            grade: orig.grade,
            homeroom_teacher: orig.homeroom_teacher,
            modality: orig.modality,
            referral_source: orig.referral_source,
            referral_reason: orig.referral_reason,
            medical_diagnosis: orig.medical_diagnosis,
            current_medication: orig.current_medication,
            specialist_name: orig.specialist_name,
            extended_notes: orig.extended_notes,
            notes: `${header}${userNote}${previousNotes}`,
          })
          .select("id")
          .maybeSingle();

        if (insErr || !newChild) {
          toast.error("No se pudo crear el paciente para el receptor. " + (insErr?.message ?? rpcErr.message));
          return;
        }

        // Copy meds & guardians (best effort)
        const { data: meds } = await supabase
          .from("child_patient_medications").select("*").eq("child_patient_id", patient.id);
        if (meds && meds.length > 0) {
          await supabase.from("child_patient_medications").insert(
            meds.map((m) => ({
              child_patient_id: newChild.id,
              psychologist_id: recipientUserId,
              name: m.name, dose: m.dose, frequency: m.frequency,
              prescribed_by: m.prescribed_by, start_date: m.start_date,
              end_date: m.end_date, is_active: m.is_active, notes: m.notes,
            })),
          );
        }
        const { data: gs } = await supabase
          .from("guardians").select("*").eq("child_patient_id", patient.id);
        if (gs && gs.length > 0) {
          await supabase.from("guardians").insert(
            gs.map((g) => ({
              child_patient_id: newChild.id,
              psychologist_id: recipientUserId,
              full_name: g.full_name, relationship: g.relationship,
              phone: g.phone, email: g.email, involvement_level: g.involvement_level,
            })),
          );
        }

        await supabase.from("patient_transfers").insert({
          patient_id: patient.id,
          from_psychologist_id: profile.id,
          to_psychologist_id: recipientUserId,
          new_patient_id: newChild.id,
          notes: notes.trim() || null,
          snapshot: { kind: "child", patient: orig, taken_at: new Date().toISOString() },
        });
      }

      toast.success("Paciente transferido correctamente");
      onOpenChange(false);
      onTransferred?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Error al transferir");
    } finally {
      setSubmitting(false);
    }
  }

  const recipientLabel = selectedTherapist ? therapistName(selectedTherapist) : "terapeuta";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferir paciente infanto-juvenil</DialogTitle>
          <DialogDescription>
            Se creará una copia independiente del paciente (incluye tutores y medicaciones) para el
            terapeuta receptor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient summary */}
          {patient && (
            <Card className="p-3 bg-muted/40">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-primary" />
                <div className="font-medium text-sm">
                  🧒 {patient.first_name} {patient.last_name}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <div className="text-[10px] uppercase">Edad</div>
                  <div className="text-foreground">
                    {(() => {
                      const a = calcAge(patient.birth_date);
                      return a !== null ? `${a} años` : "—";
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Pill className="h-3 w-3" />
                  <div>
                    <div className="text-[10px] uppercase">Medicaciones</div>
                    <div className="text-foreground">{medCount}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  <div>
                    <div className="text-[10px] uppercase">Tutores</div>
                    <div className="text-foreground">{guardianCount}</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Therapist picker */}
          <div>
            <Label>Terapeuta receptor</Label>
            {selectedTherapist ? (
              <div className="flex items-center justify-between rounded-md border p-2 mt-1">
                <div className="text-sm">
                  <div className="font-medium">{therapistName(selectedTherapist)}</div>
                  <div className="text-xs text-muted-foreground">{selectedTherapist.email}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedTherapist(null)}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre o email"
                    value={therapistSearch}
                    onChange={(e) => setTherapistSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="mt-2 max-h-40 overflow-y-auto border rounded-md divide-y">
                  {filteredTherapists.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      Sin resultados
                    </div>
                  )}
                  {filteredTherapists.map((t) => (
                    <button
                      key={t.email}
                      type="button"
                      className="w-full text-left p-2 hover:bg-muted text-sm"
                      onClick={() => setSelectedTherapist(t)}
                    >
                      <div className="font-medium">{therapistName(t)}</div>
                      <div className="text-xs text-muted-foreground">{t.email}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            <Label>Notas para el terapeuta receptor (opcional)</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contexto, motivo de la transferencia, recomendaciones..."
            />
          </div>

          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>
              ⚠️ El paciente será copiado de forma independiente al perfil de{" "}
              <strong>{recipientLabel}</strong>. Los cambios posteriores no serán compartidos
              entre terapeutas.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleTransfer} disabled={submitting || !patient || !selectedTherapist}>
            {submitting ? "Transfiriendo..." : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
