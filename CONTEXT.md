# CONTEXT.md - The Box

> Zero-context brief. If you know nothing about this project, read this first, then `docs/PRD.md`.

## What this is

An independent local-first desktop app: an infinite-ish canvas where every object is a real file,
every arrow is a real Markdown note, and every object round-trips to external editors.

**Product sentence:** _A lighter Obsidian with a smarter canvas._
**Kernel spec:** _Objects are files. Arrows are notes. Edits round-trip._

Obsidian is the UX reference both stakeholders know. It is **not** a dependency - The Box is a
standalone **Tauri 2** app (ADR-0006, migrated from Electron 2026-10-13) that happens to read the
same `.canvas` + `.md` formats for interop.

## Current state

| Area             | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application code | **Stage 1 canvas live on Tauri 2:** `@box/core` kernel (89 tests green incl. adversarial suite), `@box/ui` DOM/SVG canvas (ADR-0004), `apps/desktop` = Rust platform (`src-tauri`: scan/notify watcher/atomic writes/trash/`box://`+Range/session) + TS renderer (`bridge.ts`, `sync.ts` reconcile loop). Verified live under WebView2 via CDP: watch→reconcile→store convergence after a 100-op fs storm, corrupt board → problem item, malformed previews mount clean. `tauri build` → 2-3 MiB installers. Drag-drop: FileTree→canvas, OS→canvas (imports into workspace), right-click menus (canvas: new note/doc/board/import/paste; node: open/reveal/remove/trash). |
| Documentation    | **Contract-grade and authoritative:** PRD, DATA-MODEL (formats + sync), ARCHITECTURE (packages + verified facts), DEVOPS (pinned toolchain), TEST-PLAN, SECURITY-THREATS, RESOURCES, GLOSSARY, research/SOTA-SURVEY, ADRs 0001-0005                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `reference/`     | 14 donor repos cloned for organ-donor reuse (see `docs/ARCHITECTURE.md` §Salvage Map). **Never imported by shipped code.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| FOSS posture     | Private (`LICENSE` = UNLICENSED marker, OQ-8 pending). Community-health set complete: CoC, SECURITY, GOVERNANCE, THIRD_PARTY_NOTICES, .github templates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Non-negotiables (short list - full rationale in PRD §Pillars)

1. **Files are truth.** Databases/indexes are rebuildable caches only.
2. **Arrows are notes.** Every edge has a `link-<edgeid>.md` file; sync is two-way.
3. **Sources are immutable.** Ink lives in `.ink.svg` sidecars; media is never rewritten.
4. **Zero cloud.** All AI runs local (Von :8770, Winnow :47311, Ollama :11434).
5. **Deletion is recoverable.** Recycle Bin, never `unlink` on user data.

## Where things live on this machine

- This repo: `C:\Users\richk\CascadeProjects\the-box`
- Donor canvas code: `C:\Users\richk\CascadeProjects\mcp-research-platform\external\CanvasMCPClient`
- Board model to port: `C:\Users\richk\CascadeProjects\obsidian-master-control-mcp` (`canvas.py`)
- Architectural template: `C:\Users\richk\CascadeProjects\ResonanceStudio`
- Local decision engine: `jev-mcp` → Von System One `http://127.0.0.1:8770/v1/systemone`

## How to start contributing

1. Read `docs/PRD.md` → `docs/DATA-MODEL.md` → `docs/ARCHITECTURE.md` → `docs/GLOSSARY.md`.
2. Check `docs/adr/ADR-0001-foundation.md` §Open Decisions before proposing design changes.
3. Follow `docs/DEVOPS.md` for toolchain, `docs/RESOURCES.md` for what we build with, and `CONTRIBUTING.md` for workflow (DCO + SPDX rules apply).
4. Doc-first rule: design changes get a doc edit + ADR entry before code.
