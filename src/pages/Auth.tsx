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

export default function Auth() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
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
