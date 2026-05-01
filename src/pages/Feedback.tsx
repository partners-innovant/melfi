import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown } from "lucide-react";

type FType = "sugerencia" | "desarrollo" | "error";
type FStatus = "nuevo" | "en_revision" | "en_desarrollo" | "resuelto";

interface FeedbackRow {
  id: string;
  psychologist_id: string;
  type: FType;
  title: string;
  description: string;
  status: FStatus;
  created_at: string;
  author?: { first_name: string; last_name: string } | null;
}

interface ResponseFeedbackRow {
  id: string;
  psychologist_id: string;
  consultation_id: string | null;
  question: string;
  answer: string;
  rating: "util" | "no_util";
  comment: string | null;
  created_at: string;
  author?: { first_name: string; last_name: string } | null;
}

const TYPE_META: Record<FType, { label: string; cls: string }> = {
  sugerencia: { label: "Sugerencia", cls: "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300" },
  desarrollo: { label: "Desarrollo", cls: "bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300" },
  error: { label: "Error", cls: "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300" },
};

const STATUS_META: Record<FStatus, { label: string; cls: string }> = {
  nuevo: { label: "Nuevo", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  en_revision: { label: "En revisión", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  en_desarrollo: { label: "En desarrollo", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  resuelto: { label: "Resuelto", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

async function attachAuthors<T extends { psychologist_id: string }>(rows: T[]): Promise<(T & { author: { first_name: string; last_name: string } | null })[]> {
  const ids = Array.from(new Set(rows.map((r) => r.psychologist_id)));
  if (ids.length === 0) return rows.map((r) => ({ ...r, author: null }));
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", ids);
  const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => ({ ...r, author: profMap.get(r.psychologist_id) ?? null }));
}

export default function FeedbackPage() {
  const { profile, loading } = useAuth();

  if (loading) return <div className="p-10 text-center text-muted-foreground">Cargando...</div>;
  if (!profile?.is_admin) return <Navigate to="/" replace />;

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground mt-1">Sugerencias, solicitudes y reportes de los usuarios</p>
      </header>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="responses">Feedback a respuestas IA</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4">
          <GeneralTab />
        </TabsContent>
        <TabsContent value="responses" className="mt-4">
          <ResponsesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selected, setSelected] = useState<FeedbackRow | null>(null);

  async function load() {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoadingRows(false);
      return;
    }
    const enriched = await attachAuthors((data ?? []) as any[]);
    setRows(enriched as FeedbackRow[]);
    setLoadingRows(false);
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: FStatus) {
    const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Estado actualizado");
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    setSelected((s) => (s && s.id === id ? { ...s, status } : s));
  }

  return (
    <>
      <Card className="overflow-hidden">
        {loadingRows ? (
          <div className="p-10 text-center text-muted-foreground">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">Aún no hay feedback.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Fecha</th>
                  <th className="text-left font-medium px-4 py-2.5">Usuario</th>
                  <th className="text-left font-medium px-4 py-2.5">Tipo</th>
                  <th className="text-left font-medium px-4 py-2.5">Título</th>
                  <th className="text-left font-medium px-4 py-2.5">Estado</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString("es-CL")}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.author ? `${r.author.first_name} ${r.author.last_name}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={cn("font-medium", TYPE_META[r.type].cls)} variant="secondary">
                        {TYPE_META[r.type].label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 max-w-md truncate">{r.title}</td>
                    <td className="px-4 py-2.5">
                      <Badge className={cn("font-medium", STATUS_META[r.status].cls)} variant="secondary">
                        {STATUS_META[r.status].label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(r)}>
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge className={cn("font-medium", TYPE_META[selected.type].cls)} variant="secondary">
                    {TYPE_META[selected.type].label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(selected.created_at).toLocaleString("es-CL")}
                  </span>
                </div>
                {selected.author && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">De: </span>
                    {selected.author.first_name} {selected.author.last_name}
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                    Descripción
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{selected.description}</p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                    Estado
                  </div>
                  <Select
                    value={selected.status}
                    onValueChange={(v) => updateStatus(selected.id, v as FStatus)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nuevo">Nuevo</SelectItem>
                      <SelectItem value="en_revision">En revisión</SelectItem>
                      <SelectItem value="en_desarrollo">En desarrollo</SelectItem>
                      <SelectItem value="resuelto">Resuelto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ResponsesTab() {
  const [rows, setRows] = useState<ResponseFeedbackRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [filter, setFilter] = useState<"todos" | "util" | "no_util">("todos");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from("response_feedback")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoadingRows(false);
      return;
    }
    const enriched = await attachAuthors((data ?? []) as any[]);
    setRows(enriched as ResponseFeedbackRow[]);
    setLoadingRows(false);
  }

  useEffect(() => { load(); }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = rows.filter((r) => filter === "todos" || r.rating === filter);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
        <div className="text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "respuesta" : "respuestas"}
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="util">👍 Útil</SelectItem>
            <SelectItem value="no_util">👎 No útil</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loadingRows ? (
        <div className="p-10 text-center text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground">Aún no hay feedback de respuestas.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-2.5"></th>
                <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Fecha</th>
                <th className="text-left font-medium px-4 py-2.5">Psicólogo</th>
                <th className="text-left font-medium px-4 py-2.5">Rating</th>
                <th className="text-left font-medium px-4 py-2.5">Pregunta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => {
                const isOpen = expanded.has(r.id);
                return (
                  <>
                    <tr
                      key={r.id}
                      className="hover:bg-secondary/30 cursor-pointer"
                      onClick={() => toggle(r.id)}
                    >
                      <td className="px-2 py-2.5 text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("es-CL")}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.author ? `${r.author.first_name} ${r.author.last_name}` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.rating === "util" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1" variant="secondary">
                            <ThumbsUp className="h-3 w-3" /> Útil
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 gap-1" variant="secondary">
                            <ThumbsDown className="h-3 w-3" /> No útil
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-md">{truncate(r.question, 60)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + "-detail"} className="bg-secondary/20">
                        <td></td>
                        <td colSpan={4} className="px-4 py-4 space-y-4">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                              Pregunta
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{r.question}</p>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                              Respuesta IA
                            </div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{r.answer}</p>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                              Comentario del psicólogo
                            </div>
                            {r.comment ? (
                              <p className="text-sm whitespace-pre-wrap">{r.comment}</p>
                            ) : (
                              <p className="text-sm italic text-muted-foreground">Sin comentario</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
