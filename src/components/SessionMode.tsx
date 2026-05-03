import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Square, Send, Sparkles, Loader2, Mic, StopCircle, Check, MessageCircle,
  Eye, Lightbulb, AlertTriangle, Pencil, Save, Trash2, Pause, Play, Circle, FileText, Wand2, ChevronDown, ChevronRight,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { EMOTIONAL_STATES } from "@/components/SessionsTab";
import ReactMarkdown from "react-markdown";

type TranscriptSegment = { speaker: "Terapeuta" | "Paciente" | "Hablante" | "Error" | string; text: string; t: number; error?: boolean };
type RecState = "idle" | "recording" | "paused";

type Entry = { t: number; text: string };
type Suggestions = {
  questions: string[];
  patterns: string[];
  interventions: string[];
  unexplored: string[];
};
type UsedSuggestion = { kind: "question" | "pattern" | "intervention" | "unexplored", text: string; t: number };

type AnalyzedSuggestion = {
  id: string;
  type: "question" | "intervention" | "pattern" | "alert" | string;
  text: string;
  rationale?: string;
  addressed?: boolean;
};
type SummaryBlock = { t: number; bullets: string[] };
type TopicSuggestion = { id: string; text: string; addressed: boolean };
const WHISPER_USD_PER_MIN = 0.006;
const SONNET_USD = 0.08;

interface Props {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  onSessionSaved?: () => void;
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
function clockFromTimestamp(t: number) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function SessionMode({ open, onClose, patientId, patientName, onSessionSaved }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const [patientText, setPatientText] = useState("");
  const [therapistText, setTherapistText] = useState("");
  const [patientEntries, setPatientEntries] = useState<Entry[]>([]);
  const [therapistEntries, setTherapistEntries] = useState<Entry[]>([]);

  const [suggestions, setSuggestions] = useState<Suggestions>({ questions: [], patterns: [], interventions: [], unexplored: [] });
  const [usedSuggestions, setUsedSuggestions] = useState<UsedSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // End-session flow
  const [endOpen, setEndOpen] = useState(false);
  const [endStep, setEndStep] = useState<1 | 2>(1);
  const [emotionalState, setEmotionalState] = useState<string>("");
  const [textComplement, setTextComplement] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [generating, setGenerating] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [nextPlanDraft, setNextPlanDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // ===== Live session recording =====
  const [recState, setRecState] = useState<RecState>("idle");
  const [recElapsed, setRecElapsed] = useState(0); // ms
  const [showRecDisclaimer, setShowRecDisclaimer] = useState(false);
  const [suppressRecDisclaimer, setSuppressRecDisclaimer] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptEditable, setTranscriptEditable] = useState(false);
  const [activeTab, setActiveTab] = useState<"support" | "topics" | "transcript">("support");
  const [chunkCount, setChunkCount] = useState(0);
  // Manual on-demand transcription + analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStage, setAnalyzeStage] = useState<"idle" | "transcribing" | "analyzing">("idle");
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [patientBullets, setPatientBullets] = useState<string[]>([]);
  const [therapistBullets, setTherapistBullets] = useState<string[]>([]);
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestion[]>([]);
  const [analyzedSuggestions, setAnalyzedSuggestions] = useState<AnalyzedSuggestion[]>([]);
  const [sessionInsight, setSessionInsight] = useState<string>("");
  const [transcriptionCount, setTranscriptionCount] = useState(0);
  const [lastAudioSec, setLastAudioSec] = useState(0);
  const [totalAudioSec, setTotalAudioSec] = useState(0);
  const processedAudioSecRef = useRef(0);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<number | null>(null);
  const unprocessedChunksRef = useRef<Blob[]>([]);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  const liveRecorderRef = useRef<MediaRecorder | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveChunksRef = useRef<Blob[]>([]);
  const liveMimeRef = useRef<string>("audio/webm");
  const liveTimerRef = useRef<number | null>(null);
  const liveStartRef = useRef<number>(0);
  const livePausedAccumRef = useRef<number>(0);
  const livePauseStartRef = useRef<number>(0);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
  const suggestionsRef = useRef<Suggestions>({ questions: [], patterns: [], interventions: [], unexplored: [] });
  const checkedSuggestionsRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { suggestionsRef.current = suggestions; }, [suggestions]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => {
    if (activeTab !== "transcript") return;
    const el = transcriptScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, activeTab]);

  // Init session row when overlay opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const today = new Date().toISOString().slice(0, 10);
      const { data: inserted, error } = await supabase
        .from("sessions")
        .insert({
          psychologist_id: u.user.id,
          patient_id: patientId,
          session_date: today,
          status: "programada",
          session_mode_status: "active",
          started_at: new Date().toISOString(),
          patient_interventions: [],
          therapist_notes_live: [],
          claude_suggestions_used: [],
        })
        .select("id, session_number, started_at")
        .single();
      if (cancelled) return;
      if (error) { toast.error("No se pudo iniciar la sesión: " + error.message); onClose(); return; }
      setSessionId(inserted.id);
      setSessionNumber(inserted.session_number ?? null);
      setStartedAt(inserted.started_at ? new Date(inserted.started_at).getTime() : Date.now());
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId]);

  // Tick timer
  useEffect(() => {
    if (!open || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, startedAt]);

  // Persist entries debounced helper
  const persistEntries = useCallback(async (next: { patient?: Entry[]; therapist?: Entry[] }) => {
    if (!sessionId) return;
    const payload: any = {};
    if (next.patient) payload.patient_interventions = next.patient;
    if (next.therapist) payload.therapist_notes_live = next.therapist;
    if (Object.keys(payload).length === 0) return;
    await supabase.from("sessions").update(payload).eq("id", sessionId);
  }, [sessionId]);

  function addPatientEntry() {
    const text = patientText.trim();
    if (!text) return;
    const e: Entry = { t: Date.now(), text };
    const next = [...patientEntries, e];
    setPatientEntries(next);
    setPatientText("");
    persistEntries({ patient: next });
  }
  function addTherapistEntry() {
    const text = therapistText.trim();
    if (!text) return;
    const e: Entry = { t: Date.now(), text };
    const next = [...therapistEntries, e];
    setTherapistEntries(next);
    setTherapistText("");
    persistEntries({ therapist: next });
  }

  const transcriptSummaryText = useMemo(() => {
    if (!summaryBullets.length) return "";
    return summaryBullets.map((b) => `• ${b}`).join("\n");
  }, [summaryBullets]);

  async function requestSuggestions() {
    if (!sessionId) return;
    setLoadingSuggestions(true);
    try {
      const { data, error } = await supabase.functions.invoke("claude-session-support", {
        body: {
          patient_id: patientId,
          session_id: sessionId,
          previous_used_suggestions: usedSuggestions.map((s) => s.text),
          transcript_summary: transcriptSummaryText || undefined,
        },
      });
      if (error) throw error;
      const s = (data as any)?.suggestions ?? { questions: [], patterns: [], interventions: [], unexplored: [] };
      // Filter out already-used
      const usedSet = new Set(usedSuggestions.map((u) => u.text.toLowerCase().trim()));
      const next = {
        questions: (s.questions ?? []).filter((x: string) => !usedSet.has(x.toLowerCase().trim())),
        patterns: (s.patterns ?? []).filter((x: string) => !usedSet.has(x.toLowerCase().trim())),
        interventions: (s.interventions ?? []).filter((x: string) => !usedSet.has(x.toLowerCase().trim())),
        unexplored: (s.unexplored ?? []).filter((x: string) => !usedSet.has(x.toLowerCase().trim())),
      };
      setSuggestions(next);
      // Also build a flat topic checklist (all suggestion types are "topics" to address)
      setTopicSuggestions((prev) => {
        const existingTexts = new Set(prev.map((t) => t.text.toLowerCase().trim()));
        const all = [...next.questions, ...next.patterns, ...next.interventions, ...next.unexplored];
        const fresh = all
          .filter((t) => !existingTexts.has(t.toLowerCase().trim()))
          .map((t, i) => ({ id: `topic-${Date.now()}-${i}`, text: t, addressed: false }));
        return [...prev, ...fresh];
      });
    } catch (e: any) {
      toast.error("Claude: " + (e?.message ?? "error"));
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function markUsed(kind: UsedSuggestion["kind"], text: string) {
    const used: UsedSuggestion = { kind, text, t: Date.now() };
    const nextUsed = [...usedSuggestions, used];
    setUsedSuggestions(nextUsed);
    setSuggestions((s) => ({
      questions: s.questions.filter((x) => x !== text),
      patterns: s.patterns.filter((x) => x !== text),
      interventions: s.interventions.filter((x) => x !== text),
      unexplored: s.unexplored.filter((x) => x !== text),
    }));
    if (sessionId) {
      supabase.from("sessions").update({ claude_suggestions_used: nextUsed }).eq("id", sessionId);
    }
  }

  // Recording
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch (e: any) {
      toast.error("No se pudo acceder al micrófono: " + (e?.message ?? ""));
    }
  }
  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }
  function onAudioFile(f: File | null) {
    if (!f) return;
    setAudioBlob(f);
    setAudioUrl(URL.createObjectURL(f));
  }
  function clearAudio() {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
  }

  // ===== Live recording during session =====
  const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  function pickMimeType(): string {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (typeof MediaRecorder === "undefined") return "audio/webm";
    for (const c of candidates) {
      try { if ((MediaRecorder as any).isTypeSupported?.(c)) return c; } catch { /* ignore */ }
    }
    return "";
  }

  // Manual: transcribe accumulated chunks then run analysis
  async function transcribeAndAnalyze() {
    if (analyzing) return;
    const pending = unprocessedChunksRef.current;
    if (!pending.length && !transcriptRef.current.length) {
      toast.info("Aún no hay audio grabado para transcribir.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeStage("transcribing");
    let newSegments: TranscriptSegment[] = [];
    try {
      // 1) Transcribe accumulated chunks (if any)
      let transcribeFailed = false;
      if (pending.length) {
        const blobMime = liveMimeRef.current || "audio/webm";
        const baseMime = blobMime.split(";")[0];
        const blob = new Blob(pending, { type: blobMime });
        console.log("Blob mimeType:", blob.type, "size:", blob.size);
        unprocessedChunksRef.current = [];
        if (blob.size >= 1000) {
          setTranscribing(true);
          try {
            const audio = await blobToBase64(blob);
            const { data, error } = await supabase.functions.invoke("transcribe-session-chunk", {
              body: { action: "transcribe", audio, mime_type: baseMime, audioMediaType: blob.type || baseMime },
            });
            console.log("Transcription response:", data, error);
            if (error) throw error;
            if ((data as any)?.success === false || (data as any)?.error) {
              throw new Error((data as any)?.error || "Transcripción falló");
            }
            const segs: any[] = (data as any)?.segments ?? [];
            const now = Date.now();
            newSegments = segs
              .filter((s) => s && typeof s.text === "string" && s.text.trim())
              .map((s) => ({ speaker: s.speaker || "Hablante", text: String(s.text).trim(), t: now }));
            if (newSegments.length) {
              const next = [...transcriptRef.current, ...newSegments];
              transcriptRef.current = next;
              setTranscript(next);
              const sid = sessionIdRef.current;
              if (sid) supabase.from("sessions").update({ live_transcript: next }).eq("id", sid);
            } else {
              transcribeFailed = true;
              const errSeg: TranscriptSegment = { speaker: "Aviso", text: "⚠️ No se pudo transcribir el audio. Verifica que el micrófono esté funcionando y vuelve a intentarlo.", t: Date.now(), error: true };
              const next = [...transcriptRef.current, errSeg];
              transcriptRef.current = next;
              setTranscript(next);
            }
          } catch (e: any) {
            console.error("transcribe failed", e);
            transcribeFailed = true;
            const errSeg: TranscriptSegment = { speaker: "Aviso", text: "⚠️ No se pudo transcribir el audio. Verifica que el micrófono esté funcionando y vuelve a intentarlo.", t: Date.now(), error: true };
            const next = [...transcriptRef.current, errSeg];
            transcriptRef.current = next;
            setTranscript(next);
            toast.error("Error al transcribir audio");
          } finally {
            setTranscribing(false);
          }
        }
      }

      // STOP if no real transcript exists — never generate bullets from the profile alone
      const hasAnyTranscript = newSegments.length > 0 || transcriptRef.current.some((s) => !s.error);
      if (!hasAnyTranscript || (transcribeFailed && !newSegments.length)) {
        setAnalyzing(false);
        setAnalyzeStage("idle");
        return;
      }

      // 2) Build condensed context and call analyze (Sonnet) — only the NEW transcript chunk
      const transcriptText = newSegments.length
        ? newSegments.map((s) => `${s.speaker}: ${s.text}`).join("\n")
        : transcriptRef.current.filter((s) => !s.error).slice(-12).map((s) => `${s.speaker}: ${s.text}`).join("\n");
      const therapistNotesText = therapistEntries.map((e) => `[${clockFromTimestamp(e.t)}] ${e.text}`).join("\n");
      const patientNotesText = patientEntries.map((e) => `[${clockFromTimestamp(e.t)}] ${e.text}`).join("\n");
      const activeWithIds: AnalyzedSuggestion[] = analyzedSuggestions.length
        ? analyzedSuggestions
        : [
            ...suggestions.questions.map((t, i) => ({ id: `q-${i}`, type: "question", text: t })),
            ...suggestions.interventions.map((t, i) => ({ id: `i-${i}`, type: "intervention", text: t })),
            ...suggestions.patterns.map((t, i) => ({ id: `p-${i}`, type: "pattern", text: t })),
            ...suggestions.unexplored.map((t, i) => ({ id: `u-${i}`, type: "alert", text: t })),
          ];
      const recentBullets = summaryBullets.slice(-10);

      setAnalyzeStage("analyzing");
      const { data: ad, error: aerr } = await supabase.functions.invoke("transcribe-session-chunk", {
        body: {
          action: "analyze",
          patient_id: patientId,
          transcript_text: transcriptText,
          therapist_notes: therapistNotesText,
          patient_notes: patientNotesText,
          active_suggestions: activeWithIds.map(({ id, type, text }) => ({ id, type, text })),
          topic_suggestions: topicSuggestions.filter((t) => !t.addressed).map(({ id, text }) => ({ id, text })),
          recent_summary_bullets: recentBullets,
        },
      });
      if (aerr) throw aerr;
      const bullets: string[] = Array.isArray((ad as any)?.summary_bullets) ? (ad as any).summary_bullets : [];
      const pBullets: string[] = Array.isArray((ad as any)?.patient_bullets) ? (ad as any).patient_bullets : [];
      const tBullets: string[] = Array.isArray((ad as any)?.therapist_bullets) ? (ad as any).therapist_bullets : [];
      const newSugs: any[] = Array.isArray((ad as any)?.suggestions) ? (ad as any).suggestions : [];
      const addressed: string[] = Array.isArray((ad as any)?.suggestions_addressed) ? (ad as any).suggestions_addressed : [];
      const topicsAddressed: string[] = Array.isArray((ad as any)?.topics_addressed) ? (ad as any).topics_addressed : [];
      const insight: string = typeof (ad as any)?.session_insights === "string" ? (ad as any).session_insights : "";

      // Apoyo Sesión: replace with newest suggestions (short-term guidance for next minutes)
      const addressedSet = new Set(addressed.map(String));
      const refreshed: AnalyzedSuggestion[] = newSugs.map((s, i) => ({
        id: `n-${Date.now()}-${i}`,
        type: s.type ?? "intervention",
        text: String(s.text ?? "").trim(),
        rationale: s.rationale ? String(s.rationale) : undefined,
        addressed: false,
      })).filter((s) => s.text);
      const flaggedPrior = activeWithIds
        .filter((s) => addressedSet.has(s.id))
        .map((s) => ({ ...s, addressed: true }));
      setAnalyzedSuggestions([...flaggedPrior, ...refreshed]);
      setSessionInsight(insight);

      // Auto-check addressed topics
      if (topicsAddressed.length) {
        const tset = new Set(topicsAddressed.map(String));
        setTopicSuggestions((prev) => prev.map((t) => tset.has(t.id) ? { ...t, addressed: true } : t));
      }

      // Append (accumulate, never clear) bullets
      if (bullets.length) setSummaryBullets((prev) => [...prev, ...bullets]);
      if (pBullets.length) setPatientBullets((prev) => [...prev, ...pBullets]);
      if (tBullets.length) setTherapistBullets((prev) => [...prev, ...tBullets]);

      setTranscriptionCount((n) => n + 1);
      setLastAnalyzedAt(Date.now());
      toast.success("✨ Transcripción y análisis listos");
    } catch (e: any) {
      console.error(e);
      toast.error("No se pudo analizar: " + (e?.message ?? ""));
    } finally {
      setAnalyzing(false);
      setAnalyzeStage("idle");
    }
  }

  function startLiveTimer() {
    if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
    liveTimerRef.current = window.setInterval(() => {
      const paused = livePausedAccumRef.current;
      setRecElapsed(Date.now() - liveStartRef.current - paused);
    }, 500);
  }
  function stopLiveTimer() {
    if (liveTimerRef.current) { window.clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
  }

  async function actuallyStartLiveRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      liveStreamRef.current = stream;
      const mime = pickMimeType();
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      liveMimeRef.current = mr.mimeType || mime || "audio/webm";
      liveChunksRef.current = [];
      unprocessedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          liveChunksRef.current.push(e.data);
          unprocessedChunksRef.current.push(e.data);
          setChunkCount((n) => n + 1);
        }
      };
      mr.onerror = (ev) => { console.error("MediaRecorder error", ev); toast.error("Error de grabación"); };
      // Smaller timeslice keeps blob granularity for on-demand transcription
      mr.start(5000);
      liveRecorderRef.current = mr;
      liveStartRef.current = Date.now();
      livePausedAccumRef.current = 0;
      setRecElapsed(0);
      setChunkCount(0);
      setRecState("recording");
      startLiveTimer();
      setActiveTab("transcript");
      toast.success("🔴 Grabación iniciada");
    } catch (e: any) {
      toast.error("No se pudo acceder al micrófono: " + (e?.message ?? ""));
    }
  }

  function requestStartLiveRecording() {
    if (suppressRecDisclaimer) { actuallyStartLiveRecording(); return; }
    setShowRecDisclaimer(true);
  }

  function pauseLiveRecording() {
    const mr = liveRecorderRef.current;
    if (!mr || mr.state !== "recording") return;
    try { mr.pause(); } catch { /* ignore */ }
    livePauseStartRef.current = Date.now();
    stopLiveTimer();
    setRecState("paused");
  }
  function resumeLiveRecording() {
    const mr = liveRecorderRef.current;
    if (!mr || mr.state !== "paused") return;
    try { mr.resume(); } catch { /* ignore */ }
    livePausedAccumRef.current += Date.now() - livePauseStartRef.current;
    startLiveTimer();
    setRecState("recording");
  }
  async function stopLiveRecording() {
    const mr = liveRecorderRef.current;
    stopLiveTimer();
    if (mr && mr.state !== "inactive") {
      try {
        await new Promise<void>((resolve) => {
          mr.addEventListener("stop", () => resolve(), { once: true });
          try { mr.stop(); } catch { resolve(); }
        });
      } catch { /* ignore */ }
    }
    liveStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    liveStreamRef.current = null;
    liveRecorderRef.current = null;
    // Clear audio chunks from memory
    liveChunksRef.current = [];
    unprocessedChunksRef.current = [];
    setRecState("idle");
  }

  // Cleanup on unmount / close
  useEffect(() => {
    return () => {
      stopLiveTimer();
      const mr = liveRecorderRef.current;
      if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { /* ignore */ } }
      liveStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      liveChunksRef.current = [];
    };
  }, []);

  function openEndFlow() {
    setEndStep(1);
    setEndOpen(true);
  }

  async function generateSummary() {
    if (!sessionId) return;
    setGenerating(true);
    try {
      // Persist complement first so the function reads it
      await supabase.from("sessions").update({
        therapist_text_complement: textComplement || null,
        emotional_state: emotionalState || null,
      }).eq("id", sessionId);

      // Upload audio if present
      let audioPath: string | null = null;
      if (audioBlob) {
        const { data: u } = await supabase.auth.getUser();
        const ext = (audioBlob.type.includes("mp3") ? "mp3"
          : audioBlob.type.includes("wav") ? "wav"
          : audioBlob.type.includes("m4a") ? "m4a"
          : audioBlob.type.includes("mp4") ? "m4a"
          : "webm");
        const path = `${u.user!.id}/${sessionId}.${ext}`;
        const { error: upErr } = await supabase.storage.from("session-audio")
          .upload(path, audioBlob, { upsert: true, contentType: audioBlob.type || "audio/webm" });
        if (upErr) toast.error("Audio: " + upErr.message);
        else { audioPath = path; await supabase.from("sessions").update({ therapist_audio_path: path }).eq("id", sessionId); }
      }

      // NOTE: audio transcription not implemented server-side yet — we pass through textComplement
      const { data, error } = await supabase.functions.invoke("claude-session-summary", {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      const r = data as any;
      setSummaryDraft(r.summary ?? "");
      setFeedbackDraft(r.clinical_feedback ?? "");
      setNextPlanDraft(r.next_session_plan ?? "");
      setEndStep(2);
    } catch (e: any) {
      toast.error("No se pudo generar resumen: " + (e?.message ?? ""));
    } finally {
      setGenerating(false);
    }
  }

  async function saveSession() {
    if (!sessionId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("sessions").update({
        session_summary: summaryDraft,
        clinical_feedback: feedbackDraft,
        next_session_plan: nextPlanDraft,
        what_happened: summaryDraft, // mirror so SessionsTab cards show preview
        post_session_notes: feedbackDraft,
        status: "realizada",
        session_mode_status: "completed",
        completed_at: new Date().toISOString(),
        emotional_state: emotionalState || null,
        therapist_text_complement: textComplement || null,
      }).eq("id", sessionId);
      if (error) throw error;
      // Stop any active recording and wipe audio from memory
      await stopLiveRecording();
      liveChunksRef.current = [];
      // Remove any temporarily uploaded session audio (we keep only the transcript)
      try {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const candidates = ["webm", "mp3", "wav", "m4a", "ogg", "mp4"].map((ext) => `${u.user!.id}/${sessionId}.${ext}`);
          await supabase.storage.from("session-audio").remove(candidates).catch(() => {});
        }
        await supabase.from("sessions").update({ therapist_audio_path: null }).eq("id", sessionId);
      } catch { /* ignore */ }
      toast.success("✅ Sesión guardada correctamente");
      toast("🗑️ Audio eliminado — solo se conserva la transcripción");
      onSessionSaved?.();
      // Reset
      resetAll();
      setEndOpen(false);
      onClose();
    } catch (e: any) {
      toast.error("Error al guardar: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setSessionId(null); setSessionNumber(null); setStartedAt(null);
    setPatientText(""); setTherapistText("");
    setPatientEntries([]); setTherapistEntries([]);
    setSuggestions({ questions: [], patterns: [], interventions: [], unexplored: [] });
    setUsedSuggestions([]);
    setEmotionalState(""); setTextComplement("");
    clearAudio();
    setSummaryDraft(""); setFeedbackDraft(""); setNextPlanDraft("");
    setEndStep(1); setEditing(false);
    setTranscript([]); transcriptRef.current = [];
    checkedSuggestionsRef.current = new Set();
    setRecState("idle"); setRecElapsed(0);
    setSuppressRecDisclaimer(false);
    setActiveTab("support"); setTranscriptEditable(false);
    setSummaryBullets([]); setPatientBullets([]); setTherapistBullets([]);
    setTopicSuggestions([]);
    setAnalyzedSuggestions([]); setSessionInsight("");
    setTranscriptionCount(0); setLastAnalyzedAt(null); setChunkCount(0);
    unprocessedChunksRef.current = [];
  }

  const elapsedMs = startedAt ? now - startedAt : 0;

  const timeline = useMemo(() => {
    const merged = [
      ...patientEntries.map((e) => ({ ...e, who: "patient" as const })),
      ...therapistEntries.map((e) => ({ ...e, who: "therapist" as const })),
    ].sort((a, b) => a.t - b.t);
    return merged;
  }, [patientEntries, therapistEntries]);

  if (!open) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] bg-background flex flex-col"
      style={{ width: "100vw", height: "100vh" }}
    >
      {/* Top bar */}
      <div className="px-6 py-3 border-b bg-card space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary-soft text-primary flex items-center justify-center font-semibold">
              {patientName.split(" ").map(n => n[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="font-semibold">{patientName}</div>
              <div className="text-xs text-muted-foreground">
                Sesión #{sessionNumber ?? "—"} · {new Date().toLocaleDateString("es-CL")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {recState !== "idle" && (
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full bg-red-500 ${recState === "recording" ? "animate-pulse" : ""}`} />
                <span className={recState === "recording" ? "text-red-600" : "text-amber-600"}>
                  {recState === "recording" ? `REC ${fmtTime(recElapsed)}` : `EN PAUSA ${fmtTime(recElapsed)}`}
                </span>
              </div>
            )}
            <div className="font-mono text-2xl tabular-nums">{fmtTime(elapsedMs)}</div>
            <Button variant="destructive" onClick={openEndFlow} className="gap-2">
              <Square className="h-4 w-4" /> Finalizar sesión
            </Button>
          </div>
        </div>
        {/* Recording control bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {recState === "idle" && (
            <Button
              size="sm"
              variant="outline"
              onClick={requestStartLiveRecording}
              disabled={!sessionId}
              className="gap-1.5 border-red-500/60 text-red-600 hover:bg-red-500/10 hover:text-red-700"
            >
              <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" /> Grabar sesión
            </Button>
          )}
          {recState === "recording" && (
            <>
              <Badge variant="destructive" className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                GRABANDO {fmtTime(recElapsed)}
              </Badge>
              <Button size="sm" variant="outline" onClick={pauseLiveRecording} className="gap-1.5">
                <Pause className="h-3.5 w-3.5" /> Pausar
              </Button>
              <Button
                size="sm"
                onClick={transcribeAndAnalyze}
                disabled={analyzing}
                className="gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
              >
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {analyzeStage === "transcribing" ? "Transcribiendo…" : analyzeStage === "analyzing" ? "Analizando…" : "✨ Transcribir y analizar"}
              </Button>
              <Button size="sm" variant="destructive" onClick={stopLiveRecording} className="gap-1.5">
                <Square className="h-3.5 w-3.5" /> Detener
              </Button>
            </>
          )}
          {recState === "paused" && (
            <>
              <Badge variant="outline" className="gap-1.5 border-amber-500 text-amber-600">
                ⏸ EN PAUSA {fmtTime(recElapsed)}
              </Badge>
              <Button size="sm" variant="outline" onClick={resumeLiveRecording} className="gap-1.5 border-red-500/60 text-red-600 hover:bg-red-500/10">
                <Play className="h-3.5 w-3.5" /> Reanudar
              </Button>
              <Button
                size="sm"
                onClick={transcribeAndAnalyze}
                disabled={analyzing}
                className="gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
              >
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {analyzeStage === "transcribing" ? "Transcribiendo…" : analyzeStage === "analyzing" ? "Analizando…" : "✨ Transcribir y analizar"}
              </Button>
              <Button size="sm" variant="destructive" onClick={stopLiveRecording} className="gap-1.5">
                <Square className="h-3.5 w-3.5" /> Detener
              </Button>
            </>
          )}
          {transcribing && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> ✍️ Transcribiendo…
            </span>
          )}
          {transcriptionCount > 0 && (() => {
            const lastWhisper = (lastAudioSec / 60) * WHISPER_USD_PER_MIN;
            const lastTotal = lastWhisper + SONNET_USD;
            const cumWhisper = (totalAudioSec / 60) * WHISPER_USD_PER_MIN;
            const cumTotal = cumWhisper + SONNET_USD * transcriptionCount;
            return (
              <span className="text-[11px] text-muted-foreground ml-1 px-2 py-0.5 rounded bg-muted/50 border border-dashed">
                Transcripción (Whisper): ~$0.006/min · Análisis (Sonnet): ~${SONNET_USD.toFixed(2)} · Total esta vez: ~${lastTotal.toFixed(3)} · Acumulado sesión: ~${cumTotal.toFixed(3)} ({transcriptionCount}×)
              </span>
            );
          })()}
          {recState !== "idle" && (
            <span className="text-[11px] text-muted-foreground ml-1 px-2 py-0.5 rounded bg-muted/50 border border-dashed">
              Fragmentos: {chunkCount}
            </span>
          )}
        </div>
      </div>

      {/* Split layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left 55% */}
        <div className="basis-[55%] border-r flex flex-col min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
            {/* Patient input */}
            <Card className="p-3 flex flex-col gap-2 border-l-4 border-l-blue-400">
              <div className="text-sm font-semibold flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-400" /> Lo que dice/hace el paciente
              </div>
              <Textarea
                value={patientText}
                onChange={(e) => setPatientText(e.target.value)}
                placeholder="Anota intervenciones, frases clave, conductas observadas del paciente..."
                className="min-h-[90px] resize-none"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addPatientEntry(); }
                }}
              />
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={addPatientEntry} className="gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Registrar
                </Button>
              </div>
              <BulletList bullets={patientBullets} emptyText="Los bullets auto-generados aparecerán aquí tras transcribir." tone="blue" />
            </Card>

            {/* Therapist input */}
            <Card className="p-3 flex flex-col gap-2 border-l-4 border-l-teal-400">
              <div className="text-sm font-semibold flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-teal-400" /> Mis notas e intervenciones
              </div>
              <Textarea
                value={therapistText}
                onChange={(e) => setTherapistText(e.target.value)}
                placeholder="Anota tus intervenciones, preguntas realizadas, observaciones..."
                className="min-h-[90px] resize-none"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addTherapistEntry(); }
                }}
              />
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={addTherapistEntry} className="gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Registrar
                </Button>
              </div>
              <BulletList bullets={therapistBullets} emptyText="Los bullets auto-generados aparecerán aquí tras transcribir." tone="teal" />
            </Card>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Timeline de sesión ({timeline.length})
            </div>
            {timeline.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-10 border rounded-md border-dashed">
                Aún no hay registros. Empieza a anotar arriba.
              </div>
            ) : (
              <div className="space-y-2">
                {timeline.map((e, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-md border-l-4 bg-card text-sm ${
                      e.who === "patient" ? "border-l-blue-400 bg-blue-500/5" : "border-l-teal-400 bg-teal-500/5"
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">
                      {e.who === "patient" ? "Paciente" : "Terapeuta"} [{clockFromTimestamp(e.t)}]
                    </div>
                    <div className="whitespace-pre-wrap">{e.text}</div>
                  </div>
                ))}
              </div>
            )}

            {summaryBullets.length > 0 && (
              <div className="mt-6">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  📝 Resumen de lo conversado · solo cambios e inconsistencias ({summaryBullets.length})
                </div>
                <ul className="list-disc pl-6 pr-3 pb-3 text-sm space-y-1 border rounded-md bg-card py-3">
                  {summaryBullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right 45% */}
        <div className="basis-[45%] flex flex-col min-h-0 bg-muted/20">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-2 border-b flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="support" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> 💬 Apoyo Sesión
                </TabsTrigger>
                <TabsTrigger value="topics" className="gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" /> 💡 Sugerencias
                  {topicSuggestions.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                      {topicSuggestions.filter((t) => t.addressed).length}/{topicSuggestions.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="transcript" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> 📝 Transcripción
                  {transcript.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">{transcript.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
              {activeTab === "topics" ? (
                <Button size="sm" onClick={requestSuggestions} disabled={loadingSuggestions || !sessionId} className="gap-2">
                  {loadingSuggestions ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Pedir sugerencias
                </Button>
              ) : activeTab === "transcript" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTranscriptEditable((v) => !v)}
                  disabled={transcript.length === 0}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {transcriptEditable ? "Listo" : "Editar"}
                </Button>
              ) : null}
            </div>

            <TabsContent value="support" className="flex-1 min-h-0 mt-0">
              <div className="h-full overflow-y-auto p-4 space-y-3">
                {sessionInsight && (
                  <div className="rounded-md border border-teal-400/40 bg-teal-500/10 p-3 text-sm">
                    <div className="font-semibold mb-1">💡 Insight de sesión</div>
                    <div className="text-muted-foreground">{sessionInsight}</div>
                    {lastAnalyzedAt && (
                      <div className="text-[10px] text-muted-foreground/80 mt-1">
                        Última transcripción: {clockFromTimestamp(lastAnalyzedAt)}
                      </div>
                    )}
                  </div>
                )}

                {analyzedSuggestions.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-10 border rounded-md border-dashed">
                    Las sugerencias aparecerán aquí tras pulsar "✨ Transcribir y analizar".
                  </div>
                ) : (
                  <div className="space-y-2">
                    {analyzedSuggestions.map((s) => {
                      const tone =
                        s.type === "question" ? "border-blue-400/40 bg-blue-500/10"
                        : s.type === "pattern" ? "border-purple-400/40 bg-purple-500/10"
                        : s.type === "alert" ? "border-amber-400/40 bg-amber-500/10"
                        : "border-teal-400/40 bg-teal-500/10";
                      const addressedClass = s.addressed ? "ring-2 ring-amber-400 bg-amber-500/15 border-amber-400/60" : "";
                      const kind: UsedSuggestion["kind"] =
                        s.type === "question" ? "question"
                        : s.type === "pattern" ? "pattern"
                        : s.type === "alert" ? "unexplored"
                        : "intervention";
                      return (
                        <div key={s.id} className={`p-2.5 rounded-md border text-sm ${tone} ${addressedClass}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70 mb-0.5">
                                {s.type}
                                {s.addressed && (
                                  <Badge variant="outline" className="ml-2 border-amber-500 text-amber-700 text-[10px]">
                                    🎙️ Detectado en conversación
                                  </Badge>
                                )}
                              </div>
                              <div>{s.text}</div>
                              {s.rationale && (
                                <div className="text-[11px] text-muted-foreground mt-1 italic">{s.rationale}</div>
                              )}
                            </div>
                          </div>
                          {s.addressed && (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                onClick={() => {
                                  markUsed(kind, s.text);
                                  setAnalyzedSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                                }}
                                className="gap-1.5 h-7"
                              >
                                <Check className="h-3.5 w-3.5" /> Marcar como usado
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="topics" className="flex-1 min-h-0 mt-0">
              <div className="h-full overflow-y-auto p-4 space-y-2">
                {loadingSuggestions && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Generando sugerencias…
                  </div>
                )}
                {topicSuggestions.length === 0 && !loadingSuggestions ? (
                  <div className="text-sm text-muted-foreground text-center py-10 border rounded-md border-dashed">
                    Pulsa "✨ Pedir sugerencias" para generar tópicos a abordar en esta sesión.
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {topicSuggestions.map((t) => (
                      <li
                        key={t.id}
                        className={`flex items-start gap-2 p-2 rounded-md border text-sm ${
                          t.addressed ? "bg-emerald-500/10 border-emerald-400/40" : "bg-card"
                        }`}
                      >
                        <Checkbox
                          checked={t.addressed}
                          onCheckedChange={(v) =>
                            setTopicSuggestions((prev) =>
                              prev.map((x) => (x.id === t.id ? { ...x, addressed: !!v } : x)),
                            )
                          }
                          className="mt-0.5"
                        />
                        <span className={t.addressed ? "line-through text-muted-foreground" : ""}>{t.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="transcript" className="flex-1 min-h-0 mt-0">
              <div ref={transcriptScrollRef} className="h-full overflow-y-auto p-4 space-y-2">
                {transcript.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-10 border rounded-md border-dashed">
                    {recState === "idle"
                      ? 'La transcripción aparecerá aquí. Pulsa "🔴 Grabar sesión" para empezar.'
                      : 'Pulsa "✨ Transcribir y analizar" cuando quieras transcribir el audio acumulado.'}
                  </div>
                ) : (
                  transcript.map((seg, i) => {
                    const isPatient = seg.speaker === "Paciente";
                    const isTher = seg.speaker === "Terapeuta";
                    const isError = seg.error || seg.speaker === "Error";
                    const tone = isError
                      ? "border-l-red-400 bg-red-500/5"
                      : isPatient
                      ? "border-l-blue-400 bg-blue-500/5"
                      : isTher
                      ? "border-l-teal-400 bg-teal-500/5"
                      : "border-l-amber-400 bg-amber-500/5";
                    const emoji = isError ? "⚠️" : isPatient ? "👤" : isTher ? "🧑‍⚕️" : "🗣️";
                    const label = isError ? "Error" : isPatient ? "Paciente" : isTher ? "Terapeuta" : "Sin identificar";
                    return (
                      <div key={i} className={`p-2.5 rounded-md border-l-4 bg-card text-sm ${tone}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-0.5 flex items-center justify-between">
                          <span>
                            {emoji} {label} [{clockFromTimestamp(seg.t)}]
                          </span>
                          {transcriptEditable && !isError && (
                            <select
                              value={seg.speaker}
                              onChange={(e) => {
                                const next = [...transcript];
                                next[i] = { ...seg, speaker: e.target.value };
                                setTranscript(next);
                                if (sessionIdRef.current) {
                                  supabase.from("sessions").update({ live_transcript: next }).eq("id", sessionIdRef.current);
                                }
                              }}
                              className="text-[10px] bg-background border rounded px-1"
                            >
                              <option value="Paciente">Paciente</option>
                              <option value="Terapeuta">Terapeuta</option>
                              <option value="Hablante">Hablante</option>
                            </select>
                          )}
                        </div>
                        {transcriptEditable && !isError ? (
                          <Textarea
                            value={seg.text}
                            onChange={(e) => {
                              const next = [...transcript];
                              next[i] = { ...seg, text: e.target.value };
                              setTranscript(next);
                            }}
                            onBlur={() => {
                              if (sessionIdRef.current) {
                                supabase.from("sessions").update({ live_transcript: transcript }).eq("id", sessionIdRef.current);
                              }
                            }}
                            className="min-h-[60px] text-sm"
                          />
                        ) : (
                          <div className="whitespace-pre-wrap">{seg.text}</div>
                        )}
                      </div>
                    );
                  })
                )}
                {transcribing && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 p-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Transcribiendo siguiente fragmento…
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* End-session dialog — must render above the z-[9999] fullscreen overlay */}
      <Dialog open={endOpen} onOpenChange={(o) => { if (!generating && !saving) setEndOpen(o); }}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto z-[10001]"
          style={{ zIndex: 10001 }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {endStep === 1 ? (
            <>
              <DialogHeader><DialogTitle>Complementar sesión</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-semibold mb-2">Estado emocional del paciente</div>
                  <div className="flex gap-2">
                    {EMOTIONAL_STATES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setEmotionalState(s.value)}
                        className={`text-2xl p-2 rounded-md border transition ${
                          emotionalState === s.value ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
                        }`}
                        title={s.label}
                      >
                        {s.emoji}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold mb-2">🎤 Nota de voz (opcional)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!recording ? (
                      <Button type="button" size="sm" variant="outline" onClick={startRecording} className="gap-1.5">
                        <Mic className="h-3.5 w-3.5" /> Grabar
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="destructive" onClick={stopRecording} className="gap-1.5">
                        <StopCircle className="h-3.5 w-3.5" /> Detener
                      </Button>
                    )}
                    <Input
                      type="file"
                      accept="audio/mp3,audio/mpeg,audio/wav,audio/x-m4a,audio/m4a,audio/mp4,audio/webm"
                      onChange={(e) => onAudioFile(e.target.files?.[0] ?? null)}
                      className="max-w-xs"
                    />
                    {audioUrl && (
                      <Button type="button" size="sm" variant="ghost" onClick={clearAudio} className="gap-1.5">
                        <Trash2 className="h-3.5 w-3.5" /> Quitar
                      </Button>
                    )}
                  </div>
                  {audioUrl && <audio controls src={audioUrl} className="mt-2 w-full" />}
                </div>
                <div>
                  <div className="text-sm font-semibold mb-2">📝 Notas finales (opcional)</div>
                  <Textarea
                    value={textComplement}
                    onChange={(e) => setTextComplement(e.target.value)}
                    placeholder="Cualquier cosa que no haya alcanzado a anotar durante la sesión..."
                    className="min-h-[120px]"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEndOpen(false)} disabled={generating}>Cancelar</Button>
                <Button onClick={generateSummary} disabled={generating} className="gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generar resumen
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader><DialogTitle>Resumen de sesión</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <SummarySection title="📋 Resumen de sesión" value={summaryDraft} onChange={setSummaryDraft} editing={editing} />
                <SummarySection title="🔍 Feedback clínico" value={feedbackDraft} onChange={setFeedbackDraft} editing={editing} />
                <SummarySection title="📅 Plan próxima sesión" value={nextPlanDraft} onChange={setNextPlanDraft} editing={editing} />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditing((v) => !v)} className="gap-2">
                  {editing ? <Save className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  {editing ? "Listo" : "Editar antes de guardar"}
                </Button>
                <Button onClick={saveSession} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Guardar sesión
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Recording disclaimer modal */}
      <Dialog open={showRecDisclaimer} onOpenChange={setShowRecDisclaimer}>
        <DialogContent
          className="overflow-y-auto z-[10001] sm:max-w-none"
          style={{ zIndex: 10001, width: "min(560px, calc(100vw - 32px))", maxWidth: "min(560px, calc(100vw - 32px))", maxHeight: "80vh", padding: "32px" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Aviso de grabación
            </DialogTitle>
            <DialogDescription style={{ fontSize: "14px", lineHeight: 1.7 }}>
              Antes de grabar esta sesión, asegúrate de que:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 flex flex-col" style={{ fontSize: "14px", lineHeight: 1.7, gap: "8px" }}>
            <li>El paciente ha sido informado y ha dado su consentimiento para la grabación.</li>
            <li>El audio será procesado por inteligencia artificial para generar una transcripción automática.</li>
            <li>La transcripción se usará para completar los apuntes de esta sesión.</li>
            <li>El audio original será eliminado permanentemente una vez que confirmes el resumen post-sesión.</li>
            <li>La transcripción quedará almacenada como parte del registro clínico de esta sesión.</li>
          </ul>
          <p className="text-muted-foreground" style={{ fontSize: "14px", lineHeight: 1.7 }}>
            Al continuar, confirmas que cuentas con el consentimiento del paciente.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox
              checked={suppressRecDisclaimer}
              onCheckedChange={(v) => setSuppressRecDisclaimer(!!v)}
            />
            No mostrar de nuevo en esta sesión
          </label>
          <div className="flex flex-col" style={{ gap: "8px" }}>
            <Button
              variant="destructive"
              onClick={() => { setShowRecDisclaimer(false); actuallyStartLiveRecording(); }}
              className="w-full gap-2"
            >
              <Circle className="h-4 w-4 fill-white" />
              El paciente ha dado su consentimiento — Comenzar grabación
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setShowRecDisclaimer(false)}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  return createPortal(overlay, document.body);
}

function BulletList({ bullets, emptyText, tone }: { bullets: string[]; emptyText: string; tone: "blue" | "teal" }) {
  const dot = tone === "blue" ? "text-blue-500" : "text-teal-500";
  if (!bullets.length) {
    return <div className="text-[11px] text-muted-foreground italic border-t pt-2 mt-1">{emptyText}</div>;
  }
  return (
    <div className="border-t pt-2 mt-1 max-h-40 overflow-y-auto">
      <ul className="space-y-0.5 text-xs">
        {bullets.map((b, i) => (
          <li key={i} className="leading-snug">
            <span className={`${dot} mr-1`}>•</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}




function SummarySection({
  title, value, onChange, editing,
}: { title: string; value: string; onChange: (s: string) => void; editing: boolean }) {
  return (
    <div className="border rounded-md">
      <div className="px-3 py-2 border-b text-sm font-semibold bg-muted/40">{title}</div>
      <div className="p-3">
        {editing ? (
          <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[140px]" />
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{value || "_(sin contenido)_"}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryBlockCard({ block, defaultOpen }: { block: SummaryBlock; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const label = `Transcripción ${new Date(block.t).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border rounded-md bg-card">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full px-3 py-2 flex items-center justify-between gap-2 text-sm font-semibold hover:bg-muted/50">
            <span className="flex items-center gap-1.5">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {defaultOpen ? `📌 ${label}` : `Ver resumen anterior — ${label}`}
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">{block.bullets.length} bullets</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="list-disc pl-6 pr-3 pb-3 text-sm space-y-1">
            {block.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
