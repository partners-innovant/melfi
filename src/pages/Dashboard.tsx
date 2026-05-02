import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FeedbackButton from "@/components/FeedbackButton";

type Feature = {
  emoji: string;
  title: string;
  description: string;
  cta: string;
  to?: string;
  feedback?: boolean;
};

const FEATURES: Feature[] = [
  {
    emoji: "✨",
    title: "Asistente IA",
    description:
      "Consulta la literatura clínica basada en evidencia para tomar decisiones terapéuticas. Busca en tu biblioteca de documentos, debate diagnósticos y obtén recomendaciones personalizadas para cada paciente.",
    cta: "Ir al Asistente",
    to: "/assistant",
  },
  {
    emoji: "👤",
    title: "Pacientes",
    description:
      "Gestiona las fichas clínicas de tus pacientes adultos. Construye perfiles con IA, registra sesiones, consulta el historial y exporta informes.",
    cta: "Ver pacientes",
    to: "/patients",
  },
  {
    emoji: "🧒",
    title: "Infanto-Juvenil",
    description:
      "Fichas especializadas para niños y adolescentes. Registra apuntes de sesión, aplica tests psicológicos, genera informes para el colegio y coordina con apoderados.",
    cta: "Ver pacientes",
    to: "/children",
  },
  {
    emoji: "📄",
    title: "Base de conocimiento",
    description:
      "Sube y organiza guías clínicas, artículos científicos y manuales. El Asistente IA usa esta biblioteca para fundamentar sus respuestas con evidencia verificada.",
    cta: "Ver documentos",
    to: "/documents",
  },
  {
    emoji: "📅",
    title: "Calendario",
    description:
      "Agenda y gestiona tus sesiones. Sincroniza con Google Calendar para tener todo en un solo lugar.",
    cta: "Ver calendario",
    to: "/calendar",
  },
  {
    emoji: "💬",
    title: "Sugerencias y mejoras",
    description:
      "¿Tienes ideas para mejorar Psicoasist? Comparte sugerencias, solicita funcionalidades o reporta errores. Tu feedback construye la plataforma.",
    cta: "Enviar feedback",
    feedback: true,
  },
];

function FeatureCard({ f }: { f: Feature }) {
  const button = (
    <Button
      variant="outline"
      className="w-full border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary"
    >
      {f.cta}
    </Button>
  );

  return (
    <Card className="rounded-xl p-6 flex flex-col h-full transition-all border-border hover:border-primary/50 hover:shadow-md">
      <div className="h-10 w-10 rounded-full bg-primary-soft flex items-center justify-center text-xl mb-4">
        <span aria-hidden>{f.emoji}</span>
      </div>
      <h3 className="font-bold text-base mb-2">{f.title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">{f.description}</p>
      {f.feedback ? (
        <FeedbackButton trigger={button} />
      ) : (
        <Link to={f.to!} className="block">{button}</Link>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const name = profile?.first_name ?? "";

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Bienvenido{name ? `, ${name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">¿En qué quieres trabajar hoy?</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 auto-rows-fr">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} f={f} />
        ))}
      </div>
    </div>
  );
}
