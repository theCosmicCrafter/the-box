# TEST-PLAN.md - Verification Strategy

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| **Status**  | Contract - every invariant and Stage-1 FR maps to a test here |
| **Version** | 0.1 - 2026-10-12                                              |

House rules: unit tests need no webview, GPU, Von, Ollama, or network.
Anything needing an external tool is an integration test and **skips with a
logged reason** when the tool is missing - never a silent pass, never a
spurious failure. Live-app proofs go through CDP
(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`,
driver `tools/cdp-eval.mjs`); assertions read real store state.

## 1. Pyramid

```
        manual dogfood (Christian, Stage 1 exit)
       live-app CDP probes - real WebView2, real watcher, real fs
      adversarial - boundary attacks (Rust + Vitest suites, §10)
     integration - real watcher + real fs on fixture dir
     invariant suite - I-1..I-9 (Vitest, tmpdir fixtures)
    unit - box-core pure functions (parsers, reconcile, classify)
```

## 2. Invariant suite (1:1 with DATA-MODEL - the heart)

| test                       | invariant                                                | method                                                                                                                              |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `invariant-I1-draw-edge`   | edge → exactly one note, matching `box-edge`/`from`/`to` | `createEdge` → assert board edge + `link-<id>.md` exist, frontmatter matches                                                        |
| `invariant-I2-erase-edge`  | erase → note recoverably deleted                         | `deleteEdge` → board clean, note trashed (mock IRecycler records call), tombstone appended                                          |
| `invariant-I3-delete-note` | note deleted on disk → edge removed on refresh           | delete file directly → `classifyEvents`+`reconcile` → edge gone                                                                     |
| `invariant-I4-reconstruct` | full rebuild from files with index deleted               | build fixture by file ops, wipe `index.db`, open → assert identical model                                                           |
| `invariant-I5-rename`      | rename → board + denorms updated, ids stable             | rename file → assert `file:` fields and `*-file` updated, node/edge ids unchanged                                                   |
| `invariant-I6-multiboard`  | file on 2 boards consistent                              | node on boards A+B → edit propagates                                                                                                |
| `invariant-I7-broken`      | missing endpoint → broken render, note preserved         | delete endpoint file → edge marked broken, note intact, problem item                                                                |
| `invariant-I8-malformed`   | malformed note → problem item, not dropped               | bad frontmatter → listed, untouched                                                                                                 |
| `invariant-I9-nomove`      | no code path moves a placed object automatically         | static check: reconcile never emits `WritePlan` mutating `box-placement` of placed nodes; AI suggestions return proposals not plans |

Plus crash-window tests from DATA-MODEL §4:

| test                     | scenario                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `crash-create-orphan`    | note written, board write skipped → reconcile R-C adopts note into edge  |
| `crash-delete-tombstone` | tombstone+board written, note untrashed → reconcile R-D completes delete |
| `echo-suppress`          | self-write events → classify yields no-op (hash equality)                |

## 3. Property-based tests

Random operation sequences against a model workspace (`fast-check` or a
hand-rolled generator - survey slot): ops = {create edge, delete edge, rename
file, delete file, external-note-create, external-note-delete, board-write}.
After each sequence: wipe index, run reconcile, assert I-4 (state
reconstructed) + no truth loss (notes with bodies always survive or are
tombstoned). Seed logged on failure for replay.

## 4. Chaos matrix (Stage 3 gate)

100 random ops on a live fixture workspace mixing app ops and raw fs ops
(deletes while closed, `.canvas` edits in a text editor, moves via Explorer).
Pass = zero orphaned truth, zero unexplainable problem items, all notes with
content preserved.

## 5. Fixture corpus

| fixture      | contents                                                                                                            | purpose            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `basic/`     | 10 files: png, jpg, mp4, mp3, 3 md, 1 box.canvas with 2 nodes + 1 edge + note, 1 ink.svg                            | unit/integration   |
| `edgecases/` | malformed board, bad frontmatter note, filename≠box-edge, dangling edge, giant fake media header, `.ink.svg` broken | malformed table §9 |
| `bulk/`      | generated 5k mixed files + 500-node board                                                                           | perf NFR-03/04     |
| `renames/`   | scripted rename/move scenarios incl. atomic-save patterns                                                           | watcher classify   |

## 6. Integration tests

| test                 | path                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `it-watcher-refresh` | modify fixture file → assert delta → object refresh (real `notify`, tmpdir)           |
| `it-open-with`       | live `fs_open_external` via CDP; assert per-type mapping + resolve_inside containment |
| `it-note-editor`     | CM6 editor → atomic save → note round-trips                                           |
| `it-von-*`           | Von client: offline → feature no-ops; contract-test payload shape vs `jev-mcp` source |

## 7. E2E (Stage 2+)

Tauri webview driven via CDP (`tools/cdp-eval.mjs` against
`--remote-debugging-port=9223`): assert bridge commands, store state, DOM,
and `box://` fetches on the live app. A selftest-mode binary flag (write
result file, exit) is the Stage 2 CI port of this.

## 10. Adversarial suite (landed 2026-10-13, Tauri migration gate)

Two suites attack the system rather than demo it. Both are gate-blocking.

**Rust** (`src-tauri/src/adversarial.rs`, `cargo test`): path-validation
parity vs `isPathRel` golden table; `resolve_inside` traversal shapes;
`bound_root` foreign-root rejection; `fs_write_atomic` escape attempts;
edge-id/tombstone validation; corrupt tombstone ledger; MIME mapping; Range
table (satisfiable/unsatisfiable/malformed/multi-range/suffix/open-ended);
empty and missing files; scan exclusions.

**TS** (`packages/box-core/test/adversarial.test.ts`, Vitest): reconcile
chaos sequences; rename pairing; same size+mtime content collision
(SHA-256 separates); tombstoned edges; orphan/malformed notes;
filename↔edge-id mismatch repair; pure-function stability; malformed SVG;
hostile frontmatter/content; large serializer inputs.

**Live CDP** (`tools/cdp-eval.mjs`, `tools/chaos-storm.mjs`): IPC fuzz via
`__TAURI_INTERNALS__.invoke` (wrong types, missing fields, giant strings,
foreign roots, traversal); 100-op filesystem storm → byte-exact store/disk
convergence; corrupt board mid-session → `malformed-board` problem item;
malformed asset nodes (truncated png/obj/zip/ttf) mount without uncaught
errors; FontFace lifecycle (mount→1, unmount→0, remount→1).

### Defects the suite found (all fixed and re-verified)

| #   | defect                                                                            | root cause                                                                                                                                                                                                             | fix                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | unsatisfiable `Range` (start ≥ len) returned 404                                  | `http_range` `NoOverlap` mapped to err                                                                                                                                                                                 | return 416 + `Content-Range: bytes */len`                                                                                                                                               |
| 2   | `bytes=` (empty spec) treated as valid 416                                        | `Ok([])` conflated with unsatisfiable                                                                                                                                                                                  | `Ok([])` → malformed error                                                                                                                                                              |
| 3   | `classifyFileSet` double-reported duplicate paths                                 | dedup map built but raw array iterated                                                                                                                                                                                 | iterate deduped map                                                                                                                                                                     |
| 4   | tombstoned-edge oscillation (delete never converged)                              | R-D trashed note but left board edge; R-A regenerated stub next pass                                                                                                                                                   | R-D completion strips the board edge same-pass                                                                                                                                          |
| 5   | `fs_append_tombstone` accepted any string                                         | no edge-id contract check                                                                                                                                                                                              | enforce exactly 16 hex chars                                                                                                                                                            |
| 6   | zip thumbnail decompression bomb                                                  | `unzipSync` eager, no output cap                                                                                                                                                                                       | `filter` rejects entries `originalSize` > 64 MiB                                                                                                                                        |
| 7   | link-note body grew +1 byte per round-trip                                        | gray-matter `stringify` appends `\n`; parse only stripped leading fence newline                                                                                                                                        | strip exactly one serializer-added trailing `\n`                                                                                                                                        |
| 8   | **every frontmatter write died in the live app** (edges, note saves, drop-edge)   | gray-matter calls `Buffer.from()` in both parse and stringify; Buffer is a Node global absent from WebView2 - Node-based vitest never saw it                                                                           | dropped gray-matter; in-house fence splitter + `js-yaml` parse + deterministic scalar emitter; regression test deletes `globalThis.Buffer`                                              |
| 9   | external link-note edit never reached the open note panel; phantom dirty followed | `NotePanel` local `body`/`type` state initialized once via `useState(note.body)` - `setEdgeNote` updated the prop but the textarea kept stale state, and `body !== note.body` then marked it dirty without a keystroke | `useEffect` resyncs `body`/`type` when `note` identity changes; verified live: non-dirty external edit silently reloads the textarea, dirty edit keeps text and shows "changed on disk" |
| 10  | `.node-resize` ungrabbable: press moved the node instead of resizing              | `right:-6px; bottom:-6px` straddled the corner; `.node { overflow:hidden }` clipped the outer half and `node-excerpt` won hit-testing                                                                                  | inset to `right:2px; bottom:2px`, 16px target, `z-index:2`; same fix class as defect-found edge handles (`left:100%` slivers)                                                           |

Hardening that shipped in the same pass (not defect-driven): `bound_root`
session binding on all mutators; 8 MiB cap per `box://` range request;
lossy UTF-8 `fs_read` (matches prior Node semantics, never null on binary).

## 8. Verification matrix (living)

Status values: `unit` = automated suite covers it; `live` = exercised in the
running WebView2 app via real CDP input and confirmed on disk; `planned` =
no coverage yet.

| FR                    | test                       | stage | status        |
| --------------------- | -------------------------- | ----- | ------------- |
| FR-101                | `e2e-open-workspace`       | 1     | live          |
| FR-104                | `it-md-node-edit`          | 1     | live          |
| FR-105                | `it-ink-sidecar`           | 1     | unit+live     |
| FR-106                | `it-ink-erase`             | 1     | unit+live     |
| FR-107                | `invariant-I1-draw-edge`   | 1     | unit+live     |
| FR-108                | `invariant-I2-erase-edge`  | 1     | unit+live     |
| FR-109                | `invariant-I3-delete-note` | 1     | unit+live     |
| FR-110                | `it-open-with`             | 1     | live          |
| FR-111                | `it-watcher-refresh`       | 1     | live          |
| FR-112                | `it-board-roundtrip`       | 1     | unit+live     |
| FR-113                | `it-placement-schema`      | 1     | unit+live     |
| FR-202                | `e2e-box-panel`            | 2     | live          |
| FR-204                | `it-edge-label`            | 2     | live          |
| FR-205                | `it-jump-link`             | 2     | live          |
| FR-206                | `it-audio-node`            | 2     | live          |
| FR-305                | `it-open-with-prefs`       | 3     | live          |
| NFR-03                | `perf-pan-500`             | -     | live (60 FPS) |
| NFR-04                | `perf-cold-5k`             | -     | live (2.2s)   |
| (all later-stage FRs) | per PRD §5 test-ref        | 2-5   | planned       |

FR-202 is now a real holding-area panel (`BoxPanel`): workspace objects not
on the open board, HTML5 drag via `application/x-box-file`, click-to-pick-up
(Obsidian pattern - item follows intent until an empty-canvas click drops it,
Esc cancels), per-row "place at viewport center", deterministic "place all"
grid via `gridPlaceRect`. The FileTree stays unfiltered alongside it.

Live-verified 2026-10-13 (real CDP input, chaos workspace):
ink draw writes `untitled-1.md.ink.svg` (`box-format: box.ink/1`,
pressure-varying polygon, node gains `box-ink`); ink erase removes strokes
and trashes the emptied sidecar (Recoverable by design, `box-ink` key
dropped); external `.ink.svg` edit reloads the overlay via the watcher;
`.md` file node dblclick → textarea → atomic write round-trips to the file;
note `type` save denorms to board edge `label` and renders on the arrow;
note-panel from/to jump fits the camera on the endpoint node + selects it;
unplaced filter hides placed files (c50.txt, untitled-1.md) and keeps
unplaced ones (untitled.md, c59.txt). Every node now persists
`box-placement:{2d:{x,y,w,h},3d:null}` equal to spec coords.

Live-verified 2026-10-13 (second pass, same harness): rename propagation
R-G - `mv c50.txt c50-renamed.txt` in Explorer updated the board `file:`
field and both link notes' `from-file`/`to-file` denorms within ~2s, no
broken nodes, no problems; renaming back converged the same way.
ERR-8 - injecting `<script>` into a bound `.ink.svg` produced a
`malformed-note` problem item while the node kept its last-good strokes;
restoring the file cleared the problem. Ink palette - 6 swatches + 3
sizes in the ribbon while draw mode is active; a red 18px stroke
round-tripped to the sidecar as `fill="#ef4444" stroke-width="18"`.
"Clear ink strokes" context action trashed the sidecar (recoverable),
dropped `box-ink`, and cleared the overlay. Unplaced filter shows a live
count (`unplaced (N)`) and excludes `.box/` internals, root link notes,
and bound sidecars.

New this pass: `invariant-I4..I9` suites landed as Vitest files
(tmpdir fixtures; I-9 statically asserts reconcile never emits
placement-mutating writes), plus `decisions.ts` - a disabled-by-default,
confidence-gated, proposal-only local decision client (no write plans,
preserves I-9).

Live-verified 2026-10-13 (third pass, release build on bulk fixture -
5,202 files, 500 nodes, 200 edges): BoxPanel pick-up-place (`placing
broken.obj - click to drop, Esc to cancel`, unplaced count 10->9, node
persisted); viewport culling hides off-viewport nodes (`display:none`)
while keeping selected/editing/inking ones live; node `color` field
(JSON Canvas preset "4") renders a tint class and persists to the board;
ink edit mode selects strokes by proximity tolerance and drags them,
sidecar rewritten on commit; ink palette choice persists to
`.box/settings.json`; `fs_open_with` spawned notepad.exe on a workspace
file after `pick_app`-style validation (relative app paths and non-exe
targets rejected); Ctrl+Z pops the last ink stroke; clicking a
`problem` row locates and selects the offending node. Perf: cold open
2,245 ms for the 5k corpus; pan storm on the release build measured
median 16.7 ms (~60 FPS, p95 25.8 ms) with 401/500 nodes culled
mid-pan. Zoom-to-fit drops below the interactive 0.1 floor
(FIT_MIN_ZOOM 0.02) so huge boards actually fit, and wheel zoom from a
fit camera eases back through the floor instead of snapping.

Bugs found and fixed this pass: Viewport wheel/pointermove read a stale
camera between React commits, so trackpad pinch bursts applied one zoom
per frame - gestures now accumulate through a ref; gen-bulk emitted
duplicate node ids (`hex(i).slice(0,10)` took the zero padding) and
unquoted all-digit `box-edge` frontmatter values that js-yaml re-parsed
as numbers - the app's own serializer was already safe (PLAIN_SCALAR
rejects leading digits, JSON.stringify fallback quotes).

Harness caveats for future sessions: CDP `Input.dispatchMouseEvent` does
not synthesize `dblclick` from click pairs in WebView2 - dispatch a DOM
`dblclick` MouseEvent instead (the React handler itself is verified);
ink-mode pointerdown consumes the gesture on file nodes, so a dblclick in
draw mode produces tap-dot strokes, not the editor; release and dev
binaries share the WebView2 user-data dir, so launching the release build
while `tauri dev` runs fails with 0x8007139F - kill the dev instance first.

The matrix is regenerated on each FR/test change - a CI lint step checks
every Stage-appropriate FR has a test-ref that exists.

## 9. Manual/dogfood protocol (Stage 1 exit)

Christian, unaided, on `TheBox-Dev`: open folder → place 3 objects → draw 2
arrows → write in both notes → erase 1 arrow → delete 1 note in Explorer →
edit 1 image in Krita → close and reopen → confirm state. Pass = zero
confusion points recorded; friction logged as issues.
