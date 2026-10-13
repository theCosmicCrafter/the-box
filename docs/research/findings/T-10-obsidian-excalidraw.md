# T-10 - obsidian-excalidraw-plugin

| | |
|---|---|
| **Method** | clone `zsviczian/obsidian-excalidraw-plugin` |
| **Verified** | 2026-10-12 |
| **Status** | Complete (storage model) |

## Findings

1. **Drawings live inside .md files**: an excalidraw drawing is a markdown
   file with the element JSON embedded in a dedicated section (compressed
   via lz-string for the data block) alongside a normal markdown area and
   image embeds. The drawing IS the note - the closest existing precedent
   to "canvas content inside a real user file."
2. **Hybrid render**: it can export/preview embedded PNG/SVG so the file
   still shows content in other tools - the "readable without the app"
   discipline, done via export not via open format.
3. **CLI/protocol layer** (`src/core/cli/`): the plugin exposes an
   agent-callable command surface (apply/create/export/schema commands) -
   direct precedent for `box-mcp` design: canvas ops as a typed protocol
   for agents inside a file-ecosystem.

## Adopt vs reject

| adopt | reject |
|---|---|
| Drawing-inside-note precedent validates our link-note + ink-sidecar philosophy | compressed-opaque data block (ours stays readable text: SVG + markdown + JSON) |
| Agent-facing canvas protocol design (CLI commands → our MCP tools) | everything-in-one-file (we keep separate readable files) |

## Implication

ZoS's plugin proves the demand: millions of users keep drawings as
vault files. Our difference: the drawing/arrow semantics stay human-readable
and every artifact is independently meaningful.
