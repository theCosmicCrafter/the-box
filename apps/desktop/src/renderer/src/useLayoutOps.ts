// SPDX-License-Identifier: LicenseRef-Proprietary
// useLayoutOps.ts - Track 1 layout & tidy tools (align / distribute /
// tidy-grid). Pure user-invoked transforms, I-9 compliant: they only
// move nodes the user explicitly selected and each run is one undo
// capture + one board write. Extracted from App.tsx.

import { alignNodes, distributeNodes, tidyGrid, useBoxStore } from "@box/ui";

export function useLayoutOps(deps: {
  captureUndo: () => void;
  gestureDirty: { current: boolean };
  saveBoard: () => Promise<void>;
}) {
  const { captureUndo, gestureDirty, saveBoard } = deps;

  const runAlign = async (
    type: "left" | "centerX" | "right" | "top" | "centerY" | "bottom",
    ids: string[],
  ) => {
    gestureDirty.current = false;
    captureUndo();
    const b = useBoxStore.getState().board;
    if (!b) return;
    const nextNodes = alignNodes(b.nodes, ids, type);
    useBoxStore.getState().restoreBoard(nextNodes, b.edges);
    gestureDirty.current = false;
    await saveBoard();
  };

  const runDistribute = async (
    axis: "horizontal" | "vertical",
    ids: string[],
  ) => {
    gestureDirty.current = false;
    captureUndo();
    const b = useBoxStore.getState().board;
    if (!b) return;
    const nextNodes = distributeNodes(b.nodes, ids, axis);
    useBoxStore.getState().restoreBoard(nextNodes, b.edges);
    gestureDirty.current = false;
    await saveBoard();
  };

  const runTidyGrid = async (ids: string[]) => {
    gestureDirty.current = false;
    captureUndo();
    const b = useBoxStore.getState().board;
    if (!b) return;
    const nextNodes = tidyGrid(b.nodes, ids);
    useBoxStore.getState().restoreBoard(nextNodes, b.edges);
    gestureDirty.current = false;
    await saveBoard();
  };

  return { runAlign, runDistribute, runTidyGrid };
}
