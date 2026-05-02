import { AssistantDiagramData, DecisionTreeNode } from "@/lib/assistantDiagram";

const TEAL = "#0d9488";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the same diagram data as plain HTML (no React) for inclusion in
 * the PDF export pipeline (which uses html2canvas on a detached DOM node).
 * Uses inline styles so it works without the app's tailwind context.
 */
export function diagramToHtml(d: AssistantDiagramData): string {
  const header = `
    <p style="color:${TEAL}; font-weight:700; font-size:13px; margin:0 0 8px">📊 ${esc(d.title)}</p>
  `;
  let body = "";
  switch (d.type) {
    case "stepped_care": {
      const sorted = [...d.steps].sort((a, b) => a.level - b.level);
      const rows = sorted.map((s, i) => {
        const widthPct = 55 + (i / Math.max(1, sorted.length - 1)) * 45;
        const items = s.interventions.map((it) => `<li>${esc(it)}</li>`).join("");
        return `
          <div style="display:flex; gap:8px; margin-bottom:6px">
            <div style="background:${TEAL}; color:white; font-weight:700; font-size:11px; min-width:28px; display:flex; align-items:center; justify-content:center; border-radius:6px">${s.level}</div>
            <div style="width:${widthPct}%; border:1px solid rgba(13,148,136,0.3); background:rgba(13,148,136,0.05); border-radius:6px; padding:8px 10px">
              <div style="font-size:12px; font-weight:600">${esc(s.label)}</div>
              ${items ? `<ul style="margin:4px 0 0 18px; font-size:10px; color:#666">${items}</ul>` : ""}
            </div>
          </div>`;
      }).join("");
      body = rows;
      break;
    }
    case "decision_tree": {
      body = renderTreeHtml(d.root, 0);
      break;
    }
    case "protocol_sequence": {
      const cells = d.phases.map((p, i) => {
        const items = p.items.map((it) => `<li>${esc(it)}</li>`).join("");
        const arrow = i < d.phases.length - 1
          ? `<div style="display:flex; align-items:center; color:${TEAL}; font-size:18px; font-weight:700; padding:0 4px">→</div>`
          : "";
        return `
          <div style="display:flex">
            <div style="border:1px solid rgba(13,148,136,0.3); background:rgba(13,148,136,0.05); border-radius:6px; padding:6px 10px; min-width:120px; max-width:170px">
              <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; color:${TEAL}">${esc(p.name)}</div>
              <div style="font-size:11px; font-weight:600; margin-top:2px">${esc(p.label)}</div>
              ${items ? `<ul style="margin:4px 0 0 16px; font-size:10px; color:#666">${items}</ul>` : ""}
            </div>
            ${arrow}
          </div>`;
      }).join("");
      body = `<div style="display:flex; flex-wrap:wrap; gap:6px">${cells}</div>`;
      break;
    }
    case "comparison": {
      const headerRow = d.columns.map((c, i) => `
        <th style="text-align:left; padding:6px; border:1px solid #e5e7eb; font-weight:600; background:${i === 0 ? "rgba(13,148,136,0.12)" : "rgba(100,116,139,0.10)"}">${esc(c.name)}</th>
      `).join("");
      const rows = d.rows.map((r, ri) => {
        const cells = d.columns.map((c) => `<td style="padding:6px; border:1px solid #e5e7eb; vertical-align:top">${esc(c.values[ri] ?? "—")}</td>`).join("");
        return `<tr><td style="padding:6px; border:1px solid #e5e7eb; background:rgba(100,116,139,0.08); font-weight:500; vertical-align:top">${esc(r)}</td>${cells}</tr>`;
      }).join("");
      body = `
        <table style="width:100%; border-collapse:collapse; font-size:11px">
          <thead><tr><th style="padding:6px; border:1px solid #e5e7eb; background:rgba(100,116,139,0.08)"></th>${headerRow}</tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      break;
    }
    case "criteria": {
      body = d.groups.map((g) => {
        const items = g.items.map((it) => `<li>${esc(it)}</li>`).join("");
        return `
          <div style="border:1px solid #e5e7eb; background:rgba(100,116,139,0.06); border-radius:6px; padding:8px; margin-bottom:6px">
            <div style="font-size:11px; font-weight:700; color:${TEAL}; margin-bottom:4px">${esc(g.name)}</div>
            <ul style="margin:0 0 0 18px; font-size:11px">${items}</ul>
          </div>`;
      }).join("");
      break;
    }
  }

  return `
    <div style="margin-top:16px; padding-top:12px; border-top:1px solid #e5e7eb; max-width:600px">
      ${header}
      ${body}
    </div>
  `;
}

function renderTreeHtml(node: DecisionTreeNode, depth: number): string {
  if (node.outcome) {
    return `<div style="display:inline-block; background:rgba(13,148,136,0.10); border:1px solid rgba(13,148,136,0.4); color:#115e59; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:500">✓ ${esc(node.outcome)}</div>`;
  }
  const yes = node.yes ? renderTreeHtml(node.yes, depth + 1) : "—";
  const no = node.no ? renderTreeHtml(node.no, depth + 1) : "—";
  return `
    <div style="margin-bottom:6px">
      <div style="border:1px solid #e5e7eb; background:rgba(100,116,139,0.08); padding:5px 9px; border-radius:6px; font-size:11px; font-weight:600">${esc(node.question ?? "")}</div>
      <div style="margin-left:12px; padding-left:10px; border-left:2px solid rgba(13,148,136,0.3); margin-top:5px">
        <div style="margin-bottom:5px"><span style="font-size:10px; font-weight:700; color:${TEAL}; margin-right:4px">Sí →</span>${yes}</div>
        <div><span style="font-size:10px; font-weight:700; color:#666; margin-right:4px">No →</span>${no}</div>
      </div>
    </div>
  `;
}
