import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Sparkles, MessageSquare } from "lucide-react";
import { DOC_TYPES, DOC_TYPE_LABELS, DocType } from "@/lib/clinical";

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
}

interface Patient { id: string; first_name: string; last_name: string; }

const ALL = "__all__";
const NONE = "__none__";

export default function Assistant() {
  const [params] = useSearchParams();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<string>(params.get("patient") ?? NONE);
  const [docType, setDocType] = useState<string>(ALL);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("patients").select("id, first_name, last_name").order("first_name");
      setPatients((data as Patient[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesión expirada");

      // 1. Embed query
      const { data: embData, error: embErr } = await supabase.functions.invoke("voyage-embed", {
        body: { input: q, input_type: "query" },
      });
      if (embErr) throw embErr;
      if (embData?.error) throw new Error(embData.error);
      const query_embedding = embData.embeddings[0];

      // 2. Call claude-chat
      const { data, error } = await supabase.functions.invoke("claude-chat", {
        body: {
          question: q,
          query_embedding,
          patient_id: patientId !== NONE ? patientId : null,
          document_type: docType !== ALL ? docType : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMessages((m) => [...m, {
        role: "assistant",
        content: data.answer,
        citations: data.citations ?? [],
      }]);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Error al consultar");
      setMessages((m) => [...m, {
        role: "assistant",
        content: "Ocurrió un error al procesar tu consulta. Intenta nuevamente.",
        citations: [],
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 md:px-6 py-3 flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex items-center gap-2">
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 && (
            <Card className="p-8 text-center">
              <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium mb-1">Comienza una consulta</p>
              <p className="text-sm text-muted-foreground">
                Pregunta sobre intervenciones clínicas, diagnósticos diferenciales, evidencia, ética profesional...<br/>
                Las respuestas se basan únicamente en tus documentos cargados.
              </p>
            </Card>
          )}
          {messages.map((m, i) => (
            <Message key={i} message={m} onCite={setActiveCitation} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
              Pensando...
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card px-4 md:px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregunta clínica..."
            className="min-h-[44px] max-h-32 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          <Button onClick={send} disabled={busy || !input.trim()} size="icon" className="h-11 w-11 flex-shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
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

function Message({ message, onCite }: { message: ChatMessage; onCite: (c: Citation) => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // Render assistant: replace [cita:CHUNK_ID] with clickable sup
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

  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center flex-shrink-0">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm max-w-none">
          <p className="text-sm leading-relaxed whitespace-pre-wrap m-0">
            {parts.map((p, i) =>
              p.type === "text" ? (
                <span key={i}>{p.value}</span>
              ) : (
                <sup
                  key={i}
                  className="citation-mark"
                  onClick={() => onCite(p.cite!)}
                >
                  {p.idx}
                </sup>
              )
            )}
          </p>
        </div>
        {(message.citations?.length ?? 0) > 0 && (
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
      </div>
    </div>
  );
}

function CitationPanel({ citation }: { citation: Citation }) {
  // Highlight first chunk of excerpt - we just show full excerpt highlighted
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
