import { useState } from "react";
import { Sparkles, Loader2, Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Recommendation {
  category: string;
  title: string;
  authors: string;
  year: string;
  source: string;
  url: string;
  relevance: string;
}

export default function RecommendDocumentsButton() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);

  async function generate() {
    if (!topic.trim()) {
      toast.error("Describe sobre qué áreas necesitas documentación.");
      return;
    }
    setLoading(true);
    setRecs(null);
    const { data, error } = await supabase.functions.invoke("recommend-documents", {
      body: { topic: topic.trim() },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Error al generar recomendaciones");
      return;
    }
    if (data?.error) {
      toast.error(data.error);
      return;
    }
    const list = (data?.recommendations ?? []) as Recommendation[];
    if (list.length === 0) {
      toast.error("No se obtuvieron recomendaciones. Intenta reformular.");
      return;
    }
    setRecs(list);
  }

  function reset() {
    setTopic("");
    setRecs(null);
  }

  async function copyAll() {
    if (!recs) return;
    const text = recs
      .map(
        (r, i) =>
          `${i + 1}. [${r.category}] ${r.title}\n   Autores: ${r.authors}\n   Año: ${r.year}\n   Fuente: ${r.source}${r.url ? ` (${r.url})` : ""}\n   Relevancia: ${r.relevance}`,
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Lista copiada al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  // Group by category for display
  const grouped = recs
    ? recs.reduce<Record<string, Recommendation[]>>((acc, r) => {
        const k = r.category || "Otros";
        if (!acc[k]) acc[k] = [];
        acc[k].push(r);
        return acc;
      }, {})
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          // small delay so the close animation isn't jarring
          setTimeout(reset, 200);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Recomendar documentos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Recomendaciones de documentos
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              ¿Sobre qué áreas clínicas necesitas más documentación?
            </label>
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej: terapia cognitivo-conductual para adolescentes, TDAH en niños, trastornos de ansiedad..."
              rows={3}
              disabled={loading}
            />
            <div className="flex gap-2">
              <Button onClick={generate} disabled={loading || !topic.trim()} className="gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generar recomendaciones
                  </>
                )}
              </Button>
              {recs && (
                <Button variant="outline" onClick={copyAll} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Copiar lista
                </Button>
              )}
            </div>
          </div>

          {loading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Buscando documentos relevantes...
            </div>
          )}

          {grouped && (
            <div className="space-y-5">
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat} className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    {cat}
                  </div>
                  <div className="space-y-2">
                    {items.map((r, i) => (
                      <Card key={`${cat}-${i}`} className="p-4 space-y-2">
                        <div>
                          <div className="font-medium leading-snug">{r.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {r.authors}
                            {r.year ? ` · ${r.year}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="secondary">{r.source || "Fuente s/d"}</Badge>
                          {r.url && (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              Ver fuente <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {r.relevance && (
                          <p className="text-sm text-muted-foreground italic">{r.relevance}</p>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
