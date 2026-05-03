import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Camera, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RutInput } from "@/components/RutInput";
import { validateRUT } from "@/lib/rut";

const REGIONS = [
  "Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo",
  "Valparaíso", "Metropolitana", "O'Higgins", "Maule", "Ñuble",
  "Biobío", "La Araucanía", "Los Ríos", "Los Lagos", "Aysén", "Magallanes",
];

const SPECIALTIES = [
  "Psicología clínica",
  "Psicología infanto-juvenil",
  "Neuropsicología",
  "Psicología educacional",
  "Psicología organizacional",
  "Psicología forense",
  "Otra",
];

const APPROACHES = [
  "Cognitivo-conductual (TCC)",
  "Psicodinámico",
  "Humanista",
  "Sistémico",
  "ACT",
  "DBT",
  "EMDR",
  "Integrativo",
  "Otro",
];

const COMPLETENESS_FIELDS = [
  "first_name", "last_name", "rut", "phone", "city", "region",
  "specialty", "years_experience", "license_number", "university",
  "graduation_year", "bio", "avatar_url",
];

type ProfileRow = Record<string, any>;

export default function Profile() {
  const { user, refreshProfile } = useAuth();
  const [data, setData] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: row } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      setData(row ?? {});
      setLoading(false);
    })();
  }, [user]);

  const set = (k: string, v: any) => setData((d) => ({ ...(d ?? {}), [k]: v }));

  const completeness = useMemo(() => {
    if (!data) return 0;
    const filled = COMPLETENESS_FIELDS.filter((f) => {
      const v = data[f];
      return v !== null && v !== undefined && String(v).trim() !== "";
    }).length;
    return Math.round((filled / COMPLETENESS_FIELDS.length) * 100);
  }, [data]);

  const saveSection = async (section: string, fields: string[]) => {
    if (!user || !data) return;
    if (fields.includes("rut") && data.rut && !validateRUT(data.rut)) {
      toast.error("El RUT ingresado no es válido");
      return;
    }
    setSavingSection(section);
    const patch: ProfileRow = {};
    for (const f of fields) patch[f] = data[f] ?? null;
    const { error } = await supabase.from("profiles").update(patch as any).eq("id", user.id);
    setSavingSection(null);
    if (error) {
      toast.error("Error al guardar: " + error.message);
      return;
    }
    setSavedSection(section);
    setTimeout(() => setSavedSection((s) => (s === section ? null : s)), 2500);
    refreshProfile();
  };

  const handleAvatar = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", user.id);
      if (updErr) throw updErr;
      set("avatar_url", url);
      refreshProfile();
      toast.success("Foto actualizada");
    } catch (e: any) {
      toast.error("Error al subir foto: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const toggleApproach = (a: string) => {
    const cur: string[] = data?.theoretical_approach ?? [];
    set(
      "theoretical_approach",
      cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a],
    );
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const initials = `${data.first_name?.[0] ?? ""}${data.last_name?.[0] ?? ""}`.toUpperCase();

  const SectionFooter = ({ section, fields }: { section: string; fields: string[] }) => (
    <div className="flex items-center gap-3 pt-2">
      <Button onClick={() => saveSection(section, fields)} disabled={savingSection === section}>
        {savingSection === section ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>
        ) : (
          "Guardar cambios"
        )}
      </Button>
      {savedSection === section && (
        <span className="text-sm text-emerald-600 inline-flex items-center gap-1">
          <Check className="h-4 w-4" /> Guardado
        </span>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">
          Completa tu perfil para que Psicoasist personalice mejor tu experiencia.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Perfil completado al {completeness}%</span>
            <span className="text-xs text-muted-foreground">
              {COMPLETENESS_FIELDS.filter((f) => data[f]).length} / {COMPLETENESS_FIELDS.length} campos
            </span>
          </div>
          <Progress value={completeness} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 flex flex-col items-center text-center">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="relative h-[120px] w-[120px] rounded-full bg-primary-soft text-accent-foreground flex items-center justify-center text-3xl font-semibold overflow-hidden group"
              >
                {data.avatar_url ? (
                  <img src={data.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials || "?"
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                  {uploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  ) : (
                    <Camera className="h-6 w-6 text-white" />
                  )}
                </div>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatar(f);
                  e.target.value = "";
                }}
              />
              <div className="mt-4 font-semibold text-lg">
                {data.first_name} {data.last_name}
              </div>
              {data.specialty && (
                <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 text-xs font-medium">
                  {data.specialty}
                </span>
              )}
              {(data.city || data.region) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {[data.city, data.region].filter(Boolean).join(", ")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right side */}
        <div className="space-y-6">
          {/* Section 1 */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Información personal</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Nombre</Label><Input value={data.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></div>
                <div><Label>Apellido</Label><Input value={data.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></div>
                <div><Label>RUT</Label><RutInput value={data.rut ?? ""} onChange={(v) => set("rut", v)} /></div>
                <div><Label>Teléfono</Label><Input value={data.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></div>
                <div><Label>Email</Label><Input value={user?.email ?? ""} readOnly disabled /></div>
                <div><Label>Ciudad</Label><Input value={data.city ?? ""} onChange={(e) => set("city", e.target.value)} /></div>
                <div className="md:col-span-2">
                  <Label>Región</Label>
                  <Select value={data.region ?? ""} onValueChange={(v) => set("region", v)}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar región" /></SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <SectionFooter section="personal" fields={["first_name", "last_name", "rut", "phone", "city", "region"]} />
            </CardContent>
          </Card>

          {/* Section 2 */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Información profesional</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Especialidad principal</Label>
                  <Select value={data.specialty ?? ""} onValueChange={(v) => set("specialty", v)}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                    <SelectContent>
                      {SPECIALTIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Especialidad secundaria</Label>
                  <Select value={data.secondary_specialty ?? ""} onValueChange={(v) => set("secondary_specialty", v)}>
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      {SPECIALTIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Enfoque teórico</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {APPROACHES.map((a) => {
                    const active = (data.theoretical_approach ?? []).includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleApproach(a)}
                        className={cn(
                          "px-3 py-1 rounded-full text-xs border transition",
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-secondary border-input",
                        )}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Años de experiencia</Label>
                  <Input type="number" min={0} value={data.years_experience ?? ""} onChange={(e) => set("years_experience", e.target.value === "" ? null : Number(e.target.value))} />
                </div>
                <div>
                  <Label>N° de registro/colegiatura</Label>
                  <Input value={data.license_number ?? ""} onChange={(e) => set("license_number", e.target.value)} />
                </div>
                <div>
                  <Label>Institución actual</Label>
                  <Input value={data.institution ?? ""} onChange={(e) => set("institution", e.target.value)} />
                </div>
              </div>
              <SectionFooter section="professional" fields={["specialty", "secondary_specialty", "theoretical_approach", "years_experience", "license_number", "institution"]} />
            </CardContent>
          </Card>

          {/* Section 3 */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Formación académica</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Universidad de pregrado</Label>
                  <Input value={data.university ?? ""} onChange={(e) => set("university", e.target.value)} />
                </div>
                <div>
                  <Label>Año de titulación</Label>
                  <Input type="number" min={1950} max={2100} value={data.graduation_year ?? ""} onChange={(e) => set("graduation_year", e.target.value === "" ? null : Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label>Posgrados / especializaciones</Label>
                <Textarea
                  rows={4}
                  placeholder="Lista títulos, instituciones y años…"
                  value={data.postgraduate ?? ""}
                  onChange={(e) => set("postgraduate", e.target.value)}
                />
              </div>
              <SectionFooter section="academic" fields={["university", "graduation_year", "postgraduate"]} />
            </CardContent>
          </Card>

          {/* Section 4 */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Sobre mí</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Bio profesional</Label>
                <Textarea
                  rows={5}
                  maxLength={500}
                  value={data.bio ?? ""}
                  onChange={(e) => set("bio", e.target.value)}
                  placeholder="Breve descripción pública…"
                />
                <div className="text-xs text-muted-foreground mt-1 text-right">
                  {(data.bio ?? "").length}/500
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Sitio web</Label>
                  <Input type="url" value={data.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
                </div>
                <div>
                  <Label>LinkedIn</Label>
                  <Input type="url" value={data.linkedin ?? ""} onChange={(e) => set("linkedin", e.target.value)} placeholder="https://linkedin.com/in/…" />
                </div>
              </div>
              <SectionFooter section="about" fields={["bio", "website", "linkedin"]} />
            </CardContent>
          </Card>

          {/* Section 5 */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Configuración</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Duración predeterminada de sesión</Label>
                  <Select value={String(data.default_session_duration ?? 50)} onValueChange={(v) => set("default_session_duration", Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[45, 50, 60, 90].map((n) => <SelectItem key={n} value={String(n)}>{n} min</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Frecuencia predeterminada</Label>
                  <Select value={data.default_session_frequency ?? "semanal"} onValueChange={(v) => set("default_session_frequency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="semanal">Semanal</SelectItem>
                      <SelectItem value="quincenal">Quincenal</SelectItem>
                      <SelectItem value="mensual">Mensual</SelectItem>
                      <SelectItem value="a_demanda">A demanda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Idioma de la plataforma</Label>
                  <Select value="es" disabled>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="es">Español</SelectItem></SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notificaciones</Label>
                  <div className="text-xs text-muted-foreground mt-2">Próximamente</div>
                </div>
              </div>
              <SectionFooter section="settings" fields={["default_session_duration", "default_session_frequency"]} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
