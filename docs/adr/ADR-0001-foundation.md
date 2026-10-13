# ADR-0001 - Foundation Decisions & Open-Decision Register

|             |                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Status**  | Accepted (settled items) · Living register (open items)                                                                     |
| **Date**    | 2026-10-12                                                                                                                  |
| **Context** | Pre-scaffold. Settled decisions are binding; open items list what still needs an ADR before the stage that depends on them. |

## Settled decisions

| #    | Decision                                                                                          | Rationale                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D-1  | **Independent Electron app, not an Obsidian plugin.** Obsidian = reference only.                  | Christian/Rich directive. Owns the whole UX surface; no platform ceiling; formats keep interop anyway. |
| D-2  | **Files are truth; all indexes are rebuildable caches.**                                          | The product's core promise. Anti-silo by construction.                                                 |
| D-3  | **Arrows are notes.** Every edge ↔ one `link-<edgeid>.md`. Two-way sync.                          | The wedge vs. every surveyed tool.                                                                     |
| D-4  | **Ink = `.ink.svg` sidecars; sources immutable.**                                                 | Editable forever, external-app readable, zero risk to originals.                                       |
| D-5  | **Board = `.box.canvas`, JSON Canvas superset.**                                                  | Interop with Obsidian/ecosystem readers; extension fields carry placements.                            |
| D-6  | **Electron 44 + React 19 + TS strict, npm workspaces.**                                           | ResonanceStudio proves the stack on this machine; zero new learning surface.                           |
| D-7  | **Per-dimension placement in one record** (`box-placement.2d/.3d`).                               | Multi-view north star without format churn.                                                            |
| D-8  | **Decision engine = Jev-compatible wire API** via `decisions.ts` → local Von :8770.               | Already running (~29ms); OpenJev/official Jev drop-in swap; zero cloud; AI layer optional.             |
| D-9  | **No real paint engine.** Notation ink only (perfect-freehand); wet media via external tools.     | Christian's explicit de-scope.                                                                         |
| D-10 | **Salvage-first.** Donor code copied into `packages/` w/ provenance; `reference/` never imported. | 14 organs already cloned; invention budget goes to sync + canvas, not plumbing.                        |

## Open decisions (resolve by ADR before the noted stage)

| ID   | Question                                                                                              | Options lean                               | Due           | Status                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------ |
| OQ-1 | `.box.canvas` strict superset vs. plain JSON Canvas                                                   | Compatible superset                        | Stage 0       | **ADR-0002 accepted** (unknown-key tolerance evidenced) - pending group ratify |
| OQ-2 | SQLite vs. Kùzu for derived graph index                                                               | SQLite now; Kùzu when queries need it      | Stage 3       | open                                                                           |
| OQ-3 | iPad delivery path                                                                                    | OpenClaw node display / PWA / Tauri-mobile | Stage 5       | open                                                                           |
| OQ-4 | Link-note scope: workspace-global vs. per-board                                                       | Global; boards reference                   | Stage 0       | **ADR-0003 accepted** - pending group ratify                                   |
| OQ-5 | Built-in git versioning vs. user's own git                                                            | User's own git first                       | Stage 5       | open                                                                           |
| OQ-6 | Media thumbnailing: Electron-native vs. Python worker                                                 | Electron first                             | Stage 2       | open                                                                           |
| OQ-7 | Canvas engine: custom DOM+salvage vs Konva (tldraw disqualified: license-key required for production) | Custom - ADR-0004 drafted                  | Stage 0       | **ADR-0004 proposed** - group decision                                         |
| OQ-8 | Project license (MIT / Apache-2.0 / keep-private)                                                     | Private now, Apache-2.0 on going public    | before public | **ADR-0005 proposed** - group decision                                         |

## How to use this register

- Opening an open item → create `ADR-000N-<slug>.md` (template below), link it
  from the OQ row, mark the row resolved.
- Any settled decision may be revisited - only by a new ADR that supersedes the
  old row. Rows are never edited retroactively.

## ADR template

```markdown
# ADR-XXXX - <title>

| Status | Date | Supersedes |

- **Context:** forces/options
- **Decision:** the call
- **Consequences:** what becomes easier/harder
- **Rejected alternatives:** why not
```
