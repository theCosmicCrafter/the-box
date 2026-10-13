// SPDX-License-Identifier: LicenseRef-Proprietary
// EdgeLayer - SVG edge rendering in world space (inside the transformed
// world container, so edges share the DOM transform for free).
// Geometry per DATA-MODEL + Heptabase findings: endpoint sides default
// right->left, bezier control points extend along side normals, arrowheads
// per fromEnd/toEnd. Dangling endpoints render as dashed stubs (I-7):
// preserved visibly, never silently dropped.

import type { Board, CanvasEdge, CanvasNode, Side } from '@box/core';

const NORMALS: Record<Side, { nx: number; ny: number }> = {
  top: { nx: 0, ny: -1 },
  right: { nx: 1, ny: 0 },
  bottom: { nx: 0, ny: 1 },
  left: { nx: -1, ny: 0 },
};

function anchor(node: CanvasNode, side: Side) {
  const n = NORMALS[side];
  return {
    x: node.x + node.width / 2 + (n.nx * node.width) / 2,
    y: node.y + node.height / 2 + (n.ny * node.height) / 2,
    ...n,
  };
}

export interface EdgeLayerProps {
  board: Board;
  brokenEdges: Set<string>; // edge ids with a missing endpoint node
}

export function EdgeLayer({ board, brokenEdges }: EdgeLayerProps) {
  const byId = new Map(board.nodes.map((n) => [n.id, n]));

  const paths = board.edges.flatMap((e: CanvasEdge) => {
    const from = byId.get(e.fromNode);
    const to = byId.get(e.toNode);
    if (!from && !to) return []; // both gone - surfaced via brokenEdges list, no geometry exists
    const a1 = from ? anchor(from, e.fromSide ?? 'right') : null;
    const a2 = to ? anchor(to, e.toSide ?? 'left') : null;
    const broken = brokenEdges.has(e.id) || !from || !to;
    // Stub: extend the surviving anchor 60px along its outward normal.
    const start = a1 ?? { x: a2!.x - 60 * a2!.nx, y: a2!.y - 60 * a2!.ny, nx: a2!.nx, ny: a2!.ny };
    const end = a2 ?? { x: a1!.x + 60 * a1!.nx, y: a1!.y + 60 * a1!.ny, nx: a1!.nx, ny: a1!.ny };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const bend = Math.max(60, dist * 0.35);
    const d = `M ${start.x} ${start.y} C ${start.x + start.nx * bend} ${start.y + start.ny * bend}, ${end.x + end.nx * bend} ${end.y + end.ny * bend}, ${end.x} ${end.y}`;
    return [{ e, d, broken }];
  });

  return (
    <svg className="edge-layer" data-count={paths.length}>
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow" />
        </marker>
        <marker id="arrowhead-broken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow broken" />
        </marker>
      </defs>
      {paths.map(({ e, d, broken }) => (
        <path
          key={e.id}
          d={d}
          className={`edge ${broken ? 'broken' : ''}`}
          markerStart={e.fromEnd === 'arrow' ? `url(#arrowhead${broken ? '-broken' : ''})` : undefined}
          markerEnd={e.toEnd === 'arrow' ? `url(#arrowhead${broken ? '-broken' : ''})` : undefined}
        />
      ))}
    </svg>
  );
}
