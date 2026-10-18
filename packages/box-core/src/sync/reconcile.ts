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
  InkSidecar,
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
  knownNotes?: Set<string> | undefined;
  /**
   * File rename mapping (oldPath -> newPath) from classifyFileSet rename
   * deltas (Rule R-G / DATA-MODEL §4.4 & §6, Invariant I-5).
   */
  renames?: ReadonlyMap<string, string> | undefined;
  /**
   * Parsed .ink.svg sidecars keyed by workspace-relative path (ERR-8).
   */
  ink?: ReadonlyMap<string, ParseResult<InkSidecar>> | undefined;
}

function notePathFor(edgeId: string): string {
  return linkNoteName(edgeId);
}

function nodeFileOf(
  board: Board | undefined,
  nodeId: string,
): string | undefined {
  if (board === undefined) return undefined;
  const n = board.nodes.find((node) => node.id === nodeId);
  return n?.type === "file" ? n.file : undefined;
}

function stubNote(
  edge: CanvasEdge,
  boardPathRel: string,
  board?: Board,
): LinkNote {
  const fromFile = nodeFileOf(board, edge.fromNode);
  const toFile = nodeFileOf(board, edge.toNode);
  return {
    path: notePathFor(edge.id),
    frontmatter: {
      "box-edge": edge.id,
      "box-format": LINK_NOTE_FORMAT,
      from: edge.fromNode,
      to: edge.toNode,
      board: baseName(boardPathRel),
      ...(fromFile !== undefined ? { "from-file": fromFile } : {}),
      ...(toFile !== undefined ? { "to-file": toFile } : {}),
      ...(typeof edge.label === "string" && edge.label !== ""
        ? { type: edge.label }
        : {}),
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
  const recordBoardWrite = (path: string, fixed: Board): void => {
    boardsChanged.set(path, fixed);
    const content = serializeBoard(fixed);
    const existing = steps.find(
      (s): s is Extract<WriteStep, { op: "write-atomic" }> =>
        s.op === "write-atomic" && s.path === path,
    );
    if (existing !== undefined) {
      existing.content = content;
    } else {
      steps.push({ op: "write-atomic", path, content });
    }
  };

  // R-G: rename propagation (DATA-MODEL §4.4 & §6, Invariant I-5).
  // Ordering: boards first, then note denorms below. Node IDs and placement
  // coordinates are never altered.
  if (scan.renames !== undefined && scan.renames.size > 0) {
    const renames = scan.renames;
    for (const [path, res] of scan.boards) {
      if (res.value === null) continue;
      let changed = false;
      const nextNodes = res.value.nodes.map((node) => {
        if (node.type !== "file") return node;
        const nextFile = renames.get(node.file);
        const inkVal = node["box-ink"];
        const nextInk =
          typeof inkVal === "string" ? renames.get(inkVal) : undefined;
        if (nextFile === undefined && nextInk === undefined) return node;
        changed = true;
        return {
          ...node,
          ...(nextFile !== undefined ? { file: nextFile } : {}),
          ...(nextInk !== undefined ? { "box-ink": nextInk } : {}),
        };
      });
      if (changed) {
        const fixed: Board = { ...res.value, nodes: nextNodes };
        recordBoardWrite(path, fixed);
      }
    }
  }

  for (const [path, res] of scan.boards) {
    if (res.value === null) {
      problems.push(...res.problems);
      continue;
    }
    const curBoard = boardOf(path) ?? res.value;
    const nodeIds = new Set(curBoard.nodes.map((n) => n.id));
    for (const node of curBoard.nodes) {
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
    for (const edge of curBoard.edges) {
      if (scan.tombstones.has(edge.id)) {
        // I-2 completion: a tombstoned edge dies on the board too, in the
        // same pass. Without this, R-D trashes the note while the edge
        // survives, and R-A regenerates the stub - oscillation until
        // MAX_PASSES whenever knownNotes memory is absent (fresh session).
        const b = boardOf(path);
        if (b !== null) {
          const fixed: Board = {
            ...b,
            edges: b.edges.filter((e) => e.id !== edge.id),
          };
          recordBoardWrite(path, fixed);
        }
        problems.push({
          kind: "tombstone-complete",
          path,
          detail: `edge ${edge.id} removed; was tombstoned`,
        });
        continue;
      }
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
            recordBoardWrite(path, fixed);
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
        const stub = stubNote(edge, path, boardOf(path) ?? curBoard);
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
            recordBoardWrite(path, fixed);
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
            ...(typeof note.frontmatter["type"] === "string" &&
            note.frontmatter["type"] !== ""
              ? { label: note.frontmatter["type"] }
              : {}),
            "box-link": linkNoteName(edgeId),
          };
          const fixed: Board = { ...b, edges: [...b.edges, edge] };
          recordBoardWrite(target, fixed);
          referencedNotes.set(edgeId, { boardPath: target, edge });
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
        // Tri-state: string = file node resolved; null = node exists but
        // is not a file node (key must drop); undefined = endpoint
        // dangles - the denorm is a fossil, kept untouched and never a
        // rewrite (convergence, DATA-MODEL denorm rule).
        const fileOf = (id: string): string | null | undefined => {
          const onHolder = b.nodes.find((n) => n.id === id);
          if (onHolder !== undefined)
            return onHolder.type === "file" ? onHolder.file : null;
          for (const bp of scan.boards.keys()) {
            const other = boardOf(bp);
            const found = other?.nodes.find((n) => n.id === id);
            if (found !== undefined)
              return found.type === "file" ? found.file : null;
          }
          return undefined;
        };
        const ff = fileOf(note.frontmatter.from);
        const tf = fileOf(note.frontmatter.to);
        const fm = { ...note.frontmatter };
        if (ff === null) delete fm["from-file"];
        else if (ff !== undefined) fm["from-file"] = ff;
        if (tf === null) delete fm["to-file"];
        else if (tf !== undefined) fm["to-file"] = tf;
        if (
          fm["from-file"] !== note.frontmatter["from-file"] ||
          fm["to-file"] !== note.frontmatter["to-file"]
        ) {
          steps.push({
            op: "write-atomic",
            path: notePath,
            content: serializeLinkNote({ ...note, frontmatter: fm }),
          });
        }
        // Edge label denorm: note `type` -> board edge `label` (FR-204).
        const edge = b.edges.find((e) => e.id === edgeId);
        const want =
          typeof note.frontmatter["type"] === "string" &&
          note.frontmatter["type"] !== ""
            ? note.frontmatter["type"]
            : undefined;
        if (edge && edge.label !== want) {
          const fixed: Board = {
            ...b,
            edges: b.edges.map((e) => {
              if (e.id !== edgeId) return e;
              // Clearing means dropping the key - exactOptionalPropertyTypes
              // forbids an explicit `label: undefined`.
              const rest = { ...e };
              delete rest.label;
              return want === undefined ? rest : { ...rest, label: want };
            }),
          };
          recordBoardWrite(holder.boardPath, fixed);
        }
      }
    }
  }

  // ERR-8: malformed .ink.svg sidecars are surfaced in problems, never dropped.
  if (scan.ink !== undefined) {
    for (const [, inkRes] of scan.ink) {
      if (inkRes.value === null) {
        problems.push(...inkRes.problems);
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
