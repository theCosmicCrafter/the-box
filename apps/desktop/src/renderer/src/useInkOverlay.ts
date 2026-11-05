// SPDX-License-Identifier: LicenseRef-Proprietary
// useInkOverlay.ts - ink mode state, `.ink.svg` sidecar load/save,
// stroke append/move/erase/undo. Extracted from App.tsx; every write
// goes through writeFileAtomic + saveBoard so the board record and the
// sidecar stay consistent, and empty sidecars are trashed recoverably.

import type { Board, InkStroke, ProblemItem } from "@box/core";
import { parseInkSvg, serializeInkSvg } from "@box/core";
import {
  pathToPolygon,
  pointInPolygon,
  strokeToPath,
  translatePath,
  useBoxStore,
  type InkPoint,
} from "@box/ui";
import { useEffect, useRef, useState } from "react";

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

export type InkMode = "off" | "draw" | "erase" | "edit";

export function useInkOverlay(deps: {
  workspaceRoot: string | null;
  board: Board | null;
  updateNodeC: (id: string, patch: Record<string, unknown>) => void;
  saveBoard: () => Promise<void>;
}) {
  const { workspaceRoot, board, updateNodeC, saveBoard } = deps;
  const [inkMode, setInkMode] = useState<InkMode>("off");
  const [inkColor, setInkColor] = useState<string>("#e8b931");
  const [inkSize, setInkSize] = useState<number>(10);
  const [inkMap, setInkMap] = useState<Map<string, InkStroke[]>>(new Map());
  const lastInkNode = useRef<string | null>(null);

  // Ink sidecars: re-read every `box-ink` target so external edits to an
  // .ink.svg refresh the overlay (the watcher re-fires this via deps).
  const reloadInk = async () => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !window.box || !b) return;
    const next = new Map<string, InkStroke[]>();
    for (const n of b.nodes) {
      if (n.type !== "file") continue;
      const rel = n["box-ink"];
      if (typeof rel !== "string") continue;
      const t = await window.box.readFile(workspaceRoot, rel);
      if (t === null) continue;
      const { value, problems } = parseInkSvg(t, rel);
      if (problems.length > 0) {
        useBoxStore.getState().setProblems(problems.map(fmtProblem));
      }
      if (value) next.set(n.id, value.strokes);
    }
    setInkMap(next);
  };
  useEffect(() => {
    void reloadInk();
  }, [board?.nodes, workspaceRoot]);

  // FR-105: a finished stroke appends to the node's sidecar; the source
  // file itself is never touched.
  const inkStroke = async (nodeId: string, pts: InkPoint[]) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel =
      typeof n["box-ink"] === "string" ? n["box-ink"] : `${n.file}.ink.svg`;
    const d = strokeToPath(pts, inkSize);
    if (!d) return;
    const strokes = [
      ...(inkMap.get(nodeId) ?? []),
      { d, fill: inkColor, stroke: inkColor, "stroke-width": inkSize },
    ];
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes }),
    );
    if (!r.ok) {
      useBoxStore
        .getState()
        .setProblems([`ink save failed: ${r.error ?? rel}`]);
      return;
    }
    if (n["box-ink"] !== rel) updateNodeC(nodeId, { "box-ink": rel });
    setInkMap(new Map(inkMap).set(nodeId, strokes));
    lastInkNode.current = nodeId;
    await saveBoard();
  };

  // Ink edit mode (FR-307 partial): drag translates a stroke's polygon.
  // Foreign (non-polygon) paths refuse the move rather than corrupting.
  const inkStrokeMove = async (
    nodeId: string,
    idx: number,
    dx: number,
    dy: number,
  ) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || idx < 0 || idx >= strokes.length)
      return;
    const nd = translatePath(strokes[idx]!.d, dx, dy);
    if (nd === null) return;
    const next = strokes.map((s, i) => (i === idx ? { ...s, d: nd } : s));
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: next }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, next));
  };

  // Ink undo: pop the last stroke off a node's sidecar; empty sidecar is
  // trashed recoverably, same as the erase-all path.
  const inkUndo = async (nodeId: string) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || strokes.length === 0) return;
    const kept = strokes.slice(0, -1);
    if (kept.length === 0) {
      await window.box.trashFile(workspaceRoot, rel);
      updateNodeC(nodeId, { "box-ink": undefined });
      const m = new Map(inkMap);
      m.delete(nodeId);
      setInkMap(m);
      await saveBoard();
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: kept }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, kept));
  };

  // FR-106: erase removes whole strokes hit by the pointer (a small ring
  // of sample points makes the target forgiving). Empty sidecars are
  // trashed, not left as zero-byte litter.
  const inkErase = async (nodeId: string, lx: number, ly: number) => {
    const n = useBoxStore.getState().board?.nodes.find((x) => x.id === nodeId);
    const strokes = inkMap.get(nodeId);
    if (!workspaceRoot || !window.box || !n || n.type !== "file") return;
    const rel = n["box-ink"];
    if (typeof rel !== "string" || !strokes || strokes.length === 0) return;
    const samples: Array<[number, number]> = [
      [lx, ly],
      [lx + 5, ly],
      [lx - 5, ly],
      [lx, ly + 5],
      [lx, ly - 5],
    ];
    const hit = (d: string) => {
      const poly = pathToPolygon(d);
      if (poly) return samples.some(([x, y]) => pointInPolygon(x, y, poly));
      // Non-polygon `d` (hand-written or older sidecars): DOM hit-test
      // in the path's own user units, same space lx/ly are in.
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("d", d);
      const pt = new DOMPoint(0, 0);
      return samples.some(([x, y]) => {
        pt.x = x;
        pt.y = y;
        return el.isPointInFill(pt);
      });
    };
    const kept = strokes.filter((s) => !hit(s.d));
    if (kept.length === strokes.length) return;
    if (kept.length === 0) {
      await window.box.trashFile(workspaceRoot, rel);
      updateNodeC(nodeId, { "box-ink": undefined });
      const m = new Map(inkMap);
      m.delete(nodeId);
      setInkMap(m);
      await saveBoard();
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeInkSvg({ strokes: kept }),
    );
    if (r.ok) setInkMap(new Map(inkMap).set(nodeId, kept));
  };

  return {
    inkMode,
    setInkMode,
    inkColor,
    setInkColor,
    inkSize,
    setInkSize,
    inkMap,
    setInkMap,
    lastInkNode,
    reloadInk,
    inkStroke,
    inkStrokeMove,
    inkUndo,
    inkErase,
  };
}
