// SPDX-License-Identifier: LicenseRef-Proprietary
// Electron main - the platform. Adapts OS APIs to box-core interfaces.
// Stage 0 scope: window + folder picker + workspace scan -> file list.

import { resolveInside } from "@box/core";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WorkspaceFile {
  path: string; // forward-slash relative
  size: number;
  mtime: number;
}

const SKIP_DIRS = new Set([".box/tmp", "node_modules", ".git"]);

async function scanDir(root: string, rel = ""): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const relPath = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(relPath)) out.push(...(await scanDir(root, relPath)));
    } else if (e.isFile()) {
      const s = await stat(join(root, relPath)).catch(() => null);
      if (s !== null)
        out.push({ path: relPath, size: s.size, mtime: s.mtimeMs });
    }
  }
  return out;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "The Box",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  ipcMain.handle("workspace:open", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win!, {
      title: "Open a folder as a Box workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const root = r.filePaths[0]!;
    const files = await scanDir(root);
    return { root, files };
  });

  ipcMain.handle("workspace:rescan", async (_e, root: string) => {
    return await scanDir(root);
  });

  ipcMain.handle("fs:read", async (_e, root: string, rel: string) => {
    const abs = resolveInside(root, rel);
    if (abs === null) return null;
    return await readFile(abs, "utf8").catch(() => null);
  });

  // Atomic write per DATA-MODEL ordering: temp in .box/tmp, then rename.
  ipcMain.handle(
    "fs:writeAtomic",
    async (_e, root: string, rel: string, content: string) => {
      const abs = resolveInside(root, rel);
      if (abs === null) return { ok: false, error: "path escapes workspace" };
      const tmpDir = join(root, ".box", "tmp");
      await mkdir(tmpDir, { recursive: true });
      const tmp = join(tmpDir, `w-${randomUUID()}.tmp`);
      await writeFile(tmp, content, "utf8");
      await mkdir(dirname(abs), { recursive: true });
      await rename(tmp, abs);
      return { ok: true };
    },
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
