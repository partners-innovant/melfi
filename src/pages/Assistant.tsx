import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Sparkles, MessageSquare, Plus, Menu, User as UserIcon, X, Copy, Download } from "lucide-react";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import ResponseFeedbackBar from "@/components/ResponseFeedbackBar";

interface Citation {
  chunk_id: string;
  document_title: string;
  author?: string;
  year?: string;
  page_number?: string;
  excerpt: string;
  document_type?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  general?: boolean;
  generalLoading?: boolean;
}

const NO_INFO_PHRASE = "No tengo información suficiente en los documentos cargados";

interface Patient { id: string; first_name: string; last_name: string; }

interface ConversationItem {
  conversation_id: string;
  title: string;
  patient_name: string | null;
  created_at: string;
}

const ALL = "__all__";
const NONE = "__none__";

const SUGGESTIONS = [
  "¿Qué dice la evidencia sobre TCC para ansiedad?",
  "¿Cómo abordar la resistencia terapéutica?",
  "¿Cuáles son los criterios diagnósticos del DSM-5 para depresión mayor?",
  "¿Qué protocolos existen para el tratamiento del TDAH en adultos?",
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function stripCitations(text: string) {
  return text.replace(/\[cita:[^\]]+\]/g, "").replace(/\s{2,}/g, " ").trim();
}

function formatDateGroup(d: Date): "Hoy" | "Ayer" | "Esta semana" | "Anteriores" {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - date.getTime()) / 86400000;
  if (diff <= 0) return "Hoy";
  if (diff <= 1) return "Ayer";
  if (diff <= 7) return "Esta semana";
  return "Anteriores";
}

function findPrevQuestion(messages: ChatMessage[], idx: number): string {
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

export default function Assistant() {
  const [params] = useSearchParams();
  const patientKind = params.get("kind") === "child" ? "child" : "adult";
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<string>(params.get("patient") ?? NONE);
  const [docType, setDocType] = useState<string>(ALL);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const patientsMap = useMemo(
    () => new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`])),
    [patients],
  );

  const activePatientName = patientId !== NONE ? patientsMap.get(patientId) ?? null : null;

  useEffect(() => {
    (async () => {
      const table = patientKind === "child" ? "child_patients" : "patients";
      const { data } = await supabase
        .from(table).select("id, first_name, last_name").order("first_name");
      setPatients((data as Patient[]) ?? []);
    })();
  }, [patientKind]);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("consultations")
      .select("conversation_id, conversation_title, question, patient_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!data) return;
    const seen = new Set<string>();
    const items: ConversationItem[] = [];
    for (const r of data as any[]) {
      const cid = r.conversation_id ?? r.id;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      items.push({
        conversation_id: cid,
        title: r.conversation_title || r.question?.slice(0, 80) || "Consulta",
        patient_name: r.patient_id ? null : null, // filled below
        created_at: r.created_at,
      });
    }
    // attach patient names
    const pMap = new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
    const enriched = await Promise.all(items.map(async (it) => {
      const { data: row } = await supabase
        .from("consultations")
        .select("patient_id")
        .eq("conversation_id", it.conversation_id)
        .limit(1)
        .maybeSingle();
      return { ...it, patient_name: row?.patient_id ? pMap.get(row.patient_id) ?? null : null };
    }));
    setHistory(enriched);
  }, [patients]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function newConversation() {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setSidebarOpen(false);
  }

  async function loadConversation(cid: string) {
    setSidebarOpen(false);
    const { data, error } = await supabase
      .from("consultations")
      .select("question, answer, citations, patient_id, created_at, is_general_knowledge")
      .eq("conversation_id", cid)
      .order("created_at", { ascending: true });
    if (error) { toast.error(error.message); return; }
    const msgs: ChatMessage[] = [];
    for (const r of (data ?? []) as any[]) {
      if (!r.is_general_knowledge) {
        msgs.push({ role: "user", content: r.question });
      }
      msgs.push({
        role: "assistant",
        content: r.answer,
        citations: r.citations ?? [],
        general: !!r.is_general_knowledge,
      });
    }
    setMessages(msgs);
    setConversationId(cid);
    if (data && data.length > 0 && (data[0] as any).patient_id) {
      setPatientId((data[0] as any).patient_id);
    }
  }

  async function send(textOverride?: string) {
    const q = (textOverride ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", streaming: true }]);
    setBusy(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesión expirada");

      // 1. embed
      const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
        body: { input: q, input_type: "query" },
      });
      if (embErr) throw new Error(`voyage-embed: ${embErr.message ?? JSON.stringify(embErr)}`);
      if (embData?.error) throw new Error(`voyage-embed: ${embData.error}`);
      const query_embedding = embData?.embeddings?.[0];
      if (!query_embedding) throw new Error("voyage-embed: embedding vacío");

      // 2. stream from claude-chat
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/claude-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          question: q,
          query_embedding,
          patient_id: patientId !== NONE ? patientId : null,
          patient_kind: patientKind,
          document_type: docType !== ALL ? docType : null,
          conversation_id: conversationId,
        }),
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text();
        throw new Error(`claude-chat ${resp.status}: ${txt}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastEvent = "";
      let finalConvId = conversationId;
      let finalCitations: Citation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message"; let dataStr = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) event = ln.slice(6).trim();
            else if (ln.startsWith("data:")) dataStr += ln.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload: any;
          try { payload = JSON.parse(dataStr); } catch { continue; }
          lastEvent = event;
          if (event === "delta") {
            const text = payload.text ?? "";
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: text, streaming: true };
              }
              return copy;
            });
          } else if (event === "done") {
            finalConvId = payload.conversation_id;
            finalCitations = payload.citations ?? [];
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: payload.answer ?? last.content,
                  citations: payload.citations ?? [],
                  streaming: false,
                };
              }
              return copy;
            });
          } else if (event === "error") {
            throw new Error(payload.error || "Error en streaming");
          }
        }
      }

      if (finalConvId && finalConvId !== conversationId) {
        setConversationId(finalConvId);
      }
      void loadHistory();
      void lastEvent; void finalCitations;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[assistant]", e);
      toast.error(msg);
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          copy[copy.length - 1] = { role: "assistant", content: `❌ Error: ${msg}`, citations: [], streaming: false };
        } else {
          copy.push({ role: "assistant", content: `❌ Error: ${msg}`, citations: [], streaming: false });
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function searchGeneral(question: string) {
    if (!question.trim()) return;
    // Append a placeholder loading "general" assistant message
    setMessages((m) => [...m, { role: "assistant", content: "", general: true, generalLoading: true }]);
    try {
      const { data, error } = await supabase.functions.invoke("claude-general", {
        body: {
          question,
          patient_id: patientId !== NONE ? patientId : null,
          conversation_id: conversationId,
        },
      });
      if (error) throw new Error(error.message ?? "Error");
      if (data?.error) throw new Error(data.error);
      const answer = data?.answer ?? "";
      const newConvId = data?.conversation_id ?? conversationId;
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && last.generalLoading) {
          copy[copy.length - 1] = { role: "assistant", content: answer, general: true, citations: [] };
        }
        return copy;
      });
      if (newConvId && newConvId !== conversationId) setConversationId(newConvId);
      void loadHistory();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      toast.error(msg);
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && last.generalLoading) {
          copy[copy.length - 1] = { role: "assistant", content: `❌ Error: ${msg}`, general: true, citations: [] };
        }
        return copy;
      });
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Sidebar - desktop */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        <SidebarBody history={history} onNew={newConversation} onPick={loadConversation} activeId={conversationId} />
      </aside>

      {/* Sidebar - mobile sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SidebarBody history={history} onNew={newConversation} onPick={loadConversation} activeId={conversationId} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="border-b border-border bg-card px-4 md:px-6 py-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="font-semibold">Asistente IA</h1>
          </div>
          <div className="flex flex-1 gap-2 sm:justify-end">
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger className="w-full sm:w-56 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin paciente seleccionado</SelectItem>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="w-full sm:w-52 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos los documentos</SelectItem>
                {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t as DocType]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Patient pill */}
        {activePatientName && (
          <div className="px-4 md:px-6 pt-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/30 px-3 py-1 text-sm">
              <span className="h-6 w-6 rounded-full bg-teal-500/20 flex items-center justify-center">
                <UserIcon className="h-3.5 w-3.5" />
              </span>
              <span>Consultando sobre: <strong>{activePatientName}</strong></span>
              <button
                onClick={() => setPatientId(NONE)}
                className="ml-1 hover:bg-teal-500/20 rounded-full p-0.5"
                aria-label="Quitar paciente"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Messages OR welcome+centered input */}
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-6 py-6">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-8">
                <div className="inline-flex h-12 w-12 rounded-2xl bg-primary-soft text-primary items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold mb-2">¿En qué puedo ayudarte hoy?</h2>
                <p className="text-sm text-muted-foreground">Las respuestas se basan únicamente en tus documentos cargados.</p>
              </div>
              <InputBox
                value={input}
                onChange={setInput}
                onSend={() => send()}
                busy={busy}
                autoFocus
              />
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); }}
                    className="text-left text-sm border border-border rounded-xl px-3 py-2.5 hover:bg-accent hover:border-primary/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
              <div className="max-w-3xl mx-auto space-y-5">
                {messages.map((m, i) => (
                  <Message
                    key={i}
                    message={m}
                    question={m.role === "assistant" ? findPrevQuestion(messages, i) : ""}
                    conversationId={conversationId}
                    onCite={setActiveCitation}
                    onExportPdf={() => exportConversationPdf(messages, i, activePatientName)}
                  />
                ))}
              </div>
            </div>
            <div className="border-t border-border bg-card px-4 md:px-6 py-3">
              <div className="max-w-3xl mx-auto">
                <InputBox value={input} onChange={setInput} onSend={() => send()} busy={busy} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Citation panel */}
      <Sheet open={!!activeCitation} onOpenChange={(o) => !o && setActiveCitation(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {activeCitation && <CitationPanel citation={activeCitation} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SidebarBody({
  history, onNew, onPick, activeId,
}: {
  history: ConversationItem[];
  onNew: () => void;
  onPick: (id: string) => void;
  activeId: string | null;
}) {
  const groups = useMemo(() => {
    const order = ["Hoy", "Ayer", "Esta semana", "Anteriores"] as const;
    const map = new Map<string, ConversationItem[]>();
    for (const it of history) {
      const k = formatDateGroup(new Date(it.created_at));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return order.filter((k) => map.has(k)).map((k) => ({ label: k, items: map.get(k)! }));
  }, [history]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button onClick={onNew} className="w-full justify-start gap-2" variant="outline">
          <Plus className="h-4 w-4" /> Nueva consulta
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="text-xs text-muted-foreground p-3">No hay consultas previas.</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold px-2 py-1">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <button
                  key={it.conversation_id}
                  onClick={() => onPick(it.conversation_id)}
                  className={cn(
                    "w-full text-left px-2 py-2 rounded-md text-sm hover:bg-accent transition-colors",
                    activeId === it.conversation_id && "bg-accent",
                  )}
                >
                  <div className="line-clamp-2 leading-snug">{it.title}</div>
                  {it.patient_name && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <UserIcon className="h-3 w-3" /> {it.patient_name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InputBox({
  value, onChange, onSend, busy, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex gap-2 items-end">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Pregunta clínica..."
        className="min-h-[52px] max-h-40 resize-none rounded-2xl"
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        disabled={busy}
      />
      <Button onClick={onSend} disabled={busy || !value.trim()} size="icon" className="h-12 w-12 flex-shrink-0 rounded-2xl">
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Message({
  message, question, conversationId, onCite, onExportPdf,
}: {
  message: ChatMessage;
  question?: string;
  conversationId?: string | null;
  onCite: (c: Citation) => void;
  onExportPdf: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const citationsMap = useMemo(() => {
    const m = new Map<string, { idx: number; cite: Citation }>();
    (message.citations ?? []).forEach((c, i) => m.set(c.chunk_id, { idx: i + 1, cite: c }));
    return m;
  }, [message.citations]);

  const parts = useMemo(() => {
    const re = /\[cita:([^\]]+)\]/g;
    const out: Array<{ type: "text" | "cite"; value: string; cite?: Citation; idx?: number }> = [];
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(message.content)) !== null) {
      if (match.index > last) out.push({ type: "text", value: message.content.slice(last, match.index) });
      const id = match[1];
      const found = citationsMap.get(id);
      if (found) out.push({ type: "cite", value: id, cite: found.cite, idx: found.idx });
      else out.push({ type: "text", value: match[0] });
      last = match.index + match[0].length;
    }
    if (last < message.content.length) out.push({ type: "text", value: message.content.slice(last) });
    return out;
  }, [message.content, citationsMap]);

  async function copyAnswer() {
    const clean = stripCitations(message.content);
    try {
      await navigator.clipboard.writeText(clean);
      toast.success("Respuesta copiada");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  const isEmpty = !message.content && message.streaming;

  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center flex-shrink-0">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm max-w-none">
          <p className="text-sm leading-relaxed whitespace-pre-wrap m-0">
            {isEmpty ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                Pensando<span className="streaming-cursor">▍</span>
              </span>
            ) : (
              <>
                {parts.map((p, i) =>
                  p.type === "text" ? (
                    <span key={i}>{p.value}</span>
                  ) : (
                    <sup key={i} className="citation-mark" onClick={() => onCite(p.cite!)}>
                      {p.idx}
                    </sup>
                  ),
                )}
                {message.streaming && <span className="streaming-cursor">▍</span>}
              </>
            )}
          </p>
        </div>

        {!message.streaming && (message.citations?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.citations!.map((c, i) => (
              <button
                key={i}
                onClick={() => onCite(c)}
                className="text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                [{i + 1}] {c.document_title}
              </button>
            ))}
          </div>
        )}

        {!message.streaming && message.content && !message.content.startsWith("❌") && (
          <div className="mt-2 flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={copyAnswer}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onExportPdf}>
              <Download className="h-3.5 w-3.5" /> Exportar como PDF
            </Button>
          </div>
        )}

        {!message.streaming && message.content && !message.content.startsWith("❌") && question && (
          <ResponseFeedbackBar
            question={question}
            answer={stripCitations(message.content)}
            consultationId={conversationId ?? null}
          />
        )}
      </div>
    </div>
  );
}

function CitationPanel({ citation }: { citation: Citation }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>Fuente</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-4">
        <div>
          <div className="font-semibold text-base">{citation.document_title}</div>
          <div className="text-sm text-muted-foreground">
            {citation.author ?? "Autor s/d"}
            {citation.year ? ` · ${citation.year}` : ""}
          </div>
          {citation.document_type && (
            <Badge variant="secondary" className="mt-2 text-[10px]">{citation.document_type}</Badge>
          )}
        </div>
        {citation.page_number && (
          <div className="text-xs text-muted-foreground">Página ~{citation.page_number}</div>
        )}
        <Card className="p-4 bg-muted/40">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">Fragmento citado</div>
          <p className="text-sm leading-relaxed">
            <span className="citation-highlight">{citation.excerpt}</span>
          </p>
        </Card>
      </div>
    </>
  );
}

function exportConversationPdf(messages: ChatMessage[], assistantIdx: number, patientName: string | null) {
  // Find the user question that triggered this assistant message
  const assistant = messages[assistantIdx];
  let question = "";
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") { question = messages[i].content; break; }
  }
  const answer = stripCitations(assistant.content);
  const citations = assistant.citations ?? [];

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxW = pageW - margin * 2;
  let y = margin;

  function ensureSpace(h: number) {
    if (y + h > pageH - margin) { doc.addPage(); y = margin; }
  }

  function writeWrapped(text: string, opts: { size: number; bold?: boolean; color?: [number, number, number]; gap?: number }) {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size);
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(text || "", maxW) as string[];
    const lineH = opts.size * 1.35;
    for (const ln of lines) {
      ensureSpace(lineH);
      doc.text(ln, margin, y);
      y += lineH;
    }
    y += opts.gap ?? 8;
  }

  // Header
  writeWrapped("Consulta Psicoasist", { size: 18, bold: true, gap: 4 });
  const dateStr = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
  writeWrapped(dateStr + (patientName ? `   ·   Paciente: ${patientName}` : ""), {
    size: 10, color: [110, 110, 110], gap: 14,
  });

  // Question
  writeWrapped("Pregunta", { size: 12, bold: true, gap: 4 });
  writeWrapped(question, { size: 11, gap: 16 });

  // Answer
  writeWrapped("Respuesta", { size: 12, bold: true, gap: 4 });
  writeWrapped(answer, { size: 11, gap: 18 });

  // Citations
  if (citations.length > 0) {
    writeWrapped("Citas", { size: 12, bold: true, gap: 6 });
    citations.forEach((c, i) => {
      const head = `[${i + 1}] ${c.document_title}${c.author ? ` — ${c.author}` : ""}${c.year ? ` (${c.year})` : ""}${c.page_number ? `, p. ${c.page_number}` : ""}`;
      writeWrapped(head, { size: 11, bold: true, gap: 2 });
      writeWrapped(`"${c.excerpt}"`, { size: 10, color: [80, 80, 80], gap: 10 });
    });
  }

  const fname = `consulta-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
