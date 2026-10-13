// SPDX-License-Identifier: LicenseRef-Proprietary
// Electron main - the platform. Adapts OS APIs to box-core interfaces.
// Workspace watch -> debounce -> rescan -> reconcile() -> execute WritePlan
// -> push the result to the renderer. The filesystem stays truth; reconcile
// is idempotent so our own writes echo harmlessly through the same loop.

import type {
  Board,
  LinkNote,
  ParseResult,
  WorkspaceScan,
  WriteStep,
} from "@box/core";
import {
  baseName,
  classifyFileSet,
  edgeIdFromNoteName,
  parseBoard,
  parseLinkNote,
  reconcile,
  resolveInside,
} from "@box/core";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
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

// box://f/<encoded-rel> serves workspace media to the renderer (img nodes,
// video, audio). resolveInside still guards - the scheme never escapes.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

// Must run before app ready (Electron contract for privileged schemes).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "box",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

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

// ---- WriteStep executors - shared by IPC handlers and the reconcile loop ----

async function writeAtomicFile(
  root: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = resolveInside(root, rel);
  if (abs === null) throw new Error(`path escapes workspace: ${rel}`);
  const tmpDir = join(root, ".box", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `w-${randomUUID()}.tmp`);
  await writeFile(tmp, content, "utf8");
  await mkdir(dirname(abs), { recursive: true });
  await rename(tmp, abs);
}

async function trashPath(root: string, rel: string): Promise<void> {
  const abs = resolveInside(root, rel);
  if (abs === null) throw new Error(`path escapes workspace: ${rel}`);
  await shell.trashItem(abs);
}

// Tombstone ledger: .box/tombstones.json is a JSON array of edge ids.
async function appendTombstoneFile(
  root: string,
  edgeId: string,
): Promise<void> {
  const tombRel = ".box/tombstones.json";
  const abs = resolveInside(root, tombRel);
  if (abs === null) throw new Error(`path escapes workspace: ${tombRel}`);
  const raw = await readFile(abs, "utf8").catch(() => "[]");
  let ids: string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    ids = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    ids = [];
  }
  if (!ids.includes(edgeId)) ids.push(edgeId);
  const tmpDir = join(root, ".box", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `t-${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(ids)}\n`, "utf8");
  await rename(tmp, abs);
}

async function execStep(root: string, step: WriteStep): Promise<void> {
  if (step.op === "write-atomic")
    await writeAtomicFile(root, step.path, step.content);
  else if (step.op === "trash") await trashPath(root, step.path);
  else await appendTombstoneFile(root, step.edgeId);
}

// ---- Watch session: fs.watch -> reconcile -> renderer push ----

const DEBOUNCE_MS = 150;
const MAX_PASSES = 4;

interface WatchSession {
  root: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
  prev: Map<string, { size: number; mtime?: number }>;
  /**
   * Edge ids whose link notes existed at last scan - reconcile's memory
   * (I-3 "note deleted" vs R-A "never seen"). Session-scoped: absent on
   * restart means conservative never-seen, regenerate never destroy.
   */
  knownNotes: Set<string>;
  syncing: boolean;
  queued: boolean;
  sender: Electron.WebContents;
}

let session: WatchSession | null = null;

const snapshot = (files: WorkspaceFile[]) =>
  new Map(files.map((f) => [f.path, { size: f.size, mtime: f.mtime }]));

/** Parse every board + root-level link note; malformed -> problems ride along. */
async function buildScan(
  root: string,
  files: WorkspaceFile[],
  knownNotes: Set<string>,
): Promise<WorkspaceScan> {
  const boards = new Map<string, ParseResult<Board>>();
  const notes = new Map<string, ParseResult<LinkNote>>();
  for (const f of files) {
    const abs = resolveInside(root, f.path);
    if (abs === null) continue;
    if (f.path.endsWith(".box.canvas")) {
      const raw = await readFile(abs, "utf8").catch(() => null);
      if (raw !== null) boards.set(f.path, parseBoard(raw, f.path));
    } else if (!f.path.includes("/") && edgeIdFromNoteName(f.path) !== null) {
      // Canonical link notes are root-level: box-link must equal link-<id>.md.
      const raw = await readFile(abs, "utf8").catch(() => null);
      if (raw !== null) notes.set(f.path, parseLinkNote(raw, f.path));
    }
  }
  const tombRaw = await readFile(
    join(root, ".box", "tombstones.json"),
    "utf8",
  ).catch(() => "[]");
  let tombstones = new Set<string>();
  try {
    const parsed: unknown = JSON.parse(tombRaw);
    if (Array.isArray(parsed))
      tombstones = new Set(
        parsed.filter((x): x is string => typeof x === "string"),
      );
  } catch {
    // Malformed ledger: treat as empty; never block sync on it.
  }
  return {
    boards,
    notes,
    files: new Set(files.map((f) => f.path)),
    tombstones,
    knownNotes,
  };
}

async function runSync(s: WatchSession): Promise<void> {
  if (s.syncing) {
    s.queued = true;
    return;
  }
  s.syncing = true;
  try {
    do {
      s.queued = false;
      let files = await scanDir(s.root);
      const deltas = classifyFileSet({ files: s.prev }, files);
      const changedPaths = new Set(
        deltas.flatMap((d) =>
          d.kind === "renamed" && d.to !== undefined
            ? [d.path, d.to]
            : [d.path],
        ),
      );

      // Reconcile to convergence (self-writes make later passes no-ops).
      let scan = await buildScan(s.root, files, s.knownNotes);
      let report = reconcile(scan);
      let pass = 0;
      while (report.plan.steps.length > 0 && pass < MAX_PASSES) {
        for (const step of report.plan.steps) {
          try {
            await execStep(s.root, step);
          } catch (err) {
            report.problems.push({
              kind: "malformed-board",
              path: "path" in step ? step.path : step.edgeId,
              detail: `exec failed: ${String(err)}`,
            });
          }
          if ("path" in step) changedPaths.add(step.path);
        }
        pass++;
        files = await scanDir(s.root);
        scan = await buildScan(s.root, files, s.knownNotes);
        report = reconcile(scan);
      }
      if (report.plan.steps.length > 0) {
        report.problems.push({
          kind: "malformed-board",
          path: s.root,
          detail: `reconcile did not converge after ${MAX_PASSES} passes`,
        });
      }

      // Memory update: known notes = whatever root-level link-*.md exist now.
      s.knownNotes = new Set(
        [...scan.notes.keys()]
          .map((p) => edgeIdFromNoteName(baseName(p)))
          .filter((id): id is string => id !== null),
      );
      s.prev = snapshot(files);

      if (deltas.length > 0 || changedPaths.size > 0 || pass > 0) {
        if (!s.sender.isDestroyed()) {
          s.sender.send("workspace:changed", {
            files,
            deltas,
            changedPaths: [...changedPaths],
            problems: report.problems,
            brokenNodes: report.brokenNodes,
            brokenEdges: report.brokenEdges,
          });
        }
      }
    } while (s.queued);
  } finally {
    s.syncing = false;
  }
}

function stopSession(): void {
  if (session === null) return;
  if (session.timer !== null) clearTimeout(session.timer);
  session.watcher.close();
  session = null;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "The Box",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
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
  // Media protocol: box://f/<urlencoded workspace-relative path>.
  protocol.handle("box", async (req) => {
    const root = session?.root;
    if (!root) return new Response("no workspace", { status: 404 });
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(
      /^\/+/,
      "",
    );
    const abs = resolveInside(root, rel);
    if (abs === null) return new Response("forbidden", { status: 403 });
    const bytes = await readFile(abs).catch(() => null);
    if (bytes === null) return new Response("not found", { status: 404 });
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  });

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

  // fs.watch recursive: supported on Windows/macOS (our targets); Linux lacks
  // it - degrade to manual rescan with an explicit error, never silent.
  ipcMain.handle("workspace:watch", async (event, root: string) => {
    stopSession();
    let watcher: FSWatcher;
    try {
      watcher = watch(root, { recursive: true }, () => {
        if (session === null) return;
        if (session.timer !== null) clearTimeout(session.timer);
        session.timer = setTimeout(() => void runSync(session!), DEBOUNCE_MS);
      });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    const files = await scanDir(root);
    session = {
      root,
      watcher,
      timer: null,
      prev: snapshot(files),
      knownNotes: new Set(
        files
          .filter((f) => !f.path.includes("/"))
          .map((f) => edgeIdFromNoteName(f.path))
          .filter((id): id is string => id !== null),
      ),
      syncing: false,
      queued: false,
      sender: event.sender,
    };
    return { ok: true };
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
      try {
        await writeAtomicFile(root, rel, content);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // Deletion means the OS Recycle Bin - never a hard delete (house rule).
  ipcMain.handle("fs:trash", async (_e, root: string, rel: string) => {
    try {
      await trashPath(root, rel);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "fs:appendTombstone",
    async (_e, root: string, edgeId: string) => {
      try {
        await appendTombstoneFile(root, edgeId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopSession();
  if (process.platform !== "darwin") app.quit();
});
