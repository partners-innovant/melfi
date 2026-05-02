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
import { cn } from "@/lib/utils";
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

type AdultPatient = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
  start_date: string | null;
};

type ChildPatient = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  diagnosis: string | null;
  guardian_name: string | null;
};

type PatientKind = "adult" | "child";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fromTherapist: FromTherapist | null;
  allTherapists: Recipient[];
  /** Force kind to start as adult or child (used when launched from a patient profile) */
  initialKind?: PatientKind;
  /** Pre-select a specific patient and skip step 1 */
  preselectedPatientId?: string;
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
  initialKind,
  preselectedPatientId,
  onTransferred,
}: Props) {
  const [kind, setKind] = useState<PatientKind>(initialKind ?? "adult");
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [adults, setAdults] = useState<AdultPatient[]>([]);
  const [children, setChildren] = useState<ChildPatient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedAdult, setSelectedAdult] = useState<AdultPatient | null>(null);
  const [selectedChild, setSelectedChild] = useState<ChildPatient | null>(null);

  const [therapistSearch, setTherapistSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setKind(initialKind ?? "adult");
      setStep(1);
      setSelectedAdult(null);
      setSelectedChild(null);
      setSelectedRecipient(null);
      setPatientSearch("");
      setTherapistSearch("");
      setNotes("");
    }
  }, [open, fromTherapist?.id, initialKind]);

  // Load this therapist's patients (admin RPCs) — refetch when kind changes
  useEffect(() => {
    if (!open || !fromTherapist?.id) return;
    (async () => {
      setLoadingPatients(true);
      if (kind === "adult") {
        const { data, error } = await supabase.rpc("admin_list_therapist_patients", {
          _therapist_id: fromTherapist.id,
        });
        if (error) toast.error("Error al cargar pacientes: " + error.message);
        const list = ((data as AdultPatient[]) ?? []);
        setAdults(list);
        if (preselectedPatientId) {
          const pre = list.find((p) => p.id === preselectedPatientId);
          if (pre) { setSelectedAdult(pre); setStep(2); }
        }
      } else {
        const { data, error } = await supabase.rpc("admin_list_therapist_child_patients", {
          _therapist_id: fromTherapist.id,
        });
        if (error) toast.error("Error al cargar pacientes: " + error.message);
        const list = ((data as ChildPatient[]) ?? []);
        setChildren(list);
        if (preselectedPatientId) {
          const pre = list.find((p) => p.id === preselectedPatientId);
          if (pre) { setSelectedChild(pre); setStep(2); }
        }
      }
      setLoadingPatients(false);
    })();
  }, [open, fromTherapist?.id, kind, preselectedPatientId]);

  const filteredAdults = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return adults;
    return adults.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.diagnosis ?? ""}`.toLowerCase().includes(q),
    );
  }, [adults, patientSearch]);

  const filteredChildren = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return children;
    return children.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.diagnosis ?? ""} ${p.guardian_name ?? ""}`.toLowerCase().includes(q),
    );
  }, [children, patientSearch]);

  const recipients = useMemo(() => {
    const q = therapistSearch.trim().toLowerCase();
    const list = allTherapists.filter((t) => t.id !== fromTherapist?.id);
    if (!q) return list;
    return list.filter((t) =>
      `${therapistName(t)} ${t.email ?? ""}`.toLowerCase().includes(q),
    );
  }, [allTherapists, therapistSearch, fromTherapist?.id]);

  const selectedPatientId = kind === "adult" ? selectedAdult?.id : selectedChild?.id;
  const patientName = kind === "adult"
    ? (selectedAdult ? `${selectedAdult.first_name} ${selectedAdult.last_name}` : "")
    : (selectedChild ? `${selectedChild.first_name} ${selectedChild.last_name}` : "");

  async function handleConfirm() {
    if (!selectedPatientId || !selectedRecipient) return;
    setSubmitting(true);
    const { error } = kind === "adult"
      ? await supabase.rpc("admin_transfer_patient", {
          _patient_id: selectedPatientId,
          _to_therapist_id: selectedRecipient.id,
          _transfer_notes: notes.trim() || null,
        })
      : await supabase.rpc("admin_transfer_child_patient", {
          _child_patient_id: selectedPatientId,
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
            {/* Patient kind selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setKind("adult"); setSelectedChild(null); setPatientSearch(""); }}
                className={cn(
                  "rounded-md border p-3 text-sm text-left transition-colors",
                  kind === "adult" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <div className="font-medium">👤 Paciente adulto</div>
                <div className="text-xs text-muted-foreground mt-0.5">Mayores de 18</div>
              </button>
              <button
                type="button"
                onClick={() => { setKind("child"); setSelectedAdult(null); setPatientSearch(""); }}
                className={cn(
                  "rounded-md border p-3 text-sm text-left transition-colors",
                  kind === "child" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <div className="font-medium">🧒 Paciente infanto-juvenil</div>
                <div className="text-xs text-muted-foreground mt-0.5">Niños y adolescentes</div>
              </button>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={kind === "adult"
                  ? "Buscar por nombre o diagnóstico"
                  : "Buscar por nombre, diagnóstico o tutor"}
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="pl-9"
                disabled={loadingPatients}
              />
            </div>

            {loadingPatients ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Cargando pacientes...</div>
            ) : kind === "adult" ? (
              adults.length === 0 ? (
                <div className="p-8 text-center border rounded-md text-sm text-muted-foreground">
                  Este terapeuta no tiene pacientes adultos.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                  {filteredAdults.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground text-center">Sin resultados</div>
                  )}
                  {filteredAdults.map((p) => {
                    const active = selectedAdult?.id === p.id;
                    const age = calcAge(p.birth_date);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedAdult(p)}
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
              )
            ) : (
              children.length === 0 ? (
                <div className="p-8 text-center border rounded-md text-sm text-muted-foreground">
                  Este terapeuta no tiene pacientes infanto-juveniles.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                  {filteredChildren.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground text-center">Sin resultados</div>
                  )}
                  {filteredChildren.map((p) => {
                    const active = selectedChild?.id === p.id;
                    const age = calcAge(p.birth_date);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedChild(p)}
                        className={`w-full text-left p-3 text-sm hover:bg-muted transition-colors ${
                          active ? "bg-primary/10" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">
                            🧒 {p.first_name} {p.last_name}
                            {age !== null && (
                              <span className="text-xs text-muted-foreground ml-2">{age} años</span>
                            )}
                          </div>
                          {active && <Check className="h-4 w-4 text-primary" />}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.diagnosis ?? "Sin diagnóstico"}
                          {p.guardian_name && <> · Tutor: {p.guardian_name}</>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
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
        {step === 3 && selectedPatientId && selectedRecipient && (
          <div className="space-y-4">
            <Card className="p-4 bg-muted/40">
              <div className="text-xs uppercase text-muted-foreground mb-1">Resumen</div>
              <div className="text-sm">
                Transfiriendo a <strong>{kind === "child" ? "🧒 " : ""}{patientName}</strong> de{" "}
                <strong>{fromName}</strong> →{" "}
                <strong>{therapistName(selectedRecipient)}</strong>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {kind === "adult" ? "Paciente adulto" : "Paciente infanto-juvenil"}
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
                <strong>{therapistName(selectedRecipient)}</strong>
                {kind === "child" && <> (incluye tutores y medicaciones)</>}. Los cambios posteriores no
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
              <Button onClick={() => setStep(2)} disabled={!selectedPatientId}>
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
