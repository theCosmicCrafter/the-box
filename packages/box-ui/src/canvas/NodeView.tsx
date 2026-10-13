// SPDX-License-Identifier: LicenseRef-Proprietary
// NodeView - per-kind DOM renderer + drag/select + edge-draft handles.
// Pointer math runs in world space via the camera prop, so nodes move
// correctly at any zoom. Broken file nodes keep geometry and render
// visibly broken (I-7). Side handles appear on hover/selected (tldraw
// pattern): drag from one to start a connection draft.

import type { CanvasNode, Side } from "@box/core";
import { baseName } from "@box/core";
import { useRef } from "react";
import type { Camera } from "./camera.js";
import { screenToWorld } from "./camera.js";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const HANDLE_POS: Record<Side, React.CSSProperties> = {
  top: { left: "50%", top: 0 },
  right: { left: "100%", top: "50%" },
  bottom: { left: "50%", top: "100%" },
  left: { left: 0, top: "50%" },
};

export interface NodeViewProps {
  node: CanvasNode;
  camera: Camera;
  selected: boolean;
  broken: boolean;
  dropTarget?: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onCommit: () => void;
  onDraftStart?: (nodeId: string, side: Side) => void;
  onDraftMove?: (wx: number, wy: number) => void;
  onDraftEnd?: (wx: number, wy: number) => void;
}

function label(n: CanvasNode): string {
  switch (n.type) {
    case "text":
      return n.text.length > 240 ? `${n.text.slice(0, 240)}…` : n.text;
    case "file":
      return baseName(n.file);
    case "link":
      return n.url;
    case "group":
      return n.label ?? "";
  }
}

export function NodeView(props: NodeViewProps) {
  const { node, camera } = props;
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // node drags must not become viewport pans
    drag.current = { px: e.clientX, py: e.clientY, ox: node.x, oy: node.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onSelect(node.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const a = screenToWorld(camera, 0, 0);
    const b = screenToWorld(
      camera,
      e.clientX - drag.current.px,
      e.clientY - drag.current.py,
    );
    props.onMove(
      node.id,
      Math.round(drag.current.ox + b.x - a.x),
      Math.round(drag.current.oy + b.y - a.y),
    );
  };

  const onPointerUp = () => {
    if (drag.current) {
      drag.current = null;
      props.onCommit();
    }
  };

  const worldOf = (e: React.PointerEvent) => {
    const vp = (e.currentTarget as Element).closest(".canvas-viewport");
    const r = vp?.getBoundingClientRect();
    return screenToWorld(
      camera,
      e.clientX - (r?.left ?? 0),
      e.clientY - (r?.top ?? 0),
    );
  };

  const handleDown = (side: Side) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onDraftStart?.(node.id, side);
  };
  const handleMove = (e: React.PointerEvent) => {
    const w = worldOf(e);
    props.onDraftMove?.(w.x, w.y);
  };
  const handleUp = (e: React.PointerEvent) => {
    const w = worldOf(e);
    props.onDraftEnd?.(w.x, w.y);
  };

  const cls = [
    "node",
    `node-${node.type}`,
    props.selected ? "selected" : "",
    props.broken ? "broken" : "",
    props.dropTarget ? "drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      data-node-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      {node.type === "file" && <span className="node-kind">file</span>}
      {props.broken && <span className="node-flag">missing</span>}
      <div className="node-label">{label(node)}</div>
      {SIDES.map((side) => (
        <div
          key={side}
          className="node-handle"
          data-side={side}
          style={HANDLE_POS[side]}
          onPointerDown={handleDown(side)}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        />
      ))}
    </div>
  );
}
