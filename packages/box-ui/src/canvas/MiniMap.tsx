// SPDX-License-Identifier: LicenseRef-Proprietary
// MiniMap - board overview chip, bottom-right. Node rects scaled into a
// fixed tile; the camera viewport draws as an outline; click/drag pans.
// Standard canvas-app orientation aid (Figma/Miro), scaled way down.

import type { Board } from "@box/core";
import { useMemo, useRef } from "react";
import type { WorldRect } from "./cull.js";

export interface MiniMapProps {
  board: Board;
  viewRect: WorldRect;
  /** Called with the camera center to move to (world coords). */
  onNavigate: (x: number, y: number) => void;
}

const W = 200;
const H = 140;
const PAD = 8;

export function MiniMap(props: MiniMapProps) {
  const dragging = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const geom = useMemo(() => {
    const nodes = props.board.nodes;
    if (nodes.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      if (n.x < x0) x0 = n.x;
      if (n.y < y0) y0 = n.y;
      if (n.x + n.width > x1) x1 = n.x + n.width;
      if (n.y + n.height > y1) y1 = n.y + n.height;
    }
    // Pad the bounds so the viewport rect stays drawable at edges.
    const bw = Math.max(x1 - x0, 1);
    const bh = Math.max(y1 - y0, 1);
    const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh);
    const ox = (W - bw * scale) / 2 - x0 * scale;
    const oy = (H - bh * scale) / 2 - y0 * scale;
    return { scale, ox, oy };
  }, [props.board.nodes]);

  if (!geom) return null;
  const { scale, ox, oy } = geom;
  const vx = props.viewRect.x * scale + ox;
  const vy = props.viewRect.y * scale + oy;
  const vw = props.viewRect.w * scale;
  const vh = props.viewRect.h * scale;

  const toWorldCenter = (clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const wx = (mx - ox) / scale;
    const wy = (my - oy) / scale;
    // onNavigate takes the world point to center the view on.
    props.onNavigate(wx, wy);
  };

  return (
    <div
      ref={ref}
      className="minimap"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        toWorldCenter(e.clientX, e.clientY);
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        toWorldCenter(e.clientX, e.clientY);
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        try {
          (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
        } catch {
          // pointer capture already lost
        }
      }}
      onPointerCancel={() => (dragging.current = false)}
    >
      <svg width={W} height={H}>
        {props.board.nodes.map((n) => (
          <rect
            key={n.id}
            x={n.x * scale + ox}
            y={n.y * scale + oy}
            width={Math.max(n.width * scale, 1.5)}
            height={Math.max(n.height * scale, 1.5)}
            className="minimap-node"
          />
        ))}
        <rect
          x={vx}
          y={vy}
          width={Math.max(vw, 4)}
          height={Math.max(vh, 4)}
          className="minimap-view"
        />
      </svg>
    </div>
  );
}
