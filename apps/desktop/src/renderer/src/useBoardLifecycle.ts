// SPDX-License-Identifier: LicenseRef-Proprietary
// useBoardLifecycle.ts - workspace open + launch-restore, board-file
// load (incl. ADR-0009 in-place normalize of foreign .canvas), the
// ACCESS scaffold offer, and new-board creation. Extracted from
// App.tsx; every write is atomic and the board file on disk is the
// source of truth - the store only ever holds a projection of it.

import type { ProblemItem } from "@box/core";
import {
    BOARD_FORMAT,
    hasBoxFormatMarker,
    hasScaffoldDirs,
    importSpecCanvas,
    isPathRel,
    missingScaffoldFiles,
    parseBoard,
    serializeBoard,
} from "@box/core";
import type { WorkspaceFile } from "@box/ui";
import { useBoxStore } from "@box/ui";
import { useEffect, useRef, useState } from "react";

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

export function useBoardLifecycle(deps: {
  rescan: () => Promise<void>;
  seedOplog: (root: string, boardRel: string) => Promise<void>;
  loadPrefs: (root: string) => Promise<void>;
}) {
  const { rescan, seedOplog, loadPrefs } = deps;
  const { workspaceRoot, files, setWorkspace, openBoard } = useBoxStore();

  const [newBoardName, setNewBoardName] = useState("");
  const newBoardInput = useRef<HTMLInputElement>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("box.recentWorkspaces") || "[]",
      ) as string[];
    } catch {
      return [];
    }
  });

  const loadBoardFile = async (rel: string) => {
    // Read root from the store, not the closure: callers that just ran
    // setWorkspace (open, restore) still see the pre-set state value.
    const root = useBoxStore.getState().workspaceRoot;
    if (!root || !window.box) return false;
    const rawText = await window.box.readFile(root, rel);
    if (rawText === null) return false;
    let text: string = rawText;
    // ADR-0009: a foreign spec .canvas (no box-format marker) normalizes
    // IN PLACE - remapped ids, generated link notes, added box-format -
    // and keeps its name so spec readers (Obsidian) still open it.
    if (
      rel.endsWith(".canvas") &&
      !rel.endsWith(".box.canvas") &&
      !hasBoxFormatMarker(text)
    ) {
      const imp = importSpecCanvas(text, rel, {
        // A foreign canvas can carry edge ids colliding with live
        // link-*.md files; existing notes win over generated stubs.
        existingNotePaths: new Set(
          useBoxStore.getState().files.map((f) => f.path),
        ),
      });
      if ("error" in imp) {
        useBoxStore
          .getState()
          .setProblems([
            `malformed-board: ${rel} - not a canvas (${imp.error})`,
          ]);
        return false;
      }
      const w = await window.box.writeFileAtomic(root, rel, imp.boardJson);
      if (!w.ok) {
        useBoxStore
          .getState()
          .setProblems([`canvas import write failed: ${w.error}`]);
        return false;
      }
      for (const n of imp.notes) {
        const nw = await window.box.writeFileAtomic(root, n.path, n.content);
        if (!nw.ok) {
          useBoxStore
            .getState()
            .setProblems([`canvas import note failed at ${n.path}`]);
          return false;
        }
      }
      text = imp.boardJson;
    }
    const { value, problems } = parseBoard(text, rel);
    if (value) {
      openBoard(rel, value, problems);
      // ADR-0007 v2: seed restart-surviving undo from the board's log.
      void seedOplog(root, rel);
      return true;
    }
    useBoxStore.getState().setProblems(problems.map(fmtProblem));
    return false;
  };

  // "Notepad ready" (Obsidian): opening a workspace lands you on a board -
  // the first .box.canvas found, or a fresh .box/main.box.canvas if none.
  const openFirstBoard = async (files: WorkspaceFile[], root: string) => {
    const first = files
      .map((f) => f.path)
      .filter((p) => p.endsWith(".box.canvas"))
      .sort()[0];
    if (first !== undefined) {
      await loadBoardFile(first);
      return;
    }
    const rel = ".box/main.box.canvas";
    const r = await window.box?.writeFileAtomic(
      root,
      rel,
      serializeBoard({ nodes: [], edges: [], "box-format": BOARD_FORMAT }),
    );
    if (r?.ok === true) {
      useBoxStore
        .getState()
        .setFiles([...files, { path: rel, size: 0, mtime: Date.now() }]);
      await loadBoardFile(rel);
    }
  };

  const open = async () => {
    if (!window.box) {
      useBoxStore
        .getState()
        .setProblems(["bridge missing - preload did not load"]);
      return;
    }
    const r = await window.box.openWorkspace();
    if (r) {
      setWorkspace(r.root, r.files);
      const nextRecents = [
        r.root,
        ...recentWorkspaces.filter((p) => p !== r.root),
      ].slice(0, 5);
      setRecentWorkspaces(nextRecents);
      try {
        localStorage.setItem(
          "box.recentWorkspaces",
          JSON.stringify(nextRecents),
        );
      } catch {
        // ignore quota / restricted storage
      }
      const w = await window.box.watchWorkspace(r.root);
      await loadPrefs(r.root);
      await openFirstBoard(r.files, r.root);
      if (!w.ok)
        useBoxStore
          .getState()
          .setProblems([
            `watcher unavailable: ${w.error} - manual rescan only`,
          ]);
    }
  };

  // Scaffold offer (ACCESS/LYT): visible only when the workspace has no
  // ACCESS dirs at all, and only ever writes create-if-missing seeds.
  const scaffoldOffered =
    workspaceRoot !== null && !hasScaffoldDirs(files.map((f) => f.path));
  const scaffold = async () => {
    const root = useBoxStore.getState().workspaceRoot;
    if (!root || !window.box) return;
    const existing = new Set(useBoxStore.getState().files.map((f) => f.path));
    const missing = missingScaffoldFiles(existing);
    for (const f of missing) {
      const r = await window.box.writeFileAtomic(root, f.path, f.content);
      if (!r.ok) {
        useBoxStore
          .getState()
          .setProblems([`scaffold failed at ${f.path}: ${r.error}`]);
        return;
      }
    }
    await rescan();
  };

  // New board: write the empty canvas file, then open it.
  const newBoard = async () => {
    if (!workspaceRoot || !window.box) return;
    const slug = newBoardName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug === "") return;
    const rel = `.box/${slug}.box.canvas`;
    if (!isPathRel(rel)) {
      useBoxStore.getState().setProblems([`bad board name: ${newBoardName}`]);
      return;
    }
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      rel,
      serializeBoard({ nodes: [], edges: [], "box-format": BOARD_FORMAT }),
    );
    if (r.ok) {
      setNewBoardName("");
      await loadBoardFile(rel);
    } else {
      useBoxStore.getState().setProblems([`board create failed: ${r.error}`]);
    }
  };

  // Launch restore (Obsidian opens your last vault). Once per mount;
  // readLastWorkspace in main already stat-checks the dir still exists.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !window.box) return;
    restored.current = true;
    void (async () => {
      const last = await window.box!.lastWorkspace();
      if (!last) return;
      const files = await window.box!.rescan(last);
      await window.box!.watchWorkspace(last);
      useBoxStore.getState().setWorkspace(last, files);
      await loadPrefs(last);
      await openFirstBoard(files, last);
    })();
  }, []);

  return {
    open,
    loadBoardFile,
    scaffoldOffered,
    scaffold,
    newBoard,
    newBoardName,
    setNewBoardName,
    newBoardInput,
  };
}
