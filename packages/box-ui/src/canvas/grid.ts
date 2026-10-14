// SPDX-License-Identifier: LicenseRef-Proprietary
// Grid placement - deterministic row-major layout for "place all" from the
// Box holding area. Deterministic placement is required: reconcile and AI
// suggestions must never move placed objects (I-9), so placement writes only
// ever come from explicit user actions like this one.

export interface GridRect {
  x: number;
  y: number;
}

/**
 * Position for the `index`-th new node in a row-major grid. The grid starts
 * right of the existing nodes' bounding box (aligned to its top edge), or at
 * the origin on an empty board. ~5 columns per row keeps a scannable layout.
 */
export function gridPlaceRect(
  existing: readonly { x: number; y: number; width: number; height: number }[],
  index: number,
  w = 260,
  h = 200,
  gap = 40,
  cols = 5,
): GridRect {
  let startX = 0;
  let startY = 0;
  if (existing.length > 0) {
    let maxX = -Infinity;
    let minY = Infinity;
    for (const n of existing) {
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y < minY) minY = n.y;
    }
    startX = maxX + gap;
    startY = minY;
  }
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: startX + col * (w + gap), y: startY + row * (h + gap) };
}
