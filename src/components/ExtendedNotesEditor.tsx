import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { FileText, Eye, Pencil, Check, Loader2, Sparkles, Plus, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { useAudioTranscriber } from "@/hooks/useAudioTranscriber";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  table: "patients" | "child_patients";
  rowId: string;
  initialValue: string | null;
  currentMainNotes?: string | null;
  onMainNotesUpdated?: (newNotes: string) => void;
}

export default function ExtendedNotesEditor({
  table, rowId, initialValue, currentMainNotes, onMainNotesUpdated,
}: Props) {
  const [value, setValue] = useState(initialValue ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const lastSavedRef = useRef<string>(initialValue ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [improving, setImproving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [originalSnapshot, setOriginalSnapshot] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [appending, setAppending] = useState(false);

  const { recording, transcribing, toggle: toggleRec } = useAudioTranscriber((text) => {
    setValue((prev) => (prev.trim() ? prev.replace(/\s+$/, "") + " " + text : text));
  });

  useEffect(() => {
    setValue(initialValue ?? "");
    lastSavedRef.current = initialValue ?? "";
  }, [initialValue, rowId]);

  useEffect(() => {
    if (value === lastSavedRef.current) return;
    setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const { error } = await supabase
        .from(table)
        .update({ extended_notes: value || null })
        .eq("id", rowId);
      if (error) {
        setStatus("error");
        toast.error("No se pudo guardar las notas extendidas");
      } else {
        lastSavedRef.current = value;
        setStatus("saved");
      }
    }, 2000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, table, rowId]);

  const charCount = value.length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const hasContent = value.trim().length > 0;

  async function handleImprove() {
    if (!hasContent || improving) return;
    setImproving(true);
    setOriginalSnapshot(value);
    try {
      const { data, error } = await supabase.functions.invoke("rewrite-clinical-note", {
        body: { notes: value },
      });
      if (error) throw error;
      if (!data?.suggestion) throw new Error("Respuesta vacía");
      setSuggestion(data.suggestion);
      setModalOpen(true);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar la redacción sugerida");
    } finally {
      setImproving(false);
    }
  }

  async function appendToProfile(textToAppend: string) {
    if (!textToAppend.trim() || appending) return;
    setAppending(true);
    try {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      const stamp = `${dd}/${mm}/${yyyy} ${hh}:${mi}`;

      const block = `\n\n----------------------------------------\n--- Nota agregada el ${stamp} ---\n${textToAppend.trim()}`;
      const newNotes = (currentMainNotes && currentMainNotes.trim())
        ? `${currentMainNotes.trim()}${block}`
        : block.trimStart();

      const { error: updErr } = await supabase
        .from(table)
        .update({ notes: newNotes, extended_notes: null })
        .eq("id", rowId);
      if (updErr) throw updErr;

      lastSavedRef.current = "";
      setValue("");
      setStatus("saved");
      setModalOpen(false);
      onMainNotesUpdated?.(newNotes);
      toast.success("✓ Nota agregada al perfil clínico");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo agregar la nota al perfil");
    } finally {
      setAppending(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Notas clínicas extendidas
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <SaveIndicator status={status} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={transcribing}
            onClick={toggleRec}
            className={cn(
              "h-8 gap-1.5",
              recording
                ? "border-red-500 text-red-600 dark:text-red-400 bg-red-500/10"
                : "border-border",
            )}
            title={recording ? "Detener grabación" : "Grabar audio (Whisper)"}
          >
            {recording ? (
              <><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /><Square className="h-3.5 w-3.5" />Detener</>
            ) : transcribing ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcribiendo...</>
            ) : (
              <><Mic className="h-3.5 w-3.5" />🎤 Grabar</>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasContent || improving}
            onClick={handleImprove}
            className="h-8 gap-1.5 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10"
          >
            {improving ? (
              <><Sparkles className="h-3.5 w-3.5 animate-pulse" />✨ Mejorando...</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" />✨ Mejorar redacción</>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasContent || appending}
            onClick={() => appendToProfile(value)}
            className="h-8 gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {appending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5" />➕ Agregar al perfil clínico</>}
          </Button>
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
              <Eye className="h-3.5 w-3.5" />Vista previa
            </Button>
          </div>
        </div>
      </div>

      {mode === "edit" ? (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Escribe notas clínicas extensas. Soporta **markdown**: encabezados, listas, *énfasis*, [enlaces](https://...), etc."
          className="min-h-[280px] font-mono text-sm leading-relaxed resize-y"
        />
      ) : (
        <div className="min-h-[280px] border border-border rounded-md p-4 bg-muted/20">
          {value.trim() ? (
            <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
              <ReactMarkdown>{value}</ReactMarkdown>
            </article>
          ) : (
            <p className="text-sm text-muted-foreground italic">Sin contenido aún.</p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-between items-center text-xs text-muted-foreground">
        <span>Soporta markdown · auto-guardado tras 2s sin escribir</span>
        <span>
          {wordCount.toLocaleString("es-CL")} {wordCount === 1 ? "palabra" : "palabras"} ·{" "}
          {charCount.toLocaleString("es-CL")} {charCount === 1 ? "carácter" : "caracteres"}
        </span>
      </div>

      <Dialog open={modalOpen} onOpenChange={(o) => !appending && setModalOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-500" />
              ✨ Redacción sugerida por IA
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Notas originales:</div>
              <div className="text-sm whitespace-pre-wrap p-3 rounded-md border border-border bg-muted/30 max-h-40 overflow-y-auto">
                {originalSnapshot}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1.5">
                Redacción sugerida — puedes editarla:
              </div>
              <Textarea
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                className="min-h-[200px] text-sm border-2 border-teal-500/60 focus-visible:ring-teal-500/40"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              disabled={appending}
              onClick={() => setModalOpen(false)}
            >
              Usar texto original
            </Button>
            <Button
              disabled={!suggestion.trim()}
              onClick={() => {
                setValue(suggestion);
                setModalOpen(false);
              }}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              Usar redacción sugerida
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />Guardando...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
        <Check className="h-3 w-3" />Guardado
      </span>
    );
  }
  if (status === "error") {
    return <span className="text-xs text-destructive">Error al guardar</span>;
  }
  return null;
}
