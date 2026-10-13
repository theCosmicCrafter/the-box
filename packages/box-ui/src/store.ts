// SPDX-License-Identifier: LicenseRef-Proprietary
// Renderer store - Zustand 5 (surveyed slot). Workspace surface + board
// state; camera stays component-local inside the Viewport seam.

import type { Board, ProblemItem } from "@box/core";
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
  setWorkspace: (root: string, files: WorkspaceFile[]) => void;
  setFiles: (files: WorkspaceFile[]) => void;
  setProblems: (problems: string[]) => void;
  openBoard: (path: string, board: Board, problems: ProblemItem[]) => void;
  closeBoard: () => void;
  moveNode: (id: string, x: number, y: number) => void;
}

export const useBoxStore = create<BoxState>((set) => ({
  workspaceRoot: null,
  files: [],
  problems: [],
  boardPath: null,
  board: null,
  boardProblems: [],
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
}));
