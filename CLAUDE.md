# CLAUDE.md - The Box

You are working on **The Box**: an independent, local-first "world-building OS" -
a lighter Obsidian with a smarter canvas. One workspace is simultaneously ordinary
files and folders, a 2D infinite canvas, and eventually a 3D world.

## The product kernel (memorize this)

> **Objects are files. Arrows are notes. Edits round-trip.**

- Files on disk are the source of truth. The canvas is a projection, never a store.
- Drawing an arrow between two objects creates a real `link-<edgeid>.md` note.
- Ink lives in `<file>.ink.svg` sidecars - editable forever, never baked into media.
- External creative tools stay usable via open-with; AI is an optional layer that
  proposes, never silently rewrites or relocates user content.

## Required reading before any change

1. `CONTEXT.md` - current verified state
2. `docs/DATA-MODEL.md` - the binding file-format contract + invariants I-1..I-9
3. `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/adr/` - scope and settled decisions
4. `AGENTS.md` - binding repo rules (same rules apply to you)
5. `docs/TEST-PLAN.md` - verification matrix + live-harness quirks

**Doc-first rule:** changes to file formats, sync semantics, pillars, or scope land
in docs (+ an ADR) *before* code. If code and docs disagree, docs win.

## Layout

- `packages/box-core` - pure TS model, parsers, serializers, reconcile, write plans.
  **No network, no Node globals** (no Buffer - WebView2 lacks it).
- `packages/box-ui` - React 19 DOM/SVG canvas: BoardView, NodeView, EdgeLayer,
  Viewport (camera/gestures), ink.ts, cull.ts, grid.ts, BoxPanel, Ribbon.
- `apps/desktop` - Tauri 2 shell. `src-tauri/src/lib.rs` = Rust platform
  (scan, watcher, atomic writes, trash, `box://` media server, open-with spawn).
  `src/renderer/` = React app + `bridge.ts` IPC + `settings.ts` (.box/settings.json).
- `tools/` - `cdp-eval.mjs` / `cdp-input.mjs` (live CDP driver), `perf-probe.mjs`,
  `fixtures/gen-bulk.mjs` (5k-file/500-node corpus), `msi-smoke.ps1`.
- `reference/` - donor repos for study/salvage only. **Shipped code never imports
  it.** Salvaged code is copied into `packages/` with an SPDX/provenance header
  and a `THIRD_PARTY_NOTICES.md` row - required before merge.

## Commands

```bash
npm run typecheck   # tsc -b, strict + exactOptionalPropertyTypes - must be clean
npm run lint        # eslint - must be clean
npm test            # vitest across workspaces (103 core + 49 UI)
cargo test          # in apps/desktop/src-tauri (16 adversarial tests)
cargo clippy        # clean
npm run tauri build -w @box/desktop   # Windows MSI + NSIS installers
```

## Non-negotiables

- TypeScript strict everywhere. No `any` without a comment justifying it.
- Pinned deps only; new deps must be >=7 days old and surveyed in
  `docs/research/SOTA-SURVEY.md` first.
- Deletion means Recycle Bin / recoverable state - never unlink user files.
- I-9: reconcile and AI never move or silently mutate placed objects.
- Preserve unknown settings/frontmatter keys on round-trip.
- Zero cloud: decision models route to local services only (Von :8770,
  Winnow :47311, Ollama :11434). Never send code or vault data to external APIs.
- Plain prose, no em dashes, UTF-8 LF in docs and source.
- `PYTHONUTF8=1` on every Python launch.

## Live verification harness (Windows + WebView2)

Launch the release binary with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then:

- `node tools/cdp-eval.mjs '<js expr>'` - evaluate in the page (async OK via Promise)
- `node tools/cdp-input.mjs '[{"type":"down","x":..,"y":..},{"type":"move",...},{"type":"up",...}]'`
  - real input pipeline. **Types are `down`/`move`/`up`/`click`, not press/release.**
- `window.__boxStore.getState()` exposes files, board, problems, selected.
- `dispatchMouseEvent` does NOT synthesize `dblclick` - dispatch a DOM MouseEvent.
- Dev and release binaries share the WebView2 user-data dir - they cannot run
  simultaneously (0x8007139F). Kill one first.

## Definition of done

typecheck + lint + tests + clippy green; every claim in TEST-PLAN marked `live`
was actually exercised through the real app (not just unit tests); file-format
changes carry a round-trip test; docs updated in the same commit.
