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
import { Send, Sparkles, MessageSquare, Plus, Menu, User as UserIcon, X, Copy, Download, Globe, Loader2, ExternalLink, Search, Plus as PlusIcon, Check, AlertCircle, Filter, ChevronDown, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";
import { CLINICAL_AREAS, CLINICAL_AREA_LABELS, type ClinicalArea } from "@/lib/clinical-areas";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
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

// General clinical suggestions when no patient is selected (organized by clinical moment)
const GENERAL_SUGGESTIONS: { label: string; question: string }[] = [
  {
    label: "Antes de sesión",
    question: "¿Qué protocolo de evaluación inicial usar con un paciente que presenta síntomas mixtos de ansiedad y depresión?",
  },
  {
    label: "Antes de sesión",
    question: "¿Cómo estructurar las primeras 3 sesiones con un paciente resistente al proceso terapéutico?",
  },
  {
    label: "Durante el tratamiento",
    question: "¿Cuándo está indicado cambiar de enfoque terapéutico cuando no hay avance después de 3 meses?",
  },
  {
    label: "Durante el tratamiento",
    question: "¿Qué señales de alarma indican necesidad de derivación psiquiátrica urgente?",
  },
];

const CHILD_GENERAL_SUGGESTIONS: { label: string; question: string }[] = [
  { label: "Antes de sesión", question: "¿Qué actividades lúdicas recomiendas para trabajar regulación emocional en niños?" },
  { label: "Antes de sesión", question: "¿Cómo estructurar la primera sesión con un niño derivado por conducta disruptiva?" },
  { label: "Durante el tratamiento", question: "¿Qué incluir en el informe psicoeducativo para el colegio?" },
  { label: "Durante el tratamiento", question: "¿Cómo involucrar más a los apoderados en el proceso terapéutico?" },
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

  // Filters
  const ALL_AREAS: string[] = Array.from(CLINICAL_AREAS);
  const [yearFrom, setYearFrom] = useState<number | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<string[]>(ALL_AREAS);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [sourcesInitialized, setSourcesInitialized] = useState(false);

  // Dynamic per-patient suggestions cache (key = patient_id)
  const [suggestionsCache, setSuggestionsCache] = useState<Record<string, string[]>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const patientsMap = useMemo(
    () => new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`])),
    [patients],
  );

  const activePatientName = patientId !== NONE ? patientsMap.get(patientId) ?? null : null;

  const fetchPatientSuggestions = useCallback(async (force = false) => {
    if (patientId === NONE) return;
    if (!force && suggestionsCache[patientId]?.length) return;
    setLoadingSuggestions(true);
    try {
      const { data, error } = await supabase.functions.invoke("patient-suggestions", {
        body: { patient_id: patientId, patient_kind: patientKind },
      });
      if (error) throw new Error(error.message);
      const arr: string[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      if (arr.length) {
        setSuggestionsCache((c) => ({ ...c, [patientId]: arr }));
      }
    } catch (e: any) {
      console.error("[patient-suggestions]", e);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [patientId, patientKind, suggestionsCache]);

  useEffect(() => {
    if (patientId !== NONE && !suggestionsCache[patientId]) {
      void fetchPatientSuggestions();
    }
  }, [patientId, suggestionsCache, fetchPatientSuggestions]);

  useEffect(() => {
    (async () => {
      const table = patientKind === "child" ? "child_patients" : "patients";
      const { data } = await supabase
        .from(table).select("id, first_name, last_name").order("first_name");
      setPatients((data as Patient[]) ?? []);
    })();
  }, [patientKind]);

  // Load distinct source institutions present in the library
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("documents")
        .select("source_institution")
        .not("source_institution", "is", null);
      const uniq = Array.from(
        new Set(((data as any[]) ?? []).map((r) => r.source_institution).filter(Boolean) as string[]),
      ).sort();
      setAvailableSources(uniq);
      setSelectedSources(uniq);
      setSourcesInitialized(true);
    })();
  }, []);

  function resetFilters() {
    setYearFrom(null);
    setSelectedAreas(ALL_AREAS);
    setSelectedSources(availableSources);
  }

  const yearFromActive = yearFrom !== null;
  const areasActive = selectedAreas.length !== ALL_AREAS.length;
  const sourcesActive = sourcesInitialized && selectedSources.length !== availableSources.length;
  const anyFilterActive = yearFromActive || areasActive || sourcesActive;

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
    resetFilters();
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

  async function send(textOverride?: string, opts?: { mode?: string }) {
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
          year_from: yearFrom,
          clinical_areas: areasActive ? selectedAreas : null,
          source_institutions: sourcesActive ? selectedSources : null,
          conversation_id: conversationId,
          mode: opts?.mode,
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

        {/* Filter bar */}
        <div className="px-4 md:px-6 pt-3">
          <FilterBar
            yearFrom={yearFrom}
            setYearFrom={setYearFrom}
            allAreas={ALL_AREAS}
            selectedAreas={selectedAreas}
            setSelectedAreas={setSelectedAreas}
            availableSources={availableSources}
            selectedSources={selectedSources}
            setSelectedSources={setSelectedSources}
            anyActive={anyFilterActive}
            onReset={resetFilters}
          />
        </div>

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
              <FilterIndicator
                yearFrom={yearFrom}
                areasCount={selectedAreas.length}
                allAreasCount={ALL_AREAS.length}
                sourcesCount={selectedSources.length}
                allSourcesCount={availableSources.length}
              />
              <p className="text-[11px] text-muted-foreground mt-2 text-center">
                Las respuestas se basan en documentos clínicos y el perfil ingresado. Verifica siempre con tu criterio profesional.
              </p>
              <SuggestionChips
                patientId={patientId}
                patientKind={patientKind}
                patientName={activePatientName}
                dynamic={patientId !== NONE ? suggestionsCache[patientId] ?? [] : []}
                loading={loadingSuggestions}
                onPick={(s) => setInput(s)}
                onAutoSend={(text, mode) => send(text, { mode })}
                onRefresh={() => fetchPatientSuggestions(true)}
              />

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
                <FilterIndicator
                  yearFrom={yearFrom}
                  areasCount={selectedAreas.length}
                  allAreasCount={ALL_AREAS.length}
                  sourcesCount={selectedSources.length}
                  allSourcesCount={availableSources.length}
                />
                <p className="text-[11px] text-muted-foreground mt-2 text-center">
                  Las respuestas se basan en documentos clínicos y el perfil ingresado. Verifica siempre con tu criterio profesional.
                </p>
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

function SuggestionChips({
  patientId, patientKind, patientName, dynamic, loading, onPick, onAutoSend, onRefresh,
}: {
  patientId: string;
  patientKind: "adult" | "child";
  patientName: string | null;
  dynamic: string[];
  loading: boolean;
  onPick: (s: string) => void;
  onAutoSend: (text: string, mode?: string) => void;
  onRefresh: () => void;
}) {
  const hasPatient = patientId !== NONE;

  if (hasPatient) {
    const debateLabel = `🧠 Debatir diagnóstico de ${patientName ?? "este paciente"}`;
    const debateMessage = `Quiero debatir el diagnóstico de ${patientName ?? "este paciente"} basándome en su perfil clínico.`;

    const followUpChips = [
      "¿Qué test confirmaría esto?",
      "¿Cómo descartar el diagnóstico alternativo más probable?",
      "¿Qué dice la evidencia sobre este diagnóstico?",
      "Explorar comorbilidades",
      "Cambiar hipótesis diagnóstica",
    ];

    return (
      <div className="mt-5 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-muted-foreground">
              {patientName ? `Sugerencias para ${patientName}` : "Sugerencias para este paciente"}
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              Actualizar sugerencias
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAutoSend(debateMessage, "diagnosis_debate")}
              className="text-left text-sm border rounded-full px-3.5 py-2 bg-teal-500/10 border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20 transition-colors font-medium"
            >
              {debateLabel}
            </button>
            {loading && dynamic.length === 0 ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 w-48 rounded-full border border-border bg-muted/30 animate-pulse" />
              ))
            ) : (
              dynamic.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPick(s)}
                  className="text-left text-sm border border-border rounded-full px-3.5 py-2 hover:bg-accent hover:border-primary/40 transition-colors"
                >
                  {s}
                </button>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Profundizar el debate</div>
          <div className="flex flex-wrap gap-2">
            {followUpChips.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="text-left text-xs border border-border rounded-full px-3 py-1.5 hover:bg-accent hover:border-primary/40 transition-colors text-muted-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const groups = patientKind === "child" ? CHILD_GENERAL_SUGGESTIONS : GENERAL_SUGGESTIONS;
  const byLabel = new Map<string, string[]>();
  for (const g of groups) {
    if (!byLabel.has(g.label)) byLabel.set(g.label, []);
    byLabel.get(g.label)!.push(g.question);
  }

  return (
    <div className="mt-5 space-y-3">
      {Array.from(byLabel.entries()).map(([label, qs]) => (
        <div key={label}>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
          <div className="flex flex-wrap gap-2">
            {qs.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="text-left text-sm border border-border rounded-full px-3.5 py-2 hover:bg-accent hover:border-primary/40 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ))}
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex gap-2 items-end">
      <div className="relative flex-1">
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pregunta clínica..."
          className="min-h-[52px] max-h-40 resize-none rounded-2xl pb-8"
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={busy}
        />
        <div className="absolute bottom-2 right-3">
          <ImprovePromptButton value={value} onChange={onChange} textareaRef={taRef} disabled={busy} />
        </div>
      </div>
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

  const TEAL = "#0d9488";
  const GRAY = "#666";
  const answerHtml = renderAnswerHtml(assistant.content, citations);

  const citationsBlock = citations.length === 0 ? "" : `
    <div>
      <p style="color:${TEAL}; font-weight:700; font-size:14px; margin-bottom:12px">Fuentes citadas:</p>
      ${citations.map((c, i) => `
        <div style="border:1px solid #e5e7eb; border-radius:8px; padding:14px; margin-bottom:10px; page-break-inside:avoid">
          <p style="font-weight:600; margin:0 0 4px">${i + 1}. ${escapeHtml(c.document_title || "Sin título")}</p>
          <p style="color:#666; font-size:11px; margin:0 0 8px">${escapeHtml(c.author || "Autor desconocido")}${c.year ? ` · ${escapeHtml(c.year)}` : ""}${c.page_number ? ` · p. ${escapeHtml(String(c.page_number))}` : ""}</p>
          ${c.excerpt ? `<p style="background:#fef9c3; padding:8px; border-radius:4px; font-style:italic; font-size:12px; margin:0">"${escapeHtml(c.excerpt)}"</p>` : ""}
        </div>
      `).join("")}
    </div>
  `;

  const container = document.createElement("div");
  container.id = "pdf-export-content";
  container.style.cssText = "width:794px; padding:60px; font-family:Inter,sans-serif; font-size:13px; line-height:1.7; background:white; color:#1a1a1a; box-sizing:border-box; visibility:hidden; position:absolute; left:-9999px; top:0;";
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:24px">
      <span style="color:${TEAL}; font-size:20px; font-weight:700">Psicoasist</span>
      <span style="color:${GRAY}; font-size:11px">${escapeHtml(dateStr)}</span>
    </div>
    ${patientName ? `<div style="font-size:12px; color:#444; margin-bottom:16px">Consulta sobre: <strong>${escapeHtml(patientName)}</strong></div>` : ""}
    <hr style="border:none; border-top:2px solid ${TEAL}; margin-bottom:24px">
    <div style="margin-bottom:20px">
      <p style="color:${TEAL}; font-weight:700; font-size:15px; margin-bottom:8px">Pregunta:</p>
      <p style="margin:0; white-space:pre-wrap">${escapeHtml(question)}</p>
    </div>
    <div style="margin-bottom:28px">
      <p style="color:${TEAL}; font-weight:700; font-size:15px; margin-bottom:8px">Respuesta:</p>
      <div>${answerHtml}</div>
    </div>
    ${citationsBlock}
    <div style="margin-top:40px; padding-top:16px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between">
      <span style="color:${TEAL}; font-weight:600; font-size:11px">Generado por Psicoasist</span>
      <span style="color:#999; font-size:10px">Las respuestas se basan únicamente en documentos clínicos verificados</span>
    </div>
  `;
  document.body.appendChild(container);

  // Wait for fonts/layout to settle
  await new Promise((r) => setTimeout(r, 500));

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794,
      onclone: (clonedDoc) => {
        const el = clonedDoc.getElementById("pdf-export-content");
        if (el) {
          el.style.width = "794px";
          el.style.position = "static";
          el.style.left = "auto";
          el.style.visibility = "visible";
          el.style.display = "block";
        }
      },
    });

    // A4 page in canvas pixels at scale 2
    const PAGE_W = 794 * 2;   // 1588
    const PAGE_H = 1123 * 2;  // 2246

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const PDF_W_MM = 210;
    const PDF_H_MM = 297;

    let currentY = 0;
    let pageNum = 0;
    while (currentY < canvas.height) {
      const sliceH = Math.min(PAGE_H, canvas.height - currentY);

      // Avoid cutting mid-paragraph: scan upward for a horizontal band of mostly-white pixels
      let cutH = sliceH;
      if (currentY + sliceH < canvas.height) {
        const ctxFull = canvas.getContext("2d");
        if (ctxFull) {
          const scanFromTop = Math.max(0, sliceH - 300); // search last 300px of slice
          try {
            const imgData = ctxFull.getImageData(0, currentY + scanFromTop, canvas.width, sliceH - scanFromTop);
            const rows = imgData.height;
            const cols = imgData.width;
            // walk from bottom up, find a row where >99% of pixels are near-white
            for (let r = rows - 1; r >= 0; r--) {
              let whiteCount = 0;
              const rowOffset = r * cols * 4;
              for (let c = 0; c < cols; c++) {
                const i = rowOffset + c * 4;
                const rr = imgData.data[i], gg = imgData.data[i + 1], bb = imgData.data[i + 2];
                if (rr > 240 && gg > 240 && bb > 240) whiteCount++;
              }
              if (whiteCount / cols > 0.995) {
                cutH = scanFromTop + r;
                break;
              }
            }
            if (cutH < sliceH * 0.5) cutH = sliceH; // fallback if no good break found
          } catch {
            cutH = sliceH;
          }
        }
      }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = PAGE_W;
      tempCanvas.height = PAGE_H;
      const tctx = tempCanvas.getContext("2d");
      if (tctx) {
        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, PAGE_W, PAGE_H);
        tctx.drawImage(canvas, 0, currentY, PAGE_W, cutH, 0, 0, PAGE_W, cutH);
      }

      const pageImg = tempCanvas.toDataURL("image/jpeg", 0.92);
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(pageImg, "JPEG", 0, 0, PDF_W_MM, PDF_H_MM);

      currentY += cutH;
      pageNum++;
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

// --- duplicate detection helpers ---
function normalizeUrl(u: string): string {
  if (!u) return "";
  try {
    const url = new URL(u.trim());
    let host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function normalizeTitle(t: string): string {
  return (t || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const A = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 2));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function WebSourcesButton({ question }: { question: string }) {
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<WebSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingDocs, setExistingDocs] = useState<Array<{ title: string; source_url: string | null }>>([]);
  const navigate = useNavigate();

  async function search() {
    if (sources && !error) {
      setSources(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data, error: fnErr }, docsRes] = await Promise.all([
        supabase.functions.invoke("web-sources", { body: { question } }),
        supabase.from("documents").select("title, source_url"),
      ]);
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setExistingDocs((docsRes.data as any[]) ?? []);
      setSources((data?.sources ?? []) as WebSource[]);
    } catch (e: any) {
      setError(e?.message ?? "Error al buscar fuentes");
      toast.error(e?.message ?? "Error al buscar fuentes");
    } finally {
      setLoading(false);
    }
  }

  function isDuplicate(s: WebSource): boolean {
    const nu = normalizeUrl(s.url);
    for (const d of existingDocs) {
      if (d.source_url && nu && normalizeUrl(d.source_url) === nu) return true;
      if (titleSimilarity(s.title, d.title) > 0.8) return true;
    }
    return false;
  }

  function handleManualUpload() {
    setSources(null);
    navigate("/documents?upload=1");
  }

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
                {sources.map((s, i) => {
                  const dup = isDuplicate(s);
                  return (
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
                        {dup ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="h-7 px-2 text-xs gap-1 border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-950/30 disabled:opacity-100"
                          >
                            <Check className="h-3 w-3" /> Ya en tu biblioteca
                          </Button>
                        ) : (
                          <ImportSourceButton url={s.url} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Manual upload fallback */}
            <div className="pt-2 border-t border-border/60">
              <div className="rounded-md border border-dashed bg-background/60 p-3 space-y-2">
                <div className="text-sm font-medium">📁 ¿Tienes el documento en tu computador?</div>
                <p className="text-xs text-muted-foreground leading-snug">
                  Si ya descargaste alguno de estos documentos, puedes subirlo directamente.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualUpload}
                  className="h-8 px-3 text-xs gap-1.5 border-teal-500/60 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-950/40"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Subir documento manualmente
                </Button>
              </div>
            </div>
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

// ============================== Filter Bar ==============================
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2000 + 1 }, (_, i) => CURRENT_YEAR - i);

function FilterBar({
  yearFrom, setYearFrom,
  allAreas, selectedAreas, setSelectedAreas,
  availableSources, selectedSources, setSelectedSources,
  anyActive, onReset,
}: {
  yearFrom: number | null;
  setYearFrom: (v: number | null) => void;
  allAreas: string[];
  selectedAreas: string[];
  setSelectedAreas: (v: string[]) => void;
  availableSources: string[];
  selectedSources: string[];
  setSelectedSources: (v: string[]) => void;
  anyActive: boolean;
  onReset: () => void;
}) {
  const yearActive = yearFrom !== null;
  const areasActive = selectedAreas.length !== allAreas.length;
  const sourcesActive = selectedSources.length !== availableSources.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              yearActive
                ? "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/40"
                : "bg-muted text-muted-foreground border-border hover:bg-accent",
            )}
          >
            <Filter className="h-3 w-3" />
            {yearActive ? `Desde ${yearFrom}` : "Todos los años"}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1 max-h-72 overflow-y-auto" align="start">
          <button
            onClick={() => setYearFrom(null)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent",
              yearFrom === null && "bg-accent font-medium",
            )}
          >
            Todos los años
          </button>
          {YEAR_OPTIONS.map((y) => (
            <button
              key={y}
              onClick={() => setYearFrom(y)}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent",
                yearFrom === y && "bg-accent font-medium",
              )}
            >
              Desde {y}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <MultiPill
        active={areasActive}
        labelAll="Todas las áreas"
        labelActive={`${selectedAreas.length} áreas`}
        items={allAreas}
        getLabel={(v) => CLINICAL_AREA_LABELS[v as ClinicalArea] ?? v}
        selected={selectedAreas}
        onChange={setSelectedAreas}
      />

      <MultiPill
        active={sourcesActive}
        labelAll="Todas las fuentes"
        labelActive={`${selectedSources.length} fuentes`}
        items={availableSources}
        getLabel={(v) => v}
        selected={selectedSources}
        onChange={setSelectedSources}
        emptyHint="No hay fuentes disponibles"
      />

      {anyActive && (
        <button
          onClick={onReset}
          className="ml-auto text-xs text-teal-600 hover:text-teal-700 dark:text-teal-400 underline-offset-2 hover:underline"
        >
          Restablecer filtros
        </button>
      )}
    </div>
  );
}

function MultiPill({
  active, labelAll, labelActive, items, getLabel, selected, onChange, emptyHint,
}: {
  active: boolean;
  labelAll: string;
  labelActive: string;
  items: string[];
  getLabel: (v: string) => string;
  selected: string[];
  onChange: (v: string[]) => void;
  emptyHint?: string;
}) {
  function toggle(v: string) {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            active
              ? "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/40"
              : "bg-muted text-muted-foreground border-border hover:bg-accent",
          )}
        >
          <Filter className="h-3 w-3" />
          {active ? labelActive : labelAll}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 max-h-80 overflow-y-auto" align="start">
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">{emptyHint ?? "Sin opciones"}</div>
        ) : (
          <>
            <div className="flex items-center justify-between px-1 pb-2 border-b border-border mb-1">
              <button onClick={() => onChange(items)} className="text-[11px] text-teal-600 hover:underline">Todos</button>
              <button onClick={() => onChange([])} className="text-[11px] text-muted-foreground hover:underline">Ninguno</button>
            </div>
            {items.map((v) => (
              <label
                key={v}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm"
              >
                <Checkbox checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
                <span className="truncate">{getLabel(v)}</span>
              </label>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterIndicator({
  yearFrom, areasCount, allAreasCount, sourcesCount, allSourcesCount,
}: {
  yearFrom: number | null;
  areasCount: number;
  allAreasCount: number;
  sourcesCount: number;
  allSourcesCount: number;
}) {
  const yearActive = yearFrom !== null;
  const areasActive = areasCount !== allAreasCount;
  const sourcesActive = sourcesCount !== allSourcesCount;
  if (!yearActive && !areasActive && !sourcesActive) return null;
  const parts: string[] = [];
  if (yearActive) parts.push(`desde ${yearFrom}`);
  if (areasActive) parts.push(`${areasCount} ${areasCount === 1 ? "área" : "áreas"}`);
  if (sourcesActive) parts.push(`${sourcesCount} ${sourcesCount === 1 ? "fuente" : "fuentes"}`);
  return (
    <div className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
      <Filter className="h-3 w-3" />
      Buscando en documentos {parts.join(" · ")}
    </div>
  );
}
