// Parses scientific abstract text into known sections.
// Returns an object with detected section keys (lowercase) plus full_text.

export type AbstractSections = {
  background?: string;
  introduction?: string;
  objective?: string;
  methods?: string;
  results?: string;
  conclusions?: string;
  keywords?: string;
  full_text: string;
};

const SECTION_MAP: Record<string, keyof AbstractSections> = {
  background: "background",
  introduction: "introduction",
  objective: "objective",
  objectives: "objective",
  aim: "objective",
  aims: "objective",
  purpose: "objective",
  methods: "methods",
  method: "methods",
  "materials and methods": "methods",
  design: "methods",
  results: "results",
  findings: "results",
  conclusions: "conclusions",
  conclusion: "conclusions",
  discussion: "conclusions",
  keywords: "keywords",
  "key words": "keywords",
};

const HEADER_KEYS = Object.keys(SECTION_MAP).sort((a, b) => b.length - a.length);

export function parseAbstractSections(text: string): AbstractSections {
  const result: AbstractSections = { full_text: text };
  if (!text || text.length < 30) return result;

  // Match headers like "Methods:" / "METHODS." / "Background -"
  const pattern = new RegExp(
    `(^|\\n|\\.\\s+)\\s*(${HEADER_KEYS.map((h) => h.replace(/ /g, "\\s+")).join("|")})\\s*[:\\.\\-–—]\\s+`,
    "gi",
  );

  const matches: { key: keyof AbstractSections; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const headerLower = m[2].toLowerCase().replace(/\s+/g, " ");
    const key = SECTION_MAP[headerLower];
    if (!key) continue;
    matches.push({
      key,
      start: m.index + m[1].length,
      contentStart: m.index + m[0].length,
    });
  }

  if (matches.length < 2) return result;

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const end = next ? next.start : text.length;
    const content = text.slice(cur.contentStart, end).trim();
    if (content && !result[cur.key]) {
      (result as any)[cur.key] = content;
    }
  }
  return result;
}

export const SECTION_LABELS: Record<keyof AbstractSections, string> = {
  background: "Background",
  introduction: "Introduction",
  objective: "Objective",
  methods: "Methods",
  results: "Results",
  conclusions: "Conclusions",
  keywords: "Keywords",
  full_text: "Texto",
};

export const SECTION_ORDER: (keyof AbstractSections)[] = [
  "background",
  "introduction",
  "objective",
  "methods",
  "results",
  "conclusions",
  "keywords",
];
