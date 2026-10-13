# T-2 - Excalidraw

|              |                                     |
| ------------ | ----------------------------------- |
| **Method**   | clone `excalidraw/excalidraw` (MIT) |
| **Verified** | 2026-10-12                          |
| **Status**   | Complete (format + binding model)   |

## Findings

1. **File format** (`data/types.ts`, `data/json.ts`):
   `{type:'excalidraw', version, source, elements[], appState{}, files:BinaryFiles}`
   - flat element array + app-level state + embedded binary blobs (images
     stored base64 inside the file by id). Self-contained portable document -
     the opposite pole from our "objects are real files" (their images live
     INSIDE the json; ours stay files).
2. **Bidirectional binding model** (`element/src/binding.ts`,
   `arrowEndpointText.ts`):
   - Shapes carry `boundElements[]` - refs to arrows/text bound to them.
   - Arrows/text carry `containerId`/`boundElement` back-refs.
   - **Arrow labels are text elements bound to the arrow** - the label is
     a full element, not a string property.
3. **Fractional indexing** (dedicated package) for z-order without
   renumbering - noted for multi-board ordering if needed.

## Adopt vs reject

| adopt                                                                                                                   | reject                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Bound-element pattern: edges reference endpoints AND endpoints can enumerate their edges (index gives us this two ways) | embedded binary blobs (ours stay files)     |
| Label-as-element thinking - our note is even more first-class                                                           | single flat scene file (we're folder-based) |
| `fractional-indexing` if board z-order ever needs stable ordering across tools                                          | -                                           |

## Implication

Excalidraw's model confirms the "connection is a first-class entity"
pattern again (third independent design to reach it, after tldraw bindings
and our own). Its binding file is internal-only though - nobody else
writes meaning about the relationship. That's our wedge, still unique.
