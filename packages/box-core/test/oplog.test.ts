// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "../src/index.js";
import {
  applyDelta,
  decodeOplog,
  diffSnapshots,
  encodeOplog,
  oplogPath,
  parseOplogText,
  serializeOplog,
  trimOplog,
  type BoardSnapshot,
} from "../src/index.js";

const node = (id: string, x = 0): CanvasNode =>
  ({
    id,
    type: "text",
    x,
    y: 0,
    width: 100,
    height: 80,
    text: `body ${id}`,
  }) as CanvasNode;

const edge = (id: string, from: string, to: string): CanvasEdge =>
  ({ id, fromNode: from, toNode: to }) as CanvasEdge;

describe("oplog - ADR-0007 v2 snapshot deltas", () => {
  it("invariant: encode->decode round-trips a full stack", () => {
    const s0: BoardSnapshot = {
      nodes: [node("n-1", 0), node("n-2", 10)],
      edges: [edge("e-1", "n-1", "n-2")],
    };
    const s1: BoardSnapshot = {
      nodes: [node("n-1", 50), s0.nodes[1]!], // n-1 moved; n-2 same ref
      edges: s0.edges,
    };
    const s2: BoardSnapshot = {
      nodes: [s1.nodes[0]!], // n-2 + e-1 removed; n-1 same ref
      edges: [],
    };
    const file = encodeOplog([s0, s1, s2], "main.box.canvas")!;
    expect(file.entries).toHaveLength(2);
    // delta for move carries only the changed node
    expect(Object.keys(file.entries[0]!.nodes)).toEqual(["n-1"]);
    expect(file.entries[0]!.edges).toEqual({});
    // delta for removal stores null tombstones per entity
    expect(file.entries[1]!.nodes["n-2"]).toBeNull();
    expect(file.entries[1]!.edges["e-1"]).toBeNull();

    const stack = decodeOplog(
      JSON.parse(JSON.stringify(file)),
      "main.box.canvas",
    )!;
    expect(stack).toHaveLength(3);
    expect(stack[2]!.nodes).toEqual(s2.nodes);
    expect(stack[2]!.edges).toEqual([]);
  });

  it("diff/apply are inverse for adds, edits, removals", () => {
    const a: BoardSnapshot = { nodes: [node("a", 1)], edges: [] };
    const b: BoardSnapshot = {
      nodes: [node("a", 9), node("c", 4)],
      edges: [edge("e", "a", "c")],
    };
    const d = diffSnapshots(a, b);
    expect(d.nodes["a"]).not.toBeNull(); // changed
    expect(d.nodes["c"]).not.toBeNull(); // added
    const applied = applyDelta(a, d);
    expect(applied.nodes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(applied.nodes.find((n) => n.id === "a")!.x).toBe(9);
    expect(applied.edges).toHaveLength(1);
    // removing back is a delta too
    const back = diffSnapshots(b, a);
    expect(back.nodes["c"]).toBeNull();
    expect(back.edges["e"]).toBeNull();
    expect(applyDelta(b, back).nodes).toHaveLength(1);
  });

  it("decode rejects foreign payloads and wrong boards", () => {
    expect(decodeOplog(null, "b.canvas")).toBeNull();
    expect(decodeOplog({ v: 2 }, "b.canvas")).toBeNull();
    const f = encodeOplog([{ nodes: [], edges: [] }], "a.box.canvas")!;
    expect(decodeOplog(f, "other.box.canvas")).toBeNull();
    expect(parseOplogText("not json {", "a.box.canvas")).toBeNull();
    expect(parseOplogText(JSON.stringify(f), "a.box.canvas")).toHaveLength(1);
  });

  it("trim folds oldest entries into base (cap is bounded)", () => {
    const stack: BoardSnapshot[] = [{ nodes: [node("n")], edges: [] }];
    for (let i = 1; i <= 6; i++)
      stack.push({ nodes: [node("n", i)], edges: [] });
    const f = trimOplog(encodeOplog(stack, "b.canvas")!, 3);
    expect(f.entries).toHaveLength(3);
    // base advanced past the folded deltas
    expect((f.base.nodes[0] as { x: number }).x).toBe(3);
    // and replay still reconstructs the newest state
    const replayed = decodeOplog(f, "b.canvas")!;
    expect((replayed.at(-1)!.nodes[0] as { x: number }).x).toBe(6);
  });

  it("entities are opaque - unknown keys ride through deltas verbatim", () => {
    const mystery = {
      id: "n-x",
      type: "file",
      file: "a.png",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      "custom-future-key": { nested: [1, 2, 3] },
    } as unknown as CanvasNode;
    const s0: BoardSnapshot = { nodes: [mystery], edges: [] };
    const s1: BoardSnapshot = { nodes: [{ ...mystery, x: 5 }], edges: [] };
    const f = encodeOplog([s0, s1], "b.canvas")!;
    const decoded = decodeOplog(JSON.parse(JSON.stringify(f)), "b.canvas")!;
    expect(
      (decoded[1]!.nodes[0] as Record<string, unknown>)["custom-future-key"],
    ).toEqual({ nested: [1, 2, 3] });
  });

  it("oplogPath is per-board, deterministic, and collision-safe", () => {
    const a = oplogPath("main.box.canvas");
    expect(a).toMatch(/^\.box\/oplog-main-[0-9a-f]{16}\.json$/);
    expect(oplogPath("sub/main.box.canvas")).not.toBe(a); // same stem, diff dir
    expect(oplogPath("a.canvas")).toBe(oplogPath("a.canvas"));
  });

  it("serializeOplog refuses non-rel board paths", () => {
    expect(
      serializeOplog([{ nodes: [], edges: [] }], "../x.canvas"),
    ).toBeNull();
    const ok = serializeOplog([{ nodes: [], edges: [] }], "main.box.canvas")!;
    expect(ok.path).toContain(".box/oplog-");
    expect(JSON.parse(ok.json).v).toBe(1);
  });

  it("diffSnapshots stays correct at bulk scale (linear removal scan)", () => {
    const prevNodes = Array.from({ length: 2000 }, (_, i) => node(`n-${i}`));
    const prev: BoardSnapshot = { nodes: prevNodes, edges: [] };
    // next keeps half, moves one, drops the rest
    const nextNodes = prevNodes
      .filter((_, i) => i % 2 === 0)
      .map((n, i) => (i === 0 ? { ...n, x: 999 } : n));
    const d = diffSnapshots(prev, { nodes: nextNodes, edges: [] });
    // 1000 removals (odd ids) + 1 move (n-0); kept evens unchanged
    expect(Object.keys(d.nodes)).toHaveLength(1001);
    expect(d.nodes["n-0"]).toMatchObject({ x: 999 });
    expect(d.nodes["n-1"]).toBeNull();
    expect(d.nodes["n-1999"]).toBeNull();
    // kept + unchanged evens are absent from the delta entirely
    expect(d.nodes["n-1998"]).toBeUndefined();
  });

  it("decodeOplog rejects oversized entry logs (untrusted .box input)", () => {
    const hostile = {
      v: 1,
      board: "main.box.canvas",
      base: { nodes: [], edges: [] },
      entries: Array.from({ length: 100_000 }, () => ({
        nodes: {},
        edges: {},
      })),
    };
    expect(decodeOplog(hostile, "main.box.canvas")).toBeNull();
    // boundary: a log trimOplog could legitimately write still decodes
    const ok = {
      v: 1,
      board: "main.box.canvas",
      base: { nodes: [], edges: [] },
      entries: Array.from({ length: 800 }, () => ({
        nodes: {},
        edges: {},
      })),
    };
    expect(decodeOplog(ok, "main.box.canvas")).toHaveLength(801);
  });
});
