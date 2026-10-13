# ROADMAP.md - Stages, Exit Criteria, North Star

Stages are gates, not dates. A stage ships when its exit criteria pass -
not before. Pulling anything from the north-star lot forward requires an ADR.

## Stage 0 - Scaffold & decisions

**Goal:** a green repo with a runnable shell and the contract docs committed.

- [ ] Close OQ-1 (canvas superset) and OQ-4 (link-note scope) - ADR entries
- [ ] npm workspaces scaffold: `apps/desktop`, `packages/box-core`, `packages/box-ui`
- [ ] `box-core` skeleton: model types + `.box.canvas` parser/serializer (port from `obsidian-master-control-mcp/canvas.py`)
- [ ] Electron shell opens a folder, lists files (no canvas yet)
- [ ] CI: typecheck + lint + vitest green
- [ ] Fixture workspace generator in `tools/`

**Exit:** `npm ci && npm run dev` opens the shell; all gates green.

## Stage 1 - PoC (the wedge)

**Goal:** prove the three-sentence spec end to end. The PoC exists to prove
_sync_, not canvas - that's the risk worth retiring first.

- [ ] FR-101..FR-113 (objects, ink, arrows↔notes, round-trip, `.box.canvas`)
- [ ] Invariant tests I-1..I-5 green (I-6..I-9 land with their features)
- [ ] `decisions.ts` client exists behind a flag (may be stubbed offline)

**Exit (also PRD §9 acceptance):** draw arrow → note file exists; erase →
note gone; delete note → edge gone; external save → canvas refreshes;
reopen with index deleted → identical state; Christian does it unaided.

## Stage 2 - The canvas earns its name

- [ ] FR-201..FR-207 (infinite pan/zoom, Box holding area, multi-board,
      edge labels/types, jump-to-link, audio objects, CM6 note editor)
- [ ] Ink sidecar as first-class linkable object (FR-307 partial)
- [ ] Salvaged canvas code adapted from `reference/CanvasMCPClient` organs

**Exit:** 500-object board stays ≥30fps; a week of real use on TheBox-Dev
without manual file surgery.

## Stage 3 - Sync hardening + media polish

- [ ] FR-301..FR-307 (closed-app deletes, external `.canvas` edits, renames,
      multi-board consistency, broken-edge recovery, open-with prefs,
      spatial audio modes, ink colors)
- [ ] Invariants I-6..I-9 green; problem-items UI for malformed notes

**Exit:** rename/move/delete chaos test (scripted, 100 random ops) leaves
zero orphaned truth; dogfood clearance for Christian's real vault.

## Stage 4 - Intelligence (local-only, all optional)

- [ ] FR-401..FR-407 (Von link-type suggestion, triage, near-dup,
      confidence-gated placement suggestion, semantic related-items,
      box-mcp exposure, graceful offline)
- [ ] LanceDB index; embedding pipeline for the workspace

**Exit:** every AI feature demonstrably no-ops with Von/Ollama killed;
suggestion UI never commits an unconfirmed inference (I-9 holds under AI).

## Stage 5 - Reach

- [ ] FR-501..FR-503 (touch/pen pass + iPad path ADR, optional WASM brushes,
      shareable workspaces)
- [ ] Package/release pipeline for a second machine

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
