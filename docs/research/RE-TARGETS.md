# RE-TARGETS.md - Reverse-Engineering and Study Targets

|             |                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose** | The list of tools to take apart for behavioral study before we build. Say yes/no per row and we proceed in that order.                                                                   |
| **Rules**   | Study behavior, document semantics, write our own code. Never copy code, strings, or assets. Findings go to `docs/research/findings/` as behavior notes, each stamped `verified <date>`. |

## Methodology

Three lanes, cheapest first:

1. **Clone/read** - source is available; just study it. Zero RE needed.
2. **Inspect** - closed-source but locally inspectable: Electron asar extraction, file-format hex/json reads, SQLite schema dumps, runtime observation (create files in the app, watch what it writes). REA (`rea-agents`) does asar/JS/SQLite analysis; manual `npx @electron/asar extract` + reading bundled JS works too.
3. **Observe** - can't inspect internals; black-box its file outputs only.

## Target list (yes/no per row)

| #    | target                                                | lane                   | what we learn                                                                    | effort | status                                                                                              |
| ---- | ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| T-1  | **Obsidian** (`obsidian.asar`, installed)             | Inspect                | Canvas parser internals: unknown-key tolerance, rename semantics, write ordering | medium | **done** - `unknownData` mechanism found in parser ([findings](findings/T-1-obsidian-internals.md)) |
| T-2  | **Excalidraw** (`excalidraw/excalidraw`)              | Clone                  | Ink/drawing UX, `.excalidraw` format, binding model                              | low    | **done** ([findings](findings/T-2-excalidraw.md))                                                   |
| T-3  | **Kinopio** (`kinopio-club/kinopio-client`)           | Clone                  | Typed connections as records, spatial model                                      | low    | **done** ([findings](findings/T-3-kinopio.md))                                                      |
| T-4  | **tldraw** (repo source-available)                    | Clone (study only)     | Schema+migrations, bindings, signals store. License forbids reuse                | medium | **done - out as dep, patterns adopted** ([findings](findings/T-4-tldraw.md))                        |
| T-5  | **PureRef** (closed freeware)                         | Inspect+Observe        | Reference-board UX; `.pur` likely SQLite (Qt6Sql)                                | medium | **partial** - installed, no .pur samples to hex-check ([findings](findings/T-5-pureref.md))         |
| T-6  | **Allume** (Christian's eval list)                    | Inspect+Observe        | What its arrows serialize to                                                     | medium | **blocked - not installed**                                                                         |
| T-7  | **Muse** (spatial app)                                | Inspect                | File-vs-db answer from a funded team                                             | medium | **blocked - macOS/iPad only, not installed**                                                        |
| T-8  | **Heptabase** (Electron note/canvas)                  | Inspect                | Card+whiteboard storage model                                                    | medium | **blocked - not installed**                                                                         |
| T-9  | **Eagle** (installed + eagle-mcp)                     | Inspect                | Library folder format: `<id>.info` item folders                                  | low    | **done** ([findings](findings/T-9-eagle.md))                                                        |
| T-10 | **obsidian-excalidraw-plugin**                        | Clone                  | Drawing-inside-.md storage + agent CLI precedent                                 | low    | **done** ([findings](findings/T-10-obsidian-excalidraw.md))                                         |
| T-11 | **VS Code watcher path** (`@parcel/watcher` upstream) | Clone/read docs        | Event-fidelity edge cases                                                        | low    | defer to chokidar gaps                                                                              |
| T-12 | **Krita `.kra` / Rebelle formats**                    | Inspect (kra is a zip) | Metadata hints for tighter round-trip (Stage 2+)                                 | low    | defer                                                                                               |
| T-13 | **Cosmic Canvas / CanvasMCPClient** (ours)            | read                   | already inventoried - R-6 done                                                   | done   | done                                                                                                |

## Findings log

Each completed target gets `docs/research/findings/T-<n>-<slug>.md`: what was
inspected, behavior documented, what we adopt vs reject, and any format
notes that feed DATA-MODEL. No code in findings docs - behavior notes only.

## Deferred / skipped

- **Figma, Milanote**: server-heavy, nothing meaningful to inspect locally.
- **Capacities, Kosmik**: same class as Heptabase - add to list if Christian's
  eval includes them.
