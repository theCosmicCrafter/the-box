// SPDX-License-Identifier: LicenseRef-Proprietary
// Tests for ADR-0011 tombstones (.box/tombstones.json).

import { describe, expect, it } from "vitest";
import {
  parseTombstones,
  serializeTombstones,
  TOMBSTONE_TTL_MS,
} from "../src/model/tombstones.js";

describe("tombstones: .box/tombstones.json", () => {
  const NOW = 1729684800000; // fixed reference timestamp

  it("handles empty or malformed files gracefully", () => {
    expect(parseTombstones("")).toEqual({
      active: new Set(),
      records: [],
      prunedCount: 0,
    });
    expect(parseTombstones("not json")).toEqual({
      active: new Set(),
      records: [],
      prunedCount: 0,
    });
    expect(parseTombstones("{}")).toEqual({
      active: new Set(),
      records: [],
      prunedCount: 0,
    });
  });

  it("parses legacy string array format and assigns current timestamp", () => {
    const raw = JSON.stringify(["edge-aaa", "edge-bbb"]);
    const res = parseTombstones(raw, NOW);
    expect(res.active).toEqual(new Set(["edge-aaa", "edge-bbb"]));
    expect(res.records).toEqual([
      { edgeId: "edge-aaa", at: NOW },
      { edgeId: "edge-bbb", at: NOW },
    ]);
    expect(res.prunedCount).toBe(0);
  });

  it("parses timestamped records and prunes expired entries (>30 days)", () => {
    const freshAt = NOW - 1000 * 60; // 1 min ago
    const expiredAt = NOW - TOMBSTONE_TTL_MS - 1000; // 30 days and 1s ago

    const raw = JSON.stringify([
      { edgeId: "fresh-1", at: freshAt },
      { edgeId: "expired-1", at: expiredAt },
      { edgeId: "fresh-2", at: NOW },
    ]);

    const res = parseTombstones(raw, NOW);
    expect(res.active).toEqual(new Set(["fresh-1", "fresh-2"]));
    expect(res.records).toEqual([
      { edgeId: "fresh-1", at: freshAt },
      { edgeId: "fresh-2", at: NOW },
    ]);
    expect(res.prunedCount).toBe(1);
  });

  it("serializes deterministically and deduplicates keeping newest timestamp", () => {
    const records = [
      { edgeId: "edge-z", at: 100 },
      { edgeId: "edge-a", at: 200 },
      { edgeId: "edge-z", at: 300 }, // newer edge-z
    ];

    const json = serializeTombstones(records);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { edgeId: "edge-a", at: 200 },
      { edgeId: "edge-z", at: 300 },
    ]);
  });
});
