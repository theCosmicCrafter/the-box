// SPDX-License-Identifier: LicenseRef-Proprietary
// EdgeLayer - SVG edge rendering in world space (inside the transformed
// world container, so edges share the DOM transform for free).
// Geometry per DATA-MODEL + Heptabase findings: endpoint sides default
// right->left, bezier control points extend along side normals, arrowheads
// per fromEnd/toEnd. Dangling endpoints render as dashed stubs (I-7).
// Edges are clickable (fat invisible hit-path) for select+delete; a `draft`
// prop renders the live preview while a connection is being drawn.

import type { Board, CanvasEdge, CanvasNode, Side } from "@box/core";
import { edgeVisible, type WorldRect } from "./cull.js";

export const NORMALS: Record<Side, { nx: number; ny: number }> = {
  top: { nx: 0, ny: -1 },
  right: { nx: 1, ny: 0 },
  bottom: { nx: 0, ny: 1 },
  left: { nx: -1, ny: 0 },
};

export function anchor(node: CanvasNode, side: Side) {
  const n = NORMALS[side];
  return {
    x: node.x + node.width / 2 + (n.nx * node.width) / 2,
    y: node.y + node.height / 2 + (n.ny * node.height) / 2,
    ...n,
  };
}

/** Cubic bezier control points between two anchored endpoints. */
export function edgePoints(
  a1: { x: number; y: number; nx: number; ny: number },
  a2: { x: number; y: number; nx: number; ny: number },
) {
  const bend = Math.max(60, Math.hypot(a2.x - a1.x, a2.y - a1.y) * 0.35);
  return {
    p0: { x: a1.x, y: a1.y },
    c1: { x: a1.x + a1.nx * bend, y: a1.y + a1.ny * bend },
    c2: { x: a2.x + a2.nx * bend, y: a2.y + a2.ny * bend },
    p3: { x: a2.x, y: a2.y },
  };
}

/** Cubic bezier between two anchored endpoints. */
export function edgePathD(
  a1: { x: number; y: number; nx: number; ny: number },
  a2: { x: number; y: number; nx: number; ny: number },
): string {
  const p = edgePoints(a1, a2);
  return `M ${p.p0.x} ${p.p0.y} C ${p.c1.x} ${p.c1.y}, ${p.c2.x} ${p.c2.y}, ${p.p3.x} ${p.p3.y}`;
}

/** Bezier midpoint (t=0.5) - where edge labels sit. */
export function edgeMidpoint(
  a1: { x: number; y: number; nx: number; ny: number },
  a2: { x: number; y: number; nx: number; ny: number },
) {
  const p = edgePoints(a1, a2);
  return {
    x: (p.p0.x + 3 * p.c1.x + 3 * p.c2.x + p.p3.x) / 8,
    y: (p.p0.y + 3 * p.c1.y + 3 * p.c2.y + p.p3.y) / 8,
  };
}

export interface DraftEdge {
  from: { x: number; y: number; nx: number; ny: number };
  to: { x: number; y: number; nx: number; ny: number };
  overTarget: boolean;
}

export interface EdgeLayerProps {
  board: Board;
  brokenEdges: Set<string>;
  selectedId?: string | null;
  dimmedEdges?: Set<string> | undefined;
  onSelect?: (edgeId: string | null) => void;
  draft?: DraftEdge | null;
  /** World-space viewport rect; off-view edges get display:none (culled). */
  viewRect?: WorldRect | undefined;
  /** Camera zoom; hit-paths are disabled below MIN_INTERACT_ZOOM. */
  zoom?: number | undefined;
}

/** Below this zoom, edges are too dense to click selectively; hit-paths and
    endpoint handles are not rendered. */
export const MIN_INTERACT_ZOOM = 0.08;

export function EdgeLayer({
  board,
  brokenEdges,
  selectedId,
  dimmedEdges,
  onSelect,
  draft,
  viewRect,
  zoom,
}: EdgeLayerProps) {
  const interactive = zoom === undefined || zoom >= MIN_INTERACT_ZOOM;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));

  const paths = board.edges.flatMap((e: CanvasEdge) => {
    const from = byId.get(e.fromNode);
    const to = byId.get(e.toNode);
    if (!from && !to) return []; // both gone - surfaced via brokenEdges, no geometry exists
    if (
      viewRect !== undefined &&
      e.id !== selectedId &&
      !edgeVisible(from, to, viewRect)
    )
      return [];
    const a1 = from ? anchor(from, e.fromSide ?? "right") : null;
    const a2 = to ? anchor(to, e.toSide ?? "left") : null;
    const broken = brokenEdges.has(e.id) || !from || !to;
    // Stub: extend the surviving anchor 60px along its outward normal.
    const start = a1 ?? {
      x: a2!.x - 60 * a2!.nx,
      y: a2!.y - 60 * a2!.ny,
      nx: a2!.nx,
      ny: a2!.ny,
    };
    const end = a2 ?? {
      x: a1!.x + 60 * a1!.nx,
      y: a1!.y + 60 * a1!.ny,
      nx: a1!.nx,
      ny: a1!.ny,
    };
    return [
      {
        e,
        d: edgePathD(start, end),
        mid: edgeMidpoint(start, end),
        broken,
      },
    ];
  });

  const marker = (end: CanvasEdge["fromEnd"], broken: boolean) =>
    end === "arrow" ? `url(#arrowhead${broken ? "-broken" : ""})` : undefined;

  return (
    <svg
      className="edge-layer"
      data-count={paths.length}
      viewBox="-1000000 -1000000 2000000 2000000"
    >
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow" />
        </marker>
        <marker
          id="arrowhead-broken"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow broken" />
        </marker>
      </defs>
      {paths.map(({ e, d, mid, broken }) => {
        const isDimmed = dimmedEdges?.has(e.id) ?? false;
        return (
          <g key={e.id}>
            <path
              d={d}
              className={`edge ${broken ? "broken" : ""} ${selectedId === e.id ? "selected" : ""} ${isDimmed ? "edge-dimmed" : ""}`}
              markerStart={marker(e.fromEnd, broken)}
              markerEnd={marker(e.toEnd, broken)}
            />
            {onSelect !== undefined && interactive && (
              <path
                d={d}
                className="edge-hit"
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onSelect(e.id);
                }}
              />
            )}
            {typeof e.label === "string" && e.label !== "" && (
              <text
                className={`edge-label ${selectedId === e.id ? "selected" : ""} ${isDimmed ? "edge-dimmed" : ""}`}
                x={mid.x}
                y={mid.y}
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {draft && (
        <path
          d={edgePathD(draft.from, draft.to)}
          className={`edge draft ${draft.overTarget ? "over" : ""}`}
        />
      )}
    </svg>
  );
}

export interface EdgeHandlesProps {
  board: Board;
  selectedId: string | null;
  zoom?: number | undefined;
  onRetargetStart: (
    edgeId: string,
    end: "from" | "to",
    clientX: number,
    clientY: number,
  ) => void;
}

/** Endpoint handles for the selected edge. Rendered in a separate svg AFTER
    the node DOM so the handles sit above nodes - the anchor point is on a
    node's border, so circles inside EdgeLayer are covered by the node and
    can never be grabbed. */
export function EdgeHandles({
  board,
  selectedId,
  zoom,
  onRetargetStart,
}: EdgeHandlesProps) {
  const interactive = zoom === undefined || zoom >= MIN_INTERACT_ZOOM;
  const endR = zoom !== undefined && zoom > 0 ? 8 / zoom : 8;
  const e = board.edges.find((x) => x.id === selectedId);
  if (e === undefined || !interactive) return null;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const from = byId.get(e.fromNode);
  const to = byId.get(e.toNode);
  if (!from && !to) return null; // both gone - surfaced via brokenEdges, no geometry exists
  const rawA1 = from ? anchor(from, e.fromSide ?? "right") : null;
  const rawA2 = to ? anchor(to, e.toSide ?? "left") : null;
  const a1 = rawA1 ?? {
    x: rawA2!.x - 60 * rawA2!.nx,
    y: rawA2!.y - 60 * rawA2!.ny,
    nx: rawA2!.nx,
    ny: rawA2!.ny,
  };
  const a2 = rawA2 ?? {
    x: rawA1!.x + 60 * rawA1!.nx,
    y: rawA1!.y + 60 * rawA1!.ny,
    nx: rawA1!.nx,
    ny: rawA1!.ny,
  };
  return (
    <svg className="edge-handles" viewBox="-1000000 -1000000 2000000 2000000">
      <circle
        className={`edge-endpoint ${!from ? "broken" : ""}`}
        cx={a1.x}
        cy={a1.y}
        r={endR}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          onRetargetStart(e.id, "from", ev.clientX, ev.clientY);
        }}
      />
      <circle
        className={`edge-endpoint ${!to ? "broken" : ""}`}
        cx={a2.x}
        cy={a2.y}
        r={endR}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          onRetargetStart(e.id, "to", ev.clientX, ev.clientY);
        }}
      />
    </svg>
  );
}
