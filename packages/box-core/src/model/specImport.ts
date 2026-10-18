// SPDX-License-Identifier: LicenseRef-Proprietary
// specImport.ts - ADR-0009 foreign `.canvas` ingest.
// A spec-conformant JSON Canvas file (Obsidian Canvas et al.) lacks our
// box-format marker, our id conventions, and `box-link` edge backing.
// importSpecCanvas normalizes it IN PLACE: remapped ids, generated link
// notes, added box-format - while preserving every other key verbatim so
// the same file still opens in spec readers (box-* keys are unknown keys
// to them and ride along on their saves).

import { serializeBoard } from "./board.js";
import {
  isEdgeId,
  isNodeId,
  linkNoteName,
  newEdgeId,
  newNodeId,
} from "./ids.js";
import { serializeLinkNote } from "./linkNote.js";
import type { Board, CanvasNode } from "./types.js";
import { BOARD_FORMAT, LINK_NOTE_FORMAT } from "./types.js";

export interface SpecImport {
  /** Normalized board JSON - write back to the same .canvas path. */
  boardJson: string;
  /** Link notes to create: workspace-relative `link-<edgeid>.md`. */
  notes: { path: string; content: string }[];
  /** Count of node/edge ids that needed remapping. */
  remappedNodes: number;
  remappedEdges: number;
}

export type SpecImportResult = SpecImport | { error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Returns { error } when `raw` is not canvas-shaped at all (not an object,
 * nodes/edges not arrays) - the caller leaves the file untouched and
 * reports a problem item instead. Non-object array members are preserved
 * for parseBoard to flag rather than silently dropped.
 */
export function importSpecCanvas(
  raw: string,
  boardPath: string,
): SpecImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { error: "not JSON" };
  }
  if (!isObj(doc)) return { error: "top level is not an object" };
  const rawNodes = doc["nodes"];
  const rawEdges = doc["edges"];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return { error: "nodes/edges must be arrays" };
  }

  // Id remap: foreign ids become ours; existing valid ids ride along.
  const nodeIdMap = new Map<string, string>();
  let remappedNodes = 0;
  const nodes = rawNodes.map((n) => {
    if (!isObj(n)) return n;
    const id = n["id"];
    if (typeof id === "string" && !isNodeId(id)) {
      const next = newNodeId();
      nodeIdMap.set(id, next);
      remappedNodes += 1;
      return { ...n, id: next };
    }
    return { ...n };
  });

  let remappedEdges = 0;
  const edges = rawEdges.map((e) => {
    if (!isObj(e)) return e;
    const next: Record<string, unknown> = { ...e };
    const id = next["id"];
    if (typeof id !== "string" || !isEdgeId(id)) {
      next["id"] = newEdgeId();
      remappedEdges += 1;
    }
    for (const f of ["fromNode", "toNode"] as const) {
      const v = next[f];
      if (typeof v === "string" && nodeIdMap.has(v)) {
        next[f] = nodeIdMap.get(v);
      }
    }
    next["box-link"] = linkNoteName(next["id"] as string);
    return next;
  });

  // Arrows are notes: every imported edge gets a real link-<id>.md.
  const fileOf = new Map<string, string>();
  for (const n of nodes) {
    if (isObj(n) && n["type"] === "file" && typeof n["file"] === "string") {
      fileOf.set(n["id"] as string, n["file"]);
    }
  }
  const created = new Date().toISOString();
  const boardBase = boardPath.split("/").pop() ?? boardPath;
  const notes: SpecImport["notes"] = [];
  for (const e of edges) {
    if (!isObj(e) || typeof e["id"] !== "string") continue;
    const from = e["fromNode"];
    const to = e["toNode"];
    if (typeof from !== "string" || typeof to !== "string") continue;
    const fm: import("./types.js").LinkNoteFrontmatter = {
      "box-format": LINK_NOTE_FORMAT,
      "box-edge": e["id"],
      from,
      to,
      board: boardBase,
      created,
    };
    const ff = fileOf.get(from);
    const tf = fileOf.get(to);
    if (ff !== undefined) fm["from-file"] = ff;
    if (tf !== undefined) fm["to-file"] = tf;
    if (typeof e["label"] === "string") fm["type"] = e["label"];
    const content = serializeLinkNote({
      path: linkNoteName(e["id"]),
      frontmatter: fm,
      body: "\n",
    });
    notes.push({ path: linkNoteName(e["id"]), content });
  }

  const board = {
    ...doc,
    "box-format": BOARD_FORMAT,
    nodes: nodes as CanvasNode[],
    edges: edges as Board["edges"],
  };
  return {
    boardJson: serializeBoard(board as Board),
    notes,
    remappedNodes,
    remappedEdges,
  };
}
