import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Eres Psicoasist, un asistente clínico especializado para psicólogos. Tienes acceso a una base de conocimiento de documentos clínicos, papers y protocolos cargados por el psicólogo.

REGLAS CRÍTICAS:
- Responde SIEMPRE en español, sin importar el idioma del documento fuente. Si el paper está en inglés, léelo, comprénderlo y responde en español.
- Basa tus respuestas ÚNICAMENTE en los fragmentos de documentos proporcionados como contexto.
- Si la respuesta no está en los documentos disponibles, di exactamente: "No tengo información suficiente en los documentos cargados para responder esta pregunta."
- Nunca diagnostiques pacientes. Tu rol es apoyar el juicio clínico del psicólogo, no reemplazarlo.
- Sé preciso, basado en evidencia y profesional.

FORMATO DE RESPUESTA OBLIGATORIO:
Responde SIEMPRE con este JSON exacto, sin texto adicional fuera del JSON:

{
  "answer": "Tu respuesta completa en español. Cada afirmación clínica relevante debe incluir un marcador de cita como [cita:CHUNK_ID] inmediatamente después de la afirmación que respalda.",
  "citations": [
    {
      "chunk_id": "el id exacto del chunk usado",
      "document_title": "título del documento",
      "author": "autor si está disponible",
      "year": "año si está disponible",
      "page_number": "número de página aproximado",
      "excerpt": "el fragmento exacto del texto original en el idioma del paper que respalda la afirmación"
    }
  ]
}

Si no hay citas relevantes, devuelve citations como array vacío [].`;

function calcAge(birthDate: string | null): string {
  if (!birthDate) return "desconocida";
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

function timeInTherapy(startDate: string | null): string {
  if (!startDate) return "desconocido";
  const d = new Date(startDate);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "menos de un mes";
  if (months < 12) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `${years} ${years === 1 ? "año" : "años"}${rem > 0 ? ` y ${rem} ${rem === 1 ? "mes" : "meses"}` : ""}`;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  articulo_cientifico: "Artículo científico",
  guia_clinica: "Guía clínica",
  manual_diagnostico: "Manual diagnóstico",
  libro_academico: "Libro académico",
  codigo_etico: "Código ético",
  informe_consenso: "Informe de consenso",
  otro: "Otro",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

    // Verify user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { question, patient_id, document_type, query_embedding } = await req.json();

    if (!question || !query_embedding) {
      return new Response(JSON.stringify({ error: "question y query_embedding requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find chunks
    const { data: chunks, error: matchErr } = await supabase.rpc("match_chunks", {
      query_embedding,
      match_count: 5,
      p_psychologist_id: user.id,
      p_document_type: document_type || null,
    });

    if (matchErr) {
      console.error("match_chunks error:", matchErr);
      throw matchErr;
    }

    // Fetch document metadata
    const docIds = [...new Set((chunks ?? []).map((c: any) => c.document_id))];
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, author, year, document_type")
      .in("id", docIds);
    const docMap = new Map((docs ?? []).map((d: any) => [d.id, d]));

    // Patient context
    let patientCtx = "";
    if (patient_id) {
      const { data: p } = await supabase
        .from("patients")
        .select("*")
        .eq("id", patient_id)
        .eq("psychologist_id", user.id)
        .maybeSingle();
      if (p) {
        patientCtx = `CONTEXTO DEL PACIENTE:
Nombre: ${p.first_name} ${p.last_name}
Edad: ${calcAge(p.birth_date)}
Sexo: ${p.sex ?? "no especificado"}
Estado civil: ${p.marital_status ?? "no especificado"}
Ocupación: ${p.occupation ?? "no especificada"}
Diagnóstico: ${p.diagnosis ?? "no registrado"}
Tiempo en terapia: ${timeInTherapy(p.start_date)}
Notas clínicas: ${p.notes ?? "ninguna"}

`;
      }
    }

    let chunksCtx = "FRAGMENTOS DE DOCUMENTOS RELEVANTES:\n";
    if (!chunks || chunks.length === 0) {
      chunksCtx += "(no se encontraron fragmentos relevantes)\n";
    } else {
      chunks.forEach((c: any, i: number) => {
        const d = docMap.get(c.document_id) as any;
        chunksCtx += `\n[${i + 1}] Documento: ${d?.title ?? "Desconocido"} (${d?.author ?? "s/a"}, ${d?.year ?? "s/f"}) — Tipo: ${DOC_TYPE_LABELS[d?.document_type] ?? "Otro"} — Página ~${c.page_number ?? "?"}\nChunk ID: ${c.id}\nContenido: ${c.content}\n`;
      });
    }

    const userMessage = `${patientCtx}${chunksCtx}\nPREGUNTA DEL PSICÓLOGO:\n${question}`;

    // Call Claude
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResp.ok) {
      const txt = await claudeResp.text();
      console.error("Claude error:", claudeResp.status, txt);
      return new Response(
        JSON.stringify({ error: `Error del modelo (${claudeResp.status}): ${txt}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const claudeData = await claudeResp.json();
    const text = claudeData.content?.[0]?.text ?? "";

    // Parse JSON
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      parsed = {
        answer: "No pude formatear correctamente la respuesta del modelo. Intenta nuevamente.",
        citations: [],
      };
    }

    // Save consultation
    const { data: consultation } = await userClient
      .from("consultations")
      .insert({
        psychologist_id: user.id,
        patient_id: patient_id || null,
        question,
        answer: parsed.answer,
        citations: parsed.citations ?? [],
        document_type_filter: document_type || null,
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        answer: parsed.answer,
        citations: parsed.citations ?? [],
        consultation_id: consultation?.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("claude-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
