// SPDX-License-Identifier: LicenseRef-Proprietary
// spatialAudio.ts - FR-306 spatial audio modes (off/all/viewport).
//
// Playing audio nodes route through one shared AudioContext:
//   element -> MediaElementSource -> StereoPanner -> Gain -> destination.
// Pan and gain are recomputed per frame from the node's world position
// against the live camera viewport:
//   - "off":      passthrough (pan 0, gain 1) - plain playback, default.
//   - "all":      ambient soundscape - pan by horizontal offset, gain falls
//                 off with world-distance but never reaches zero.
//   - "viewport": audible only inside the view - gain fades across a
//                 ~15%-of-diagonal band past the viewport edge to silence.
//
// Elements mount only while their node is selected (NodeView renders the
// <audio> chip then), so wiring is on-demand: a rAF tick scans the DOM for
// `audio[data-node-id]` and wires anything new. createMediaElementSource
// reroutes the element's output permanently once wired, so mode "off" is
// expressed as neutral pan/gain rather than unwiring.

import { worldViewport, type Camera } from "@box/ui";
import type { CanvasNode } from "@box/core";

export type SpatialAudioMode = "off" | "all" | "viewport";

interface Wired {
  pan: StereoPannerNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
const wired = new WeakMap<HTMLAudioElement, Wired>();
let mode: SpatialAudioMode = "off";

/** Must be called from a user gesture (the ribbon toggle) so the
 * AudioContext starts in "running" state per the autoplay policy. */
export function setSpatialAudioMode(m: SpatialAudioMode): void {
  mode = m;
  if (m !== "off" && ctx === null) {
    ctx = new AudioContext();
    // Debug handle for the live harness - same pattern as __boxStore.
    (window as unknown as Record<string, unknown>).__boxSpatial = {
      wiredCount: () => document.querySelectorAll("audio[data-node-id]").length,
      params: (nodeId: string) => {
        const el = document.querySelector<HTMLAudioElement>(
          `audio[data-node-id="${nodeId}"]`,
        );
        const w = el !== null ? wired.get(el) : undefined;
        return w === undefined
          ? null
          : { pan: w.pan.pan.value, gain: w.gain.gain.value };
      },
    };
  }
  if (ctx !== null && ctx.state === "suspended") void ctx.resume();
}

function wire(el: HTMLAudioElement): Wired | null {
  if (ctx === null) return null;
  const existing = wired.get(el);
  if (existing !== undefined) return existing;
  try {
    const src = ctx.createMediaElementSource(el);
    const pan = ctx.createStereoPanner();
    const gain = ctx.createGain();
    src.connect(pan);
    pan.connect(gain);
    gain.connect(ctx.destination);
    const w: Wired = { pan, gain };
    wired.set(el, w);
    return w;
  } catch {
    // Already wired elsewhere or element in a state WebAudio rejects -
    // leave it unprocessed rather than break playback.
    return null;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** One frame of spatial evaluation. `view` is the screen-space rect of the
 * canvas viewport element (for size); `cam` is the live camera. */
export function spatialTick(
  cam: Camera,
  viewW: number,
  viewH: number,
  nodes: ReadonlyMap<string, CanvasNode>,
): void {
  const els = document.querySelectorAll<HTMLAudioElement>(
    "audio[data-node-id]",
  );
  const vp = worldViewport(cam, viewW, viewH);
  const cx = vp.x + vp.w / 2;
  const cy = vp.y + vp.h / 2;
  const diag = Math.hypot(vp.w, vp.h) || 1;

  for (const el of els) {
    const w = wire(el);
    if (w === null) continue;
    let pan = 0;
    let gain = 1;
    if (mode !== "off") {
      const id = el.dataset.nodeId ?? "";
      const n = nodes.get(id);
      if (n !== undefined) {
        const ncx = n.x + n.width / 2;
        const ncy = n.y + n.height / 2;
        pan = clamp((2 * (ncx - cx)) / vp.w, -1, 1);
        const dx = Math.max(Math.abs(ncx - cx) - vp.w / 2, 0);
        const dy = Math.max(Math.abs(ncy - cy) - vp.h / 2, 0);
        const outside = Math.hypot(dx, dy);
        if (mode === "viewport") {
          gain = clamp(1 - outside / (diag * 0.15), 0, 1);
        } else {
          // "all": distance falloff from view center, floor at 0.15 so a
          // far node is quiet ambience rather than silence.
          const dist = Math.hypot(ncx - cx, ncy - cy);
          gain = Math.max(0.15, 1 / (1 + dist / (diag * 0.4)));
        }
      }
    }
    // Smooth parameter moves to avoid zipper noise on pan/zoom.
    const t = ctx !== null ? ctx.currentTime : 0;
    w.pan.pan.setTargetAtTime(pan, t, 0.05);
    w.gain.gain.setTargetAtTime(gain, t, 0.05);
  }
}
