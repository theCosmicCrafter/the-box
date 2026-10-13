# T-5 - PureRef

|              |                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **Method**   | install inspection + `FyorDev/PureRef-format` parser source (cloned to `reference/PureRef-format/`) |
| **Verified** | 2026-10-13                                                                                          |
| **Status**   | Complete                                                                                            |

## The .pur format - verified, not guessed

**`.pur` is a custom big-endian binary format. It is NOT SQLite.**
`Qt6Sql.dll` ships in the install dir but is Qt runtime for app internals
(settings, recent-files); it does not describe the `.pur` container.

Structure, from `purformat/read.py` (PureRef 1.10/1.11.1) and
`pur.hexpat` (010 Editor template):

```
224-byte header
  canvas view matrix : 4 x float64 BE  @112..144
  zoom               : float64 BE      @144
  canvas offset x,y  : int32 BE        @216..224
PNG blob section
  embedded images, raw PNG data; duplicates stored as 4-byte
  transform-ID references (deduplication)
Item records (typed, big-endian)
  graphics_image_item = 34, graphics_text_item = 32
  each: transform matrix (6 x f64), x, y, id, zLayer,
        crop polygon points, nested text children
folder-location string (UTF-16-BE, length-prefixed)
reference table: transform-id -> image byte-address (20-byte records)
```

PureRef 2.x keeps the 224-byte header with signature `uint32 BE = 8`
(per `obsidian-extended-file-support`, a community preview plugin).

No `.pur` samples exist on this machine - searched Downloads, Documents,
Desktop, and `AppData/Roaming/PureRef`: zero results. Format facts above
come from the working parser source, not from inspecting a local file.

## Model implications (verified from the parser)

- **Single-file embedded assets**: images stored inside `.pur`, not referenced
  paths - opposite of our file-reference model.
- **Dedup by reference**: duplicate placements share image bytes via
  transform-ID indirection - same placement-vs-source separation we use,
  inside a binary blob.
- **Items carry z-layer + crop + nested text** - crop-polygon points are a
  per-item transform concern, stored with the item.

## Adopt vs reject

| adopt                                                                      | reject                    |
| -------------------------------------------------------------------------- | ------------------------- |
| Placement-vs-source indirection (already ours)                             | embedded-blob storage     |
| Per-item crop-point storage model if we add crop                           | single-file opaque format |
| `pur.hexpat`-style hex template when we someday document a binary artifact | -                         |

## Implication

PureRef is a UX reference (zero-chrome reference board) not a format source.
Its value to The Box is the drag-anywhere, always-on-top interaction
standard - documented here: https://www.pureref.com/
