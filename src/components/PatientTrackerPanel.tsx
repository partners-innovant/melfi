import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Link2, Copy, Trash2, Smartphone, Share2 } from "lucide-react";

type Link = { id: string; token: string; created_at: string };
type Med = { id: string; name: string; dose: string | null; is_active: boolean };
type Log = { id: string; medication_id: string | null; medication_name: string; medication_dose: string | null; taken_at: string };

export default function PatientTrackerPanel({ patientId }: { patientId: string }) {
  const [link, setLink] = useState<Link | null>(null);
  const [meds, setMeds] = useState<Med[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: l }, { data: m }, { data: lg }] = await Promise.all([
      supabase.from("patient_medication_links" as any).select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("patient_medications" as any).select("id,name,dose,is_active").eq("patient_id", patientId),
      supabase.from("patient_medication_logs" as any).select("*").eq("patient_id", patientId).gte("taken_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("taken_at", { ascending: false }),
    ]);
    setLink((l as any) ?? null);
    setMeds((m as any) ?? []);
    setLogs((lg as any) ?? []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("patient_medication_links" as any).insert({ patient_id: patientId, psychologist_id: user!.id }).select().single();
    if (error) return toast.error(error.message);
    setLink(data as any);
    toast.success("Link generado");
  }

  async function revoke() {
    if (!link) return;
    if (!confirm("¿Revocar el acceso del paciente?")) return;
    const { error } = await supabase.from("patient_medication_links" as any).delete().eq("id", link.id);
    if (error) return toast.error(error.message);
    setLink(null);
    toast.success("Acceso revocado");
  }

  const url = link ? `${window.location.origin}/m/${link.token}` : "";

  function copyLink() {
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }
  function shareWA() {
    const msg = encodeURIComponent(`Hola, te envío tu enlace personal para registrar tus medicamentos: ${url}`);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  }

  function adherenceFor(medId: string, name: string) {
    const days = new Set<string>();
    logs.forEach((l) => {
      if (l.medication_id === medId || l.medication_name.toLowerCase() === name.toLowerCase()) {
        days.add(new Date(l.taken_at).toDateString());
      }
    });
    return Math.round((days.size / 7) * 100);
  }

  function lastTaken(medId: string, name: string) {
    const found = logs.find((l) => l.medication_id === medId || l.medication_name.toLowerCase() === name.toLowerCase());
    return found ? new Date(found.taken_at).toLocaleString("es-CL") : "—";
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" />Tracker del paciente</h2>
        {!link ? (
          <Button size="sm" onClick={generate} className="gap-1.5"><Link2 className="h-3.5 w-3.5" />📱 Generar link para paciente</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={revoke} className="gap-1.5 text-destructive"><Trash2 className="h-3.5 w-3.5" />Revocar acceso</Button>
        )}
      </div>

      {link && (
        <div className="border border-border rounded-lg p-3 mb-4 bg-muted/30">
          <div className="text-xs text-muted-foreground mb-1">Link único del paciente:</div>
          <div className="font-mono text-xs break-all mb-2">{url}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5"><Copy className="h-3.5 w-3.5" />Copiar link</Button>
            <Button size="sm" variant="outline" onClick={shareWA} className="gap-1.5"><Share2 className="h-3.5 w-3.5" />WhatsApp</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
      ) : meds.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin medicamentos registrados aún.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr><th className="text-left py-2">Medicamento</th><th className="text-left">Dosis</th><th className="text-left">Última toma</th><th className="text-left w-40">Adherencia (7 días)</th></tr>
            </thead>
            <tbody>
              {meds.map((m) => {
                const adh = adherenceFor(m.id, m.name);
                return (
                  <tr key={m.id} className="border-b border-border/50">
                    <td className="py-2 font-medium">{m.name}</td>
                    <td>{m.dose || "—"}</td>
                    <td className="text-xs">{lastTaken(m.id, m.name)}</td>
                    <td><div className="flex items-center gap-2"><Progress value={adh} className="h-2" /><span className="text-xs w-10">{adh}%</span></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
