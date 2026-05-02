import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RutInput } from "@/components/RutInput";
import { validateRUT } from "@/lib/rut";

export default function ProfileCompletionModal() {
  const { user, profile, needsProfileCompletion, refreshProfile } = useAuth();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [rut, setRut] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirst(profile.first_name ?? "");
    setLast(profile.last_name ?? "");
    setRut(profile.rut ?? "");
    setPhone(profile.phone ?? "");
  }, [profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!first.trim() || !last.trim() || !rut.trim() || !phone.trim()) {
      toast.error("Todos los campos son obligatorios");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: first.trim(), last_name: last.trim(), rut: rut.trim(), phone: phone.trim() })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Perfil completado");
    await refreshProfile();
  }

  return (
    <Dialog open={needsProfileCompletion}>
      <DialogContent
        className="max-w-md [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Completa tu perfil</DialogTitle>
          <DialogDescription>
            Necesitamos algunos datos adicionales para activar tu cuenta de Psicoasist.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pf-first">Nombre *</Label>
              <Input id="pf-first" value={first} onChange={(e) => setFirst(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="pf-last">Apellido *</Label>
              <Input id="pf-last" value={last} onChange={(e) => setLast(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="pf-rut">RUT *</Label>
            <Input id="pf-rut" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9" required />
          </div>
          <div>
            <Label htmlFor="pf-phone">Teléfono *</Label>
            <Input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 1234 5678" required />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Guardando..." : "Continuar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
