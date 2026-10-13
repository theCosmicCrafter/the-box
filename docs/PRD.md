# The Box - Product Requirements Document

|                         |                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Version**             | 0.2                                                                                               |
| **Status**              | Draft - for group review                                                                          |
| **Date**                | 2026-10-12                                                                                        |
| **Product owner**       | Christian                                                                                         |
| **Engineering lead**    | Rich                                                                                              |
| **Contract precedence** | DATA-MODEL and ARCHITECTURE are binding where more specific; this PRD wins where they are silent. |

Sections 1–4 are the readable layer - Christian's copy. Sections 5 onward are
the contract layer - every requirement is testable and links to the docs that
implement it.

---

## 1. Vision

A worldbuilding and reference workspace where the storage model IS the product:

- Everything visible on the canvas is an ordinary file in an ordinary folder.
- Drawing an arrow between two objects creates a real Markdown note documenting
  the relationship - not a decoration, a document.
- Any object can be edited in the user's preferred external application; the
  canvas reflects the save automatically.

**Product sentence:** _A lighter Obsidian with a smarter canvas._

**Kernel spec:** _Objects are files. Arrows are notes. Edits round-trip._

The long-term vision - the same library projected as a 2D board today and a
3D "place of the mind" tomorrow - is preserved architecturally (placement
schema reserves `3d`) but is not in scope for Stages 0–4.

## 2. Origin and evidence

Christian ran the gap analysis by hand against Allume:

> _"I can't edit the text as text, and if I draw an arrow from a text box to an
> image that doesn't mean anything either. In my mind, drawing an arrow would
> update a text file that would document the join between the image and the
> text."_

Competitive check against the rubric (each app scored on: text-as-text,
arrow-creates-a-thing, ordinary files, media-in-place, external round-trip):

| Tool            | Text as text? | Arrow creates a thing?  | Ordinary files? | Media in place? | Round-trip?      |
| --------------- | ------------- | ----------------------- | --------------- | --------------- | ---------------- |
| Allume          | No            | No                      | No              | Partial         | No               |
| Kinopio         | Partial       | Typed, in-app JSON only | No              | Yes             | No               |
| Obsidian Canvas | Yes           | Label only              | Yes             | Partial         | Plugin-dependent |
| Scapple         | Partial       | Decoration              | No              | No              | No               |
| Muse/Milanote   | No            | No                      | No              | Yes             | No               |

No tool writes a documentable entity per connection. Storage-level forensics on
candidate apps via REA (probe R-7b) will upgrade this table from UI observation
to verified storage evidence where installs exist.

## 3. Personas

- **Christian (primary):** visual worldbuilder; large asset libraries;
  documented connections matter more than drawing fidelity; hops into
  Rebelle/Krita/Resolve and back; storage-heavy is fine if files handle it.
- **Rich (secondary):** power user; wants the same data legible to scripts,
  agents, and git. Zero cloud.
- **Future:** reference artists, narrative designers, DMs, research collage.

## 4. Design pillars (non-negotiable)

1. **Files are truth.** Indexes and databases are rebuildable caches.
   Workspace recovers fully with every cache deleted.
2. **Arrows are notes.** Edge and `link-<id>.md` are one entity, two faces;
   create/delete syncs both directions.
3. **Sources are immutable.** Media is never rewritten; ink lives in sidecars.
4. **Open stack.** `.canvas` JSON, `.md`, `.svg`, standard media - readable
   without The Box. The app could die; the data survives.
5. **Zero cloud.** AI features run on local services (Von, Winnow, Ollama) and
   are fully optional.
6. **Seamless round-trip.** Open-with → external save → canvas refreshes.
7. **Inference suggests, never moves.** AI-derived organization is a visible,
   confidence-gated suggestion, never silently applied.

## 5. Requirements (contract layer)

Priority: **M**ust / **S**hould / **C**ould. `test-ref` names the planned test
(`invariant-*`, `it-*`, `e2e-*`; see TEST-PLAN).

### Stage 1 - PoC

| FR     | Requirement                                           | Pri | Acceptance criterion                                                              | Deps   | Test-ref                           |
| ------ | ----------------------------------------------------- | --- | --------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| FR-101 | Open a folder as workspace; objects map 1:1 to files  | M   | Folder picker → board lists every file; file added later appears in Box panel     | -      | `e2e-open-workspace`               |
| FR-102 | Render image objects at placement coords              | M   | PNG/JPEG/WEBP/GIF render at `box-placement.2d` x/y/w/h                            | FR-101 | `it-file-node-render`              |
| FR-103 | Inline video playback                                 | M   | MP4/WEBM node plays inline, no external window                                    | FR-102 | `it-video-node`                    |
| FR-104 | Editable text objects                                 | M   | `.md` file node renders text; edit persists to the file                           | FR-102 | `it-md-node-edit`                  |
| FR-105 | Pressure-aware ink over objects → `.ink.svg`          | M   | Strokes render over image; `photo.png.ink.svg` exists on disk, reopens on reload  | FR-102 | `invariant-I4-*`, `it-ink-sidecar` |
| FR-106 | Eraser removes ink strokes                            | M   | Erase → stroke gone visually AND absent from sidecar file                         | FR-105 | `it-ink-erase`                     |
| FR-107 | Arrow → edge + `link-<edgeid>.md` created             | M   | Drag A→B → edge renders + note file exists with matching `box-edge`, `from`, `to` | FR-102 | `invariant-I1-draw-edge`           |
| FR-108 | Erase arrow → edge AND note deleted                   | M   | Erase → edge gone, `link-*.md` in Recycle Bin, tombstone recorded                 | FR-107 | `invariant-I2-erase-edge`          |
| FR-109 | Delete `link-*.md` → edge gone                        | M   | Delete note via OS or file list → edge absent on next refresh (≤1s)               | FR-107 | `invariant-I3-delete-note`         |
| FR-110 | Double-click → external app                           | M   | `shell.openPath` invoked with object path + per-type app                          | -      | `it-open-with`                     |
| FR-111 | External save → refresh in place                      | M   | Modify file externally → node re-renders ≤1s, ink overlay intact                  | FR-110 | `it-watcher-refresh`               |
| FR-112 | Board persists as `.box.canvas`, JSON Canvas superset | M   | File opens in spec validator; `box-*` fields present; reopens identically         | -      | `it-board-roundtrip`               |
| FR-113 | Placement record carries 2d + reserved 3d             | M   | Every placed node has `box-placement:{2d,3d:null}`                                | FR-112 | `it-placement-schema`              |

### Stage 2 - The canvas earns its name

| FR     | Requirement           | Pri | Acceptance                                                   | Test-ref          |
| ------ | --------------------- | --- | ------------------------------------------------------------ | ----------------- |
| FR-201 | Pan/zoom unbounded    | M   | Zoom 0.1–5 (donor clamp), pan to ±1e6 px, ≥30fps at 500 objs | `e2e-canvas-perf` |
| FR-202 | Box holding area      | M   | Unplaced file listed; drag → placement written, leaves panel | `e2e-box-panel`   |
| FR-203 | Multiple boards       | M   | 2+ `.box.canvas` coexist; object on both stays consistent    | `it-multiboard`   |
| FR-204 | Edge labels + types   | M   | `type` settable in note frontmatter; label renders on edge   | `it-edge-label`   |
| FR-205 | Jump to linked object | M   | From edge/note → focus the other endpoint                    | `it-jump-link`    |
| FR-206 | Audio objects inline  | M   | Play/pause/seek on card                                      | `it-audio-node`   |
| FR-207 | Link note CM6 editor  | M   | Frontmatter-aware; `box-edge` read-only; saves atomically    | `it-note-editor`  |

### Stage 3 - Sync hardening + media polish

| FR     | Requirement                                         | Pri | Acceptance                                                     | Test-ref                |
| ------ | --------------------------------------------------- | --- | -------------------------------------------------------------- | ----------------------- |
| FR-301 | Sync survives closed app / external `.canvas` edits | M   | Chaos suite (TEST-PLAN §4) leaves zero orphans                 | `chaos-*`               |
| FR-302 | Rename/move → board + note denorms update           | M   | Rename X→Y → all `file:` + `*-file` fields updated, ids stable | `invariant-I5-rename`   |
| FR-303 | File on 2 boards stays consistent                   | M   | Same file node across boards edits coherently                  | `it-multiboard-consist` |
| FR-304 | Broken links surface, never destroyed               | M   | Deleted endpoint → broken edge + note preserved, problem item  | `invariant-I7-broken`   |
| FR-305 | Per-type open-with prefs UI                         | M   | PNG→Krita choice persists in `.box/settings.json`              | `it-openwith-prefs`     |
| FR-306 | Spatial audio modes (off/all/viewport)              | S   | Mode switch changes audibility by node position                | `it-spatial-audio`      |
| FR-307 | Ink colors + attributes; ink as object              | S   | `.ink.svg` placeable/linkable itself                           | `it-ink-object`         |

### Stage 4 - Intelligence (all local, all optional)

| FR     | Requirement                           | Pri | Acceptance                                                              | Test-ref              |
| ------ | ------------------------------------- | --- | ----------------------------------------------------------------------- | --------------------- |
| FR-401 | Link-type suggestion via Von          | S   | Arrow draw → choice query → suggested type shown, user confirms/ignores | `it-von-linktype`     |
| FR-402 | Unplaced triage suggestions           | C   | New file → suggested category shown in Box                              | `it-von-triage`       |
| FR-403 | Near-dup check                        | C   | Duplicate candidate → yes/no decision gates warning                     | `it-von-near-dup`     |
| FR-404 | Confidence-gated placement suggestion | C   | Never moves placed object; suggestion at p≥threshold only               | `invariant-I9-nomove` |
| FR-405 | Semantic related-items                | C   | Candidates via vectors → Von scores shortlist                           | `it-related`          |
| FR-406 | box-mcp exposure                      | C   | Boards/notes/search readable via MCP; writes via box-core               | `it-mcp-tools`        |
| FR-407 | Graceful offline                      | M   | All Stage 4 features hide when Von/Ollama unreachable                   | `it-offline-noop`     |

### Stage 5 - Reach

| FR     | Requirement                       | Pri | Test-ref        |
| ------ | --------------------------------- | --- | --------------- |
| FR-501 | Touch/pen pass; iPad path per ADR | C   | `it-touch`      |
| FR-502 | Optional WASM brush engine        | C   | `it-brush-wasm` |
| FR-503 | Shareable workspaces (git/P2P)    | C   | `it-share`      |

## 6. Error and edge-condition requirements

| ERR   | Condition                                        | Required behavior                                                               |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| ERR-1 | Board JSON unparseable                           | Board → problem item, untouched by app; other boards unaffected (DATA-MODEL §9) |
| ERR-2 | Edge endpoint file missing                       | Broken-edge render; note and edge preserved; no auto-delete                     |
| ERR-3 | `link-*.md` filename ≠ `box-edge`                | Problem item; reconcile repairs `box-edge` to filename                          |
| ERR-4 | External `.canvas` edit conflicts with in-memory | Files win; reconcile converges; user edit never overwritten silently            |
| ERR-5 | Watcher flood (bulk external ops)                | Debounce → full-scan mode; "indexing" state shown; no silent drop               |
| ERR-6 | Oversized/degenerate media                       | Object renders placeholder + problem item; board stays usable                   |
| ERR-7 | Concurrent app instances on same workspace       | Second instance warns; last-writer-wins per file; reconcile heals on next open  |
| ERR-8 | Malformed `.ink.svg`                             | Overlay skipped; source object unaffected; problem item                         |
| ERR-9 | Von/Ollama unreachable                           | Stage 4 features hide; no error UI; core unaffected                             |

## 7. Traceability matrix (Stage 1 excerpt - full matrix maintained in TEST-PLAN)

| FR         | DATA-MODEL § | ARCHITECTURE § | Invariant         | Test                       |
| ---------- | ------------ | -------------- | ----------------- | -------------------------- |
| FR-107     | §3, §4.2     | §4 flow 1      | I-1               | `invariant-I1-draw-edge`   |
| FR-108     | §4.3         | §4             | I-2               | `invariant-I2-erase-edge`  |
| FR-109     | §6 (R-D)     | §4             | I-3               | `invariant-I3-delete-note` |
| FR-105/106 | §ink         | box-ui/ink     | I-4 (reconstruct) | `it-ink-sidecar`           |
| FR-111     | §5           | §4 flow 2      | -                 | `it-watcher-refresh`       |
| FR-112     | §2           | model/parsers  | I-4               | `it-board-roundtrip`       |

## 8. Non-functional requirements

| NFR    | Requirement                                    | Measure                                                           |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------- |
| NFR-01 | Windows-first correctness                      | Paths, spawn, watch semantics - probes R-2/R-3                    |
| NFR-02 | `box-core` pure TS headless                    | `node tests/` with no Electron; lint enforces no platform imports |
| NFR-03 | 500 objects ≥30fps pan/zoom                    | Frame probe in e2e                                                |
| NFR-04 | 5k-file workspace ≤5s warm / ≤15s cold open    | e2e fixture clock                                                 |
| NFR-05 | No network outside optional localhost AI layer | Dependency audit + code search gate                               |
| NFR-06 | Recoverable deletion only                      | `shell.trashItem` everywhere user data is removed                 |
| NFR-07 | Format versioning + forward tolerance          | `box.*`/`box-format` fields; migrations dir                       |

## 9. PoC acceptance (Stage 1 exit gate)

1. Draw arrow image→text → `link-*.md` exists, readable in any editor.
2. Erase arrow → note gone (recoverable). Delete another note on disk → its
   edge gone within 1s of next refresh.
3. External image edit → canvas reflects save, no restart.
4. Close, delete `.box/index.db`, reopen → placement, ink, edges identical.
5. Christian performs all of the above unaided.

## 10. Risks

| Risk                      | Mitigation                                             |
| ------------------------- | ------------------------------------------------------ |
| Two-way sync edge cases   | PoC proves sync first; I-1..I-9 test suite is the gate |
| Canvas perf at scale      | Lazy mounts, viewport culling, PixiJS path identified  |
| Scope creep to world-OS   | Stage gates; north-star items need ADR to un-park      |
| iPad path unknown         | OQ-3 deferred to Stage 5 ADR                           |
| Format novelty/bus-factor | Formats fully specified here; readable without app     |

## 11. Open questions (register lives in `docs/adr/`)

| OQ   | Question                                      | Owner | Due           | Lean                                                                   |
| ---- | --------------------------------------------- | ----- | ------------- | ---------------------------------------------------------------------- |
| OQ-1 | `.box.canvas` superset vs plain JSON Canvas   | Rich  | Stage 0       | Superset (evidence: unknown keys preserved - resolved, draft ADR-0002) |
| OQ-2 | SQLite adjacency vs Kùzu graph index          | Rich  | Stage 3       | SQLite first                                                           |
| OQ-3 | iPad delivery path                            | Group | Stage 5       | OpenClaw node / PWA / Tauri-mobile                                     |
| OQ-4 | Link-note scope: global vs per-board          | Rich  | Stage 0       | Global - ADR-0003 drafted                                              |
| OQ-5 | Built-in git versioning vs user's own git     | Group | Stage 5       | User's own first                                                       |
| OQ-6 | Media thumbnailing: Electron vs Python worker | Rich  | Stage 2       | Electron first                                                         |
| OQ-7 | Canvas engine: custom+salvage vs Konva        | Group | Stage 0       | Custom - ADR-0004 drafted (tldraw ruled out: license-key requirement)  |
| OQ-8 | Project license (MIT/Apache/private)          | Group | before public | Private-until-decided - ADR-0005 drafted                               |

## 12. Non-goals

- Not an art app - notation ink only; painting in external editors.
- Not a silo - files are the export; no proprietary database.
- Not cloud-dependent - no accounts, sync service, or telemetry.
- Not Obsidian-dependent - interop by format, never required.
- Not multiplayer - single-user single-machine first.
