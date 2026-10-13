// SPDX-License-Identifier: LicenseRef-Proprietary
// I-5: rename a placed file in OS file manager -> node.file in every board
// and from-file/to-file in link-*.md update; node IDs, edge IDs, and placement
// coordinates do not change. Ordering: boards first, then note denorms (§4.4).

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { parseLinkNote } from "../src/model/linkNote.js";
import type { Board, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";
import { classifyFileSet } from "../src/watch/classify.js";

const EDGE_ID = "7f3a9c2b1d4e5f6a";
const BP = ".box/main.box.canvas";
const NOTE_PATH = `link-${EDGE_ID}.md`;

function makeBoard(): Board {
  return parseBoard(
    serializeBoard({
      "box-format": "box.canvas/1",
      nodes: [
        {
          id: "n-aaa111",
          type: "file",
          x: 50,
          y: 75,
          width: 240,
          height: 180,
          file: "concept.png",
          "box-ink": "concept.png.ink.svg",
        },
        {
          id: "n-bbb222",
          type: "file",
          x: 400,
          y: 75,
          width: 240,
          height: 180,
          file: "lore.md",
        },
      ],
      edges: [
        {
          id: EDGE_ID,
          fromNode: "n-aaa111",
          toNode: "n-bbb222",
          toEnd: "arrow",
          "box-link": NOTE_PATH,
        },
      ],
    }),
    BP,
  ).value!;
}

function makeNote(): LinkNote {
  return {
    path: NOTE_PATH,
    frontmatter: {
      "box-edge": EDGE_ID,
      "box-format": "box.link/1",
      from: "n-aaa111",
      to: "n-bbb222",
      board: "main.box.canvas",
      "from-file": "concept.png",
      "to-file": "lore.md",
      created: "2026-10-12T14:31:00.000Z",
    },
    body: "Visual reference for lore.",
  };
}

describe("invariant-I5-rename", () => {
  it("propagates file and ink sidecar renames to board first, then note denorms", () => {
    const deltas = classifyFileSet(
      {
        files: new Map([
          ["concept.png", { size: 1024, mtime: 500, sha256: "abc" }],
          ["concept.png.ink.svg", { size: 256, mtime: 500, sha256: "def" }],
          ["lore.md", { size: 128, mtime: 500, sha256: "ghi" }],
        ]),
      },
      [
        { path: "armor.png", size: 1024, mtime: 500, sha256: "abc" },
        { path: "armor.png.ink.svg", size: 256, mtime: 500, sha256: "def" },
        { path: "lore.md", size: 128, mtime: 500, sha256: "ghi" },
      ],
    );

    const renames = new Map<string, string>();
    for (const d of deltas) {
      if (d.kind === "renamed" && d.to !== undefined) {
        renames.set(d.path, d.to);
      }
    }
    expect(renames.get("concept.png")).toBe("armor.png");
    expect(renames.get("concept.png.ink.svg")).toBe("armor.png.ink.svg");

    const board = makeBoard();
    const note = makeNote();
    const scan: WorkspaceScan = {
      boards: new Map([[BP, { value: board, problems: [] }]]),
      notes: new Map([[NOTE_PATH, { value: note, problems: [] }]]),
      files: new Set([
        "armor.png",
        "armor.png.ink.svg",
        "lore.md",
        NOTE_PATH,
        BP,
      ]),
      tombstones: new Set(),
      renames,
    };

    const report = reconcile(scan);

    // Renamed file is present at new path, so node must NOT be marked broken
    expect(report.brokenNodes).toEqual([]);
    expect(report.problems).toEqual([]);

    // Ordering contract (DATA-MODEL §4.4): board write first, note denorm second
    expect(report.plan.steps).toHaveLength(2);
    const step0 = report.plan.steps[0]!;
    const step1 = report.plan.steps[1]!;
    expect(step0.op).toBe("write-atomic");
    expect(step1.op).toBe("write-atomic");
    if (step0.op !== "write-atomic" || step1.op !== "write-atomic") {
      throw new Error("expected write-atomic steps");
    }
    expect(step0.path).toBe(BP);
    expect(step1.path).toBe(NOTE_PATH);

    // Verify board node updated file & box-ink while preserving id and placement
    const updatedBoard = parseBoard(step0.content, BP).value!;
    const nodeA = updatedBoard.nodes.find((n) => n.id === "n-aaa111")!;
    expect(nodeA.type).toBe("file");
    if (nodeA.type === "file") {
      expect(nodeA.file).toBe("armor.png");
      expect(nodeA["box-ink"]).toBe("armor.png.ink.svg");
    }
    expect(nodeA.x).toBe(50);
    expect(nodeA.y).toBe(75);
    expect(nodeA.width).toBe(240);
    expect(nodeA.height).toBe(180);
    expect(updatedBoard.edges[0]?.id).toBe(EDGE_ID);

    // Verify note denorm updated from-file while preserving box-edge and body
    const updatedNote = parseLinkNote(step1.content, NOTE_PATH).value!;
    expect(updatedNote.frontmatter["box-edge"]).toBe(EDGE_ID);
    expect(updatedNote.frontmatter.from).toBe("n-aaa111");
    expect(updatedNote.frontmatter.to).toBe("n-bbb222");
    expect(updatedNote.frontmatter["from-file"]).toBe("armor.png");
    expect(updatedNote.frontmatter["to-file"]).toBe("lore.md");
    expect(updatedNote.body).toBe("Visual reference for lore.");

    // Second pass after applying updates emits 0 steps
    const scan2: WorkspaceScan = {
      boards: new Map([[BP, { value: updatedBoard, problems: [] }]]),
      notes: new Map([[NOTE_PATH, { value: updatedNote, problems: [] }]]),
      files: new Set([
        "armor.png",
        "armor.png.ink.svg",
        "lore.md",
        NOTE_PATH,
        BP,
      ]),
      tombstones: new Set(),
    };
    const report2 = reconcile(scan2);
    expect(report2.plan.steps).toEqual([]);
    expect(report2.problems).toEqual([]);
  });
});
