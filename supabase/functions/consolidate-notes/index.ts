import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Melfi, asistente clínico especializado en redacción de fichas psicológicas. Se te proporciona el campo de notas clínicas de un paciente que ha sido actualizado múltiples veces a lo largo del tiempo y contiene información acumulada, posiblemente repetida o desorganizada.

Tu tarea es consolidar toda esta información en un único texto clínico estructurado, coherente y sin repeticiones.

Reglas:
- Elimina toda la información duplicada o redundante — mantén la versión más completa o reciente
- Organiza en secciones lógicas: Antecedentes clínicos, Presentación clínica, Dinámica relacional, Área laboral/educacional, Medicación, Objetivos terapéuticos, Observaciones de proceso
- Solo incluye secciones que tengan contenido real
- Escribe en tercera persona, lenguaje clínico profesional
- Mantén TODA la información relevante — no elimines datos, solo elimina repeticiones
- Ignora los separadores de timestamp (--- Nota agregada el ...) — son metadatos, no contenido clínico
- Máximo 600 palabras
- El resultado debe leerse como una ficha clínica unificada y coherente, no como una lista de entradas

Responde SOLO con el texto consolidado, sin explicaciones adicionales.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { notes } = await req.json();
    if (!notes || typeof notes !== "string") throw new Error("notes required");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Using Sonnet — clinical reasoning required
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Notas actuales del paciente:\n${notes}` }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API error: ${errText}`);
    }
    const data = await resp.json();
    const consolidated = data.content?.[0]?.text ?? "";

    return new Response(JSON.stringify({ consolidated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
