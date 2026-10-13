// SPDX-License-Identifier: LicenseRef-Proprietary
// I-9: no background process, reconcile pass, or decision-layer call ever
// alters x, y, width, height, or box-placement of any placed node without a
// user-initiated write. Decision helpers return proposals only, never WritePlans.

import { describe, expect, it } from "vitest";
import {
  buildVonPayload,
  createDecisionClient,
  parseVonAnswer,
} from "../src/decisions/decisions.js";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import type { Board, LinkNote } from "../src/model/types.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";

const BP = ".box/main.box.canvas";
const EDGE_1 = "1111111111111111";
const EDGE_2 = "2222222222222222";

describe("invariant-I9-nomove", () => {
  it("reconcile across R-A, R-B, R-C, and R-G never alters node coordinates or box-placement", () => {
    const initialBoard: Board = parseBoard(
      serializeBoard({
        "box-format": "box.canvas/1",
        nodes: [
          {
            id: "n-aaa111",
            type: "file",
            x: -350,
            y: 420,
            width: 310,
            height: 195,
            file: "old.png",
            "box-placement": {
              "2d": { x: -350, y: 420, w: 310, h: 195, z: 7 },
              "3d": { x: 10, y: 20, z: 30, rx: 0.1, ry: 0.2, rz: 0.3 },
            },
          },
          {
            id: "n-bbb222",
            type: "file",
            x: 840,
            y: -115,
            width: 260,
            height: 180,
            file: "doc.md",
            "box-placement": {
              "2d": { x: 840, y: -115, w: 260, h: 180, z: 2 },
              "3d": null,
            },
          },
        ],
        edges: [
          {
            id: EDGE_1,
            fromNode: "n-aaa111",
            toNode: "n-bbb222",
            toEnd: "arrow",
            "box-link": `link-${EDGE_1}.md`,
          },
        ],
      }),
      BP,
    ).value!;

    // Orphan note (triggers R-C adoption)
    const orphanNote: LinkNote = {
      path: `link-${EDGE_2}.md`,
      frontmatter: {
        "box-edge": EDGE_2,
        "box-format": "box.link/1",
        from: "n-bbb222",
        to: "n-aaa111",
        board: "main.box.canvas",
        type: "contradicts",
        created: "2026-10-12T14:31:00.000Z",
      },
      body: "Counter-argument",
    };

    const scan: WorkspaceScan = {
      boards: new Map([[BP, { value: initialBoard, problems: [] }]]),
      // EDGE_1 note is missing -> triggers R-A stub regeneration
      // EDGE_2 note is orphan -> triggers R-C adoption
      notes: new Map([[orphanNote.path, { value: orphanNote, problems: [] }]]),
      files: new Set(["renamed.png", "doc.md", orphanNote.path]),
      tombstones: new Set(),
      // Triggers R-G rename propagation
      renames: new Map([["old.png", "renamed.png"]]),
    };

    const report = reconcile(scan);
    const boardStep = report.plan.steps.find(
      (s) => s.op === "write-atomic" && s.path === BP,
    );
    expect(boardStep).toBeDefined();

    const afterBoard = parseBoard(
      (boardStep as { content: string }).content,
      BP,
    ).value!;

    for (const beforeNode of initialBoard.nodes) {
      const afterNode = afterBoard.nodes.find((n) => n.id === beforeNode.id)!;
      expect(afterNode.x).toBe(beforeNode.x);
      expect(afterNode.y).toBe(beforeNode.y);
      expect(afterNode.width).toBe(beforeNode.width);
      expect(afterNode.height).toBe(beforeNode.height);
      expect(afterNode["box-placement"]).toEqual(beforeNode["box-placement"]);
    }
  });

  it("decision client returns proposals only (never WritePlans), respects threshold, and degrades offline", async () => {
    const nodes = Object.freeze([
      Object.freeze({ file: "a.png", x: 100, y: 200 }),
      Object.freeze({ file: "b.png", x: 400, y: 200 }),
    ]);

    // 1. Default disabled client (Stage 1 flag off) -> offline/null, zero network calls
    const disabledClient = createDecisionClient();
    expect(disabledClient.enabled).toBe(false);
    expect(
      await disabledClient.decide("q", {
        type: "noul",
        instructions: "Should we group?",
      }),
    ).toEqual({ ok: false, offline: true });
    expect(await disabledClient.suggestPlacement("c.png", nodes)).toBeNull();
    expect(
      await disabledClient.suggestLinkType(EDGE_1, "Armor", "Insignia"),
    ).toBeNull();

    // 2. Enabled client with mock local response above threshold (0.85 >= 0.7)
    const highConfClient = createDecisionClient({
      enabled: true,
      confidenceThreshold: 0.7,
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.questions?.placement) {
          return new Response(
            JSON.stringify({
              answers: { placement: { score: 0.85, pick: "reference" } },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            answers: { link_type: { pick: "inspired-by", score: 0.9 } },
          }),
          { status: 200 },
        );
      },
    });

    const placement = await highConfClient.suggestPlacement("c.png", nodes);
    expect(placement).not.toBeNull();
    expect(placement?.kind).toBe("placement-proposal");
    expect(placement?.file).toBe("c.png");
    expect(placement?.confidence).toBe(0.85);
    // Proposal is NOT a WritePlan (no `steps` array)
    expect("steps" in (placement as unknown as Record<string, unknown>)).toBe(
      false,
    );
    // Existing nodes were never mutated
    expect(nodes[0]).toEqual({ file: "a.png", x: 100, y: 200 });
    expect(nodes[1]).toEqual({ file: "b.png", x: 400, y: 200 });

    const linkProposal = await highConfClient.suggestLinkType(
      EDGE_1,
      "Armor",
      "Insignia",
    );
    expect(linkProposal).toEqual({
      kind: "link-type-proposal",
      edgeId: EDGE_1,
      suggestedType: "inspired-by",
      confidence: 0.9,
    });

    // 3. Below-threshold confidence (0.5 < 0.7) is suppressed (FR-404)
    const lowConfClient = createDecisionClient({
      enabled: true,
      confidenceThreshold: 0.7,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            answers: {
              placement: { score: 0.5 },
              link_type: { pick: "supports", score: 0.4 },
            },
          }),
          { status: 200 },
        ),
    });
    expect(await lowConfClient.suggestPlacement("c.png", nodes)).toBeNull();
    expect(
      await lowConfClient.suggestLinkType(EDGE_1, "Armor", "Insignia"),
    ).toBeNull();

    // 4. Network error / offline endpoint resolves cleanly (ERR-9)
    const errorClient = createDecisionClient({
      enabled: true,
      fetchFn: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:8770");
      },
    });
    expect(
      await errorClient.decide("q", { type: "noul", instructions: "test" }),
    ).toEqual({ ok: false, offline: true });
    expect(await errorClient.suggestPlacement("c.png", nodes)).toBeNull();

    // 5. Pure helpers buildVonPayload and parseVonAnswer
    const payload = buildVonPayload(
      { file: "c.png" },
      {
        q1: {
          type: "choice",
          instructions: "Pick one",
          options: ["a", "b"],
        },
      },
    );
    expect(payload.questions["q1"]?.criteria).toEqual(["a", "b"]);
    expect(
      parseVonAnswer({ answers: { q1: { pick: "invalid" } } }, "q1", [
        "a",
        "b",
      ]),
    ).toEqual({ ok: false, offline: false });
  });
});
