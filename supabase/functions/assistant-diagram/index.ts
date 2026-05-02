const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// We deliberately do NOT ask the LLM for JSX (arbitrary code = XSS risk).
// Instead we ask for a structured JSON schema that the client renders with
// safe React components.
const SYSTEM_PROMPT = `Eres un experto en visualización clínica. Analiza una respuesta clínica y determina si un diagrama visual añadiría valor real al terapeuta.

Solo recomienda un diagrama si la respuesta contiene UNO de estos elementos:
- Modelo de atención escalonada (stepped care)
- Árbol de decisión clínica
- Secuencia de fases o protocolo (fase 1 → fase 2 → ...)
- Comparación entre tratamientos o enfoques
- Lista de criterios diagnósticos con jerarquía o agrupación clara

Si NO corresponde, responde EXACTAMENTE: {"diagram": null}

Si SÍ corresponde, elige UNO de estos tipos y responde con el JSON estructurado correspondiente. Texto en español, conciso (máx ~6 palabras por etiqueta), máximo 6 elementos por diagrama. NO inventes contenido — extrae solo lo que está en la respuesta.

TIPOS DISPONIBLES:

1) stepped_care — niveles escalonados (de menor a mayor intensidad):
{
  "diagram": {
    "type": "stepped_care",
    "title": "...",
    "steps": [
      { "level": 1, "label": "...", "interventions": ["...", "..."] },
      { "level": 2, "label": "...", "interventions": ["..."] }
    ]
  }
}

2) decision_tree — árbol binario simple, máx 3 niveles:
{
  "diagram": {
    "type": "decision_tree",
    "title": "...",
    "root": {
      "question": "...",
      "yes": { "question": "...", "yes": { "outcome": "..." }, "no": { "outcome": "..." } },
      "no":  { "outcome": "..." }
    }
  }
}
(Cada nodo es {question,yes,no} o terminal {outcome}.)

3) protocol_sequence — fases en secuencia horizontal:
{
  "diagram": {
    "type": "protocol_sequence",
    "title": "...",
    "phases": [
      { "name": "Fase 1", "label": "...", "items": ["...", "..."] },
      { "name": "Fase 2", "label": "...", "items": ["..."] }
    ]
  }
}

4) comparison — tabla comparativa (2-3 columnas, mismas filas):
{
  "diagram": {
    "type": "comparison",
    "title": "...",
    "rows": ["Característica", "Otra característica"],
    "columns": [
      { "name": "Tratamiento A", "values": ["...", "..."] },
      { "name": "Tratamiento B", "values": ["...", "..."] }
    ]
  }
}

5) criteria — lista jerárquica de criterios agrupados:
{
  "diagram": {
    "type": "criteria",
    "title": "...",
    "groups": [
      { "name": "Criterios obligatorios", "items": ["...", "..."] },
      { "name": "Criterios de exclusión", "items": ["..."] }
    ]
  }
}

Responde SOLO con el JSON, sin markdown, sin explicaciones.`;

const ALLOWED_TYPES = new Set([
  "stepped_care",
  "decision_tree",
  "protocol_sequence",
  "comparison",
  "criteria",
]);

const TYPE_LABELS: Record<string, string> = {
  stepped_care: "Modelo escalonado",
  decision_tree: "Árbol de decisión",
  protocol_sequence: "Secuencia de protocolo",
  comparison: "Comparación",
  criteria: "Criterios",
};

function clampString(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function clampList(arr: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => clampString(x, maxLen))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

/** Recursively sanitize a decision tree node, capping depth at 3. */
function sanitizeTreeNode(node: any, depth: number): any | null {
  if (!node || typeof node !== "object") return null;
  if (depth >= 3 || node.outcome != null) {
    const outcome = clampString(node.outcome ?? node.label ?? "", 80);
    return outcome ? { outcome } : null;
  }
  const question = clampString(node.question ?? node.label ?? "", 100);
  if (!question) {
    const outcome = clampString(node.outcome ?? "", 80);
    return outcome ? { outcome } : null;
  }
  return {
    question,
    yes: sanitizeTreeNode(node.yes, depth + 1) ?? { outcome: "Sí" },
    no: sanitizeTreeNode(node.no, depth + 1) ?? { outcome: "No" },
  };
}

/** Strip anything we don't recognize and cap sizes — never trust the LLM. */
function sanitizeDiagram(raw: any): any | null {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type ?? "");
  if (!ALLOWED_TYPES.has(type)) return null;

  const title = clampString(raw.title, 120) || TYPE_LABELS[type];
  const base: Record<string, unknown> = { type, title };

  switch (type) {
    case "stepped_care": {
      const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
      const steps = stepsRaw.slice(0, 6).map((s: any, i: number) => ({
        level: Number.isFinite(s?.level) ? Math.max(1, Math.min(99, Math.floor(s.level))) : i + 1,
        label: clampString(s?.label, 80),
        interventions: clampList(s?.interventions, 5, 100),
      })).filter((s: any) => s.label || s.interventions.length > 0);
      if (steps.length < 2) return null;
      return { ...base, steps };
    }
    case "decision_tree": {
      const root = sanitizeTreeNode(raw.root, 0);
      if (!root || !("question" in root)) return null;
      return { ...base, root };
    }
    case "protocol_sequence": {
      const phasesRaw = Array.isArray(raw.phases) ? raw.phases : [];
      const phases = phasesRaw.slice(0, 6).map((p: any, i: number) => ({
        name: clampString(p?.name, 40) || `Fase ${i + 1}`,
        label: clampString(p?.label, 80),
        items: clampList(p?.items, 4, 80),
      })).filter((p: any) => p.label || p.items.length > 0);
      if (phases.length < 2) return null;
      return { ...base, phases };
    }
    case "comparison": {
      const rows = clampList(raw.rows, 6, 60);
      const colsRaw = Array.isArray(raw.columns) ? raw.columns : [];
      const columns = colsRaw.slice(0, 3).map((c: any) => ({
        name: clampString(c?.name, 40),
        values: clampList(c?.values, rows.length, 100),
      })).filter((c: any) => c.name);
      if (rows.length < 1 || columns.length < 2) return null;
      // Pad/trim values to row count
      for (const c of columns) {
        while (c.values.length < rows.length) c.values.push("—");
        c.values = c.values.slice(0, rows.length);
      }
      return { ...base, rows, columns };
    }
    case "criteria": {
      const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
      const groups = groupsRaw.slice(0, 4).map((g: any) => ({
        name: clampString(g?.name, 60),
        items: clampList(g?.items, 6, 120),
      })).filter((g: any) => g.name && g.items.length > 0);
      if (groups.length < 1) return null;
      return { ...base, groups };
    }
  }
  return null;
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

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? "").trim();
    if (text.length < 50) {
      return new Response(JSON.stringify({ diagram: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Word count gate (server-side too)
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 200) {
      return new Response(JSON.stringify({ diagram: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip citation tags before sending to the analyzer
    const clean = text.replace(/\[cita:[^\]]+\]/g, "").slice(0, 12000);

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Respuesta clínica a analizar:\n\n${clean}` }],
      }),
    });

    if (!claudeResp.ok) {
      const t = await claudeResp.text().catch(() => "");
      console.error("[assistant-diagram] claude error", claudeResp.status, t.slice(0, 300));
      return new Response(JSON.stringify({ diagram: null, error: "claude_error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await claudeResp.json();
    const raw: string = json?.content?.[0]?.text ?? "";

    let parsed: any = null;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }

    if (!parsed || parsed.diagram == null) {
      return new Response(JSON.stringify({ diagram: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safe = sanitizeDiagram(parsed.diagram);
    return new Response(JSON.stringify({ diagram: safe }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[assistant-diagram] error", e);
    return new Response(JSON.stringify({ diagram: null, error: e instanceof Error ? e.message : "Error" }), {
      status: 200, // never block UI on diagram failure
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
