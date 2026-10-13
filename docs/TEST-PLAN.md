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

| #   | defect                                               | root cause                                                                      | fix                                              |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | unsatisfiable `Range` (start ≥ len) returned 404     | `http_range` `NoOverlap` mapped to err                                          | return 416 + `Content-Range: bytes */len`        |
| 2   | `bytes=` (empty spec) treated as valid 416           | `Ok([])` conflated with unsatisfiable                                           | `Ok([])` → malformed error                       |
| 3   | `classifyFileSet` double-reported duplicate paths    | dedup map built but raw array iterated                                          | iterate deduped map                              |
| 4   | tombstoned-edge oscillation (delete never converged) | R-D trashed note but left board edge; R-A regenerated stub next pass            | R-D completion strips the board edge same-pass   |
| 5   | `fs_append_tombstone` accepted any string            | no edge-id contract check                                                       | enforce exactly 16 hex chars                     |
| 6   | zip thumbnail decompression bomb                     | `unzipSync` eager, no output cap                                                | `filter` rejects entries `originalSize` > 64 MiB |
| 7   | link-note body grew +1 byte per round-trip           | gray-matter `stringify` appends `\n`; parse only stripped leading fence newline | strip exactly one serializer-added trailing `\n` |

Hardening that shipped in the same pass (not defect-driven): `bound_root`
session binding on all mutators; 8 MiB cap per `box://` range request;
lossy UTF-8 `fs_read` (matches prior Node semantics, never null on binary).

## 8. Verification matrix (living)

| FR                    | test                       | stage | status  |
| --------------------- | -------------------------- | ----- | ------- |
| FR-101                | `e2e-open-workspace`       | 1     | planned |
| FR-105                | `it-ink-sidecar`           | 1     | planned |
| FR-107                | `invariant-I1-draw-edge`   | 1     | planned |
| FR-108                | `invariant-I2-erase-edge`  | 1     | planned |
| FR-109                | `invariant-I3-delete-note` | 1     | planned |
| FR-110                | `it-open-with`             | 1     | planned |
| FR-111                | `it-watcher-refresh`       | 1     | planned |
| FR-112                | `it-board-roundtrip`       | 1     | planned |
| FR-113                | `it-placement-schema`      | 1     | planned |
| (all later-stage FRs) | per PRD §5 test-ref        | 2-5   | planned |

The matrix is regenerated on each FR/test change - a CI lint step checks
every Stage-appropriate FR has a test-ref that exists.

## 9. Manual/dogfood protocol (Stage 1 exit)

Christian, unaided, on `TheBox-Dev`: open folder → place 3 objects → draw 2
arrows → write in both notes → erase 1 arrow → delete 1 note in Explorer →
edit 1 image in Krita → close and reopen → confirm state. Pass = zero
confusion points recorded; friction logged as issues.
