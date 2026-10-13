// SPDX-License-Identifier: LicenseRef-Proprietary
// Edge lifecycle WritePlans - DATA-MODEL §4.2, §4.3.
// box-core never writes; it emits step lists the platform executes in order.

import { serializeBoard } from "../model/board.js";
import { linkNoteName, newEdgeId } from "../model/ids.js";
import { serializeLinkNote } from "../model/linkNote.js";
import { baseName, parentDir } from "../model/paths.js";
import type { Board, CanvasEdge, LinkNote, WritePlan } from "../model/types.js";
import { LINK_NOTE_FORMAT } from "../model/types.js";

const BOARDS_DIR = ".box";
const NOTES_DIR = ""; // link notes live workspace-global at root (ADR-0003)

export function boardPath(name: string): string {
  return `${BOARDS_DIR}/${name}.box.canvas`;
}

export function defaultBoardName(boardPaths: string[]): string {
  return boardPaths[0] !== undefined
    ? baseName(boardPaths[0]).replace(/\.box\.canvas$/, "")
    : "main";
}

function fileOf(board: Board, nodeId: string): string | undefined {
  const n = board.nodes.find((n) => n.id === nodeId);
  return n?.type === "file" ? n.file : undefined;
}

/**
 * I-1: draw an edge -> note file first, board write second (§4.2).
 * from/to are node ids (authoritative); from-file/to-file are denorms.
 */
export function createEdgePlan(
  board: Board,
  boardPathRel: string,
  fromNodeId: string,
  toNodeId: string,
  opts: {
    type?: string;
    created?: string;
    fromSide?: CanvasEdge["fromSide"];
    toSide?: CanvasEdge["toSide"];
  } = {},
): { plan: WritePlan; edge: CanvasEdge; notePath: string } {
  const edgeId = newEdgeId();
  const noteRel = `${NOTES_DIR}${linkNoteName(edgeId)}`;
  const edge: CanvasEdge = {
    id: edgeId,
    fromNode: fromNodeId,
    toNode: toNodeId,
    ...(opts.fromSide !== undefined ? { fromSide: opts.fromSide } : {}),
    ...(opts.toSide !== undefined ? { toSide: opts.toSide } : {}),
    toEnd: "arrow",
    "box-link": linkNoteName(edgeId),
  };
  const fromFile = fileOf(board, fromNodeId);
  const toFile = fileOf(board, toNodeId);
  const note: LinkNote = {
    path: noteRel,
    frontmatter: {
      "box-edge": edgeId,
      "box-format": LINK_NOTE_FORMAT,
      from: fromNodeId,
      to: toNodeId,
      board: baseName(boardPathRel),
      ...(fromFile !== undefined ? { "from-file": fromFile } : {}),
      ...(toFile !== undefined ? { "to-file": toFile } : {}),
      ...(opts.type !== undefined ? { type: opts.type } : {}),
      created: opts.created ?? new Date().toISOString(),
    },
    body: "",
  };
  const nextBoard: Board = { ...board, edges: [...board.edges, edge] };
  return {
    plan: {
      reason: `create edge ${edgeId}`,
      steps: [
        { op: "write-atomic", path: noteRel, content: serializeLinkNote(note) },
        {
          op: "write-atomic",
          path: boardPathRel,
          content: serializeBoard(nextBoard),
        },
      ],
    },
    edge,
    notePath: noteRel,
  };
}

/**
 * I-2: erase an edge -> tombstone, board, trash (§4.3). Crash-safe:
 * a surviving orphan note whose id is tombstoned gets completed by R-D.
 */
export function deleteEdgePlan(
  board: Board,
  boardPathRel: string,
  edgeId: string,
  noteDir = NOTES_DIR,
): WritePlan {
  const nextBoard: Board = {
    ...board,
    edges: board.edges.filter((e) => e.id !== edgeId),
  };
  return {
    reason: `delete edge ${edgeId}`,
    steps: [
      { op: "append-tombstone", edgeId },
      {
        op: "write-atomic",
        path: boardPathRel,
        content: serializeBoard(nextBoard),
      },
      { op: "trash", path: `${noteDir}${linkNoteName(edgeId)}` },
    ],
  };
}

/**
 * I-3: a link note disappeared -> remove the edge from every board that
 * references it. Emitted by reconcile callers; pure function.
 */
export function orphanEdgeRemovalPlans(
  boards: { path: string; board: Board }[],
  missingNoteEdgeIds: Set<string>,
): WritePlan {
  const steps: WritePlan["steps"] = [];
  for (const { path, board } of boards) {
    const kept = board.edges.filter((e) => !missingNoteEdgeIds.has(e.id));
    if (kept.length !== board.edges.length) {
      steps.push({
        op: "write-atomic",
        path,
        content: serializeBoard({ ...board, edges: kept }),
      });
    }
  }
  return { reason: "remove edges whose notes are gone", steps };
}

/** Locate the board dir of a PathRel board path (always `.box`). */
export function boardsRoot(): string {
  return BOARDS_DIR;
}

export function noteParent(notePath: string): string {
  return parentDir(notePath);
}
