import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Brain } from "lucide-react";
import { lovable } from "@/integrations/lovable";

export default function Auth() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    rut: "",
    phone: "",
  });

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function handleGoogle() {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      // If redirected, browser will navigate away.
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo iniciar sesión con Google");
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Whitelist pre-check (signup or signin)
      const { data: allowed, error: chkErr } = await supabase.rpc("is_email_allowed", {
        _email: form.email,
      });
      if (chkErr) {
        // fail-open if the RPC fails
        console.error("Whitelist RPC error", chkErr);
      } else if (allowed !== true) {
        toast.error(
          "Tu cuenta no está autorizada para acceder a Psicoasist. Si eres psicólogo y quieres solicitar acceso, contacta al administrador.",
          { duration: 8000 },
        );
        setLoading(false);
        return;
      }

      if (mode === "signup") {
        if (!form.first_name || !form.last_name) {
          toast.error("Nombre y apellido son obligatorios");
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              first_name: form.first_name,
              last_name: form.last_name,
              rut: form.rut,
              phone: form.phone,
            },
          },
        });
        if (error) throw error;
        toast.success("Cuenta creada. Revisa tu correo si necesitas verificar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (error) throw error;
        toast.success("Bienvenido");
      }
    } catch (err: any) {
      toast.error(err.message ?? "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="h-11 w-11 rounded-xl bg-primary flex items-center justify-center">
            <Brain className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Psicoasist</h1>
            <p className="text-sm text-muted-foreground -mt-0.5">Asistente clínico para psicólogos</p>
          </div>
        </div>

        <Card className="p-6">
          <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-6">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === "signin" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === "signup" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={handleGoogle}
            disabled={googleLoading}
          >
            <GoogleIcon />
            {googleLoading ? "Conectando..." : "Continuar con Google"}
          </Button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">o con correo</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="fn">Nombre</Label>
                    <Input id="fn" required value={form.first_name} onChange={(e) => update("first_name", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ln">Apellido</Label>
                    <Input id="ln" required value={form.last_name} onChange={(e) => update("last_name", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="rut">RUT</Label>
                    <Input id="rut" value={form.rut} onChange={(e) => update("rut", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="phone">Teléfono</Label>
                    <Input id="phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
                  </div>
                </div>
              </>
            )}
            <div>
              <Label htmlFor="email">Correo electrónico</Label>
              <Input id="email" type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pwd">Contraseña</Label>
              <Input id="pwd" type="password" required minLength={6} value={form.password} onChange={(e) => update("password", e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : mode === "signin" ? "Entrar" : "Crear cuenta"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6-2.74-6-6.1s2.69-6.1 6-6.1c1.88 0 3.14.8 3.86 1.49l2.63-2.53C16.86 3.39 14.66 2.4 12 2.4 6.97 2.4 2.9 6.47 2.9 11.5S6.97 20.6 12 20.6c6.93 0 9.18-4.85 9.18-7.36 0-.5-.06-.88-.13-1.24H12z" />
    </svg>
  );
}
