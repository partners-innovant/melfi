import { useEffect, useRef, useState } from "react";
import { X, Brain, Shuffle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PatientProfileBuilderTab } from "@/components/PatientExtraTabs";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Inline side panel that participates in the page flex layout (does NOT overlay).
 * The parent controls visibility via `open` and is responsible for sizing the
 * surrounding flex row. On <1200px the parent collapses to a vertical stack,
 * and the panel renders as a full-width block beneath the main content.
 */
export default function PatientProfileBuilderPanel({
  patientId,
  onProfileUpdated,
  open,
  onOpenChange,
}: {
  patientId: string;
  onProfileUpdated?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const messagesRef = useRef<Msg[]>([]);
  const [hasMessages, setHasMessages] = useState(false);

  // Re-open on patient change (preserves prior UX of opening by default).
  useEffect(() => {
    onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function summarizeAssistant(messages: Msg[]): string {
    const lastAssistants = messages.filter((m) => m.role === "assistant").slice(-3);
    if (lastAssistants.length === 0) return "discusión inicial sobre el caso";
    const cleaned = lastAssistants
      .map((m) =>
        m.content
          .replace(/```[\s\S]*?```/g, "")
          .replace(/[#*_`>]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .map((t) => (t.length > 220 ? t.slice(0, 220).trim() + "…" : t));
    return cleaned.join(" • ");
  }

  function handleContinueInAssistant() {
    const summary = summarizeAssistant(messagesRef.current);
    const message =
      `Continuando desde el Constructor de Perfil — ${summary} ` +
      `Quiero profundizar en esto con la documentación clínica disponible.`;
    const url = `/assistant?patient=${encodeURIComponent(patientId)}&q=${encodeURIComponent(
      message,
    )}&autosend=1`;
    navigate(url);
  }

  return (
    <aside
      className="h-full bg-background border-l border-border flex flex-col overflow-hidden"
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-teal-600" />
          <span className="font-semibold text-sm">Constructor de Perfil con IA</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onOpenChange(false)}
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PatientProfileBuilderTab
          patientId={patientId}
          onProfileUpdated={onProfileUpdated}
          embedded
          onMessagesChange={(msgs) => {
            messagesRef.current = msgs;
            const hasAny = msgs.some((m) => m.role === "assistant" && m.content.trim().length > 0);
            setHasMessages(hasAny);
          }}
          headerExtra={
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10"
              onClick={handleContinueInAssistant}
              disabled={!hasMessages}
              title={hasMessages ? "Continuar en Asistente IA" : "Aún no hay conversación que continuar"}
            >
              <Shuffle className="h-3 w-3" />🔀 Continuar en Asistente IA
            </Button>
          }
        />
      </div>
    </aside>
  );
}

/** Floating launcher button shown when the panel is closed. */
export function ProfileBuilderLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-teal-600 hover:bg-teal-700 text-white shadow-lg rounded-l-lg px-2 py-4 flex flex-col items-center gap-2"
      title="Constructor de Perfil"
      aria-label="Abrir Constructor de Perfil"
    >
      <Brain className="h-5 w-5" />
      <span
        className="text-[11px] font-semibold tracking-wide"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Constructor de Perfil
      </span>
    </button>
  );
}
