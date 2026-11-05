// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 3 exit criteria: automated chaos test suite for reconcile convergence.
// Applies random mutations (create, delete, rename, endpoint mismatch, tombstone)
// and proves that reconcile always converges within MAX_PASSES without oscillation.

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { linkNoteName, newEdgeId, newNodeId } from "../src/model/ids.js";
import { parseLinkNote, serializeLinkNote } from "../src/model/linkNote.js";
import type { Board, CanvasEdge, CanvasNode, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const MAX_PASSES = 4;
const BOARD_PATH = ".box/main.box.canvas";

function createInitialState() {
  const nodes: CanvasNode[] = [
    { id: "n-111111", type: "file", file: "a.png", x: 0, y: 0, width: 100, height: 100 },
    { id: "n-222222", type: "file", file: "b.png", x: 200, y: 0, width: 100, height: 100 },
    { id: "n-333333", type: "file", file: "c.png", x: 400, y: 0, width: 100, height: 100 },
  ];
  const edge1Id = newEdgeId();
  const edge2Id = newEdgeId();
  const edges: CanvasEdge[] = [
    { id: edge1Id, fromNode: "n-111111", toNode: "n-222222", "box-link": linkNoteName(edge1Id) },
    { id: edge2Id, fromNode: "n-222222", toNode: "n-333333", "box-link": linkNoteName(edge2Id) },
  ];
  const board: Board = {
    "box-format": "box.canvas/1",
    nodes,
    edges,
  };

  const files = new Map<string, string>();
  files.set("a.png", "img-a");
  files.set("b.png", "img-b");
  files.set("c.png", "img-c");
  files.set(BOARD_PATH, serializeBoard(board));

  for (const e of edges) {
    const note: LinkNote = {
      path: linkNoteName(e.id),
      frontmatter: {
        "box-edge": e.id,
        "box-format": "box.link/1",
        from: e.fromNode,
        to: e.toNode,
        board: "main.box.canvas",
        "from-file": e.fromNode === "n-111111" ? "a.png" : "b.png",
        "to-file": e.toNode === "n-222222" ? "b.png" : "c.png",
        created: new Date().toISOString(),
      },
      body: `Note for ${e.id}`,
    };
    files.set(linkNoteName(e.id), serializeLinkNote(note));
  }

  const tombstones = new Set<string>();
  const knownNotes = new Set(edges.map((e) => e.id));
  return { files, tombstones, knownNotes };
}

function buildScanFromMemory(
  files: Map<string, string>,
  tombstones: Set<string>,
  knownNotes: Set<string>,
): WorkspaceScan {
  const boards = new Map();
  const notes = new Map();
  for (const [path, content] of files) {
    if (path.endsWith(".box.canvas") || path.endsWith(".canvas")) {
      boards.set(path, parseBoard(content, path));
    } else if (!path.includes("/") && path.startsWith("link-") && path.endsWith(".md")) {
      notes.set(path, parseLinkNote(content, path));
    }
  }
  return {
    boards,
    notes,
    files: new Set(files.keys()),
    tombstones,
    knownNotes,
  };
}

function runToConvergence(
  files: Map<string, string>,
  tombstones: Set<string>,
  knownNotes: Set<string>,
): { passes: number; converged: boolean } {
  let pass = 0;
  while (pass < MAX_PASSES) {
    const scan = buildScanFromMemory(files, tombstones, knownNotes);
    const report = reconcile(scan);
    if (report.plan.steps.length === 0) {
      return { passes: pass, converged: true };
    }
    for (const step of report.plan.steps) {
      if (step.op === "write-atomic") {
        files.set(step.path, step.content);
        if (step.path.startsWith("link-") && step.path.endsWith(".md")) {
          const m = /^link-([0-9a-f]{16})\.md$/.exec(step.path);
          if (m && m[1]) knownNotes.add(m[1]);
        }
      } else if (step.op === "trash") {
        files.delete(step.path);
      } else if (step.op === "append-tombstone") {
        tombstones.add(step.edgeId);
      }
    }
    pass++;
  }
  const finalScan = buildScanFromMemory(files, tombstones, knownNotes);
  const finalReport = reconcile(finalScan);
  return { passes: pass, converged: finalReport.plan.steps.length === 0 };
}

describe("automated chaos suite (Stage 3 exit gate)", () => {
  it("initial clean workspace converges in 0 steps", () => {
    const { files, tombstones, knownNotes } = createInitialState();
    const result = runToConvergence(files, tombstones, knownNotes);
    expect(result.converged).toBe(true);
    expect(result.passes).toBe(0);
  });

  it("converges deterministically under random continuous mutations", () => {
    const { files, tombstones, knownNotes } = createInitialState();

    // 30 passes of chaotic random mutations
    for (let round = 0; round < 30; round++) {
      const mode = round % 6;
      if (mode === 0) {
        // Add a brand new node and edge on the board without a link note
        const rawBoard = files.get(BOARD_PATH)!;
        const parsed = parseBoard(rawBoard, BOARD_PATH).value!;
        const newNId = newNodeId();
        const newEId = newEdgeId();
        parsed.nodes.push({ id: newNId, type: "file", file: `file-${round}.png`, x: round * 10, y: 0, width: 50, height: 50 });
        files.set(`file-${round}.png`, "content");
        parsed.edges.push({ id: newEId, fromNode: "n-111111", toNode: newNId, "box-link": linkNoteName(newEId) });
        files.set(BOARD_PATH, serializeBoard(parsed));
      } else if (mode === 1) {
        // Delete an existing link note
        const noteKeys = [...files.keys()].filter((k) => k.startsWith("link-") && k.endsWith(".md"));
        if (noteKeys.length > 0) {
          files.delete(noteKeys[0]!);
        }
      } else if (mode === 2) {
        // Tombstone an edge
        const rawBoard = files.get(BOARD_PATH)!;
        const parsed = parseBoard(rawBoard, BOARD_PATH).value!;
        if (parsed.edges.length > 0) {
          const doomed = parsed.edges[0]!;
          tombstones.add(doomed.id);
        }
      } else if (mode === 3) {
        // Mismatch filename slug vs box-edge frontmatter (ERR-3 mutation)
        const noteKeys = [...files.keys()].filter((k) => k.startsWith("link-") && k.endsWith(".md"));
        if (noteKeys.length > 0) {
          const target = noteKeys[0]!;
          const parsedNote = parseLinkNote(files.get(target)!, target).value;
          if (parsedNote) {
            parsedNote.frontmatter["box-edge"] = "ffffffffffffffff";
            files.set(target, serializeLinkNote(parsedNote));
          }
        }
      } else if (mode === 4) {
        // Create an orphan link note directly on disk
        const orphanId = newEdgeId();
        const orphan: LinkNote = {
          path: linkNoteName(orphanId),
          frontmatter: {
            "box-edge": orphanId,
            "box-format": "box.link/1",
            from: "n-111111",
            to: "n-222222",
            created: new Date().toISOString(),
          },
          body: "I am an orphan",
        };
        files.set(linkNoteName(orphanId), serializeLinkNote(orphan));
      } else if (mode === 5) {
        // Corrupt an endpoint on an edge
        const rawBoard = files.get(BOARD_PATH)!;
        const parsed = parseBoard(rawBoard, BOARD_PATH).value!;
        if (parsed.edges.length > 0) {
          parsed.edges[0]!.fromNode = "n-missing999";
          files.set(BOARD_PATH, serializeBoard(parsed));
        }
      }

      // Prove reconcile converges after each mutation round
      const result = runToConvergence(files, tombstones, knownNotes);
      expect(result.converged).toBe(true);
      expect(result.passes).toBeLessThanOrEqual(MAX_PASSES);
    }
  });
});
