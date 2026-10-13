// SPDX-License-Identifier: LicenseRef-Proprietary
// sync.ts - the watch->reconcile loop, ported from the Electron main
// process into the renderer. box-core is pure TS so the same tested code
// runs here; Rust now owns only filesystem primitives + fs-event emission
// (debounced "box:fs-dirty" pushed by the notify watcher in src-tauri).
// Session memory (prev snapshot, knownNotes) is session-scoped exactly as
// before: absent on restart means conservative never-seen.

import type { Board, LinkNote, ParseResult, WorkspaceScan } from "@box/core";
import {
  baseName,
  classifyFileSet,
  edgeIdFromNoteName,
  parseBoard,
  parseLinkNote,
  reconcile,
} from "@box/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceChanged, WorkspaceFile } from "./bridge.js";

const MAX_PASSES = 4;

let root: string | null = null;
let prev = new Map<string, { size: number; mtime?: number }>();
let knownNotes = new Set<string>();
let syncing = false;
let queued = false;
let unlisten: UnlistenFn | null = null;
const listeners = new Set<(e: WorkspaceChanged) => void>();

export function onWorkspaceChanged(cb: (e: WorkspaceChanged) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const snapshot = (files: WorkspaceFile[]) =>
  new Map(files.map((f) => [f.path, { size: f.size, mtime: f.mtime }]));

/** Parse every board + root-level link note; malformed -> problems ride along. */
async function buildScan(
  wsRoot: string,
  files: WorkspaceFile[],
): Promise<WorkspaceScan> {
  const boards = new Map<string, ParseResult<Board>>();
  const notes = new Map<string, ParseResult<LinkNote>>();
  for (const f of files) {
    if (f.path.endsWith(".box.canvas")) {
      const raw = await invoke<string | null>("fs_read", {
        root: wsRoot,
        rel: f.path,
      });
      if (raw !== null) boards.set(f.path, parseBoard(raw, f.path));
    } else if (!f.path.includes("/") && edgeIdFromNoteName(f.path) !== null) {
      // Canonical link notes are root-level: box-link must equal link-<id>.md.
      const raw = await invoke<string | null>("fs_read", {
        root: wsRoot,
        rel: f.path,
      });
      if (raw !== null) notes.set(f.path, parseLinkNote(raw, f.path));
    }
  }
  const tombRaw =
    (await invoke<string | null>("fs_read", {
      root: wsRoot,
      rel: ".box/tombstones.json",
    })) ?? "[]";
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

async function execStep(wsRoot: string, step: WriteStep) {
  if (step.op === "write-atomic")
    return await invoke<{ ok: boolean; error?: string }>("fs_write_atomic", {
      root: wsRoot,
      rel: step.path,
      content: step.content,
    });
  if (step.op === "trash")
    return await invoke<{ ok: boolean; error?: string }>("fs_trash", {
      root: wsRoot,
      rel: step.path,
    });
  return await invoke<{ ok: boolean; error?: string }>("fs_append_tombstone", {
    root: wsRoot,
    edgeId: step.edgeId,
  });
}

async function runSync(): Promise<void> {
  const wsRoot = root;
  if (wsRoot === null) return;
  if (syncing) {
    queued = true;
    return;
  }
  syncing = true;
  try {
    do {
      queued = false;
      let files = await invoke<WorkspaceFile[]>("scan", { root: wsRoot });
      const deltas = classifyFileSet({ files: prev }, files);
      const changedPaths = new Set(
        deltas.flatMap((d) =>
          d.kind === "renamed" && d.to !== undefined
            ? [d.path, d.to]
            : [d.path],
        ),
      );

      // Reconcile to convergence (self-writes make later passes no-ops).
      let scan_ = await buildScan(wsRoot, files);
      let report = reconcile(scan_);
      let pass = 0;
      while (report.plan.steps.length > 0 && pass < MAX_PASSES) {
        for (const step of report.plan.steps) {
          const r = await execStep(wsRoot, step);
          if (!r.ok)
            report.problems.push({
              kind: "malformed-board",
              path: "path" in step ? step.path : step.edgeId,
              detail: `exec failed: ${r.error}`,
            });
          if ("path" in step) changedPaths.add(step.path);
        }
        pass++;
        files = await invoke<WorkspaceFile[]>("scan", { root: wsRoot });
        scan_ = await buildScan(wsRoot, files);
        report = reconcile(scan_);
      }
      if (report.plan.steps.length > 0) {
        report.problems.push({
          kind: "malformed-board",
          path: wsRoot,
          detail: `reconcile did not converge after ${MAX_PASSES} passes`,
        });
      }

      knownNotes = new Set(
        [...scan_.notes.keys()]
          .map((p) => edgeIdFromNoteName(baseName(p)))
          .filter((id): id is string => id !== null),
      );
      prev = snapshot(files);

      if (deltas.length > 0 || changedPaths.size > 0 || pass > 0) {
        const event: WorkspaceChanged = {
          files,
          deltas,
          changedPaths: [...changedPaths],
          problems: report.problems,
          brokenNodes: report.brokenNodes,
          brokenEdges: report.brokenEdges,
        };
        for (const cb of listeners) cb(event);
      }
    } while (queued);
  } finally {
    syncing = false;
  }
}

/** Start the Rust watcher + renderer reconcile loop for a workspace. */
export async function watchSyncSession(
  wsRoot: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await invoke<{ ok: boolean; error?: string }>("watch", {
    root: wsRoot,
  });
  if (!r.ok) return r;
  if (unlisten !== null) unlisten();
  const files = await invoke<WorkspaceFile[]>("scan", { root: wsRoot });
  prev = snapshot(files);
  knownNotes = new Set(
    files
      .filter((f) => !f.path.includes("/"))
      .map((f) => edgeIdFromNoteName(f.path))
      .filter((id): id is string => id !== null),
  );
  root = wsRoot;
  unlisten = await listen("box:fs-dirty", () => void runSync());
  return { ok: true };
}

export function stopSyncSession() {
  if (unlisten !== null) unlisten();
  unlisten = null;
  root = null;
  void invoke("unwatch");
}
