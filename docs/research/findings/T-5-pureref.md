# T-5 - PureRef

| | |
|---|---|
| **Method** | install inspection (C:\Program Files\PureRef) + community format docs |
| **Verified** | 2026-10-12 |
| **Status** | Partial - installed; no .pur samples on disk to hex-inspect |

## Findings

1. **Qt6 app**: ships `Qt6Sql.dll` - the `.pur` format is almost certainly
   SQLite-based (consistent with public RE knowledge of the format).
   Local samples were cleaned up; no .pur on disk to verify the magic bytes
   directly - noted as "likely SQLite, unverified on machine."
2. **The UX it owns**: always-on-top frameless reference board; drag images
   in from anywhere, arrange freely, minimal chrome. The *reference-board*
   interaction standard Christian's creative circle knows.
3. PureRef's model is image-first: the file is the board's serialized
   scene, not a folder of visible assets - images are embedded, not
   referenced.

## Adopt vs reject

| adopt | reject |
|---|---|
| Zero-chrome canvas feel (the board IS the window) | opaque embedded-file storage |
| Drag-from-anywhere input | single-document model (we're a workspace) |

## Implication

PureRef is the UX bar for "reference board that stays out of the way" -
relevant when the Box panel / drag-in flow gets designed (Stage 2). Not a
format source.
