export const DOC_TYPES = [
  "articulo_cientifico",
  "guia_clinica",
  "manual_diagnostico",
  "libro_academico",
  "codigo_etico",
  "informe_consenso",
  "otro",
] as const;

export type DocType = typeof DOC_TYPES[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  articulo_cientifico: "Artículo científico",
  guia_clinica: "Guía clínica",
  manual_diagnostico: "Manual diagnóstico",
  libro_academico: "Libro académico",
  codigo_etico: "Código ético",
  informe_consenso: "Informe de consenso",
  otro: "Otro",
};

export const SEX_OPTIONS = ["hombre", "mujer", "otro"] as const;

export const MARITAL_OPTIONS = [
  "soltero/a",
  "casado/a",
  "divorciado/a",
  "viudo/a",
  "conviviente",
  "otro",
] as const;

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// ---- Infanto-Juvenil helpers ----
export const CHILD_SEX = ["niño", "niña"] as const;
export const MODALITIES = ["regular", "PIE", "diferencial"] as const;
export const REFERRAL_SOURCES = ["colegio", "padres", "médico", "otro"] as const;
export const RELATIONSHIPS = ["madre", "padre", "abuela/o", "tía/o", "otro"] as const;
export const INVOLVEMENT_LEVELS = ["alto", "medio", "bajo"] as const;
export const GOAL_STATUSES = ["pendiente", "en_progreso", "logrado"] as const;
export const GOAL_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente", en_progreso: "En progreso", logrado: "Logrado",
};
export const TASK_STATUSES = ["pendiente", "realizada", "no_realizada"] as const;
export const TASK_RESPONSIBLES = ["niño/a", "apoderado", "colegio", "psicólogo"] as const;
export const WISC_VERSIONS = ["WISC-IV", "WISC-V"] as const;
export const CONTACT_TYPES = ["llamada", "email", "reunión", "citación", "whatsapp"] as const;
export const CONTACT_WITH = ["madre", "padre", "apoderado", "profesor_jefe", "orientador", "psicólogo_colegio", "otro"] as const;

export function ageRangeColor(age: number | null): { bg: string; text: string; label: string } {
  if (age === null) return { bg: "bg-muted", text: "text-muted-foreground", label: "—" };
  if (age <= 5) return { bg: "bg-teal-500/15", text: "text-teal-700 dark:text-teal-300", label: "3-5 años" };
  if (age <= 9) return { bg: "bg-blue-500/15", text: "text-blue-700 dark:text-blue-300", label: "6-9 años" };
  if (age <= 13) return { bg: "bg-purple-500/15", text: "text-purple-700 dark:text-purple-300", label: "10-13 años" };
  return { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-300", label: "14-17 años" };
}

export function timeInTherapy(startDate: string | null | undefined): string {
  if (!startDate) return "—";
  const d = new Date(startDate);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "menos de un mes";
  if (months < 12) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `${years} ${years === 1 ? "año" : "años"}${rem > 0 ? ` y ${rem} m` : ""}`;
}
