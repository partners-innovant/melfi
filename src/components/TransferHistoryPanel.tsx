import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

type TransferRow = {
  id: string;
  patient_id: string | null;
  from_psychologist_id: string | null;
  to_psychologist_id: string | null;
  transferred_at: string;
  notes: string | null;
  snapshot: any;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** auth.users id of the therapist whose history we want, if known. */
  therapistUserId?: string | null;
  therapistEmail?: string;
  therapistLabel?: string;
}

export default function TransferHistoryPanel({
  open,
  onOpenChange,
  therapistUserId,
  therapistLabel,
}: Props) {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      let query = supabase
        .from("patient_transfers")
        .select("*")
        .order("transferred_at", { ascending: false });

      if (therapistUserId) {
        query = query.or(
          `from_psychologist_id.eq.${therapistUserId},to_psychologist_id.eq.${therapistUserId}`,
        );
      }

      const { data, error } = await query;
      if (!error) setRows((data as TransferRow[]) ?? []);
      setLoading(false);
    })();
  }, [open, therapistUserId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Historial de transferencias</SheetTitle>
          <SheetDescription>
            {therapistLabel ? `Transferencias de ${therapistLabel}` : "Todas las transferencias"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {loading && (
            <div className="text-sm text-muted-foreground text-center py-6">Cargando...</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Sin transferencias registradas.
            </div>
          )}
          {!loading &&
            rows.map((r) => {
              const isSent = therapistUserId && r.from_psychologist_id === therapistUserId;
              const direction = isSent ? "sent" : "received";
              const patientName =
                r.snapshot?.patient
                  ? `${r.snapshot.patient.first_name ?? ""} ${
                      r.snapshot.patient.last_name ?? ""
                    }`.trim()
                  : "Paciente";
              return (
                <div key={r.id} className="rounded-lg border p-3 text-sm space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {direction === "sent" ? (
                        <Badge variant="outline" className="gap-1">
                          <ArrowUpRight className="h-3 w-3" /> Enviada
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <ArrowDownLeft className="h-3 w-3" /> Recibida
                        </Badge>
                      )}
                      <span className="font-medium">{patientName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.transferred_at).toLocaleDateString("es-CL")}
                    </span>
                  </div>
                  {r.notes && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {r.notes}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
