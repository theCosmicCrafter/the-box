// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, expect, it } from "vitest";
import {
  pathToPolygon,
  pointInPolygon,
  strokeToPath,
} from "../src/canvas/ink.js";
import { isBoxUserObject } from "../src/FileTree.js";
import { INK_COLORS, INK_SIZES } from "../src/Ribbon.js";

describe("strokeToPath", () => {
  it("empty input produces no path", () => {
    expect(strokeToPath([])).toBe("");
  });

  it("a single point still produces a filled dot polygon", () => {
    const d = strokeToPath([{ x: 10, y: 20, p: 0.5 }]);
    expect(d).toMatch(/^M /);
    expect(d).toMatch(/ Z$/);
    expect(pathToPolygon(d)).not.toBeNull();
  });

  it("emits polygon-only `d` (M/L/Z) that round-trips through pathToPolygon", () => {
    const pts = [
      { x: 0, y: 0, p: 0.3 },
      { x: 50, y: 10, p: 0.7 },
      { x: 120, y: 40, p: 0.5 },
      { x: 200, y: 30, p: 0.9 },
    ];
    const d = strokeToPath(pts);
    const poly = pathToPolygon(d);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBeGreaterThan(4);
    // Every vertex is finite; the stroke outline is a closed polygon.
    for (const [x, y] of poly!) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("the stroke center is inside its own polygon (eraser hit target)", () => {
    // A long horizontal stroke: its midpoint must be inside the outline,
    // or the eraser could never hit it.
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push({ x: i * 10, y: 100, p: 0.5 });
    const poly = pathToPolygon(strokeToPath(pts))!;
    expect(pointInPolygon(100, 100, poly)).toBe(true);
    expect(pointInPolygon(100, 500, poly)).toBe(false);
  });
});

describe("pathToPolygon", () => {
  it("rejects bezier/arc commands - not our polygon format", () => {
    expect(pathToPolygon("M 0 0 C 10 10 20 20 30 30")).toBeNull();
    expect(pathToPolygon("M 0 0 A 5 5 0 0 1 10 10")).toBeNull();
    expect(pathToPolygon("")).toBeNull();
    expect(pathToPolygon("garbage")).toBeNull();
  });

  it("rejects degenerate polygons (fewer than 2 points)", () => {
    expect(pathToPolygon("M 5 5")).toBeNull();
    expect(pathToPolygon("M 5 5 Z")).toBeNull();
  });

  it("parses a plain M/L/Z polygon", () => {
    const poly = pathToPolygon("M 0 0 L 10 0 L 10 10 Z");
    expect(poly).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });
});

describe("pointInPolygon", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("hits inside, misses outside", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(5, -1, square)).toBe(false);
    expect(pointInPolygon(50, 50, square)).toBe(false);
  });
});

describe("ink palette constants (FR-307)", () => {
  it("exposes non-empty color and size palettes", () => {
    expect(INK_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(INK_SIZES).toEqual([4, 10, 18]);
  });

  it("strokeToPath scales outline width with size parameter", () => {
    const pts = [
      { x: 0, y: 50, p: 0.5 },
      { x: 100, y: 50, p: 0.5 },
    ];
    const thin = pathToPolygon(strokeToPath(pts, 4))!;
    const thick = pathToPolygon(strokeToPath(pts, 18))!;
    const spanY = (poly: [number, number][]) =>
      Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1]));
    expect(spanY(thick)).toBeGreaterThan(spanY(thin));
  });
});

describe("isBoxUserObject (FR-202, DATA-MODEL §1)", () => {
  const boundInk = new Set(["notes/idea.md.ink.svg", "photo.png.ink.svg"]);

  it("excludes app-managed .box/ contents", () => {
    expect(isBoxUserObject(".box", boundInk)).toBe(false);
    expect(isBoxUserObject(".box/main.box.canvas", boundInk)).toBe(false);
    expect(isBoxUserObject(".box/tombstones.json", boundInk)).toBe(false);
  });

  it("excludes root-level link-<16hex>.md relationship notes", () => {
    expect(isBoxUserObject("link-0123456789abcdef.md", boundInk)).toBe(false);
    // Uppercase or non-16-hex or nested markdown files are user objects.
    expect(isBoxUserObject("link-short.md", boundInk)).toBe(true);
    expect(isBoxUserObject("notes/link-0123456789abcdef.md", boundInk)).toBe(
      true,
    );
  });

  it("excludes bound .ink.svg sidecars but keeps standalone .ink.svg files", () => {
    expect(isBoxUserObject("notes/idea.md.ink.svg", boundInk)).toBe(false);
    expect(isBoxUserObject("photo.png.ink.svg", boundInk)).toBe(false);
    expect(isBoxUserObject("standalone.ink.svg", boundInk)).toBe(true);
  });

  it("includes user markdown, images, audio, and video files", () => {
    expect(isBoxUserObject("readme.md", boundInk)).toBe(true);
    expect(isBoxUserObject("notes/idea.md", boundInk)).toBe(true);
    expect(isBoxUserObject("assets/photo.png", boundInk)).toBe(true);
    expect(isBoxUserObject("clips/demo.mp4", boundInk)).toBe(true);
    expect(isBoxUserObject("audio/loop.wav", boundInk)).toBe(true);
  });
});
