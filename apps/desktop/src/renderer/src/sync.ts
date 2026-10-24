// SPDX-License-Identifier: LicenseRef-Proprietary
// sync.ts - the watch->reconcile loop, ported from the Electron main
// process into the renderer. box-core is pure TS so the same tested code
// runs here; Rust now owns only filesystem primitives + fs-event emission
// (debounced "box:fs-dirty" pushed by the notify watcher in src-tauri).
// Session memory (prev snapshot, knownNotes) is session-scoped exactly as
// before: absent on restart means conservative never-seen.

import type {
  Board,
  InkSidecar,
  LinkNote,
  ParseResult,
  WorkspaceScan,
  WriteStep,
} from "@box/core";
import {
  baseName,
  classifyFileSet,
  createSyncState,
  edgeIdFromNoteName,
  isReconcilableBoard,
  parseBoard,
  parseInkSvg,
  parseLinkNote,
  parseSyncState,
  parseTombstones,
  reconcile,
  serializeSyncState,
  serializeTombstones,
  SYNC_STATE_FILE,
} from "@box/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceChanged, WorkspaceFile } from "./bridge.js";

const MAX_PASSES = 4;

interface CacheEntry<T> {
  size: number;
  mtime: number;
  parsed: ParseResult<T>;
}

const boardCache = new Map<string, CacheEntry<Board>>();
const noteCache = new Map<string, CacheEntry<LinkNote>>();
const inkCache = new Map<string, CacheEntry<InkSidecar>>();

const selfWrites = new Map<string, number>();
const SELF_WRITE_TTL_MS = 2000;

function markSelfWrite(path: string) {
  selfWrites.set(path, Date.now());
}

function isSelfWrite(path: string): boolean {
  const t = selfWrites.get(path);
  if (t === undefined) return false;
  if (Date.now() - t > SELF_WRITE_TTL_MS) {
    selfWrites.delete(path);
    return false;
  }
  return true;
}

export function clearSyncCaches() {
  boardCache.clear();
  noteCache.clear();
  inkCache.clear();
  selfWrites.clear();
}

let root: string | null = null;
let prev = new Map<string, { size: number; mtime?: number }>();
let knownNotes = new Set<string>();
let initialSyncDone = false;
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

/** Parse every board + root-level link note + ink sidecar; malformed -> problems ride along. */
async function buildScan(
  wsRoot: string,
  files: WorkspaceFile[],
  renames?: ReadonlyMap<string, string>,
): Promise<WorkspaceScan> {
  const toFetch: string[] = [];
  const currentPaths = new Set<string>();

  for (const f of files) {
    currentPaths.add(f.path);
    if (f.path.endsWith(".canvas")) {
      const cached = boardCache.get(f.path);
      if (!cached || cached.size !== f.size || cached.mtime !== f.mtime) {
        toFetch.push(f.path);
      }
    } else if (!f.path.includes("/") && edgeIdFromNoteName(f.path) !== null) {
      const cached = noteCache.get(f.path);
      if (!cached || cached.size !== f.size || cached.mtime !== f.mtime) {
        toFetch.push(f.path);
      }
    } else if (f.path.endsWith(".ink.svg")) {
      const cached = inkCache.get(f.path);
      if (!cached || cached.size !== f.size || cached.mtime !== f.mtime) {
        toFetch.push(f.path);
      }
    }
  }

  // Prune caches for deleted files
  for (const p of boardCache.keys()) {
    if (!currentPaths.has(p)) boardCache.delete(p);
  }
  for (const p of noteCache.keys()) {
    if (!currentPaths.has(p)) noteCache.delete(p);
  }
  for (const p of inkCache.keys()) {
    if (!currentPaths.has(p)) inkCache.delete(p);
  }

  // Batch read any new or modified files in a single IPC call
  if (toFetch.length > 0) {
    const batch = await invoke<Record<string, string | null>>("fs_read_batch", {
      root: wsRoot,
      rels: toFetch,
    });
    for (const f of files) {
      if (!(f.path in batch)) continue;
      const raw = batch[f.path];
      if (raw === null || raw === undefined) continue;

      if (f.path.endsWith(".canvas")) {
        if (isReconcilableBoard(f.path, raw)) {
          boardCache.set(f.path, {
            size: f.size,
            mtime: f.mtime,
            parsed: parseBoard(raw, f.path),
          });
        }
      } else if (!f.path.includes("/") && edgeIdFromNoteName(f.path) !== null) {
        noteCache.set(f.path, {
          size: f.size,
          mtime: f.mtime,
          parsed: parseLinkNote(raw, f.path),
        });
      } else if (f.path.endsWith(".ink.svg")) {
        inkCache.set(f.path, {
          size: f.size,
          mtime: f.mtime,
          parsed: parseInkSvg(raw, f.path),
        });
      }
    }
  }

  const boards = new Map<string, ParseResult<Board>>();
  const notes = new Map<string, ParseResult<LinkNote>>();
  const ink = new Map<string, ParseResult<InkSidecar>>();
  for (const [p, c] of boardCache) {
    if (currentPaths.has(p)) boards.set(p, c.parsed);
  }
  for (const [p, c] of noteCache) {
    if (currentPaths.has(p)) notes.set(p, c.parsed);
  }
  for (const [p, c] of inkCache) {
    if (currentPaths.has(p)) ink.set(p, c.parsed);
  }

  const tombRaw =
    (await invoke<string | null>("fs_read", {
      root: wsRoot,
      rel: ".box/tombstones.json",
    })) ?? "[]";
  const { active: tombstones, records, prunedCount } = parseTombstones(tombRaw);
  if (prunedCount > 0) {
    // Expired entries (>30 days per DATA-MODEL §4.3 & ADR-0011): prune ledger
    void invoke("fs_write_atomic", {
      root: wsRoot,
      rel: ".box/tombstones.json",
      content: serializeTombstones(records),
    });
  }
  return {
    boards,
    notes,
    ink,
    files: new Set(files.map((f) => f.path)),
    tombstones,
    knownNotes,
    ...(renames && renames.size > 0 ? { renames } : {}),
  };
}

async function execStep(wsRoot: string, step: WriteStep) {
  if (step.op === "write-atomic") {
    markSelfWrite(step.path);
    return await invoke<{ ok: boolean; error?: string }>("fs_write_atomic", {
      root: wsRoot,
      rel: step.path,
      content: step.content,
    });
  }
  if (step.op === "trash") {
    markSelfWrite(step.path);
    return await invoke<{ ok: boolean; error?: string }>("fs_trash", {
      root: wsRoot,
      rel: step.path,
    });
  }
  markSelfWrite(".box/tombstones.json");
  return await invoke<{ ok: boolean; error?: string }>("fs_append_tombstone", {
    root: wsRoot,
    edgeId: step.edgeId,
  });
}

/** Trigger one reconcile pass outside the watcher path (e.g. at open, so
 *  broken edges/notes surface before the first disk change). */
export async function requestSync(): Promise<void> {
  await runSync();
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

      // Self-write suppression (DATA-MODEL §5.2.4): if all detected deltas were
      // written by the app itself and we've already done initial convergence,
      // skip running a redundant reconcile cycle.
      const hasExternalChanges = deltas.some((d) => !isSelfWrite(d.path));
      if (!hasExternalChanges && initialSyncDone && deltas.length > 0) {
        prev = snapshot(files);
        continue;
      }

      const renames = new Map<string, string>();
      for (const d of deltas) {
        if (d.kind === "renamed" && d.to !== undefined) {
          renames.set(d.path, d.to);
        }
      }
      const changedPaths = new Set(
        deltas.flatMap((d) =>
          d.kind === "renamed" && d.to !== undefined
            ? [d.path, d.to]
            : [d.path],
        ),
      );

      // Reconcile to convergence (self-writes make later passes no-ops).
      let scan_ = await buildScan(wsRoot, files, renames);
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

      const shouldPersist = !initialSyncDone || pass > 0;
      initialSyncDone = true;

      knownNotes = new Set(
        [...scan_.notes.keys()]
          .map((p) => edgeIdFromNoteName(baseName(p)))
          .filter((id): id is string => id !== null),
      );
      prev = snapshot(files);

      if (shouldPersist) {
        const syncState = createSyncState(knownNotes, prev);
        markSelfWrite(SYNC_STATE_FILE);
        await invoke("fs_write_atomic", {
          root: wsRoot,
          rel: SYNC_STATE_FILE,
          content: serializeSyncState(syncState),
        });
      }

      if (
        deltas.length > 0 ||
        changedPaths.size > 0 ||
        pass > 0 ||
        report.problems.length > 0 ||
        report.brokenNodes.length > 0 ||
        report.brokenEdges.length > 0
      ) {
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
  initialSyncDone = false;
  const files = await invoke<WorkspaceFile[]>("scan", { root: wsRoot });

  // ADR-0011: load persisted sync memory from .box/known.json
  const knownRaw = await invoke<string | null>("fs_read", {
    root: wsRoot,
    rel: SYNC_STATE_FILE,
  });
  const persisted = knownRaw !== null ? parseSyncState(knownRaw) : null;
  if (persisted !== null) {
    knownNotes = new Set(persisted.knownNotes);
    prev = new Map(
      Object.entries(persisted.files).map(([p, r]) => [
        p,
        {
          size: r.size,
          ...(typeof r.mtime === "number" ? { mtime: r.mtime } : {}),
        },
      ]),
    );
  } else {
    prev = snapshot(files);
    knownNotes = new Set(
      files
        .filter((f) => !f.path.includes("/"))
        .map((f) => edgeIdFromNoteName(f.path))
        .filter((id): id is string => id !== null),
    );
  }
  root = wsRoot;
  unlisten = await listen("box:fs-dirty", () => void runSync());
  // First reconcile on open: R-E/R-F problems and broken sets surface
  // before any disk change. Deferred so every caller-side listener
  // (React mount effects) has already subscribed.
  queueMicrotask(() => void runSync());
  return { ok: true };
}

export function stopSyncSession() {
  if (unlisten !== null) unlisten();
  unlisten = null;
  root = null;
  clearSyncCaches();
  void invoke("unwatch");
}
