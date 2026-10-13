// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 1 shell: workspace file list + board canvas. Clicking a
// .box.canvas opens the BoardView; node drags persist through the
// atomic-write IPC on commit.

import type { Side, WritePlan } from "@box/core";
import {
  createEdgePlan,
  deleteEdgePlan,
  parseBoard,
  serializeBoard,
} from "@box/core";
import type { WorkspaceFile } from "@box/ui";
import { BoardView, FileList, useBoxStore } from "@box/ui";
import { useMemo } from "react";

declare global {
  interface Window {
    box?: {
      openWorkspace: () => Promise<{
        root: string;
        files: WorkspaceFile[];
      } | null>;
      rescan: (root: string) => Promise<WorkspaceFile[]>;
      readFile: (root: string, rel: string) => Promise<string | null>;
      writeFileAtomic: (
        root: string,
        rel: string,
        content: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      trashFile: (
        root: string,
        rel: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      appendTombstone: (
        root: string,
        edgeId: string,
      ) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

/** Execute a box-core WritePlan against the workspace, steps in order. */
async function applyPlan(root: string, plan: WritePlan): Promise<string[]> {
  const errors: string[] = [];
  const api = window.box;
  if (!api) return ["no bridge"];
  for (const step of plan.steps) {
    const r =
      step.op === "write-atomic"
        ? await api.writeFileAtomic(root, step.path, step.content)
        : step.op === "trash"
          ? await api.trashFile(root, step.path)
          : await api.appendTombstone(root, step.edgeId);
    if (!r.ok)
      errors.push(
        `${step.op} ${"path" in step ? step.path : step.edgeId}: ${r.error}`,
      );
  }
  return errors;
}

export function App() {
  const {
    workspaceRoot,
    files,
    board,
    boardPath,
    boardProblems,
    setWorkspace,
    setFiles,
    openBoard,
    closeBoard,
    moveNode,
    addEdge,
    removeEdge,
  } = useBoxStore();

  const open = async () => {
    const r = await window.box?.openWorkspace();
    if (r) setWorkspace(r.root, r.files);
  };

  const rescan = async () => {
    if (workspaceRoot && window.box) {
      setFiles(await window.box.rescan(workspaceRoot));
    }
  };

  const openBoardFile = async (rel: string) => {
    if (!workspaceRoot || !window.box) return;
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) return;
    const { value, problems } = parseBoard(text, rel);
    if (value) openBoard(rel, value, problems);
  };

  const saveBoard = async () => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath || !window.box) return;
    await window.box.writeFileAtomic(
      workspaceRoot,
      boardPath,
      serializeBoard(b),
    );
  };

  // I-1: edge draw -> link note written first, board second.
  const createEdge = async (
    fromId: string,
    toId: string,
    fromSide: Side,
    toSide: Side,
  ) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const { plan, edge } = createEdgePlan(b, boardPath, fromId, toId, {
      fromSide,
      toSide,
    });
    const errors = await applyPlan(workspaceRoot, plan);
    if (errors.length === 0) {
      addEdge(edge);
      void rescan(); // the new link-<id>.md should appear in the file list
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // I-2: edge erase -> tombstone, board, note to Recycle Bin.
  const deleteEdge = async (edgeId: string) => {
    const b = useBoxStore.getState().board;
    if (!workspaceRoot || !b || !boardPath) return;
    const errors = await applyPlan(
      workspaceRoot,
      deleteEdgePlan(b, boardPath, edgeId),
    );
    if (errors.length === 0) {
      removeEdge(edgeId);
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Broken-file detection: file nodes whose target isn't in the workspace.
  const brokenNodes = useMemo(() => {
    const have = new Set(files.map((f) => f.path));
    const missing = new Set<string>();
    for (const n of board?.nodes ?? []) {
      if (n.type === "file" && !have.has(n.file)) missing.add(n.id);
    }
    return missing;
  }, [board, files]);

  if (board && boardPath) {
    return (
      <main className="shell board-shell">
        <div className="board-bar">
          <button onClick={closeBoard}>back</button>
          <code>{boardPath}</code>
          {boardProblems.length > 0 && (
            <span className="warn">{boardProblems.length} problems</span>
          )}
          {brokenNodes.size > 0 && (
            <span className="warn">{brokenNodes.size} missing files</span>
          )}
          <span className="hint">
            wheel: pan / ctrl+wheel: zoom / drag nodes to move
          </span>
        </div>
        <BoardView
          board={board}
          brokenNodes={brokenNodes}
          onMove={moveNode}
          onCommit={() => void saveBoard()}
          onCreateEdge={(f, t, fs, ts) => void createEdge(f, t, fs, ts)}
          onDeleteEdge={(id) => void deleteEdge(id)}
        />
      </main>
    );
  }

  return (
    <main className="shell">
      <header>
        <h1>The Box</h1>
        <p className="tagline">
          Objects are files. Arrows are notes. Edits round-trip.
        </p>
      </header>
      {workspaceRoot === null ? (
        <div className="welcome">
          <p>Open a folder to make it a workspace.</p>
          <button onClick={() => void open()}>Open workspace folder</button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <code>{workspaceRoot}</code>
            <button onClick={() => void rescan()}>Rescan</button>
          </div>
          <FileList files={files} onOpen={(p) => void openBoardFile(p)} />
        </>
      )}
    </main>
  );
}
