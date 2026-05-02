import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, GitMerge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  patientId: string;
  notes: string;
  table?: "patients" | "child_patients";
  onConsolidated: (newNotes: string) => void;
}

export default function ConsolidateNotesButton({
  patientId, notes, table = "patients", onConsolidated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [consolidated, setConsolidated] = useState("");
  const [saving, setSaving] = useState(false);

  const separatorCount = (notes.match(/---/g) || []).length;
  const shouldShow = notes.length > 300 || separatorCount > 2;
  const entryCount = Math.max(1, separatorCount);

  if (!shouldShow) return null;

  async function handleConsolidate() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("consolidate-notes", {
        body: { notes },
      });
      if (error) throw error;
      if (!data?.consolidated) throw new Error("Respuesta vacía");
      setConsolidated(data.consolidated);
      setOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo consolidar las notas");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!consolidated.trim()) return;
    setSaving(true);
    try {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yyyy = now.getFullYear();
      const finalNotes = `${consolidated.trim()}\n\n[Consolidado el ${dd}/${mm}/${yyyy}]`;

      const { error } = await supabase
        .from(table)
        .update({ notes: finalNotes })
        .eq("id", patientId);
      if (error) throw error;

      toast.success("✓ Notas consolidadas correctamente");
      onConsolidated(finalNotes);
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={handleConsolidate}
        className="h-7 gap-1.5 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10 text-xs"
      >
        {loading ? (
          <><Loader2 className="h-3 w-3 animate-spin" />Consolidando...</>
        ) : (
          <><GitMerge className="h-3 w-3" />✨ Consolidar notas</>
        )}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-500" />
              ✨ Notas consolidadas
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Eliminando repeticiones y reorganizando {entryCount} {entryCount === 1 ? "entrada" : "entradas"}
            </p>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5 font-semibold uppercase tracking-wide">
                Notas actuales
              </div>
              <div className="text-sm whitespace-pre-wrap p-3 rounded-md border border-border bg-muted/30 text-muted-foreground max-h-[60vh] overflow-y-auto">
                {notes}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1.5 font-semibold uppercase tracking-wide">
                Versión consolidada — editable
              </div>
              <Textarea
                value={consolidated}
                onChange={(e) => setConsolidated(e.target.value)}
                className="min-h-[60vh] text-sm border-2 border-teal-500/60 focus-visible:ring-teal-500/40"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saving || !consolidated.trim()}
              onClick={handleConfirm}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reemplazar notas con versión consolidada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
