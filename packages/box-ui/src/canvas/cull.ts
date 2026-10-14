// SPDX-License-Identifier: LicenseRef-Proprietary
// Viewport culling (tldraw pattern, ADR-0004): shapes outside the camera's
// world-space viewport get display:none - they stay in the DOM (hit-test,
// selection, and export still work) but cost nothing to paint. Selected or
// editing nodes are never culled - a half-off-screen node must stay usable.

import type { Camera } from "./camera.js";
import type { CanvasNode } from "@box/core";

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World-space rect the viewport currently shows, expanded by a buffer in
 * screen px (converted to world units by dividing by zoom). */
export function worldViewport(
  cam: Camera,
  vw: number,
  vh: number,
  bufferPx = 300,
): WorldRect {
  const b = bufferPx / cam.z;
  return {
    x: cam.x - b,
    y: cam.y - b,
    w: vw / cam.z + 2 * b,
    h: vh / cam.z + 2 * b,
  };
}

export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** A node is culled when its rect misses the (buffered) viewport. Callers
 * keep selected/editing/inking nodes un-culled by checking their ids first. */
export function nodeVisible(node: CanvasNode, view: WorldRect): boolean {
  return rectsIntersect(
    { x: node.x, y: node.y, w: node.width, h: node.height },
    view,
  );
}

/** An edge is culled when the bbox of both endpoint rects (plus a margin for
 * the bezier bulge) misses the viewport. Missing endpoints keep it visible -
 * broken edges must render broken, not vanish. */
export function edgeVisible(
  from: CanvasNode | undefined,
  to: CanvasNode | undefined,
  view: WorldRect,
): boolean {
  if (from === undefined || to === undefined) return true;
  const pad = 120;
  const minX = Math.min(from.x, to.x) - pad;
  const minY = Math.min(from.y, to.y) - pad;
  const maxX = Math.max(from.x + from.width, to.x + to.width) + pad;
  const maxY = Math.max(from.y + from.height, to.y + to.height) + pad;
  return rectsIntersect(
    { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    view,
  );
}
