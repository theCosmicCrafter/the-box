// SPDX-License-Identifier: LicenseRef-Proprietary
import type { FileNode } from "@box/core";
import { describe, expect, it } from "vitest";
import {
  edgeVisible,
  nodeVisible,
  rectsIntersect,
  worldViewport,
} from "../src/canvas/cull.js";
import { gridPlaceRect } from "../src/canvas/grid.js";
import { pathBounds, translatePath } from "../src/canvas/ink.js";
import { NODE_COLOR_PRESETS, nodeTint } from "../src/canvas/NodeView.js";

const fileNode = (x: number, y: number): FileNode => ({
  id: `n-${x}`,
  type: "file",
  x,
  y,
  width: 200,
  height: 150,
  file: "a.md",
});

describe("worldViewport", () => {
  it("converts camera + viewport px to world rect with buffer", () => {
    const v = worldViewport({ x: 0, y: 0, z: 1 }, 1000, 800, 300);
    expect(v).toEqual({ x: -300, y: -300, w: 1600, h: 1400 });
  });
  it("buffer shrinks as zoom grows", () => {
    const v = worldViewport({ x: 100, y: 50, z: 2 }, 1000, 800, 300);
    expect(v.x).toBeCloseTo(-50); // 100 - 150
    expect(v.w).toBeCloseTo(800); // 500 + 300
  });
});

describe("nodeVisible", () => {
  const view = worldViewport({ x: 0, y: 0, z: 1 }, 1000, 800);
  it("on-screen node is visible", () => {
    expect(nodeVisible(fileNode(100, 100), view)).toBe(true);
  });
  it("far-off node is culled", () => {
    expect(nodeVisible(fileNode(50000, 50000), view)).toBe(false);
  });
  it("edge-touching node within buffer survives", () => {
    expect(nodeVisible(fileNode(1290, 100), view)).toBe(true); // inside 300px buffer
  });
  it("node just past the buffer edge is culled", () => {
    expect(nodeVisible(fileNode(1400, 100), view)).toBe(false);
  });
});

describe("edgeVisible", () => {
  const view = worldViewport({ x: 0, y: 0, z: 1 }, 1000, 800);
  it("edge between two visible nodes is visible", () => {
    expect(edgeVisible(fileNode(0, 0), fileNode(400, 0), view)).toBe(true);
  });
  it("edge between two far-off nodes is culled", () => {
    expect(edgeVisible(fileNode(50000, 0), fileNode(60000, 0), view)).toBe(
      false,
    );
  });
  it("edge with a missing endpoint stays visible (I-7)", () => {
    expect(edgeVisible(fileNode(50000, 0), undefined, view)).toBe(true);
  });
  it("long edge crossing the viewport is visible even if ends are off", () => {
    expect(edgeVisible(fileNode(-5000, 100), fileNode(5000, 100), view)).toBe(
      true,
    );
  });
});

describe("rectsIntersect", () => {
  it("touching corners intersect", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 9, y: 9, w: 10, h: 10 },
      ),
    ).toBe(true);
  });
  it("disjoint rects do not intersect", () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 0, w: 10, h: 10 },
      ),
    ).toBe(false);
  });
});

describe("translatePath", () => {
  it("translates a polygon path", () => {
    const out = translatePath("M 0 0 L 10 0 L 10 10 Z", 5, -2);
    expect(out).toBe("M 5.0 -2.0 L 15.0 -2.0 L 15.0 8.0 Z");
  });
  it("round-trips through pathToPolygon semantics", () => {
    const out = translatePath("M 1.5 2.5 L 3.5 4.5 L 8 8 Z", 1, 1);
    expect(out).toContain("2.5 3.5");
  });
  it("refuses foreign (bezier) paths", () => {
    expect(translatePath("M 0 0 C 1 1, 2 2, 3 3", 5, 5)).toBeNull();
  });
});

describe("pathBounds", () => {
  it("computes the polygon bbox", () => {
    expect(pathBounds("M 1 2 L 9 2 L 9 8 Z")).toEqual({
      minX: 1,
      minY: 2,
      maxX: 9,
      maxY: 8,
    });
  });
  it("returns null on foreign paths", () => {
    expect(pathBounds("M 0 0 Q 1 1 2 2")).toBeNull();
  });
});

describe("gridPlaceRect", () => {
  it("empty board starts at origin", () => {
    expect(gridPlaceRect([], 0)).toEqual({ x: 0, y: 0 });
  });
  it("grid starts right of the existing bounding box", () => {
    const r = gridPlaceRect(
      [{ x: 0, y: 0, width: 100, height: 100 }],
      0,
      260,
      200,
      40,
    );
    expect(r.x).toBe(140); // 100 + 40 gap
    expect(r.y).toBe(0);
  });
  it("fills row-major, 5 columns", () => {
    const xs = [...Array(6)].map((_, i) => gridPlaceRect([], i).x);
    expect(xs[5]).toBe(0); // wraps to column 0 on row 2
    expect(gridPlaceRect([], 5).y).toBe(240); // 200 + 40 gap
  });
});

describe("nodeTint", () => {
  it("maps JSON Canvas presets", () => {
    expect(nodeTint("1")).toBe(NODE_COLOR_PRESETS["1"]);
    expect(nodeTint("6")).toBe(NODE_COLOR_PRESETS["6"]);
  });
  it("passes hex strings through", () => {
    expect(nodeTint("#123456")).toBe("#123456");
  });
  it("empty/missing yields null", () => {
    expect(nodeTint(undefined)).toBeNull();
    expect(nodeTint("")).toBeNull();
  });
});

describe("level of detail (LOD)", () => {
  const isLowLod = (z: number, unCullable: boolean, type: string) =>
    z < 0.35 && !unCullable && type !== "group";

  it("triggers low LOD when zoomed out below threshold", () => {
    expect(isLowLod(0.2, false, "file")).toBe(true);
    expect(isLowLod(0.2, false, "text")).toBe(true);
  });

  it("preserves full LOD at standard zoom or for interactive nodes", () => {
    expect(isLowLod(1.0, false, "file")).toBe(false);
    expect(isLowLod(0.2, true, "file")).toBe(false); // selected / editing
    expect(isLowLod(0.2, false, "group")).toBe(false); // groups never low lod
  });
});
