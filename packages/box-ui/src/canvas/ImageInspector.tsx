// SPDX-License-Identifier: LicenseRef-Proprietary
// ImageInspector - the PureRef/Eagle pattern for image work: double-click a
// node and the image fills the window; wheel zooms to cursor, drag pans,
// arrows nudge, 0 = fit, 1 = 100%, +/- zoom around center, Esc/backdrop
// closes. Image pixels are the "world" so camera.ts math applies verbatim.
// Zoom bounds are wide (0.05..40) - artists pixel-peep far past canvas zoom.

import { useCallback, useEffect, useRef, useState } from "react";
import { panBy, zoomAt, zoomToFit, type Camera } from "./camera.js";

const ZOOM_LO = 0.05;
const ZOOM_HI = 40;
const NUDGE = 80; // arrow-key pan step in screen px (Eagle-style nudge)

export interface ImageInspectorProps {
  /** Displayable URL (desktop wires this to box:// with ?v=mtime). */
  src: string;
  name: string;
  onClose: () => void;
}

export function ImageInspector(props: ImageInspectorProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState<Camera | null>(null);
  const drag = useRef<{ px: number; py: number } | null>(null);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el || !nat) return;
    const r = el.getBoundingClientRect();
    setCam(
      zoomToFit({ x: 0, y: 0, w: nat.w, h: nat.h }, r.width, r.height, 48, 100),
    );
  }, [nat]);

  const actual = useCallback(() => {
    const el = wrap.current;
    if (!el || !nat) return;
    const r = el.getBoundingClientRect();
    setCam({ x: nat.w / 2 - r.width / 2, y: nat.h / 2 - r.height / 2, z: 1 });
  }, [nat]);

  const zoomStep = (factor: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCam((c) =>
      c ? zoomAt(c, r.width / 2, r.height / 2, factor, ZOOM_LO, ZOOM_HI) : c,
    );
  };

  // Initialize to fit once the image's natural size is known.
  useEffect(() => {
    if (nat !== null && cam === null) fit();
  }, [nat, cam, fit]);

  // Keyboard grammar: Esc/backdrop close, arrows pan, +/- zoom, 0 fit, 1 1:1.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return props.onClose();
      if (e.key === "0") return fit();
      if (e.key === "1") return actual();
      if (e.key === "+" || e.key === "=") return zoomStep(1.25);
      if (e.key === "-") return zoomStep(0.8);
      const d =
        e.key === "ArrowLeft"
          ? { x: -NUDGE, y: 0 }
          : e.key === "ArrowRight"
            ? { x: NUDGE, y: 0 }
            : e.key === "ArrowUp"
              ? { x: 0, y: -NUDGE }
              : e.key === "ArrowDown"
                ? { x: 0, y: NUDGE }
                : null;
      if (d) {
        e.preventDefault();
        setCam((c) => (c ? panBy(c, -d.x, -d.y) : c));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, actual]);

  const onWheel = (e: React.WheelEvent) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.002);
    setCam((c) =>
      c
        ? zoomAt(
            c,
            e.clientX - r.left,
            e.clientY - r.top,
            factor,
            ZOOM_LO,
            ZOOM_HI,
          )
        : c,
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    drag.current = { px: e.clientX, py: e.clientY };
    setCam((c) => (c ? panBy(c, dx, dy) : c));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="inspector"
      role="dialog"
      aria-label={`Inspect ${props.name}`}
    >
      <div className="inspector-backdrop" onClick={props.onClose} />
      <div
        ref={wrap}
        className="inspector-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          className="inspector-img"
          src={props.src}
          alt={props.name}
          draggable={false}
          onLoad={(e) =>
            setNat({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          style={
            cam && nat
              ? {
                  left: -cam.x * cam.z,
                  top: -cam.y * cam.z,
                  width: nat.w * cam.z,
                }
              : { visibility: "hidden" }
          }
        />
      </div>
      <div className="inspector-bar">
        <span className="inspector-name">{props.name}</span>
        {nat && (
          <span className="inspector-dim">
            {nat.w}x{nat.h}
          </span>
        )}
        <button onClick={() => zoomStep(0.8)} title="Zoom out (-)">
          -
        </button>
        <span className="inspector-zoom">
          {cam ? `${Math.round(cam.z * 100)}%` : "…"}
        </span>
        <button onClick={() => zoomStep(1.25)} title="Zoom in (+)">
          +
        </button>
        <button onClick={fit} title="Fit to window (0)">
          fit
        </button>
        <button onClick={actual} title="Actual size (1)">
          1:1
        </button>
        <button
          className="inspector-close"
          onClick={props.onClose}
          title="Close (Esc)"
        >
          x
        </button>
      </div>
    </div>
  );
}
