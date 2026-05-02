import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Loader2, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const EXPORT_PROMPT = `Necesito que hagas un resumen de todo lo que sabes sobre mí basándote en nuestras conversaciones. Incluye:
- Mis preferencias de comunicación y estilo de trabajo
- Temas que suelo consultar frecuentemente
- Mi contexto profesional (especialidad, tipo de pacientes, enfoque terapéutico)
- Proyectos o contextos importantes que hayas conocido
- Cómo prefiero que me respondan
- Cualquier otro contexto relevante

Sé detallado y organizado — este resumen será usado para darle contexto a otro asistente de IA para que pueda continuar apoyándome sin partir de cero.`;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

export default function ImportMemoryDialog({ open, onOpenChange, onImported }: Props) {
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(EXPORT_PROMPT);
      setCopied(true);
      toast.success("Prompt copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function handleImport() {
    const text = pasted.trim();
    if (text.length < 20) {
      toast.error("Pega la respuesta de tu IA antes de continuar.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("claude-memory-import", {
        body: { imported_text: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const total = Number((data as any)?.total_facts_count ?? 0);
      toast.success(`✅ Contexto importado correctamente. Claude ahora recuerda ${total} hecho${total === 1 ? "" : "s"} sobre ti.`);
      setPasted("");
      onImported?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo importar el contexto");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar contexto desde otra IA</DialogTitle>
          <DialogDescription>
            Trae el contexto que tu IA actual ya tiene de ti para que Claude pueda continuar
            apoyándote sin empezar desde cero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Step 1 */}
          <section className="space-y-2">
            <div className="text-sm font-semibold">Paso 1 — Instrucciones</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong>Instrucciones para el terapeuta:</strong>
              <br />
              1. Ve a tu IA actual (Claude.ai, ChatGPT, Gemini, etc.)
              <br />
              2. Copia y pega el siguiente prompt:
            </p>
            <div className="rounded-lg border-2 border-teal-500/60 bg-teal-50/40 dark:bg-teal-950/20 p-3 space-y-2">
              <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
{EXPORT_PROMPT}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={copyPrompt}
                className="border-teal-500/60 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "📋 Copiar prompt"}
              </Button>
            </div>
          </section>

          {/* Step 2 */}
          <section className="space-y-2">
            <div className="text-sm font-semibold">Paso 2 — Pega la respuesta</div>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Pega aquí la respuesta que te dio tu IA..."
              rows={10}
              className="resize-y min-h-[180px]"
              disabled={loading}
            />
            <div className="text-xs text-muted-foreground text-right">
              {pasted.length.toLocaleString()} caracteres
            </div>
          </section>

          {/* Step 3 */}
          <section className="space-y-2">
            <div className="text-sm font-semibold">Paso 3 — Procesar con Claude</div>
            <Button
              onClick={handleImport}
              disabled={loading || pasted.trim().length < 20}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Importando...</>
              ) : (
                <><Download className="h-4 w-4" /> Importar contexto</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Claude analizará el texto y fusionará la información con tu memoria existente
              (sin sobrescribir).
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
