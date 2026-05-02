import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Optional textarea ref to refocus + move cursor to end after improvement */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  className?: string;
}

/**
 * Small teal-outlined "✨ Mejorar" pill button. Visible only when value has >= 10 chars.
 * After improvement, shows a "↩ Deshacer" link for 5s.
 */
export function ImprovePromptButton({ value, onChange, textareaRef, disabled, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const [fading, setFading] = useState(false);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  const visible = value.trim().length >= 10;
  if (!visible && !previous) return null;

  const handleImprove = async () => {
    if (loading || !visible) return;
    const original = value;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("improve-prompt", {
        body: { text: original },
      });
      if (error) throw error;
      const improved: string = (data as any)?.improved?.trim();
      if (!improved) throw new Error("Respuesta vacía");

      setFading(true);
      window.setTimeout(() => {
        onChange(improved);
        setFading(false);
        // Move cursor to end + focus
        requestAnimationFrame(() => {
          const ta = textareaRef?.current;
          if (ta) {
            ta.focus();
            const end = improved.length;
            ta.setSelectionRange(end, end);
          }
        });
      }, 150);

      setPrevious(original);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setPrevious(null), 5000);
    } catch (e: any) {
      console.error("improve error", e);
      toast.error(e?.message || "No se pudo mejorar el prompt");
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = () => {
    if (previous == null) return;
    onChange(previous);
    setPrevious(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    requestAnimationFrame(() => {
      const ta = textareaRef?.current;
      if (ta) {
        ta.focus();
        const end = (previous ?? "").length;
        ta.setSelectionRange(end, end);
      }
    });
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 transition-opacity duration-150",
        fading ? "opacity-0" : "opacity-100",
        className,
      )}
    >
      {previous != null && !loading && (
        <button
          type="button"
          onClick={handleUndo}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title="Restaurar texto original"
        >
          <Undo2 className="h-3 w-3" /> Deshacer
        </button>
      )}
      {visible && (
        <button
          type="button"
          onClick={handleImprove}
          disabled={disabled || loading}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-teal-500/50 text-teal-700 dark:text-teal-300",
            "hover:bg-teal-500/10 disabled:opacity-50 disabled:cursor-not-allowed",
            "h-6 px-2.5 text-[12px] font-medium leading-none transition-colors",
          )}
          title="Mejorar el texto con IA"
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Mejorando...
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" /> Mejorar
            </>
          )}
        </button>
      )}
    </div>
  );
}
