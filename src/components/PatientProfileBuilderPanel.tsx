import { useEffect, useState } from "react";
import { X, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PatientProfileBuilderTab } from "@/components/PatientExtraTabs";

export default function PatientProfileBuilderPanel({
  patientId,
  onProfileUpdated,
}: {
  patientId: string;
  onProfileUpdated?: () => void;
}) {
  // Always default to open when navigating to a patient page.
  // The user can close it during the session, but it reopens on next visit.
  const [open, setOpen] = useState<boolean>(true);

  useEffect(() => {
    setOpen(true);
  }, [patientId]);


  return (
    <>
      {/* Floating vertical tab on right edge */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
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
      )}

      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-background/40 z-40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-screen z-50 bg-background border-l border-border shadow-2xl transition-transform duration-300 ease-out flex flex-col",
          "w-full md:w-[420px]",
          open ? "translate-x-0" : "translate-x-full pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-teal-600" />
            <span className="font-semibold text-sm">Constructor de Perfil</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {open && (
            <PatientProfileBuilderTab
              patientId={patientId}
              onProfileUpdated={onProfileUpdated}
              embedded
            />
          )}
        </div>
      </aside>
    </>
  );
}
