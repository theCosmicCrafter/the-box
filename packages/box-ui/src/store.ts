// SPDX-License-Identifier: LicenseRef-Proprietary
// Renderer store - Zustand 5 (surveyed slot). Camera internals land with the
// canvas engine (OQ-7); this is the Stage 0 workspace surface.

import { create } from 'zustand';

export interface WorkspaceFile {
  path: string;
  size: number;
  mtime: number;
}

export interface BoxState {
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  problems: string[];
  setWorkspace: (root: string, files: WorkspaceFile[]) => void;
  setFiles: (files: WorkspaceFile[]) => void;
  setProblems: (problems: string[]) => void;
}

export const useBoxStore = create<BoxState>((set) => ({
  workspaceRoot: null,
  files: [],
  problems: [],
  setWorkspace: (root, files) => set({ workspaceRoot: root, files }),
  setFiles: (files) => set({ files }),
  setProblems: (problems) => set({ problems }),
}));
