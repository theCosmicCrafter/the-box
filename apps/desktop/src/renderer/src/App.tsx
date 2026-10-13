// SPDX-License-Identifier: LicenseRef-Proprietary
// Stage 1 shell: workspace file list + board canvas + link-note panel.
// The watcher pushes workspace:changed after every reconcile pass; we
// rescan the list and reload the open board only when it truly changed
// on disk (self-write echoes compare identical and are skipped).

import type { Delta, LinkNote, ProblemItem, Side, WritePlan } from "@box/core";
import {
  createEdgePlan,
  deleteEdgePlan,
  linkNoteName,
  parseBoard,
  parseLinkNote,
  serializeBoard,
  serializeLinkNote,
} from "@box/core";
import type { WorkspaceFile } from "@box/ui";
import { BoardView, FileList, NotePanel, useBoxStore } from "@box/ui";
import { useEffect, useMemo, useRef, useState } from "react";

interface WorkspaceChanged {
  files: WorkspaceFile[];
  deltas: Delta[];
  changedPaths: string[];
  problems: ProblemItem[];
  brokenNodes: string[];
  brokenEdges: string[];
}

declare global {
  interface Window {
    box?: {
      openWorkspace: () => Promise<{
        root: string;
        files: WorkspaceFile[];
      } | null>;
      rescan: (root: string) => Promise<WorkspaceFile[]>;
      watchWorkspace: (
        root: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      onWorkspaceChanged: (cb: (e: WorkspaceChanged) => void) => () => void;
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

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

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

  // Reconcile-authoritative broken sets (pushed by the watcher).
  const [remote, setRemote] = useState<{
    brokenNodes: Set<string>;
    brokenEdges: Set<string>;
  } | null>(null);
  // The selected edge's link note, parsed from disk.
  const [edgeNote, setEdgeNote] = useState<LinkNote | null>(null);
  const noteDirty = useRef(false);
  const [noteStale, setNoteStale] = useState(false);

  const open = async () => {
    const r = await window.box?.openWorkspace();
    if (r) {
      setWorkspace(r.root, r.files);
      await window.box?.watchWorkspace(r.root);
    }
  };

  const rescan = async () => {
    if (workspaceRoot && window.box) {
      setFiles(await window.box.rescan(workspaceRoot));
    }
  };

  const loadBoardFile = async (rel: string) => {
    if (!workspaceRoot || !window.box) return false;
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) return false;
    const { value, problems } = parseBoard(text, rel);
    if (value) {
      openBoard(rel, value, problems);
      return true;
    }
    useBoxStore.getState().setProblems(problems.map(fmtProblem));
    return false;
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

  // The round-trip half of the wedge: whatever the watcher reports, apply
  // it. Board reload compares serialized content so self-write echoes are
  // skipped and a mid-drag board is never yanked by our own save.
  useEffect(() => {
    const api = window.box;
    if (!api) return;
    return api.onWorkspaceChanged((e) => {
      const s = useBoxStore.getState();
      setFiles(e.files);
      s.setProblems(e.problems.map(fmtProblem));
      setRemote({
        brokenNodes: new Set(e.brokenNodes),
        brokenEdges: new Set(e.brokenEdges),
      });
      const { boardPath: bp, board: cur, workspaceRoot: root } = s;
      if (root && bp && e.changedPaths.includes(bp)) {
        void (async () => {
          const text = await api.readFile(root, bp);
          if (text === null) {
            s.setProblems([`board deleted on disk: ${bp}`]);
            return;
          }
          const { value, problems } = parseBoard(text, bp);
          if (value && serializeBoard(value) !== serializeBoard(cur!)) {
            openBoard(bp, value, problems);
          }
        })();
      }
      // External edit to the open note: reload unless the user is editing.
      const openPath = edgeNote?.path;
      if (
        root &&
        openPath &&
        e.changedPaths.includes(openPath) &&
        !noteDirty.current
      ) {
        void api.readFile(root, openPath).then((text) => {
          if (text === null) return;
          const { value } = parseLinkNote(text, openPath);
          if (value) setEdgeNote(value);
        });
      } else if (root && openPath && e.changedPaths.includes(openPath)) {
        setNoteStale(true);
      }
    });
  }, [edgeNote?.path]);

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
      setEdgeNote(null);
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Edge selected -> load its link note (the meaning half of the wedge).
  const selectEdge = async (edgeId: string | null) => {
    if (edgeId === null || !workspaceRoot || !window.box) {
      setEdgeNote(null);
      noteDirty.current = false;
      setNoteStale(false);
      return;
    }
    const edge = board?.edges.find((e) => e.id === edgeId);
    const rel =
      (edge?.["box-link"] as string | undefined) ?? linkNoteName(edgeId);
    const text = await window.box.readFile(workspaceRoot, rel);
    if (text === null) {
      setEdgeNote(null);
      useBoxStore.getState().setProblems([`link note missing on disk: ${rel}`]);
      return;
    }
    const { value, problems } = parseLinkNote(text, rel);
    if (value) {
      setEdgeNote(value);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      setEdgeNote(null);
      useBoxStore.getState().setProblems(problems.map(fmtProblem));
    }
  };

  const saveNote = async (next: LinkNote) => {
    if (!workspaceRoot || !window.box) return;
    const r = await window.box.writeFileAtomic(
      workspaceRoot,
      next.path,
      serializeLinkNote(next),
    );
    if (r.ok) {
      setEdgeNote(next);
      noteDirty.current = false;
      setNoteStale(false);
    } else {
      useBoxStore.getState().setProblems([`note save failed: ${r.error}`]);
    }
  };

  // Broken-file detection: file nodes whose target isn't in the workspace.
  const brokenNodes = useMemo(() => {
    const have = new Set(files.map((f) => f.path));
    const missing = new Set(remote?.brokenNodes ?? []);
    for (const n of board?.nodes ?? []) {
      if (n.type === "file" && !have.has(n.file)) missing.add(n.id);
    }
    return missing;
  }, [board, files, remote]);

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
            wheel: pan / ctrl+wheel: zoom / drag nodes / click an edge for its
            note
          </span>
        </div>
        <div className="board-body">
          <BoardView
            board={board}
            brokenNodes={brokenNodes}
            brokenEdges={remote?.brokenEdges}
            onMove={moveNode}
            onCommit={() => void saveBoard()}
            onCreateEdge={(f, t, fs, ts) => void createEdge(f, t, fs, ts)}
            onDeleteEdge={(id) => void deleteEdge(id)}
            onSelectEdge={(id) => void selectEdge(id)}
          />
          {edgeNote && (
            <NotePanel
              note={edgeNote}
              stale={noteStale}
              onSave={(n) => void saveNote(n)}
              onClose={() => setEdgeNote(null)}
              onDirtyChange={(d) => {
                noteDirty.current = d;
              }}
            />
          )}
        </div>
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
          <FileList files={files} onOpen={(p) => void loadBoardFile(p)} />
        </>
      )}
    </main>
  );
}
