import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Link2, AlertTriangle, RefreshCw, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "week" | "month";

interface SessionRow {
  id: string;
  session_number: number;
  session_date: string;
  session_time: string | null;
  duration_minutes: number | null;
  status: string;
  patient_id: string | null;
  child_patient_id: string | null;
  google_event_id?: string | null;
}

interface PatientLite { id: string; first_name: string; last_name: string }
interface ChildLite { id: string; first_name: string; last_name: string }

interface GEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  source: "google";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "hace unos segundos";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

// ---------- date helpers ----------
function startOfWeek(d: Date) {
  const x = new Date(d); const day = x.getDay(); const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff); x.setHours(0, 0, 0, 0); return x;
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function fmtISODate(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }
function startOfMonthGrid(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);
const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function Calendar() {
  const { profile, refreshProfile } = useAuth() as any;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [gEvents, setGEvents] = useState<GEvent[]>([]);
  const [patients, setPatients] = useState<Record<string, PatientLite>>({});
  const [children, setChildren] = useState<Record<string, ChildLite>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [activeGEvent, setActiveGEvent] = useState<GEvent | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPrefill, setNewPrefill] = useState<{ date: string; time: string } | null>(null);

  // Refresh "hace X min" label every 30s
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Handle ?gcal=connected | error in URL after OAuth roundtrip
  useEffect(() => {
    const gcal = params.get("gcal");
    if (!gcal) return;
    if (gcal === "connected") {
      toast.success("Google Calendar conectado");
      refreshProfile?.();
    } else {
      toast.error(`No se pudo conectar Google Calendar${params.get("reason") ? `: ${params.get("reason")}` : ""}`);
    }
    params.delete("gcal"); params.delete("reason"); setParams(params, { replace: true });
  }, [params, setParams, refreshProfile]);

  const range = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor); const end = addDays(start, 7);
      return { start, end };
    }
    const gridStart = startOfMonthGrid(cursor);
    const gridEnd = addDays(gridStart, 42);
    return { start: gridStart, end: gridEnd };
  }, [view, cursor]);

  const googleConnected = !!profile?.google_calendar_token;

  const loadGoogleEvents = useCallback(async (opts?: { showToast?: boolean }) => {
    if (!googleConnected) { setGEvents([]); return; }
    try {
      // Always pull a wide window: first day of current month → end of month + 2 weeks
      // (per spec). The visible-week / visible-month grid filters down from there.
      const now = new Date();
      const wideMin = new Date(now.getFullYear(), now.getMonth(), 1);
      const wideMax = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      wideMax.setDate(wideMax.getDate() + 14);

      const { data, error } = await supabase.functions.invoke("calendar-sync", {
        body: { action: "pull", timeMin: wideMin.toISOString(), timeMax: wideMax.toISOString() },
      });

      if (error) {
        // Try to read the structured body the function returned (FunctionsHttpError exposes .context)
        let detail: any = null;
        try {
          const ctx = (error as any).context;
          if (ctx?.json) detail = await ctx.json();
          else if (ctx?.text) detail = { reason: await ctx.text() };
        } catch { /* ignore */ }
        const msg = detail?.reason || detail?.error || (error as any)?.message || "Error desconocido";
        console.error("[calendar-sync] invoke error", error, detail);
        if (detail?.error === "token_expired" || /401|token_expired|invalid_grant/i.test(msg)) {
          setTokenExpired(true);
          if (opts?.showToast) toast.error("Tu conexión con Google Calendar expiró. Reconecta tu cuenta.");
        } else if (opts?.showToast) {
          toast.error(`Google Calendar: ${msg}`);
        }
        setGEvents([]); return;
      }

      const payload = data as any;
      if (payload?.error) {
        console.error("[calendar-sync] api error payload", payload);
        if (payload.error === "token_expired" || payload.status === 401) {
          setTokenExpired(true);
          if (opts?.showToast) toast.error("Tu conexión con Google Calendar expiró. Reconecta tu cuenta.");
        } else if (opts?.showToast) {
          toast.error(`Google Calendar: ${payload.reason || payload.error}`);
        }
        setGEvents(payload.events ?? []);
        return;
      }

      setTokenExpired(false);
      const items = (payload?.events ?? []).map((e: any) => ({ ...e, source: "google" as const }));
      setGEvents(items);
      setLastSyncedAt(payload?.synced_at ?? new Date().toISOString());
      if (opts?.showToast) {
        toast.success(`Sincronizado: ${items.length} evento${items.length === 1 ? "" : "s"} de Google`);
      }
    } catch (e: any) {
      console.error("[calendar-sync] exception", e);
      if (opts?.showToast) toast.error(`Error al sincronizar: ${e?.message ?? e}`);
      setGEvents([]);
    }
  }, [googleConnected]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sessions")
      .select("id,session_number,session_date,session_time,duration_minutes,status,patient_id,child_patient_id,google_event_id")
      .gte("session_date", fmtISODate(range.start))
      .lt("session_date", fmtISODate(range.end))
      .order("session_date", { ascending: true });
    if (error) toast.error(error.message);
    const rows = (data as SessionRow[]) ?? [];
    setSessions(rows);

    const pIds = Array.from(new Set(rows.map((r) => r.patient_id).filter(Boolean) as string[]));
    const cIds = Array.from(new Set(rows.map((r) => r.child_patient_id).filter(Boolean) as string[]));
    if (pIds.length) {
      const { data: ps } = await supabase.from("patients").select("id,first_name,last_name").in("id", pIds);
      const map: Record<string, PatientLite> = {};
      (ps ?? []).forEach((p: any) => (map[p.id] = p));
      setPatients(map);
    } else setPatients({});
    if (cIds.length) {
      const { data: cs } = await supabase.from("child_patients").select("id,first_name,last_name").in("id", cIds);
      const map: Record<string, ChildLite> = {};
      (cs ?? []).forEach((c: any) => (map[c.id] = c));
      setChildren(map);
    } else setChildren({});

    setLoading(false);
    await loadGoogleEvents();
  }, [range.start, range.end, loadGoogleEvents]);

  useEffect(() => { load(); }, [load]);

  function patientName(s: SessionRow) {
    if (s.patient_id) {
      const p = patients[s.patient_id]; return p ? `${p.first_name} ${p.last_name}` : "Paciente";
    }
    if (s.child_patient_id) {
      const c = children[s.child_patient_id]; return c ? `${c.first_name} ${c.last_name}` : "Menor";
    }
    return "—";
  }
  function patientLink(s: SessionRow) {
    if (s.patient_id) return `/patients/${s.patient_id}`;
    if (s.child_patient_id) return `/children/${s.child_patient_id}`;
    return "#";
  }

  function openNewAt(date: Date, hour?: number) {
    setNewPrefill({
      date: fmtISODate(date),
      time: hour != null ? `${String(hour).padStart(2, "0")}:00` : "10:00",
    });
    setNewOpen(true);
  }

  function goToday() { setCursor(new Date()); }
  function prev() { setCursor(view === "week" ? addDays(cursor, -7) : addMonths(cursor, -1)); }
  function next() { setCursor(view === "week" ? addDays(cursor, 7) : addMonths(cursor, 1)); }

  const headerLabel = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor); const end = addDays(start, 6);
      return `${start.toLocaleDateString("es-CL", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return cursor.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  }, [view, cursor]);

  async function connectGoogle() {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-connect", {
        body: { origin: window.location.origin },
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error("No URL returned");
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo iniciar la conexión con Google");
      setConnecting(false);
    }
  }

  async function disconnectGoogle() {
    const { error } = await supabase.functions.invoke("calendar-sync", { body: { action: "disconnect" } });
    if (error) return toast.error("Error al desconectar");
    toast.success("Google Calendar desconectado");
    refreshProfile?.();
    setGEvents([]); setTokenExpired(false);
  }

  async function manualSync() {
    setSyncing(true);
    await loadGoogleEvents({ showToast: true });
    setSyncing(false);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarIcon className="h-6 w-6" />Calendario
          </h1>
          <p className="text-sm text-muted-foreground">Agenda tus sesiones y sincronízalas con Google Calendar.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border bg-card p-0.5">
            <button
              className={cn("px-3 py-1.5 text-sm rounded-md", view === "week" ? "bg-secondary font-medium" : "text-muted-foreground")}
              onClick={() => setView("week")}>Semana</button>
            <button
              className={cn("px-3 py-1.5 text-sm rounded-md", view === "month" ? "bg-secondary font-medium" : "text-muted-foreground")}
              onClick={() => setView("month")}>Mes</button>
          </div>
          <Button variant="outline" size="icon" onClick={prev} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={goToday}>Hoy</Button>
          <Button variant="outline" size="icon" onClick={next} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
          {googleConnected && (
            <div className="flex items-center gap-2">
              {lastSyncedAt && !tokenExpired && (
                <span className="text-xs text-muted-foreground hidden md:inline">
                  Última sincronización: {relativeTime(lastSyncedAt)}
                </span>
              )}
              <Button variant="outline" onClick={manualSync} disabled={syncing} className="gap-2">
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "Sincronizando…" : "Sincronizar"}
              </Button>
            </div>
          )}
          <Button onClick={() => openNewAt(new Date())} className="gap-2"><Plus className="h-4 w-4" />Nueva sesión</Button>
        </div>
      </div>

      {!googleConnected && (
        <Card className="p-4 border-dashed bg-muted/30 flex items-center gap-3 flex-wrap">
          <Link2 className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 min-w-[220px]">
            <div className="font-medium text-sm">Conecta tu Google Calendar para sincronizar eventos</div>
            <div className="text-xs text-muted-foreground">
              Las sesiones que crees aquí se publicarán en tu Google Calendar y los eventos de Google se mostrarán en esta vista.
            </div>
          </div>
          <Button onClick={connectGoogle} disabled={connecting}>
            {connecting ? "Redirigiendo…" : "Conectar Google"}
          </Button>
        </Card>
      )}

      {googleConnected && tokenExpired && (
        <Card className="p-3 border-dashed bg-amber-500/10 border-amber-500/30 flex items-center gap-3 text-sm flex-wrap">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div className="flex-1">Tu conexión con Google Calendar expiró. Reconecta tu cuenta para seguir sincronizando.</div>
          <Button size="sm" onClick={connectGoogle} disabled={connecting}>Reconectar</Button>
        </Card>
      )}

      {googleConnected && !tokenExpired && (
        <Card className="p-3 border-dashed bg-teal-500/10 border-teal-500/30 flex items-center gap-3 text-sm flex-wrap">
          <Link2 className="h-4 w-4 text-teal-700" />
          <div className="flex-1">Google Calendar conectado. Las nuevas sesiones se publican automáticamente.</div>
          <Button size="sm" variant="ghost" onClick={disconnectGoogle} className="gap-1">
            <Unlink className="h-3.5 w-3.5" />Desconectar
          </Button>
        </Card>
      )}

      <Card className="p-3">
        <div className="text-sm font-medium px-2 pb-2 capitalize">{headerLabel}</div>
        {view === "week" ? (
          <WeekGrid
            start={startOfWeek(cursor)}
            sessions={sessions}
            gEvents={gEvents}
            patientName={patientName}
            onSlotClick={openNewAt}
            onSessionClick={setActiveSession}
            onGEventClick={setActiveGEvent}
            loading={loading}
          />
        ) : (
          <MonthGrid
            cursorMonth={cursor}
            sessions={sessions}
            gEvents={gEvents}
            patientName={patientName}
            onDayClick={(d) => openNewAt(d)}
            onSessionClick={setActiveSession}
            onGEventClick={setActiveGEvent}
          />
        )}
      </Card>

      {/* Session detail */}
      <Dialog open={!!activeSession} onOpenChange={(o) => !o && setActiveSession(null)}>
        <DialogContent className="max-w-md">
          {activeSession && (
            <>
              <DialogHeader>
                <DialogTitle>Sesión #{activeSession.session_number} — {patientName(activeSession)}</DialogTitle>
                <DialogDescription>
                  {new Date(activeSession.session_date + "T00:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  {activeSession.session_time ? ` · ${activeSession.session_time.slice(0, 5)}` : ""}
                  {" · "}{activeSession.duration_minutes ?? 50} min
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{activeSession.status}</Badge>
                <Badge className="bg-teal-500/15 text-teal-700 dark:text-teal-300 border-0">Psicoasist</Badge>
                {activeSession.google_event_id && (
                  <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0">Google ✓</Badge>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setActiveSession(null)}>Cerrar</Button>
                <Button onClick={() => { const link = patientLink(activeSession); setActiveSession(null); navigate(link); }}>
                  Ir al paciente
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Google event detail */}
      <Dialog open={!!activeGEvent} onOpenChange={(o) => !o && setActiveGEvent(null)}>
        <DialogContent className="max-w-md">
          {activeGEvent && (() => {
            const startD = new Date(activeGEvent.start);
            const endD = activeGEvent.end ? new Date(activeGEvent.end) : null;
            const durMin = endD ? Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 60_000)) : null;
            const fmtTime = (d: Date) => d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{activeGEvent.summary}</DialogTitle>
                  <DialogDescription>
                    {startD.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    {!activeGEvent.allDay && (
                      <> · {fmtTime(startD)}{endD ? `–${fmtTime(endD)}` : ""}{durMin != null ? ` · ${durMin} min` : ""}</>
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 text-sm">
                  <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0 w-fit">Google Calendar</Badge>
                  {activeGEvent.location && (
                    <div><span className="text-muted-foreground">Ubicación:</span> {activeGEvent.location}</div>
                  )}
                  {activeGEvent.description && (
                    <div className="whitespace-pre-wrap text-muted-foreground">{activeGEvent.description}</div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setActiveGEvent(null)}>Cerrar</Button>
                  {activeGEvent.htmlLink && (
                    <Button onClick={() => window.open(activeGEvent.htmlLink!, "_blank")}>Abrir en Google</Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <NewSessionModal
        open={newOpen}
        onOpenChange={setNewOpen}
        prefill={newPrefill}
        googleConnected={googleConnected && !tokenExpired}
        onCreated={() => { setNewOpen(false); load(); }}
      />
    </div>
  );
}

// ----------------- Week grid -----------------
function WeekGrid({
  start, sessions, gEvents, patientName, onSlotClick, onSessionClick, onGEventClick, loading,
}: {
  start: Date;
  sessions: SessionRow[];
  gEvents: GEvent[];
  patientName: (s: SessionRow) => string;
  onSlotClick: (d: Date, h: number) => void;
  onSessionClick: (s: SessionRow) => void;
  onGEventClick: (e: GEvent) => void;
  loading: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();

  const sessionsByDay = useMemo(() => {
    const map: Record<string, SessionRow[]> = {};
    days.forEach((d) => (map[fmtISODate(d)] = []));
    sessions.forEach((s) => { if (map[s.session_date]) map[s.session_date].push(s); });
    return map;
  }, [days, sessions]);

  const gEventsByDay = useMemo(() => {
    const map: Record<string, GEvent[]> = {};
    days.forEach((d) => (map[fmtISODate(d)] = []));
    gEvents.forEach((e) => {
      const d = fmtISODate(new Date(e.start));
      if (map[d]) map[d].push(e);
    });
    return map;
  }, [days, gEvents]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
          <div />
          {days.map((d, i) => (
            <div key={i} className={cn("text-center py-2 text-xs", sameDay(d, today) && "text-primary font-semibold")}>
              <div className="uppercase tracking-wide">{DAY_LABELS[i]}</div>
              <div className={cn("text-base font-medium", sameDay(d, today) && "text-primary")}>{d.getDate()}</div>
            </div>
          ))}
        </div>

        <div className="relative">
          {HOURS.map((h) => (
            <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)] border-b last:border-b-0 min-h-[56px]">
              <div className="text-[11px] text-muted-foreground text-right pr-2 pt-1 border-r">{h}:00</div>
              {days.map((d, i) => (
                <button
                  key={i}
                  onClick={() => onSlotClick(d, h)}
                  className="border-r last:border-r-0 hover:bg-accent/40 transition-colors text-left p-1 relative"
                />
              ))}
            </div>
          ))}

          <div className="absolute inset-0 pointer-events-none grid grid-cols-[60px_repeat(7,1fr)]">
            <div />
            {days.map((d, i) => {
              const list = sessionsByDay[fmtISODate(d)] ?? [];
              const gList = gEventsByDay[fmtISODate(d)] ?? [];
              return (
                <div key={i} className="px-1 pt-1 space-y-1">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      onClick={(e) => { e.stopPropagation(); onSessionClick(s); }}
                      className="pointer-events-auto w-full text-left rounded-md px-2 py-1 text-xs bg-teal-500/15 text-teal-800 dark:text-teal-200 border border-teal-500/30 hover:bg-teal-500/25 truncate"
                      title={`${patientName(s)} · #${s.session_number}`}
                    >
                      {s.session_time && <span className="opacity-70 mr-1">{s.session_time.slice(0, 5)}</span>}
                      <span className="font-medium">#{s.session_number}</span>{" "}
                      <span className="truncate">{patientName(s)}</span>
                    </button>
                  ))}
                  {gList.map((e) => (
                    <button
                      key={e.id}
                      onClick={(ev) => { ev.stopPropagation(); onGEventClick(e); }}
                      className="pointer-events-auto w-full text-left rounded-md px-2 py-1 text-xs bg-blue-500/15 text-blue-800 dark:text-blue-200 border border-blue-500/30 hover:bg-blue-500/25 truncate"
                      title={e.summary}
                    >
                      {!e.allDay && (
                        <span className="opacity-70 mr-1">
                          {new Date(e.start).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      <span className="truncate">{e.summary}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {loading && <div className="text-xs text-muted-foreground text-center py-3">Cargando…</div>}
      </div>
    </div>
  );
}

// ----------------- Month grid -----------------
function MonthGrid({
  cursorMonth, sessions, gEvents, patientName, onDayClick, onSessionClick, onGEventClick,
}: {
  cursorMonth: Date;
  sessions: SessionRow[];
  gEvents: GEvent[];
  patientName: (s: SessionRow) => string;
  onDayClick: (d: Date) => void;
  onSessionClick: (s: SessionRow) => void;
  onGEventClick: (e: GEvent) => void;
}) {
  const start = startOfMonthGrid(cursorMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();
  const month = cursorMonth.getMonth();

  const byDay: Record<string, SessionRow[]> = {};
  sessions.forEach((s) => { (byDay[s.session_date] ??= []).push(s); });
  const gByDay: Record<string, GEvent[]> = {};
  gEvents.forEach((e) => {
    const d = fmtISODate(new Date(e.start));
    (gByDay[d] ??= []).push(e);
  });

  return (
    <div>
      <div className="grid grid-cols-7 border-b">
        {DAY_LABELS.map((l) => (
          <div key={l} className="text-center py-2 text-xs uppercase tracking-wide text-muted-foreground">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const list = byDay[fmtISODate(d)] ?? [];
          const gList = gByDay[fmtISODate(d)] ?? [];
          const total = list.length + gList.length;
          const visibleSess = list.slice(0, 2);
          const visibleG = gList.slice(0, Math.max(0, 3 - visibleSess.length));
          return (
            <button
              key={i}
              onClick={() => onDayClick(d)}
              className={cn(
                "min-h-[96px] border-r border-b last:border-r-0 p-1.5 text-left hover:bg-accent/40 transition-colors flex flex-col gap-1",
                !inMonth && "bg-muted/30 text-muted-foreground",
              )}
            >
              <div className={cn(
                "text-xs font-medium self-end px-1.5 rounded",
                sameDay(d, today) && "bg-primary text-primary-foreground"
              )}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {visibleSess.map((s) => (
                  <div
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onSessionClick(s); }}
                    className="text-[11px] rounded px-1.5 py-0.5 bg-teal-500/15 text-teal-800 dark:text-teal-200 border border-teal-500/30 truncate"
                    title={patientName(s)}
                  >
                    #{s.session_number} {patientName(s)}
                  </div>
                ))}
                {visibleG.map((e) => (
                  <div
                    key={e.id}
                    onClick={(ev) => { ev.stopPropagation(); onGEventClick(e); }}
                    className="text-[11px] rounded px-1.5 py-0.5 bg-blue-500/15 text-blue-800 dark:text-blue-200 border border-blue-500/30 truncate"
                    title={e.summary}
                  >
                    {e.summary}
                  </div>
                ))}
                {total > visibleSess.length + visibleG.length && (
                  <div className="text-[10px] text-muted-foreground">+{total - visibleSess.length - visibleG.length} más</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------- New session modal -----------------
function NewSessionModal({
  open, onOpenChange, prefill, googleConnected, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prefill: { date: string; time: string } | null;
  googleConnected: boolean;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<"adult" | "child">("adult");
  const [patientId, setPatientId] = useState<string>("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(50);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [adults, setAdults] = useState<PatientLite[]>([]);
  const [kids, setKids] = useState<ChildLite[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(prefill?.date ?? fmtISODate(new Date()));
    setTime(prefill?.time ?? "10:00");
    setDuration(50);
    setNotes("");
    setLocation("");
    setPatientId("");
    (async () => {
      const [{ data: a }, { data: c }] = await Promise.all([
        supabase.from("patients").select("id,first_name,last_name").order("first_name"),
        supabase.from("child_patients").select("id,first_name,last_name").order("first_name"),
      ]);
      setAdults((a as PatientLite[]) ?? []);
      setKids((c as ChildLite[]) ?? []);
    })();
  }, [open, prefill]);

  async function save() {
    if (!patientId) return toast.error("Selecciona un paciente");
    if (!date) return toast.error("Fecha obligatoria");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      psychologist_id: user!.id,
      session_date: date,
      session_time: time || null,
      duration_minutes: duration,
      status: "programada",
      pre_session_notes: notes || null,
    };
    if (kind === "adult") payload.patient_id = patientId;
    else payload.child_patient_id = patientId;

    const { data, error } = await supabase.from("sessions").insert(payload).select().single();
    if (error) { setSaving(false); return toast.error(error.message); }

    // Push to Google if connected
    if (googleConnected) {
      const { data: pushData, error: pushErr } = await supabase.functions.invoke("calendar-sync", {
        body: {
          action: "push_session",
          sessionId: data.id,
          location: location || undefined,
          notes: notes || undefined,
        },
      });
      const pushPayload = pushData as any;
      if (pushErr || pushPayload?.error) {
        const msg = pushPayload?.reason || pushPayload?.error || (pushErr as any)?.message || "Error desconocido";
        toast.warning(`Sesión guardada, pero no se publicó en Google: ${msg}`);
      } else {
        toast.success(`Sesión #${data.session_number} programada y sincronizada con Google`);
      }
    } else {
      toast.success(`Sesión #${data.session_number} programada`);
    }

    setSaving(false);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva sesión</DialogTitle>
          <DialogDescription>
            Programa una sesión y enlázala al paciente correspondiente.
            {googleConnected && " Se publicará automáticamente en Google Calendar."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v: "adult" | "child") => { setKind(v); setPatientId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="adult">Adulto</SelectItem>
                  <SelectItem value="child">Infanto-Juvenil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Paciente *</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {(kind === "adult" ? adults : kids).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Hora</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 50)} />
            </div>
          </div>

          <div>
            <Label>Ubicación</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sala 3, Av. Apoquindo 123, link de videollamada…"
            />
          </div>

          <div>
            <Label>Notas previas</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Crear sesión"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
