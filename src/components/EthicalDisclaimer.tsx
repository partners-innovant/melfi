import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const SESSION_KEY = "ethical_disclaimer_dismissed_v1";

export function DashboardEthicalDisclaimer() {
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(SESSION_KEY) === "1");
  }, []);

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-lg border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-500/10 p-4 relative">
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(SESSION_KEY, "1");
          setDismissed(true);
        }}
        aria-label="Cerrar recordatorio"
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-amber-500/10 text-amber-700 dark:text-amber-300"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
          <div className="font-semibold mb-1">⚠️ Recordatorio ético</div>
          <p>
            La información que genera Melfi — perfiles, diagnósticos, sugerencias e informes — es una
            construcción basada en lo que tú ingresas y en documentación clínica. <strong>No es el paciente.</strong>{" "}
            Siempre filtra todo con tu criterio profesional antes de aplicarlo. La herramienta te apoya, pero la
            responsabilidad clínica y ética es tuya.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthEthicalDisclaimer({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="mt-4 rounded-lg border p-4"
      style={{ backgroundColor: "#F8F6F1", color: "#1A1A1A", borderColor: "rgba(26,26,26,0.12)" }}
    >
      <p className="leading-relaxed" style={{ fontSize: 13, fontFamily: 'Georgia, "Times New Roman", serif' }}>
        Melfi amplifica tu criterio clínico y tu conocimiento, no los reemplaza. El contenido generado refleja tus
        observaciones procesadas por IA — úsalo como punto de partida, no como verdad absoluta. La responsabilidad
        profesional siempre es tuya.
      </p>
      <label className="mt-3 flex items-center gap-2 cursor-pointer" style={{ fontSize: 13, color: "#1A1A1A" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <span>Entendido</span>
      </label>
    </div>
  );
}
