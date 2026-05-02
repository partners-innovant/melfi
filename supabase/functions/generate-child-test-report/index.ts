import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function calcAge(birthDate: string | null): string {
  if (!birthDate) return "edad desconocida";
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

const TEST_LABELS: Record<string, string> = {
  wisc: "WISC (Escala Wechsler de Inteligencia para Niños)",
  htp: "HTP (Casa-Árbol-Persona, test proyectivo)",
  figura_humana: "Test de la Figura Humana (Goodenough/Koppitz)",
  familia: "Test de la Familia (Corman)",
  persona_bajo_lluvia: "Persona Bajo la Lluvia",
  bender: "Test Gestáltico Visomotor de Bender",
  conners: "Escalas Conners (TDAH y conductual)",
  raven: "Matrices Progresivas de Raven",
  otro: "Test psicométrico/proyectivo",
};

function buildPrompt(test: any, child: any): string {
  const testLabel = TEST_LABELS[test.test_type] ?? test.test_name;
  const structured = test.results_structured ? JSON.stringify(test.results_structured, null, 2) : "(sin datos estructurados)";
  const raw = test.results_raw ?? "(sin observaciones cualitativas registradas)";
  const notes = test.notes ?? "(sin notas adicionales)";

  return `Eres un psicólogo clínico infanto-juvenil con experiencia en evaluación. Genera un INFORME PROFESIONAL del siguiente test aplicado, en español, con tono clínico y respetuoso.

DATOS DEL EVALUADO:
- Nombre: ${child.first_name} ${child.last_name}
- Edad: ${calcAge(child.birth_date)}
- Sexo: ${child.sex ?? "no especificado"}
- Colegio/Curso: ${child.school ?? "—"} / ${child.grade ?? "—"}
- Motivo de derivación: ${child.referral_reason ?? "—"}
- Diagnóstico médico previo: ${child.medical_diagnosis ?? "ninguno registrado"}

TEST APLICADO: ${testLabel}
Fecha de evaluación: ${test.evaluation_date}

RESULTADOS ESTRUCTURADOS:
${structured}

OBSERVACIONES CUALITATIVAS:
${raw}

NOTAS ADICIONALES:
${notes}

INSTRUCCIONES:
Genera un informe estructurado en Markdown con estas secciones:

# Informe — ${testLabel}

## 1. Datos de identificación
(nombre, edad, fecha)

## 2. Instrumento aplicado
(breve descripción del test, qué evalúa, validez/uso clínico)

## 3. Conducta observada durante la evaluación
(integra las observaciones cualitativas dadas)

## 4. Resultados
(interpreta los datos estructurados y/o cualitativos en términos psicológicos. Para WISC incluye análisis por índices y comparación con la media 100; para tests proyectivos describe indicadores presentes; para Conners interpreta los puntajes T y áreas; para Bender comenta indicadores madurativos/orgánicos; para Raven da percentil/CI estimado)

## 5. Análisis e interpretación clínica
(integra los hallazgos y los relaciona con el motivo de derivación)

## 6. Conclusiones
(síntesis clara, evita diagnósticos categóricos si no hay evidencia suficiente; usa lenguaje descriptivo)

## 7. Sugerencias y recomendaciones
(intervenciones, derivaciones, apoyos pedagógicos cuando corresponda)

REGLAS:
- Usa SIEMPRE lenguaje profesional y descriptivo, no patologizante.
- No inventes datos que no estén disponibles; señala cuando algo "no se evaluó" o "no se observó".
- No sustituyas el juicio clínico del profesional. Indica que es una propuesta interpretativa.
- Devuelve SOLO el informe en Markdown, sin texto adicional antes o después.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { test_id } = await req.json();
    if (!test_id || typeof test_id !== "string") {
      return new Response(JSON.stringify({ error: "test_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: test, error: tErr } = await userClient
      .from("child_tests").select("*").eq("id", test_id).maybeSingle();
    if (tErr || !test) {
      return new Response(JSON.stringify({ error: "Test no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: child } = await userClient
      .from("child_patients").select("*").eq("id", test.child_patient_id).maybeSingle();
    if (!child) {
      return new Response(JSON.stringify({ error: "Paciente no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = buildPrompt(test, child);

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Using Sonnet — clinical reasoning required
        model: "claude-sonnet-4-5",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResp.ok) {
      const txt = await claudeResp.text();
      console.error("[generate-child-test-report] Claude error", claudeResp.status, txt);
      return new Response(
        JSON.stringify({ error: `Claude API ${claudeResp.status}: ${txt.slice(0, 500)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await claudeResp.json();
    const report: string = (data?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    const { error: upErr } = await userClient
      .from("child_tests")
      .update({ generated_report: report })
      .eq("id", test_id);
    if (upErr) console.error("[generate-child-test-report] update err", upErr);

    return new Response(
      JSON.stringify({ report }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[generate-child-test-report] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
