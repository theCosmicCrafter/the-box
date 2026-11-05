// SPDX-License-Identifier: LicenseRef-Proprietary
// syncState.ts - ADR-0011 persisted sync memory (.box/known.json).
// Derived disposable cache: safe to delete. Rebuildable from raw files.
// Enables I-3 closed-app note deletion and R-G closed-app rename pairing.

export interface SyncStateFileRecord {
  size: number;
  mtime?: number | undefined;
}

export interface SyncState {
  v: 1;
  updated?: string | undefined;
  knownNotes: string[];
  files: Record<string, SyncStateFileRecord>;
}

export const SYNC_STATE_FILE = ".box/known.json" as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Total parser for .box/known.json. Never throws on malformed JSON. */
export function parseSyncState(raw: string): SyncState | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(doc)) return null;
  if (doc["v"] !== 1) return null;

  const rawNotes = doc["knownNotes"];
  const knownNotes: string[] = [];
  if (Array.isArray(rawNotes)) {
    for (const id of rawNotes) {
      if (typeof id === "string" && id.length > 0) {
        knownNotes.push(id);
      }
    }
  }

  const rawFiles = doc["files"];
  // Null-prototype record: known.json is app-managed but the workspace is
  // untrusted input, and a file literally named "__proto__" must land as
  // an own key instead of mutating the object's prototype.
  const files = Object.create(null) as Record<string, SyncStateFileRecord>;
  if (isObj(rawFiles)) {
    for (const [path, entry] of Object.entries(rawFiles)) {
      if (isObj(entry) && typeof entry["size"] === "number") {
        files[path] = {
          size: entry["size"],
          ...(typeof entry["mtime"] === "number"
            ? { mtime: entry["mtime"] }
            : {}),
        };
      }
    }
  }

  return {
    v: 1,
    ...(typeof doc["updated"] === "string"
      ? { updated: doc["updated"] }
      : {}),
    knownNotes,
    files,
  };
}

/** Deterministic serialization for .box/known.json. */
export function serializeSyncState(state: SyncState): string {
  const sortedNotes = [...new Set(state.knownNotes)].sort();
  const sortedFiles = Object.create(null) as Record<
    string,
    SyncStateFileRecord
  >;
  for (const path of Object.keys(state.files).sort()) {
    const entry = state.files[path];
    if (entry !== undefined) {
      sortedFiles[path] = entry;
    }
  }
  const normalized: SyncState = {
    v: 1,
    ...(state.updated !== undefined ? { updated: state.updated } : {}),
    knownNotes: sortedNotes,
    files: sortedFiles,
  };
  return JSON.stringify(normalized, null, 2) + "\n";
}

/** Construct a SyncState object from sets/maps. */
export function createSyncState(
  knownNotes: Iterable<string>,
  files?:
    | Map<string, { size: number; mtime?: number | undefined }>
    | Record<string, SyncStateFileRecord>
    | undefined,
  nowIso = new Date().toISOString(),
): SyncState {
  const fileRecords = Object.create(null) as Record<
    string,
    SyncStateFileRecord
  >;
  if (files instanceof Map) {
    for (const [p, meta] of files) {
      fileRecords[p] = {
        size: meta.size,
        ...(meta.mtime !== undefined ? { mtime: meta.mtime } : {}),
      };
    }
  } else if (files !== undefined) {
    Object.assign(fileRecords, files);
  }

  return {
    v: 1,
    updated: nowIso,
    knownNotes: [...knownNotes],
    files: fileRecords,
  };
}
