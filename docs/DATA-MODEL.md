# DATA-MODEL.md - File Formats, Write Semantics, Sync Contract

|             |                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**  | Binding contract. Where this spec is more specific than the PRD, this spec wins; where silent, the PRD wins. Changes require an ADR. |
| **Version** | 0.2 - 2026-10-12                                                                                                                     |

The Box's only durable state is files in a folder the user owns. Every index,
database, and cache is derived and may be deleted at any time; the workspace
must reconstruct fully and identically from files alone. This document defines
those files exactly enough that a reader who has never seen the code can write
conformant files and predict behavior on every malformed input.

## 1. Workspace layout

```
my-world/                        the workspace: an ordinary folder, user-owned
├── .box/                        the only folder the app owns
│   ├── <name>.box.canvas        board file(s), one per board (JSON Canvas superset)
│                               (foreign `*.canvas` anywhere ingests in place - ADR-0009)
│   ├── tombstones.json          pending-delete ledger (see 4.3; ADR-0011)
│   ├── known.json               DERIVED CACHE (sync state & known notes; ADR-0011). Safe to delete.
│   ├── embeddings.json          DERIVED CACHE (local vector index; ADR-0012). Safe to delete.
│   └── settings.json            per-type open-with prefs, UI view state (non-truth)
├── concept.png                  user file: an object
├── concept.png.ink.svg          ink sidecar for concept.png
├── notes/faction-a.md           a Markdown object (any depth of subfolders)
├── link-7f3a9c2b1d4e5f6.md      the arrow between two objects: a real note
└── trailer.mp4                  video object
```

Rules:

- A file with no placement record on any board is **in The Box** (holding
  area). Nothing is hidden by import; absence of placement is the only
  distinction.
- `.box/` contents are app-managed. `known.json` and `settings.json` are
  disposable. `tombstones.json` is small but load-bearing (4.3).
- Everything outside `.box/` is user territory. Folder structure, names, and
  organization are the user's; the app only writes placement records,
  link notes, and ink sidecars.

## 2. `*.box.canvas` - the board (box.canvas/1)

JSON Canvas 1.0-compatible superset. Unknown-key tolerance in Obsidian is
verified by plugin ecosystem evidence (advanced-canvas writes `floating`,
`fromFloating`, `toFloating`, `edgeStyle`, `customColor`, `canvasData`,
`metadata` into `.canvas` files and they persist across saves - verified
2026-10-12 from the installed plugin source). `box-*` extension keys follow
the same convention. Dogfood re-check of our exact keys is a Stage 1 task
(manual verification list, R-4).

### 2.1 Top level

| field        | type   | required | default | constraints                      | notes                    |
| ------------ | ------ | -------- | ------- | -------------------------------- | ------------------------ |
| `nodes`      | array  | yes      | `[]`    | z-order = array order (spec 1.0) | last = on top            |
| `edges`      | array  | yes      | `[]`    |                                  |                          |
| `box-format` | string | yes      | -       | `box.canvas/1`                   | format version marker    |
| `version`    | number | no       | `1`     | int >= 1                         | app-level schema version |

All other top-level keys are preserved verbatim on rewrite (forward tolerance).

### 2.2 Generic node (all types)

| field             | type   | required | default | constraints                                                 | notes                            |
| ----------------- | ------ | -------- | ------- | ----------------------------------------------------------- | -------------------------------- |
| `id`              | string | yes      | -       | `^n-[0-9a-z]{6,}$` new; donor-style 16-hex accepted on read | unique per board, never recycled |
| `type`            | string | yes      | -       | `text \| file \| link \| group`                             | JSON Canvas 1.0                  |
| `x`, `y`          | int    | yes      | -       | any int (may be negative)                                   | canvas coords, px                |
| `width`, `height` | int    | yes      | -       | 1..65535                                                    | px                               |
| `color`           | string | no       | -       | `"1"`-`"6"` preset or `"#RRGGBB"`                           | spec canvasColor                 |
| `box-placement`   | object | no       | -       | see 2.6                                                     | canonical placement for The Box  |

### 2.3 `type: "file"` node

| field | type | required | default | constraints | notes |
| ----------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----- | ----- | ------------------------------------------------ |
| `file` | string | yes | - | PathRel: relative, forward slashes, no `..`, no drive letter, no `<>":\|?*` or control chars, no trailing `/`, no segment ending in `.` or space | workspace-relative object path |
| `subpath` | string | no | - | starts with `#` | heading/block link, spec 1.0 |
| `box-ink` | string | no | - | PathRel, must end `.ink.svg` | ink sidecar path; convention `<file>.ink.svg` |
| `box-media` | object | no | - | `{kind: image                                                                                                                                    | video                                         | audio | doc}` | render hint; inferred from extension when absent |

### 2.4 `type: "text"` node

| field  | type   | required | notes                                      |
| ------ | ------ | -------- | ------------------------------------------ |
| `text` | string | yes      | plain text with Markdown syntax (spec 1.0) |

Text nodes are inline content, not files. For file-backed text use a `file`
node pointing at a `.md` - text nodes are for quick labels only.

### 2.5 `type: "link"` / `type: "group"` nodes

Spec 1.0 fields plus the optional `box-region` key (`url`;
`label`/`background`/`backgroundStyle` ∈ `cover|ratio|repeat`). Group
containment is spatial (node center inside group bounds), matching the
donor convention (`node_in_bounds` in `canvas.py:480`).

#### `box-region` record (ADR-0008)

A group carrying `box-region` is a **region**: a named zone with per-region
config. Still a spec group to every other reader.

```json
"box-region": { "v": 1, "locked": false, "params": {} }
```

| field    | type   | required | semantics                                                                    |
| -------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `v`      | int    | yes      | schema version; currently 1                                                  |
| `locked` | bool   | no       | children ignore drags/marquee-moves/nudges; region itself still carries them |
| `params` | object | no       | opaque bag preserved verbatim; view filters and Stage-4 generation params    |

Region name is spec `label`; tint is spec `color`. Writers preserve unknown
keys inside `box-region` (forward tolerance); board code never interprets
`params` contents.

### 2.6 `box-placement` record

```json
{
  "2d": { "x": 120, "y": 40, "w": 480, "h": 320, "z": 0 },
  "3d": null
}
```

| field | type           | required | notes                                                                        |
| ----- | -------------- | -------- | ---------------------------------------------------------------------------- |
| `2d`  | object \| null | yes      | `{x,y,w,h,z}` mirrors spec `x/y/width/height`; `z` = explicit z-index if set |
| `3d`  | object \| null | yes      | reserved north-star: `{x,y,z,rx,ry,rz}` shape frozen by future ADR           |

Canonical rule: spec `x/y/width/height` and `box-placement.2d` are kept equal
on every write. Readers prefer `box-placement`; writers must emit both. A file
node with no `box-placement` and no spec coords on any board is unplaced
(in The Box).

### 2.7 Edges

| field                | type        | required | default | constraints                      | notes                                |
| -------------------- | ----------- | -------- | ------- | -------------------------------- | ------------------------------------ |
| `id`                 | string      | yes      | -       | 16 lowercase hex chars (7.1)     | sync key: equals link-note slug      |
| `fromNode`, `toNode` | string      | yes      | -       | must reference existing node ids | dangling refs = malformed (9.2)      |
| `fromSide`, `toSide` | string      | no       | -       | `top\|right\|bottom\|left`       |                                      |
| `fromEnd`            | string      | no       | `none`  | `none\|arrow`                    | spec default `none`                  |
| `toEnd`              | string      | no       | `arrow` | `none\|arrow`                    | spec default `arrow`                 |
| `color`              | canvasColor | no       | -       |                                  |                                      |
| `label`              | string      | no       | -       | short inline label               | full documentation lives in the note |
| `box-link`           | string      | yes      | -       | `^link-[0-9a-f]{16}\.md$`        | the note file backing this edge      |

An edge without `box-link` is treated as malformed and surfaced (9.2). The
JSON Canvas spec allows label-only decorative edges; The Box does not use
them - every edge we create is backed by a note.

## 3. `link-<edgeid>.md` - the arrow's note (box.link/1)

### 3.1 Filename and identity

`link-<edgeid>.md` where `<edgeid>` is the edge's `id` verbatim (16 lowercase
hex). The filename IS the identity. Renaming the file breaks the binding; the
app repairs by renaming back or rewriting `box-edge` (reconcile, §6).

### 3.2 Frontmatter grammar

YAML between `---` fences. Required and reserved keys:

| key          | type   | required | constraints                             | notes                                                |
| ------------ | ------ | -------- | --------------------------------------- | ---------------------------------------------------- |
| `box-edge`   | string | yes      | `^[0-9a-f]{16}$`                        | primary key; must equal filename slug                |
| `box-format` | string | yes      | `box.link/1`                            | format version                                       |
| `from`       | string | yes      | node id                                 | authoritative source node                            |
| `to`         | string | yes      | node id                                 | authoritative target node                            |
| `board`      | string | no       | board filename                          | set when edge is board-scoped (OQ-4: default global) |
| `from-file`  | string | no       | PathRel                                 | denormalized display field, refreshed by reconcile   |
| `to-file`    | string | no       | PathRel                                 | denormalized display field, refreshed by reconcile   |
| `type`       | string | no       | suggested enum below, free text allowed | relationship category                                |
| `created`    | string | yes      | RFC 3339 UTC                            |                                                      |

Reserved prefix: any `box-*` key is app-managed; user keys are preserved
verbatim. Suggested `type` enum (Stage 4 may suggest via Von; user always
free): `supports | contradicts | inspired-by | part-of | references`.

Body: everything after the closing fence is the note - the reason the arrow
exists. Markdown, free-form.

### 3.3 Example

```markdown
---
box-edge: 7f3a9c2b1d4e5f6a
box-format: box.link/1
from: n-0k3x9p
to: n-8qm2zd
from-file: concept.png
to-file: notes/faction-a.md
type: inspired-by
created: 2026-10-12T14:31:00Z
---

This armor concept is the visual basis for Faction A's rank insignia.
The chevron repeats in the banner sketches.
```

## 4. Write semantics (crash-window rules)

### 4.1 Atomic writes

Every file the app writes goes through **write-temp-then-rename**: write
`.box/tmp/<rand>.tmp`, flush, `rename` onto the target. Never open-for-write
in place. Rationale: external tools and the watcher see only complete files
(probe R-2: atomic saves still emit interleaved temp+target events; the
reader side handles that by debouncing and content-hashing, §5.2).

### 4.2 Create ordering - note first, board second

On edge create: (1) write `link-<edgeid>.md`, (2) write the board with the
new edge. Crash between leaves an **orphan note**, which reconcile adopts
into an edge (§6, rule R-C) - the create completes correctly.

### 4.3 Delete ordering - tombstone, board, trash

On edge delete: (1) append `{edgeId, at}` to `.box/tombstones.json`,
(2) write the board without the edge, (3) move the note to recoverable
deletion (Recycle Bin; `trash` crate under Tauri 2, previously `shell.trashItem` - provisionally verified,
probe R-3). Crash between steps 1 and 3 leaves an orphan note whose id is
tombstoned; reconcile completes the delete by trashing it (rule R-D).

Without tombstones an orphaned note would be re-adopted and deleted links
would resurrect. Tombstone entries expire after 30 days or when manually
cleared; the file stays under a few KB.

### 4.4 Rename/move ordering - board last

On workspace file rename: update every board's `file` field and every link
note's `*-file` denormalized field. Node ids, edge ids, and note filenames
never change. Ordering: boards first, then note denorms (denorms are
cosmetic; a crash there self-heals on next reconcile).

## 5. Watcher semantics (verified by probe R-2, 2026-10-12, fs.watch on Windows; `notify` crate under Tauri surfaces the same OS events)

### 5.1 Observed event behavior

| action               | raw events observed (temp target dir)                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| create `a.png`       | `rename a.png` then `change a.png`                                                |
| modify               | `change a.png` twice (duplicates are normal)                                      |
| rename `a→b`         | `rename a.png` + `rename b.png` at same ms                                        |
| atomic save `.tmp→b` | `rename .a.tmp`, `change .a.tmp`, `rename b.png`, `rename .a.tmp`, `rename b.png` |
| delete `b.png`       | `rename b.png`                                                                    |

Conclusions that drive the design:

- **Deletes and renames both arrive as `rename`** - indistinguishable without
  an existence check after a quiet window.
- **Duplicate and interleaved events are normal.** Events are not
  transactions; treat the stream as "something changed, go look."
- Rename pairs share a timestamp: two same-tick `rename` events where the old
  path no longer exists and the new path does = candidate rename (confirm by
  content hash).

### 5.2 Required watcher behavior

1. **Debounce window:** collect events; reconcile only after 100ms quiet
   (editors' atomic saves spread events over a few ms; bulk ops stretch
   longer - window extends while events keep arriving, capped 2s).
2. **Classify by existence, not event type:** after the quiet window, diff
   last-known file set vs current: `exists-before && !exists-now` = deleted;
   `!before && now` = created; both with same hash = rename; `before && now,
hash changed` = modified.
3. **Path classification first:** `.box/` files route to board/tombstone
   handlers; `link-*.md` to note sync; `*.ink.svg` to ink layer; everything
   else to object-refresh.
4. **Self-write suppression:** writes issued through `box-core` carry a
   marker; the watcher skips events for paths in an in-flight write set.
   On missed suppression (crash mid-write), content-hash comparison makes
   the echo a no-op anyway.
5. **Flood guard:** sustained event rate above threshold → switch to
   full-scan reconcile mode, surface "indexing…" state, never drop silently.

## 6. Reconcile algorithm (runs on workspace open and after each reconcile trigger)

```
scan():
  boards  = parse all .box/*.box.canvas         (malformed → problem items)
  notes   = index all link-*.md                 (malformed → problem items)
  files   = inventory workspace (path, size, sha256 when needed)
  tombs   = read .box/tombstones.json

for each edge in each board:
  if edge.box-link missing or note file absent:
      → rule R-A: regenerate note stub from edge data      [repair, logged]
  if note exists but frontmatter (from,to) != edge:
      → rule R-B: note wins for endpoints; align edge      [logged]

for each note:
  if note.box-edge ∈ tombstones:
      → rule R-D: trash note (complete a crashed delete)   [logged]
  elif no edge references it:
      → rule R-C: adopt - create edge on note.board (or
          default board) with note's (from,to) endpoints   [logged]
  if from-file/to-file denorms stale:
      → refresh denorms from board node → file mapping     [silent]
      - endpoint resolves to a file node (any board): set *-file
      - endpoint resolves to a non-file node: drop the *-file key
      - endpoint dangles (node absent everywhere): leave the denorm
        untouched - it is a fossil of the last verified truth, and
        reconcile cannot verify it. (Convergence: a stale denorm on a
        dangling endpoint must not emit a write every pass.)

for each board node:
  if node.file missing on disk:
      → rule R-E: node renders broken, NOT removed         [I-7]
for each edge endpoint node id missing:
      → rule R-F: edge renders broken, note preserved      [I-7]

rename detection (file set diff):
  deleted X + created Y, sha256(X)==sha256(Y) (or same size+ctime when
  hash unavailable): update node.file X→Y in all boards; update note
  denorms; ids unchanged                                     [rule R-G]
```

Determinism: reconcile is a pure function of file state. Same files in,
same corrections out. All repairs are logged to `.box/reconcile.log`
(rolling, capped) and surfaced in a problem-items panel; nothing structural
is silently destroyed.

## 7. Sync invariants (the contract)

Each invariant is a law of the product. Each has a mandatory test in
`packages/box-core` named `invariant-I<N>-<slug>` (see TEST-PLAN §2).

| #   | Invariant                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- |
| I-1 | Draw an edge → exactly one `link-<edgeid>.md` exists with matching `box-edge`, `from`, `to`.                  |
| I-2 | Erase an edge → its link note is deleted **recoverably** (Recycle Bin) and a tombstone is recorded.           |
| I-3 | Delete a `link-*.md` (any path: app, OS, other editor) → the edge is removed on next reconcile.               |
| I-4 | Reconstruct-from-files: with `.box/known.json` (and caches) deleted, open workspace → boards, edges, ink, placements identical.   |
| I-5 | Rename a file → board `file` fields and link-note `*-file` fields update; node/edge ids stable.               |
| I-6 | Two boards may share a file node; the link note is workspace-global (ADR-0003).                               |
| I-7 | Missing endpoint file → edge renders broken, note preserved, never auto-deleted.                              |
| I-8 | Malformed `link-*.md` (bad frontmatter) → surfaced as a problem item, not silently dropped.                   |
| I-9 | Placement is only ever written by explicit user action - no code path may move a placed object automatically. |

## 8. IDs

- **Edge id:** 16 lowercase hex from `crypto.randomUUID()` (built-in; equals
  donor convention `uuid4().hex[:16]`, verified `canvas.py:447`). Unique per
  workspace. Filename slug = the id verbatim.
- **Node id:** `n-<base36>` (6+ chars, `crypto`-seeded), unique per board.
  Donor-style opaque ids accepted on read.
- **Stability:** ids never change on rename, move, or app restart; never
  recycled after delete (tombstones + uniqueness make reuse meaningless).
- **Collision policy:** on generate, retry once; on read, duplicate ids are
  malformed → problem item, second occurrence ignored for rendering.

## 9. Malformed-input behavior table

| input                                   | behavior                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Board JSON won't parse                  | whole board → problem item; board not modified by app until user repairs; other boards unaffected |
| Node missing `id`/`type`/coords         | node skipped for render; problem item; rest of board loads                                        |
| Edge with dangling node ref             | renders broken; preserved on write (I-7)                                                          |
| Edge missing `box-link`                 | problem item; reconcile offers to mint note (R-A needs user-visible log)                          |
| `link-*.md` filename ≠ `box-edge` value | problem item; reconcile repairs `box-edge` to match filename (filename is identity)               |
| Missing required frontmatter key        | problem item; not adopted, not trashed                                                            |
| Unknown `box-*`/other keys              | preserved verbatim on rewrite                                                                     |
| Frontmatter not YAML-parseable          | problem item; file untouched                                                                      |
| Duplicate edge id across boards         | problem item; both render; user resolves                                                          |
| `.ink.svg` malformed                    | layer skipped, source object unaffected                                                           |

## 10. Versioning and tolerance

- Format markers: `box.canvas/1`, `box.link/1`, `box-ink-version="1"`.
- Readers ignore unknown fields (forward tolerance); writers preserve them.
- Any field-shape change = version bump + migration entry + ADR. Migration
  code lives in `box-core/migrations/` and runs on open, before first write.
- **All deletions are recoverable** - Recycle Bin for user files and notes;
  tombstone completion goes through the same path.
