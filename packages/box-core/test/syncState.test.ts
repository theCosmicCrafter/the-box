// SPDX-License-Identifier: LicenseRef-Proprietary
// Tests for ADR-0011 syncState (.box/known.json).

import { describe, expect, it } from "vitest";
import {
  createSyncState,
  parseSyncState,
  serializeSyncState,
  SYNC_STATE_FILE,
  type SyncState,
} from "../src/model/syncState.js";

describe("syncState: .box/known.json", () => {
  it("constant path matches contract", () => {
    expect(SYNC_STATE_FILE).toBe(".box/known.json");
  });

  it("round-trips state with sorted keys and determinism", () => {
    const state: SyncState = {
      v: 1,
      updated: "2026-10-23T12:00:00.000Z",
      knownNotes: ["edge-2", "edge-1", "edge-3"],
      files: {
        "b.png": { size: 200, mtime: 1700000000 },
        "a.png": { size: 100, mtime: 1600000000, sha256: "hash123" },
      },
    };

    const serialized = serializeSyncState(state);
    // Keys must be deterministically sorted
    expect(serialized).toContain('"a.png"');
    const firstA = serialized.indexOf('"a.png"');
    const firstB = serialized.indexOf('"b.png"');
    expect(firstA).toBeLessThan(firstB);

    const parsed = parseSyncState(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed?.v).toBe(1);
    expect(parsed?.knownNotes).toEqual(["edge-1", "edge-2", "edge-3"]);
    expect(parsed?.files["a.png"]).toEqual({
      size: 100,
      mtime: 1600000000,
      sha256: "hash123",
    });
    expect(parsed?.files["b.png"]).toEqual({
      size: 200,
      mtime: 1700000000,
    });
  });

  it("createSyncState accepts Sets and Maps", () => {
    const notes = new Set(["edge-b", "edge-a"]);
    const files = new Map([
      ["img/hero.png", { size: 4096, mtime: 12345678 }],
      ["notes/doc.md", { size: 512 }],
    ]);

    const state = createSyncState(notes, files, "2026-10-23T10:00:00.000Z");
    expect(state.v).toBe(1);
    expect(state.updated).toBe("2026-10-23T10:00:00.000Z");
    expect(state.knownNotes).toEqual(["edge-b", "edge-a"]);
    expect(state.files["img/hero.png"]?.size).toBe(4096);
  });

  it("parseSyncState handles malformed or non-v1 documents gracefully", () => {
    expect(parseSyncState("")).toBeNull();
    expect(parseSyncState("{ broken json")).toBeNull();
    expect(parseSyncState("[]")).toBeNull();
    expect(parseSyncState("123")).toBeNull();
    expect(parseSyncState('{"v": 2}')).toBeNull();
    expect(parseSyncState('{"v": "1"}')).toBeNull();

    // Partial v1 document recovers valid entries
    const partial = parseSyncState(
      JSON.stringify({
        v: 1,
        knownNotes: ["edge-1", 123, null, ""],
        files: {
          "good.png": { size: 50 },
          "bad.png": { size: "not-a-number" },
          "invalid": "string",
        },
      }),
    );
    expect(partial).not.toBeNull();
    expect(partial?.knownNotes).toEqual(["edge-1"]);
    expect(partial?.files).toEqual({
      "good.png": { size: 50 },
    });
  });
});
