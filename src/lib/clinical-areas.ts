// Definitive clinical areas + source institutions catalog.
// Used in upload modal, filters, citation panels, and AI auto-classification.

export const CLINICAL_AREAS_NICE = [
  "addiction",
  "alcohol_use_disorders",
  "anxiety",
  "attention_deficit_disorder",
  "autism",
  "bipolar_disorder",
  "delirium",
  "dementia",
  "depression",
  "drug_misuse",
  "eating_disorders",
  "mental_health_services",
  "personality_disorders",
  "psychosis_and_schizophrenia",
  "self_harm",
  "suicide_prevention",
] as const;

export const CLINICAL_AREAS_TRANSVERSAL = [
  "intervenciones_psicoterapias",
  "neuropsicologia_evaluacion",
  "psicologia_desarrollo",
  "salud_mental_perinatal",
  "salud_mental_laboral",
  "psicologia_salud",
  "etica_deontologia",
  "trauma_estres",
  "trastornos_disociativos",
  "disfunciones_sexuales",
  "trastornos_sueno",
  "trastornos_neurocognitivos",
  "otro",
] as const;

export const CLINICAL_AREAS = [
  ...CLINICAL_AREAS_NICE,
  ...CLINICAL_AREAS_TRANSVERSAL,
] as const;

export type ClinicalArea = (typeof CLINICAL_AREAS)[number];

export const CLINICAL_AREA_LABELS: Record<ClinicalArea, string> = {
  addiction: "Adicción",
  alcohol_use_disorders: "Trastornos por uso de alcohol",
  anxiety: "Ansiedad",
  attention_deficit_disorder: "Trastorno por déficit de atención",
  autism: "Autismo",
  bipolar_disorder: "Trastorno bipolar",
  delirium: "Delirium",
  dementia: "Demencia",
  depression: "Depresión",
  drug_misuse: "Abuso de drogas",
  eating_disorders: "Trastornos alimentarios",
  mental_health_services: "Servicios de salud mental",
  personality_disorders: "Trastornos de personalidad",
  psychosis_and_schizophrenia: "Psicosis y esquizofrenia",
  self_harm: "Autolesión",
  suicide_prevention: "Prevención del suicidio",
  intervenciones_psicoterapias: "Intervenciones y psicoterapias",
  neuropsicologia_evaluacion: "Neuropsicología y evaluación",
  psicologia_desarrollo: "Psicología del desarrollo",
  salud_mental_perinatal: "Salud mental perinatal",
  salud_mental_laboral: "Salud mental laboral",
  psicologia_salud: "Psicología de la salud",
  etica_deontologia: "Ética y deontología",
  trauma_estres: "Trauma y estrés",
  trastornos_disociativos: "Trastornos disociativos",
  disfunciones_sexuales: "Disfunciones sexuales",
  trastornos_sueno: "Trastornos del sueño",
  trastornos_neurocognitivos: "Trastornos neurocognitivos",
  otro: "Otro",
};

export const MAX_CLINICAL_AREAS = 5;

export function clinicalAreaLabel(value: string): string {
  return (CLINICAL_AREA_LABELS as Record<string, string>)[value] ?? value;
}

// ---- Source institutions ----

export type SourceInstitutionType =
  | "organizacion_internacional"
  | "asociacion_profesional"
  | "gobierno_ministerio"
  | "universidad"
  | "revista_cientifica"
  | "autor_independiente"
  | "otro";

export interface SourceOption {
  name: string;
  icon: string;
  type: SourceInstitutionType;
  group: string;
}

export const SOURCE_INSTITUTIONS: SourceOption[] = [
  // 🌐 International orgs / professional associations
  { name: "WHO/OMS", icon: "🌐", type: "organizacion_internacional", group: "Organizaciones internacionales" },
  { name: "APA (Psychological)", icon: "🌐", type: "asociacion_profesional", group: "Organizaciones internacionales" },
  { name: "APA (Psychiatric)", icon: "🌐", type: "asociacion_profesional", group: "Organizaciones internacionales" },
  { name: "NICE", icon: "🌐", type: "organizacion_internacional", group: "Organizaciones internacionales" },
  { name: "NIMH", icon: "🌐", type: "organizacion_internacional", group: "Organizaciones internacionales" },
  { name: "OPS/PAHO", icon: "🌐", type: "organizacion_internacional", group: "Organizaciones internacionales" },
  { name: "IASP", icon: "🌐", type: "asociacion_profesional", group: "Organizaciones internacionales" },
  { name: "WPA", icon: "🌐", type: "asociacion_profesional", group: "Organizaciones internacionales" },
  // 🏛️ Local professional associations
  { name: "Colegio de Psicólogos de Chile", icon: "🏛️", type: "asociacion_profesional", group: "Asociaciones profesionales" },
  { name: "SONEPSYN", icon: "🏛️", type: "asociacion_profesional", group: "Asociaciones profesionales" },
  { name: "ACTA Chile", icon: "🏛️", type: "asociacion_profesional", group: "Asociaciones profesionales" },
  { name: "CANMAT", icon: "🏛️", type: "asociacion_profesional", group: "Asociaciones profesionales" },
  // 🏥 Government / ministries
  { name: "MINSAL Chile", icon: "🏥", type: "gobierno_ministerio", group: "Gobierno y ministerios" },
  { name: "NHS Reino Unido", icon: "🏥", type: "gobierno_ministerio", group: "Gobierno y ministerios" },
  { name: "CDC EEUU", icon: "🏥", type: "gobierno_ministerio", group: "Gobierno y ministerios" },
  // 🎓 Universities
  { name: "Stanford HAI", icon: "🎓", type: "universidad", group: "Universidades" },
  { name: "Harvard Medical School", icon: "🎓", type: "universidad", group: "Universidades" },
  { name: "Universidad de Chile", icon: "🎓", type: "universidad", group: "Universidades" },
  { name: "PUC Chile", icon: "🎓", type: "universidad", group: "Universidades" },
  // 📰 Journals
  { name: "Journal of Consulting and Clinical Psychology", icon: "📰", type: "revista_cientifica", group: "Revistas científicas" },
  { name: "Lancet Psychiatry", icon: "📰", type: "revista_cientifica", group: "Revistas científicas" },
  { name: "JAMA Psychiatry", icon: "📰", type: "revista_cientifica", group: "Revistas científicas" },
  { name: "PubMed Central/NIH", icon: "📰", type: "revista_cientifica", group: "Revistas científicas" },
  { name: "Revista Chilena de Neuro-Psiquiatría", icon: "📰", type: "revista_cientifica", group: "Revistas científicas" },
];

export const SOURCE_INSTITUTION_TYPE_LABELS: Record<SourceInstitutionType, string> = {
  organizacion_internacional: "Organización internacional",
  asociacion_profesional: "Asociación profesional",
  gobierno_ministerio: "Gobierno / ministerio",
  universidad: "Universidad",
  revista_cientifica: "Revista científica",
  autor_independiente: "Autor independiente",
  otro: "Otro",
};

export function sourceIconFor(name: string | null | undefined, type?: string | null): string {
  if (!name) return "✏️";
  const match = SOURCE_INSTITUTIONS.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (match) return match.icon;
  switch (type) {
    case "organizacion_internacional": return "🌐";
    case "asociacion_profesional": return "🏛️";
    case "gobierno_ministerio": return "🏥";
    case "universidad": return "🎓";
    case "revista_cientifica": return "📰";
    default: return "✏️";
  }
}

// Tailwind color classes for each clinical area badge.
const AREA_COLORS = [
  "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-300",
  "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300",
  "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300",
  "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
  "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-300",
  "bg-pink-500/15 text-pink-700 border-pink-500/30 dark:text-pink-300",
];

export function clinicalAreaColor(area: string): string {
  let h = 0;
  for (let i = 0; i < area.length; i++) h = (h * 31 + area.charCodeAt(i)) >>> 0;
  return AREA_COLORS[h % AREA_COLORS.length];
}
