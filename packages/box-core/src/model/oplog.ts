// SPDX-License-Identifier: LicenseRef-Proprietary
// oplog.ts - ADR-0007 v2: persisted undo as snapshot deltas.
//
// The in-memory undo stack keeps full {nodes,edges} array snapshots
// (persistent/immutable, O(1) push). Persistence stores one JSON file per
// board under `.box/oplog-<stem>-<fnv64>.json`: a full `base` snapshot plus
// per-step forward deltas keyed by entity id. Payloads are opaque - the
// diff only looks at `id`, so unknown node/edge keys ride through untouched.
//
// The file is app-managed state, never authoritative: missing or corrupt
// means "undo starts empty", never "board is wrong".

import { isPathRel } from "./paths.js";
import type { CanvasEdge, CanvasNode } from "./types.js";

export interface BoardSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Forward delta: for each id that differs between prev and next, the
 *  version in `next` - or null when the entity was removed in next. */
export interface OplogDelta {
  nodes: Record<string, CanvasNode | null>;
  edges: Record<string, CanvasEdge | null>;
}

export interface OplogFile {
  v: 1;
  board: string;
  base: BoardSnapshot;
  entries: OplogDelta[];
}

const MAX_ENTRIES = 100;

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of list) m.set(it.id, it);
  return m;
}

/** Entities that changed from prev to next, expressed as next's versions. */
export function diffSnapshots(
  prev: BoardSnapshot,
  next: BoardSnapshot,
): OplogDelta {
  const nodes: Record<string, CanvasNode | null> = {};
  const edges: Record<string, CanvasEdge | null> = {};
  const pn = byId(prev.nodes);
  const pe = byId(prev.edges);
  for (const n of next.nodes) {
    if (pn.get(n.id) !== n) nodes[n.id] = n;
  }
  for (const e of next.edges) {
    if (pe.get(e.id) !== e) edges[e.id] = e;
  }
  for (const id of pn.keys()) {
    if (!next.nodes.some((n) => n.id === id)) nodes[id] = null;
  }
  for (const id of pe.keys()) {
    if (!next.edges.some((e) => e.id === id)) edges[id] = null;
  }
  return { nodes, edges };
}

/** Apply a forward delta to a snapshot, producing the next snapshot. */
export function applyDelta(state: BoardSnapshot, d: OplogDelta): BoardSnapshot {
  const apply = <T extends { id: string }>(
    list: T[],
    delta: Record<string, T | null>,
  ): T[] => {
    const seen = new Set<string>();
    const out = list
      .map((it) => {
        if (!(it.id in delta)) return it;
        seen.add(it.id);
        const v = delta[it.id];
        return v === null || v === undefined ? null : v;
      })
      .filter((x): x is T => x !== null);
    for (const [id, v] of Object.entries(delta)) {
      if (!seen.has(id) && v !== null) out.push(v);
    }
    return out;
  };
  return {
    nodes: apply(state.nodes, d.nodes),
    edges: apply(state.edges, d.edges),
  };
}

/** Serialize a live snapshot stack (oldest -> newest) to the file form. */
export function encodeOplog(
  stack: BoardSnapshot[],
  board: string,
): OplogFile | null {
  const base = stack[0];
  if (base === undefined) return null;
  const entries: OplogDelta[] = [];
  for (let i = 1; i < stack.length; i++) {
    entries.push(diffSnapshots(stack[i - 1]!, stack[i]!));
  }
  return trimOplog({ v: 1, board, base, entries });
}

/** Replay an oplog file to the full snapshot stack it encodes. Returns
 *  null when the payload is not a v1 log for this board (wrong path,
 *  foreign shape) - callers treat null as "start empty". */
export function decodeOplog(
  raw: unknown,
  board: string,
): BoardSnapshot[] | null {
  if (raw === null || typeof raw !== "object") return null;
  const f = raw as Partial<OplogFile>;
  if (f.v !== 1 || f.board !== board || !Array.isArray(f.entries)) return null;
  const base = f.base;
  if (
    base === null ||
    typeof base !== "object" ||
    !Array.isArray(base.nodes) ||
    !Array.isArray(base.edges)
  )
    return null;
  const stack: BoardSnapshot[] = [{ nodes: base.nodes, edges: base.edges }];
  let cur = stack[0]!;
  for (const e of f.entries) {
    if (e === null || typeof e !== "object") return null;
    const d = e as Partial<OplogDelta>;
    if (
      d.nodes === null ||
      typeof d.nodes !== "object" ||
      d.edges === null ||
      typeof d.edges !== "object"
    )
      return null;
    cur = applyDelta(cur, { nodes: d.nodes!, edges: d.edges! });
    stack.push(cur);
  }
  return stack;
}

/** Cap the log: when entries exceed `max`, fold the oldest deltas into
 *  base so the file stays bounded. */
export function trimOplog(f: OplogFile, max = MAX_ENTRIES): OplogFile {
  if (f.entries.length <= max) return f;
  let base = f.base;
  const fold = f.entries.length - max;
  for (let i = 0; i < fold; i++) base = applyDelta(base, f.entries[i]!);
  return { ...f, base, entries: f.entries.slice(fold) };
}

/** Deterministic per-board file name under `.box/`:
 *  `.box/oplog-<stem>-<fnv64(rel)>.json`. The hash suffix keeps two boards
 *  that share a basename ("canvas.box.canvas" in different folders) from
 *  colliding on one log. */
export function oplogPath(boardRel: string): string {
  const stem =
    boardRel
      .split("/")
      .pop()!
      .replace(/\.canvas$/, "")
      .replace(/\.box$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-") || "board";
  return `.box/oplog-${stem}-${fnv64(boardRel)}.json`;
}

/** FNV-1a 64-bit, hex - same function as the Rust cache keys. */
export function fnv64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Convenience for the app: validate path + encode for writeFile. */
export function serializeOplog(
  stack: BoardSnapshot[],
  boardRel: string,
): { path: string; json: string } | null {
  if (!isPathRel(boardRel)) return null;
  const f = encodeOplog(stack, boardRel);
  if (f === null) return null;
  return { path: oplogPath(boardRel), json: JSON.stringify(f) };
}

/** Convenience for the app: read+decode; null on any mismatch. */
export function parseOplogText(
  text: string,
  boardRel: string,
): BoardSnapshot[] | null {
  try {
    return decodeOplog(JSON.parse(text), boardRel);
  } catch {
    return null;
  }
}
