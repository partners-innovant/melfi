// Helpers for document relevance fields: evidence level, geographic relevance,
// and impact factor lookups.

export const EVIDENCE_LEVELS = [
  "meta_analisis",
  "revision_sistematica",
  "ensayo_clinico_rct",
  "estudio_cohorte",
  "guia_practica_clinica",
  "consenso_expertos",
  "reporte_caso",
  "opinion_experto",
  "otro",
] as const;
export type EvidenceLevel = typeof EVIDENCE_LEVELS[number];

export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  meta_analisis: "Meta-análisis",
  revision_sistematica: "Revisión sistemática",
  ensayo_clinico_rct: "Ensayo clínico (RCT)",
  estudio_cohorte: "Estudio de cohorte",
  guia_practica_clinica: "Guía clínica",
  consenso_expertos: "Consenso de expertos",
  reporte_caso: "Reporte de caso",
  opinion_experto: "Opinión de experto",
  otro: "Otro",
};

// Tailwind classes for badges
export function evidenceLevelBadge(level: EvidenceLevel | null | undefined): string {
  switch (level) {
    case "meta_analisis":
    case "revision_sistematica":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
    case "ensayo_clinico_rct":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
    case "guia_practica_clinica":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "estudio_cohorte":
    case "consenso_expertos":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function evidenceLevelDot(level: EvidenceLevel | null | undefined): string {
  switch (level) {
    case "meta_analisis":
    case "revision_sistematica":
      return "🟣";
    case "ensayo_clinico_rct":
      return "🔵";
    case "guia_practica_clinica":
      return "🟢";
    case "estudio_cohorte":
    case "consenso_expertos":
      return "🟡";
    default:
      return "⚪";
  }
}

export const GEOGRAPHIC_RELEVANCES = ["chile", "latinoamerica", "internacional"] as const;
export type GeographicRelevance = typeof GEOGRAPHIC_RELEVANCES[number];

export const GEOGRAPHIC_RELEVANCE_LABELS: Record<GeographicRelevance, string> = {
  chile: "Chile",
  latinoamerica: "Latinoamérica",
  internacional: "Internacional",
};

export function geographicIcon(g: GeographicRelevance | null | undefined): string {
  if (g === "chile") return "🇨🇱";
  if (g === "latinoamerica") return "🌎";
  return "🌐";
}

// Approximate impact factors for common journals (case-insensitive lookup).
const JOURNAL_IF: Record<string, number> = {
  "lancet psychiatry": 25.1,
  "jama psychiatry": 20.3,
  "world psychiatry": 40.6,
  "psychological medicine": 8.1,
  "journal of consulting and clinical psychology": 6.2,
  "journal of abnormal psychology": 5.5,
  "behaviour research and therapy": 5.4,
  "journal of anxiety disorders": 5.1,
  "depression and anxiety": 5.0,
  "cognitive behaviour therapy": 4.8,
  "clinical psychology review": 12.0,
  "psychological bulletin": 17.1,
  "annual review of clinical psychology": 18.0,
  "psychological assessment": 4.5,
  "journal of affective disorders": 5.6,
  "psychiatry research": 4.2,
  "bmc psychiatry": 4.4,
  "plos one": 3.7,
  "frontiers in psychology": 3.8,
  "frontiers in psychiatry": 4.7,
  "revista chilena de neuro-psiquiatría": 0.5,
};

export function impactFactorForJournal(journal: string | null | undefined): number | null {
  if (!journal) return null;
  const k = journal.trim().toLowerCase();
  if (!k) return null;
  if (JOURNAL_IF[k] != null) return JOURNAL_IF[k];
  // loose contains match
  for (const [name, val] of Object.entries(JOURNAL_IF)) {
    if (k.includes(name) || name.includes(k)) return val;
  }
  return null;
}
