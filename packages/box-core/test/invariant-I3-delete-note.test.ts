// SPDX-License-Identifier: LicenseRef-Proprietary
// I-3: delete a link-*.md (any path) -> edge removed on next reconcile.
// The distinguisher is knownNotes: a note that was seen before and is now
// absent means "deleted" (remove edge); never-seen means "stub regen" (R-A).

import { describe, expect, it } from "vitest";
import { parseBoard } from "../src/model/board.js";
import {
  createSyncState,
  parseSyncState,
  serializeSyncState,
} from "../src/model/syncState.js";
import type { LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const EDGE_ID = "7f3a9c2b1d4e5f6a";
const BP = ".box/main.box.canvas";
const NOTE = `link-${EDGE_ID}.md`;

function boardJson(withEdge = true): string {
  return JSON.stringify({
    "box-format": "box.canvas/1",
    nodes: [
      {
        id: "n-aaa111",
        type: "file",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        file: "a.png",
      },
      {
        id: "n-bbb222",
        type: "file",
        x: 200,
        y: 0,
        width: 100,
        height: 100,
        file: "b.png",
      },
    ],
    edges: withEdge
      ? [
          {
            id: EDGE_ID,
            fromNode: "n-aaa111",
            toNode: "n-bbb222",
            "box-link": NOTE,
          },
        ]
      : [],
  });
}

function note(edgeId = EDGE_ID): LinkNote {
  return {
    path: `link-${edgeId}.md`,
    frontmatter: {
      "box-edge": edgeId,
      "box-format": "box.link/1",
      from: "n-aaa111",
      to: "n-bbb222",
      created: "2026-10-12T00:00:00Z",
    },
    body: "the reason",
  };
}

function scan(over: Partial<WorkspaceScan>): WorkspaceScan {
  return {
    boards: new Map(),
    notes: new Map(),
    files: new Set(["a.png", "b.png"]),
    tombstones: new Set(),
    ...over,
  };
}

describe("invariant-I3-delete-note", () => {
  it("previously-known note now absent -> edge removed from board", () => {
    const s = scan({
      boards: new Map([[BP, parseBoard(boardJson(true), BP)]]),
      knownNotes: new Set([EDGE_ID]), // index remembered it; file is gone now
    });
    const r = reconcile(s);
    const boardWrite = r.plan.steps.find(
      (s2) => s2.op === "write-atomic" && s2.path === BP,
    );
    expect(boardWrite).toBeDefined();
    const written = JSON.parse((boardWrite as { content: string }).content);
    expect(written.edges).toHaveLength(0);
    // and no stub is regenerated
    expect(
      r.plan.steps.some((s2) => s2.op === "write-atomic" && s2.path === NOTE),
    ).toBe(false);
  });

  it("never-seen note absent -> R-A regenerates the stub instead", () => {
    const s = scan({
      boards: new Map([[BP, parseBoard(boardJson(true), BP)]]),
      knownNotes: new Set<string>(), // index has no memory of it
    });
    const r = reconcile(s);
    expect(
      r.plan.steps.some((s2) => s2.op === "write-atomic" && s2.path === NOTE),
    ).toBe(true);
    // edge stays on the board
    const boardWrite = r.plan.steps.find(
      (s2) => s2.op === "write-atomic" && s2.path === BP,
    );
    expect(boardWrite).toBeUndefined();
  });

  it("tombstoned orphan note -> R-D completes the delete", () => {
    const s = scan({
      boards: new Map([[BP, parseBoard(boardJson(false), BP)]]),
      notes: new Map([[NOTE, { value: note(), problems: [] }]]),
      files: new Set(["a.png", "b.png", NOTE]),
      tombstones: new Set([EDGE_ID]),
    });
    const r = reconcile(s);
    expect(
      r.plan.steps.some((s2) => s2.op === "trash" && s2.path === NOTE),
    ).toBe(true);
    expect(r.problems.some((p) => p.kind === "tombstone-complete")).toBe(true);
  });

  it("orphan note (no edge anywhere) -> R-C adopts onto a board", () => {
    const s = scan({
      boards: new Map([[BP, parseBoard(boardJson(false), BP)]]),
      notes: new Map([[NOTE, { value: note(), problems: [] }]]),
      files: new Set(["a.png", "b.png", NOTE]),
    });
    const r = reconcile(s);
    const adopted = r.plan.steps.find(
      (s2) => s2.op === "write-atomic" && s2.path === BP,
    );
    expect(adopted).toBeDefined();
    const written = JSON.parse((adopted as { content: string }).content);
    expect(written.edges.some((e: { id: string }) => e.id === EDGE_ID)).toBe(
      true,
    );
  });

  it("closed-app note deletion: sync state remembers note, edge is removed on restart", () => {
    const state = createSyncState(
      [EDGE_ID],
      new Map([["a.png", { size: 100 }]]),
    );
    const json = serializeSyncState(state);

    const loaded = parseSyncState(json);
    expect(loaded).not.toBeNull();

    const s = scan({
      boards: new Map([[BP, parseBoard(boardJson(true), BP)]]),
      knownNotes: new Set(loaded!.knownNotes),
    });
    const r = reconcile(s);

    const boardWrite = r.plan.steps.find(
      (s2) => s2.op === "write-atomic" && s2.path === BP,
    );
    expect(boardWrite).toBeDefined();
    const written = JSON.parse((boardWrite as { content: string }).content);
    expect(written.edges).toHaveLength(0);
    expect(
      r.plan.steps.some((s2) => s2.op === "write-atomic" && s2.path === NOTE),
    ).toBe(false);
  });
});
