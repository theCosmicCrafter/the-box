// SPDX-License-Identifier: LicenseRef-Proprietary
// Renderer store - Zustand 5 (surveyed slot). Workspace surface + board
// state; camera stays component-local inside the Viewport seam.

import type { Board, CanvasEdge, CanvasNode, ProblemItem } from "@box/core";
import { create } from "zustand";

export interface WorkspaceFile {
  path: string;
  size: number;
  mtime: number;
}

export interface BoxState {
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  problems: string[];
  boardPath: string | null;
  board: Board | null;
  boardProblems: ProblemItem[];
  /** Obsidian-model sidebar visibility - persists across board open/close. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setWorkspace: (root: string, files: WorkspaceFile[]) => void;
  setFiles: (files: WorkspaceFile[]) => void;
  setProblems: (problems: string[]) => void;
  openBoard: (path: string, board: Board, problems: ProblemItem[]) => void;
  closeBoard: () => void;
  moveNode: (id: string, x: number, y: number) => void;
  addNode: (node: CanvasNode) => void;
  removeNode: (id: string) => void;
  updateNode: (id: string, patch: Record<string, unknown>) => void;
  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (edgeId: string) => void;
  /** Re-route etc: patch an edge's fields, id and box-link untouched. */
  updateEdge: (edgeId: string, patch: Record<string, unknown>) => void;
  /** Undo restore: swap the whole node/edge arrays in one write. */
  restoreBoard: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;
}

export const useBoxStore = create<BoxState>((set) => ({
  workspaceRoot: null,
  files: [],
  problems: [],
  boardPath: null,
  board: null,
  boardProblems: [],
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setWorkspace: (root, files) => set({ workspaceRoot: root, files }),
  setFiles: (files) => set({ files }),
  setProblems: (problems) => set({ problems }),
  openBoard: (path, board, problems) =>
    set({ boardPath: path, board, boardProblems: problems }),
  closeBoard: () => set({ boardPath: null, board: null, boardProblems: [] }),
  moveNode: (id, x, y) =>
    set((s) =>
      s.board === null
        ? s
        : {
            board: {
              ...s.board,
              nodes: s.board.nodes.map((n) =>
                n.id === id ? { ...n, x, y } : n,
              ),
            },
          },
    ),
  addNode: (node) =>
    set((s) =>
      s.board === null
        ? s
        : { board: { ...s.board, nodes: [...s.board.nodes, node] } },
    ),
  removeNode: (id) =>
    set((s) =>
      s.board === null
        ? s
        : {
            board: {
              ...s.board,
              nodes: s.board.nodes.filter((n) => n.id !== id),
            },
          },
    ),
  updateNode: (id, patch) =>
    set((s) =>
      s.board === null
        ? s
        : {
            board: {
              ...s.board,
              nodes: s.board.nodes.map((n) =>
                n.id === id ? ({ ...n, ...patch } as CanvasNode) : n,
              ),
            },
          },
    ),
  addEdge: (edge) =>
    set((s) =>
      s.board === null
        ? s
        : { board: { ...s.board, edges: [...s.board.edges, edge] } },
    ),
  removeEdge: (edgeId) =>
    set((s) =>
      s.board === null
        ? s
        : {
            board: {
              ...s.board,
              edges: s.board.edges.filter((e) => e.id !== edgeId),
            },
          },
    ),
  updateEdge: (edgeId, patch) =>
    set((s) =>
      s.board === null
        ? s
        : {
            board: {
              ...s.board,
              edges: s.board.edges.map((e) =>
                e.id === edgeId ? ({ ...e, ...patch } as CanvasEdge) : e,
              ),
            },
          },
    ),
  restoreBoard: (nodes, edges) =>
    set((s) =>
      s.board === null ? s : { board: { ...s.board, nodes, edges } },
    ),
}));
