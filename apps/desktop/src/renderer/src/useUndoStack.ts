// SPDX-License-Identifier: LicenseRef-Proprietary
// useUndoStack.ts - undo/redo stacks plus their ADR-0007 v2 oplog
// persistence, extracted from App.tsx. The stacks stay plain refs so
// call sites keep their existing `.current` access; the hook owns the
// debounced flush and the per-board reseed.

import type { CanvasEdge, CanvasNode } from "@box/core";
import { oplogPath, parseOplogText, serializeOplog } from "@box/core";
import { useBoxStore } from "@box/ui";
import { useRef } from "react";

export interface UndoSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const UNDO_CAP = 200;
const OPLOG_DEBOUNCE_MS = 800;

export function useUndoStack() {
  const undoStack = useRef<UndoSnapshot[]>([]);
  const redoStack = useRef<UndoSnapshot[]>([]);
  const gestureDirty = useRef(false);
  const oplogTimer = useRef<number | undefined>(undefined);

  // Deltas are computed at flush time, so the hot path stays O(1).
  const scheduleOplogFlush = () => {
    window.clearTimeout(oplogTimer.current);
    oplogTimer.current = window.setTimeout(() => {
      const root = useBoxStore.getState().workspaceRoot;
      const bp = useBoxStore.getState().boardPath;
      if (!root || !bp || !window.box) return;
      const s = serializeOplog(undoStack.current, bp);
      if (s) void window.box.writeFileAtomic(root, s.path, s.json);
    }, OPLOG_DEBOUNCE_MS);
  };

  const captureUndo = () => {
    if (gestureDirty.current) return;
    const b = useBoxStore.getState().board;
    if (b === null) return;
    gestureDirty.current = true;
    undoStack.current.push({ nodes: b.nodes, edges: b.edges });
    if (undoStack.current.length > UNDO_CAP) undoStack.current.shift();
    redoStack.current = [];
    scheduleOplogFlush();
  };

  const seedOplog = async (root: string, boardRel: string) => {
    undoStack.current = [];
    redoStack.current = [];
    const text = await window.box?.readFile(root, oplogPath(boardRel));
    if (text === null || text === undefined) return;
    const stack = parseOplogText(text, boardRel);
    if (stack) undoStack.current = stack;
  };

  return {
    undoStack,
    redoStack,
    gestureDirty,
    captureUndo,
    seedOplog,
    scheduleOplogFlush,
  };
}
