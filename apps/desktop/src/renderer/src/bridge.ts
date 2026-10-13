// SPDX-License-Identifier: LicenseRef-Proprietary
// bridge.ts - installs window.box over Tauri invoke/listen. Same API
// surface the Electron preload exposed, so App.tsx is untouched.
// Awaited before first render so `platform` is known for media URLs
// (Windows custom schemes serve at https://box.localhost, real box://
// elsewhere).

import { invoke } from "@tauri-apps/api/core";
import type { Delta, ProblemItem } from "@box/core";
import { onWorkspaceChanged, watchSyncSession } from "./sync.js";

export interface WorkspaceFile {
  path: string;
  size: number;
  mtime: number;
}

export interface WorkspaceOpenResult {
  root: string;
  files: WorkspaceFile[];
}

export interface WorkspaceChanged {
  files: WorkspaceFile[];
  deltas: Delta[];
  changedPaths: string[];
  problems: ProblemItem[];
  brokenNodes: string[];
  brokenEdges: string[];
}

interface CmdResult {
  ok: boolean;
  error?: string;
}

/** "windows" | "macos" | "linux" | "ios" | "android" - set at bridge init. */
export let boxPlatform = "unknown";

export async function installBoxBridge(): Promise<void> {
  boxPlatform = await invoke<string>("platform");
  const g = window as unknown as { box: unknown };
  g.box = {
    openWorkspace: (): Promise<WorkspaceOpenResult | null> =>
      invoke("open_workspace"),
    rescan: (root: string): Promise<WorkspaceFile[]> =>
      invoke("scan", { root }),
    lastWorkspace: (): Promise<string | null> => invoke("last_workspace"),
    watchWorkspace: (root: string): Promise<CmdResult> =>
      watchSyncSession(root),
    onWorkspaceChanged: (cb: (e: WorkspaceChanged) => void) =>
      onWorkspaceChanged(cb),
    readFile: (root: string, rel: string): Promise<string | null> =>
      invoke("fs_read", { root, rel }),
    writeFileAtomic: (
      root: string,
      rel: string,
      content: string,
    ): Promise<CmdResult> => invoke("fs_write_atomic", { root, rel, content }),
    trashFile: (root: string, rel: string): Promise<CmdResult> =>
      invoke("fs_trash", { root, rel }),
    appendTombstone: (root: string, edgeId: string): Promise<CmdResult> =>
      invoke("fs_append_tombstone", { root, edgeId }),
    openExternal: (rel: string): Promise<CmdResult> =>
      invoke("open_external", { rel }),
    revealFile: (rel: string): Promise<CmdResult> =>
      invoke("reveal_file", { rel }),
  };
}
