import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { toast } from "sonner";

interface Medication {
  id: string;
  name: string;
  active_ingredient: string | null;
  laboratory: string | null;
  dose: string | null;
  therapeutic_class: string | null;
}

export default function Medications() {
  const [list, setList] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("medications" as any)
        .select("id, name, active_ingredient, laboratory, dose, therapeutic_class")
        .order("name");
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
      (m.active_ingredient ?? "").toLowerCase().includes(q),
    );
  }, [list, search]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Medicamentos</h1>
        <p className="text-muted-foreground text-sm mt-1">Buscador de vademécum clínico</p>
      </header>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o principio activo..."
          className="pl-9"
        />
      </div>

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
                  <tr key={m.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">{m.name}</td>
                    <td className="p-3 text-muted-foreground">{m.active_ingredient ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.laboratory ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.dose ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.therapeutic_class ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
