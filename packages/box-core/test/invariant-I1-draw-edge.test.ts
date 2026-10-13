// SPDX-License-Identifier: LicenseRef-Proprietary
// I-1: draw an edge -> exactly one link-<edgeid>.md exists with matching
// box-edge, from, to. Steps execute note-first, board-second (§4.2).

import { describe, it, expect } from "vitest";
import { createEdgePlan, boardPath } from "../src/sync/edges.js";
import { parseBoard } from "../src/model/board.js";
import { parseLinkNote } from "../src/model/linkNote.js";
import { MemoryVault } from "../src/vault/vault.js";
import { serializeBoard } from "../src/model/board.js";
import type { Board } from "../src/model/types.js";
import type { WriteStep } from "../src/model/types.js";

function fixture(): Board {
  return parseBoard(
    JSON.stringify({
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
      edges: [],
    }),
  ).value!;
}

async function execPlan(
  vault: MemoryVault,
  steps: WriteStep[],
  tombstones: Set<string>,
): Promise<void> {
  for (const s of steps) {
    if (s.op === "write-atomic") await vault.writeAtomic(s.path, s.content);
    else if (s.op === "trash") await vault.trash(s.path);
    else if (s.op === "append-tombstone") tombstones.add(s.edgeId);
  }
}

describe("invariant-I1-draw-edge", () => {
  it("emits note-first, board-second and creates a matching note", async () => {
    const vault = new MemoryVault();
    const tombstones = new Set<string>();
    const bp = boardPath("main");
    vault.seed(bp, serializeBoard(fixture()));

    const { plan, edge, notePath } = createEdgePlan(
      fixture(),
      bp,
      "n-aaa111",
      "n-bbb222",
      { type: "inspired-by" },
    );

    // ordering contract: note first, board second
    expect(plan.steps[0]?.op).toBe("write-atomic");
    expect((plan.steps[0] as { path: string }).path).toBe(notePath);
    expect((plan.steps[1] as { path: string }).path).toBe(bp);

    await execPlan(vault, plan.steps, tombstones);

    // exactly one note exists, matching box-edge/from/to
    const noteFiles = [...vault.files.keys()].filter((p) =>
      p.startsWith("link-"),
    );
    expect(noteFiles).toHaveLength(1);
    expect(noteFiles[0]).toBe(`link-${edge.id}.md`);

    const note = parseLinkNote(vault.files.get(notePath)!, notePath).value!;
    expect(note.frontmatter["box-edge"]).toBe(edge.id);
    expect(note.frontmatter.from).toBe("n-aaa111");
    expect(note.frontmatter.to).toBe("n-bbb222");
    expect(note.frontmatter["from-file"]).toBe("a.png");
    expect(note.frontmatter["to-file"]).toBe("b.png");

    // board references the note via box-link
    const board = parseBoard(vault.files.get(bp)!, bp).value!;
    const created = board.edges.find((e) => e.id === edge.id);
    expect(created?.["box-link"]).toBe(`link-${edge.id}.md`);
  });
});
