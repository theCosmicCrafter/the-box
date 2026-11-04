// SPDX-License-Identifier: LicenseRef-Proprietary
// Watch classification - DATA-MODEL §5.2. Pure: timing and fs injected.
// Rule: classify by EXISTENCE after a quiet window, never by event type
// (probe R-2 verified deletes and renames both arrive as 'rename').

import type { Delta } from "../model/types.js";
import type { FileEntry } from "../vault/vault.js";

export interface PrevState {
  files: Map<string, { size: number; mtime?: number }>;
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
  // Index creates by size: every rename candidate must match size anyway,
  // so the per-delete scan only walks one bucket - O(n) not O(n^2) on
  // bulk moves. Bucket order preserves `created`'s sorted order, keeping
  // first-match selection identical to the old linear find.
  const bySize = new Map<number, FileEntry[]>();
  for (const c of created) {
    const b = bySize.get(c.size);
    if (b === undefined) bySize.set(c.size, [c]);
    else b.push(c);
  }
  const consumed = new Set<string>();
  for (const oldPath of deleted) {
    const prev = before.files.get(oldPath);
    // Rename pairing: same size+mtime beats size-only. A real rename
    // preserves content AND mtime; a same-size create almost never shares
    // it. (Content hashing was considered and dropped: O(workspace) per
    // scan for a collision class that ms-precision mtimes already make
    // vanishingly rare. If mispairing shows up in dogfood, add lazy
    // hashing behind IVault rather than widening this signature.)
    const match =
      prev === undefined
        ? undefined
        : (bySize.get(prev.size) ?? []).find(
            (c) =>
              !consumed.has(c.path) &&
              !(
                prev.mtime !== undefined &&
                c.mtime !== undefined &&
                prev.mtime !== c.mtime
              ),
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
