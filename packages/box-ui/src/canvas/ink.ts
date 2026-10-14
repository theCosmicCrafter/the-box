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

/**
 * Translate every coordinate pair in a polygon `d` by (dx, dy). Returns null
 * for non-polygon paths (bezier/arc) - caller refuses the move rather than
 * corrupting foreign path data.
 */
export function translatePath(
  d: string,
  dx: number,
  dy: number,
): string | null {
  const poly = pathToPolygon(d);
  if (poly === null) return null;
  const seg = poly
    .map(([x, y]) => `${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`)
    .join(" L ");
  return `M ${seg} Z`;
}

/** Bounding box of a polygon `d`, or null for unparseable/foreign paths. */
export function pathBounds(
  d: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const poly = pathToPolygon(d);
  if (poly === null || poly.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Distance from (px,py) to a stroke's filled outline: 0 when inside,
 * else the distance to the nearest polygon edge. Returns Infinity for
 * foreign (non-polygon) paths. Stroke picking uses this - a user clicking
 * near a thin ribbon means "that stroke", not strict interior
 * (tldraw picks by distance to the centerline the same way).
 */
export function distToStroke(px: number, py: number, d: string): number {
  const poly = pathToPolygon(d);
  if (poly === null || poly.length === 0) return Infinity;
  if (pointInPolygon(px, py, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j]!;
    const [x2, y2] = poly[i]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const ex = x1 + t * dx - px;
    const ey = y1 + t * dy - py;
    const dist = ex * ex + ey * ey;
    if (dist < best) best = dist;
  }
  return Math.sqrt(best);
}

/** Pick the topmost stroke within `tol` px of the point - returns the
 * stroke index or -1. Topmost = last in the array wins ties. */
export function pickStroke(
  strokes: readonly { d: string }[],
  x: number,
  y: number,
  tol = 12,
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const d = distToStroke(x, y, strokes[i]!.d);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
    if (d === 0) break; // inside: nothing beats containment
  }
  return bestDist <= tol ? bestIdx : -1;
}
