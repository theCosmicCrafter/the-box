import { describe, expect, it } from "vitest";
import { gridPlaceRect } from "../src/canvas/grid.js";

describe("gridPlaceRect", () => {
  it("empty board starts at the origin", () => {
    expect(gridPlaceRect([], 0)).toEqual({ x: 0, y: 0 });
  });

  it("grid begins right of the existing bounding box, top-aligned", () => {
    const existing = [{ x: 10, y: 20, width: 100, height: 50 }];
    const g = gridPlaceRect(existing, 0);
    expect(g.x).toBe(10 + 100 + 40); // maxX + gap
    expect(g.y).toBe(20); // minY
  });

  it("row-major layout: 5 columns then wraps", () => {
    const row0 = gridPlaceRect([], 4);
    const row1 = gridPlaceRect([], 5);
    expect(row0.x).toBe(4 * (260 + 40));
    expect(row0.y).toBe(0);
    expect(row1.x).toBe(0);
    expect(row1.y).toBe(200 + 40);
  });

  it("does not overlap previously placed items in the same batch", () => {
    const placed: { x: number; y: number; width: number; height: number }[] =
      [];
    for (let i = 0; i < 3; i++) {
      const g = gridPlaceRect(placed, 0);
      placed.push({ ...g, width: 260, height: 180 });
    }
    for (let i = 1; i < 3; i++) {
      expect(placed[i]!.x).toBe(placed[i - 1]!.x + 260 + 40);
      expect(placed[i]!.y).toBe(placed[i - 1]!.y);
    }
  });
});
