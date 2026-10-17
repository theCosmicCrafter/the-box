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
3. **v2 (accepted end state, deferred): persisted op-log.** When the op
   vocabulary stabilizes (placement ops, ink ops, group ops), the same op
   objects serialize append-only to `.box/<board>.oplog` (or a sidecar),
   giving restart-surviving undo that itself is a file. The v1 stack is a
   subset of that vocabulary, so the migration is additive.

## Consequences

- Users get expected Ctrl+Z semantics today for placement ops: move, resize,
  nudge, place, remove-placement, create, duplicate, group, text/color edits.
- Undo state dies with the session - acceptable gap, explicitly acknowledged.
- No file-format change, so no round-trip obligations added by v1.
- Redo stack clears on any new user op (standard linear undo).

## Alternatives considered

- **Inverse-op stack** (store do/undo op pairs): less memory at scale but
  requires enumerating every mutation type now - exactly the vocabulary
  freeze we're deferring. Snapshot restore is type-agnostic.
- **Jump straight to the persisted log:** rejected above.
