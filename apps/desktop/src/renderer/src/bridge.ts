// SPDX-License-Identifier: LicenseRef-Proprietary
// bridge.ts - installs window.box over Tauri invoke/listen. Same API
// surface the Electron preload exposed, so App.tsx is untouched.
// Awaited before first render so `platform` is known for media URLs
// (Windows custom schemes serve at https://box.localhost, real box://
// elsewhere).

import type { Delta, ProblemItem } from "@box/core";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { onWorkspaceChanged, requestSync, watchSyncSession } from "./sync.js";

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

export interface ImportResult {
  ok: boolean;
  imported: { rel: string; src: string }[];
  skipped: { src: string; reason: string }[];
}

export interface FileResult {
  ok: boolean;
  path?: string;
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
    requestSync: (): Promise<void> => requestSync(),
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
    // FR-305: user-picked app gets the file as argv[1] (detached spawn).
    openWith: (rel: string, app: string): Promise<CmdResult> =>
      invoke("fs_open_with", { rel, app }),
    pickApp: (): Promise<string | null> => invoke("pick_app"),
    // Copy OS-side files into the workspace (drag-drop, picker results).
    importFiles: (paths: string[]): Promise<ImportResult> =>
      invoke("import_files", { paths }),
    newFile: (
      dir: string,
      stem: string,
      ext: string,
      content: string,
    ): Promise<FileResult> =>
      invoke("new_text_file", { dir, stem, ext, content }),
    newBinaryFile: (
      dir: string,
      stem: string,
      ext: string,
      b64: string,
    ): Promise<FileResult> =>
      invoke("new_binary_file", { dir, stem, ext, b64 }),
    // Ctrl+D: copy a workspace file beside itself (`<stem>-copy[-N].<ext>`).
    copyFile: (rel: string): Promise<FileResult> => invoke("fs_copy", { rel }),
    // OS-associated icon for a file, cached as .box/icons/*.png (derived).
    fileIcon: (rel: string): Promise<FileResult> =>
      invoke("file_icon", { rel }),
    // Explorer/shell thumbnail (video frames, codec-installed types like
    // heic/cr3, .blend's registered handler), cached as .box/thumbs/*.png.
    fileThumb: (rel: string): Promise<FileResult> =>
      invoke("file_thumb", { rel }),
    pickFiles: (imagesOnly: boolean): Promise<string[]> =>
      invoke("pick_files", { imagesOnly }),
    // ADR-0010: decision calls travel through Rust (loopback-only) because
    // the webview CSP connect-src blocks outbound http by design.
    decidePost: (url: string, body: string): Promise<string> =>
      invoke("decide_post", { url, body }),
    // OS-level drag-drop (Tauri intercepts it - HTML5 dataTransfer drops
    // only carry in-app payloads). Position is physical pixels; callers
    // divide by devicePixelRatio for CSS coords.
    onFileDrop: (
      cb: (paths: string[], x: number, y: number) => void,
    ): Promise<() => void> =>
      getCurrentWebview().onDragDropEvent((ev) => {
        const p: DragDropEvent = ev.payload;
        if (p.type === "drop") cb(p.paths, p.position.x, p.position.y);
      }),
  };
}
