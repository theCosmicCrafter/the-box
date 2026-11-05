// SPDX-License-Identifier: LicenseRef-Proprietary
import type { FileKind } from "./kind.js";

// The Box model types - binding contract: docs/DATA-MODEL.md §2, §3, §4.
// Model objects ARE the JSON objects: unknown fields ride along on the
// index signature so parse→serialize preserves them (forward tolerance).

export type CanvasNodeType = "text" | "file" | "link" | "group";
export type Side = "top" | "right" | "bottom" | "left";
export type EndStyle = "none" | "arrow";

export interface Placement {
  "2d": { x: number; y: number; w: number; h: number; z?: number };
  "3d": null | {
    x: number;
    y: number;
    z: number;
    rx?: number;
    ry?: number;
    rz?: number;
  };
}

interface BaseNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  "box-placement"?: Placement;
  [extra: string]: unknown;
}

export interface TextNode extends BaseNode {
  type: "text";
  text: string;
}

export interface FileNode extends BaseNode {
  type: "file";
  file: string;
  subpath?: string;
  "box-ink"?: string;
  "box-media"?: { kind: FileKind | "doc" };
}

export interface LinkNode extends BaseNode {
  type: "link";
  url: string;
}

export interface GroupNode extends BaseNode {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: string;
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string; // 16 lowercase hex; equals link-note filename slug
  fromNode: string;
  toNode: string;
  fromSide?: Side | undefined;
  toSide?: Side | undefined;
  fromEnd?: EndStyle | undefined;
  toEnd?: EndStyle | undefined;
  lineStyle?: ("solid" | "dashed" | "dotted") | undefined;
  color?: string | undefined;
  label?: string | undefined;
  "box-link": string; // `link-<edgeid>.md` - required; unbacked edges are malformed
  [extra: string]: unknown;
}

export interface Board {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  "box-format": "box.canvas/1";
  version?: number;
  [extra: string]: unknown;
}

// ---- link notes (DATA-MODEL §3) ----

export const LINK_NOTE_FORMAT = "box.link/1" as const;
export const BOARD_FORMAT = "box.canvas/1" as const;

export interface LinkNoteFrontmatter {
  "box-edge": string; // 16 hex, must equal filename slug
  "box-format": string; // 'box.link/1'
  from: string; // node id
  to: string; // node id
  board?: string; // board filename; informational (notes are workspace-global)
  "from-file"?: string; // denormalized display field
  "to-file"?: string;
  type?: string;
  created: string; // RFC 3339 UTC
  [extra: string]: unknown;
}

export interface LinkNote {
  path: string; // workspace-relative
  frontmatter: LinkNoteFrontmatter;
  body: string;
}

export interface InkStroke {
  d: string; // SVG path data
  stroke?: string;
  "stroke-width"?: number;
  [extra: string]: unknown;
}

export interface InkSidecar {
  strokes: InkStroke[];
}

// ---- tombstones (DATA-MODEL §4.3, ADR-0011) ----

export interface TombstoneRecord {
  edgeId: string;
  at: number; // Unix epoch ms
}

// ---- write plans (all file mutations flow through these) ----

export type WriteStep =
  | { op: "write-atomic"; path: string; content: string }
  | { op: "trash"; path: string }
  | { op: "append-tombstone"; edgeId: string };

export interface WritePlan {
  steps: WriteStep[];
  reason: string;
}

// ---- reconcile ----

export interface ProblemItem {
  kind:
    | "malformed-board"
    | "malformed-note"
    | "edge-without-note"
    | "broken-node"
    | "broken-edge"
    | "duplicate-id"
    | "tombstone-complete";
  path: string;
  detail: string;
}

export interface ReconcileReport {
  plan: WritePlan;
  problems: ProblemItem[];
  brokenNodes: string[]; // node ids whose file is gone (render broken, keep)
  brokenEdges: string[]; // edge ids with dangling endpoint (render broken, keep)
}

// ---- watch deltas ----

export type DeltaKind = "created" | "deleted" | "modified" | "renamed";

export interface Delta {
  kind: DeltaKind;
  path: string;
  to?: string; // rename target
}
