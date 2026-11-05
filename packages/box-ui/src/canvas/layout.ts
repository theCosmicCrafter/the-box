// SPDX-License-Identifier: LicenseRef-Proprietary
// Canvas layout tools - alignment, distribution, and tidy grid.
// DATA-MODEL §2 / Invariant I-9 compliant: all calculations are pure functions;
// positions are only applied through explicit user invocations.

export type AlignType =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

export interface NodeLayoutItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [extra: string]: unknown;
}

/**
 * Align selected nodes relative to their collective bounding box.
 * If fewer than 2 nodes are selected, returns nodes unmodified.
 */
export function alignNodes<T extends NodeLayoutItem>(
  nodes: readonly T[],
  ids: readonly string[] | ReadonlySet<string>,
  type: AlignType,
): T[] {
  const targetIds = ids instanceof Set ? ids : new Set(ids);
  if (targetIds.size < 2) return [...nodes];

  const selected = nodes.filter((n) => targetIds.has(n.id));
  if (selected.length < 2) return [...nodes];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of selected) {
    if (n.x < minX) minX = n.x;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y < minY) minY = n.y;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const midX = Math.round((minX + maxX) / 2);
  const midY = Math.round((minY + maxY) / 2);

  return nodes.map((n) => {
    if (!targetIds.has(n.id)) return n;
    let nextX = n.x;
    let nextY = n.y;

    switch (type) {
      case "left":
        nextX = minX;
        break;
      case "centerX":
        nextX = Math.round(midX - n.width / 2);
        break;
      case "right":
        nextX = maxX - n.width;
        break;
      case "top":
        nextY = minY;
        break;
      case "centerY":
        nextY = Math.round(midY - n.height / 2);
        break;
      case "bottom":
        nextY = maxY - n.height;
        break;
    }

    return { ...n, x: nextX, y: nextY };
  });
}

/**
 * Distribute selected nodes evenly along the given axis between the first
 * and last items. Requires at least 3 nodes to have effect on interior items.
 */
export function distributeNodes<T extends NodeLayoutItem>(
  nodes: readonly T[],
  ids: readonly string[] | ReadonlySet<string>,
  axis: DistributeAxis,
): T[] {
  const targetIds = ids instanceof Set ? ids : new Set(ids);
  if (targetIds.size < 3) return [...nodes];

  const selected = nodes.filter((n) => targetIds.has(n.id));
  if (selected.length < 3) return [...nodes];

  const posMap = new Map<string, { x: number; y: number }>();

  if (axis === "horizontal") {
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;

    let interiorWidth = 0;
    for (let i = 1; i < sorted.length - 1; i++) {
      interiorWidth += sorted[i]!.width;
    }

    const totalSpan = last.x - (first.x + first.width);
    const availableGap = totalSpan - interiorWidth;
    const gap = availableGap / (sorted.length - 1);

    let currentOffset = 0;
    for (let i = 1; i < sorted.length - 1; i++) {
      const node = sorted[i]!;
      const targetX = Math.round(
        first.x + first.width + i * gap + currentOffset,
      );
      posMap.set(node.id, { x: targetX, y: node.y });
      currentOffset += node.width;
    }
  } else {
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;

    let interiorHeight = 0;
    for (let i = 1; i < sorted.length - 1; i++) {
      interiorHeight += sorted[i]!.height;
    }

    const totalSpan = last.y - (first.y + first.height);
    const availableGap = totalSpan - interiorHeight;
    const gap = availableGap / (sorted.length - 1);

    let currentOffset = 0;
    for (let i = 1; i < sorted.length - 1; i++) {
      const node = sorted[i]!;
      const targetY = Math.round(
        first.y + first.height + i * gap + currentOffset,
      );
      posMap.set(node.id, { x: node.x, y: targetY });
      currentOffset += node.height;
    }
  }

  return nodes.map((n) => {
    const pos = posMap.get(n.id);
    if (!pos) return n;
    return { ...n, x: pos.x, y: pos.y };
  });
}

/**
 * Tidy selected nodes into a multi-column grid starting at the top-left
 * bounding box of the current selection.
 */
export function tidyGrid<T extends NodeLayoutItem>(
  nodes: readonly T[],
  ids: readonly string[] | ReadonlySet<string>,
  gap = 40,
  columns?: number,
): T[] {
  const targetIds = ids instanceof Set ? ids : new Set(ids);
  if (targetIds.size < 2) return [...nodes];

  const selected = nodes.filter((n) => targetIds.has(n.id));
  if (selected.length < 2) return [...nodes];

  let minX = Infinity;
  let minY = Infinity;
  for (const n of selected) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
  }

  // Sort primarily top-to-bottom, secondarily left-to-right (reading order).
  const sorted = [...selected].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 30) return a.y - b.y;
    return a.x - b.x;
  });

  const cols = Math.max(
    1,
    columns ?? Math.ceil(Math.sqrt(sorted.length)),
  );
  const rows = Math.ceil(sorted.length / cols);

  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);

  for (let i = 0; i < sorted.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const n = sorted[i]!;
    const currentW = colWidths[c] ?? 0;
    const currentH = rowHeights[r] ?? 0;
    if (n.width > currentW) colWidths[c] = n.width;
    if (n.height > currentH) rowHeights[r] = n.height;
  }

  const colX = new Array<number>(cols).fill(0);
  colX[0] = minX;
  for (let c = 1; c < cols; c++) {
    colX[c] = (colX[c - 1] ?? minX) + (colWidths[c - 1] ?? 0) + gap;
  }

  const rowY = new Array<number>(rows).fill(0);
  rowY[0] = minY;
  for (let r = 1; r < rows; r++) {
    rowY[r] = (rowY[r - 1] ?? minY) + (rowHeights[r - 1] ?? 0) + gap;
  }

  const posMap = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < sorted.length; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const targetX = colX[c] ?? minX;
    const targetY = rowY[r] ?? minY;
    posMap.set(sorted[i]!.id, { x: targetX, y: targetY });
  }

  return nodes.map((n) => {
    const pos = posMap.get(n.id);
    if (!pos) return n;
    return { ...n, x: pos.x, y: pos.y };
  });
}
