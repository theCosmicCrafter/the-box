# T-8 - Heptabase

| | |
|---|---|
| **Method** | `Heptabase-Setup-1.112.3.exe` (official GitHub release, `heptameta/project-meta`) → NSIS → `app-64.7z` → `app.asar` extracted; plus vendor's public `heptabase-cli-skills` repo |
| **Verified** | 2026-10-13 |
| **Status** | Complete |

## Verified architecture (from the extracted bundle)

- **Electron** - `resources/app.asar` inside electron-builder NSIS payload.
- **Local truth = SQLite** - `better-sqlite3` in production `dependencies`;
  main-process worker layer `database/dbMaster.js`, `dbWorker.js`,
  `dbMap.js`. Vendor's own skill doc warns: "Never directly read, write,
  or modify Heptabase app data through local database files" - the DB is
  the truth, files are not the user-facing model.
- **Cards** are canonical objects: `note`, `journal`, `pdfCard`,
  `imageCard`, `videoCard`, `audioCard`, `webCard`. Content = **ProseMirror
  JSON** (`card-content-schema.md`); markdown is a CLI-level convenience.
- **Whiteboards hold placements, not cards**: objects are referenced as
  `inst:<placementId>` - "a canonical object may have more than one
  visible placement" (vendor whiteboard.md). Same placement-vs-source
  separation as our file+placement model.
- **Connections** (vendor schema):
  `{from:{id,objectType,position}, to:{...}, direction: oneWay|twoWay|none,
  routeType: straight|elbow|curve}`, positions `auto|top|right|bottom|left`.
  **No label, no type vocabulary, no attached document** - connections are
  geometry + direction only. The arrow-meaning gap Christian identified is
  confirmed at API level.
- **Sections** = visual containers wrapping geometry.
- **ELK.js** bundled for auto-layout; **pdfjs-wasm** for PDFs; mind-map
  commands built on stable structural node IDs.
- **`local-file-mvp/`** module present in main process
  (`LocalFileAlphaStore`, `localFileMvpPhysicalIdentity`, preview protocol,
  `local_file_mvp_account_aggregate` table) - Heptabase is actively
  building toward local-file access. Even a DB-truth product is moving
  toward files.

## The agent surface - direct box-mcp precedent

Embedded **localhost HTTP server** in the Electron main process
(`local-server/localServer.js`, `localServerRouter.js`,
`cliOperationRouting.js`, `cliActionSchema.js`) + a `heptabase` CLI +
a public Agent-Skills package (`heptabase-cli-skills`, agentskills.io
spec). Documented properties:

- All commands JSON in/out; mutations serialized, reads concurrent.
- 1 MB JSON body limit; 10 s body-send timeout.
- **"Created by AI" marking** on agent-created content by default.
- **Lint + schematic screenshot** verification loop for canvas edits:
  read -> mutate small scope -> reread -> `whiteboard lint` -> focused
  screenshot -> repair. A full agent-facing canvas QC protocol.

## Adopt vs reject

| adopt | reject |
|---|---|
| `inst:` placement IDs vs canonical object IDs (already our model, validated) | DB-as-truth |
| Connection schema: endpoint positions + direction + routeType for our edge geometry | ProseMirror JSON as storage format (markdown files stay our truth; TipTap as *editor* is unaffected) |
| Agent surface: in-app local server + CLI + published skills = box-mcp template | vendor warning model ("don't touch the DB") - ours must be the opposite: files are documented and safe |
| "Created by AI" provenance marking for agent-created objects/notes | - |
| Lint+screenshot QC loop for agent canvas work | - |

## Implication

The funded competitor's answers, verified: SQLite truth, cards-as-objects,
whiteboards-as-placements, connections-as-geometry-only. Our two
differentiators stand: files-as-truth and connections-with-documents.
