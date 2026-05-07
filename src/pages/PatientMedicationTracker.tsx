import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Pill, Plus, History, Check, Trash2 } from "lucide-react";

const BG = "#F8F6F1";
const PRIMARY = "#2C3E35";
const TEXT = "#1A1A1A";
const ACCENT = "#8B9E98";

type Screen = "home" | "intake" | "new" | "history" | "confirm";
type Med = { id: string; name: string; dose: string | null; is_active: boolean };
type Log = { id: string; medication_id: string | null; medication_name: string; medication_dose: string | null; taken_at: string };

const bigBtn: React.CSSProperties = {
  width: "100%", minHeight: 64, borderRadius: 16, background: PRIMARY, color: "white",
  fontSize: 18, fontWeight: 600, border: "none", cursor: "pointer", padding: "0 20px",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
};
const ghostBtn: React.CSSProperties = {
  ...bigBtn, background: "transparent", color: PRIMARY, border: `1.5px solid ${PRIMARY}`,
};

export default function PatientMedicationTracker() {
  const { token = "" } = useParams();
  const [screen, setScreen] = useState<Screen>("home");
  const [ctx, setCtx] = useState<{ patient_first_name: string } | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [recent15, setRecent15] = useState<{ name: string; dose: string | null }[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [todayLogs, setTodayLogs] = useState<Log[]>([]);
  const [historyLogs, setHistoryLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // existing med ids
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set()); // names
  const [newName, setNewName] = useState("");
  const [newDose, setNewDose] = useState("");
  const [saving, setSaving] = useState(false);

  const init = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: c, error: ce }, { data: m }, { data: lg }] = await Promise.all([
      supabase.rpc("tracker_get_context", { _token: token }),
      supabase.rpc("tracker_list_medications", { _token: token }),
      supabase.rpc("tracker_list_logs", { _token: token, _days: 30 }),
    ]);
    if (ce || !c || (Array.isArray(c) && c.length === 0)) {
      setError("Link inválido o expirado.");
      setLoading(false);
      return;
    }
    const ctxRow = Array.isArray(c) ? c[0] : c;
    setCtx(ctxRow);
    setMeds((m as any) ?? []);
    setLogs((lg as any) ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    const medNames = new Set(meds.map((x) => x.name.toLowerCase()));
    const cutoff = Date.now() - 15 * 86400000;
    const map = new Map<string, { name: string; dose: string | null }>();
    logs.forEach((l) => {
      if (new Date(l.taken_at).getTime() < cutoff) return;
      if (medNames.has(l.medication_name.toLowerCase())) return;
      const key = l.medication_name.toLowerCase();
      if (!map.has(key)) map.set(key, { name: l.medication_name, dose: l.medication_dose });
    });
    setRecent15(Array.from(map.values()));
  }, [logs, meds]);

  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  }

  async function refreshLogs() {
    const { data } = await supabase.rpc("tracker_list_logs", { _token: token, _days: 30 });
    setLogs((data as any) ?? []);
    return (data as any) ?? [];
  }

  async function registerSelected() {
    if (selected.size === 0 && selectedRecent.size === 0) return;
    setSaving(true);
    try {
      for (const id of selected) await supabase.rpc("tracker_log_intake", { _token: token, _medication_id: id });
      for (const name of selectedRecent) {
        const found = recent15.find((r) => r.name === name);
        await supabase.rpc("tracker_log_intake_by_name", { _token: token, _name: name, _dose: found?.dose ?? null });
      }
      const fresh = await refreshLogs();
      setTodayLogs((fresh as Log[]).filter((l) => new Date(l.taken_at).getTime() >= todayStart));
      setSelected(new Set()); setSelectedRecent(new Set());
      setScreen("confirm");
    } finally { setSaving(false); }
  }

  async function registerNew() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await supabase.rpc("tracker_create_medication", { _token: token, _name: newName.trim(), _dose: newDose.trim() || null });
      const { data } = await supabase.rpc("tracker_list_medications", { _token: token });
      setMeds((data as any) ?? []);
      await refreshLogs();
      setNewName(""); setNewDose("");
      setTimeout(() => setScreen("home"), 1500);
    } finally { setSaving(false); }
  }

  async function deleteLog(id: string) {
    await supabase.rpc("tracker_delete_log", { _token: token, _log_id: id });
    const fresh = await refreshLogs();
    setTodayLogs((fresh as Log[]).filter((l) => new Date(l.taken_at).getTime() >= todayStart));
  }

  // ====== Render ======
  const wrap: React.CSSProperties = {
    minHeight: "100vh", background: BG, color: TEXT,
    fontFamily: "system-ui, -apple-system, 'Helvetica Neue', sans-serif",
    padding: "24px 20px 40px", maxWidth: 480, margin: "0 auto",
  };

  if (loading) return <div style={wrap}><p>Cargando...</p></div>;
  if (error) return <div style={wrap}><p style={{ textAlign: "center", marginTop: 60 }}>{error}</p></div>;

  const Header = ({ title }: { title: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
      <button onClick={() => setScreen("home")} style={{ background: "transparent", border: "none", cursor: "pointer", color: TEXT, padding: 8, marginLeft: -8 }}><ArrowLeft size={24} /></button>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{title}</h1>
    </div>
  );

  if (screen === "home") {
    const today = new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
    return (
      <div style={wrap}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}><Pill size={28} />Mis pastillas</h1>
          <p style={{ color: ACCENT, marginTop: 6, fontSize: 15, textTransform: "capitalize" }}>{today}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <button style={bigBtn} onClick={() => setScreen("intake")}><Check size={22} />Ingerido ahora</button>
          <button style={ghostBtn} onClick={() => setScreen("new")}><Plus size={22} />Nueva pastilla</button>
          <button style={ghostBtn} onClick={() => { setHistoryLogs(logs); setScreen("history"); }}><History size={22} />Historial</button>
        </div>
      </div>
    );
  }

  if (screen === "intake") {
    return (
      <div style={wrap}>
        <Header title="Ingerido ahora" />
        <h3 style={{ fontSize: 14, color: ACCENT, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Mis medicamentos</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          {meds.length === 0 && <p style={{ fontSize: 14, color: ACCENT }}>Sin medicamentos registrados. Usa "Nueva pastilla".</p>}
          {meds.map((m) => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 16px", background: "white", borderRadius: 12, border: `1px solid ${selected.has(m.id) ? PRIMARY : "rgba(0,0,0,0.08)"}`, cursor: "pointer", minHeight: 56 }}>
              <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(selected, m.id, setSelected)} />
              <div><div style={{ fontWeight: 600 }}>{m.name}</div>{m.dose && <div style={{ fontSize: 13, color: ACCENT }}>{m.dose}</div>}</div>
            </label>
          ))}
        </div>

        {recent15.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, color: ACCENT, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Últimos 15 días</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
              {recent15.map((r) => (
                <label key={r.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px", background: "white", borderRadius: 12, border: `1px solid ${selectedRecent.has(r.name) ? PRIMARY : "rgba(0,0,0,0.08)"}`, cursor: "pointer", minHeight: 56 }}>
                  <Checkbox checked={selectedRecent.has(r.name)} onCheckedChange={() => toggle(selectedRecent, r.name, setSelectedRecent)} />
                  <div><div style={{ fontWeight: 600 }}>{r.name}</div>{r.dose && <div style={{ fontSize: 13, color: ACCENT }}>{r.dose}</div>}</div>
                </label>
              ))}
            </div>
          </>
        )}

        <button style={{ ...bigBtn, opacity: (selected.size + selectedRecent.size === 0 || saving) ? 0.5 : 1 }} disabled={saving || (selected.size + selectedRecent.size === 0)} onClick={registerSelected}>
          {saving ? "Guardando..." : "Registrar seleccionados"}
        </button>
      </div>
    );
  }

  if (screen === "confirm") {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 24px" }}>✅ Registrado</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
          {todayLogs.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "white", borderRadius: 12, border: "1px solid rgba(0,0,0,0.08)" }}>
              <div><div style={{ fontWeight: 600 }}>{l.medication_name}{l.medication_dose ? ` ${l.medication_dose}` : ""}</div><div style={{ fontSize: 13, color: ACCENT }}>{new Date(l.taken_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</div></div>
              <button onClick={() => deleteLog(l.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: ACCENT, padding: 8 }}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
        <button style={ghostBtn} onClick={() => setScreen("home")}><ArrowLeft size={22} />Volver</button>
      </div>
    );
  }

  if (screen === "new") {
    return (
      <div style={wrap}>
        <Header title="Nueva pastilla" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
          <div>
            <label style={{ fontSize: 14, color: ACCENT, marginBottom: 6, display: "block" }}>Nombre</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej. Concerta 36mg" style={{ height: 56, fontSize: 16 }} />
          </div>
          <div>
            <label style={{ fontSize: 14, color: ACCENT, marginBottom: 6, display: "block" }}>Dosis (opcional)</label>
            <Input value={newDose} onChange={(e) => setNewDose(e.target.value)} placeholder="Ej. 1 comprimido" style={{ height: 56, fontSize: 16 }} />
          </div>
        </div>
        <button style={{ ...bigBtn, opacity: !newName.trim() || saving ? 0.5 : 1 }} disabled={!newName.trim() || saving} onClick={registerNew}>
          {saving ? "✅ Registrado" : "Registrar ahora"}
        </button>
      </div>
    );
  }

  if (screen === "history") {
    const days: { key: string; label: string }[] = [];
    const today = new Date(); today.setHours(0,0,0,0);
    const labels = ["D","L","M","X","J","V","S"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      days.push({ key: d.toDateString(), label: labels[d.getDay()] });
    }
    const allMeds = [...meds.map((m) => ({ id: m.id, name: m.name })), ...recent15.map((r) => ({ id: r.name, name: r.name }))];
    let hits = 0;
    const total = allMeds.length * 7;
    return (
      <div style={wrap}>
        <Header title="Historial" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {allMeds.map((m) => {
            const taken = new Set<string>();
            logs.forEach((l) => { if (l.medication_name.toLowerCase() === m.name.toLowerCase()) taken.add(new Date(l.taken_at).toDateString()); });
            return (
              <div key={m.id} style={{ background: "white", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(0,0,0,0.08)" }}>
                <div style={{ fontWeight: 600, marginBottom: 10 }}>{m.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {days.map((d) => {
                    const ok = taken.has(d.key);
                    if (ok) hits++;
                    return (
                      <div key={d.key} style={{ textAlign: "center", flex: 1 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: ok ? PRIMARY : "transparent", border: ok ? "none" : `1.5px solid ${ACCENT}`, color: "white", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{ok ? "✓" : ""}</div>
                        <div style={{ fontSize: 11, color: ACCENT, marginTop: 4 }}>{d.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {total > 0 && <p style={{ marginTop: 24, textAlign: "center", color: PRIMARY, fontWeight: 600 }}>Adherencia general: {Math.round((hits / total) * 100)}%</p>}
        {allMeds.length === 0 && <p style={{ color: ACCENT, textAlign: "center", marginTop: 32 }}>Sin medicamentos aún.</p>}
      </div>
    );
  }

  return null;
}
