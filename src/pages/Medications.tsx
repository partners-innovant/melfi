import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Search, ExternalLink } from "lucide-react";
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

function therapeuticClassColor(c: string): string {
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

export default function Medications() {
  const [list, setList] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Medication | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("medications" as any)
        .select(
          "id, name, active_ingredient, laboratory, dose, therapeutic_class, composition, indications, contraindications, adverse_effects, interactions, dosage, precautions, source_url",
        )
        .order("name")
        .range(0, 9999);
      if (error) toast.error(error.message);
      setList(((data ?? []) as unknown as Medication[]));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      (m.name ?? "").toLowerCase().includes(q) ||
      (m.active_ingredient ?? "").toLowerCase().includes(q) ||
      (m.indications ?? "").toLowerCase().includes(q),
    );
  }, [list, search]);

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

      {!loading && (
        <p className="text-xs text-muted-foreground mb-4">
          {filtered.length} {filtered.length === 1 ? "medicamento encontrado" : "medicamentos encontrados"}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left p-3">Nombre</th>
                <th className="text-left p-3">Principio activo</th>
                <th className="text-left p-3">Laboratorio</th>
                <th className="text-left p-3">Dosis</th>
                <th className="text-left p-3">Clase terapéutica</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    <td colSpan={5} className="p-3">
                      <div className="h-5 bg-muted/40 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-muted-foreground">
                    No se encontraron medicamentos
                  </td>
                </tr>
              ) : (
                filtered.map((m) => (
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
                      {m.therapeutic_class ? (
                        <span
                          className={cn(
                            "inline-block text-[11px] px-2 py-0.5 rounded-full font-medium",
                            therapeuticClassColor(m.therapeutic_class),
                          )}
                        >
                          {m.therapeutic_class}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
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

function MedicationDetail({ m }: { m: Medication }) {
  return (
    <div className="space-y-5 pt-4">
      <div className="space-y-1">
        <SheetTitle className="text-xl leading-tight">{m.name}</SheetTitle>
        {m.laboratory && (
          <p className="text-sm text-muted-foreground">{m.laboratory}</p>
        )}
      </div>

      {m.therapeutic_class && (
        <div>
          <span
            className={cn(
              "inline-block text-[11px] px-2 py-0.5 rounded-full font-medium",
              therapeuticClassColor(m.therapeutic_class),
            )}
          >
            {m.therapeutic_class}
          </span>
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
