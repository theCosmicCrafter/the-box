// SPDX-License-Identifier: LicenseRef-Proprietary
// useBoardShortcuts.ts - global keydown layer: Esc unwinds dialogs in
// z-order (help -> export -> pick-up -> filter -> related), ?/F1 help,
// Ctrl+Shift+E export, Shift+1 zoom-to-fit, Ctrl+F filter, Ctrl+P
// quick-open, Ctrl+W close board, Ctrl+Z/Y undo-redo (ink strokes keep
// their own stroke-level undo while an ink mode is active - ADR-0007).
// Text inputs are never hijacked. Extracted from App.tsx.

import { useBoxStore } from "@box/ui";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { InkMode } from "./useInkOverlay.js";
import type { RelatedDialogState } from "./useSemanticSearch.js";

export function useBoardShortcuts(deps: {
  pickUp: string | null;
  setPickUp: Dispatch<SetStateAction<string | null>>;
  filterOpen: boolean;
  setFilterOpen: Dispatch<SetStateAction<boolean>>;
  relatedDialog: RelatedDialogState | null;
  setRelatedDialog: Dispatch<SetStateAction<RelatedDialogState | null>>;
  helpOpen: boolean;
  setHelpOpen: Dispatch<SetStateAction<boolean>>;
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  setFitAll: Dispatch<SetStateAction<{ nonce: number } | null>>;
  setQuickOpen: Dispatch<SetStateAction<boolean>>;
  inkMode: InkMode;
  lastInkNode: { current: string | null };
  inkUndo: (nodeId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}) {
  const {
    pickUp,
    setPickUp,
    filterOpen,
    setFilterOpen,
    relatedDialog,
    setRelatedDialog,
    helpOpen,
    setHelpOpen,
    exportOpen,
    setExportOpen,
    setFitAll,
    setQuickOpen,
    inkMode,
    lastInkNode,
    inkUndo,
    undo,
    redo,
  } = deps;
  const { board, boardPath, closeBoard } = useBoxStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          (t.closest?.("[contenteditable='true']") ?? null) !== null)
      )
        return;
      if (e.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (exportOpen) {
          setExportOpen(false);
          return;
        }
        if (pickUp !== null) {
          setPickUp(null);
          return;
        }
        if (filterOpen) {
          setFilterOpen(false);
          return;
        }
        if (relatedDialog !== null) {
          setRelatedDialog(null);
          return;
        }
      }
      if (e.key === "?" || e.key === "F1") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (
        (e.key === "e" || e.key === "E") &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        board !== null
      ) {
        e.preventDefault();
        setExportOpen(true);
        return;
      }
      if (e.key === "!" && e.shiftKey && board !== null) {
        setFitAll({ nonce: Date.now() });
        return;
      }
      if (
        (e.key === "f" || e.key === "F") &&
        (e.ctrlKey || e.metaKey) &&
        board !== null
      ) {
        e.preventDefault();
        setFilterOpen((v) => !v);
        return;
      }
      if (
        (e.key === "p" || e.key === "P") &&
        (e.ctrlKey || e.metaKey) &&
        board !== null
      ) {
        e.preventDefault();
        setQuickOpen((v) => !v);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "w" || e.key === "W")) {
        // Ctrl+W closes the active board (tab-bar polish, Q4).
        if (boardPath !== null) {
          e.preventDefault();
          closeBoard();
        }
        return;
      }
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (board === null) return;
        e.preventDefault();
        // Ink mode keeps its own stroke-level undo; the board stack
        // owns everything else (ADR-0007).
        if (e.shiftKey) void redo();
        else if (inkMode !== "off" && lastInkNode.current !== null)
          void inkUndo(lastInkNode.current);
        else void undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        if (board === null) return;
        e.preventDefault();
        void redo();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    pickUp,
    board,
    boardPath,
    filterOpen,
    relatedDialog,
    helpOpen,
    exportOpen,
    inkMode,
  ]);
}
