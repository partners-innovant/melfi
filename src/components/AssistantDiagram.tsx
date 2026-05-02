import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  AssistantDiagramData,
  DecisionTreeNode,
} from "@/lib/assistantDiagram";

/**
 * Renders one of 5 fixed diagram shapes from a sanitized JSON payload.
 * No HTML/JSX from the LLM is ever evaluated — every string is rendered as
 * plain text by React.
 */
export default function AssistantDiagram({ data }: { data: AssistantDiagramData }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 m-0">
          📊 {data.title}
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {open ? <><ChevronUp className="h-3 w-3" /> Ocultar diagrama</> : <><ChevronDown className="h-3 w-3" /> Mostrar diagrama</>}
        </button>
      </div>
      {open && (
        <div className="max-w-[600px] rounded-lg border border-border bg-background/60 p-3">
          {renderBody(data)}
        </div>
      )}
    </div>
  );
}

function renderBody(d: AssistantDiagramData) {
  switch (d.type) {
    case "stepped_care": return <SteppedCareView data={d} />;
    case "decision_tree": return <DecisionTreeView data={d} />;
    case "protocol_sequence": return <ProtocolSequenceView data={d} />;
    case "comparison": return <ComparisonView data={d} />;
    case "criteria": return <CriteriaView data={d} />;
  }
}

const TEAL = "#0d9488";

/* ---------------- Stepped care (vertical pyramid) ---------------- */
function SteppedCareView({ data }: { data: Extract<AssistantDiagramData, { type: "stepped_care" }> }) {
  const sorted = [...data.steps].sort((a, b) => a.level - b.level);
  return (
    <div className="space-y-2">
      {sorted.map((s, i) => {
        const widthPct = 55 + (i / Math.max(1, sorted.length - 1)) * 45;
        return (
          <div key={i} className="flex items-stretch gap-2">
            <div
              className="flex items-center justify-center w-8 shrink-0 rounded-md text-white text-xs font-bold"
              style={{ background: TEAL }}
            >
              {s.level}
            </div>
            <div
              className="rounded-md border border-teal-500/30 bg-teal-500/5 px-3 py-2"
              style={{ width: `${widthPct}%` }}
            >
              <p className="text-xs font-semibold text-foreground m-0">{s.label}</p>
              {s.interventions.length > 0 && (
                <ul className="mt-1 ml-4 text-[11px] text-muted-foreground list-disc space-y-0.5">
                  {s.interventions.map((it, j) => <li key={j}>{it}</li>)}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Decision tree ---------------- */
function DecisionTreeView({ data }: { data: Extract<AssistantDiagramData, { type: "decision_tree" }> }) {
  return <div className="text-xs">{renderNode(data.root, 0)}</div>;
}

function renderNode(node: DecisionTreeNode, depth: number): JSX.Element {
  if (node.outcome) {
    return (
      <div className="inline-block rounded-md bg-teal-500/10 border border-teal-500/40 text-teal-800 dark:text-teal-200 px-2 py-1 text-[11px] font-medium">
        ✓ {node.outcome}
      </div>
    );
  }
  return (
    <div className="space-y-1.5" style={{ marginLeft: depth === 0 ? 0 : 0 }}>
      <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
        <p className="text-[11px] font-semibold m-0">{node.question}</p>
      </div>
      <div className="ml-3 pl-3 border-l-2 border-teal-500/30 space-y-1.5">
        <div>
          <span className="text-[10px] font-bold text-teal-700 dark:text-teal-300 mr-1">Sí →</span>
          {node.yes ? renderNode(node.yes, depth + 1) : <em className="text-muted-foreground">—</em>}
        </div>
        <div>
          <span className="text-[10px] font-bold text-muted-foreground mr-1">No →</span>
          {node.no ? renderNode(node.no, depth + 1) : <em className="text-muted-foreground">—</em>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Protocol sequence (horizontal flow) ---------------- */
function ProtocolSequenceView({ data }: { data: Extract<AssistantDiagramData, { type: "protocol_sequence" }> }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {data.phases.map((p, i) => (
        <div key={i} className="flex items-stretch gap-1.5">
          <div className="rounded-md border border-teal-500/30 bg-teal-500/5 px-2.5 py-2 min-w-[110px] max-w-[160px]">
            <p className="text-[10px] uppercase tracking-wide font-bold text-teal-700 dark:text-teal-300 m-0">
              {p.name}
            </p>
            <p className="text-[11px] font-semibold text-foreground mt-0.5 m-0">{p.label}</p>
            {p.items.length > 0 && (
              <ul className="mt-1 ml-3 text-[10px] text-muted-foreground list-disc space-y-0.5">
                {p.items.map((it, j) => <li key={j}>{it}</li>)}
              </ul>
            )}
          </div>
          {i < data.phases.length - 1 && (
            <div className="flex items-center text-teal-600 text-lg font-bold select-none">→</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Comparison table ---------------- */
function ComparisonView({ data }: { data: Extract<AssistantDiagramData, { type: "comparison" }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left p-1.5 border border-border bg-muted/50"></th>
            {data.columns.map((c, i) => (
              <th
                key={i}
                className="text-left p-1.5 border border-border font-semibold"
                style={{ background: i === 0 ? "rgba(13,148,136,0.12)" : "rgba(100,116,139,0.10)" }}
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri}>
              <td className="p-1.5 border border-border bg-muted/30 font-medium align-top">{r}</td>
              {data.columns.map((c, ci) => (
                <td key={ci} className="p-1.5 border border-border align-top">{c.values[ri] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Criteria groups ---------------- */
function CriteriaView({ data }: { data: Extract<AssistantDiagramData, { type: "criteria" }> }) {
  return (
    <div className="space-y-2">
      {data.groups.map((g, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/30 p-2">
          <p className="text-[11px] font-bold text-teal-700 dark:text-teal-300 m-0 mb-1">{g.name}</p>
          <ul className="ml-4 text-[11px] text-foreground list-disc space-y-0.5">
            {g.items.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
