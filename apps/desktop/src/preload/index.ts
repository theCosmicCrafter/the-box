// SPDX-License-Identifier: LicenseRef-Proprietary
// Preload bridge - the renderer's only handle on the platform.

import type { Delta, ProblemItem } from "@box/core";
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

/** Pushed on every watcher reconcile pass that changed anything. */
export interface WorkspaceChangedEvent {
  files: WorkspaceFile[];
  deltas: Delta[];
  changedPaths: string[];
  problems: ProblemItem[];
  brokenNodes: string[];
  brokenEdges: string[];
}

const api = {
  openWorkspace: (): Promise<WorkspaceOpenResult | null> =>
    ipcRenderer.invoke("workspace:open"),
  rescan: (root: string): Promise<WorkspaceFile[]> =>
    ipcRenderer.invoke("workspace:rescan", root),
  lastWorkspace: (): Promise<string | null> =>
    ipcRenderer.invoke("workspace:last"),
  watchWorkspace: (root: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("workspace:watch", root),
  onWorkspaceChanged: (
    cb: (e: WorkspaceChangedEvent) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: WorkspaceChangedEvent) =>
      cb(p);
    ipcRenderer.on("workspace:changed", handler);
    return () => ipcRenderer.removeListener("workspace:changed", handler);
  },
  readFile: (root: string, rel: string): Promise<string | null> =>
    ipcRenderer.invoke("fs:read", root, rel),
  writeFileAtomic: (
    root: string,
    rel: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("fs:writeAtomic", root, rel, content),
  trashFile: (
    root: string,
    rel: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("fs:trash", root, rel),
  appendTombstone: (
    root: string,
    edgeId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("fs:appendTombstone", root, edgeId),
  /** Open a workspace file in its OS-default app (the "open with" pillar). */
  openExternal: (rel: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("workspace:openExternal", rel),
  /** Reveal a workspace file in the OS file manager. */
  revealFile: (rel: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("workspace:reveal", rel),
};

export type BoxApi = typeof api;

contextBridge.exposeInMainWorld("box", api);
