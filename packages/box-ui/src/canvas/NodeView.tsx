// SPDX-License-Identifier: LicenseRef-Proprietary
// NodeView - per-kind DOM renderer + drag/select + edge-draft handles.
// File nodes render real content: images via a resolveMedia callback
// (desktop wires it to the box:// protocol), text/markdown via excerpt.
// Text nodes edit in place on double-click. Selected nodes get a resize
// handle (bottom-right). Broken file nodes keep geometry and render
// visibly broken (I-7). Side handles appear on hover/selected (tldraw
// pattern): drag from one to start a connection draft.

import type { CanvasNode, Side } from "@box/core";
import { baseName } from "@box/core";
import { useEffect, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { screenToWorld } from "./camera.js";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const HANDLE_POS: Record<Side, React.CSSProperties> = {
  top: { left: "50%", top: 0 },
  right: { left: "100%", top: "50%" },
  bottom: { left: "50%", top: "100%" },
  left: { left: 0, top: "50%" },
};

const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|tiff?)$/i;
const TEXT_RE = /\.(md|txt)$/i;
const MIN_NODE = 40;

export interface NodeViewProps {
  node: CanvasNode;
  camera: Camera;
  selected: boolean;
  broken: boolean;
  dropTarget?: boolean;
  /** Resolves a workspace-relative file path to a displayable URL. */
  resolveMedia?: ((rel: string) => string) | undefined;
  /** Text excerpt for document file nodes (loaded by the platform). */
  excerpt?: string | undefined;
  /** Text-node edit mode (controlled by the platform for new nodes). */
  editing?: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onCommit: () => void;
  onTextCommit?: (id: string, text: string) => void;
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
  const resize = useRef<{
    w: number;
    h: number;
    sx: number;
    sy: number;
  } | null>(null);
  const [selfEditing, setSelfEditing] = useState(false);
  const editing = selfEditing || props.editing === true;
  const [draftText, setDraftText] = useState(
    node.type === "text" ? node.text : "",
  );

  useEffect(() => {
    if (props.editing === true && node.type === "text") setDraftText(node.text);
  }, [props.editing, node]);

  const commitText = (text: string) => {
    setSelfEditing(false);
    props.onTextCommit?.(node.id, text);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
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

  const resizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = worldOf(e);
    resize.current = { w: node.width, h: node.height, sx: w.x, sy: w.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const resizeMove = (e: React.PointerEvent) => {
    if (!resize.current) return;
    const w = worldOf(e);
    props.onResize?.(
      node.id,
      Math.max(
        MIN_NODE,
        Math.round(resize.current.w + w.x - resize.current.sx),
      ),
      Math.max(
        MIN_NODE,
        Math.round(resize.current.h + w.y - resize.current.sy),
      ),
    );
  };
  const resizeUp = () => {
    if (resize.current) {
      resize.current = null;
      props.onCommit();
    }
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

  const isImage =
    node.type === "file" &&
    (node["box-media"]?.kind === "image" || IMAGE_RE.test(node.file));
  const isDoc = node.type === "file" && TEXT_RE.test(node.file);

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
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (node.type === "text") setSelfEditing(true);
      }}
    >
      {node.type === "file" && <span className="node-kind">file</span>}
      {props.broken && <span className="node-flag">missing</span>}
      {isImage && props.resolveMedia ? (
        <>
          <img
            className="node-media"
            src={props.resolveMedia(node.file)}
            alt={baseName(node.file)}
            draggable={false}
          />
          <div className="node-caption">{baseName(node.file)}</div>
        </>
      ) : isDoc && props.excerpt !== undefined ? (
        <>
          <div className="node-excerpt">{props.excerpt}</div>
          <div className="node-caption">{baseName(node.file)}</div>
        </>
      ) : node.type === "text" && editing ? (
        <textarea
          className="node-edit"
          autoFocus
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => commitText(draftText)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
              commitText(draftText);
            if (e.key === "Escape") setSelfEditing(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="node-label">{label(node)}</div>
      )}
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
      {props.selected && (
        <div
          className="node-resize"
          onPointerDown={resizeDown}
          onPointerMove={resizeMove}
          onPointerUp={resizeUp}
        />
      )}
    </div>
  );
}
