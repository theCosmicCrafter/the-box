# ADR-0011 - Sync persistence (.box/known.json) and ledger expiration

- **Status:** Accepted
- **Date:** 2026-10-23
- **Relates:** DATA-MODEL §1, §4.3, §6, §7 (I-3, I-4, I-5), PRD FR-109, FR-301, ERR-3

## Context

The Box's files-are-truth contract requires that all state reconstructs
fully if caches are deleted. However, two sync operations inherently depend
on memory of the previous file state:

1. **Closed-app link-note deletion (Invariant I-3, FR-301):**
   If a user deletes a `link-<id>.md` note in the OS or another editor while
   The Box is closed, the app on next open must distinguish between
   "a note that was deleted" (remove the edge from boards) and "a new edge
   whose note was never seen" (regenerate a stub note via rule R-A). Without
   persisted memory of known notes, cold start always assumes "never seen",
   resurrecting deleted arrows.

2. **Closed-app rename detection (Invariant I-5, Rule R-G):**
   Detecting a file rename requires comparing the previous file set against
   the current file set. Without a persisted snapshot, changes while closed
   appear as disconnected creates and deletes.

`docs/ARCHITECTURE.md` originally anticipated a full SQLite database
(`index.db`). In practice, `@box/core` and the Tauri desktop layer operate
as a lightweight file system kernel without SQLite bindings. Maintaining
SQLite solely to store note IDs and file modification times introduces
unnecessary platform dependencies and binary bloat.

Furthermore, two related ledger and error-repair mechanisms require fixes:
- The tombstone ledger (`.box/tombstones.json`) was implemented as a raw
  `string[]` that never expired, preventing users from recovering notes
  from the Recycle Bin without them being immediately re-trashed.
- ERR-3 specified that when a link note's filename slug disagrees with its
  internal `box-edge` frontmatter, reconcile repairs `box-edge` to match
  the filename. The parser previously rejected the file with `value: null`,
  leaving dead code in reconcile and failing to perform the repair.

## Decision

1. **Persisted Sync State (`.box/known.json`):**
   The app stores derived sync memory in `.box/known.json`:
   ```json
   {
     "v": 1,
     "knownNotes": ["7f3a9c2b1d4e5f6a"],
     "files": {
       "concept.png": { "size": 12040, "mtime": 1729680000000 }
     }
   }
   ```
   - **Disposable Cache:** Like `index.db` in the original spec, `.box/known.json`
     is purely derived cache. Deleting it is safe and triggers conservative
     reconciliation (no note is ever deleted when memory is absent).
   - **Startup & Save:** The desktop sync watcher loads `.box/known.json` on
     session startup. On convergence of any reconcile pass that changes files
     or note inventory, `.box/known.json` is atomically written.
   - **Format Version:** Schema version `v: 1`. Missing or unparseable files
     fall back to an empty cache without crashing.

2. **Tombstone Ledger Schema & Expiration (DATA-MODEL §4.3):**
   `.box/tombstones.json` stores timestamped entries:
   ```json
   [
     { "edgeId": "7f3a9c2b1d4e5f6a", "at": 1729680000000 }
   ]
   ```
   - Legacy arrays of strings (`["id1", "id2"]`) are parsed and normalized on
     read with current timestamp.
   - Entries older than 30 days (`30 * 24 * 60 * 60 * 1000` ms) are automatically
     pruned on load and write.
   - The Rust platform IPC (`fs_append_tombstone`) appends `{ "edgeId": id, "at": now }`.

3. **ERR-3 Filename Identity Repair:**
   Per DATA-MODEL §3.1 and §9, the filename is the identity. When
   `link-<slug>.md` has `box-edge: <other>`:
   - `parseLinkNote` records a problem item but still returns `value` containing
     the parsed note.
   - Reconcile inspects `note.frontmatter["box-edge"] !== slug`. When they
     differ, reconcile emits an atomic write updating the file's `box-edge` to
     `<slug>`. It does not rename or trash the file.

4. **Timestamp for R-A Stubs:**
   R-A stub notes generated when an edge lacks a note will use the current
   UTC time rather than the 1970 UNIX epoch.

## Consequences

- Invariant I-3 holds across app restarts: closed-app link note deletions
  cleanly remove edges rather than resurrecting notes.
- Invariant I-4 ("Reconstruct-from-files") is tested against deletion of
  `.box/known.json`.
- Restoring notes from the Recycle Bin after 30 days allows them to re-adopt
  cleanly without being perpetually re-trashed.
- Zero SQLite dependencies are introduced; sync memory remains human-readable
  JSON.
