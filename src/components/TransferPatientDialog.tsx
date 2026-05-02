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
import { AlertTriangle, Search, User, Pill, Calendar as CalendarIcon } from "lucide-react";
import { calcAge, timeInTherapy } from "@/lib/clinical";

type Therapist = {
  id?: string; // allowed_therapists row id (optional — only present when launched from admin list)
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  user_id?: string | null; // resolved auth.users id; preferred when known
};

type PatientLite = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
  start_date?: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  therapist?: Therapist; // when launched from admin therapist row
  patient?: PatientLite; // when launched from a patient profile
  onTransferred?: () => void;
}

function therapistName(t: Therapist) {
  const n = [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return n || t.email;
}

export default function TransferPatientDialog({
  open,
  onOpenChange,
  therapist,
  patient: initialPatient,
  onTransferred,
}: Props) {
  const { profile } = useAuth();

  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientLite | null>(initialPatient ?? null);
  const [medCount, setMedCount] = useState<number>(0);

  // Only used when therapist is NOT preselected (patient-profile flow)
  const [therapistOptions, setTherapistOptions] = useState<Therapist[]>([]);
  const [selectedTherapist, setSelectedTherapist] = useState<Therapist | null>(therapist ?? null);
  const [therapistSearch, setTherapistSearch] = useState("");

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setSelectedPatient(initialPatient ?? null);
      setSelectedTherapist(therapist ?? null);
      setNotes("");
      setPatientSearch("");
      setTherapistSearch("");
    }
  }, [open, initialPatient, therapist]);

  // Load YOUR patients to choose from (only when no patient preselected)
  useEffect(() => {
    if (!open || initialPatient) return;
    (async () => {
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, birth_date, diagnosis, start_date")
        .order("first_name");
      setPatients((data as PatientLite[]) ?? []);
    })();
  }, [open, initialPatient]);

  // Load therapist options (only when no therapist preselected) — exclude current user
  useEffect(() => {
    if (!open || therapist) return;
    (async () => {
      const { data } = await supabase
        .from("allowed_therapists")
        .select("id, email, first_name, last_name")
        .eq("is_active", true)
        .order("first_name");
      setTherapistOptions(((data as Therapist[]) ?? []));
    })();
  }, [open, therapist]);

  // Medication count for the patient summary card
  useEffect(() => {
    if (!selectedPatient) {
      setMedCount(0);
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("patient_medications")
        .select("*", { count: "exact", head: true })
        .eq("patient_id", selectedPatient.id);
      setMedCount(count ?? 0);
    })();
  }, [selectedPatient]);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients.slice(0, 30);
    return patients
      .filter((p) =>
        `${p.first_name} ${p.last_name} ${p.diagnosis ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [patients, patientSearch]);

  const filteredTherapists = useMemo(() => {
    const q = therapistSearch.trim().toLowerCase();
    const all = therapistOptions.filter((t) => {
      // Don't allow transferring to yourself
      return t.email && t.email.toLowerCase() !== "";
    });
    if (!q) return all.slice(0, 30);
    return all
      .filter((t) =>
        `${t.email} ${t.first_name ?? ""} ${t.last_name ?? ""}`.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [therapistOptions, therapistSearch]);

  async function buildSnapshot(patientId: string) {
    const [{ data: pat }, { data: meds }, { data: sessions }, { data: docs }, { data: chat }] =
      await Promise.all([
        supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
        supabase.from("patient_medications").select("*").eq("patient_id", patientId),
        supabase.from("sessions").select("*").eq("patient_id", patientId),
        supabase.from("adult_documents").select("*").eq("patient_id", patientId),
        supabase.from("patient_profile_chat").select("*").eq("patient_id", patientId),
      ]);
    return {
      patient: pat,
      medications: meds ?? [],
      sessions: sessions ?? [],
      documents: docs ?? [],
      profile_chat: chat ?? [],
      taken_at: new Date().toISOString(),
    };
  }

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
    if (!selectedPatient) {
      toast.error("Selecciona un paciente");
      return;
    }
    if (!selectedTherapist) {
      toast.error("Selecciona un terapeuta receptor");
      return;
    }
    if (!profile) return;

    setSubmitting(true);
    try {
      const recipientUserId = await resolveRecipientUserId(selectedTherapist);
      if (!recipientUserId) {
        toast.error(
          "El terapeuta receptor aún no ha creado su cuenta. Pídele que ingrese al menos una vez antes de transferirle un paciente.",
        );
        setSubmitting(false);
        return;
      }
      if (recipientUserId === profile.id) {
        toast.error("No puedes transferirte un paciente a ti mismo.");
        setSubmitting(false);
        return;
      }

      // 1) Snapshot
      const snapshot = await buildSnapshot(selectedPatient.id);
      const original = snapshot.patient as any;
      if (!original) {
        toast.error("No se pudo leer el paciente");
        setSubmitting(false);
        return;
      }

      const fromName =
        [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "tu terapeuta";
      const dateStr = new Date().toLocaleDateString("es-CL");
      const transferHeader = `Paciente transferido desde ${fromName} el ${dateStr}. Perfil al momento de la transferencia incluido a continuación.`;
      const userNote = notes.trim() ? `\n\nNotas del terapeuta emisor:\n${notes.trim()}` : "";
      const previousNotes = original.notes ? `\n\n---\n${original.notes}` : "";

      // 2) Create new independent patient row for the recipient
      const newPatientPayload: any = {
        psychologist_id: recipientUserId,
        first_name: original.first_name,
        last_name: original.last_name,
        birth_date: original.birth_date,
        sex: original.sex,
        marital_status: original.marital_status,
        occupation: original.occupation,
        start_date: original.start_date,
        diagnosis: original.diagnosis,
        notes: `${transferHeader}${userNote}${previousNotes}`,
        extended_notes: original.extended_notes,
        presenting_problem: original.presenting_problem,
        clinical_history: original.clinical_history,
        family_context: original.family_context,
        work_context: original.work_context,
        previous_treatments: original.previous_treatments,
        relevant_history: original.relevant_history,
        therapeutic_goals: original.therapeutic_goals,
        personal_resources: original.personal_resources,
        profile_builder_completed: original.profile_builder_completed,
      };

      const { data: newPatient, error: insErr } = await supabase
        .from("patients")
        .insert(newPatientPayload)
        .select("id")
        .maybeSingle();

      if (insErr || !newPatient) {
        // Most likely RLS: a non-admin can't insert with another psychologist's id
        toast.error(
          "No se pudo crear el paciente para el receptor. " + (insErr?.message ?? ""),
        );
        setSubmitting(false);
        return;
      }

      // 3) Copy medications (best-effort, non-blocking)
      const meds = (snapshot.medications as any[]) ?? [];
      if (meds.length > 0) {
        const medRows = meds.map((m) => ({
          patient_id: newPatient.id,
          psychologist_id: recipientUserId,
          name: m.name,
          dose: m.dose,
          frequency: m.frequency,
          prescribed_by: m.prescribed_by,
          start_date: m.start_date,
          end_date: m.end_date,
          is_active: m.is_active,
          notes: m.notes,
        }));
        await supabase.from("patient_medications").insert(medRows);
      }

      // 4) Record the transfer
      const { error: trErr } = await supabase.from("patient_transfers").insert({
        patient_id: selectedPatient.id,
        from_psychologist_id: profile.id,
        to_psychologist_id: recipientUserId,
        new_patient_id: newPatient.id,
        notes: notes.trim() || null,
        snapshot,
      });
      if (trErr) {
        console.error(trErr);
        toast.error("Paciente transferido, pero no se pudo registrar el historial: " + trErr.message);
      } else {
        toast.success("Paciente transferido correctamente");
      }

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
          <DialogTitle>
            {therapist
              ? `Transferir paciente a ${therapistName(therapist)}`
              : "Transferir paciente a otro terapeuta"}
          </DialogTitle>
          <DialogDescription>
            Se creará una copia independiente del paciente para el terapeuta receptor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Therapist picker (only if not preselected) */}
          {!therapist && (
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
          )}

          {/* Patient picker (only if not preselected) */}
          {!initialPatient && (
            <div>
              <Label>Paciente a transferir</Label>
              {selectedPatient ? (
                <div className="flex items-center justify-between rounded-md border p-2 mt-1">
                  <div className="text-sm">
                    <div className="font-medium">
                      {selectedPatient.first_name} {selectedPatient.last_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedPatient.diagnosis ?? "Sin diagnóstico"}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedPatient(null)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nombre o diagnóstico"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="mt-2 max-h-48 overflow-y-auto border rounded-md divide-y">
                    {filteredPatients.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No tienes pacientes que coincidan.
                      </div>
                    )}
                    {filteredPatients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left p-2 hover:bg-muted text-sm"
                        onClick={() => setSelectedPatient(p)}
                      >
                        <div className="font-medium">
                          {p.first_name} {p.last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.diagnosis ?? "Sin diagnóstico"}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Summary card */}
          {selectedPatient && (
            <Card className="p-3 bg-muted/40">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-primary" />
                <div className="font-medium text-sm">
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <div className="text-[10px] uppercase">Edad</div>
                  <div className="text-foreground">
                    {(() => {
                      const a = calcAge(selectedPatient.birth_date);
                      return a !== null ? `${a} años` : "—";
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase">Diagnóstico</div>
                  <div className="text-foreground truncate">
                    {selectedPatient.diagnosis ?? "—"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3" />
                  <div>
                    <div className="text-[10px] uppercase">Tiempo en terapia</div>
                    <div className="text-foreground">
                      {timeInTherapy(selectedPatient.start_date ?? null)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Pill className="h-3 w-3" />
                  <div>
                    <div className="text-[10px] uppercase">Medicaciones</div>
                    <div className="text-foreground">{medCount}</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

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
          <Button onClick={handleTransfer} disabled={submitting || !selectedPatient || !selectedTherapist}>
            {submitting ? "Transfiriendo..." : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
