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

export const SEX_OPTIONS = ["hombre", "mujer"] as const;

export const MARITAL_OPTIONS = [
  "soltero/a",
  "casado/a",
  "divorciado/a",
  "viudo/a",
  "conviviente",
] as const;

export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
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
