import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImprovePromptButton } from "@/components/ImprovePromptButton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, FileText, Trash2, Eye, Sparkles, Send, Loader2, Check, X, Wand2, RotateCcw, Paperclip, Mic, Square,
} from "lucide-react";
import { useAudioTranscriber } from "@/hooks/useAudioTranscriber";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { extractPdfText, extractTxtText } from "@/lib/pdf";

const ADULT_BUCKET = "adult-files";

const PROFILE_FIELDS = [
  { key: "presenting_problem", label: "Motivo de consulta" },
  { key: "clinical_history", label: "Historia clínica" },
  { key: "family_context", label: "Contexto familiar" },
  { key: "work_context", label: "Contexto laboral / ocupacional" },
  { key: "previous_treatments", label: "Tratamientos previos" },
  { key: "relevant_history", label: "Antecedentes relevantes" },
  { key: "personal_resources", label: "Recursos personales" },
  { key: "therapeutic_goals", label: "Objetivos terapéuticos" },
  { key: "diagnosis", label: "Diagnóstico / hipótesis" },
  { key: "notes", label: "Notas clínicas" },
] as const;

type ProfileField = typeof PROFILE_FIELDS[number]["key"];

type Proposal = { field: ProfileField; label: string; value: string; reason: string };
type Msg = { role: "user" | "assistant"; content: string; proposals?: Proposal[] };

// ===================== TAB: Constructor de Perfil =====================
export function PatientProfileBuilderTab({
  patientId,
  onProfileUpdated,
  embedded = false,
  headerExtra,
  onMessagesChange,
}: {
  patientId: string;
  onProfileUpdated?: () => void;
  embedded?: boolean;
  headerExtra?: React.ReactNode;
  onMessagesChange?: (messages: Msg[]) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const { recording: audioRec, transcribing: audioTr, toggle: toggleAudio } = useAudioTranscriber((text) => {
    setInput((prev) => (prev.trim() ? prev.replace(/\s+$/, "") + " " + text : text));
  });
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [patientName, setPatientName] = useState<string>("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [analyzingFile, setAnalyzingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const builderTaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Always start the Constructor de Perfil chat from a clean state — do not reload prior messages.
    const { data: p } = await supabase
      .from("patients")
      .select("first_name, last_name")
      .eq("id", patientId)
      .maybeSingle();
    setMessages([]);
    if (p) setPatientName(`${p.first_name} ${p.last_name}`.trim());
    setLoading(false);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  async function handleReset() {
    setResetting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("patient_profile_chat")
        .delete()
        .eq("patient_id", patientId)
        .eq("psychologist_id", user!.id);
      if (error) throw error;
      setMessages([]);
      setResetOpen(false);
      toast.success("Conversación reiniciada");
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo reiniciar");
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  async function send(text?: string, opts?: { mode?: "suggest_diagnosis" }) {
    const message = (text ?? input).trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/profile-builder-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ patient_id: patientId, message, mode: opts?.mode }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.text();
        throw new Error(err || "Error en el servidor");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let proposals: Proposal[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const lines = evt.split("\n");
          let eventName = "message";
          let dataStr = "";
          for (const l of lines) {
            if (l.startsWith("event:")) eventName = l.slice(6).trim();
            else if (l.startsWith("data:")) dataStr += l.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            if (eventName === "delta") {
              assistantText += data.text ?? "";
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: assistantText, proposals };
                return copy;
              });
            } else if (eventName === "proposals") {
              proposals = data.proposals ?? [];
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: assistantText, proposals };
                return copy;
              });
            } else if (eventName === "error") {
              throw new Error(data.error ?? "Error");
            }
          } catch (_e) { /* ignore partial */ }
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? "Error al enviar mensaje");
      setMessages((m) => m.slice(0, -2));
    } finally {
      setSending(false);
    }
  }

  async function applyProposal(messageIdx: number, proposal: Proposal) {
    const update: Record<string, string> = { [proposal.field]: proposal.value };
    const { error } = await supabase
      .from("patients")
      .update(update as never)
      .eq("id", patientId);
    if (error) return toast.error(error.message);
    toast.success(`${proposal.label} actualizado`);
    onProfileUpdated?.();
    setMessages((m) => {
      const copy = [...m];
      const msg = copy[messageIdx];
      if (msg?.proposals) {
        msg.proposals = msg.proposals.filter((p) => p !== proposal);
      }
      return copy;
    });
  }

  function dismissProposal(messageIdx: number, proposal: Proposal) {
    setMessages((m) => {
      const copy = [...m];
      const msg = copy[messageIdx];
      if (msg?.proposals) msg.proposals = msg.proposals.filter((p) => p !== proposal);
      return copy;
    });
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result as string;
        const idx = r.indexOf(",");
        resolve(idx >= 0 ? r.slice(idx + 1) : r);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function detectKind(file: File): "text" | "image" | "audio" | null {
    const t = file.type.toLowerCase();
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (t.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
    if (t.startsWith("audio/") || ["mp3", "m4a", "ogg", "wav", "webm", "mp4"].includes(ext)) return "audio";
    if (
      t === "application/pdf" || ext === "pdf" ||
      t.includes("wordprocessingml") || ext === "docx" ||
      t.startsWith("text/") || ext === "txt"
    ) return "text";
    return null;
  }

  async function analyzeFile(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("El archivo supera 25MB");
      return;
    }
    const kind = detectKind(file);
    if (!kind) {
      toast.error("Tipo de archivo no soportado");
      return;
    }
    setAnalyzingFile(true);
    setPendingFile(null);

    // Optimistic chat bubbles
    const placeholder = `📎 Analizando ${file.name}...`;
    const userTag =
      kind === "image" ? "📎 Imagen subida"
      : kind === "audio" ? "📎 Audio subido"
      : "📎 Documento subido";
    setMessages((m) => [
      ...m,
      { role: "user", content: `${userTag}: ${file.name}` },
      { role: "assistant", content: placeholder },
    ]);

    try {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      let payload: any = {
        patient_id: patientId,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        kind,
      };

      if (kind === "text") {
        let text = "";
        if (ext === "pdf" || file.type === "application/pdf") {
          text = await extractPdfText(file);
        } else if (ext === "docx" || file.type.includes("wordprocessingml")) {
          toast.error("DOCX aún no soportado en navegador. Convierte a PDF o TXT.");
          setMessages((m) => m.slice(0, -2));
          setAnalyzingFile(false);
          return;
        } else {
          text = await extractTxtText(file);
        }
        if (!text.trim()) {
          toast.error("No se pudo extraer texto del documento");
          setMessages((m) => m.slice(0, -2));
          setAnalyzingFile(false);
          return;
        }
        payload.text_content = text.slice(0, 60000);
      } else {
        payload.base64_content = await fileToBase64(file);
      }

      const { data, error } = await supabase.functions.invoke("analyze-patient-file", { body: payload });
      if (error) throw error;
      const analysis: string = data?.assistant_message ?? data?.analysis ?? "";
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: analysis };
        return copy;
      });
      if (data?.suggest_profile_update) {
        toast.success("Análisis listo. Puedes agregarlo al perfil clínico.");
      } else {
        toast.success("Análisis completado");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Error al analizar el archivo");
      setMessages((m) => m.slice(0, -2));
    } finally {
      setAnalyzingFile(false);
    }
  }


  const SUGGESTIONS = [
    "Hazme preguntas",
    "Escribo yo primero",
    "Ya tengo informes subidos, analízalos",
    "Explorar diagnóstico diferencial",
  ];

  const DIAGNOSTIC_CHIPS = [
    "¿Qué criterios DSM-5 aplican aquí?",
    "¿Qué diagnósticos debería descartar?",
    "¿Qué test me ayudaría a confirmar esto?",
    "¿Podría haber comorbilidad?",
    "Dame tu hipótesis diagnóstica completa",
  ];

  const openingMessage = `Hola, soy tu asistente para construir el perfil clínico de ${patientName || "este paciente"}. Puedo ayudarte de dos formas: haciéndote preguntas sobre el paciente, o puedes escribirme libremente lo que ya sabes y yo lo estructuro. ¿Por dónde quieres empezar?`;

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryMsgCount, setSummaryMsgCount] = useState(0);
  const [confirming, setConfirming] = useState(false);

  async function generateSummary() {
    setSummaryLoading(true);
    setSummaryOpen(true);
    setSummaryText("");
    try {
      const { data, error } = await supabase.functions.invoke("summarize-profile-chat", {
        body: { patient_id: patientId },
      });
      if (error) throw error;
      setSummaryText(data.summary ?? "");
      setSummaryMsgCount(data.message_count ?? messages.length);
    } catch (e: any) {
      toast.error(e.message ?? "Error al generar resumen");
      setSummaryOpen(false);
    } finally {
      setSummaryLoading(false);
    }
  }

  async function confirmAddToProfile() {
    if (!summaryText.trim()) return;
    setConfirming(true);
    try {
      const { data: current } = await supabase.from("patients").select("notes").eq("id", patientId).maybeSingle();
      const now = new Date();
      const stamp = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const block = `--- Agregado desde Constructor de Perfil — ${stamp} ---\n${summaryText.trim()}`;
      const newNotes = current?.notes ? `${current.notes}\n\n${block}` : block;
      const { error } = await supabase.from("patients").update({ notes: newNotes }).eq("id", patientId);
      if (error) throw error;
      toast.success("✓ Información agregada al perfil clínico");
      setSummaryOpen(false);
      setSummaryText("");
      onProfileUpdated?.();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Card
      className={embedded ? "p-0 overflow-hidden flex flex-col h-full rounded-none border-0 shadow-none" : "p-0 overflow-hidden flex flex-col"}
      style={embedded ? undefined : { height: "calc(100vh - 280px)", minHeight: 500 }}
    >
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1.5 text-xs border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10"
          onClick={() => setResetOpen(true)}
          disabled={loading || sending}
        >
          <RotateCcw className="h-3 w-3" />↺ Reiniciar
        </Button>
        {headerExtra}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-8">Cargando conversación...</div>
        ) : messages.length === 0 ? (
          <div className="space-y-4">
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm">
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1">
                  <ReactMarkdown>{openingMessage}</ReactMarkdown>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-primary-soft text-primary hover:bg-primary/10 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-sm"
                  : "bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm space-y-3"
              }>
                {m.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1">
                    <ReactMarkdown>{m.content || (sending && i === messages.length - 1 ? "..." : "")}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
                {m.proposals && m.proposals.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {m.proposals.map((p, j) => (
                      <div key={j} className="bg-background border border-border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold">{p.label}</span>
                        </div>
                        <div className="text-xs whitespace-pre-wrap text-foreground/90">{p.value}</div>
                        {p.reason && (
                          <div className="text-[11px] text-muted-foreground italic">{p.reason}</div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => applyProposal(i, p)}>
                            <Check className="h-3 w-3" />Aplicar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => dismissProposal(i, p)}>
                            <X className="h-3 w-3" />Descartar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3 space-y-2 bg-background">
        {messages.length > 0 && messages.length >= 2 && (
          <div className="flex flex-wrap gap-1.5">
            {DIAGNOSTIC_CHIPS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={sending}
                className="text-[11px] px-2.5 py-1 rounded-full bg-primary-soft text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {pendingFile && (
          <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/40">
            <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{pendingFile.name}</div>
              <div className="text-[10px] text-muted-foreground">{(pendingFile.size / 1024).toFixed(0)} KB</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPendingFile(null)} disabled={analyzingFile}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => pendingFile && analyzeFile(pendingFile)}
              disabled={analyzingFile}
            >
              {analyzingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Analizar"}
            </Button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.txt,.docx,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.ogg,.wav,.webm,.mp4,application/pdf,text/plain,image/*,audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingFile(f);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        <div className="rounded-xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring/40 focus-within:border-ring transition-shadow overflow-hidden">
          <Textarea
            ref={builderTaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Cuéntame sobre el paciente o pide algo específico..."
            className="min-h-[120px] max-h-[200px] resize-none w-full border-0 bg-transparent p-3 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
            disabled={sending || analyzingFile}
          />
          <div className="flex items-center gap-2 h-9 px-2 border-t border-border bg-muted/40">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || analyzingFile}
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              title="Adjuntar archivo (PDF, imagen, audio)"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <ImprovePromptButton
                value={input}
                onChange={setInput}
                textareaRef={builderTaRef}
                disabled={sending || analyzingFile}
              />
              <Button
                type="button"
                onClick={() => send("Dame tu hipótesis diagnóstica completa basada en toda la información disponible.", { mode: "suggest_diagnosis" })}
                disabled={sending || analyzingFile}
                size="sm"
                variant="outline"
                className="h-6 gap-1 rounded-full border-teal-500/50 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10 px-2.5 text-[12px] leading-none font-medium"
                title="Sugerir diagnóstico"
              >
                <Sparkles className="h-3 w-3" /> 💡 Sugerir diagnóstico
              </Button>
              <Button
                type="button"
                onClick={() => send()}
                disabled={sending || analyzingFile || !input.trim()}
                size="sm"
                className="h-6 gap-1 rounded-full bg-teal-600 hover:bg-teal-700 text-white px-3 text-[12px] leading-none font-medium"
              >
                {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="h-3 w-3" /> Enviar</>}
              </Button>
            </div>
          </div>
        </div>
        {messages.length >= 3 && (
          <Button
            onClick={generateSummary}
            disabled={summaryLoading}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
          >
            {summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar al perfil clínico
          </Button>
        )}
      </div>

      <Dialog open={summaryOpen} onOpenChange={(o) => { if (!confirming) setSummaryOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Resumen del Constructor de Perfil
            </DialogTitle>
          </DialogHeader>
          {summaryLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
              Generando resumen clínico...
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                value={summaryText}
                onChange={(e) => setSummaryText(e.target.value)}
                className="min-h-[300px] border-2 border-primary/40 focus-visible:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                Basado en {summaryMsgCount} mensajes de conversación
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSummaryOpen(false)} disabled={confirming}>
              Cancelar
            </Button>
            <Button onClick={confirmAddToProfile} disabled={confirming || summaryLoading || !summaryText.trim()}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirmar y agregar al perfil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={(o) => { if (!resetting) setResetOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Reiniciar conversación?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará el historial de esta conversación. La información ya guardada en el perfil del paciente no se verá afectada.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancelar
            </Button>
            <Button
              onClick={handleReset}
              disabled={resetting}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Reiniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ===================== TAB: Documentos e Informes =====================
const ADULT_DOC_TYPES = [
  { value: "informe_psicologico", label: "Informe psicológico" },
  { value: "informe_neurologico", label: "Informe neurológico" },
  { value: "informe_psiquiatrico", label: "Informe psiquiátrico" },
  { value: "evaluacion_externa", label: "Evaluación externa" },
  { value: "informe_medico", label: "Informe médico" },
  { value: "informe_laboral", label: "Informe laboral" },
  { value: "otro", label: "Otro" },
];
const adultDocLabel = (v?: string | null) =>
  ADULT_DOC_TYPES.find((d) => d.value === v)?.label ?? "Otro";

export function PatientDocumentsTab({ patientId }: { patientId: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", document_type: "", professional_name: "", professional_role: "",
    document_date: "", notes: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("adult_documents")
      .select("*").eq("patient_id", patientId)
      .order("document_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setDocs(data ?? []);
  }, [patientId]);
  useEffect(() => { load(); }, [load]);

  function reset() {
    setForm({ title: "", document_type: "", professional_name: "", professional_role: "", document_date: "", notes: "" });
    setFile(null);
  }

  async function uploadFile(f: File): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("No auth");
    const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/documents/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from(ADULT_BUCKET).upload(path, f);
    if (error) throw error;
    return path;
  }

  async function openSigned(path: string) {
    const { data, error } = await supabase.storage.from(ADULT_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return toast.error("No se pudo abrir el archivo");
    window.open(data.signedUrl, "_blank");
  }

  async function save() {
    if (!form.title.trim()) return toast.error("Título obligatorio");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let file_path: string | null = null;
      if (file) file_path = await uploadFile(file);
      const { error } = await supabase.from("adult_documents").insert({
        patient_id: patientId,
        psychologist_id: user!.id,
        title: form.title.trim(),
        document_type: form.document_type || null,
        professional_name: form.professional_name || null,
        professional_role: form.professional_role || null,
        document_date: form.document_date || null,
        notes: form.notes || null,
        file_path,
      });
      if (error) throw error;
      toast.success("Documento guardado");
      setOpen(false); reset(); load();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally { setSaving(false); }
  }

  async function remove(d: any) {
    if (!confirm(`¿Eliminar "${d.title}"?`)) return;
    if (d.file_path) await supabase.storage.from(ADULT_BUCKET).remove([d.file_path]);
    const { error } = await supabase.from("adult_documents").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("Documento eliminado");
    load();
  }

  // Group by type
  const grouped = docs.reduce((acc: Record<string, any[]>, d) => {
    const k = d.document_type ?? "otro";
    (acc[k] ||= []).push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Documentos e informes</h3>
          <p className="text-xs text-muted-foreground">Informes externos, evaluaciones y documentos clínicos del paciente</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" />Agregar</Button>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo documento</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Título *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.document_type} onValueChange={(v) => setForm({ ...form, document_type: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {ADULT_DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Fecha</Label>
                  <Input type="date" value={form.document_date} onChange={(e) => setForm({ ...form, document_date: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Profesional</Label>
                  <Input value={form.professional_name} onChange={(e) => setForm({ ...form, professional_name: e.target.value })} />
                </div>
                <div>
                  <Label>Rol</Label>
                  <Input value={form.professional_role} onChange={(e) => setForm({ ...form, professional_role: e.target.value })} placeholder="Psiquiatra, Neurólogo..." />
                </div>
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </div>
              <div>
                <Label>Archivo (PDF, imagen)</Label>
                <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {docs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
          Aún no hay documentos cargados.
        </Card>
      ) : (
        Object.entries(grouped).map(([type, list]) => (
          <div key={type} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{adultDocLabel(type)}</h4>
            {(list as any[]).map((d) => (
              <Card key={d.id} className="p-4 flex items-start gap-3">
                <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.title}</p>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px]">{adultDocLabel(d.document_type)}</Badge>
                        {d.professional_name && <span>{d.professional_name}{d.professional_role ? ` · ${d.professional_role}` : ""}</span>}
                        {d.document_date && <span>{new Date(d.document_date).toLocaleDateString("es-CL")}</span>}
                      </div>
                      {d.notes && <p className="text-xs mt-1.5 text-foreground/80 line-clamp-2">{d.notes}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {d.file_path && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openSigned(d.file_path)}>
                        <Eye className="h-3 w-3" />Ver documento
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => remove(d)}>
                      <Trash2 className="h-3 w-3" />Eliminar
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
