import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Eye, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ConsolidateNotesButton from "@/components/ConsolidateNotesButton";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  table: "patients" | "child_patients";
  rowId: string;
  notes: string | null;
  onNotesUpdated: (newNotes: string) => void;
}

export default function EditableNotesCard({ table, rowId, notes, onNotesUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [value, setValue] = useState(notes ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const lastSavedRef = useRef<string>(notes ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(notes ?? "");
    lastSavedRef.current = notes ?? "";
  }, [notes, rowId]);

  useEffect(() => {
    if (!editing) return;
    if (value === lastSavedRef.current) return;
    setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const { error } = await supabase
        .from(table)
        .update({ notes: value || null })
        .eq("id", rowId);
      if (error) {
        setStatus("error");
        toast.error("No se pudo guardar las notas");
      } else {
        lastSavedRef.current = value;
        setStatus("saved");
        onNotesUpdated(value);
      }
    }, 2000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, editing, table, rowId, onNotesUpdated]);

  if (!editing && !(notes && notes.trim())) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Notas</div>
        <div className="flex items-center gap-2 flex-wrap">
          {editing && <SaveIndicator status={status} />}
          {editing && (
            <div className="flex border border-border rounded-md overflow-hidden">
              <Button
                type="button"
                variant={mode === "edit" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none gap-1.5 h-8"
                onClick={() => setMode("edit")}
              >
                <Pencil className="h-3.5 w-3.5" />Editar
              </Button>
              <Button
                type="button"
                variant={mode === "preview" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none gap-1.5 h-8"
                onClick={() => setMode("preview")}
              >
                <Eye className="h-3.5 w-3.5" />👁️ Vista previa
              </Button>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            className="h-8 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />{editing ? "Cerrar edición" : "✏️ Editar"}
          </Button>
          {table === "patients" && (
            <ConsolidateNotesButton
              patientId={rowId}
              notes={value}
              onConsolidated={(newNotes) => {
                lastSavedRef.current = newNotes;
                setValue(newNotes);
                onNotesUpdated(newNotes);
              }}
            />
          )}
        </div>
      </div>
      {editing ? (
        mode === "edit" ? (
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Escribe notas clínicas..."
            className="min-h-[200px] font-mono text-sm leading-relaxed resize-y"
          />
        ) : (
          <div className="min-h-[200px] border border-border rounded-md p-4 bg-muted/20">
            {value.trim() ? (
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{value}</ReactMarkdown>
              </article>
            ) : (
              <p className="text-sm text-muted-foreground italic">Sin contenido aún.</p>
            )}
          </div>
        )
      ) : (
        <p className="text-sm whitespace-pre-wrap">{notes}</p>
      )}
    </Card>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />💾 Guardando...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
        <Check className="h-3 w-3" />✅ Guardado
      </span>
    );
  }
  if (status === "error") return <span className="text-xs text-destructive">Error al guardar</span>;
  return null;
}
