// SPDX-License-Identifier: LicenseRef-Proprietary
// I-6: two boards (.box/a.box.canvas, .box/b.box.canvas) sharing a file node
// stay consistent across reconcile and rename propagation; link notes live
// workspace-global (ADR-0003).

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { parseLinkNote, serializeLinkNote } from "../src/model/linkNote.js";
import type { Board, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const BP_A = ".box/a.box.canvas";
const BP_B = ".box/b.box.canvas";
const EDGE_A = "1111111111111111";
const EDGE_B = "2222222222222222";
const NOTE_A = `link-${EDGE_A}.md`;
const NOTE_B = `link-${EDGE_B}.md`;

function boardA(): Board {
  return parseBoard(
    serializeBoard({
      "box-format": "box.canvas/1",
      nodes: [
        {
          id: "n-a11111",
          type: "file",
          x: 0,
          y: 0,
          width: 200,
          height: 150,
          file: "shared/concept.png",
        },
        {
          id: "n-a22222",
          type: "file",
          x: 300,
          y: 0,
          width: 200,
          height: 150,
          file: "notes/alpha.md",
        },
      ],
      edges: [
        {
          id: EDGE_A,
          fromNode: "n-a11111",
          toNode: "n-a22222",
          toEnd: "arrow",
          "box-link": NOTE_A,
        },
      ],
    }),
    BP_A,
  ).value!;
}

function boardB(): Board {
  return parseBoard(
    serializeBoard({
      "box-format": "box.canvas/1",
      nodes: [
        {
          id: "n-b11111",
          type: "file",
          x: 100,
          y: 250,
          width: 300,
          height: 220,
          file: "shared/concept.png",
        },
        {
          id: "n-b22222",
          type: "file",
          x: 500,
          y: 250,
          width: 200,
          height: 150,
          file: "notes/beta.md",
        },
      ],
      edges: [
        {
          id: EDGE_B,
          fromNode: "n-b22222",
          toNode: "n-b11111",
          toEnd: "arrow",
          "box-link": NOTE_B,
        },
      ],
    }),
    BP_B,
  ).value!;
}

function noteFor(
  edgeId: string,
  from: string,
  to: string,
  boardName: string,
  fromFile: string,
  toFile: string,
): LinkNote {
  return {
    path: `link-${edgeId}.md`,
    frontmatter: {
      "box-edge": edgeId,
      "box-format": "box.link/1",
      from,
      to,
      board: boardName,
      "from-file": fromFile,
      "to-file": toFile,
      created: "2026-10-12T14:31:00.000Z",
    },
    body: `Note for ${edgeId}`,
  };
}

describe("invariant-I6-multiboard", () => {
  it("keeps two boards sharing a file consistent across rename propagation", () => {
    const a = boardA();
    const b = boardB();
    const nA = noteFor(
      EDGE_A,
      "n-a11111",
      "n-a22222",
      "a.box.canvas",
      "shared/concept.png",
      "notes/alpha.md",
    );
    const nB = noteFor(
      EDGE_B,
      "n-b22222",
      "n-b11111",
      "b.box.canvas",
      "notes/beta.md",
      "shared/concept.png",
    );

    const scan: WorkspaceScan = {
      boards: new Map([
        [BP_A, { value: a, problems: [] }],
        [BP_B, { value: b, problems: [] }],
      ]),
      notes: new Map([
        [NOTE_A, { value: nA, problems: [] }],
        [NOTE_B, { value: nB, problems: [] }],
      ]),
      files: new Set([
        "shared/final-concept.png",
        "notes/alpha.md",
        "notes/beta.md",
        NOTE_A,
        NOTE_B,
      ]),
      tombstones: new Set(),
      renames: new Map([["shared/concept.png", "shared/final-concept.png"]]),
    };

    const report = reconcile(scan);
    expect(report.problems).toEqual([]);
    expect(report.brokenNodes).toEqual([]);

    // Both boards and both workspace-global link notes are updated, boards first
    expect(report.plan.steps).toHaveLength(4);
    const writtenPaths = report.plan.steps.map((s) =>
      s.op === "write-atomic" ? s.path : "",
    );
    expect(writtenPaths).toEqual([BP_A, BP_B, NOTE_A, NOTE_B]);

    const nextA = parseBoard(
      (report.plan.steps[0] as { content: string }).content,
      BP_A,
    ).value!;
    const nextB = parseBoard(
      (report.plan.steps[1] as { content: string }).content,
      BP_B,
    ).value!;

    // Each board kept its own independent placement while updating the file path
    const nodeOnA = nextA.nodes.find((n) => n.id === "n-a11111")!;
    const nodeOnB = nextB.nodes.find((n) => n.id === "n-b11111")!;
    expect(nodeOnA.type === "file" && nodeOnA.file).toBe(
      "shared/final-concept.png",
    );
    expect(nodeOnB.type === "file" && nodeOnB.file).toBe(
      "shared/final-concept.png",
    );
    expect({ x: nodeOnA.x, y: nodeOnA.y }).toEqual({ x: 0, y: 0 });
    expect({ x: nodeOnB.x, y: nodeOnB.y }).toEqual({ x: 100, y: 250 });

    const nextNoteA = parseLinkNote(
      (report.plan.steps[2] as { content: string }).content,
      NOTE_A,
    ).value!;
    const nextNoteB = parseLinkNote(
      (report.plan.steps[3] as { content: string }).content,
      NOTE_B,
    ).value!;
    expect(nextNoteA.frontmatter["from-file"]).toBe("shared/final-concept.png");
    expect(nextNoteB.frontmatter["to-file"]).toBe("shared/final-concept.png");
  });

  it("adopts an orphan workspace-global note onto its preferred board (R-C)", () => {
    const a = boardA();
    const b = { ...boardB(), edges: [] };
    const nA = noteFor(
      EDGE_A,
      "n-a11111",
      "n-a22222",
      "a.box.canvas",
      "shared/concept.png",
      "notes/alpha.md",
    );
    const orphanB: LinkNote = {
      ...noteFor(
        EDGE_B,
        "n-b22222",
        "n-b11111",
        "b.box.canvas",
        "stale.md",
        "stale.png",
      ),
      frontmatter: {
        ...noteFor(
          EDGE_B,
          "n-b22222",
          "n-b11111",
          "b.box.canvas",
          "stale.md",
          "stale.png",
        ).frontmatter,
        type: "supports",
      },
    };

    const scan: WorkspaceScan = {
      boards: new Map([
        [BP_A, { value: a, problems: [] }],
        [BP_B, { value: b, problems: [] }],
      ]),
      notes: new Map([
        [NOTE_A, { value: nA, problems: [] }],
        [NOTE_B, { value: orphanB, problems: [] }],
      ]),
      files: new Set([
        "shared/concept.png",
        "notes/alpha.md",
        "notes/beta.md",
        NOTE_A,
        NOTE_B,
      ]),
      tombstones: new Set(),
    };

    const report = reconcile(scan);
    // Board B adopts the edge with label "supports", and note B denorms refresh in the same pass
    const boardBWrite = report.plan.steps.find(
      (s) => s.op === "write-atomic" && s.path === BP_B,
    );
    const noteBWrite = report.plan.steps.find(
      (s) => s.op === "write-atomic" && s.path === NOTE_B,
    );
    expect(boardBWrite).toBeDefined();
    expect(noteBWrite).toBeDefined();

    const parsedB = parseBoard(
      (boardBWrite as { content: string }).content,
      BP_B,
    ).value!;
    expect(parsedB.edges).toHaveLength(1);
    expect(parsedB.edges[0]?.id).toBe(EDGE_B);
    expect(parsedB.edges[0]?.label).toBe("supports");

    const parsedNoteB = parseLinkNote(
      (noteBWrite as { content: string }).content,
      NOTE_B,
    ).value!;
    expect(parsedNoteB.frontmatter["from-file"]).toBe("notes/beta.md");
    expect(parsedNoteB.frontmatter["to-file"]).toBe("shared/concept.png");
    expect(serializeLinkNote(parsedNoteB)).toContain("board: b.box.canvas");
  });
});
