import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, FileText, MessageSquare, Plus, Upload, Sparkles } from "lucide-react";

interface Stats {
  patients: number;
  documents: number;
  consultations: number;
}

interface RecentConsult {
  id: string;
  question: string;
  created_at: string;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats>({ patients: 0, documents: 0, consultations: 0 });
  const [recent, setRecent] = useState<RecentConsult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ count: pCount }, { count: dCount }, { count: cCount }, { data: rec }] = await Promise.all([
        supabase.from("patients").select("*", { count: "exact", head: true }),
        supabase.from("documents").select("*", { count: "exact", head: true }),
        supabase.from("consultations").select("*", { count: "exact", head: true }),
        supabase.from("consultations").select("id, question, created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      setStats({ patients: pCount ?? 0, documents: dCount ?? 0, consultations: cCount ?? 0 });
      setRecent((rec as RecentConsult[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const cards = [
    { label: "Pacientes", value: stats.patients, icon: Users, to: "/patients" },
    { label: "Documentos", value: stats.documents, icon: FileText, to: "/documents" },
    { label: "Consultas IA", value: stats.consultations, icon: MessageSquare, to: "/assistant" },
  ];

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Hola{profile?.first_name ? `, ${profile.first_name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">Resumen de tu actividad clínica</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <Link to={c.to} key={c.label}>
            <Card className="p-5 hover:shadow-md transition-shadow cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <div className="h-10 w-10 rounded-lg bg-primary-soft flex items-center justify-center">
                  <c.icon className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="text-3xl font-semibold">{loading ? "—" : c.value}</div>
              <div className="text-sm text-muted-foreground mt-1">{c.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
        <Link to="/patients"><Button variant="outline" className="w-full justify-start gap-2"><Plus className="h-4 w-4" />Nuevo paciente</Button></Link>
        <Link to="/documents"><Button variant="outline" className="w-full justify-start gap-2"><Upload className="h-4 w-4" />Subir documento</Button></Link>
        <Link to="/assistant"><Button className="w-full justify-start gap-2"><Sparkles className="h-4 w-4" />Consultar IA</Button></Link>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-4">Consultas recientes</h2>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 bg-secondary rounded animate-pulse" />)}
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aún no has realizado consultas. <Link to="/assistant" className="text-primary hover:underline">Consulta al asistente →</Link>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="py-3">
                <p className="text-sm line-clamp-2">{r.question}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(r.created_at).toLocaleString("es-CL")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
