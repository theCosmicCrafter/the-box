# ROADMAP.md - Stages, Exit Criteria, North Star

Stages are gates, not dates. A stage ships when its exit criteria pass -
not before. Pulling anything from the north-star lot forward requires an ADR.

## Stage 0 - Scaffold & decisions

**Goal:** a green repo with a runnable shell and the contract docs committed.

- [x] Close OQ-1 (canvas superset) and OQ-4 (link-note scope) - ADR entries
- [x] npm workspaces scaffold: `apps/desktop`, `packages/box-core`, `packages/box-ui`
- [x] `box-core` skeleton: model types + `.box.canvas` parser/serializer (port from `obsidian-master-control-mcp/canvas.py`)
- [x] Tauri 2 shell opens a folder, lists files (ADR-0006; Electron replaced 2026-10-13)
- [x] CI: typecheck + lint + vitest green
- [x] Fixture workspace generator in `tools/` (`tools/fixtures/gen-bulk.mjs`)

**Exit:** `npm ci && npm run dev` opens the shell; all gates green. **Done.**

## Stage 1 - PoC (the wedge)

**Goal:** prove the three-sentence spec end to end. The PoC exists to prove
_sync_, not canvas - that's the risk worth retiring first.

- [x] FR-101..FR-113 (objects, ink, arrows↔notes, round-trip, `.box.canvas`)
- [x] Invariant tests I-1..I-5 green (I-6..I-9 land with their features)
- [x] `decisions.ts` client exists behind a flag (may be stubbed offline)

**Exit (also PRD §9 acceptance):** draw arrow → note file exists; erase →
note gone; delete note → edge gone; external save → canvas refreshes;
reopen with index deleted → identical state; Christian does it unaided.
**All verified live via CDP except the human dogfood gate.**

## Stage 2 - The canvas earns its name

- [x] FR-201..FR-207 (infinite pan/zoom, Box holding area, multi-board,
      edge labels/types, jump-to-link, audio objects, CM6 note editor) -
      all live-verified; CM6 note-body editor landed (markdown highlighting,
      frontmatter read-only by construction, atomic save)
- [x] Foreign `.canvas` ingest (ADR-0009): any spec JSON Canvas file
      normalizes in place on open (id remap + generated link notes) and
      stays spec-readable - the Obsidian interop path
- [x] Ink sidecar as first-class linkable object (FR-307): .ink.svg
      sidecars are user objects - placeable, linkable, bound ones badged
      in The Box, render through <img>
- [~] Salvaged canvas code adapted from `reference/CanvasMCPClient` organs -
  patterns ported (culling, proximity stroke pick, burst-safe camera);
  storytold/craft-libs `atomic` write hardening landed
- [~] Undo: session snapshot stack live (Ctrl+Z/Y, ADR-0007); persisted
  op-log beside `.box.canvas` is the accepted v2 (T-14, Tietze pattern;
  fits files-are-truth) - deferred until the op vocabulary stabilizes
- [x] Edge re-route: drag a selected edge's endpoint onto another node;
      board + link-note denorms retarget atomically, empty-drop cancels
- [x] Regions with parameters (ADR-0008): group nodes carry `box-region`
      {v,locked,params} - locked children ignore drags/nudges, region
      carries members; params bag reserved for Stage-4 (T-14, Ferrate
      biome pattern)
- [~] Ink smoothing polish: stroke quality over feature count (T-14,
  InfinitiCanvas/perfect-freehand evidence) - perfect-freehand live;
  pressure, color, size, stroke-move edit shipped

**Exit:** 500-object board stays ≥30fps; a week of real use on TheBox-Dev
without manual file surgery. **Perf met: 60 FPS median release / 41 FPS dev,
measured via `tools/perf-probe.mjs` on a 500-node board.**

## Stage 3 - Sync hardening + media polish

- [~] FR-301..FR-307 (closed-app deletes, external `.canvas` edits, renames,
  multi-board consistency, broken-edge recovery, open-with prefs,
  spatial audio modes, ink colors) - all live-verified; spatial
  audio modes landed (off/all/viewport, WebAudio pan+gain by node
  position vs viewport, pref persisted)
- [x] Invariants I-6..I-9 green; problem-items UI for malformed notes
      (clickable rows locate+select the offending node)
- [ ] OS-native icon fallback for typed tiles via `app.getFileIcon` IPC
      (T-14, Eagle native.js analog: blend/c4d/dwg and friends)
- [ ] Deferred parser queue, gated on a real file needing it: ag-psd (PSD),
      camera-RAW embedded-JPEG extraction, HEIC/JXL decode (T-9/T-14)
- [x] Windowed/chunked board processing for very large boards (T-14,
      AAAI Infinite-Canvas technique; also feeds the 3D north star) -
      shipped as viewport culling (`display:none`, selected/editing/inking
      exempt)

**Exit:** rename/move/delete chaos test (scripted, 100 random ops) leaves
zero orphaned truth; dogfood clearance for Christian's real vault.

## Stage 4 - Intelligence (local-only, all optional)

- [ ] FR-401..FR-407 (Von link-type suggestion, triage, near-dup,
      confidence-gated placement suggestion, semantic related-items,
      box-mcp exposure, graceful offline)
- [ ] LanceDB index; embedding pipeline for the workspace
- [ ] Typed edge payloads: link-note `type:` gains executable semantics
      (prompt ref, dataflow) without breaking arrows-are-notes (T-14,
      Koll.ai pattern)
- [ ] AI/CLI sessions as canvas nodes (Von/Ollama/ComfyUI); local-only
      invariant already holds (T-14, Atlas pattern)

**Exit:** every AI feature demonstrably no-ops with Von/Ollama killed;
suggestion UI never commits an unconfirmed inference (I-9 holds under AI).

## Stage 5 - Reach

- [ ] FR-501..FR-503 (touch/pen pass + iPad path ADR, optional WASM brushes,
      shareable workspaces)
- [ ] macOS WKWebView re-verification pass on all presenters (PDF via
      `<embed>` or pdf.js, codec spot-checks, FontFace/WebGL parity) -
      Christian's Mac is the host (ADR-0006)
- [ ] iOS build on a macOS/Xcode host (`tauri ios build`); engine is
      WKWebView under every framework, so the presenter matrix above is the
      gate
- [ ] Package/release pipeline for a second machine (NSIS/MSI already proven
      at 2-3 MiB; dmg/notarization on the Mac)

## North Star (parked - schema-protected, not scoped)

- **3D projection:** `box-placement.3d` field already reserved; machine holds
  the full capture→splat→render chain (Brush/3DGS, instant-ngp, Kinect/ZED,
  MediaPipe, Unreal MCP plans).
- **Worlds, not boards:** spatial audio in 3D, physical-object capture as
  first-class objects.
- **Trigger to un-park:** Stage 3 shipped + a written ADR proposing the 3D
  viewer as a second projection of the same files.

## Explicitly not on the roadmap

Real paint engine (external tools cover it), cloud sync, multi-user realtime,
mobile editing, plugin marketplace. Revisit only by ADR.
