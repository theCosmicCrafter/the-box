// SPDX-License-Identifier: LicenseRef-Proprietary
// I-8: hand-edit link-*.md with malformed YAML frontmatter or corrupt an
// .ink.svg sidecar (ERR-8) -> surfaced in report.problems, never silently
// dropped or trashed.

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { parseInkSvg } from "../src/model/ink.js";
import { parseLinkNote } from "../src/model/linkNote.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const BP = ".box/main.box.canvas";
const EDGE_ID = "7f3a9c2b1d4e5f6a";
const NOTE_PATH = `link-${EDGE_ID}.md`;
const INK_PATH = "a.png.ink.svg";

describe("invariant-I8-malformed", () => {
  it("surfaces malformed link-*.md frontmatter and malformed .ink.svg in problems without trashing", () => {
    const boardRes = parseBoard(
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
            file: "a.png",
            "box-ink": INK_PATH,
          },
          {
            id: "n-bbb222",
            type: "file",
            x: 300,
            y: 0,
            width: 200,
            height: 150,
            file: "b.png",
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
    );

    // Hand-broken YAML in link note + hostile/corrupt ink sidecar
    const malformedNoteRes = parseLinkNote(
      "---\nbox-edge: [unclosed yaml\n---\nUser prose stays on disk",
      NOTE_PATH,
    );
    const malformedInkRes = parseInkSvg(
      '<svg><script>evil()</script><path onclick="bad()" d="M0 0"/></svg>',
      INK_PATH,
    );

    expect(malformedNoteRes.value).toBeNull();
    expect(malformedInkRes.value).toBeNull();

    const scan: WorkspaceScan = {
      boards: new Map([[BP, boardRes]]),
      notes: new Map([[NOTE_PATH, malformedNoteRes]]),
      ink: new Map([[INK_PATH, malformedInkRes]]),
      files: new Set(["a.png", "b.png", NOTE_PATH, INK_PATH]),
      tombstones: new Set(),
      knownNotes: new Set([EDGE_ID]),
    };

    const report = reconcile(scan);

    // Both the malformed note and malformed ink sidecar appear in problems
    expect(
      report.problems.some(
        (p) => p.kind === "malformed-note" && p.path === NOTE_PATH,
      ),
    ).toBe(true);
    expect(
      report.problems.some(
        (p) => p.kind === "malformed-note" && p.path === INK_PATH,
      ),
    ).toBe(true);

    // Neither file is trashed or overwritten, and the board edge is NOT removed
    expect(report.plan.steps).toEqual([]);
  });
});
