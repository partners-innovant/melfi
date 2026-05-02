import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string | null; updated_at: string };

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) loadConversations();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function loadConversations() {
    const { data } = await supabase
      .from("general_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations((data ?? []) as Conv[]);
  }

  async function loadMessages(id: string) {
    setActiveId(id);
    const { data } = await supabase
      .from("general_messages")
      .select("role, content")
      .eq("conversation_id", id)
      .order("created_at");
    setMessages((data ?? []) as Msg[]);
  }

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setInput("");
  }

  async function deleteConversation(id: string) {
    if (!confirm("¿Eliminar esta conversación?")) return;
    await supabase.from("general_conversations").delete().eq("id", id);
    if (activeId === id) newConversation();
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

  const empty = messages.length === 0;

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
          {messages.length > 0 && (
            <Button size="sm" variant="outline" onClick={exportConversation}>
              <Download className="h-4 w-4" /> Exportar
            </Button>
          )}
        </header>

        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <Sparkles className="h-12 w-12 text-primary mb-4" />
            <h2 className="text-2xl font-semibold mb-2">¿En qué puedo ayudarte hoy?</h2>
            <p className="text-sm text-muted-foreground mb-8">Chat de uso general — sin contexto clínico</p>
            <div className="w-full max-w-2xl space-y-3">
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
                  rows={3}
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
