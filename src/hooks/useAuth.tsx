import { useEffect, useState, createContext, useContext, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  rut: string | null;
  phone: string | null;
  is_admin: boolean;
  google_calendar_token?: any;
  google_calendar_id?: string | null;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  needsProfileCompletion: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | undefined>(undefined);

function isProfileIncomplete(p: Profile | null) {
  if (!p) return true;
  return !p.first_name?.trim() || !p.last_name?.trim() || !p.rut?.trim() || !p.phone?.trim();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (u: User) => {
    let { data } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
    // If no profile row exists yet (e.g. Google sign-in before trigger creates it), create a stub.
    if (!data) {
      const meta: any = u.user_metadata ?? {};
      const first =
        meta.first_name ||
        meta.given_name ||
        (meta.full_name ? String(meta.full_name).split(" ")[0] : "") ||
        (meta.name ? String(meta.name).split(" ")[0] : "") ||
        "";
      const last =
        meta.last_name ||
        meta.family_name ||
        (meta.full_name ? String(meta.full_name).split(" ").slice(1).join(" ") : "") ||
        (meta.name ? String(meta.name).split(" ").slice(1).join(" ") : "") ||
        "";
      const { data: inserted } = await supabase
        .from("profiles")
        .insert({ id: u.id, first_name: first, last_name: last })
        .select("*")
        .maybeSingle();
      data = inserted;
    }
    setProfile(data as Profile | null);
  };

  const enforceWhitelist = async (u: User): Promise<boolean> => {
    const email = u.email;
    if (!email) return true;
    try {
      const { data, error } = await supabase.rpc("is_email_allowed", { _email: email });
      if (error) {
        console.error("Whitelist check failed", error);
        return true; // fail-open to avoid locking everyone out on RPC error
      }
      if (data === true) return true;
      // Not allowed — sign out and notify
      await supabase.auth.signOut();
      toast.error(
        "Tu cuenta no está autorizada para acceder a Psicoasist. Si eres psicólogo y quieres solicitar acceso, contacta al administrador.",
        { duration: 8000 },
      );
      return false;
    } catch (e) {
      console.error(e);
      return true;
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(async () => {
          const ok = await enforceWhitelist(sess.user);
          if (ok) loadProfile(sess.user);
        }, 0);
      } else {
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        const ok = await enforceWhitelist(sess.user);
        if (ok) await loadProfile(sess.user);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user);
  };

  const needsProfileCompletion = !!user && !loading && isProfileIncomplete(profile);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, needsProfileCompletion, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
