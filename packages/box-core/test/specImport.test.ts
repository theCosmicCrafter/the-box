// SPDX-License-Identifier: LicenseRef-Proprietary
// importSpecCanvas (ADR-0009): foreign JSON Canvas -> in-place normalized
// board + generated link notes, preserving unknown keys and remaining
// spec-readable.

import { describe, expect, it } from "vitest";
import {
  hasBoxFormatMarker,
  importSpecCanvas,
  isReconcilableBoard,
} from "../src/model/specImport.js";
import { parseBoard } from "../src/model/board.js";
import { parseLinkNote } from "../src/model/linkNote.js";
import { isEdgeId, isNodeId } from "../src/model/ids.js";
import { reconcile } from "../src/sync/reconcile.js";

const FOREIGN = {
  nodes: [
    {
      id: "abc123xyz",
      type: "file",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      file: "assets/hero.png",
      "vendor-key": { deep: [1, 2] },
    },
    {
      id: "node-two!",
      type: "text",
      x: 300,
      y: 0,
      width: 200,
      height: 150,
      text: "hello",
    },
  ],
  edges: [
    {
      id: "edge-one",
      fromNode: "abc123xyz",
      toNode: "node-two!",
      fromSide: "right",
      toSide: "left",
      label: "depends",
    },
  ],
  metadata: { app: "obsidian" },
};

describe("importSpecCanvas (ADR-0009)", () => {
  it("normalizes ids, backs edges with link notes, preserves keys", () => {
    const r = importSpecCanvas(JSON.stringify(FOREIGN), "w/design.canvas");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.remappedNodes).toBe(2);
    expect(r.remappedEdges).toBe(1);
    expect(r.notes).toHaveLength(1);

    // The normalized board parses cleanly as ours.
    const p = parseBoard(r.boardJson, "w/design.canvas");
    expect(p.problems.filter((x) => !x.detail.includes("dangling"))).toEqual(
      [],
    );
    const nodes = p.value!.nodes;
    const edges = p.value!.edges;
    expect(nodes.every((n) => isNodeId(n.id))).toBe(true);
    expect(edges.every((e) => isEdgeId(e.id))).toBe(true);
    // Edge endpoints follow the node remap.
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.has(edges[0]!.fromNode)).toBe(true);
    expect(ids.has(edges[0]!.toNode)).toBe(true);
    expect(edges[0]!["box-link"]).toBe(`link-${edges[0]!.id}.md`);
    // Spec + unknown keys preserved.
    expect(edges[0]!.fromSide).toBe("right");
    expect(edges[0]!.label).toBe("depends");
    expect(nodes[0]!["vendor-key"]).toEqual({ deep: [1, 2] });
    const top = JSON.parse(r.boardJson);
    expect(top["box-format"]).toBe("box.canvas/1");
    expect(top.metadata).toEqual({ app: "obsidian" });

    // Generated note parses and carries the remapped endpoints + denorms.
    const note = parseLinkNote(r.notes[0]!.content, r.notes[0]!.path);
    expect(note.problems).toEqual([]);
    expect(note.value!.frontmatter["box-edge"]).toBe(edges[0]!.id);
    expect(note.value!.frontmatter.from).toBe(edges[0]!.fromNode);
    expect(note.value!.frontmatter.to).toBe(edges[0]!.toNode);
    expect(note.value!.frontmatter["from-file"]).toBe("assets/hero.png");
    expect(note.value!.frontmatter["type"]).toBe("depends");
  });

  it("is idempotent - a normalized file parses with zero problems", () => {
    const once = importSpecCanvas(JSON.stringify(FOREIGN), "a.canvas");
    if ("error" in once) throw new Error(once.error);
    const p = parseBoard(once.boardJson, "a.canvas");
    expect(p.problems).toEqual([]);
  });

  it("rejects non-canvas JSON without touching the file", () => {
    expect("error" in importSpecCanvas("not json", "x.canvas")).toBe(true);
    expect("error" in importSpecCanvas("[1,2]", "x.canvas")).toBe(true);
    expect("error" in importSpecCanvas('{"nodes":{}}', "x.canvas")).toBe(true);
  });

  it("keeps already-valid ids stable", () => {
    const valid = {
      nodes: [
        {
          id: "n-abcdef01",
          type: "text",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          text: "t",
        },
      ],
      edges: [],
    };
    const r = importSpecCanvas(JSON.stringify(valid), "x.canvas");
    if ("error" in r) throw new Error(r.error);
    expect(r.remappedNodes).toBe(0);
    const p = parseBoard(r.boardJson, "x.canvas");
    expect(p.value!.nodes[0]!.id).toBe("n-abcdef01");
  });
});

describe("normalized foreign boards take part in reconcile (ADR-0009)", () => {
  it("classifies which .canvas files the sync scan must parse", () => {
    const normalized = importSpecCanvas(JSON.stringify(FOREIGN), "a.canvas");
    if ("error" in normalized) throw new Error(normalized.error);
    expect(hasBoxFormatMarker(normalized.boardJson)).toBe(true);
    expect(hasBoxFormatMarker(JSON.stringify(FOREIGN))).toBe(false);
    // native boards always; normalized foreign ones; never un-normalized ones
    expect(isReconcilableBoard(".box/main.box.canvas", "{}")).toBe(true);
    expect(isReconcilableBoard("w/a.canvas", normalized.boardJson)).toBe(true);
    expect(isReconcilableBoard("w/a.canvas", JSON.stringify(FOREIGN))).toBe(
      false,
    );
    expect(isReconcilableBoard("notes.md", normalized.boardJson)).toBe(false);
  });

  it("imported link notes are NOT adopted onto an unrelated board when their own board is scanned", () => {
    const imp = importSpecCanvas(JSON.stringify(FOREIGN), "world.canvas");
    if ("error" in imp) throw new Error(imp.error);
    const foreign = parseBoard(imp.boardJson, "world.canvas");
    const main = parseBoard(
      '{"nodes":[],"edges":[],"box-format":"box.canvas/1"}',
      ".box/main.box.canvas",
    );
    const notePath = imp.notes[0]!.path;
    const note = parseLinkNote(imp.notes[0]!.content, notePath);
    const scan = {
      boards: new Map([
        [".box/main.box.canvas", main],
        ["world.canvas", foreign],
      ]),
      notes: new Map([[notePath, note]]),
      files: new Set([
        ".box/main.box.canvas",
        "world.canvas",
        notePath,
        "assets/hero.png",
      ]),
      tombstones: new Set<string>(),
    };
    const r = reconcile(scan);
    const touchedMain = r.plan.steps.some(
      (s) => s.op === "write-atomic" && s.path === ".box/main.box.canvas",
    );
    expect(touchedMain).toBe(false);
  });
});
