// SPDX-License-Identifier: LicenseRef-Proprietary
// Ink helpers - pointer points -> pressure outline (perfect-freehand) ->
// the filled-polygon `d` our .ink.svg sidecar stores (DATA-MODEL §2.3,
// ink.ts serializeInkSvg emits fill+stroke=none). Eraser hit-tests the
// stored polygon in JS so it works without a DOM.

import { getStroke } from "perfect-freehand";

export interface InkPoint {
  x: number;
  y: number;
  /** PointerEvent.pressure: 0.5 for a held mouse button, real values for pens. */
  p: number;
}

/** Live draft or committed stroke: points -> filled outline path `d`. */
export function strokeToPath(points: readonly InkPoint[], size = 10): string {
  if (points.length === 0) return "";
  // A single point makes a dot - getStroke handles 1-2 point inputs fine.
  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.p] as [number, number, number]),
    {
      size,
      thinning: 0.55,
      smoothing: 0.6,
      streamline: 0.45,
      last: true,
    },
  );
  if (outline.length === 0) return "";
  const seg = outline
    .map(([x, y]) => `${(x ?? 0).toFixed(1)} ${(y ?? 0).toFixed(1)}`)
    .join(" L ");
  return `M ${seg} Z`;
}

/**
 * Parse the polygon our own emitter writes (`M x y L x y ... Z`). Foreign
 * `d` (bezier etc.) returns null - caller falls back to DOM hit-testing.
 */
export function pathToPolygon(d: string): [number, number][] | null {
  // Strip numbers; anything left besides M/L/Z, whitespace, separators, or
  // minus signs means bezier/arc/etc. - not a plain polygon.
  if (!/^[\sMLZmlz,.-]*$/.test(d.replace(/-?\d+(?:\.\d+)?/g, ""))) return null;
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 4 || nums.length % 2 !== 0) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

/** Even-odd point-in-polygon against the stored stroke outline. */
export function pointInPolygon(
  x: number,
  y: number,
  poly: readonly [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
