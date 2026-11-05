// SPDX-License-Identifier: LicenseRef-Proprietary
// useWorkspacePrefs.ts - non-truth prefs (.box/settings.json): ink
// color/size, spatial-audio mode, ext->app open-with map, and the
// ADR-0010 decision client. Missing/corrupt settings degrade to
// defaults silently; every change debounce-saves through makeSaver.
// Also owns the spatial-audio rAF tick and the open-external dispatch.
// Extracted from App.tsx.

import type { CanvasNode, IDecisionClient } from "@box/core";
import { createDecisionClient } from "@box/core";
import type { Camera } from "@box/ui";
import { useBoxStore } from "@box/ui";
import { useEffect, useRef, useState } from "react";
import { loadSettings, makeSaver } from "./settings.js";
import {
    setSpatialAudioMode,
    spatialTick,
    type SpatialAudioMode,
} from "./spatialAudio.js";

export function useWorkspacePrefs(deps: {
  decisionClient: { current: IDecisionClient };
  setInkColor: (c: string) => void;
  setInkSize: (s: number) => void;
  inkColor: string;
  inkSize: number;
  camRef: { current: Camera };
  vpElRef: { current: HTMLDivElement | null };
  boardNodes: readonly CanvasNode[] | undefined;
}) {
  const {
    decisionClient,
    setInkColor,
    setInkSize,
    inkColor,
    inkSize,
    camRef,
    vpElRef,
    boardNodes,
  } = deps;

  // FR-305: ext -> picked app path, persisted in .box/settings.json.
  const [openWithMap, setOpenWithMap] = useState<Record<string, string>>({});
  const [audioMode, setAudioMode] = useState<SpatialAudioMode>("off");
  const savePrefs = useRef<ReturnType<typeof makeSaver> | null>(null);

  // FR-305/307: load on workspace open, debounce-save on change.
  const loadPrefs = async (root: string) => {
    savePrefs.current = makeSaver(root);
    const s = await loadSettings(root);
    if (typeof s.ink?.color === "string") setInkColor(s.ink.color);
    if (typeof s.ink?.size === "number") setInkSize(s.ink.size);
    if (s.audio?.mode === "all" || s.audio?.mode === "viewport")
      setAudioMode(s.audio.mode);
    setOpenWithMap(s.openWith ?? {});
    // ADR-0010: rebuild the proposal client from non-truth prefs.
    // Disabled by default; unreachable daemon resolves offline and the
    // proposal layer simply renders nothing (FR-407, ERR-9). Transport is
    // the loopback-only Rust command - webview fetch is CSP-blocked.
    const ipcFetch: typeof fetch = async (input, init) => {
      if (!window.box) throw new Error("bridge not ready");
      const body = await window.box.decidePost(
        String(input),
        String(init?.body ?? ""),
      );
      return new Response(body, { status: 200 });
    };
    decisionClient.current = createDecisionClient({
      enabled: s.ai?.enabled === true,
      url: s.ai?.vonUrl,
      fetchFn: s.ai?.enabled === true ? ipcFetch : undefined,
    });
  };

  const setInkColorPref = (c: string) => {
    setInkColor(c);
    savePrefs.current?.({ ink: { color: c, size: inkSize } });
  };
  const setInkSizePref = (s: number) => {
    setInkSize(s);
    savePrefs.current?.({ ink: { color: inkColor, size: s } });
  };

  // FR-306: cycle off -> all -> viewport; the mode persists as a non-truth
  // pref and drives the WebAudio pan/gain graph for playing audio nodes.
  const setAudioModePref = (m: SpatialAudioMode) => {
    setSpatialAudioMode(m); // inside the click gesture: AudioContext allowed
    setAudioMode(m);
    savePrefs.current?.({ audio: { mode: m } });
  };

  // While spatial audio is on, recompute pan/gain every frame from the live
  // camera; on switch-off (or board close) run one passthrough tick so
  // already-wired elements return to neutral. The node lookup lives in a
  // ref so the rAF loop is keyed only on the mode - rebuilding a Map and
  // re-subscribing per board mutation was needless churn at 60fps.
  const audioNodesRef = useRef<ReadonlyMap<string, CanvasNode>>(new Map());
  useEffect(() => {
    audioNodesRef.current = new Map(
      (boardNodes ?? []).map((n) => [n.id, n]),
    );
  }, [boardNodes]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const vp = vpElRef.current;
      if (vp !== null) {
        const r = vp.getBoundingClientRect();
        spatialTick(camRef.current, r.width, r.height, audioNodesRef.current);
      }
      if (audioMode !== "off") raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [audioMode]);

  // FR-305: preferred app per extension wins over the OS default.
  const openExternalSmart = async (rel: string) => {
    if (!window.box) return;
    const ext = `.${(rel.split(".").pop() ?? "").toLowerCase()}`;
    const app = openWithMap[ext];
    if (app !== undefined) {
      const r = await window.box.openWith(rel, app);
      if (r.ok) return;
      // Recorded app vanished/failed - drop the pref, fall to default.
      const next = { ...openWithMap };
      delete next[ext];
      setOpenWithMap(next);
      savePrefs.current?.({ openWith: next });
    }
    const r = await window.box.openExternal(rel);
    if (!r.ok)
      useBoxStore.getState().setProblems([`open failed: ${rel} - ${r.error}`]);
  };

  return {
    openWithMap,
    setOpenWithMap,
    audioMode,
    savePrefs,
    loadPrefs,
    setInkColorPref,
    setInkSizePref,
    setAudioModePref,
    openExternalSmart,
  };
}
