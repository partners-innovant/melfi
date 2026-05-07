// Definitive clinical areas + source institutions catalog.
// Used in upload modal, filters, citation panels, and AI auto-classification.

// Main (principales) clinical categories — evidence-based 8-category system
export const CLINICAL_AREAS_NICE = [
  "regulacion_emocional_afectivos",
  "neurodesarrollo_cognitivo",
  "identidad_personalidad_self",
  "juicio_realidad_pensamiento",
  "adaptativos_crisis_vitales",
  "alimentarios_imagen_corporal",
  "sustancias_conductas_adictivas",
  "somaticos_psicosomaticos",
] as const;

// Transversal categories
export const CLINICAL_AREAS_TRANSVERSAL = [
  "intervenciones_psicoterapias",
  "neuropsicologia_evaluacion",
  "psicologia_desarrollo",
  "salud_mental_perinatal",
  "salud_mental_laboral",
  "etica_deontologia",
  "otro",
] as const;

export const CLINICAL_AREAS = [
  ...CLINICAL_AREAS_NICE,
  ...CLINICAL_AREAS_TRANSVERSAL,
] as const;

export type ClinicalArea = (typeof CLINICAL_AREAS)[number];

export const CLINICAL_AREA_LABELS: Record<ClinicalArea, string> = {
  regulacion_emocional_afectivos: "Regulación emocional y afectivos",
  neurodesarrollo_cognitivo: "Neurodesarrollo y cognitivo",
  identidad_personalidad_self: "Identidad, personalidad y self",
  juicio_realidad_pensamiento: "Juicio de realidad y pensamiento",
  adaptativos_crisis_vitales: "Adaptativos y crisis vitales",
  alimentarios_imagen_corporal: "Alimentarios e imagen corporal",
  sustancias_conductas_adictivas: "Sustancias y conductas adictivas",
  somaticos_psicosomaticos: "Somáticos y psicosomáticos",
  intervenciones_psicoterapias: "Intervenciones y psicoterapias",
  neuropsicologia_evaluacion: "Neuropsicología y evaluación",
  psicologia_desarrollo: "Psicología del desarrollo",
  salud_mental_perinatal: "Salud mental perinatal",
  salud_mental_laboral: "Salud mental laboral",
  etica_deontologia: "Ética y deontología",
  otro: "Otro",
};

// Map old category keys → new keys (for legacy data display compatibility)
export const LEGACY_CLINICAL_AREA_MAP: Record<string, ClinicalArea> = {
  anxiety: "regulacion_emocional_afectivos",
  depression: "regulacion_emocional_afectivos",
  bipolar_disorder: "regulacion_emocional_afectivos",
  trauma_estres: "regulacion_emocional_afectivos",
  self_harm: "regulacion_emocional_afectivos",
  suicide_prevention: "regulacion_emocional_afectivos",
  attention_deficit_disorder: "neurodesarrollo_cognitivo",
  autism: "neurodesarrollo_cognitivo",
  delirium: "neurodesarrollo_cognitivo",
  dementia: "neurodesarrollo_cognitivo",
  trastornos_neurocognitivos: "neurodesarrollo_cognitivo",
  personality_disorders: "identidad_personalidad_self",
  trastornos_disociativos: "identidad_personalidad_self",
  psychosis_and_schizophrenia: "juicio_realidad_pensamiento",
  mental_health_services: "adaptativos_crisis_vitales",
  psicologia_salud: "adaptativos_crisis_vitales",
  eating_disorders: "alimentarios_imagen_corporal",
  addiction: "sustancias_conductas_adictivas",
  alcohol_use_disorders: "sustancias_conductas_adictivas",
  drug_misuse: "sustancias_conductas_adictivas",
  disfunciones_sexuales: "somaticos_psicosomaticos",
  trastornos_sueno: "somaticos_psicosomaticos",
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

// Display-only short names for well-known institutions. Database keeps the full string.
const SHORT_NAME_RULES: { test: RegExp; short: string }[] = [
  { test: /national institute for health and care excellence|\bnice\b/i, short: "NICE" },
  { test: /american psychiatric association/i, short: "APA Psychiatry" },
  { test: /american psychological association/i, short: "APA" },
  { test: /world health organization|\bwho\b|\boms\b/i, short: "WHO" },
  { test: /pan american health organization|\bpaho\b|\bops\b/i, short: "OPS/PAHO" },
  { test: /national institute of mental health|\bnimh\b/i, short: "NIMH" },
  { test: /international association for suicide prevention|\biasp\b/i, short: "IASP" },
  { test: /world psychiatric association|\bwpa\b/i, short: "WPA" },
];

export function shortInstitutionName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  for (const rule of SHORT_NAME_RULES) {
    if (rule.test.test(trimmed)) return rule.short;
  }
  return trimmed;
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
