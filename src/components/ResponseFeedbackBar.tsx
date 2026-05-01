import { useState } from "react";
import { ThumbsUp, ThumbsDown, MessageSquarePlus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Rating = "util" | "no_util";

interface Props {
  question: string;
  answer: string;
  consultationId?: string | null;
}

export default function ResponseFeedbackBar({ question, answer, consultationId }: Props) {
  const { user } = useAuth();
  const [rating, setRating] = useState<Rating | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function submit(r: Rating, withComment: boolean) {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase.from("response_feedback").insert({
      psychologist_id: user!.id,
      consultation_id: consultationId ?? null,
      question: question.slice(0, 8000),
      answer: answer.slice(0, 20000),
      rating: r,
      comment: withComment && comment.trim() ? comment.trim().slice(0, 4000) : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmitted(true);
  }

  async function handleQuickRating(r: Rating) {
    setRating(r);
    await submit(r, false);
  }

  async function handleSendComment() {
    if (!comment.trim()) {
      toast.error("Escribe un comentario antes de enviar.");
      return;
    }
    await submit(rating ?? "util", true);
  }

  if (submitted) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" />
        Gracias por tu feedback
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => handleQuickRating("util")}
          disabled={saving}
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:text-emerald-600 hover:border-emerald-500 transition-colors",
            rating === "util" && "text-emerald-600 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20",
          )}
          aria-label="Útil"
          title="Útil"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleQuickRating("no_util")}
          disabled={saving}
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:text-red-600 hover:border-red-500 transition-colors",
            rating === "no_util" && "text-red-600 border-red-500 bg-red-50 dark:bg-red-900/20",
          )}
          aria-label="No útil"
          title="No útil"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowComment((s) => !s)}
          className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-md transition-colors"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Comentar
        </button>
      </div>

      {showComment && !submitted && (
        <div className="space-y-2 max-w-xl">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Cuéntanos cómo podríamos mejorar esta respuesta..."
            rows={3}
            maxLength={4000}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSendComment} disabled={saving}>
              {saving ? "Enviando..." : "Enviar comentario"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowComment(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
