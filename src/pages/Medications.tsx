import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ExternalLink, Filter } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Medication {
  id: string;
  name: string;
  active_ingredient: string | null;
  laboratory: string | null;
  dose: string | null;
  therapeutic_class: string | null;
  composition: string | null;
  indications: string | null;
  contraindications: string | null;
  adverse_effects: string | null;
  interactions: string | null;
  dosage: string | null;
  precautions: string | null;
  source_url: string | null;
}

interface MedCategory {
  medication_id: string;
  family: string | null;
  subgroup: string | null;
  is_primary: boolean;
}

interface EnrichedMed extends Medication {
  categories: MedCategory[];
  primaryFamily: string | null;
  primarySubgroup: string | null;
  allFamilies: string[];
  allSubgroups: string[];
}

const CLASS_PALETTE = [
  "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
];

function familyColor(c: string): string {
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) | 0;
  return CLASS_PALETTE[Math.abs(h) % CLASS_PALETTE.length];
}

const DETAIL_FIELDS = [
  ["composition", "Composición"],
  ["indications", "Indicaciones"],
  ["contraindications", "Contraindicaciones"],
  ["adverse_effects", "Efectos adversos"],
  ["interactions", "Interacciones"],
  ["dosage", "Posología"],
  ["precautions", "Precauciones"],
] as const;

type SortKey = "name_asc" | "name_desc" | "family_sub_name" | "lab_name";

type FilterCol = "name" | "active_ingredient" | "laboratory" | "dose" | "family" | "subgroup";

export default function Medications() {
  const [list, setList] = useState<EnrichedMed[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<EnrichedMed | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("name_asc");
  const [filters, setFilters] = useState<Record<FilterCol, Set<string>>>({
    name: new Set(),
    active_ingredient: new Set(),
    laboratory: new Set(),
    dose: new Set(),
    family: new Set(),
    subgroup: new Set(),
  });

  useEffect(() => {
    (async () => {
      const [medsRes, catsRes] = await Promise.all([
        supabase
          .from("medications" as any)
          .select(
            "id, name, active_ingredient, laboratory, dose, therapeutic_class, composition, indications, contraindications, adverse_effects, interactions, dosage, precautions, source_url",
          )
          .order("name")
          .range(0, 9999),
        supabase
          .from("medication_categories" as any)
          .select("medication_id, family, subgroup, is_primary")
          .range(0, 9999),
      ]);
      if (medsRes.error) toast.error(medsRes.error.message);
      if (catsRes.error) toast.error(catsRes.error.message);

      const catsByMed = new Map<string, MedCategory[]>();
      ((catsRes.data ?? []) as unknown as MedCategory[]).forEach((c) => {
        const arr = catsByMed.get(c.medication_id) ?? [];
        arr.push(c);
        catsByMed.set(c.medication_id, arr);
      });

      const enriched: EnrichedMed[] = ((medsRes.data ?? []) as unknown as Medication[]).map((m) => {
        const cats = catsByMed.get(m.id) ?? [];
        const primary = cats.find((c) => c.is_primary) ?? cats[0];
        const families = Array.from(
          new Set(cats.map((c) => c.family).filter((x): x is string => !!x)),
        );
        const subs = Array.from(
          new Set(cats.map((c) => c.subgroup).filter((x): x is string => !!x)),
        );
        return {
          ...m,
          categories: cats,
          primaryFamily: primary?.family ?? null,
          primarySubgroup: primary?.subgroup ?? null,
          allFamilies: families,
          allSubgroups: subs,
        };
      });

      setList(enriched);
      setLoading(false);
    })();
  }, []);

  // Search-filtered list
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      (m.name ?? "").toLowerCase().includes(q) ||
      (m.active_ingredient ?? "").toLowerCase().includes(q) ||
      (m.indications ?? "").toLowerCase().includes(q),
    );
  }, [list, search]);

  // Apply column filters
  const filtered = useMemo(() => {
    return searched.filter((m) => {
      if (filters.name.size && !filters.name.has(m.name ?? "")) return false;
      if (filters.active_ingredient.size && !filters.active_ingredient.has(m.active_ingredient ?? "")) return false;
      if (filters.laboratory.size && !filters.laboratory.has(m.laboratory ?? "")) return false;
      if (filters.dose.size && !filters.dose.has(m.dose ?? "")) return false;
      if (filters.family.size) {
        const fams = m.allFamilies.length ? m.allFamilies : [""];
        if (!fams.some((f) => filters.family.has(f))) return false;
      }
      if (filters.subgroup.size) {
        const subs = m.allSubgroups.length ? m.allSubgroups : [""];
        if (!subs.some((s) => filters.subgroup.has(s))) return false;
      }
      return true;
    });
  }, [searched, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const cmp = (a: string | null, b: string | null) =>
      (a ?? "").localeCompare(b ?? "", "es", { sensitivity: "base" });
    switch (sortBy) {
      case "name_asc":
        arr.sort((a, b) => cmp(a.name, b.name));
        break;
      case "name_desc":
        arr.sort((a, b) => cmp(b.name, a.name));
        break;
      case "family_sub_name":
        arr.sort(
          (a, b) =>
            cmp(a.primaryFamily, b.primaryFamily) ||
            cmp(a.primarySubgroup, b.primarySubgroup) ||
            cmp(a.name, b.name),
        );
        break;
      case "lab_name":
        arr.sort((a, b) => cmp(a.laboratory, b.laboratory) || cmp(a.name, b.name));
        break;
    }
    return arr;
  }, [filtered, sortBy]);

  // Compute available unique values for each column filter (based on other-filter context)
  function uniqueFor(col: FilterCol): string[] {
    // Apply all filters EXCEPT current col, then collect values
    const base = searched.filter((m) => {
      const checks: [FilterCol, boolean][] = [
        ["name", !filters.name.size || filters.name.has(m.name ?? "")],
        ["active_ingredient", !filters.active_ingredient.size || filters.active_ingredient.has(m.active_ingredient ?? "")],
        ["laboratory", !filters.laboratory.size || filters.laboratory.has(m.laboratory ?? "")],
        ["dose", !filters.dose.size || filters.dose.has(m.dose ?? "")],
        [
          "family",
          !filters.family.size ||
            (m.allFamilies.length ? m.allFamilies.some((f) => filters.family.has(f)) : filters.family.has("")),
        ],
        [
          "subgroup",
          !filters.subgroup.size ||
            (m.allSubgroups.length ? m.allSubgroups.some((s) => filters.subgroup.has(s)) : filters.subgroup.has("")),
        ],
      ];
      return checks.every(([c, ok]) => c === col || ok);
    });

    const set = new Set<string>();
    base.forEach((m) => {
      if (col === "family") m.allFamilies.forEach((f) => set.add(f));
      else if (col === "subgroup") m.allSubgroups.forEach((s) => set.add(s));
      else {
        const v = (m as any)[col] as string | null;
        if (v) set.add(v);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  }

  function setFilter(col: FilterCol, next: Set<string>) {
    setFilters((prev) => {
      const updated = { ...prev, [col]: next };
      // If family filter changes, prune subgroup filter to remain consistent
      if (col === "family") {
        // recompute valid subgroups based on new family selection
        // (left as-is; uniqueFor will hide invalid ones, but keep selection — user can clear)
      }
      return updated;
    });
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Medicamentos</h1>
        <p className="text-muted-foreground text-sm mt-1">Buscador de vademécum clínico</p>
      </header>

      <div className="relative mb-2 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, principio activo o indicación..."
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {!loading && (
          <p className="text-xs text-muted-foreground">
            {sorted.length} {sorted.length === 1 ? "medicamento encontrado" : "medicamentos encontrados"}
          </p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Ordenar por</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
            <SelectTrigger className="h-8 w-[260px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Nombre (A → Z)</SelectItem>
              <SelectItem value="name_desc">Nombre (Z → A)</SelectItem>
              <SelectItem value="family_sub_name">Familia → Subgrupo → Nombre</SelectItem>
              <SelectItem value="lab_name">Laboratorio → Nombre</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <ColumnHeader label="Nombre" col="name" filters={filters} setFilter={setFilter} options={uniqueFor("name")} />
                <ColumnHeader label="Principio activo" col="active_ingredient" filters={filters} setFilter={setFilter} options={uniqueFor("active_ingredient")} />
                <ColumnHeader label="Laboratorio" col="laboratory" filters={filters} setFilter={setFilter} options={uniqueFor("laboratory")} />
                <ColumnHeader label="Dosis" col="dose" filters={filters} setFilter={setFilter} options={uniqueFor("dose")} />
                <ColumnHeader label="Familia" col="family" filters={filters} setFilter={setFilter} options={uniqueFor("family")} />
                <ColumnHeader label="Subgrupo" col="subgroup" filters={filters} setFilter={setFilter} options={uniqueFor("subgroup")} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={6} className="p-3">
                      <div className="h-5 bg-muted/40 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-muted-foreground">
                    No se encontraron medicamentos
                  </td>
                </tr>
              ) : (
                sorted.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelected(m)}
                  >
                    <td className="p-3 font-medium">{m.name}</td>
                    <td className="p-3 text-muted-foreground">{m.active_ingredient ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.laboratory ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.dose ?? "—"}</td>
                    <td className="p-3">
                      {m.primaryFamily ? (
                        <span
                          className={cn(
                            "inline-block text-[11px] px-2 py-0.5 rounded-full font-medium",
                            familyColor(m.primaryFamily),
                          )}
                        >
                          {m.primaryFamily}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{m.primarySubgroup ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {selected && <MedicationDetail m={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ColumnHeader({
  label,
  col,
  filters,
  setFilter,
  options,
}: {
  label: string;
  col: FilterCol;
  filters: Record<FilterCol, Set<string>>;
  setFilter: (c: FilterCol, next: Set<string>) => void;
  options: string[];
}) {
  const active = filters[col].size > 0;
  const [q, setQ] = useState("");
  const visible = useMemo(
    () => (q.trim() ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options),
    [q, options],
  );
  const current = filters[col];

  function toggle(val: string) {
    const next = new Set(current);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setFilter(col, next);
  }

  return (
    <th className="text-left p-3">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "p-0.5 rounded hover:bg-muted transition-colors",
                active ? "text-primary" : "text-muted-foreground/60",
              )}
              aria-label={`Filtrar ${label}`}
            >
              <Filter className="h-3 w-3" fill={active ? "currentColor" : "none"} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {visible.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">Sin opciones</p>
              ) : (
                visible.map((opt) => (
                  <label
                    key={opt}
                    className="flex items-start gap-2 text-xs p-1 rounded hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={current.has(opt)}
                      onCheckedChange={() => toggle(opt)}
                      className="mt-0.5"
                    />
                    <span className="leading-tight break-words">{opt}</span>
                  </label>
                ))
              )}
            </div>
            <div className="border-t mt-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                disabled={!active}
                onClick={() => setFilter(col, new Set())}
              >
                Limpiar filtro
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </th>
  );
}

function MedicationDetail({ m }: { m: EnrichedMed }) {
  // Group categories: family -> subgroups
  const grouped = useMemo(() => {
    const map = new Map<string, Set<string>>();
    m.categories.forEach((c) => {
      if (!c.family) return;
      const set = map.get(c.family) ?? new Set<string>();
      if (c.subgroup) set.add(c.subgroup);
      map.set(c.family, set);
    });
    return Array.from(map.entries());
  }, [m]);

  return (
    <div className="space-y-5 pt-4">
      <div className="space-y-1">
        <SheetTitle className="text-xl leading-tight">{m.name}</SheetTitle>
        {m.laboratory && (
          <p className="text-sm text-muted-foreground">{m.laboratory}</p>
        )}
      </div>

      {grouped.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Clasificación
          </h3>
          <div className="space-y-2">
            {grouped.map(([family, subs]) => (
              <div key={family} className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-block text-[11px] px-2 py-0.5 rounded-full font-medium",
                    familyColor(family),
                  )}
                >
                  {family}
                </span>
                {Array.from(subs).map((s) => (
                  <span
                    key={s}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-b py-3">
        <DetailField label="Principio activo" value={m.active_ingredient} />
        <DetailField label="Dosis" value={m.dose} />
      </div>

      <div className="space-y-4">
        {DETAIL_FIELDS.map(([key, label]) => {
          const val = m[key];
          if (!val) return null;
          return (
            <div key={key}>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                {label}
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{val}</p>
            </div>
          );
        })}
      </div>

      {m.source_url && (
        <div className="pt-2 border-t">
          <a href={m.source_url} target="_blank" rel="noreferrer">
            <Button variant="outline" className="gap-2 w-full">
              <ExternalLink className="h-4 w-4" /> Ver fuente original
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}
