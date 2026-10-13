// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, it, expect } from "vitest";
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomToFit,
  MIN_ZOOM,
  MAX_ZOOM,
} from "../src/canvas/camera.js";

const cam = { x: 100, y: -50, z: 2 };

describe("camera math", () => {
  it("worldToScreen/screenToWorld round-trip", () => {
    const s = worldToScreen(cam, 300, 200);
    const w = screenToWorld(cam, s.x, s.y);
    expect(w.x).toBeCloseTo(300);
    expect(w.y).toBeCloseTo(200);
  });

  it("panBy moves the camera opposite the drag, scaled by zoom", () => {
    const c = panBy(cam, 40, -20);
    expect(c.x).toBeCloseTo(100 - 20); // 40px at z=2 -> 20 world units
    expect(c.y).toBeCloseTo(-50 + 10);
    expect(c.z).toBe(2);
  });

  it("zoomAt keeps the world point under the cursor fixed", () => {
    const before = screenToWorld(cam, 400, 300);
    const c = zoomAt(cam, 400, 300, 1.5);
    const after = screenToWorld(c, 400, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(c.z).toBeCloseTo(3);
  });

  it("zoomAt clamps to MIN/MAX", () => {
    expect(zoomAt(cam, 0, 0, 1000).z).toBe(MAX_ZOOM);
    expect(zoomAt(cam, 0, 0, 0.0001).z).toBe(MIN_ZOOM);
  });

  it("zoomToFit centers the rect and fits it", () => {
    const c = zoomToFit({ x: 0, y: 0, w: 800, h: 600 }, 1000, 800, 0);
    // z = min(1000/800, 800/600) = 1.25; view center must equal rect center
    const center = screenToWorld(c, 500, 400);
    expect(center.x).toBeCloseTo(400);
    expect(center.y).toBeCloseTo(300);
    expect(c.z).toBeCloseTo(1.25);
  });
});
