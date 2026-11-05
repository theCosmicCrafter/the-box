// SPDX-License-Identifier: LicenseRef-Proprietary
// useWorkspaceWatcher.ts - the round-trip half of the wedge: whatever
// the Rust watcher reports, apply it. File list + problems + reconcile
// broken sets refresh wholesale; deleted paths drop their excerpts;
// renames carry an excerpt to the new path; placed files re-read their
// excerpts; the open board reloads only when its serialized content
// truly changed (self-write echoes compare identical and are skipped,
// so a mid-drag board is never yanked by our own save); ink sidecars
// reload; an open link note reloads unless the user is mid-edit (then
// it goes stale-flagged). Extracted from App.tsx.

import type { CanvasNode, LinkNote, ProblemItem } from "@box/core";
import { fileKind, parseBoard, parseLinkNote, serializeBoard } from "@box/core";
import { useBoxStore } from "@box/ui";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const fmtProblem = (p: ProblemItem) => `${p.kind}: ${p.path} - ${p.detail}`;

export interface RemoteBroken {
  brokenNodes: Set<string>;
  brokenEdges: Set<string>;
}

export function useWorkspaceWatcher(deps: {
  edgeNotePath: string | undefined;
  noteDirty: { current: boolean };
  setEdgeNote: (n: LinkNote | null) => void;
  setNoteStale: (stale: boolean) => void;
  fileTexts: Map<string, string>;
  setFileTexts: Dispatch<SetStateAction<Map<string, string>>>;
  setInspectPath: Dispatch<SetStateAction<string | null>>;
  reloadInk: () => Promise<void>;
}) {
  const {
    edgeNotePath,
    noteDirty,
    setEdgeNote,
    setNoteStale,
    fileTexts,
    setFileTexts,
    setInspectPath,
    reloadInk,
  } = deps;
  const { workspaceRoot, setFiles, openBoard } = useBoxStore();
  // Reconcile-authoritative broken sets (pushed by the watcher).
  const [remote, setRemote] = useState<RemoteBroken | null>(null);

  useEffect(() => {
    const api = window.box;
    if (!api) return;
    const un = api.onWorkspaceChanged((e) => {
      const s = useBoxStore.getState();
      setFiles(e.files);
      s.setProblems(e.problems.map(fmtProblem));
      setRemote({
        brokenNodes: new Set(e.brokenNodes),
        brokenEdges: new Set(e.brokenEdges),
      });
      for (const d of e.deltas) {
        if (d.kind === "deleted") {
          setFileTexts((prev) => {
            if (!prev.has(d.path)) return prev;
            const next = new Map(prev);
            next.delete(d.path);
            return next;
          });
        } else if (d.kind === "renamed" && d.to !== undefined) {
          const to = d.to;
          setInspectPath((cur) => (cur === d.path ? to : cur));
          setFileTexts((prev) => {
            const ex = prev.get(d.path) ?? fileTexts.get(d.path);
            if (ex === undefined) return prev;
            const next = new Map(prev);
            next.delete(d.path);
            next.set(to, ex);
            return next;
          });
        }
      }
      const { boardPath: bp, board: cur, workspaceRoot: root } = s;
      // External edits to placed file nodes: refresh their in-memory text excerpts immediately.
      const placedFiles = new Set(
        s.board?.nodes
          .filter((n): n is CanvasNode & { type: "file" } => n.type === "file")
          .map((n) => n.file) ?? [],
      );
      for (const p of e.changedPaths) {
        if (placedFiles.has(p) && root) {
          void api.readFile(root, p).then((text) => {
            if (text !== null) {
              const cap =
                fileKind(p) === "board"
                  ? 256 * 1024
                  : fileKind(p) === "csv"
                    ? 8 * 1024
                    : 400;
              setFileTexts((prev) => new Map(prev).set(p, text.slice(0, cap)));
            }
          });
        }
      }
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
      // External edit to an ink sidecar: refresh the overlays.
      if (root && e.changedPaths.some((p) => p.endsWith(".ink.svg"))) {
        void reloadInk();
      }
      // External edit to the open note: reload unless the user is editing.
      const openPath = edgeNotePath;
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
    return un;
  }, [workspaceRoot, edgeNotePath]);

  return { remote };
}
