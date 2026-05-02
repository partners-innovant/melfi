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
import { Send, Sparkles, MessageSquare, Plus, Menu, User as UserIcon, X, Copy, Download, Globe, Loader2, ExternalLink, Search, Plus as PlusIcon, Check, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import ResponseFeedbackBar from "@/components/ResponseFeedbackBar";
import { chunkText } from "@/lib/pdf";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
                    onSearchGeneral={() => searchGeneral(findPrevQuestion(messages, i))}
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
  message, question, conversationId, onCite, onExportPdf, onSearchGeneral,
}: {
  message: ChatMessage;
  question?: string;
  conversationId?: string | null;
  onCite: (c: Citation) => void;
  onExportPdf: () => void;
  onSearchGeneral: () => void;
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
    const re = /\s*\[cita:([^\]]+)\]/g;
    const out: Array<{ type: "text" | "cite"; value: string; cite?: Citation; idx?: number }> = [];
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(message.content)) !== null) {
      if (match.index > last) out.push({ type: "text", value: message.content.slice(last, match.index) });
      const id = match[1].trim();
      const found = citationsMap.get(id);
      if (found) {
        out.push({ type: "cite", value: id, cite: found.cite, idx: found.idx });
      }
      // Unknown chunk_id: drop silently — never expose raw markers to the user.
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

  const isEmpty = !message.content && (message.streaming || message.generalLoading);
  const isGeneral = !!message.general;
  const showGeneralFallback =
    !isGeneral &&
    !message.streaming &&
    !message.generalLoading &&
    !!message.content &&
    !message.content.startsWith("❌");

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0",
          isGeneral
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-primary-soft text-primary",
        )}
      >
        {isGeneral ? <Globe className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        {isGeneral && (
          <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400 mb-1">
            Conocimiento general
          </div>
        )}

        <div
          className={cn(
            "prose prose-sm max-w-none",
            isGeneral &&
              "rounded-lg border-l-4 border-amber-500/60 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2",
          )}
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap m-0">
            {isEmpty ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {message.generalLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Buscando en conocimiento general...
                  </>
                ) : (
                  <>
                    Pensando<span className="streaming-cursor">▍</span>
                  </>
                )}
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

        {showGeneralFallback && question && (
          <div className="mt-2 space-y-1">
            <button
              type="button"
              onClick={onSearchGeneral}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 hover:underline transition-colors"
            >
              <Globe className="h-3 w-3" />
              ¿Quieres complementar con el conocimiento general de Claude? →
            </button>
            <p className="text-[11px] text-muted-foreground/70 leading-snug">
              ⚠️ Las respuestas del conocimiento general no están basadas en documentos verificados y pueden contener inexactitudes.
            </p>
          </div>
        )}

        {!message.streaming && !message.generalLoading && message.content && !message.content.startsWith("❌") && (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={copyAnswer}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onExportPdf}>
              <Download className="h-3.5 w-3.5" /> Exportar como PDF
            </Button>
            {question && <WebSourcesButton question={question} />}
          </div>
        )}

        {!message.streaming && !message.generalLoading && message.content && !message.content.startsWith("❌") && question && (
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
  const [opening, setOpening] = useState(false);

  async function openFullDocument() {
    setOpening(true);
    try {
      const { data: chunk, error: chunkErr } = await supabase
        .from("document_chunks")
        .select("document_id")
        .eq("id", citation.chunk_id)
        .maybeSingle();
      if (chunkErr || !chunk) throw new Error("No se encontró el documento");

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .select("source_url, storage_path")
        .eq("id", chunk.document_id)
        .maybeSingle();
      if (docErr || !doc) throw new Error("No se encontró el documento");

      const d = doc as { source_url: string | null; storage_path: string | null };
      if (d.source_url) {
        window.open(d.source_url, "_blank", "noopener,noreferrer");
        return;
      }
      if (d.storage_path) {
        const { data: signed, error: sErr } = await supabase.storage
          .from("documents")
          .createSignedUrl(d.storage_path, 60 * 60);
        if (sErr || !signed?.signedUrl) throw new Error("No se pudo generar el enlace");
        window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
        return;
      }
      toast.error("Este documento no tiene archivo ni URL de origen.");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo abrir el documento");
    } finally {
      setOpening(false);
    }
  }

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
        <Button
          variant="outline"
          className="w-full gap-2 border-teal-500/60 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40 dark:hover:text-teal-300"
          onClick={openFullDocument}
          disabled={opening}
        >
          📄 Ver documento completo
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SUPERS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
function toSuper(n: number): string {
  return String(n).split("").map((d) => SUPERS[parseInt(d, 10)] ?? d).join("");
}

/** Render answer text to HTML: replace [cita:ID] with superscript numbers,
 *  apply **bold**, basic numbered/bulleted lists and paragraph breaks. */
function renderAnswerHtml(text: string, citations: Citation[]): string {
  const idxMap = new Map<string, number>();
  citations.forEach((c, i) => idxMap.set(c.chunk_id, i + 1));

  // Replace citation markers with styled superscripts (drop unknown IDs).
  let t = text.replace(/\s*\[cita:([^\]]+)\]/g, (_m, id: string) => {
    const idx = idxMap.get(id.trim());
    if (!idx) return "";
    return `__CITE_${idx}__`;
  });

  // Escape HTML, then re-insert tokens
  t = escapeHtml(t);
  t = t.replace(/__CITE_(\d+)__/g, (_m, n) =>
    `<sup style="color:#0d9488;font-weight:600;font-size:0.75em;">${toSuper(parseInt(n, 10))}</sup>`,
  );
  // Bold **text**
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Build block-level HTML from lines
  const lines = t.split(/\n/);
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const PBA = "page-break-inside:avoid;break-inside:avoid;";
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const bul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (num) {
      if (listType !== "ol") { closeList(); out.push('<ol style="margin:8px 0 8px 22px;padding:0;">'); listType = "ol"; }
      out.push(`<li style="margin:4px 0;${PBA}">${num[2]}</li>`);
    } else if (bul) {
      if (listType !== "ul") { closeList(); out.push('<ul style="margin:8px 0 8px 22px;padding:0;list-style:disc;">'); listType = "ul"; }
      out.push(`<li style="margin:4px 0;${PBA}">${bul[1]}</li>`);
    } else {
      closeList();
      out.push(`<p style="margin:8px 0;${PBA}">${line}</p>`);
    }
  }
  closeList();
  return out.join("");
}

async function exportConversationPdf(messages: ChatMessage[], assistantIdx: number, patientName: string | null) {
  const assistant = messages[assistantIdx];
  let question = "";
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") { question = messages[i].content; break; }
  }
  const citations = assistant.citations ?? [];
  const dateStr = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });

  const TEAL = "#0d9488"; // matches --primary teal
  const TEAL_DARK = "#0f766e";
  const GRAY = "#6b7280";
  const YELLOW_BG = "#fef3c7";

  const answerHtml = renderAnswerHtml(assistant.content, citations);
  const PBA = "page-break-inside:avoid;break-inside:avoid;";

  // A4 @ 96dpi = 794 x 1123px. Margins 60px all sides.
  const PAGE_W = 794;
  const PAGE_H = 1123;
  const MARGIN = 60;
  const CONTENT_W = PAGE_W - MARGIN * 2; // 674

  const headerHtml = `
    <div data-pdf-section style="${PBA}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="font-size:24px;font-weight:800;color:${TEAL};letter-spacing:-0.02em;">Psicoasist</div>
        <div style="font-size:11px;color:${GRAY};text-align:right;line-height:1.5;">${escapeHtml(dateStr)}</div>
      </div>
      ${patientName ? `<div style="margin-top:8px;font-size:13px;color:#374151;">Consulta sobre: <strong>${escapeHtml(patientName)}</strong></div>` : ""}
      <hr style="border:none;border-top:2px solid ${TEAL};margin:16px 0 20px 0;" />
    </div>
    <div data-pdf-section style="${PBA}">
      <h2 style="color:${TEAL_DARK};font-size:16px;font-weight:700;margin:0 0 8px 0;">Pregunta:</h2>
      <div style="font-size:13px;line-height:1.7;color:#111827;margin-bottom:20px;white-space:pre-wrap;">${escapeHtml(question)}</div>
    </div>
    <div data-pdf-section style="${PBA}">
      <h2 style="color:${TEAL_DARK};font-size:16px;font-weight:700;margin:0 0 8px 0;">Respuesta:</h2>
    </div>
  `;

  const citationsHtml = citations.length === 0 ? "" : `
    <div data-pdf-section style="${PBA}">
      <h2 style="color:${TEAL_DARK};font-size:16px;font-weight:700;margin:24px 0 12px 0;">Fuentes citadas:</h2>
    </div>
    ${citations.map((c, i) => `
      <div data-pdf-section style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;background:#ffffff;margin-bottom:12px;${PBA}">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="color:${TEAL};font-weight:700;font-size:11px;">[${i + 1}]</span>
          <div style="font-weight:700;color:#111827;font-size:11px;">${escapeHtml(c.document_title || "Sin título")}</div>
        </div>
        <div style="color:${GRAY};font-size:11px;margin-top:4px;line-height:1.7;">
          ${escapeHtml(c.author || "Autor desconocido")}${c.year ? ` · ${escapeHtml(c.year)}` : ""}${c.page_number ? ` · p. ${escapeHtml(String(c.page_number))}` : ""}
        </div>
        ${c.excerpt ? `<div style="margin-top:8px;background:${YELLOW_BG};padding:10px 12px;border-radius:4px;font-style:italic;color:#1f2937;font-size:11px;line-height:1.7;">"${escapeHtml(c.excerpt)}"</div>` : ""}
      </div>
    `).join("")}
  `;

  const footerHtml = `
    <div data-pdf-section style="margin-top:30px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:${GRAY};${PBA}">
      <span><strong style="color:${TEAL};">Generado por Psicoasist</strong></span>
      <span style="text-align:right;max-width:60%;">Las respuestas se basan únicamente en documentos clínicos verificados</span>
    </div>
  `;

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${CONTENT_W}px;background:#ffffff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.7;box-sizing:border-box;`;
  // Wrap answer paragraphs as individual sections for pagination
  const answerWrapped = `<div data-pdf-section style="${PBA}font-size:13px;line-height:1.7;color:#111827;">${answerHtml}</div>`;
  container.innerHTML = headerHtml + answerWrapped + citationsHtml + footerHtml;
  document.body.appendChild(container);

  try {
    // Capture each top-level section individually to avoid mid-content cuts
    const sections = Array.from(container.querySelectorAll<HTMLElement>(":scope > [data-pdf-section]"));
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const ptPageW = pdf.internal.pageSize.getWidth();
    const ptPageH = pdf.internal.pageSize.getHeight();
    const ptMargin = 60 * (ptPageW / PAGE_W); // scale 60px → pt
    const ptContentW = ptPageW - ptMargin * 2;
    const ptContentH = ptPageH - ptMargin * 2;

    const rendered: { data: string; ptH: number }[] = [];
    for (const sec of sections) {
      const c = await html2canvas(sec, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const ptH = (c.height * ptContentW) / c.width;
      rendered.push({ data: c.toDataURL("image/jpeg", 0.92), ptH });
    }

    let cursorY = ptMargin;
    let pageNum = 1;
    const pageStarts: number[] = [pageNum];
    for (const { data, ptH } of rendered) {
      if (cursorY + ptH > ptMargin + ptContentH && cursorY > ptMargin) {
        pdf.addPage();
        pageNum++;
        pageStarts.push(pageNum);
        cursorY = ptMargin;
      }
      pdf.addImage(data, "JPEG", ptMargin, cursorY, ptContentW, ptH);
      cursorY += ptH;
    }

    const totalPages = pageNum;
    if (totalPages > 1) {
      for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        pdf.setFontSize(9);
        pdf.setTextColor(120, 120, 120);
        pdf.text(`Página ${p} de ${totalPages}`, ptPageW / 2, ptPageH - 20, { align: "center" });
      }
    }

    pdf.save(`consulta-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    console.error("[pdf-export] failed", err);
    toast.error("No se pudo generar el PDF");
  } finally {
    document.body.removeChild(container);
  }
}

interface WebSource {
  title: string;
  authors: string;
  year: string;
  source: string;
  url: string;
  relevance: string;
}

function WebSourcesButton({ question }: { question: string }) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<WebSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  

  async function search() {
    if (sources && !error) {
      setSources(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("web-sources", {
        body: { question },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setSources((data?.sources ?? []) as WebSource[]);
    } catch (e: any) {
      setError(e?.message ?? "Error al buscar fuentes");
      toast.error(e?.message ?? "Error al buscar fuentes");
    } finally {
      setLoading(false);
    }
  }

  // importToLibrary removed — replaced by inline ImportSourceButton

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        onClick={search}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        🌐 Buscar otras fuentes en la web
      </Button>
      {sources && (
        <div className="basis-full mt-3">
          <Card className="p-3 space-y-3 bg-muted/30">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-muted-foreground leading-snug">
                ⚠️ Los enlaces son sugeridos por IA y pueden no estar disponibles. Verifica antes de importar.
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 -mr-1 -mt-1"
                onClick={() => setSources(null)}
                aria-label="Cerrar"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                No se encontraron fuentes para esta consulta.
              </p>
            ) : (
              <div className="space-y-2">
                {sources.map((s, i) => (
                  <div key={i} className="rounded-md border bg-background p-2.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug">{s.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.authors}{s.year ? ` · ${s.year}` : ""}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{s.source}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{s.relevance}</p>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => window.open(s.url, "_blank", "noopener,noreferrer")}
                      >
                        <ExternalLink className="h-3 w-3" /> Abrir fuente
                      </Button>
                      <ImportSourceButton url={s.url} />

                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

type ImportStatus = "idle" | "importing" | "done" | "error";

function ImportSourceButton({ url }: { url: string }) {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  async function handleImport() {
    setStatus("importing");
    setErrMsg("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("fetch-url-document", {
        body: { url },
      });
      if (error) throw new Error(error.message ?? "Error de servidor");
      if (!data?.ok) throw new Error(data?.error ?? "Error desconocido");

      const chunks = chunkText(data.text);
      if (chunks.length === 0) throw new Error("Sin contenido para indexar");

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          psychologist_id: user.id,
          title: data.title || url,
          author: data.author || null,
          year: data.year || null,
          document_type: data.document_type || "articulo_cientifico",
          is_global: true,
          storage_path: null,
          source_url: data.source_url || url,
          import_source: 'web_search',
        } as any)
        .select()
        .single();
      if (docErr) throw docErr;

      const batchSize = 8;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
          body: { input: batch.map((c) => c.content), input_type: "document" },
        });
        if (embErr) throw embErr;
        if (embData?.error) throw new Error(embData.error);
        const embeddings: number[][] = embData.embeddings;
        const rows = batch.map((c, idx) => ({
          document_id: doc.id,
          psychologist_id: user.id,
          chunk_index: c.index,
          content: c.content,
          page_number: c.page_number,
          embedding: embeddings[idx] as any,
        }));
        const { error: insErr } = await supabase.from("document_chunks").insert(rows);
        if (insErr) throw insErr;
      }

      setStatus("done");
      toast.success("Documento importado a tu biblioteca");
    } catch (e: any) {
      console.error("[import-source] failed:", e);
      const msg = e?.message ?? "Error al importar";
      setErrMsg(msg);
      setStatus("error");
      toast.error(msg);
    }
  }

  if (status === "done") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="h-7 px-2 text-xs gap-1 border-emerald-500/60 text-emerald-700 dark:text-emerald-400 disabled:opacity-100"
      >
        <Check className="h-3 w-3" /> Importado
      </Button>
    );
  }

  if (status === "error") {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              className="h-7 px-2 text-xs gap-1 border-destructive/60 text-destructive hover:bg-destructive/10"
            >
              <AlertCircle className="h-3 w-3" /> Error
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {errMsg || "Error al importar"} — Click para reintentar
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={status === "importing"}
      onClick={handleImport}
      className="h-7 px-2 text-xs gap-1 border-teal-500/60 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40"
    >
      {status === "importing" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Importando...
        </>
      ) : (
        <>
          <PlusIcon className="h-3 w-3" /> Importar a Psicoasist
        </>
      )}
    </Button>
  );
}
