# ADR-0007: Undo model - session snapshots now, op-log file later

|              |                                                                  |
| ------------ | ---------------------------------------------------------------- |
| **Status**   | Accepted                                                         |
| **Date**     | 2026-10-13                                                       |
| **Deciders** | Christian + agent                                                |
| **Refs**     | ROADMAP "Undo-as-file-data" (T-14 Tietze pattern), DATA-MODEL §2 |

## Context

The canvas had no undo at all. The ROADMAP already records the accepted end
state - "undo-as-file-data": persist the op log in or beside `.box.canvas` so
undo survives restart and itself round-trips through files (files-are-truth).

A persisted log needs a stable op vocabulary (op kinds, payload shapes,
compaction, cross-session merge). Shipping the log format before that
vocabulary settles would create a format we must keep reading forever.

## Decision

1. **v1 (this change): session-scoped snapshot undo.** The renderer keeps an
   in-memory stack of `{nodes, edges}` board snapshots (array references -
   O(1) per entry because store updates are persistent/immutable). A snapshot
   is captured once per user operation, coalesced across in-flight gestures
   (a drag = one entry no matter how many `moveNode` ticks). Ctrl+Z / Ctrl+Y
   (and Ctrl+Shift+Z) restore and immediately persist through the normal
   `saveBoard` path - undo never invents a second write path.
2. **Edge create/delete are excluded from undo.** Edge deletion writes a
   tombstone and trashes the link note; resurrecting it would require
   trash-restore + tombstone retraction inside reconcile - semantics the
   crash-window tests deliberately leave to the recoverable-by-design path
   (I-2). Nodes-only undo cannot violate invariants.
3. **v2 (implemented 2026-10-17): persisted snapshot-delta log.** The
   vocabulary freeze turned out to be unnecessary - we never needed an
   op vocabulary, because a delta-of-snapshots is op-agnostic by
   construction. Each undo entry records only the entities that
   _changed_ between consecutive stack snapshots, stored as their
   _next_ versions (or `null` if removed). Encoding diffs two array
   references by id - O(changed) size, O(n) cost, and entity payloads
   stay opaque so unknown keys and future fields ride through for free.

   File: `.box/oplog-<board-stem>-<fnv64(boardRel)>.json`, one JSON
   document per board (not NDJSON - the file is rewritten atomically
   per flush, never appended):

   ```json
   { "v": 1, "board": "main.box.canvas",
     "base": { "nodes": [...], "edges": [...] },
     "entries": [ { "nodes": {"n-1": {...}|null}, "edges": {} } ] }
   ```

   - `base` = the oldest stack snapshot; `entries[i]` = forward delta
     from snapshot i to i+1. Replay = base + cumulative deltas.
   - The in-memory stack keeps full snapshots (O(1) push, unchanged
     semantics); deltas are computed only at flush time between
     consecutive in-memory snapshots.
   - Persist is debounced (~800 ms after the last op) and travels the
     normal atomic `writeFile` channel - never a second write path.
   - Load happens on board open when the `board` key matches; replay
     seeds `undoStack` and the redo stack starts empty (standard).
   - Cap 100 persisted entries; overflow folds the oldest delta into
     `base` (the log can never grow without bound).
   - `.box/oplog-*` is app-managed state like settings/index: if it is
     missing or corrupt, undo simply starts empty - it is never
     authoritative about board truth.
   - The same file is the audit trail: a user (or Stage-4 agent) can
     read exactly which entities each op touched.

## Consequences

- Users get expected Ctrl+Z semantics today for placement ops: move, resize,
  nudge, place, remove-placement, create, duplicate, group, text/color edits.
- Undo state now survives restart via `.box/oplog-*` files; deleting one
  forfeits history for that board only, and board truth is unaffected.
- Edge create/delete remain excluded (tombstone semantics); the log can
  never resurrect a note.
- No board-file format change; unknown node/edge keys ride through deltas
  verbatim because payloads are stored wholesale by id.
- Redo stack clears on any new user op and is never persisted.

## Alternatives considered

- **Inverse-op stack** (store do/undo op pairs): less memory at scale but
  requires enumerating every mutation type now - exactly the vocabulary
  freeze we're deferring. Snapshot restore is type-agnostic.
- **Full-snapshot log** (every entry a complete board): O(board) per entry
  makes the file unusable past ~10 ops on real boards; delta form was the
  same work for O(changed).
- **NDJSON append-only:** avoids rewriting but needs compaction passes and
  partial-read tail repair; a single atomic rewrite at flush time is
  simpler and the debounce bounds the write rate.
