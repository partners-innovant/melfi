import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, Target, User as UserIcon, Globe, Brain, Save, RotateCcw, FileDown, History } from "lucide-react";

type FeedbackType = "sesion" | "paciente" | "global";
type Step = 1 | 2 | 3 | 4;

type Dimension = {
  id: string;
  title: string;
  icon: string;
  rating: "fortaleza" | "mejora" | "atencion";
  summary: string;
  observations: string[];
  suggestions: string[];
  quotes: string[];
};

type FeedbackContent = {
  dimensions: Dimension[];
  strengths: string[];
  improvements: string[];
  recommended_reading: string[];
  overall_summary: string;
};

type PatientOpt = { id: string; name: string; kind: "adult" | "child" };
type SessionOpt = { id: string; session_date: string; session_number: number | null; emotional_state: string | null };

const ratingMeta: Record<Dimension["rating"], { label: string; cls: string }> = {
  fortaleza: { label: "🟢 Fortaleza", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  mejora: { label: "🟡 Área de mejora", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  atencion: { label: "🔴 Atención prioritaria", cls: "bg-red-100 text-red-800 border-red-200" },
};

const LOADING_STEPS = [
  "📖 Leyendo notas de sesión...",
  "🔍 Analizando patrones clínicos...",
  "💡 Generando recomendaciones...",
];

export default function ProfessionalDevelopment() {
  const { user } = useAuth();
  const [params] = useSearchParams();

  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<FeedbackType | null>(null);

  const [patients, setPatients] = useState<PatientOpt[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientOpt | null>(null);

  const [sessions, setSessions] = useState<SessionOpt[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionOpt | null>(null);

  const [dateRange, setDateRange] = useState<"1m" | "3m" | "6m" | "custom">("3m");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackContent | null>(null);
  const [analysisInput, setAnalysisInput] = useState<any>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<any[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  // Load patients
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: a }, { data: c }] = await Promise.all([
        supabase.from("patients").select("id,first_name,last_name").eq("psychologist_id", user.id),
        supabase.from("child_patients").select("id,first_name,last_name").eq("psychologist_id", user.id),
      ]);
      const list: PatientOpt[] = [
        ...(a ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, kind: "adult" as const })),
        ...(c ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, kind: "child" as const })),
      ].sort((x, y) => x.name.localeCompare(y.name));
      setPatients(list);
    })();
  }, [user]);

  // Load history
  const loadHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("professional_feedback")
      .select("*")
      .eq("psychologist_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data ?? []);
  };
  useEffect(() => { loadHistory(); }, [user]);

  // URL pre-selection
  useEffect(() => {
    const sId = params.get("session_id");
    const pId = params.get("patient_id");
    const cpId = params.get("child_patient_id");
    if (sId) {
      setType("sesion");
      setStep(2);
    } else if (pId || cpId) {
      setType("paciente");
      setStep(2);
    }
    if (pId && patients.length) {
      const found = patients.find((p) => p.id === pId && p.kind === "adult");
      if (found) setSelectedPatient(found);
    }
    if (cpId && patients.length) {
      const found = patients.find((p) => p.id === cpId && p.kind === "child");
      if (found) setSelectedPatient(found);
    }
  }, [params, patients]);

  // Load sessions for selected patient
  useEffect(() => {
    if (!selectedPatient || type !== "sesion") return;
    (async () => {
      const col = selectedPatient.kind === "adult" ? "patient_id" : "child_patient_id";
      const { data } = await supabase
        .from("sessions")
        .select("id,session_date,session_number,emotional_state")
        .eq(col, selectedPatient.id)
        .order("session_date", { ascending: false });
      setSessions((data ?? []) as SessionOpt[]);
      const sId = params.get("session_id");
      if (sId) {
        const found = (data ?? []).find((s: any) => s.id === sId);
        if (found) setSelectedSession(found as SessionOpt);
      }
    })();
  }, [selectedPatient, type, params]);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.toLowerCase().trim();
    if (!q) return patients;
    return patients.filter((p) => p.name.toLowerCase().includes(q));
  }, [patients, patientSearch]);

  function computeDates(): { from?: string; to?: string } {
    if (dateRange === "custom") return { from: dateFrom || undefined, to: dateTo || undefined };
    const to = new Date();
    const from = new Date();
    const months = dateRange === "1m" ? 1 : dateRange === "3m" ? 3 : 6;
    from.setMonth(from.getMonth() - months);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }

  async function runAnalysis() {
    if (!type) return;
    setAnalyzing(true);
    setStep(3);
    setLoadingStep(0);
    const interval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 2500);

    try {
      const dates = type === "sesion" ? {} : computeDates();
      const payload: any = { feedback_type: type, ...dates };
      if (type === "sesion") {
        payload.session_id = selectedSession?.id;
        if (selectedPatient?.kind === "adult") payload.patient_id = selectedPatient.id;
        else if (selectedPatient?.kind === "child") payload.child_patient_id = selectedPatient.id;
      } else if (type === "paciente" && selectedPatient) {
        if (selectedPatient.kind === "adult") payload.patient_id = selectedPatient.id;
        else payload.child_patient_id = selectedPatient.id;
      }

      const { data, error } = await supabase.functions.invoke("professional-feedback", { body: payload });
      if (error) throw error;
      if (!data?.feedback) throw new Error("Respuesta vacía");
      setFeedback(data.feedback as FeedbackContent);
      setAnalysisInput(data.analysis_input);
      setStep(4);
    } catch (e: any) {
      toast({ title: "Error generando análisis", description: e?.message ?? "Error desconocido", variant: "destructive" });
      setStep(2);
    } finally {
      clearInterval(interval);
      setAnalyzing(false);
    }
  }

  async function saveFeedback() {
    if (!feedback || !user || !type) return;
    setSaving(true);
    const dates = type === "sesion" ? {} : computeDates();
    const row: any = {
      psychologist_id: user.id,
      feedback_type: type,
      analysis_input: analysisInput,
      feedback_content: feedback,
      date_from: (dates as any).from ?? null,
      date_to: (dates as any).to ?? null,
    };
    if (type === "sesion") row.session_id = selectedSession?.id ?? null;
    if (selectedPatient?.kind === "adult") row.patient_id = selectedPatient.id;
    if (selectedPatient?.kind === "child") row.child_patient_id = selectedPatient.id;

    const { error } = await supabase.from("professional_feedback").insert(row);
    setSaving(false);
    if (error) {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Análisis guardado" });
      loadHistory();
    }
  }

  function exportPDF() {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Análisis profesional</title>
      <style>body{font-family:system-ui,sans-serif;max-width:780px;margin:24px auto;padding:0 24px;color:#222;}
      h1{color:#0d9488}h2{color:#0f766e;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:24px}
      .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:12px;background:#e6fffa;color:#0f766e}
      .quote{border-left:3px solid #ccc;padding-left:8px;color:#555;font-style:italic;margin:6px 0}
      ul{margin:6px 0 14px 18px}</style></head><body>
      <h1>📈 Psicoasist · Desarrollo profesional</h1>
      <p><strong>Tipo:</strong> ${type} · <strong>Fecha:</strong> ${new Date().toLocaleDateString("es-CL")}</p>
      <h2>Resumen general</h2><p>${feedback?.overall_summary ?? ""}</p>
      ${feedback?.dimensions.map((d) => `
        <h2>${d.icon} ${d.title} <span class="badge">${ratingMeta[d.rating]?.label ?? d.rating}</span></h2>
        <p><strong>${d.summary}</strong></p>
        ${d.observations.length ? `<h3>Observaciones</h3><ul>${d.observations.map((o) => `<li>${o}</li>`).join("")}</ul>` : ""}
        ${d.suggestions.length ? `<h3>Sugerencias</h3><ul>${d.suggestions.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
        ${d.quotes?.length ? `<h3>De tus notas</h3>${d.quotes.map((q) => `<div class="quote">"${q}"</div>`).join("")}` : ""}
      `).join("") ?? ""}
      <h2>✅ Fortalezas</h2><ul>${feedback?.strengths.map((s) => `<li>${s}</li>`).join("") ?? ""}</ul>
      <h2>⚠️ Áreas de mejora</h2><ul>${feedback?.improvements.map((s) => `<li>${s}</li>`).join("") ?? ""}</ul>
      ${feedback?.recommended_reading?.length ? `<h2>📚 Lecturas</h2><ul>${feedback.recommended_reading.map((s) => `<li>${s}</li>`).join("")}</ul>` : ""}
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  function reset() {
    setStep(1);
    setType(null);
    setSelectedPatient(null);
    setSelectedSession(null);
    setSessions([]);
    setFeedback(null);
    setAnalysisInput(null);
    setExpanded({});
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">📈 Desarrollo profesional</h1>
        <p className="text-muted-foreground">Análisis clínico basado en tus sesiones y notas</p>
      </header>

      {step === 1 && (
        <div className="grid md:grid-cols-3 gap-4">
          {([
            { t: "sesion", icon: <Target className="h-6 w-6" />, emoji: "🎯", title: "Sesión puntual", desc: "Analiza una sesión específica — qué funcionó, qué mejorar, preguntas alternativas" },
            { t: "paciente", icon: <UserIcon className="h-6 w-6" />, emoji: "👤", title: "Por paciente", desc: "Analiza tu trabajo con un paciente en un período — progreso, patrones, coherencia terapéutica" },
            { t: "global", icon: <Globe className="h-6 w-6" />, emoji: "🌐", title: "Análisis global", desc: "Analiza tu práctica completa — patrones como terapeuta, fortalezas y áreas de desarrollo" },
          ] as { t: FeedbackType; icon: any; emoji: string; title: string; desc: string }[]).map((c) => (
            <Card
              key={c.t}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all"
              onClick={() => { setType(c.t); setStep(2); }}
            >
              <CardHeader>
                <div className="text-3xl">{c.emoji}</div>
                <CardTitle className="text-lg">{c.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{c.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {step === 2 && type && (
        <Card>
          <CardHeader>
            <CardTitle>Configuración del análisis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(type === "sesion" || type === "paciente") && (
              <div className="space-y-2">
                <Label>Paciente</Label>
                <Input placeholder="Buscar paciente..." value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} />
                <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
                  {filteredPatients.map((p) => (
                    <button
                      key={`${p.kind}-${p.id}`}
                      onClick={() => { setSelectedPatient(p); setSelectedSession(null); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selectedPatient?.id === p.id && selectedPatient?.kind === p.kind ? "bg-primary/10" : ""}`}
                    >
                      {p.name} <span className="text-xs text-muted-foreground">· {p.kind === "adult" ? "Adulto" : "Infanto"}</span>
                    </button>
                  ))}
                  {filteredPatients.length === 0 && (
                    <div className="px-3 py-4 text-sm text-muted-foreground">Sin resultados</div>
                  )}
                </div>
              </div>
            )}

            {type === "sesion" && selectedPatient && (
              <div className="space-y-2">
                <Label>Sesión</Label>
                <div className="max-h-56 overflow-y-auto border rounded-md divide-y">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSession(s)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selectedSession?.id === s.id ? "bg-primary/10" : ""}`}
                    >
                      {s.session_date} · Sesión #{s.session_number ?? "?"} {s.emotional_state ? `· ${s.emotional_state}` : ""}
                    </button>
                  ))}
                  {sessions.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">Este paciente no tiene sesiones</div>}
                </div>
              </div>
            )}

            {(type === "paciente" || type === "global") && (
              <div className="space-y-2">
                <Label>Período</Label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { v: "1m", l: "Último mes" },
                    { v: "3m", l: "Últimos 3 meses" },
                    { v: "6m", l: "Últimos 6 meses" },
                    { v: "custom", l: "Personalizado" },
                  ] as const).map((o) => (
                    <Button
                      key={o.v}
                      type="button"
                      variant={dateRange === o.v ? "default" : "outline"}
                      size="sm"
                      onClick={() => setDateRange(o.v)}
                    >
                      {o.l}
                    </Button>
                  ))}
                </div>
                {dateRange === "custom" && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-xs">Desde</Label>
                      <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Hasta</Label>
                      <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => { setStep(1); setType(null); }}>← Volver</Button>
              <Button
                onClick={runAnalysis}
                disabled={
                  (type === "sesion" && (!selectedPatient || !selectedSession)) ||
                  (type === "paciente" && !selectedPatient)
                }
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                <Brain className="h-4 w-4 mr-1" />
                {type === "sesion" ? "Analizar sesión" : type === "paciente" ? "Analizar paciente" : "Analizar práctica"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && analyzing && (
        <Card>
          <CardContent className="py-12 space-y-3 text-center">
            {LOADING_STEPS.map((s, i) => (
              <div key={s} className={`text-base ${i <= loadingStep ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
                {i === loadingStep ? <span className="animate-pulse">{s}</span> : s}
              </div>
            ))}
            <Skeleton className="h-2 w-2/3 mx-auto mt-6" />
          </CardContent>
        </Card>
      )}

      {step === 4 && feedback && (
        <div className="space-y-4">
          <Card className="bg-amber-50 border-amber-200">
            <CardHeader>
              <CardTitle className="text-amber-900">Resumen general</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-amber-900/90 leading-relaxed">{feedback.overall_summary}</p>
            </CardContent>
          </Card>

          {feedback.dimensions.map((d) => {
            const open = !!expanded[d.id];
            return (
              <Card key={d.id}>
                <Collapsible open={open} onOpenChange={(v) => setExpanded((p) => ({ ...p, [d.id]: v }))}>
                  <CollapsibleTrigger className="w-full text-left">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{d.icon}</span>
                        <div>
                          <div className="font-semibold">{d.title}</div>
                          <div className="text-sm font-medium mt-1">{d.summary}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={ratingMeta[d.rating]?.cls}>{ratingMeta[d.rating]?.label}</Badge>
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-4">
                      {d.observations?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1">📋 Observaciones</h4>
                          <ul className="list-disc pl-5 space-y-1 text-sm">
                            {d.observations.map((o, i) => <li key={i}>{o}</li>)}
                          </ul>
                        </div>
                      )}
                      {d.suggestions?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1">💡 Sugerencias</h4>
                          <div className="space-y-2">
                            {d.suggestions.map((s, i) => (
                              <div key={i} className="bg-teal-50 border border-teal-200 text-teal-900 px-3 py-2 rounded-md text-sm">{s}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {d.quotes?.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-1">💬 De tus notas</h4>
                          <div className="space-y-2">
                            {d.quotes.map((q, i) => (
                              <div key={i} className="bg-muted text-muted-foreground italic px-3 py-2 rounded-md text-sm">"{q}"</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}

          <Card>
            <CardContent className="py-6 grid md:grid-cols-3 gap-4 text-sm">
              <div>
                <h3 className="font-semibold mb-2">✅ Fortalezas</h3>
                <ul className="list-disc pl-4 space-y-1">{feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">⚠️ Áreas de mejora prioritarias</h3>
                <ul className="list-disc pl-4 space-y-1">{feedback.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">📚 Lecturas recomendadas</h3>
                {feedback.recommended_reading?.length ? (
                  <ul className="list-disc pl-4 space-y-1">{feedback.recommended_reading.map((s, i) => <li key={i}>{s}</li>)}</ul>
                ) : <p className="text-muted-foreground">—</p>}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveFeedback} disabled={saving}><Save className="h-4 w-4 mr-1" />Guardar análisis</Button>
            <Button variant="outline" onClick={exportPDF}><FileDown className="h-4 w-4 mr-1" />Exportar PDF</Button>
            <Button variant="ghost" onClick={reset}><RotateCcw className="h-4 w-4 mr-1" />Nuevo análisis</Button>
          </div>
        </div>
      )}

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" />Historial de análisis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay análisis guardados</p>}
          {history.map((h) => {
            const open = !!expandedHistory[h.id];
            const fc: FeedbackContent | null = h.feedback_content;
            const typeLabel = h.feedback_type === "sesion" ? "🎯 Sesión" : h.feedback_type === "paciente" ? "👤 Paciente" : "🌐 Global";
            return (
              <div key={h.id} className="border rounded-md">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium">{new Date(h.created_at).toLocaleDateString("es-CL")}</span>
                    <Badge variant="outline" className="ml-2">{typeLabel}</Badge>
                    {fc?.overall_summary && <div className="text-xs text-muted-foreground line-clamp-1 mt-1">{fc.overall_summary}</div>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setExpandedHistory((p) => ({ ...p, [h.id]: !open }))}>
                    {open ? "Ocultar" : "Ver análisis"}
                  </Button>
                </div>
                {open && fc && (
                  <div className="border-t p-3 space-y-2 text-sm">
                    <p><strong>Resumen:</strong> {fc.overall_summary}</p>
                    {fc.dimensions?.map((d) => (
                      <div key={d.id} className="border-l-2 border-muted pl-2">
                        <div className="font-medium">{d.icon} {d.title}</div>
                        <div className="text-muted-foreground text-xs">{d.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
