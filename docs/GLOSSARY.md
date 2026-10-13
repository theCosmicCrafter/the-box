# GLOSSARY.md - Canonical Terms

|             |                                                                       |
| ----------- | --------------------------------------------------------------------- |
| **Purpose** | One name per thing. Every doc, variable, and conversation uses these. |

| term                  | definition                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **workspace**         | The root folder the user opens. Its whole durable state is files.                                                   |
| **board**             | One `.box.canvas` file - a canvas view of objects. A workspace may hold several.                                    |
| **object**            | A workspace file as a first-class thing (image, video, audio, md, ink.svg). Rendered as a **node** when placed.     |
| **node**              | A placed object's entry on a board (`type:"file"` in the canvas). Text/link/group nodes also exist per JSON Canvas. |
| **placement record**  | `box-placement` on a node: `{2d:{x,y,w,h,z}, 3d:null}` - the only difference between an object and a Box item.      |
| **The Box**           | The holding area: files with no placement record on any board. Not a folder - a state.                              |
| **edge** / **arrow**  | The drawn connection between two nodes. Edge in data, arrow in UI. Always note-backed.                              |
| **link note**         | `link-<edgeid>.md` - the Markdown file that IS the edge's meaning. Workspace-global (ADR-0003).                     |
| **ink sidecar**       | `<file>.ink.svg` - editable vector notation layered over a source object. Source never modified.                    |
| **orphan note**       | A `link-*.md` with no board edge referencing it - adopted on reconcile (rule R-C).                                  |
| **broken edge**       | An edge or note whose endpoint file/node is gone - rendered broken, never destroyed (I-7).                          |
| **tombstone**         | `.box/tombstones.json` entry marking an intentionally deleted edge id - prevents delete-resurrection (§4.3).        |
| **reconcile**         | The deterministic file-scan→correction pass on open and after watcher triggers (DATA-MODEL §6).                     |
| **problem item**      | A surfaced anomaly (malformed file, bad frontmatter, broken edge). A list, never silent.                            |
| **decision point**    | A typed question sent to Von (`noul`/`choice`/`score`) - Stage 4 features only.                                     |
| **salvage / donor**   | Code adapted from `reference/` or CascadeProjects into `packages/` with provenance recorded.                        |
| **WritePlan**         | The step list `box-core` emits for the platform to execute - all file mutations flow through it.                    |
| **problem of record** | See "problem item." Do not coin new synonyms.                                                                       |

## Do not say

- ~~connection~~ → edge/arrow (or link note, when meaning the file)
- ~~annotation layer~~ → ink sidecar / ink layer
- ~~vault~~ → workspace (Obsidian's word; ours is workspace)
- ~~inbox/unplaced~~ → The Box / Box item
