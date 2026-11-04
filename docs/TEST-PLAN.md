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
| `invariant-I4-reconstruct` | full rebuild from files with index/known.json deleted    | build fixture by file ops, wipe `.box/known.json` (and caches), open → assert identical model       |
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

| #   | defect                                                                            | root cause                                                                                                                                                                                                                                      | fix                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | unsatisfiable `Range` (start ≥ len) returned 404                                  | `http_range` `NoOverlap` mapped to err                                                                                                                                                                                                          | return 416 + `Content-Range: bytes */len`                                                                                                                                               |
| 2   | `bytes=` (empty spec) treated as valid 416                                        | `Ok([])` conflated with unsatisfiable                                                                                                                                                                                                           | `Ok([])` → malformed error                                                                                                                                                              |
| 3   | `classifyFileSet` double-reported duplicate paths                                 | dedup map built but raw array iterated                                                                                                                                                                                                          | iterate deduped map                                                                                                                                                                     |
| 4   | tombstoned-edge oscillation (delete never converged)                              | R-D trashed note but left board edge; R-A regenerated stub next pass                                                                                                                                                                            | R-D completion strips the board edge same-pass                                                                                                                                          |
| 5   | `fs_append_tombstone` accepted any string                                         | no edge-id contract check                                                                                                                                                                                                                       | enforce exactly 16 hex chars                                                                                                                                                            |
| 6   | zip thumbnail decompression bomb                                                  | `unzipSync` eager, no output cap                                                                                                                                                                                                                | `filter` rejects entries `originalSize` > 64 MiB                                                                                                                                        |
| 7   | link-note body grew +1 byte per round-trip                                        | gray-matter `stringify` appends `\n`; parse only stripped leading fence newline                                                                                                                                                                 | strip exactly one serializer-added trailing `\n`                                                                                                                                        |
| 8   | **every frontmatter write died in the live app** (edges, note saves, drop-edge)   | gray-matter calls `Buffer.from()` in both parse and stringify; Buffer is a Node global absent from WebView2 - Node-based vitest never saw it                                                                                                    | dropped gray-matter; in-house fence splitter + `js-yaml` parse + deterministic scalar emitter; regression test deletes `globalThis.Buffer`                                              |
| 9   | external link-note edit never reached the open note panel; phantom dirty followed | `NotePanel` local `body`/`type` state initialized once via `useState(note.body)` - `setEdgeNote` updated the prop but the textarea kept stale state, and `body !== note.body` then marked it dirty without a keystroke                          | `useEffect` resyncs `body`/`type` when `note` identity changes; verified live: non-dirty external edit silently reloads the textarea, dirty edit keeps text and shows "changed on disk" |
| 10  | `.node-resize` ungrabbable: press moved the node instead of resizing              | `right:-6px; bottom:-6px` straddled the corner; `.node { overflow:hidden }` clipped the outer half and `node-excerpt` won hit-testing                                                                                                           | inset to `right:2px; bottom:2px`, 16px target, `z-index:2`; same fix class as defect-found edge handles (`left:100%` slivers)                                                           |
| 11  | `reconcile did not converge after 4 passes` on every sync with dangling edges     | denorm refresh compared `fileOf(id)` (`undefined` for dangling endpoints) against stale `from-file`/`to-file` - true every pass - while the write only _set_ defined keys, so the stale key survived and the identical step regenerated forever | `fileOf` is tri-state (`string` = set, `null` = drop key, `undefined` = fossil, no write); DATA-MODEL denorm rule amended; regression test in `invariant-I7-broken`                     |
| 12  | broken-edge problems invisible on a quiet open (masked by defect 11's own passes) | `WorkspaceChanged` only emitted when deltas/steps/passes existed; `runSync` also never ran until the first `box:fs-dirty` event, so a clean open carried zero reconcile visibility                                                              | event gate now includes `report.problems`/`brokenNodes`/`brokenEdges`; `watchSyncSession` queues one `runSync` via `queueMicrotask` after listeners attach                              |

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
| FR-201                | `e2e-selection-marquee`    | 2     | live          |
| FR-201                | `e2e-multi-drag-nudge`     | 2     | live          |
| FR-201                | `e2e-quick-open`           | 2     | live          |
| FR-201                | `e2e-minimap`              | 2     | live          |
| FR-201                | `e2e-undo-redo`            | 2     | live          |
| FR-201                | `e2e-groups`               | 2     | live          |
| FR-201                | `e2e-duplicate`            | 2     | live          |
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

## 9. Quality-of-life surfaces (post-audit additions)

| surface                                   | coverage                                              | status        |
| ----------------------------------------- | ----------------------------------------------------- | ------------- |
| Status bar (counts + zoom readout)        | typecheck/lint; render is pure props                  | unit          |
| Status-bar zoom controls (-/%/+/Fit)      | `zoomRequest` nonce prop, `zoomAt`/`zoomToFit` math   | unit          |
| Tab middle-click close + Ctrl+W           | TabBar `onAuxClick`, App global keydown               | unit          |
| FileTree context menu (new/open/reveal/…) | shared `ContextMenu`; existing bridge commands        | unit          |
| `.box/tmp` + `.box/thumbs` GC             | `gc_box_dirs` adversarial tests (stale/fresh/cap)     | unit          |
| Excerpt-loader + spatial-audio perf fixes | keyed effects/refs; no behavior change                | unit          |

Live verification owed on next app session: status bar renders and
zoom % tracks wheel zoom; tree menu creates `untitled.md` in the right
dir and trash round-trips through the watcher; middle-click and Ctrl+W
close the active board without touching `.box.canvas` files.
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

Live-verified 2026-10-13 (fourth pass, release build on the bulk fixture,
501 nodes): marquee selection - left-drag on empty canvas draws a rubber
band (`.marquee-rect`), selects all intersecting nodes (350 of 501 in a
partial band), Shift adds to the current selection, pan is unchanged on
space-drag and middle-drag; multi-select (`Set<string>`) drives
multi-drag with a common delta (three nodes all moved +2541,+2541),
Ctrl+A selected all 501, arrow keys nudge the selection (+10 px step),
Escape clears it, Delete/Backspace removed a 5-node marquee selection
(501->496 persisted to the board file) while the source files stayed on
disk; QuickOpen (Ctrl/Cmd+P) filters 5,204 files fuzzy-style, picking an
unplaced file places it and persists, picking a placed file jump-focuses
and selects its node without duplicating; MiniMap renders 501 node
rects plus the live viewport box in the bottom-right overlay.
Interaction-model note: left-drag on empty canvas now means marquee
(tldraw/Figma convention); pan lives on middle-drag, space-drag, and
wheel as before.

Harness caveat added this pass: CDP `Input.dispatchMouseEvent` does not
deliver a usable middle-button drag in WebView2 - DOM PointerEvents with
`button:1` verify the same handler (autoscroll-style quirk, same class
as the dblclick gap).

Live-verified 2026-10-13 (fifth pass, release build on the bulk
fixture): ADR-0007 session undo - a real input drag moved a node
(+3602,+2251), Ctrl+Z restored the pre-drag position and persisted it,
Ctrl+Shift+Z re-applied; Ctrl+A + Delete cleared all 497 placements and
a single Ctrl+Z restored all 497; Ctrl+D on a file node ran `fs_copy`
(`tone.wav` -> `tone-copy.wav` on disk) and placed the copy at +32,+32;
Ctrl+G wrapped a 31-node marquee selection in a spec `group` node
(bounds+pad, `type:"group"`, label), dragging the group border moved
every spatially-contained child by the identical delta (+2747,+946),
Ctrl+Shift+G removed the group while keeping all children; arrow-key
nudge now commits via a 350 ms debounce (nudged x=3367 landed in the
board file - previously nudges never persisted at all); multi-delete is
batched into one capture + one board write. Harness caveat:
`setPointerCapture` throws on synthetic PointerEvent ids, so DOM-event
tests can move nodes but never select them - use real CDP input for
selection paths.

Live-verified 2026-10-17 (sixth pass, release build on the bulk
fixture): edge re-route - selecting an edge (real click on the fat
hit-path, verified `elementFromPoint` returns `edge-hit`) exposes two
endpoint handles rendered in an overlay svg ABOVE the node layer;
dragging the `to` handle onto `n-00000003e3` retargeted
`edge 0000000000000012` (board + disk: `toNode`/`toSide` updated,
`from` untouched, same `box-link` path) and the link note
`link-0000000000000012.md` was atomically rewritten
(`to:`/`to-file:` denorms now match the new target, `box-edge`/`created`
/body preserved); dropping on empty canvas cancels. Zoom keys: Shift+0
resets to z=1, Shift+2 fits the current selection. FR-207 CodeMirror 6:
`.cm-editor` renders the link-note body, `insertText` edited it, the
Save button round-tripped `Edge 15. live-edit` into
`link-0000000000000010.md` with frontmatter intact; `box-edge`/`from`/
`to`/`created` render as read-only structure outside the editor.

Bugs found and fixed while verifying: `.edge-layer` was a ~6 px box at
the world origin, so Chrome never hit-tested any edge path (edge
selection had never worked); the svg now spans the +/-1e6 pan bounds
with a matching viewBox. The 14-unit `.edge-hit` stroke shrank to a
sub-pixel target when zoomed out - it is now `vector-effect:
non-scaling-stroke` (10 screen px) and hit-paths/handles gate off below
z<0.08 where edges are visual mush. Endpoint circles lived inside
EdgeLayer under the node DOM (a grab attempt dragged the node instead)

- they moved to an `EdgeHandles` svg rendered after the node layer.
  `tauri build` did not rebuild `@box/ui` dist, so the renderer shipped
  stale code - `apps/desktop build` now runs `npm run build -w @box/core
-w @box/ui` first. Harness caveats: wheel zoom requires `ctrlKey`
  (plain wheel pans); each synthetic wheel tick is ~1.62x not 1.22x;
  `getScreenCTM()` on the path is the authoritative world->screen mapping
  (manual transform-matrix parsing misses the container offset).

Live-verified 2026-10-17 (seventh pass, release build on the bulk
fixture): undo now covers edge re-route - retargeting
`edge 0000000000000011` from `n-000000096f` to `n-00000003e3` then
Ctrl+Z restored the board edge AND rewrote `link-0000000000000011.md`
back to `to: n-000000096f` (`to-file` denorm too) - required because
R-B makes the note endpoint-authoritative, so a board-only restore
would be silently reverted by reconcile. Ctrl+V verified both ways:
clipboard text -> text node on the board; a synthesized image/png
ClipboardItem -> real `paste.png` workspace file (PNG magic verified on
disk) + file node. Bug fixed live: the first paste navigated the whole
webview to `edge://permission-request-dialog/` - Tauri's
`on_permission_request` now allows ClipboardRead and denies all other
kinds (local-first app needs nothing else). `fs_copy` gained
adversarial tests and a naming fix: dotfiles/extensionless sources used
to produce `name-copy.bin`; they now keep no extension (`.env` ->
`.env-copy`, `README` -> `README-copy`), and `create_new` no longer
emits the illegal trailing-dot name for empty ext. Harness caveat:
the canvas viewport rect can be far narrower than the window (the
BoxPanel/other panes share the row) - drops/clicks past the viewport's
right edge land outside it even when a node visually appears there
(overflow hidden clips at the rect, but getBoundingClientRect is the
only reliable bounds check).

Live-verified 2026-10-17 (eighth pass, release build): FR-307 ink as
object - a written `refs/f995.md.ink.svg` appeared in The Box via the
watcher, placed as a file node that renders its strokes through <img>
over box:// (kind "image" for .ink.svg); a sidecar bound via `box-ink`
on its parent node shows an "ink" badge in The Box while unbound
sidecars show none; placed sidecars leave the unplaced list normally.
FR-306 spatial audio - ribbon volume button cycles off/all/viewport;
mode "all" gave pan -0.03/gain 0.74 for a near-center node, pan -0.73/
gain 0.52 after panning (position-tracked, setTargetAtTime ramps); mode
"viewport" gave gain 0 with pan clamped -1 once the node left the view;
mode "off" returns to passthrough (0/1); the pref persisted to
`.box/settings.json` {"audio":{"mode":"off"}}. Audio elements carry
`data-node-id` and mount only while their node is selected, so wiring
is on-demand via a rAF tick against `__boxSpatial` (debug handle added
for the harness). `fileIcon` gained .ink.svg -> pen and .svg -> image.

Live-verified 2026-10-17 (ninth pass, release build): ADR-0008 regions -
context menu on a group offers Make region / Lock|Unlock children /
Remove region; "region"/"region . locked" badge renders on the group;
box-region {v,locked} round-trips to .box.canvas and survives relaunch.
Locked semantics: a selected child inside a locked region ignores
drags and arrow nudges (position unchanged on both), while dragging
the region itself carries members by the identical delta. Carry bug
fixed live: membership used to re-check live bounds per frame, so a
fast drag outran members and stranded one partially outside the edge -
membership is now snapshotted at gesture start (carryIdsRef cleared on
commit); re-test moved group -12923,-8420 and both members by exactly
that delta, still inside. board.test.ts covers box-region loose
validation (object shape, v, non-group tolerance) - 12 pass.

Live-verified 2026-10-17 (tenth pass, release build): ADR-0009 foreign
.canvas ingest - wrote `imported.canvas` (Obsidian-shaped: arbitrary
non-conforming ids, metadata) into the workspace; it scanned into the
FileTree, click-open normalized it IN PLACE and opened it as a board:
box-format added, node ids remapped to n-*, edge id to 16-hex with
box-link + a real `link-5c3049b099284ecf.md` at root (from/to remapped,
board + from-file denorms, type from label), unknown `metadata` key
preserved, and the file still parses as plain JSON Canvas (Obsidian can
still open it - in-place means one file, two readers). specImport.test
covers remap/backing/preservation, idempotence, non-canvas rejection,
and already-valid-id stability (108 core).

Live-verified 2026-10-17 (eleventh pass, release build): OS-native
icons on typed tiles - placed `model.blend` (model3d kind, unparseable);
the tile resolved the shell-associated icon via `file_icon` IPC
(systemicons -> SHGetFileInfoW), PNG cached at `.box/icons/icon-<fnv>.png`
and served through box:// (200). Cache is per-EXTENSION (500 same-type
files share one PNG; exe/lnk/ico embed their own icon so those stay
per-path). Two bugs found live: (1) teardown race - a fresh `resolveIcon`
closure each App render re-ran the effect and `live=false` suppressed
setIcon; cache now stores the shared Promise and every mount subscribes
(re-run resubscribes, resolved promise fires immediately). (2) per-path
cache keying minted ~400 duplicate PNGs; keyed by extension now (2 files
for the corpus). Icons appear in FileTree under .box/ by design (honest
disk view); isBoxUserObject keeps them out of The Box panel. Rust test:
file_icon_caches_png_and_rejects_bad_paths (19 Rust total).

Live-verified 2026-10-17 (twelfth pass, release build): creative-tech
preview sweep on an 11-fixture board plus shell lanes.

Decoders (all in-page, real DOM): `scan.tif` decoded via UTIF to an 8x8
png (vitest + live); `painting.psd` 6x6 via ag-psd composite;
`photo.dng` extracted its embedded JPEG to a blob: URL (zero-dep TIFF
0x0201/0x0202 walker); `kodachrome.cube` and `print.3dl` rendered as
96x32 graded strips (in-repo parsers; .3dl handles the optional
shaper-mesh line and 10/16-bit integer ranges).

Model lane (three.js, lazy chunk): glb/obj/pcd/xyz/bvh all mounted live
GL canvases; USDLoader covers usd/usda/usdc/usdz, LWOLoader covers
lwo/lwo2/bwo, KTX2Loader + vendored `public/basis/basis_transcoder.*`
for ktx2 - those three shipped without a live asset (code path only).

Shell thumbnail lane (`file_thumb` -> IShellItemImageFactory ->
`.box/thumbs/`): a real photo produced a 512x512 PNG; a real `.wmv`
tile rendered a 320x202 video frame through the full chain (video
element decode-failed -> TypedTile -> thumb -> img). Fake corpus files
(70-byte .png stubs) err 0x8004B200 and fall to icons - correct
degradation. Two real bugs fixed live: (1) canonicalized `\\?\`
verbatim paths made SHCreateItemFromParsingName return E_INVALIDARG -
stripped before the shell call; (2) SIIGBF_BIGGERSIZEOK returned
icon-bitmaps for every file - switched to SIIGBF_THUMBNAILONLY so only
real content thumbs qualify and everything else falls to the sharper
icon lane. Blender's `.blend` handler does not fire outside Explorer
context on this box; falls to icon.

Video error fallback: `broken.mp4` (corrupt) tile shows the shell icon
instead of a dead <video>. The `lut`/`raw`/`decoded-image` failures
degrade the same way.

Bugs found by live probing this pass: vite's UMD interop exposes
`utif` under a hashed key with no `.default` (interop shim added);
the IDE's organize-imports repeatedly dropped freshly-added import
specifiers mid-edit (parse3dl shipped as a dangling call site -
`parse3dl is not defined` at runtime - while typecheck stayed green;
verify dist imports after touching previews.tsx imports);
`tsc -b` typecheck passed a missing-name because dist .tsbuildinfo
served a stale emit - always rebuild dist before bundling.

Unit coverage: decodeMedia.test.ts (8 tests - raw walker LE/BE,
truncation/foreign-payload rejection, .cube 1d/3d/domain, .3dl
mesh/10-bit/ambiguity, strip identity + inversion); kind map extended
(usd*/pcd/xyz/bvh/lwo*/ktx2/psd->image/raw-family/lut family);
file_thumb adversarial test (20 Rust total).

Live-verified 2026-10-17 (thirteenth pass, release build): main
renderer chunk 904 -> 421 kB. CmBodyEditor went React.lazy - the
CodeMirror stack (~503 kB incl. lang-markdown) loads only when an
edge's note panel opens; clicked edge 0000000000000001 on the release
binary, `.cm-editor` mounted with the note body ("Edge 0."). The three
chunk (1.03 MB) and decode lane (288 kB ag-psd+decodeMedia, 84 kB
UTIF) were already lazy; remaining >800 kB warning is the lazy three
chunk only. Note: `Suspense` must be in the react import - the IDE's
organize-imports dropped it once more (typecheck caught it; same
failure class as the parse3dl incident).

Harness caveats for future sessions: CDP `Input.dispatchMouseEvent` does
not synthesize `dblclick` from click pairs in WebView2 - dispatch a DOM
`dblclick` MouseEvent instead (the React handler itself is verified);
ink-mode pointerdown consumes the gesture on file nodes, so a dblclick in
draw mode produces tap-dot strokes, not the editor; release and dev
binaries share the WebView2 user-data dir, so launching the release build
while `tauri dev` runs fails with 0x8007139F - kill the dev instance first.

The matrix is regenerated on each FR/test change - a CI lint step checks
every Stage-appropriate FR has a test-ref that exists.

Live-verified 2026-10-18 (release build on the bulk fixture): ADR-0007 v2
persisted undo - a real input drag moved `n-4204d4d8083f` from
(5719,-13083) to (7880,-12543); the debounced flush wrote
`.box/oplog-main-9394e662116ea6e5.json` (114 KB, `v:1`, `base` holding the
pre-drag board, `entries:[]` since one step needs no diff). The process
was killed and relaunched; `seedOplog` replayed the log on board open and
Ctrl+Z restored (5719,-13083) to both the live board and the saved
`.box.canvas` file. Ctrl+Y re-applied the move. Harness note: node
click-through needs `getBoundingClientRect` targeting - the transform on
`.board-body`'s child maps world to screen, and elementFromPoint at a
computed center can still land on `.canvas-viewport` if the node is
culled or overlapped.

Live-verified 2026-10-18 (release build, bulk fixture, `tools/stub-von.mjs`
on :8771 as the decision endpoint): ADR-0010 / FR-401 link-type
proposals - with `ai.enabled` absent, an edge draw produced no pill.
With `ai.enabled:true` + `ai.vonUrl` pointing at the stub, a handle-drag
edge fired a real POST (`questions=link_type from=f25.md to=f575.md`)
and the `supports?✓✕` pill mounted at the edge midpoint. Confirm wrote
`type: supports` to the link note, propagated to board `label` denorm and
the rendered `.edge-label`; dismiss unmounted with zero writes. Two bugs
only this pass surfaced: (1) the webview CSP `connect-src` blocks
outbound http, so `fetch` to loopback daemons fails before the wire -
decision transport now goes through a loopback-allowlisted Rust
`decide_post` (ureq); (2) `cdp-input` sent `buttons:1` on `mouseReleased`
and `mousePressed` regardless of button - now maps per-button masks and 0
on release, which fixed middle-drag panning. Harness note: `.node-handle`
is `pointer-events:none` until the node is hovered - send a settle `move`
before `down` or the draft never starts.

## 9. Manual/dogfood protocol (Stage 1 exit)

Christian, unaided, on `TheBox-Dev`: open folder → place 3 objects → draw 2
arrows → write in both notes → erase 1 arrow → delete 1 note in Explorer →
edit 1 image in Krita → close and reopen → confirm state. Pass = zero
confusion points recorded; friction logged as issues.
