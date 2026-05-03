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
      "author": "autor si está disponible (primer autor + et al. si corresponde)",
      "year": "año si está disponible",
      "journal": "revista científica si está disponible o null",
      "source_institution": "institución exacta o null",
      "page_number": "número de página aproximado",
      "document_type": "tipo de documento (clave, ej. guia_clinica)",
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

const DIAGNOSIS_DEBATE_ADDITION = `

INTERACCIÓN ESPECIAL: DEBATE DIAGNÓSTICO
El psicólogo quiere debatir el diagnóstico del paciente. Actúa como un psicólogo clínico experto con amplio conocimiento en diagnóstico diferencial y criterios DSM-5-TR y CIE-11.

Tu respuesta debe seguir EXACTAMENTE esta estructura en markdown:

**Diagnóstico actual:** [diagnóstico tomado del perfil del paciente; si no hay, indícalo]

**Por qué este diagnóstico tiene sustento:**
Argumenta a favor basándote en los síntomas, historia clínica y presentación descritos en el perfil del paciente. Cita criterios DSM-5-TR o CIE-11 específicos que se cumplen. Sé concreto — usa la información real del paciente, no generalidades.

**Puntos débiles o dudas diagnósticas:**
Señala qué criterios no están confirmados, qué información faltaría para solidificar el diagnóstico, o qué aspectos del caso no encajan perfectamente con el diagnóstico actual. Sé honesto y crítico.

**Diagnósticos alternativos a considerar:**
Propón 2-3 diagnósticos diferenciales relevantes para este caso específico. Para cada uno:
- Nombre y código DSM-5-TR
- Por qué podría aplicar en este paciente (síntomas compartidos)
- Qué lo distingue del diagnóstico actual
- Qué preguntarías o evaluarías para descartarlo o confirmarlo

**Posibles comorbilidades:**
Si el perfil sugiere condiciones adicionales que coexisten con el diagnóstico principal, señálalas.

**Mi recomendación clínica:**
Una conclusión breve sobre qué diagnóstico o combinación diagnóstica parece más sólida y qué pasos evaluativos seguirías para confirmarlo.

Termina siempre con una pregunta específica al psicólogo sobre algún aspecto clínico que ayudaría a afinar el diagnóstico.

Basa tu análisis en los documentos clínicos disponibles cuando sean relevantes. Si hay guías diagnósticas o estudios sobre estos diagnósticos en la biblioteca, cítalos.`;

const DOC_TYPE_LABELS: Record<string, string> = {
  articulo_cientifico: "Artículo científico",
  guia_clinica: "Guía clínica",
  manual_diagnostico: "Manual diagnóstico",
  libro_academico: "Libro académico",
  codigo_etico: "Código ético",
  informe_consenso: "Informe de consenso",
  otro: "Otro",
};

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

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

    const reqId = crypto.randomUUID().slice(0, 8);
    const body = await req.json();
    const {
      question,
      patient_id,
      patient_kind = "adult",
      document_type,
      clinical_area,
      source_institution,
      year_from,
      clinical_areas,
      source_institutions,
      query_embedding,
      conversation_id,
      stream: wantStream = true,
      mode,
    } = body;
    console.log(`[claude-chat:${reqId}] question len=${question?.length ?? 0}, stream=${wantStream}`);

    if (!question || !query_embedding) {
      return new Response(JSON.stringify({ error: "question y query_embedding requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Match chunks
    const { data: chunks, error: matchErr } = await supabase.rpc("match_chunks", {
      query_embedding,
      match_count: 5,
      p_psychologist_id: user.id,
      p_document_type: document_type || null,
      p_clinical_area: clinical_area || null,
      p_source_institution: source_institution || null,
      p_year_from: typeof year_from === "number" ? year_from : null,
      p_clinical_areas: Array.isArray(clinical_areas) && clinical_areas.length > 0 ? clinical_areas : null,
      p_source_institutions: Array.isArray(source_institutions) && source_institutions.length > 0 ? source_institutions : null,
    });
    if (matchErr) {
      console.error(`[claude-chat:${reqId}] match_chunks error`, matchErr);
      return new Response(
        JSON.stringify({ error: `match_chunks: ${matchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Doc metadata
    const docIds = [...new Set((chunks ?? []).map((c: any) => c.document_id))];
    const { data: docs } = await supabase
      .from("documents")
      .select("id, title, author, year, document_type, source_institution, source_institution_type, journal, clinical_areas")
      .in("id", docIds);
    const docMap = new Map((docs ?? []).map((d: any) => [d.id, d]));

    // 3. Patient context
    let patientCtx = "";
    let childSystemAddition = "";
    if (patient_id && patient_kind === "child") {
      const { data: c } = await supabase
        .from("child_patients").select("*")
        .eq("id", patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (c) {
        const [{ data: goals }, { data: behaviors }, { data: wisc }, { data: comms }, { data: meds }, { data: childDocs }, { data: childNotes }, { data: childTests }, { data: team }] = await Promise.all([
          supabase.from("intervention_goals").select("title, status, estimated_date").eq("child_patient_id", patient_id).order("created_at", { ascending: false }).limit(10),
          supabase.from("behavioral_tracking").select("behavior_name, score, tracking_date").eq("child_patient_id", patient_id).order("tracking_date", { ascending: false }).limit(20),
          supabase.from("wisc_evaluations").select("version, evaluation_date, cit, icv, irp, imt, ivp, irf").eq("child_patient_id", patient_id).order("evaluation_date", { ascending: false }).limit(1),
          supabase.from("communication_log").select("contact_date, contact_type, contact_with, summary").eq("child_patient_id", patient_id).order("contact_date", { ascending: false }).limit(5),
          supabase.from("child_patient_medications").select("name, dose, frequency, prescribed_by").eq("child_patient_id", patient_id).eq("is_active", true).order("created_at", { ascending: false }),
          supabase.from("child_documents").select("title, document_type, professional_name, professional_role, document_date, notes").eq("child_patient_id", patient_id).order("document_date", { ascending: false, nullsFirst: false }).limit(10),
          supabase.from("child_session_notes").select("session_number, session_date, emotional_state, raw_notes, refined_notes, techniques_used, next_session_plan").eq("child_patient_id", patient_id).order("session_date", { ascending: false }).limit(5),
          supabase.from("child_tests").select("test_name, test_type, evaluation_date, results_structured, results_raw, generated_report").eq("child_patient_id", patient_id).order("evaluation_date", { ascending: false }).limit(10),
          supabase.from("treatment_team").select("professional_name, professional_role, specialty, institution, email, phone, is_primary_contact").eq("child_patient_id", patient_id).order("is_primary_contact", { ascending: false }),
        ]);
        const latestWisc = wisc?.[0];
        const medsLine = (meds && meds.length > 0)
          ? (meds as any[]).map((m) => `Medicación actual: ${m.name}${m.dose ? ` ${m.dose}` : ""}${m.frequency ? ` ${m.frequency}` : ""}${m.prescribed_by ? `, prescrito por ${m.prescribed_by}` : ""}`).join("\n")
          : "Medicación actual: ninguna registrada";
        patientCtx = `CONTEXTO DEL PACIENTE INFANTO-JUVENIL:
Nombre: ${c.first_name} ${c.last_name}
Edad: ${calcAge(c.birth_date)}
Sexo: ${c.sex ?? "no especificado"}
Colegio: ${c.school ?? "no especificado"} — Curso: ${c.grade ?? "—"} — Modalidad: ${c.modality ?? "—"}
Diagnóstico médico: ${c.medical_diagnosis ?? "no registrado"}
${medsLine}
Motivo derivación: ${c.referral_reason ?? "—"}
Notas: ${c.notes ?? "ninguna"}

Objetivos de intervención (${goals?.length ?? 0}):
${(goals ?? []).map((g: any) => `- ${g.title} [${g.status}]${g.estimated_date ? ` (estimado ${g.estimated_date})` : ""}`).join("\n") || "- (sin objetivos)"}

Puntuaciones conductuales recientes:
${(behaviors ?? []).map((b: any) => `- ${b.tracking_date} · ${b.behavior_name}: ${b.score}/5`).join("\n") || "- (sin registros)"}

${latestWisc ? `Última evaluación WISC (${latestWisc.version}, ${latestWisc.evaluation_date}): CIT=${latestWisc.cit ?? "—"}, ICV=${latestWisc.icv ?? "—"}, IRP=${latestWisc.irp ?? "—"}, IMT=${latestWisc.imt ?? "—"}, IVP=${latestWisc.ivp ?? "—"}${latestWisc.irf ? `, IRF=${latestWisc.irf}` : ""}` : "Sin evaluaciones WISC registradas."}

Otros tests/evaluaciones registrados:
${(childTests ?? []).map((t: any) => `- ${t.evaluation_date} · ${t.test_name}${t.results_structured ? ` · datos: ${JSON.stringify(t.results_structured).slice(0, 200)}` : ""}${t.results_raw ? ` · obs: ${String(t.results_raw).slice(0, 200)}` : ""}`).join("\n") || "- (sin tests adicionales)"}

Documentos e informes externos del paciente:
${(childDocs ?? []).map((d: any) => `- ${d.document_date ?? "s/f"} · ${d.title}${d.document_type ? ` (${d.document_type})` : ""}${d.professional_name ? ` — ${d.professional_name}${d.professional_role ? `, ${d.professional_role}` : ""}` : ""}${d.notes ? ` · ${String(d.notes).slice(0, 150)}` : ""}`).join("\n") || "- (sin documentos)"}

Últimos apuntes de sesión (máx. 5):
${(childNotes ?? []).map((n: any) => `- Sesión #${n.session_number ?? "—"} (${n.session_date})${n.emotional_state ? ` · estado: ${n.emotional_state}` : ""}\n  Notas: ${String(n.refined_notes ?? n.raw_notes ?? "").slice(0, 350)}${n.techniques_used ? `\n  Técnicas: ${n.techniques_used}` : ""}${n.next_session_plan ? `\n  Plan: ${String(n.next_session_plan).slice(0, 150)}` : ""}`).join("\n") || "- (sin apuntes)"}

Comunicaciones recientes:
${(comms ?? []).map((m: any) => `- ${m.contact_date} ${m.contact_type ?? ""} con ${m.contact_with ?? "—"}: ${m.summary.slice(0, 120)}`).join("\n") || "- (ninguna)"}

Equipo tratante:
${(team ?? []).map((t: any) => `- ${t.professional_name} (${t.professional_role}${t.specialty ? `, ${t.specialty}` : ""})${t.institution ? ` — ${t.institution}` : ""}${t.email ? ` · ${t.email}` : ""}${t.phone ? ` · ${t.phone}` : ""}${t.is_primary_contact ? " · ⭐ contacto principal" : ""}`).join("\n") || "- (sin profesionales registrados)"}

`;
        childSystemAddition = "\n\nEste es un paciente infanto-juvenil. Adapta tus recomendaciones a intervenciones apropiadas para la edad, técnicas lúdicas y conductuales, y considera el contexto escolar y familiar.";
      }
    } else if (patient_id) {
      const { data: p } = await supabase
        .from("patients").select("*")
        .eq("id", patient_id).eq("psychologist_id", user.id).maybeSingle();
      if (p) {
        const [{ data: meds }, { data: adultDocs }, { data: team }] = await Promise.all([
          supabase.from("patient_medications")
            .select("name, dose, frequency, prescribed_by")
            .eq("patient_id", patient_id).eq("is_active", true)
            .order("created_at", { ascending: false }),
          supabase.from("adult_documents")
            .select("title, document_type, professional_name, professional_role, document_date, notes")
            .eq("patient_id", patient_id)
            .order("document_date", { ascending: false, nullsFirst: false })
            .limit(10),
          supabase.from("treatment_team")
            .select("professional_name, professional_role, specialty, institution, email, phone, is_primary_contact")
            .eq("patient_id", patient_id)
            .order("is_primary_contact", { ascending: false }),
        ]);
        const medsLine = (meds && meds.length > 0)
          ? (meds as any[]).map((m) => `Medicación actual: ${m.name}${m.dose ? ` ${m.dose}` : ""}${m.frequency ? ` ${m.frequency}` : ""}${m.prescribed_by ? `, prescrito por ${m.prescribed_by}` : ""}`).join("\n")
          : "Medicación actual: ninguna registrada";
        patientCtx = `CONTEXTO DEL PACIENTE:
Nombre: ${p.first_name} ${p.last_name}
Edad: ${calcAge(p.birth_date)}
Sexo: ${p.sex ?? "no especificado"}
Estado civil: ${p.marital_status ?? "no especificado"}
Ocupación: ${p.occupation ?? "no especificada"}
Diagnóstico: ${p.diagnosis ?? "no registrado"}
Tiempo en terapia: ${timeInTherapy(p.start_date)}
${medsLine}
Motivo de consulta: ${p.presenting_problem ?? "—"}
Historia clínica: ${p.clinical_history ?? "—"}
Contexto familiar: ${p.family_context ?? "—"}
Contexto laboral: ${p.work_context ?? "—"}
Tratamientos previos: ${p.previous_treatments ?? "—"}
Antecedentes relevantes: ${p.relevant_history ?? "—"}
Recursos personales: ${p.personal_resources ?? "—"}
Objetivos terapéuticos: ${p.therapeutic_goals ?? "—"}
Notas clínicas: ${p.notes ?? "ninguna"}

Documentos e informes externos del paciente:
${(adultDocs ?? []).map((d: any) => `- ${d.document_date ?? "s/f"} · ${d.title}${d.document_type ? ` (${d.document_type})` : ""}${d.professional_name ? ` — ${d.professional_name}${d.professional_role ? `, ${d.professional_role}` : ""}` : ""}${d.notes ? ` · ${String(d.notes).slice(0, 150)}` : ""}`).join("\n") || "- (sin documentos)"}

Equipo tratante:
${(team ?? []).map((t: any) => `- ${t.professional_name} (${t.professional_role}${t.specialty ? `, ${t.specialty}` : ""})${t.institution ? ` — ${t.institution}` : ""}${t.email ? ` · ${t.email}` : ""}${t.phone ? ` · ${t.phone}` : ""}${t.is_primary_contact ? " · ⭐ contacto principal" : ""}`).join("\n") || "- (sin profesionales registrados)"}

`;
      }
    }

    let chunksCtx = "FRAGMENTOS DE DOCUMENTOS RELEVANTES:\n";
    if (!chunks || chunks.length === 0) {
      chunksCtx += "(no se encontraron fragmentos relevantes)\n";
    } else {
      chunks.forEach((c: any, i: number) => {
        const d = docMap.get(c.document_id) as any;
        const inst = d?.source_institution ? ` — Fuente: ${d.source_institution}` : "";
        chunksCtx += `\n[${i + 1}] Documento: ${d?.title ?? "Desconocido"} (${d?.author ?? "s/a"}, ${d?.year ?? "s/f"}) — Tipo: ${DOC_TYPE_LABELS[d?.document_type] ?? "Otro"}${inst} — Página ~${c.page_number ?? "?"}\nChunk ID: ${c.id}\nContenido: ${c.content}\n`;
      });
    }

    const userMessage = `${patientCtx}${chunksCtx}\nPREGUNTA DEL PSICÓLOGO:\n${question}`;

    // 4. Call Claude with streaming
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
        max_tokens: 2048,
        system: SYSTEM_PROMPT + childSystemAddition + (mode === "diagnosis_debate" ? DIAGNOSIS_DEBATE_ADDITION : ""),
        stream: true,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeResp.ok || !claudeResp.body) {
      const txt = await claudeResp.text();
      console.error(`[claude-chat:${reqId}] Claude error ${claudeResp.status}:`, txt);
      return new Response(
        JSON.stringify({ error: `Claude API ${claudeResp.status}: ${txt}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. Stream pass-through, accumulate full text, then parse + persist
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let fullText = "";
        let answerSoFar = "";
        let inAnswer = false;
        let answerEnded = false;
        let buffer = "";

        try {
          const reader = claudeResp.body!.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload);
                if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                  const delta: string = evt.delta.text ?? "";
                  fullText += delta;

                  // Extract just the "answer" string content for streaming UI.
                  // Naive incremental: find "answer":" then accumulate until unescaped closing "
                  if (!inAnswer && !answerEnded) {
                    const idx = fullText.indexOf('"answer"');
                    if (idx >= 0) {
                      const colon = fullText.indexOf(':', idx);
                      const quote = fullText.indexOf('"', colon + 1);
                      if (quote >= 0) {
                        inAnswer = true;
                        // emit any chars after quote
                        const after = fullText.slice(quote + 1);
                        const { text, ended } = consumeJsonString(after);
                        answerSoFar = text;
                        answerEnded = ended;
                        controller.enqueue(encoder.encode(sseEvent("delta", { text: answerSoFar })));
                      }
                    }
                  } else if (inAnswer && !answerEnded) {
                    // recompute answerSoFar from the section after "answer":"
                    const idx = fullText.indexOf('"answer"');
                    const colon = fullText.indexOf(':', idx);
                    const quote = fullText.indexOf('"', colon + 1);
                    const after = fullText.slice(quote + 1);
                    const { text, ended } = consumeJsonString(after);
                    if (text !== answerSoFar) {
                      answerSoFar = text;
                      controller.enqueue(encoder.encode(sseEvent("delta", { text: answerSoFar })));
                    }
                    answerEnded = ended;
                  }
                }
              } catch (_e) { /* ignore parse errors of partial events */ }
            }
          }

          // Parse full JSON
          let parsed: any;
          try {
            const match = fullText.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(match ? match[0] : fullText);
          } catch {
            parsed = { answer: answerSoFar || fullText, citations: [] };
          }

          // Persist
          const convId = conversation_id || crypto.randomUUID();
          const isFirst = !conversation_id;
          const title = isFirst ? question.slice(0, 80) : null;
          const { data: consultation } = await userClient
            .from("consultations")
            .insert({
              psychologist_id: user.id,
              patient_id: patient_id || null,
              question,
              answer: parsed.answer,
              citations: parsed.citations ?? [],
              document_type_filter: document_type || null,
              conversation_id: convId,
              conversation_title: title,
            })
            .select()
            .single();

          controller.enqueue(encoder.encode(sseEvent("done", {
            answer: parsed.answer,
            citations: parsed.citations ?? [],
            consultation_id: consultation?.id,
            conversation_id: convId,
            conversation_title: title,
          })));
        } catch (err) {
          console.error(`[claude-chat:${reqId}] stream err`, err);
          controller.enqueue(encoder.encode(sseEvent("error", { error: String(err) })));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    console.error("claude-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Consume a JSON string body (after opening quote). Returns decoded text and whether closing quote reached.
function consumeJsonString(s: string): { text: string; ended: boolean } {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) break; // wait for more
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === '"') out += '"';
      else if (n === '\\') out += '\\';
      else if (n === '/') out += '/';
      else if (n === 'u') {
        if (i + 5 >= s.length) break;
        out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
        i += 6; continue;
      } else out += n;
      i += 2; continue;
    }
    if (c === '"') return { text: out, ended: true };
    out += c;
    i++;
  }
  return { text: out, ended: false };
}
