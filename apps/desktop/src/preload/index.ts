// SPDX-License-Identifier: LicenseRef-Proprietary
// Preload bridge - the renderer's only handle on the platform.

import { contextBridge, ipcRenderer } from "electron";

export interface WorkspaceFile {
  path: string;
  size: number;
  mtime: number;
}

export interface WorkspaceOpenResult {
  root: string;
  files: WorkspaceFile[];
}

const api = {
  openWorkspace: (): Promise<WorkspaceOpenResult | null> =>
    ipcRenderer.invoke("workspace:open"),
  rescan: (root: string): Promise<WorkspaceFile[]> =>
    ipcRenderer.invoke("workspace:rescan", root),
  readFile: (root: string, rel: string): Promise<string | null> =>
    ipcRenderer.invoke("fs:read", root, rel),
  writeFileAtomic: (
    root: string,
    rel: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("fs:writeAtomic", root, rel, content),
};

export type BoxApi = typeof api;

contextBridge.exposeInMainWorld("box", api);
