// SPDX-License-Identifier: LicenseRef-Proprietary
// tombstones.ts - ADR-0011 tombstone ledger (.box/tombstones.json)
// Records deleted edge ids so reconcile can complete crashed deletes (R-D).
// Entries expire after 30 days per DATA-MODEL §4.3.

import type { TombstoneRecord } from "./types.js";

export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function parseTombstones(
  raw: string,
  now = Date.now(),
  ttlMs = TOMBSTONE_TTL_MS,
): { active: Set<string>; records: TombstoneRecord[]; prunedCount: number } {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { active: new Set(), records: [], prunedCount: 0 };
  }
  if (!Array.isArray(doc)) {
    return { active: new Set(), records: [], prunedCount: 0 };
  }

  const records: TombstoneRecord[] = [];
  const active = new Set<string>();
  let prunedCount = 0;

  for (const item of doc) {
    if (typeof item === "string" && item.length > 0) {
      // Legacy format: string[] without timestamp. Migrate to current timestamp.
      active.add(item);
      records.push({ edgeId: item, at: now });
    } else if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>)["edgeId"] === "string"
    ) {
      const obj = item as Record<string, unknown>;
      const edgeId = obj["edgeId"] as string;
      const at = typeof obj["at"] === "number" ? obj["at"] : now;
      if (now - at > ttlMs) {
        prunedCount++;
      } else {
        active.add(edgeId);
        records.push({ edgeId, at });
      }
    }
  }

  return { active, records, prunedCount };
}

export function serializeTombstones(records: TombstoneRecord[]): string {
  // Deduplicate by edgeId keeping newest timestamp
  const map = new Map<string, number>();
  for (const r of records) {
    const existing = map.get(r.edgeId);
    if (existing === undefined || r.at > existing) {
      map.set(r.edgeId, r.at);
    }
  }
  const sorted: TombstoneRecord[] = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([edgeId, at]) => ({ edgeId, at }));

  return JSON.stringify(sorted, null, 2) + "\n";
}
