import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, AlertCircle, Check, ChevronsUpDown, X, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@/lib/clinical";
import {
  CLINICAL_AREA_LABELS, CLINICAL_AREAS_NICE, CLINICAL_AREAS_TRANSVERSAL,
  MAX_CLINICAL_AREAS, clinicalAreaColor, clinicalAreaLabel,
  SOURCE_INSTITUTIONS, sourceIconFor, type SourceInstitutionType,
} from "@/lib/clinical-areas";
import {
  EVIDENCE_LEVELS, EVIDENCE_LEVEL_LABELS, type EvidenceLevel,
  GEOGRAPHIC_RELEVANCES, GEOGRAPHIC_RELEVANCE_LABELS, geographicIcon, type GeographicRelevance,
  impactFactorForJournal,
} from "@/lib/document-relevance";

export interface ClassifyTarget {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  document_type: DocType;
  clinical_areas: string[];
  source_institution: string | null;
  source_institution_type: string | null;
  language: string | null;
  storage_path?: string | null;
  source_url?: string | null;
}

type LangCode = "es" | "en" | "otro";
const LANG_LABELS: Record<LangCode, string> = { es: "Español", en: "Inglés", otro: "Otro" };

interface CardState {
  id: string;
  title: string;
  status: "analyzing" | "ready" | "error";
  error?: string;
  storagePath: string | null;
  sourceUrl: string | null;
  // editable values
  docType: DocType;
  year: string;
  language: LangCode | "";
  clinicalAreas: string[];
  sourceInstitution: string;
  sourceInstitutionType: SourceInstitutionType | null;
  evidenceLevel: EvidenceLevel | "";
  geographicRelevance: GeographicRelevance | "";
  // AI flags
  ai: {
    docType: boolean;
    year: boolean;
    language: boolean;
    clinicalAreas: boolean;
    sourceInstitution: boolean;
    evidenceLevel: boolean;
    geographicRelevance: boolean;
  };
}

function normalizeLang(v: unknown): LangCode | "" {
  if (typeof v !== "string") return "";
  const s = v.trim().toLowerCase();
  if (s === "es" || s.startsWith("espa")) return "es";
  if (s === "en" || s.startsWith("ing") || s.startsWith("eng")) return "en";
  if (s === "otro" || s === "other") return "otro";
  return "";
}

const CONCURRENCY = 3;

export function ClassifyPreviewDialog({
  open,
  onOpenChange,
  targets,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  targets: ClassifyTarget[];
  onSaved: () => void;
}) {
  const [cards, setCards] = useState<CardState[]>([]);
  const [saving, setSaving] = useState(false);
  const startedRef = useRef(false);
  const isSingle = targets.length === 1;

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setCards([]);
      setSaving(false);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    setCards(
      targets.map((t) => ({
        id: t.id,
        title: t.title,
        status: "analyzing",
        storagePath: t.storage_path ?? null,
        sourceUrl: t.source_url ?? null,
        docType: (t.document_type ?? "otro") as DocType,
        year: t.year ?? "",
        language: (normalizeLang(t.language) || "") as CardState["language"],
        clinicalAreas: t.clinical_areas ?? [],
        sourceInstitution: t.source_institution ?? "",
        sourceInstitutionType: (t.source_institution_type as SourceInstitutionType | null) ?? null,
        ai: { docType: false, year: false, language: false, clinicalAreas: false, sourceInstitution: false },
      })),
    );

    void runAnalysis(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function analyzeOne(t: ClassifyTarget) {
    try {
      const { data: chunkRows } = await supabase
        .from("document_chunks")
        .select("content")
        .eq("document_id", t.id)
        .order("chunk_index", { ascending: true })
        .limit(1);
      const fragment = (chunkRows?.[0]?.content ?? "").toString().slice(0, 1000);
      const text = `Title: ${t.title}\nContent fragment: ${fragment}`;

      const { data: ai, error } = await supabase.functions.invoke("extract-metadata", { body: { text } });
      if (error) throw new Error(error.message ?? "Error de IA");
      if (ai?.error) throw new Error(ai.error);

      setCards((cs) =>
        cs.map((c) => {
          if (c.id !== t.id) return c;
          const next: CardState = { ...c, status: "ready" };
          // document_type: only if missing/otro
          if ((!t.document_type || t.document_type === ("otro" as DocType)) &&
              typeof ai.document_type === "string" &&
              (DOC_TYPES as readonly string[]).includes(ai.document_type)) {
            next.docType = ai.document_type as DocType;
            next.ai.docType = true;
          }
          // year
          if (!t.year && ai.year != null && String(ai.year).trim()) {
            next.year = String(ai.year).trim();
            next.ai.year = true;
          }
          // language
          if (!t.language) {
            const lang = normalizeLang(ai.language);
            if (lang) {
              next.language = lang;
              next.ai.language = true;
            }
          }
          // clinical_areas
          if ((!t.clinical_areas || t.clinical_areas.length === 0) &&
              Array.isArray(ai.clinical_areas) && ai.clinical_areas.length > 0) {
            next.clinicalAreas = (ai.clinical_areas as string[]).slice(0, MAX_CLINICAL_AREAS);
            next.ai.clinicalAreas = true;
          }
          // source_institution
          if (!t.source_institution && typeof ai.source_institution === "string" && ai.source_institution.trim()) {
            next.sourceInstitution = ai.source_institution.trim();
            if (typeof ai.source_institution_type === "string" && ai.source_institution_type) {
              next.sourceInstitutionType = ai.source_institution_type as SourceInstitutionType;
            } else {
              // try to match a known source
              const m = SOURCE_INSTITUTIONS.find((s) => s.name.toLowerCase() === next.sourceInstitution.toLowerCase());
              next.sourceInstitutionType = (m?.type as SourceInstitutionType) ?? "otro";
            }
            next.ai.sourceInstitution = true;
          }
          return next;
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchCard(t.id, { status: "error", error: msg });
    }
  }

  async function runAnalysis(list: ClassifyTarget[]) {
    const queue = [...list];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const t = queue.shift();
        if (!t) break;
        await analyzeOne(t);
      }
    });
    await Promise.all(workers);
  }

  async function saveAll() {
    const ready = cards.filter((c) => c.status === "ready");
    if (ready.length === 0) {
      toast.info("No hay clasificaciones listas para guardar");
      return;
    }
    setSaving(true);
    let ok = 0;
    let fail = 0;
    for (const c of ready) {
      const patch: Record<string, unknown> = {
        document_type: c.docType,
        year: c.year || null,
        language: c.language || null,
        clinical_areas: c.clinicalAreas,
        source_institution: c.sourceInstitution || null,
        source_institution_type: c.sourceInstitution ? (c.sourceInstitutionType ?? "otro") : null,
      };
      const { error: upErr } = await supabase.from("documents").update(patch as any).eq("id", c.id);
      if (upErr) {
        fail++;
        continue;
      }
      const chunkPatch: Record<string, unknown> = {
        document_type: c.docType,
        clinical_areas: c.clinicalAreas,
        source_institution: c.sourceInstitution || null,
        source_institution_type: c.sourceInstitution ? (c.sourceInstitutionType ?? "otro") : null,
        language: c.language || null,
      };
      await supabase.from("document_chunks").update(chunkPatch as any).eq("document_id", c.id);
      ok++;
    }
    setSaving(false);
    if (fail === 0) {
      toast.success(`✅ ${ok} documento${ok === 1 ? "" : "s"} clasificado${ok === 1 ? "" : "s"} correctamente`);
    } else {
      toast.warning(`✅ ${ok} guardado(s) · ❌ ${fail} con error`);
    }
    onOpenChange(false);
    onSaved();
  }

  const allDone = cards.length > 0 && cards.every((c) => c.status !== "analyzing");
  const readyCount = cards.filter((c) => c.status === "ready").length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent
        className={isSingle ? "max-w-[640px] max-h-[90vh] overflow-hidden flex flex-col" : "w-[90vw] max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col"}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Auto-clasificar documento{isSingle ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        <div className={isSingle ? "flex-1 overflow-y-auto pr-1 space-y-3" : "flex-1 overflow-y-auto pr-1 space-y-3"}>
          {cards.map((c) => (
            <ClassifyCard key={c.id} card={c} onChange={(p) => patchCard(c.id, p)} />
          ))}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="bg-teal-600 hover:bg-teal-700 text-white"
            disabled={!allDone || saving || readyCount === 0}
            onClick={saveAll}
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Guardando...</>
            ) : isSingle ? (
              "Guardar"
            ) : (
              `Guardar todos (${readyCount})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AiBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 px-1.5 py-0 text-[10px] font-medium leading-4">
      <Sparkles className="h-2.5 w-2.5" /> IA
    </span>
  );
}

function FieldLabel({ text, ai }: { text: string; ai?: boolean }) {
  return (
    <Label className="text-xs flex items-center gap-1.5">
      <span>{text}</span>
      {ai && <AiBadge />}
    </Label>
  );
}

function ClassifyCard({
  card,
  onChange,
}: {
  card: CardState;
  onChange: (p: Partial<CardState>) => void;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-medium text-sm truncate flex-1 min-w-0" title={card.title}>{card.title}</div>
        <ViewDocumentLink storagePath={card.storagePath} sourceUrl={card.sourceUrl} />
      </div>

      {card.status === "analyzing" && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 animate-pulse text-primary" />
            <span>✨ Analizando...</span>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="h-7 rounded bg-muted animate-pulse" />
              <div className="h-7 rounded bg-muted animate-pulse col-span-2" />
            </div>
            <div className="h-7 rounded bg-muted animate-pulse" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-7 rounded bg-muted animate-pulse col-span-2" />
              <div className="h-7 rounded bg-muted animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {card.status === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {card.error ?? "Error al analizar"}
        </div>
      )}

      {card.status === "ready" && (
        <div className="space-y-2 pt-1">
          {/* Row 1: Tipo (1/3) | Fuente (2/3) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <FieldLabel text="Tipo de documento" ai={card.ai.docType} />
              <Select
                value={card.docType}
                onValueChange={(v) => onChange({ docType: v as DocType, ai: { ...card.ai, docType: false } })}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel text="Fuente / Institución" ai={card.ai.sourceInstitution} />
              <SourcePicker
                value={card.sourceInstitution}
                onChange={(name, type) =>
                  onChange({
                    sourceInstitution: name,
                    sourceInstitutionType: type ?? card.sourceInstitutionType,
                    ai: { ...card.ai, sourceInstitution: false },
                  })
                }
              />
            </div>
          </div>

          {/* Row 2: Áreas clínicas */}
          <div>
            <FieldLabel text="Área(s) clínica(s)" ai={card.ai.clinicalAreas} />
            <AreasPicker
              value={card.clinicalAreas}
              onChange={(areas) => onChange({ clinicalAreas: areas, ai: { ...card.ai, clinicalAreas: false } })}
            />
          </div>

          {/* Row 3: Idioma + Año */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <FieldLabel text="Idioma" ai={card.ai.language} />
              <Select
                value={card.language || undefined}
                onValueChange={(v) => onChange({ language: v as LangCode, ai: { ...card.ai, language: false } })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LANG_LABELS) as LangCode[]).map((l) => (
                    <SelectItem key={l} value={l}>{LANG_LABELS[l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel text="Año" ai={card.ai.year} />
              <Input
                value={card.year}
                onChange={(e) => onChange({ year: e.target.value, ai: { ...card.ai, year: false } })}
                className="h-8 text-sm"
                placeholder="ej. 2023"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AreasPicker({
  value, onChange,
}: { value: string[]; onChange: (areas: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  function toggle(area: string) {
    const next = new Set(selected);
    if (next.has(area)) {
      next.delete(area);
    } else {
      if (next.size >= MAX_CLINICAL_AREAS) {
        toast.error(`Máximo ${MAX_CLINICAL_AREAS} áreas clínicas`);
        return;
      }
      next.add(area);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[28px] items-center">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">Sin áreas seleccionadas</span>
        )}
        {value.map((a) => (
          <span
            key={a}
            className={`text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${clinicalAreaColor(a)}`}
          >
            {clinicalAreaLabel(a)}
            <button
              type="button"
              onClick={() => toggle(a)}
              className="hover:opacity-70"
              aria-label={`Quitar ${clinicalAreaLabel(a)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            className="h-8 text-xs justify-between w-full sm:w-auto"
          >
            <span>Agregar / quitar áreas ({value.length}/{MAX_CLINICAL_AREAS})</span>
            <ChevronsUpDown className="h-3 w-3 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar área clínica..." className="h-8" />
            <CommandList className="max-h-72">
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup heading="Categorías NICE">
                {CLINICAL_AREAS_NICE.map((a) => {
                  const isSel = selected.has(a);
                  return (
                    <CommandItem key={a} value={CLINICAL_AREA_LABELS[a]} onSelect={() => toggle(a)}>
                      <Check className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`} />
                      {CLINICAL_AREA_LABELS[a]}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandGroup heading="Categorías transversales">
                {CLINICAL_AREAS_TRANSVERSAL.map((a) => {
                  const isSel = selected.has(a);
                  return (
                    <CommandItem key={a} value={CLINICAL_AREA_LABELS[a]} onSelect={() => toggle(a)}>
                      <Check className={`mr-2 h-4 w-4 ${isSel ? "opacity-100" : "opacity-0"}`} />
                      {CLINICAL_AREA_LABELS[a]}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SourcePicker({
  value, onChange,
}: { value: string; onChange: (name: string, type?: SourceInstitutionType) => void }) {
  const [open, setOpen] = useState(false);
  const grouped = SOURCE_INSTITUTIONS.reduce<Record<string, typeof SOURCE_INSTITUTIONS>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 text-sm justify-between w-full font-normal"
        >
          <span className="truncate">
            {value ? `${sourceIconFor(value)} ${value}` : "Seleccionar fuente o escribir..."}
          </span>
          <ChevronsUpDown className="h-3 w-3 opacity-50 ml-2 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Buscar o escribir fuente..."
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.currentTarget.value ?? "").trim();
                if (v) {
                  onChange(v, "otro");
                  setOpen(false);
                }
              }
            }}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              <div className="text-xs text-muted-foreground p-2">
                Pulsa Enter para usar el texto escrito como fuente personalizada.
              </div>
            </CommandEmpty>
            {value && (
              <CommandGroup heading="Acción">
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange("", undefined); setOpen(false); }}
                >
                  <X className="mr-2 h-4 w-4" /> Quitar fuente
                </CommandItem>
              </CommandGroup>
            )}
            {Object.entries(grouped).map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((s) => (
                  <CommandItem
                    key={s.name}
                    value={s.name}
                    onSelect={() => { onChange(s.name, s.type); setOpen(false); }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${value.toLowerCase() === s.name.toLowerCase() ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="mr-1">{s.icon}</span> {s.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ViewDocumentLink({
  storagePath,
  sourceUrl,
}: {
  storagePath: string | null;
  sourceUrl: string | null;
}) {
  const [loading, setLoading] = useState(false);

  const hasAny = Boolean(storagePath || sourceUrl);

  async function handleClick(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    if (sourceUrl && !storagePath) {
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (storagePath) {
      setLoading(true);
      try {
        const { data, error } = await supabase.storage
          .from("documents")
          .createSignedUrl(storagePath, 60 * 10);
        if (error || !data?.signedUrl) {
          toast.error("No se pudo abrir el documento");
          return;
        }
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (sourceUrl) {
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
    }
  }

  if (!hasAny) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 cursor-not-allowed shrink-0">
              📄 Ver documento <ExternalLink className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>URL original no disponible</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline shrink-0"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <>
          📄 Ver documento <ExternalLink className="h-3 w-3" />
        </>
      )}
    </button>
  );
}
