import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Baby, FileText, MessageSquare, Calendar, LogOut, Inbox, ChevronLeft, ChevronRight, Database, UserCog } from "lucide-react";
import claudeLogo from "@/assets/claude-logo.png";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ProfileCompletionModal from "@/components/ProfileCompletionModal";
import FeedbackButton from "@/components/FeedbackButton";

const baseItems = [
  { to: "/", label: "Inicio", icon: LayoutDashboard, end: true },
  { to: "/assistant", label: "Asistente IA", icon: MessageSquare },
  { to: "/patients", label: "Pacientes", icon: Users },
  { to: "/children", label: "Infanto-Juvenil", icon: Baby },
  { to: "/calendar", label: "Calendario", icon: Calendar },
  { to: "/documents", label: "Documentos", icon: FileText },
];

const STORAGE_KEY = "sidebar:collapsed";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = profile
    ? `${profile.first_name[0] ?? ""}${profile.last_name[0] ?? ""}`.toUpperCase()
    : "";
  const avatarUrl = (profile as any)?.avatar_url as string | null | undefined;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

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
    ? [
        ...baseItems,
        { to: "/admin/documents", label: "Gestor de documentos", icon: Database },
        { to: "/admin/therapists", label: "Terapeutas", icon: UserCog },
        { to: "/feedback", label: "Feedback", icon: Inbox, badge: newCount },
      ]
    : baseItems;

  const sidebarWidth = collapsed ? "w-16" : "w-64";
  const mainPad = collapsed ? "md:pl-16" : "md:pl-64";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen w-full bg-surface">
        <ProfileCompletionModal />
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden md:flex flex-col border-r border-sidebar-border bg-sidebar fixed inset-y-0 left-0 transition-[width] duration-200 ease-in-out",
            sidebarWidth,
          )}
        >
          <div
            className={cn(
              "flex items-center h-16 border-b border-sidebar-border",
              collapsed ? "justify-center px-2" : "gap-2 px-6",
            )}
          >
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-primary-foreground font-bold">P</span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-semibold text-sidebar-foreground tracking-tight truncate">Psicoasist</div>
                <div className="text-xs text-muted-foreground -mt-0.5 truncate">Asistente clínico</div>
              </div>
            )}
          </div>

          {/* Collapse toggle */}
          <div className={cn("px-2 pt-2 flex", collapsed ? "justify-center" : "justify-end")}>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
              aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
              title={collapsed ? "Expandir menú" : "Colapsar menú"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className={cn("flex-1 py-3 space-y-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-2" : "px-3")}>
            {items.map((it: any) => {
              const link = (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    cn(
                      "relative flex items-center rounded-lg text-sm font-medium transition-colors",
                      collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )
                  }
                >
                  <it.icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                  {typeof it.badge === "number" && it.badge > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold",
                        collapsed ? "absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 text-[9px]" : "ml-auto",
                      )}
                    >
                      {it.badge}
                    </span>
                  )}
                </NavLink>
              );

              if (collapsed) {
                return (
                  <Tooltip key={it.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {it.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return link;
            })}
          </nav>

          <div className={cn("border-t border-sidebar-border pt-2 pb-2", collapsed ? "px-2" : "px-3")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div><FeedbackButton collapsed /></div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Feedback</TooltipContent>
              </Tooltip>
            ) : (
              <FeedbackButton />
            )}
          </div>

          <div className={cn("border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate("/profile")}
                      className="h-9 w-9 rounded-full bg-primary-soft text-accent-foreground flex items-center justify-center text-sm font-semibold overflow-hidden hover:ring-2 hover:ring-primary/40 transition"
                      aria-label="Mi perfil"
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials || "?"
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {profile ? `${profile.first_name} ${profile.last_name}` : "—"}
                    {profile?.is_admin && " · Admin"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={signOut}
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary"
                      aria-label="Cerrar sesión"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>Cerrar sesión</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-2 py-2">
                <button
                  onClick={() => navigate("/profile")}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-md hover:bg-sidebar-accent/60 -mx-1 px-1 py-1 transition"
                  aria-label="Mi perfil"
                >
                  <div className="h-9 w-9 rounded-full bg-primary-soft text-accent-foreground flex items-center justify-center text-sm font-semibold overflow-hidden flex-shrink-0">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials || "?"
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {profile ? `${profile.first_name} ${profile.last_name}` : "—"}
                    </div>
                    {profile?.is_admin && (
                      <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Admin</div>
                    )}
                  </div>
                </button>
                <button
                  onClick={signOut}
                  className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary"
                  aria-label="Cerrar sesión"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main area */}
        <div className={cn("flex-1 pb-16 md:pb-0 transition-[padding] duration-200 ease-in-out", mainPad)}>
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
                  isActive ? "text-primary" : "text-muted-foreground",
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
    </TooltipProvider>
  );
}
