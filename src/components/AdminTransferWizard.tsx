import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Search, Users, Check } from "lucide-react";
import { calcAge, timeInTherapy } from "@/lib/clinical";

type FromTherapist = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

type Recipient = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  patient_count: number;
};

type Patient = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
  start_date: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fromTherapist: FromTherapist | null;
  allTherapists: Recipient[];
  onTransferred?: () => void;
}

function therapistName(t: { first_name: string | null; last_name: string | null; email: string | null }) {
  const n = [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return n || t.email || "Sin nombre";
}

export default function AdminTransferWizard({
  open,
  onOpenChange,
  fromTherapist,
  allTherapists,
  onTransferred,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [therapistSearch, setTherapistSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedPatient(null);
      setSelectedRecipient(null);
      setPatientSearch("");
      setTherapistSearch("");
      setNotes("");
    }
  }, [open, fromTherapist?.id]);

  // Load this therapist's patients (admin RPC)
  useEffect(() => {
    if (!open || !fromTherapist?.id) return;
    (async () => {
      setLoadingPatients(true);
      const { data, error } = await supabase.rpc("admin_list_therapist_patients", {
        _therapist_id: fromTherapist.id,
      });
      if (error) toast.error("Error al cargar pacientes: " + error.message);
      setPatients(((data as Patient[]) ?? []));
      setLoadingPatients(false);
    })();
  }, [open, fromTherapist?.id]);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.diagnosis ?? ""}`.toLowerCase().includes(q),
    );
  }, [patients, patientSearch]);

  const recipients = useMemo(() => {
    const q = therapistSearch.trim().toLowerCase();
    const list = allTherapists.filter((t) => t.id !== fromTherapist?.id);
    if (!q) return list;
    return list.filter((t) =>
      `${therapistName(t)} ${t.email ?? ""}`.toLowerCase().includes(q),
    );
  }, [allTherapists, therapistSearch, fromTherapist?.id]);

  async function handleConfirm() {
    if (!selectedPatient || !selectedRecipient) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("admin_transfer_patient", {
      _patient_id: selectedPatient.id,
      _to_therapist_id: selectedRecipient.id,
      _transfer_notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Error al transferir: " + error.message);
      return;
    }
    toast.success(`✅ Paciente transferido correctamente a ${therapistName(selectedRecipient)}`);
    onOpenChange(false);
    onTransferred?.();
  }

  if (!fromTherapist) return null;

  const fromName = therapistName(fromTherapist);
  const patientName = selectedPatient
    ? `${selectedPatient.first_name} ${selectedPatient.last_name}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && `Transferir paciente de ${fromName}`}
            {step === 2 && `¿A qué terapeuta transferirás a ${patientName}?`}
            {step === 3 && "Confirmar transferencia"}
          </DialogTitle>
          <DialogDescription>
            Paso {step} de 3
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — pick patient */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o diagnóstico"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="pl-9"
                disabled={loadingPatients || patients.length === 0}
              />
            </div>

            {loadingPatients ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Cargando pacientes...</div>
            ) : patients.length === 0 ? (
              <div className="p-8 text-center border rounded-md text-sm text-muted-foreground">
                Este terapeuta no tiene pacientes activos.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                {filteredPatients.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground text-center">Sin resultados</div>
                )}
                {filteredPatients.map((p) => {
                  const active = selectedPatient?.id === p.id;
                  const age = calcAge(p.birth_date);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPatient(p)}
                      className={`w-full text-left p-3 text-sm hover:bg-muted transition-colors ${
                        active ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">
                          {p.first_name} {p.last_name}
                          {age !== null && (
                            <span className="text-xs text-muted-foreground ml-2">{age} años</span>
                          )}
                        </div>
                        {active && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.diagnosis ?? "Sin diagnóstico"} · En terapia: {timeInTherapy(p.start_date)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 2 — pick recipient */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar terapeuta receptor"
                value={therapistSearch}
                onChange={(e) => setTherapistSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {recipients.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground border rounded-md">
                  No hay otros terapeutas disponibles.
                </div>
              )}
              {recipients.map((t) => {
                const active = selectedRecipient?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedRecipient(t)}
                    className={`w-full text-left p-3 rounded-md border transition-colors hover:bg-muted ${
                      active ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{therapistName(t)}</div>
                        <div className="text-xs text-muted-foreground">{t.email ?? "—"}</div>
                      </div>
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {t.patient_count}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3 — confirm */}
        {step === 3 && selectedPatient && selectedRecipient && (
          <div className="space-y-4">
            <Card className="p-4 bg-muted/40">
              <div className="text-xs uppercase text-muted-foreground mb-1">Resumen</div>
              <div className="text-sm">
                Transfiriendo a <strong>{patientName}</strong> de{" "}
                <strong>{fromName}</strong> →{" "}
                <strong>{therapistName(selectedRecipient)}</strong>
              </div>
            </Card>

            <div>
              <Label>Notas para el terapeuta receptor (opcional)</Label>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Contexto del caso, motivo de transferencia, recomendaciones..."
              />
            </div>

            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>
                ⚠️ Se creará una copia independiente del paciente para{" "}
                <strong>{therapistName(selectedRecipient)}</strong>. Los cambios posteriores no
                serán compartidos.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setStep(2)} disabled={!selectedPatient}>
                Siguiente <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Atrás
              </Button>
              <Button onClick={() => setStep(3)} disabled={!selectedRecipient}>
                Siguiente <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                ← Atrás
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={submitting}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {submitting ? "Transfiriendo..." : "Confirmar transferencia"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
