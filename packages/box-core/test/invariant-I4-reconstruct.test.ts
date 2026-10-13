// SPDX-License-Identifier: LicenseRef-Proprietary
// I-4: delete the index (or start cold from disk files alone) -> full graph,
// boards, placements, ink sidecars, and link notes reconstruct identically
// from raw files with zero repair steps and byte-identical round-trip.

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { parseInkSvg, serializeInkSvg } from "../src/model/ink.js";
import { parseLinkNote, serializeLinkNote } from "../src/model/linkNote.js";
import type { Board, InkSidecar, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";
import { MemoryVault } from "../src/vault/vault.js";

const EDGE_ID = "7f3a9c2b1d4e5f6a";
const BOARD_PATH = ".box/main.box.canvas";
const NOTE_PATH = `link-${EDGE_ID}.md`;
const INK_PATH = "concept.png.ink.svg";

function seedWorkspace(): MemoryVault {
  const vault = new MemoryVault();
  vault.seed("concept.png", "PNG_BYTES_A");
  vault.seed("notes/lore.md", "# Lore\nDetails.");

  const sidecar: InkSidecar = {
    strokes: [
      { d: "M0 0L25 40", stroke: "#ff5500", "stroke-width": 4 },
      { d: "M10 10L50 50", stroke: "#00aa88", "stroke-width": 2 },
    ],
  };
  vault.seed(INK_PATH, serializeInkSvg(sidecar));

  const board: Board = {
    "box-format": "box.canvas/1",
    nodes: [
      {
        id: "n-aaa111",
        type: "file",
        x: 120,
        y: -40,
        width: 320,
        height: 240,
        file: "concept.png",
        "box-ink": INK_PATH,
        "box-placement": {
          "2d": { x: 120, y: -40, w: 320, h: 240, z: 3 },
          "3d": { x: 1.5, y: 2.0, z: -0.5 },
        },
      },
      {
        id: "n-bbb222",
        type: "file",
        x: 600,
        y: 80,
        width: 280,
        height: 200,
        file: "notes/lore.md",
      },
      {
        id: "n-ccc333",
        type: "text",
        x: 0,
        y: 300,
        width: 200,
        height: 100,
        text: "Free-floating annotation",
      },
    ],
    edges: [
      {
        id: EDGE_ID,
        fromNode: "n-aaa111",
        toNode: "n-bbb222",
        toEnd: "arrow",
        label: "inspired-by",
        "box-link": NOTE_PATH,
      },
    ],
  };
  vault.seed(BOARD_PATH, serializeBoard(board));

  const note: LinkNote = {
    path: NOTE_PATH,
    frontmatter: {
      "box-edge": EDGE_ID,
      "box-format": "box.link/1",
      from: "n-aaa111",
      to: "n-bbb222",
      board: "main.box.canvas",
      "from-file": "concept.png",
      "to-file": "notes/lore.md",
      type: "inspired-by",
      created: "2026-10-12T14:31:00.000Z",
    },
    body: "Concept art drives the faction lore.",
  };
  vault.seed(NOTE_PATH, serializeLinkNote(note));
  return vault;
}

function scanFromRawFiles(vault: MemoryVault): WorkspaceScan {
  const boards = new Map([
    [BOARD_PATH, parseBoard(vault.files.get(BOARD_PATH)!, BOARD_PATH)],
  ]);
  const notes = new Map([
    [NOTE_PATH, parseLinkNote(vault.files.get(NOTE_PATH)!, NOTE_PATH)],
  ]);
  const ink = new Map([
    [INK_PATH, parseInkSvg(vault.files.get(INK_PATH)!, INK_PATH)],
  ]);
  return {
    boards,
    notes,
    ink,
    files: new Set(vault.files.keys()),
    tombstones: new Set(),
  };
}

describe("invariant-I4-reconstruct", () => {
  it("reconstructs full state from raw files alone with 0 repair steps", () => {
    const vault = seedWorkspace();

    // Simulate deleting any derived index/memory (no knownNotes, fresh scan)
    const scan1 = scanFromRawFiles(vault);
    const report1 = reconcile(scan1);

    expect(report1.problems).toEqual([]);
    expect(report1.brokenNodes).toEqual([]);
    expect(report1.brokenEdges).toEqual([]);
    expect(report1.plan.steps).toEqual([]);

    // Re-serialize every parsed artifact and verify byte-identical round-trip
    const parsedBoard = scan1.boards.get(BOARD_PATH)!.value!;
    const parsedNote = scan1.notes.get(NOTE_PATH)!.value!;
    const parsedInk = scan1.ink!.get(INK_PATH)!.value!;

    expect(serializeBoard(parsedBoard)).toBe(vault.files.get(BOARD_PATH));
    expect(serializeLinkNote(parsedNote)).toBe(vault.files.get(NOTE_PATH));
    expect(serializeInkSvg(parsedInk)).toBe(vault.files.get(INK_PATH));

    // Verify 2D and 3D placement and z-index survived reconstruction
    const fileNode = parsedBoard.nodes.find((n) => n.id === "n-aaa111")!;
    expect(fileNode.x).toBe(120);
    expect(fileNode.y).toBe(-40);
    expect(fileNode["box-placement"]?.["2d"].z).toBe(3);
    expect(fileNode["box-placement"]?.["3d"]).toEqual({
      x: 1.5,
      y: 2.0,
      z: -0.5,
    });
  });

  it("converges in a single pass when regenerating a missing stub note (R-A)", () => {
    const vault = seedWorkspace();
    vault.files.delete(NOTE_PATH);

    const scan1 = {
      boards: new Map([
        [BOARD_PATH, parseBoard(vault.files.get(BOARD_PATH)!, BOARD_PATH)],
      ]),
      notes: new Map(),
      files: new Set(vault.files.keys()),
      tombstones: new Set<string>(),
    };

    const r1 = reconcile(scan1);
    expect(r1.plan.steps).toHaveLength(1);
    const step = r1.plan.steps[0]!;
    expect(step.op).toBe("write-atomic");
    if (step.op === "write-atomic") {
      vault.seed(step.path, step.content);
    }

    // Pass 2 on reconstructed files should emit 0 steps
    const scan2 = scanFromRawFiles(vault);
    const r2 = reconcile(scan2);
    expect(r2.plan.steps).toEqual([]);
    expect(r2.problems).toEqual([]);
  });
});
