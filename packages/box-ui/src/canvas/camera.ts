// SPDX-License-Identifier: LicenseRef-Proprietary
// Camera math - pure functions, the renderer seam's foundation.
// Model: camera = { x, y, z } where (x, y) is the world-space point at the
// viewport's top-left corner and z is zoom. screen = (world - cam.xy) * z.
// Zoom clamp 0.1..5 mirrors the verified canvasSlice bounds (R-6).

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;
/** Fit-only floor: boards bigger than MIN_ZOOM can display still deserve a
 * real "zoom to fit" - interactive zoom stays clamped (R-6). */
export const FIT_MIN_ZOOM = 0.02;

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export function screenToWorld(
  cam: Camera,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: sx / cam.z + cam.x, y: sy / cam.z + cam.y };
}

export function worldToScreen(
  cam: Camera,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z };
}

/** Pan by a screen-space delta (drag: content follows the pointer). */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, x: cam.x - dxScreen / cam.z, y: cam.y - dyScreen / cam.z };
}

/** Zoom keeping the world point under (sx, sy) fixed on screen.
 * A camera already below MIN_ZOOM (set by zoom-to-fit on a huge board)
 * zooms smoothly between FIT_MIN_ZOOM and MAX instead of snapping to MIN. */
export function zoomAt(
  cam: Camera,
  sx: number,
  sy: number,
  factor: number,
  lo = MIN_ZOOM,
  hi = MAX_ZOOM,
): Camera {
  const floor = cam.z < lo ? FIT_MIN_ZOOM : lo;
  const z = clamp(cam.z * factor, floor, hi);
  if (z === cam.z) return cam;
  const w = screenToWorld(cam, sx, sy);
  return { x: w.x - sx / z, y: w.y - sy / z, z };
}

/** Fit a world-space rect into a viewport of (vw, vh) with padding. */
export function zoomToFit(
  rect: { x: number; y: number; w: number; h: number },
  vw: number,
  vh: number,
  padding = 64,
  hi = MAX_ZOOM,
): Camera {
  const z = clamp(
    Math.min((vw - padding * 2) / rect.w, (vh - padding * 2) / rect.h),
    FIT_MIN_ZOOM,
    hi,
  );
  return {
    x: rect.x + rect.w / 2 - vw / (2 * z),
    y: rect.y + rect.h / 2 - vh / (2 * z),
    z,
  };
}
