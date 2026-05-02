import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImprovePromptButton } from "@/components/ImprovePromptButton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  Plus,
  Send,
  Sparkles,
  Loader2,
  MessageSquare,
  Copy,
  Download,
  Trash2,
  Brain,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ImportMemoryDialog from "@/components/ImportMemoryDialog";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string | null; updated_at: string };
type Memory = {
  memory_summary: string | null;
  key_facts: string[];
  preferences: Record<string, any>;
  updated_at: string | null;
};

const SUGGESTED = [
  "Ayúdame a redactar un email profesional",
  "Resume este texto",
  "Explícame un concepto",
  "Ayúdame a planificar mi semana",
];

export default function Claude() {
  const { user, session } = useAuth();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emptyTaRef = useRef<HTMLTextAreaElement>(null);
  const ongoingTaRef = useRef<HTMLTextAreaElement>(null);
  // Snapshot of messages used for memory updates (used in beforeunload)
  const messagesRef = useRef<Msg[]>([]);
  const updatedThisSessionRef = useRef(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadMemory();
    }
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto memory-update if conversation grows past 10 messages and not yet updated this session
  useEffect(() => {
    if (messages.length > 10 && !updatedThisSessionRef.current && !streaming) {
      updatedThisSessionRef.current = true;
      runMemoryUpdate(messages).catch(() => { updatedThisSessionRef.current = false; });
    }
  }, [messages, streaming]);

  // beforeunload: best-effort memory update via keepalive fetch
  useEffect(() => {
    function onBeforeUnload() {
      const msgs = messagesRef.current;
      if (!session || msgs.length < 2) return;
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-memory-update`;
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: msgs }),
          keepalive: true,
        });
      } catch { /* noop */ }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [session]);

  async function loadConversations() {
    const { data } = await supabase
      .from("general_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations((data ?? []) as Conv[]);
  }

  async function loadMemory() {
    const { data } = await supabase
      .from("general_chat_memory")
      .select("memory_summary, key_facts, preferences, updated_at")
      .maybeSingle();
    if (data) {
      setMemory({
        memory_summary: data.memory_summary,
        key_facts: Array.isArray(data.key_facts) ? (data.key_facts as string[]) : [],
        preferences: (data.preferences && typeof data.preferences === "object" ? data.preferences : {}) as Record<string, any>,
        updated_at: data.updated_at,
      });
    } else {
      setMemory(null);
    }
  }

  async function loadMessages(id: string) {
    setActiveId(id);
    const { data } = await supabase
      .from("general_messages")
      .select("role, content")
      .eq("conversation_id", id)
      .order("created_at");
    setMessages((data ?? []) as Msg[]);
    updatedThisSessionRef.current = false;
  }

  async function runMemoryUpdate(msgs: Msg[]) {
    if (!session || msgs.length < 2) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-memory-update`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: msgs }),
      });
      if (resp.ok) await loadMemory();
    } catch (e) {
      console.error("[memory update] error", e);
    }
  }

  async function newConversation() {
    // Update memory from current chat before clearing
    if (messages.length >= 2) {
      await runMemoryUpdate(messages);
    }
    setActiveId(null);
    setMessages([]);
    setInput("");
    updatedThisSessionRef.current = false;
  }

  async function deleteConversation(id: string) {
    if (!confirm("¿Eliminar esta conversación?")) return;
    await supabase.from("general_conversations").delete().eq("id", id);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    loadConversations();
  }

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || streaming || !session) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-chat-general`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: activeId, message, history }),
      });
      if (!resp.ok || !resp.body) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let createdConvId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
          buffer = buffer.slice(nlIdx + 1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.conversation_id) createdConvId = evt.conversation_id;
            if (typeof evt.delta === "string") {
              acc += evt.delta;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: acc };
                return copy;
              });
            }
          } catch { /* partial */ }
        }
      }

      if (createdConvId && !activeId) setActiveId(createdConvId);
      loadConversations();
    } catch (e: any) {
      toast.error("Error: " + (e.message ?? "desconocido"));
      setMessages((m) => m.slice(0, -2));
    } finally {
      setStreaming(false);
    }
  }

  function copyMsg(content: string) {
    navigator.clipboard.writeText(content);
    toast.success("Copiado");
  }

  function exportConversation() {
    const text = messages
      .map((m) => `## ${m.role === "user" ? "Tú" : "Claude"}\n\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
  }

  async function deleteFact(idx: number) {
    if (!memory || !user) return;
    const next = memory.key_facts.filter((_, i) => i !== idx);
    const { error } = await supabase
      .from("general_chat_memory")
      .update({ key_facts: next, updated_at: new Date().toISOString() })
      .eq("psychologist_id", user.id);
    if (error) { toast.error("Error al eliminar"); return; }
    setMemory({ ...memory, key_facts: next });
  }

  async function deletePreference(key: string) {
    if (!memory || !user) return;
    const next = { ...memory.preferences };
    delete next[key];
    const { error } = await supabase
      .from("general_chat_memory")
      .update({ preferences: next, updated_at: new Date().toISOString() })
      .eq("psychologist_id", user.id);
    if (error) { toast.error("Error al eliminar"); return; }
    setMemory({ ...memory, preferences: next });
  }

  async function clearAllMemory() {
    if (!user) return;
    const { error } = await supabase
      .from("general_chat_memory")
      .delete()
      .eq("psychologist_id", user.id);
    if (error) { toast.error("Error al borrar memoria"); return; }
    setMemory(null);
    toast.success("Memoria borrada");
  }

  const empty = messages.length === 0;
  const hasMemory = !!memory && (
    !!memory.memory_summary ||
    memory.key_facts.length > 0 ||
    Object.keys(memory.preferences).length > 0
  );

  return (
    <div className="flex h-[calc(100vh-0px)]">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card hidden md:flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={newConversation} className="w-full" size="sm">
            <Plus className="h-4 w-4" /> Nueva conversación
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.length === 0 && (
              <div className="text-xs text-muted-foreground p-3 text-center">Sin conversaciones aún</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer hover:bg-accent",
                  activeId === c.id && "bg-accent",
                )}
                onClick={() => loadMessages(c.id)}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">{c.title || "Sin título"}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h1 className="font-semibold leading-none">Claude</h1>
              <div className="text-xs text-muted-foreground mt-0.5">Asistente de uso general</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sheet open={memoryOpen} onOpenChange={setMemoryOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => loadMemory()}>
                  <Brain className="h-4 w-4" /> Memoria
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Lo que Claude recuerda de ti</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-teal-500/60 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30"
                    onClick={() => setImportOpen(true)}
                  >
                    📥 Importar contexto desde otra IA
                  </Button>
                  {!hasMemory ? (
                    <div className="text-sm text-muted-foreground">
                      Aún no hay nada guardado. Conversa con Claude y la memoria se construirá automáticamente.
                    </div>
                  ) : (
                    <>
                      {memory?.memory_summary && (
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Resumen</div>
                          <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">
                            {memory.memory_summary}
                          </div>
                        </div>
                      )}

                      {memory && memory.key_facts.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Hechos clave</div>
                          <div className="flex flex-wrap gap-2">
                            {memory.key_facts.map((f, i) => (
                              <Badge key={i} variant="secondary" className="pr-1 gap-1">
                                <span>{f}</span>
                                <button
                                  onClick={() => deleteFact(i)}
                                  className="hover:text-destructive ml-1 inline-flex"
                                  aria-label="Eliminar hecho"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {memory && Object.keys(memory.preferences).length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Preferencias</div>
                          <div className="space-y-1">
                            {Object.entries(memory.preferences).map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{k}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {typeof v === "string" ? v : JSON.stringify(v)}
                                  </div>
                                </div>
                                <button
                                  onClick={() => deletePreference(k)}
                                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                                  aria-label="Eliminar preferencia"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="w-full">
                              <Trash2 className="h-4 w-4" /> Borrar toda la memoria
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Borrar toda la memoria?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Claude olvidará todo lo que sabe de ti. Esta acción no se puede deshacer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={clearAllMemory}>Borrar</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        {memory?.updated_at && (
                          <div className="text-xs text-muted-foreground text-center mt-3">
                            Última actualización: {new Date(memory.updated_at).toLocaleString("es")}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <ImportMemoryDialog
              open={importOpen}
              onOpenChange={setImportOpen}
              onImported={loadMemory}
            />
            {messages.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportConversation}>
                <Download className="h-4 w-4" /> Exportar
              </Button>
            )}
          </div>
        </header>

        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <Sparkles className="h-12 w-12 text-primary mb-4" />
            <h2 className="text-2xl font-semibold mb-2">¿En qué puedo ayudarte hoy?</h2>
            <p className="text-sm text-muted-foreground mb-8">Chat de uso general — sin contexto clínico</p>
            <div className="w-full max-w-2xl space-y-3">
              <div className="relative">
                <Textarea
                  ref={emptyTaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Escribe tu mensaje..."
                  rows={3}
                  className="resize-none pr-12 pb-9"
                />
                <div className="absolute bottom-2 left-3">
                  <ImprovePromptButton value={input} onChange={setInput} textareaRef={emptyTaRef} disabled={streaming} />
                </div>
                <Button
                  size="icon"
                  className="absolute bottom-2 right-2 h-8 w-8"
                  onClick={() => send()}
                  disabled={!input.trim() || streaming}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground text-center">
                Este chat es de uso general y no tiene acceso a tus pacientes ni documentos clínicos. Para consultas clínicas usa el Asistente IA.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-4">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-sm px-4 py-3 rounded-lg border hover:bg-accent transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto p-6 space-y-6">
                {messages.map((m, i) => (
                  <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
                    {m.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={cn("group max-w-[85%]", m.role === "user" && "max-w-[75%]")}>
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm",
                          m.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted",
                        )}
                      >
                        {m.role === "assistant" ? (
                          m.content ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )
                        ) : (
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        )}
                      </div>
                      {m.role === "assistant" && m.content && (
                        <div className="opacity-0 group-hover:opacity-100 transition mt-1">
                          <button
                            onClick={() => copyMsg(m.content)}
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            <Copy className="h-3 w-3" /> Copiar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t p-4">
              <div className="max-w-3xl mx-auto">
                <div className="relative">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Escribe tu mensaje..."
                    rows={2}
                    className="resize-none pr-12"
                  />
                  <Button
                    size="icon"
                    className="absolute bottom-2 right-2 h-8 w-8"
                    onClick={() => send()}
                    disabled={!input.trim() || streaming}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground text-center mt-2">
                  Este chat es de uso general y no tiene acceso a tus pacientes ni documentos clínicos. Para consultas clínicas usa el Asistente IA.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
