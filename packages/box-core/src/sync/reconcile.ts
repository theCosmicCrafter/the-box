// SPDX-License-Identifier: LicenseRef-Proprietary
// Reconcile - DATA-MODEL §6, rules R-A through R-G.
// Pure function of file state: same files in, same corrections out.
// Emits a WritePlan + report; the platform executes and logs.

import { serializeBoard, type ParseResult } from "../model/board.js";
import { edgeIdFromNoteName, linkNoteName } from "../model/ids.js";
import { serializeLinkNote } from "../model/linkNote.js";
import { baseName } from "../model/paths.js";
import type {
  Board,
  CanvasEdge,
  LinkNote,
  ProblemItem,
  ReconcileReport,
  WriteStep,
} from "../model/types.js";
import { LINK_NOTE_FORMAT } from "../model/types.js";

export interface WorkspaceScan {
  /** Parsed boards keyed by workspace-relative path. */
  boards: Map<string, ParseResult<Board>>;
  /** Parsed link notes keyed by workspace-relative path (value null = malformed). */
  notes: Map<string, ParseResult<LinkNote>>;
  /** All workspace file paths present on disk. */
  files: Set<string>;
  /** Tombstoned edge ids (.box/tombstones.json). */
  tombstones: Set<string>;
  /**
   * Edge ids whose link notes existed in the last-known index state.
   * Distinguishes "note deleted" (I-3: remove edge) from "note never seen"
   * (R-A: regenerate stub) - the index serves as memory, files stay truth.
   * Absent => conservative: treat as never-seen (regenerate, never destroy).
   */
  knownNotes?: Set<string>;
}

function notePathFor(edgeId: string): string {
  return linkNoteName(edgeId);
}

function stubNote(edge: CanvasEdge, boardPathRel: string): LinkNote {
  return {
    path: notePathFor(edge.id),
    frontmatter: {
      "box-edge": edge.id,
      "box-format": LINK_NOTE_FORMAT,
      from: edge.fromNode,
      to: edge.toNode,
      board: baseName(boardPathRel),
      created: new Date(0).toISOString(),
    },
    body: "",
  };
}

/** R-C: choose the board an orphan note's adopted edge lands on. */
function adoptionBoard(scan: WorkspaceScan, note: LinkNote): string | null {
  const preferred = note.frontmatter["board"];
  if (typeof preferred === "string") {
    for (const p of scan.boards.keys()) {
      if (baseName(p) === preferred) return p;
    }
  }
  return [...scan.boards.keys()][0] ?? null;
}

export function reconcile(scan: WorkspaceScan): ReconcileReport {
  const steps: WriteStep[] = [];
  const problems: ProblemItem[] = [];
  const brokenNodes: string[] = [];
  const brokenEdges: string[] = [];

  // Collect the edge ids every board references, and note files that exist.
  const referencedNotes = new Map<
    string,
    { boardPath: string; edge: CanvasEdge }
  >();
  const boardsChanged = new Map<string, Board>();
  const boardOf = (p: string): Board | null => {
    if (boardsChanged.has(p)) return boardsChanged.get(p) ?? null;
    return scan.boards.get(p)?.value ?? null;
  };

  for (const [path, res] of scan.boards) {
    if (res.value === null) {
      problems.push(...res.problems);
      continue;
    }
    const nodeIds = new Set(res.value.nodes.map((n) => n.id));
    for (const node of res.value.nodes) {
      if (node.type === "file" && !scan.files.has(node.file)) {
        // R-E: node renders broken, NOT removed (I-7)
        brokenNodes.push(node.id);
        problems.push({
          kind: "broken-node",
          path,
          detail: `node ${node.id} file missing: ${node.file}`,
        });
      }
    }
    for (const edge of res.value.edges) {
      if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
        // R-F: edge renders broken, note preserved (I-7)
        brokenEdges.push(edge.id);
        problems.push({
          kind: "broken-edge",
          path,
          detail: `edge ${edge.id} dangling endpoint`,
        });
      }
      referencedNotes.set(edge.id, { boardPath: path, edge });

      const noteGone =
        !scan.notes.has(notePathFor(edge.id)) &&
        !scan.files.has(notePathFor(edge.id));
      if (noteGone) {
        if (scan.knownNotes?.has(edge.id)) {
          // I-3: note was deleted (watcher missed it or app was closed) ->
          // remove the edge; do NOT regenerate. If the note ever comes back
          // (recycle-bin restore) it re-adopts via R-C.
          const b = boardOf(path);
          if (b !== null) {
            const fixed: Board = {
              ...b,
              edges: b.edges.filter((e) => e.id !== edge.id),
            };
            boardsChanged.set(path, fixed);
            steps.push({
              op: "write-atomic",
              path,
              content: serializeBoard(fixed),
            });
          }
          problems.push({
            kind: "edge-without-note",
            path,
            detail: `edge ${edge.id} removed; note deleted`,
          });
          continue;
        }
        // R-A: edge's note was never seen -> regenerate stub (repair)
        problems.push({
          kind: "edge-without-note",
          path,
          detail: `edge ${edge.id} missing note; regenerating stub`,
        });
        const stub = stubNote(edge, path);
        steps.push({
          op: "write-atomic",
          path: stub.path,
          content: serializeLinkNote(stub),
        });
        continue;
      }

      // R-B: note exists but (from,to) disagree -> note wins; align edge
      const noteRes = scan.notes.get(notePathFor(edge.id));
      if (noteRes?.value) {
        const fm = noteRes.value.frontmatter;
        if (fm.from !== edge.fromNode || fm.to !== edge.toNode) {
          const b = boardOf(path);
          if (b !== null) {
            const fixed: Board = {
              ...b,
              edges: b.edges.map((e) =>
                e.id === edge.id
                  ? { ...e, fromNode: fm.from, toNode: fm.to }
                  : e,
              ),
            };
            boardsChanged.set(path, fixed);
            steps.push({
              op: "write-atomic",
              path,
              content: serializeBoard(fixed),
            });
            problems.push({
              kind: "malformed-note",
              path,
              detail: `edge ${edge.id} endpoints realigned to note`,
            });
          }
        }
      }
    }
  }

  for (const [notePath, res] of scan.notes) {
    if (res.value === null) {
      // I-8: malformed note is surfaced, never silently dropped
      problems.push(...res.problems);
      continue;
    }
    const note = res.value;
    const edgeId = note.frontmatter["box-edge"];
    const slug = edgeIdFromNoteName(baseName(notePath));
    if (slug !== null && slug !== edgeId) {
      // filename!=box-edge: rename the file back to its slug (§3.1 repair)
      const dir = notePath.slice(
        0,
        notePath.length - baseName(notePath).length,
      );
      steps.push({
        op: "write-atomic",
        path: `${dir}${linkNoteName(edgeId)}`,
        content: serializeLinkNote(note),
      });
      steps.push({ op: "trash", path: notePath });
    }
    if (scan.tombstones.has(edgeId)) {
      // R-D: complete a crashed delete
      steps.push({ op: "trash", path: notePath });
      problems.push({
        kind: "tombstone-complete",
        path: notePath,
        detail: `orphan note ${edgeId} trashed (was tombstoned)`,
      });
      continue;
    }
    if (!referencedNotes.has(edgeId)) {
      // R-C: adopt orphan note - create edge on note.board or default board
      const target = adoptionBoard(scan, note);
      if (target !== null) {
        const b = boardOf(target);
        if (b !== null) {
          const edge: CanvasEdge = {
            id: edgeId,
            fromNode: note.frontmatter.from,
            toNode: note.frontmatter.to,
            toEnd: "arrow",
            "box-link": linkNoteName(edgeId),
          };
          const fixed: Board = { ...b, edges: [...b.edges, edge] };
          boardsChanged.set(target, fixed);
          steps.push({
            op: "write-atomic",
            path: target,
            content: serializeBoard(fixed),
          });
        }
      } else {
        problems.push({
          kind: "malformed-note",
          path: notePath,
          detail: `orphan note ${edgeId} has no board to adopt onto`,
        });
      }
    }

    // denorm refresh: from-file/to-file from the board node -> file mapping
    const holder = referencedNotes.get(edgeId);
    if (holder !== undefined) {
      const b = boardOf(holder.boardPath);
      if (b !== null) {
        const fileOf = (id: string) =>
          b.nodes.find((n) => n.id === id && n.type === "file")?.["file"] as
            | string
            | undefined;
        const ff = fileOf(note.frontmatter.from);
        const tf = fileOf(note.frontmatter.to);
        if (
          ff !== note.frontmatter["from-file"] ||
          tf !== note.frontmatter["to-file"]
        ) {
          const fixed: LinkNote = {
            ...note,
            frontmatter: {
              ...note.frontmatter,
              ...(ff !== undefined ? { "from-file": ff } : {}),
              ...(tf !== undefined ? { "to-file": tf } : {}),
            },
          };
          steps.push({
            op: "write-atomic",
            path: notePath,
            content: serializeLinkNote(fixed),
          });
        }
      }
    }
  }

  return {
    plan: { reason: "reconcile", steps },
    problems,
    brokenNodes,
    brokenEdges,
  };
}
