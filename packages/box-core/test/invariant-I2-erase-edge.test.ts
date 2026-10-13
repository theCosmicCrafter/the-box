// SPDX-License-Identifier: LicenseRef-Proprietary
// I-2: erase an edge -> note deleted recoverably (trash, not unlink) AND a
// tombstone recorded. Order: tombstone, board, trash (§4.3).

import { describe, it, expect } from "vitest";
import {
  createEdgePlan,
  deleteEdgePlan,
  boardPath,
} from "../src/sync/edges.js";
import { serializeBoard } from "../src/model/board.js";
import { MemoryVault } from "../src/vault/vault.js";
import type { Board, WriteStep } from "../src/model/types.js";
import { parseBoard } from "../src/model/board.js";

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

describe("invariant-I2-erase-edge", () => {
  it("tombstones, rewrites board, trashes note - in that order", async () => {
    const vault = new MemoryVault();
    const tombstones = new Set<string>();
    const bp = boardPath("main");
    const board = fixture();

    const { edge } = createEdgePlan(board, bp, "n-aaa111", "n-bbb222");
    vault.seed(bp, serializeBoard(board));
    // apply create so delete has something to remove
    const create = createEdgePlan(board, bp, "n-aaa111", "n-bbb222");
    await execPlan(vault, create.plan.steps, tombstones);

    const plan = deleteEdgePlan(board, bp, create.edge.id);
    expect(plan.steps[0]?.op).toBe("append-tombstone");
    expect(plan.steps[1]?.op).toBe("write-atomic");
    expect(plan.steps[2]?.op).toBe("trash");

    await execPlan(vault, plan.steps, tombstones);
    expect(tombstones.has(create.edge.id)).toBe(true);
    expect(vault.trashed).toContain(`link-${create.edge.id}.md`);
    expect(vault.files.has(`link-${create.edge.id}.md`)).toBe(false);
    void edge;
  });
});
