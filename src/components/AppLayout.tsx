import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, Baby, FileText, MessageSquare, Calendar, LogOut, Inbox } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import ProfileCompletionModal from "@/components/ProfileCompletionModal";
import FeedbackButton from "@/components/FeedbackButton";

const baseItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/assistant", label: "Asistente IA", icon: MessageSquare },
  { to: "/patients", label: "Pacientes", icon: Users },
  { to: "/children", label: "Infanto-Juvenil", icon: Baby },
  { to: "/calendar", label: "Calendario", icon: Calendar },
  { to: "/documents", label: "Documentos", icon: FileText },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const initials = profile
    ? `${profile.first_name[0] ?? ""}${profile.last_name[0] ?? ""}`.toUpperCase()
    : "";

  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    if (!profile?.is_admin) return;
    let cancelled = false;
    async function refresh() {
      const { count } = await supabase
        .from("feedback")
        .select("*", { count: "exact", head: true })
        .eq("status", "nuevo");
      if (!cancelled) setNewCount(count ?? 0);
    }
    refresh();
    const channel = supabase
      .channel("feedback-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, refresh)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profile?.is_admin]);

  const items = profile?.is_admin
    ? [...baseItems, { to: "/feedback", label: "Feedback", icon: Inbox, badge: newCount }]
    : baseItems;

  return (
    <div className="flex min-h-screen w-full bg-surface">
      <ProfileCompletionModal />
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-sidebar-border bg-sidebar fixed inset-y-0 left-0">
        <div className="flex items-center gap-2 px-6 h-16 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold">P</span>
          </div>
          <div>
            <div className="font-semibold text-sidebar-foreground tracking-tight">Psicoasist</div>
            <div className="text-xs text-muted-foreground -mt-0.5">Asistente clínico</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map((it: any) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                )
              }
            >
              <it.icon className="h-4 w-4" />
              <span className="flex-1">{it.label}</span>
              {typeof it.badge === "number" && it.badge > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {it.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-2 border-t border-sidebar-border pt-2">
          <FeedbackButton />
        </div>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-9 w-9 rounded-full bg-primary-soft text-accent-foreground flex items-center justify-center text-sm font-semibold">
              {initials || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {profile ? `${profile.first_name} ${profile.last_name}` : "—"}
              </div>
              {profile?.is_admin && (
                <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Admin</div>
              )}
            </div>
            <button
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 md:pl-64 pb-16 md:pb-0">
        <main className="min-h-screen">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-30 flex">
        {items.map((it: any) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs relative",
                isActive ? "text-primary" : "text-muted-foreground"
              )
            }
          >
            <it.icon className="h-5 w-5" />
            <span className="text-[10px]">{it.label.split(" ")[0]}</span>
            {typeof it.badge === "number" && it.badge > 0 && (
              <span className="absolute top-1 right-1/4 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold">
                {it.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
