import { describe, expect, it } from "vitest";
import {
  alignNodes,
  distributeNodes,
  tidyGrid,
  type NodeLayoutItem,
} from "../src/canvas/layout.js";

const mkNode = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
): NodeLayoutItem => ({ id, x, y, width, height });

describe("layout tools", () => {
  describe("alignNodes", () => {
    it("returns unmodified if fewer than 2 items selected", () => {
      const nodes = [mkNode("a", 10, 20)];
      expect(alignNodes(nodes, ["a"], "left")).toEqual(nodes);
      expect(alignNodes(nodes, [], "left")).toEqual(nodes);
    });

    it("aligns left to the minimum x", () => {
      const nodes = [
        mkNode("a", 50, 10, 100, 50),
        mkNode("b", 10, 30, 80, 40),
        mkNode("c", 100, 20, 60, 60),
      ];
      const aligned = alignNodes(nodes, ["a", "b", "c"], "left");
      expect(aligned.map((n) => n.x)).toEqual([10, 10, 10]);
      // Y positions remain untouched
      expect(aligned.map((n) => n.y)).toEqual([10, 30, 20]);
    });

    it("aligns right to the maximum right edge", () => {
      const nodes = [
        mkNode("a", 0, 0, 100, 50), // right edge = 100
        mkNode("b", 50, 0, 150, 50), // right edge = 200 (max)
      ];
      const aligned = alignNodes(nodes, ["a", "b"], "right");
      expect(aligned[0]!.x).toBe(100); // 200 - 100
      expect(aligned[1]!.x).toBe(50); // 200 - 150
    });

    it("aligns centerX to horizontal midpoint", () => {
      const nodes = [
        mkNode("a", 0, 0, 100, 50), // center = 50
        mkNode("b", 100, 0, 100, 50), // center = 150; collective bounds 0..200, mid = 100
      ];
      const aligned = alignNodes(nodes, ["a", "b"], "centerX");
      expect(aligned[0]!.x).toBe(50); // 100 - 50
      expect(aligned[1]!.x).toBe(50); // 100 - 50
    });

    it("aligns top to the minimum y", () => {
      const nodes = [mkNode("a", 10, 50), mkNode("b", 20, 25)];
      const aligned = alignNodes(nodes, ["a", "b"], "top");
      expect(aligned[0]!.y).toBe(25);
      expect(aligned[1]!.y).toBe(25);
    });

    it("aligns bottom to maximum bottom edge", () => {
      const nodes = [
        mkNode("a", 0, 10, 100, 50), // bottom = 60
        mkNode("b", 0, 20, 100, 80), // bottom = 100 (max)
      ];
      const aligned = alignNodes(nodes, ["a", "b"], "bottom");
      expect(aligned[0]!.y).toBe(50); // 100 - 50
      expect(aligned[1]!.y).toBe(20); // 100 - 80
    });

    it("aligns centerY to vertical midpoint", () => {
      const nodes = [
        mkNode("a", 0, 0, 100, 40),
        mkNode("b", 0, 100, 100, 100), // collective bounds 0..200, mid = 100
      ];
      const aligned = alignNodes(nodes, ["a", "b"], "centerY");
      expect(aligned[0]!.y).toBe(80); // 100 - 20
      expect(aligned[1]!.y).toBe(50); // 100 - 50
    });

    it("leaves unselected nodes untouched", () => {
      const nodes = [
        mkNode("a", 10, 10),
        mkNode("b", 20, 20),
        mkNode("unselected", 999, 888),
      ];
      const aligned = alignNodes(nodes, ["a", "b"], "left");
      expect(aligned[2]!.x).toBe(999);
      expect(aligned[2]!.y).toBe(888);
    });
  });

  describe("distributeNodes", () => {
    it("returns unmodified if fewer than 3 items selected", () => {
      const nodes = [mkNode("a", 0, 0), mkNode("b", 100, 0)];
      expect(distributeNodes(nodes, ["a", "b"], "horizontal")).toEqual(nodes);
    });

    it("distributes horizontal gaps evenly between endpoints", () => {
      const nodes = [
        mkNode("a", 0, 0, 100, 50),
        mkNode("b", 20, 0, 100, 50),
        mkNode("c", 500, 0, 100, 50),
      ];
      // Total span between end of a (100) and start of c (500) = 400.
      // Interior width of b = 100.
      // Available gap = 300.
      // Gaps between 3 nodes = 2 gaps -> 150 each.
      // b.x should be: a.x + a.width + gap = 100 + 150 = 250.
      const distributed = distributeNodes(nodes, ["a", "b", "c"], "horizontal");
      expect(distributed[0]!.x).toBe(0);
      expect(distributed[1]!.x).toBe(250);
      expect(distributed[2]!.x).toBe(500);
    });

    it("distributes vertical gaps evenly between endpoints", () => {
      const nodes = [
        mkNode("a", 0, 0, 50, 50),
        mkNode("b", 0, 30, 50, 50),
        mkNode("c", 0, 250, 50, 50),
      ];
      // End of a (50), start of c (250) -> span 200.
      // b.height = 50. Available gap = 150 -> 2 gaps of 75.
      // b.y should be 50 + 75 = 125.
      const distributed = distributeNodes(nodes, ["a", "b", "c"], "vertical");
      expect(distributed[0]!.y).toBe(0);
      expect(distributed[1]!.y).toBe(125);
      expect(distributed[2]!.y).toBe(250);
    });
  });

  describe("tidyGrid", () => {
    it("returns unmodified if fewer than 2 items selected", () => {
      const nodes = [mkNode("a", 10, 10)];
      expect(tidyGrid(nodes, ["a"])).toEqual(nodes);
    });

    it("arranges 4 nodes into a 2x2 grid", () => {
      const nodes = [
        mkNode("a", 300, 400, 100, 100),
        mkNode("b", 10, 20, 100, 100),
        mkNode("c", 500, 10, 100, 100),
        mkNode("d", 50, 500, 100, 100),
      ];
      // minX = 10, minY = 10. Gap = 40.
      // cols = ceil(sqrt(4)) = 2.
      const tidied = tidyGrid(nodes, ["a", "b", "c", "d"], 40);
      const bounds = tidied.map((n) => ({ id: n.id, x: n.x, y: n.y }));

      // Positions should fall on {10, 150} for x and {10, 150} for y
      for (const b of bounds) {
        expect([10, 150]).toContain(b.x);
        expect([10, 150]).toContain(b.y);
      }
      // Ensure all 4 cells are distinct
      const uniqueCoords = new Set(bounds.map((b) => `${b.x},${b.y}`));
      expect(uniqueCoords.size).toBe(4);
    });

    it("respects custom column count and preserves non-selected nodes", () => {
      const nodes = [
        mkNode("a", 0, 0, 100, 50),
        mkNode("b", 10, 10, 100, 50),
        mkNode("c", 20, 20, 100, 50),
        mkNode("other", 888, 999, 100, 50),
      ];
      // 3 items with 3 columns = 1 row
      const tidied = tidyGrid(nodes, ["a", "b", "c"], 20, 3);
      const selected = tidied.filter((n) => n.id !== "other");
      expect(selected[0]!.y).toBe(0);
      expect(selected[1]!.y).toBe(0);
      expect(selected[2]!.y).toBe(0);
      expect(selected[0]!.x).toBe(0);
      expect(selected[1]!.x).toBe(120);
      expect(selected[2]!.x).toBe(240);

      // Unselected node intact
      expect(tidied.find((n) => n.id === "other")?.x).toBe(888);
    });
  });
});
