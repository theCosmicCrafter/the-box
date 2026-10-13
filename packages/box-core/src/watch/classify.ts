// SPDX-License-Identifier: LicenseRef-Proprietary
// Watch classification - DATA-MODEL §5.2. Pure: timing and fs injected.
// Rule: classify by EXISTENCE after a quiet window, never by event type
// (probe R-2 verified deletes and renames both arrive as 'rename').

import type { Delta } from "../model/types.js";
import type { FileEntry } from "../vault/vault.js";

export interface PrevState {
  files: Map<string, { size: number; mtime?: number; sha256?: string }>;
}

export function classifyFileSet(
  before: PrevState,
  after: FileEntry[],
): Delta[] {
  const deltas: Delta[] = [];
  const afterMap = new Map(after.map((e) => [e.path, e]));
  // Dedupe by path: a scan that reports the same path twice (case-folding
  // fs, symlink alias, buggy adapter) must not emit duplicate deltas.
  const unique = [...afterMap.values()];

  const deleted: string[] = [];
  const created: FileEntry[] = [];

  for (const [path] of before.files) {
    if (!afterMap.has(path)) deleted.push(path);
  }
  for (const e of unique) {
    const prev = before.files.get(e.path);
    if (prev === undefined) {
      created.push(e);
    } else if (
      (prev.sha256 !== undefined &&
        e.sha256 !== undefined &&
        prev.sha256 !== e.sha256) ||
      prev.size !== e.size ||
      (prev.mtime !== undefined &&
        e.mtime !== undefined &&
        prev.mtime !== e.mtime)
    ) {
      deltas.push({ kind: "modified", path: e.path });
    }
  }

  // Pair deletes with creates of identical hash (or same size when hash
  // unavailable) into renames - R-G / §5.1 same-tick heuristic made
  // deterministic by sorting for stable output.
  deleted.sort();
  created.sort((a, b) => a.path.localeCompare(b.path));
  const consumed = new Set<string>();
  for (const oldPath of deleted) {
    const prev = before.files.get(oldPath);
    // Rename pairing: sha beats (size+mtime) beats size-only. A real rename
    // preserves content AND mtime; a same-size create almost never shares it.
    const match = created.find(
      (c) =>
        !consumed.has(c.path) &&
        (prev?.sha256 !== undefined && c.sha256 !== undefined
          ? prev.sha256 === c.sha256
          : prev?.mtime !== undefined && c.mtime !== undefined
            ? prev.size === c.size && prev.mtime === c.mtime
            : prev?.size === c.size),
    );
    if (match !== undefined && prev !== undefined) {
      deltas.push({ kind: "renamed", path: oldPath, to: match.path });
      consumed.add(match.path);
    } else {
      deltas.push({ kind: "deleted", path: oldPath });
    }
  }
  for (const c of created) {
    if (!consumed.has(c.path)) deltas.push({ kind: "created", path: c.path });
  }
  return deltas;
}

/** Path classification for routing deltas - §5.2 rule 3. */
export type Route = "board" | "tombstone" | "link-note" | "ink" | "object";

export function routePath(path: string): Route {
  if (path === ".box/tombstones.json") return "tombstone";
  if (path.startsWith(".box/") && path.endsWith(".box.canvas")) return "board";
  if (/link-[0-9a-f]{16}\.md$/.test(path)) return "link-note";
  if (path.endsWith(".ink.svg")) return "ink";
  return "object";
}
