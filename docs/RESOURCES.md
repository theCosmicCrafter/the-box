# RESOURCES.md - Build-Asset Inventory

| | |
|---|---|
| **Purpose** | Everything we build with, in one place. A new contributor should answer "what do we have and where does it live" from this file alone. |
| **Version** | 0.1 - 2026-10-12 |

## 1. Codebases - donors and take/leave

| source | location | provides | take / leave | target |
|---|---|---|---|---|
| ResonanceStudio | `CascadeProjects\ResonanceStudio` | monorepo conventions, folder-as-truth doctrine, e2e-to-file rig, SPEC style | adopt patterns; no code import | conventions everywhere |
| obsidian-master-control-mcp | `CascadeProjects\obsidian-master-control-mcp` | `canvas.py` (models, `generate_id`, helpers), `canvas_operations.py` (14 ops) | **port** - the box-core seed | `packages/box-core` |
| CanvasMCPClient | `mcp-research-platform\external\CanvasMCPClient` | `canvasSlice` camera math, `ConnectionVisualization`, `CanvasGrid`, `ZoomControls` | **port** slices; **leave** SQLite model + UniversalWidgetEngine | `packages/box-ui` |
| jev-mcp | `CascadeProjects\jev-mcp` | Von wire format, done-gate/supervise patterns | reference for `decisions/` | `box-core/decisions` |
| perfect-freehand | `the-box\reference\perfect-freehand` | `getStroke` pipeline (verified) | dependency 1.2.3 (MIT) | `box-ui/ink` |
| jsoncanvas-main | `CascadeProjects\jsoncanvas-main` | spec 1.0 locally | normative reference | DATA-MODEL |
| Lorien-main | `CascadeProjects\Lorien-main` | strokes-as-points file format | patterns for `.ink.svg` | `box-ui/ink` |
| drawing-app | `CascadeProjects\drawing-app` | layers/brushes in Electron+React | patterns if ink deepens | `box-ui/ink` |
| dgmjs-main, mind-map-main | `CascadeProjects\` | diagram engine, mind-map | interaction patterns | `box-ui/canvas` |
| pixijs-dev | `CascadeProjects\pixijs-dev` | WebGL renderer source | Stage 5 upgrade path | `box-ui/canvas` |
| AnimRef | `the-box\reference\AnimRef` | PureRef+video board UX | board-UX research | `box-ui` polish |
| reference-vault | `the-box\reference\reference-vault` | Electron+React file browser w/ index | closest existing mini-Box | `box-panel`, `index` |
| GitNexus | `the-box\reference\GitNexus` | client-side knowledge graph + GraphRAG | index/graph patterns | `box-core/index` |
| PhotoMapAI | `the-box\reference\PhotoMapAI` | AI semantic map of collections | inferred-placement research | Stage 4 |
| KAssetManager | `the-box\reference\KAssetManager` | asset manager | asset-spine patterns | `box-panel` |
| agentfs | `the-box\reference\agentfs` | agent-visible filesystem | `box-mcp` design | Stage 4 |
| huginn | `the-box\reference\huginn` | automation agent patterns | agent ops reference | Stage 4 |
| aurora-fileshare | `the-box\reference\aurora-fileshare` | WebRTC P2P file transfer | shareable worlds | Stage 5 |
| hammer-editor | `the-box\reference\hammer-editor` | story tool | narrative-workspace patterns | UX research |
| hokusai, brushlib-wasm | `the-box\reference\` | real brush engines | Stage 5 option - license check first (possible copyleft flag) | `box-ui/ink` upgrade |
| interfaces, braindance | `the-box\reference\` | interface/workflow refs | patterns | UX research |
| file_monitor, fileflow | `F:\AIPrograms\_Utilities`, `CascadeProjects\fileflow` | watcher + rules-engine patterns | reference for `watch/` | `box-core/watch` |
| ismail | `CascadeProjects\ismail` | MCP-driven DAW, 70 tools | audio-object backend ideas | Stage 3/4 |
| engram, ego-mcp, unified-memory, khoj, memory-lancedb | `CascadeProjects\` | memory/knowledge stacks | Stage 4 semantic layer refs | `index` |
| rea (fork) | `github.com/theCosmicCrafter/rea` | reverse-engineering MCP: JS/Electron/ASAR/SQLite inspection | **verification tool** (R-7) - Obsidian parser truth, competitor storage forensics | research only |

## 2. Local services (localhost only)

| service | endpoint | provides | rules |
|---|---|---|---|
| Von System One | `http://127.0.0.1:8770/v1/systemone` | typed decisions ~29ms (`noul`/`choice`/`score`) | offline = Stage 4 hides; ~1.5GB VRAM resident when up |
| Winnow | `http://127.0.0.1:47311/hook/post-tool-use` | output pruning before LLM ingestion | optional |
| Ollama | `http://127.0.0.1:11434` | embeddings, heavier gen (Stage 4) | zero-cloud lane |
| ComfyUI | `http://127.0.0.1:8189` | image gen - **not a dep**; shares the GPU | check `/queue` before GPU work |

## 3. Machine

- Windows 11 workstation; **one RTX 5090** shared by ComfyUI + Von (~1.5GB
  resident). The app must never require the GPU.
- Dev toolchain: Node 24.x, npm workspaces, Python 3.12 (`PYTHONUTF8=1`).
- Drives: C: (repo), F: (AIPrograms, vault, utilities), D:/G: (media, tools -
  search before downloading anything).
- Secrets: Bitwarden Secrets Manager - never `.env`, never committed.

## 4. Tooling assets

| asset | role |
|---|---|
| REA fork (`rea-agents` npm) | verified-facts probes: Obsidian `.canvas` parser truth, competitor storage forensics (R-7) |
| `jsoncanvas-main/spec/1.0.md` | normative board spec (local) |
| Skills (`writing-plans`, `review-agent`, `verification-before-completion`, `jev-search`) | doc/code review and verification flow |
| ODIN mesh + `canvas-scribe` agent role | future board-maintenance agents (Stage 4, via box-mcp) |
| installed apps for open-with targets | Krita (`D:\krita`), Rebelle 8 (`F:\Rebelle 8`), Resolve, Blender, mpv, Eagle - all present on this machine |

## 5. People

| person | role |
|---|---|
| Christian | product owner - scope, UX, dogfood, app-list evaluation |
| Rich | engineering lead - architecture, formats, infra, gates |
| agents | contributors under AGENTS.md rules |

## 6. External references

- Jev/OpenJev wire API (`jev-mcp` source; OpenJev = open-source compat impl
  `razorback16/openjev`)
- JSON Canvas 1.0: `jsoncanvas-main/spec/1.0.md`
- Electron 44 release notes (Node 24.18.1 embedded)
- LF/OpenSSF community-health conventions (FOSS file set in this repo)
