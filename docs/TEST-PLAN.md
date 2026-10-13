# TEST-PLAN.md - Verification Strategy

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| **Status**  | Contract - every invariant and Stage-1 FR maps to a test here |
| **Version** | 0.1 - 2026-10-12                                              |

House rules: unit tests need no Electron, GPU, Von, Ollama, or network.
Anything needing an external tool is an integration test and **skips with a
logged reason** when the tool is missing - never a silent pass, never a
spurious failure. Electron proofs write result files; stdout from
`electron.exe` does not reliably reach a Windows pipe (verified house rule).

## 1. Pyramid

```
        manual dogfood (Christian, Stage 1 exit)
       e2e - Electron selftest → result file
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
| `it-watcher-refresh` | modify fixture file → assert delta → object refresh (real chokidar, tmpdir)           |
| `it-open-with`       | mock `shell.openPath`; assert per-type mapping                                        |
| `it-note-editor`     | CM6 editor → atomic save → note round-trips                                           |
| `it-von-*`           | Von client: offline → feature no-ops; contract-test payload shape vs `jev-mcp` source |

## 7. E2E (Stage 2+)

Electron selftest mode: launch built app headless, drive the PoC journey,
write JSON result to a file, assert on that file in CI. Mirrors the
ResonanceStudio `test:e2e`/`test:ui` split - selftest for logic, driven-UI
pass for rendering.

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
