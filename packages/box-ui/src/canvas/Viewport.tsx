// SPDX-License-Identifier: LicenseRef-Proprietary
// Viewport - the renderer seam. Owns camera state and pointer gestures.
// Children render in world space inside a transformed layer, so DOM nodes
// and SVG overlays share one coordinate system for free.
// Interaction model mimics tldraw (ADR-0004): wheel pans, ctrl/cmd+wheel
// zooms to cursor, middle-drag or space+drag pans, left-drag on empty
// canvas pans. Patterns studied, no code copied.

import type { ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera } from './camera.js';
import { DEFAULT_CAMERA, panBy, zoomAt } from './camera.js';

export interface ViewportProps {
  camera?: Camera;
  onCameraChange?: (cam: Camera) => void;
  onBackgroundClick?: () => void;
  children: ReactNode;
  viewportRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}

export function Viewport(props: ViewportProps) {
  const [innerCam, setInnerCam] = useState<Camera>(DEFAULT_CAMERA);
  const cam = props.camera ?? innerCam;
  const setCam = useCallback(
    (next: Camera) => {
      if (props.onCameraChange) props.onCameraChange(next);
      else setInnerCam(next);
    },
    [props]
  );

  const ref = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  const panState = useRef<{ px: number; py: number } | null>(null);
  const moved = useRef(false);

  // Wheel must be non-passive to preventDefault (pinch-zoom browser nav).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        setCam(zoomAt(cam, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.002)));
      } else {
        setCam(panBy(cam, e.deltaX, e.deltaY));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cam, setCam]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && (spaceDown.current || e.target === e.currentTarget))) {
      panState.current = { px: e.clientX, py: e.clientY };
      moved.current = false;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panState.current) return;
    const dx = e.clientX - panState.current.px;
    const dy = e.clientY - panState.current.py;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    setCam(panBy(cam, dx, dy));
    panState.current = { px: e.clientX, py: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panState.current && !moved.current && e.button === 0) {
      props.onBackgroundClick?.();
    }
    panState.current = null;
  };

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (props.viewportRef && el) props.viewportRef.current = el;
      }}
      className={`canvas-viewport ${props.className ?? ''}`}
      style={{
        backgroundPosition: `${-cam.x * cam.z}px ${-cam.y * cam.z}px`,
        backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (panState.current = null)}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${-cam.x * cam.z}px, ${-cam.y * cam.z}px) scale(${cam.z})`,
          transformOrigin: '0 0',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
