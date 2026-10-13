# RE-TARGETS.md - Reverse-Engineering and Study Targets

| | |
|---|---|
| **Purpose** | The list of tools to take apart for behavioral study before we build. Say yes/no per row and we proceed in that order. |
| **Rules** | Study behavior, document semantics, write our own code. Never copy code, strings, or assets. Findings go to `docs/research/findings/` as behavior notes, each stamped `verified <date>`. |

## Methodology

Three lanes, cheapest first:

1. **Clone/read** - source is available; just study it. Zero RE needed.
2. **Inspect** - closed-source but locally inspectable: Electron asar extraction, file-format hex/json reads, SQLite schema dumps, runtime observation (create files in the app, watch what it writes). REA (`rea-agents`) does asar/JS/SQLite analysis; manual `npx @electron/asar extract` + reading bundled JS works too.
3. **Observe** - can't inspect internals; black-box its file outputs only.

## Target list (yes/no per row)

| # | target | lane | what we learn | effort | status |
|---|--------|------|---------------|--------|--------|
| T-1 | **Obsidian** (`obsidian.asar`, installed) | Inspect | Canvas parser internals: unknown-key tolerance (already evidenced), rename-tracking semantics, `.canvas` write ordering, frontmatter edge cases, wikilink resolution rules | medium | **partially done** (advanced-canvas evidence); full parser read pending |
| T-2 | **Excalidraw** (`excalidraw/excalidraw`) | Clone | Ink/drawing UX patterns, `.excalidraw` JSON format, library-sidecar pattern (relevant to `.ink.svg`) | low | pending yes/no |
| T-3 | **Kinopio** (`kinopio-club/kinopio-client`) | Clone | Spatial canvas UX done small: cards, connections-as-objects, spaces | low | pending yes/no |
| T-4 | **tldraw** (repo source-available) | Clone (study only) | Canvas architecture patterns - shape model, bindings, perf strategy. **Study only: license forbids reuse; we're documenting patterns, not code** | medium | pending yes/no |
| T-5 | **PureRef** (closed freeware) | Inspect+Observe | The reference-board UX gold standard: `.pur` file format, image placement model, always-on-top semantics | medium | pending yes/no |
| T-6 | **Allume** (Christian's eval list) | Inspect+Observe | What its arrows actually serialize to; storage forensics proving the gap Christian found | medium | pending yes/no (need install) |
| T-7 | **Muse** (Electron spatial app) | Inspect | Board model, object representation, how a funded team solved file-vs-db | medium | pending yes/no (need install) |
| T-8 | **Heptabase** (Electron note/canvas app) | Inspect | Card+whiteboard hybrid model, sync format | medium | pending yes/no (need install) |
| T-9 | **Eagle** (installed + eagle-mcp) | Inspect | Library folder format on disk (thumbnails, metadata db, folder mirroring) | low | pending yes/no |
| T-10 | **obsidian-excalidraw-plugin** | Clone | How a canvas-in-Obsidian plugin stores drawing data inside a file-ecosystem vault | low | pending yes/no |
| T-11 | **VS Code watcher path** (`@parcel/watcher` upstream) | Clone/read docs | Event-fidelity edge cases our debounce design must survive | low | defer to chokidar gaps |
| T-12 | **Krita `.kra` / Rebelle `.reb`?** | Inspect (kra is a zip) | Whether external-app files can carry our metadata hints for tighter round-trip (Stage 2+) | low | defer |
| T-13 | **Cosmic Canvas / CanvasMCPClient** (ours) | read | already inventoried - R-6 done | done | done |

## Findings log

Each completed target gets `docs/research/findings/T-<n>-<slug>.md`: what was
inspected, behavior documented, what we adopt vs reject, and any format
notes that feed DATA-MODEL. No code in findings docs - behavior notes only.

## Deferred / skipped

- **Figma, Milanote**: server-heavy, nothing meaningful to inspect locally.
- **Capacities, Kosmik**: same class as Heptabase - add to list if Christian's
  eval includes them.
