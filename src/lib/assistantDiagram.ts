/**
 * Safe, structured diagram payload returned by the `assistant-diagram` edge
 * function. We intentionally do NOT execute LLM-generated JSX/HTML — instead
 * we render these typed shapes with React components.
 */

export type DiagramType =
  | "stepped_care"
  | "decision_tree"
  | "protocol_sequence"
  | "comparison"
  | "criteria";

export interface SteppedCareDiagram {
  type: "stepped_care";
  title: string;
  steps: Array<{ level: number; label: string; interventions: string[] }>;
}

export interface DecisionTreeNode {
  question?: string;
  outcome?: string;
  yes?: DecisionTreeNode;
  no?: DecisionTreeNode;
}

export interface DecisionTreeDiagram {
  type: "decision_tree";
  title: string;
  root: DecisionTreeNode;
}

export interface ProtocolSequenceDiagram {
  type: "protocol_sequence";
  title: string;
  phases: Array<{ name: string; label: string; items: string[] }>;
}

export interface ComparisonDiagram {
  type: "comparison";
  title: string;
  rows: string[];
  columns: Array<{ name: string; values: string[] }>;
}

export interface CriteriaDiagram {
  type: "criteria";
  title: string;
  groups: Array<{ name: string; items: string[] }>;
}

export type AssistantDiagramData =
  | SteppedCareDiagram
  | DecisionTreeDiagram
  | ProtocolSequenceDiagram
  | ComparisonDiagram
  | CriteriaDiagram;

export const DIAGRAM_TYPE_LABELS: Record<DiagramType, string> = {
  stepped_care: "Modelo escalonado",
  decision_tree: "Árbol de decisión",
  protocol_sequence: "Secuencia de protocolo",
  comparison: "Comparación",
  criteria: "Criterios",
};
