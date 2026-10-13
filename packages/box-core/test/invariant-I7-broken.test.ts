// SPDX-License-Identifier: LicenseRef-Proprietary
// I-7: delete an endpoint file on disk (R-E) or reference a missing node ID
// (R-F) -> node/edge renders broken and surfaces in problems; neither node,
// edge, nor link-*.md is auto-deleted.

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import type { Board, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const BP = ".box/main.box.canvas";
const EDGE_OK_NODES = "7f3a9c2b1d4e5f6a";
const EDGE_DANGLING = "8888888888888888";
const NOTE_1 = `link-${EDGE_OK_NODES}.md`;
const NOTE_2 = `link-${EDGE_DANGLING}.md`;

function fixtureBoard(): Board {
  return parseBoard(
    serializeBoard({
      "box-format": "box.canvas/1",
      nodes: [
        {
          id: "n-aaa111",
          type: "file",
          x: 0,
          y: 0,
          width: 200,
          height: 150,
          file: "missing-image.png",
        },
        {
          id: "n-bbb222",
          type: "file",
          x: 300,
          y: 0,
          width: 200,
          height: 150,
          file: "present.md",
        },
      ],
      edges: [
        {
          id: EDGE_OK_NODES,
          fromNode: "n-aaa111",
          toNode: "n-bbb222",
          toEnd: "arrow",
          "box-link": NOTE_1,
        },
        {
          id: EDGE_DANGLING,
          fromNode: "n-bbb222",
          toNode: "n-dead99",
          toEnd: "arrow",
          "box-link": NOTE_2,
        },
      ],
    }),
    BP,
  ).value!;
}

function makeNote(
  edgeId: string,
  from: string,
  to: string,
  fromFile?: string,
  toFile?: string,
): LinkNote {
  return {
    path: `link-${edgeId}.md`,
    frontmatter: {
      "box-edge": edgeId,
      "box-format": "box.link/1",
      from,
      to,
      board: "main.box.canvas",
      ...(fromFile !== undefined ? { "from-file": fromFile } : {}),
      ...(toFile !== undefined ? { "to-file": toFile } : {}),
      created: "2026-10-12T14:31:00.000Z",
    },
    body: "User-written relationship prose that must never be destroyed.",
  };
}

describe("invariant-I7-broken", () => {
  it("flags missing file (R-E) and dangling endpoint (R-F) without deleting nodes, edges, or notes", () => {
    const board = fixtureBoard();
    const n1 = makeNote(
      EDGE_OK_NODES,
      "n-aaa111",
      "n-bbb222",
      "missing-image.png",
      "present.md",
    );
    const n2 = makeNote(
      EDGE_DANGLING,
      "n-bbb222",
      "n-dead99",
      "present.md",
      undefined,
    );

    const scan: WorkspaceScan = {
      boards: new Map([[BP, { value: board, problems: [] }]]),
      notes: new Map([
        [NOTE_1, { value: n1, problems: [] }],
        [NOTE_2, { value: n2, problems: [] }],
      ]),
      // missing-image.png is absent from disk; present.md and both notes exist
      files: new Set(["present.md", NOTE_1, NOTE_2]),
      tombstones: new Set(),
      knownNotes: new Set([EDGE_OK_NODES, EDGE_DANGLING]),
    };

    const report = reconcile(scan);

    // R-E: missing file -> brokenNodes contains n-aaa111, problem reported
    expect(report.brokenNodes).toEqual(["n-aaa111"]);
    expect(
      report.problems.some(
        (p) =>
          p.kind === "broken-node" &&
          p.path === BP &&
          p.detail.includes("missing-image.png"),
      ),
    ).toBe(true);

    // R-F: edge referencing n-dead99 -> brokenEdges contains EDGE_DANGLING, problem reported
    expect(report.brokenEdges).toEqual([EDGE_DANGLING]);
    expect(
      report.problems.some(
        (p) =>
          p.kind === "broken-edge" &&
          p.path === BP &&
          p.detail.includes(EDGE_DANGLING),
      ),
    ).toBe(true);

    // Invariant I-7: zero trash steps, zero board writes removing nodes or edges
    expect(report.plan.steps.filter((s) => s.op === "trash")).toHaveLength(0);
    expect(report.plan.steps).toHaveLength(0);
  });
});
