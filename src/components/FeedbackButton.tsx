import { useState } from "react";
import { MessageSquarePlus, Lightbulb, Wrench, Bug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type FType = "sugerencia" | "desarrollo" | "error";

const TYPES: { value: FType; label: string; icon: any; emoji: string }[] = [
  { value: "sugerencia", label: "Sugerencia", icon: Lightbulb, emoji: "💡" },
  { value: "desarrollo", label: "Solicitud de desarrollo", icon: Wrench, emoji: "🛠️" },
  { value: "error", label: "Reportar error", icon: Bug, emoji: "🐛" },
];

export default function FeedbackButton({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FType>("sugerencia");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function submit() {
    if (!title.trim() || !description.trim()) {
      toast.error("Completa el título y la descripción.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("feedback").insert({
      psychologist_id: user!.id,
      type,
      title: title.trim().slice(0, 200),
      description: description.trim().slice(0, 4000),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("¡Gracias por tu feedback!");
    setOpen(false);
    setTitle("");
    setDescription("");
    setType("sugerencia");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          collapsed
            ? "hidden md:flex w-full items-center justify-center px-2 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
            : "hidden md:flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
        }
        aria-label="Enviar feedback"
        title={collapsed ? "Feedback" : undefined}
      >
        <MessageSquarePlus className="h-4 w-4" />
        {!collapsed && "Feedback"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar feedback</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Tipo</label>
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-3 rounded-lg border text-xs font-medium transition-colors",
                      type === t.value
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border hover:bg-secondary"
                    )}
                  >
                    <span className="text-lg leading-none">{t.emoji}</span>
                    <span className="text-center leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Título</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Resumen breve"
                maxLength={200}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Descripción</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Cuéntanos los detalles..."
                rows={5}
                maxLength={4000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Enviando..." : "Enviar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
