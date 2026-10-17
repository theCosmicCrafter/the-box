// SPDX-License-Identifier: LicenseRef-Proprietary
// Viewport - the renderer seam. Owns camera state and pointer gestures.
// Children render in world space inside a transformed layer, so DOM nodes
// and SVG overlays share one coordinate system for free.
// Interaction model mimics tldraw (ADR-0004): wheel pans, ctrl/cmd+wheel
// zooms to cursor, middle-drag or space+drag pans, left-drag on empty
// canvas pans. Patterns studied, no code copied.

import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { DEFAULT_CAMERA, panBy, screenToWorld, zoomAt } from "./camera.js";

export interface ViewportProps {
  camera?: Camera;
  onCameraChange?: (cam: Camera) => void;
  onBackgroundClick?: (() => void) | undefined;
  /** File dropped from the workspace list, at world coordinates. */
  onDropFile?: ((path: string, wx: number, wy: number) => void) | undefined;
  /** Double-click on empty canvas, at world coordinates. */
  onEmptyDoubleClick?: ((wx: number, wy: number) => void) | undefined;
  /** Right-click on empty canvas: world coords + client coords (menus). */
  onBackgroundMenu?:
    ((wx: number, wy: number, cx: number, cy: number) => void) | undefined;
  /** Left-drag on empty canvas draws a marquee (tldraw/Obsidian model).
   *  Reports the world-space rect each move and on release. */
  onMarquee?:
    | ((
        rect: { x: number; y: number; w: number; h: number },
        phase: "move" | "end",
        additive: boolean,
      ) => void)
    | undefined;
  /** Screen-space overlay rendered above the world layer (minimap, HUD). */
  overlay?: ReactNode;
  children: ReactNode;
  viewportRef?: RefObject<HTMLDivElement | null>;
  className?: string | undefined;
}

export function Viewport(props: ViewportProps) {
  const [innerCam, setInnerCam] = useState<Camera>(DEFAULT_CAMERA);
  const cam = props.camera ?? innerCam;
  const setCam = useCallback(
    (next: Camera) => {
      if (props.onCameraChange) props.onCameraChange(next);
      else setInnerCam(next);
    },
    [props],
  );

  const ref = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  const panState = useRef<{ px: number; py: number } | null>(null);
  const moved = useRef(false);
  // Gesture events can fire faster than React commits (trackpad pinch
  // bursts). camRef accumulates between renders so no event is dropped;
  // it re-syncs to the committed camera on every render.
  const camRef = useRef(cam);
  camRef.current = cam;
  const applyCam = useCallback(
    (next: Camera) => {
      camRef.current = next;
      setCam(next);
    },
    [setCam],
  );

  // Wheel must be non-passive to preventDefault (pinch-zoom browser nav).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        applyCam(
          zoomAt(
            camRef.current,
            e.clientX - r.left,
            e.clientY - r.top,
            Math.exp(-e.deltaY * 0.002),
          ),
        );
      } else {
        applyCam(panBy(camRef.current, e.deltaX, e.deltaY));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyCam]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const [marquee, setMarquee] = useState<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    additive: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      panState.current = { px: e.clientX, py: e.clientY };
      moved.current = false;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else if (e.button === 0 && e.target === e.currentTarget) {
      // Left-drag on empty canvas = marquee select (tldraw/Obsidian);
      // if no marquee handler is wired it falls back to a pan.
      if (props.onMarquee) {
        const r = ref.current?.getBoundingClientRect();
        const sx = e.clientX - (r?.left ?? 0);
        const sy = e.clientY - (r?.top ?? 0);
        setMarquee({ sx, sy, cx: sx, cy: sy, additive: e.shiftKey });
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
      } else {
        panState.current = { px: e.clientX, py: e.clientY };
        moved.current = false;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (marquee) {
      const r = ref.current?.getBoundingClientRect();
      const cx = e.clientX - (r?.left ?? 0);
      const cy = e.clientY - (r?.top ?? 0);
      setMarquee({ ...marquee, cx, cy });
      const a = screenToWorld(camRef.current, marquee.sx, marquee.sy);
      const b = screenToWorld(camRef.current, cx, cy);
      props.onMarquee?.(
        {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x),
          h: Math.abs(b.y - a.y),
        },
        "move",
        marquee.additive,
      );
      return;
    }
    if (!panState.current) return;
    const dx = e.clientX - panState.current.px;
    const dy = e.clientY - panState.current.py;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    applyCam(panBy(camRef.current, dx, dy));
    panState.current = { px: e.clientX, py: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (marquee) {
      const a = screenToWorld(camRef.current, marquee.sx, marquee.sy);
      const b = screenToWorld(camRef.current, marquee.cx, marquee.cy);
      props.onMarquee?.(
        {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x),
          h: Math.abs(b.y - a.y),
        },
        "end",
        marquee.additive,
      );
      const wasClick =
        Math.abs(marquee.cx - marquee.sx) + Math.abs(marquee.cy - marquee.sy) <
        4;
      setMarquee(null);
      if (wasClick) props.onBackgroundClick?.();
      return;
    }
    if (panState.current && !moved.current && e.button === 0) {
      props.onBackgroundClick?.();
    }
    panState.current = null;
  };

  const worldAt = (clientX: number, clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    return screenToWorld(
      cam,
      clientX - (r?.left ?? 0),
      clientY - (r?.top ?? 0),
    );
  };

  const onDrop = (e: React.DragEvent) => {
    const path = e.dataTransfer.getData("application/x-box-file");
    if (path === "") return;
    e.preventDefault();
    const w = worldAt(e.clientX, e.clientY);
    props.onDropFile?.(path, Math.round(w.x), Math.round(w.y));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const w = worldAt(e.clientX, e.clientY);
    props.onEmptyDoubleClick?.(Math.round(w.x), Math.round(w.y));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    // Nodes handle their own menus (they stopPropagation). Anything else
    // on the surface - empty canvas, edge lines - opens the canvas menu.
    if ((e.target as HTMLElement).closest?.("[data-node-id]")) return;
    e.preventDefault();
    const w = worldAt(e.clientX, e.clientY);
    props.onBackgroundMenu?.(
      Math.round(w.x),
      Math.round(w.y),
      e.clientX,
      e.clientY,
    );
  };

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (props.viewportRef && el) props.viewportRef.current = el;
      }}
      className={`canvas-viewport ${props.className ?? ""}`}
      style={{
        backgroundPosition: `${-cam.x * cam.z}px ${-cam.y * cam.z}px`,
        backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (panState.current = null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${-cam.x * cam.z}px, ${-cam.y * cam.z}px) scale(${cam.z})`,
          transformOrigin: "0 0",
        }}
      >
        {props.children}
      </div>
      {props.overlay}
      {marquee && (
        <div
          className="marquee-rect"
          style={{
            left: Math.min(marquee.sx, marquee.cx),
            top: Math.min(marquee.sy, marquee.cy),
            width: Math.abs(marquee.cx - marquee.sx),
            height: Math.abs(marquee.cy - marquee.sy),
          }}
        />
      )}
    </div>
  );
}
