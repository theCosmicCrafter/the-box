# ARCHITECTURE.md - System Design, Package Contracts, Salvage Map

|             |                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Status**  | Binding contract per package. Where this spec is more specific than the PRD, this spec wins; where silent, the PRD wins. |
| **Version** | 0.2 - 2026-10-12                                                                                                         |

## 0. Conventions that apply everywhere

- Repo root: `C:\Users\richk\CascadeProjects\the-box`. npm workspaces;
  dependencies pinned exactly at the root. Never `npm install` inside a task.
- TypeScript: ESM (`"type": "module"`), `NodeNext` resolution, `strict`.
  Import workspace packages by name (`@box/core`). Inside a package use
  relative imports with `.js` extensions.
- Tests: Vitest in `tests/**/*.test.ts` per package + `cargo test` in
  `apps/desktop/src-tauri` (adversarial module included). Unit tests never
  need a webview, a GPU, Von, Ollama, or network. Anything needing Chrome or
  an external app is an integration test and must skip cleanly with a logged
  reason when the tool is missing.
- Files UTF-8, LF endings. Plain human prose in docs and comments.
  **No em dashes** outside the `docs/plans/` exemption.
- Windows first: `path` (not string concat), `spawn` with `shell: false`,
  `windowsHide: true`, resolve Node CLI entry points to `.js` + `process.execPath`.
- No secrets in repo, fixtures, logs, or workspace files.
- Deleting user data means recoverable state (Recycle Bin), never hard delete.
- `box-core` never imports Electron, never opens a socket, never touches the
  network. All I/O goes through adapter interfaces (§4).

## 1. Shape

```
┌──────────────────────────────────────────────────────────────────┐
│ apps/desktop           Tauri 2 (ADR-0006; system webview)          │
│  Rust (src-tauri): scan, notify watcher, atomic writes, trash,     │
│    opener, box:// protocol + Range, session file, bound_root       │
│  renderer (vite):  hosts box-ui + box-core; state via Zustand;     │
│    reconcile/WritePlan execution moved here from old Electron main │
├──────────────────────────────────────────────────────────────────┤
│ packages/box-ui        React canvas + object renderers + ink       │
├──────────────────────────────────────────────────────────────────┤
│ packages/box-core      model, sync engine, vault iface, index,     │
│                        decisions client - pure TS, headless        │
├──────────────────────────────────────────────────────────────────┤
│ packages/box-mcp       optional MCP server (Stage 4)               │
└──────────────────────────────────────────────────────────────────┘
   optional, localhost only, core unaffected if all offline:
   Von :8770 (decisions)  Winnow :47311 (prune)  Ollama :11434
```

Dependency arrows point down only. `box-ui` knows `box-core`'s model types,
not its file I/O. `apps/desktop` adapts platform APIs to `box-core`
interfaces. `box-mcp` calls `box-core` like any client.

## 2. Verified facts (probed 2026-10-12, this machine)

| fact                                                                                                                                                                                                                                                                                              | source                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Tauri **2.12.3** + wry 0.57 + WebView2 154 verified on this machine: `tauri dev` boots, `tauri build` produces NSIS 2.19 MiB + MSI 3.14 MiB installers; CDP via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`                                                              | probe 2026-10-13                   |
| Custom scheme on Windows resolves as `https://box.localhost/<path>` (WebView2 limitation); renderer emits per-platform URL shapes via `resolveMedia` + `?v=<mtime>` cache-bust                                                                                                                    | probe 2026-10-13, CDP fetch        |
| `notify` crate watcher → 250ms debounce → `box:fs-dirty` event → renderer `sync.ts` full-scan reconcile: verified live, byte-exact convergence after 100-op fs storm (create/rename/delete/mkdir)                                                                                                 | probe 2026-10-13, CDP store diff   |
| `fs.watch` on Windows: emits `rename`/`change` only; deletes and renames both arrive as `rename`; duplicate `change` events normal; atomic saves interleave temp+target events                                                                                                                    | probe R-2 output (DATA-MODEL §5.1) |
| Obsidian tolerates **and preserves** unknown keys in `.canvas` by design: every node/edge carries `unknownData={}`, spread first on `getData()` then overridden by known keys (T-1, `obsidian.asar` app.js read 2026-10-12); plugin ecosystem corroborates                                        | `obsidian.asar` + `main.js`        |
| Von wire API: `POST 127.0.0.1:8770/v1/systemone`, body `{state, questions:{<n>:{type:noul\|choice\|score, instructions, criteria}}}` → `{answers:{<n>:{noul:<0..1>}}}`; env override `TYPESAFE_API_URL`. **Daemon offline at probe time - live-response/latency probe is a pending runbook task** | `jev-mcp/server.py:20-89`          |
| perfect-freehand 1.2.3 (MIT): `getStroke(points, StrokeOptions) -> Vec2[]` polygon outline; `simulatePressure` covers no-stylus input                                                                                                                                                             | `reference/perfect-freehand/src`   |
| tldraw SDK requires a license key for production (key-enforced, watermark on hobby tier)                                                                                                                                                                                                          | tldraw.dev/community/license       |
| WebKit media floor (Stage 5 macOS/iOS re-verify): VP8/VP9/AV1/HEVC/WebM present since Safari 18.4 audio rewrite; muted+inline autoplay allowed; residual quirk: PDF in `<iframe>` renders blank - use `<embed>` or pdf.js                                                                         | ADR-0006 evidence (T-15)           |

## 3. Package contracts

### 3.1 `@box/core` - the product

**Owns:** the workspace model, all file formats, the sync engine, the derived
index, the decisions client. The only package allowed to _specify_ file
content; it never performs I/O itself.

| submodule    | exports (planned surface)                                                                                                                                                                                                                                 | must not                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `model/`     | `Workspace`, `Board`, `CanvasNode` (text/file/link/group union), `CanvasEdge`, `LinkNote`, `InkSidecar`; `parseBoard()`, `serializeBoard()`, `parseLinkNote()`, `serializeLinkNote()`, `parseInkSvg()`, `serializeInkSvg()`, `newEdgeId()`, `newNodeId()` | no I/O, no Date.now/Math.random in serialization paths (deterministic output) |
| `sync/`      | `createEdge(board, from, to) → WritePlan`, `deleteEdge(edgeId) → WritePlan`, `reconcile(scan) → ReconcileReport`, `detectRename(deleted, created, hasher) → RenameMap` - implements DATA-MODEL §6 rules R-A..R-G                                          | never writes directly; emits `WritePlan` step lists the platform executes     |
| `vault/`     | `interface IVault { read(), writeAtomic(), trash(), scan() }`, `WritePlan { steps: WriteStep[] }`                                                                                                                                                         | platform-agnostic; no fs imports                                              |
| `watch/`     | `classifyEvents(events, prevState) → Delta[]`, `debounce(config)` - encodes DATA-MODEL §5.2 rules                                                                                                                                                         | pure; timing injected                                                         |
| `index/`     | `Index` over node:sqlite: `fileNodes`, `edgesByNote`, `noteByEdge`, `fts` tables; `rebuild(scan)`                                                                                                                                                         | schema is a cache; no queries required to be correct for truth                |
| `decisions/` | `interface IDecisionClient`, `VonClient(url)`, `decide(question) → {pick, p, confidence}`, feature gates                                                                                                                                                  | fails silent-offline by design; never blocks sync paths                       |

**Invariant:** `box-core` runs `vitest` headless. If a file in it imports
`electron`, `@tauri-apps/*`, `fs`, `net`, or `http`, the build fails (lint
rule).

### 3.2 `@box/ui` - the surface

**Owns:** rendering and interaction. Reads model objects; mutates only through
`box-core` calls via the IPC bridge (never imports IVault impls).

| submodule        | contents                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas/`        | camera (pan/zoom, `screenToWorld`/`worldToScreen`, zoomToFit - ported from CanvasMCPClient `canvasSlice`), node layer, edge layer, marquee selection, tool state |
| `objects/`       | `ImageObject`, `VideoObject` (HTML5, lazy-mount on viewport entry), `AudioObject`, `MarkdownCard`                                                                |
| `ink/`           | stroke capture → `getStroke` → outline → `.ink.svg` serialization hooks                                                                                          |
| `box-panel/`     | unplaced-file list, drag-to-place                                                                                                                                |
| `editor/`        | CodeMirror 6 link-note editor (frontmatter-aware: required-key highlight, `box-edge` read-only)                                                                  |
| `problem-items/` | reconcile warnings, malformed files, broken edges - a list, never silent                                                                                         |

### 3.3 `apps/desktop` - the platform (Tauri 2)

The platform is split across **Rust** (`src-tauri`, owns OS access) and the
**renderer** (`src/renderer`, plain vite + React; owns `box-core` and all
model logic). The reconcile loop that ran in Electron main now runs in the
renderer (`sync.ts`) - `box-core` is pure TS and needs no port.

**Rust layer** (`src-tauri/src/lib.rs`) adapts OS APIs to file services:

| adapter        | backed by                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| workspace scan | `walkdir` recursive listing, `.box/tmp`, `node_modules`, `.git` elided                                                  |
| watcher        | `notify` crate → 250ms debounce → emits `box:fs-dirty` on the window                                                    |
| atomic writes  | temp-file + `fs::rename`                                                                                                |
| recycler       | `trash` crate (Recycle Bin on Windows)                                                                                  |
| opener         | `opener` crate (open in default app, reveal in Explorer)                                                                |
| media protocol | `register_uri_scheme_protocol("box")` + `http_range`: 200/206/416, MIME via `mime_guess`+`infer`, 8 MiB-per-request cap |
| session        | last-workspace file under `app_data_dir`                                                                                |

**Path discipline:** every command takes a workspace-rel path that must pass
`resolve_inside` (parity-checked against `box-core` `isPathRel` in the
adversarial suite). Mutating commands (`fs_write_atomic`, `fs_trash`,
`fs_append_tombstone`) additionally bind to the **session root** set by
`fs_open_workspace`/`fs_watch_workspace` - a caller cannot aim a write at a
root the app never opened. `fs_append_tombstone` enforces the 16-hex edge-id
contract.

**IPC contract** (renderer ↔ Rust; `invoke` returns `{ok:true,...}` or
`{ok:false,error}` - the bridge wraps it):

| `window.box` method  | Tauri command          | returns                              |
| -------------------- | ---------------------- | ------------------------------------ |
| `openWorkspace`      | `fs_open_workspace`    | `{root, files:[{path,size,mtime}]}`  |
| `rescan`             | `fs_scan`              | same scan payload                    |
| `lastWorkspace`      | `session_last_root`    | `{root}` or `{root:null}`            |
| `watchWorkspace`     | `fs_watch_workspace`   | `{ok}` - begins `box:fs-dirty` push  |
| `onWorkspaceChanged` | `listen(box:fs-dirty)` | event payload `{paths:[PathRel]}`    |
| `readFile`           | `fs_read`              | UTF-8 lossy string (null only on IO) |
| `writeFileAtomic`    | `fs_write_atomic`      | `{ok}`                               |
| `trashFile`          | `fs_trash`             | `{ok}`                               |
| `appendTombstone`    | `fs_append_tombstone`  | `{ok}`                               |
| `openExternal`       | `fs_open_external`     | `{ok}` / `{ok:false,error}`          |
| `revealFile`         | `fs_reveal`            | `{ok}` / `{ok:false,error}`          |

**Renderer:** React 19 + Zustand 5; mounts `box-ui`. `bridge.ts` exposes
`window.box` over `@tauri-apps/api` `invoke`/`event.listen`; `sync.ts` owns
the watch→classify→reconcile→`WritePlan`→exec loop and pushes deltas into
the store. No `fs` access; all state arrives via payloads.

### 3.4 `@box/mcp` (Stage 4)

Read-mostly MCP server exposing `board.read`, `board.list-objects`,
`note.read`, `note.write` (through `box-core` - invariants hold for agents),
`search.query`, `box.unplaced`, `problem.list`. Contract format follows
`rea/docs/mcp-contracts.md` generated-catalog style (R-7c).

## 4. Canonical flows

```mermaid
sequenceDiagram
  participant U as User (arrow tool)
  participant R as Renderer (box-ui + box-core)
  participant P as Rust platform (src-tauri)
  participant F as Filesystem
  U->>R: drag A→B, drop
  R->>R: createEdge() → WritePlan[write link-<id>.md, write board+edge]
  R->>P: invoke fs_write_atomic(note)
  P->>F: temp+rename note
  R->>P: invoke fs_write_atomic(board)
  P->>F: temp+rename board
  R->>R: render edge, open note seeded
  Note over R,F: crash after step 1 → orphan note → reconcile R-C adopts
```

```mermaid
sequenceDiagram
  participant E as External app (Krita)
  participant W as notify watcher (Rust)
  participant R as Renderer (sync.ts)
  participant F as Filesystem
  E->>F: save (atomic: tmp→rename)
  F->>W: event burst {rename tmp, change tmp, rename target...}
  W->>W: 250ms debounce → emit box:fs-dirty{paths}
  W->>R: event → rescan → classifyFileSet → reconcile → WritePlans → invoke
  R->>R: push deltas to store → invalidate object, re-render
  Note over W,R: board self-write echoes suppressed via serialized-content compare
```

## 5. Concurrency model

- **Single writer:** all file mutations originate in `box-core` `WritePlan`s
  executed serially by the renderer through `window.box` (Rust executes the
  steps; it never invents writes). No second writer exists in-process.
- **External writers** are facts of life (that's the product). They arrive as
  watcher deltas; reconcile converges state - same rules for external and
  internal causes.
- **Ordering:** classify → reconcile plan → execute → emit deltas. Reconcile
  runs are not reentrant; a new trigger during a run queues one follow-up.
- **Locks:** none across processes. Atomic writes + reconcile make races
  converge; last-writer-wins is per-file only.

## 6. Error taxonomy

| class             | examples                                 | surfacing                                 |
| ----------------- | ---------------------------------------- | ----------------------------------------- |
| `ERR_MALFORMED_*` | bad board JSON, bad frontmatter, bad ink | problem-items panel; never thrown at user |
| `ERR_MISSING_*`   | endpoint file gone, note gone            | broken-render state; recoverable per §I-7 |
| `ERR_IO_*`        | permission, locked file                  | toast + retry affordance; logged          |
| `ERR_WORKSPACE_*` | not a folder, unreadable                 | open dialog error                         |
| `ERR_DECISION_*`  | Von offline, timeout                     | silent no-op (features hide)              |

No silent failure: every anomaly lands in `problem-items` or the reconcile
log. User data is never auto-deleted (tombstone completion is logged).

## 7. Performance budgets

| operation                                | target                     | measured via             |
| ---------------------------------------- | -------------------------- | ------------------------ |
| open workspace (5k files, warm index)    | ≤5s to interactive         | e2e fixture clock        |
| draw edge → note + edge visible          | ≤300ms                     | e2e assertion            |
| external save → object refresh           | ≤1s (incl. 100ms debounce) | watcher integration test |
| pan/zoom, 500 objects                    | ≥30fps                     | frame timing probe       |
| reconcile on open (5k files, cold index) | ≤15s, resumable            | logged timings           |

## 8. Salvage map (donor → target; R-6 verified inventory)

| take                                                                                                                                                                          | from                                    | into                       | disposition                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `Canvas`, `TextNode`, `FileNode`, `LinkNode`, `GroupNode`, `CanvasEdge` models                                                                                                | `obsidian-master-control-mcp/canvas.py` | `box-core/model`           | **port** - union types → TS discriminated unions                   |
| `parse_canvas_json`, `serialize_canvas`                                                                                                                                       | canvas.py:452-477                       | `box-core/model`           | **port** - add box-\* field handling + forward tolerance           |
| `generate_id` (uuid4().hex[:16])                                                                                                                                              | canvas.py:447                           | `box-core/model/newEdgeId` | **port** - `crypto.randomUUID`                                     |
| `detect_cycles`, `count_connected_components`, `get_node_connections`, `get_neighbors`, `calculate_bounding_box`, `get_nodes_in_group`, `node_in_bounds`, `get_node_preview`  | canvas.py helpers                       | `box-core/index` + `sync`  | **port**                                                           |
| node/edge CRUD + `batch_canvas_update` (ordered: del edges → del nodes(+edges) → add nodes w/ temp-id map → update nodes → add edges → update edges, per-op error collection) | `canvas_operations.py`                  | `box-core/sync`            | **adapt** - Python→TS; wrap each batch in WritePlan                |
| `canvas_overview`, `search_canvas_nodes` (type/regex/bounds/group filters), `get_canvas_subgraph` (depth expansion, internal/external edge flags)                             | `canvas_operations.py`                  | `box-core/index`           | **port** - query surface for UI + box-mcp                          |
| camera math: zoom clamp 0.1-5, `zoomToFit`, `panBy`, `screenToWorld`/`worldToScreen`, selectionBox, cursor states                                                             | `CanvasMCPClient/store/canvasSlice.ts`  | `box-ui/canvas`            | **port** - Redux actions → Zustand/store fns                       |
| `ConnectionVisualization`, `CanvasGrid`, `ZoomControls`                                                                                                                       | CanvasMCPClient components              | `box-ui/canvas`            | **adapt** - restyle to our model                                   |
| `UniversalWidgetEngine`                                                                                                                                                       | CanvasMCPClient                         | -                          | **skip** - its data model (SQLite widgets) is what we're replacing |
| `getStroke`, `getStrokePoints`, `getStrokeOutlinePoints`, `simulatePressure`                                                                                                  | `reference/perfect-freehand`            | `box-ui/ink`               | **depend** - MIT package, pinned 1.2.3                             |
| Project-core doctrine (folder-as-truth, atomic writes, manifest, deterministic contracts, e2e-to-file rig)                                                                    | `ResonanceStudio`                       | conventions                | **adopt patterns** - no code import                                |

Provenance rule: every ported/adapted file gets a header comment
`// Adapted from <path> (<license>): <what>; left out: <what>` and a row in
`THIRD_PARTY_NOTICES.md`.
