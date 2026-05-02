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
            La información que genera Psicoasist — perfiles, diagnósticos, sugerencias e informes — es una
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
    <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-100" style={{ fontSize: 12 }}>
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="leading-relaxed space-y-1.5">
          <div className="font-semibold">⚠️ Aviso importante sobre el uso de esta plataforma</div>
          <p>
            La información generada por Psicoasist es una construcción basada en los datos que tú ingresas —
            percepciones, ideas y observaciones clínicas. No representa la realidad del paciente ni debe tratarse
            como verdad absoluta.
          </p>
          <p>
            Todo el contenido generado debe pasar por tu criterio profesional antes de ser utilizado. El perfil de
            un paciente es una hipótesis de trabajo, no una certeza.
          </p>
          <p>
            Psicoasist es una herramienta de apoyo clínico — la responsabilidad profesional y ética siempre es tuya.
          </p>
        </div>
      </div>
      <label className="mt-3 flex items-start gap-2 cursor-pointer text-amber-900 dark:text-amber-100" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
        />
        <span>
          Entiendo que la información generada es una construcción y debe pasar por mi criterio profesional.
        </span>
      </label>
    </div>
  );
}
