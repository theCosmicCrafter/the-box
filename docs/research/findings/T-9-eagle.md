# T-9 - Eagle (asset manager, installed)

| | |
|---|---|
| **Method** | eagle-mcp-server code read (local project knows the layout) |
| **Verified** | 2026-10-12 |
| **Status** | Complete |

## Findings

1. **Library = folder of item folders** (`library/images/<item_id>.info/`):
   each item is a folder containing the asset file at original name +
   `metadata.json` + a thumbnail. The library is plain folders - readable
   without Eagle running (file-first precedent at scale).
2. **Metadata lives beside the asset** in `metadata.json` - same
   sidecar-adjacent pattern family as our `box-placement` / `.ink.svg`.
3. Eagle exposes a local HTTP API (what eagle-mcp-server wraps) for
   item/library operations - precedent that local apps CAN be
   externally-driven cleanly.

## Adopt vs reject

| adopt | reject |
|---|---|
| Per-item container holding asset + metadata + thumb (strong precedent for object = folder-of-files) | `.info` dir per file adds clutter vs our flat+sidecars (ours is cleaner for a creative vault) |
| Local-API-for-agents precedent (box-mcp does this for our boards) | - |

## Implication

Eagle proves the "folder as database" model survives contact with real
asset libraries at scale - tens of thousands of items. Our placement
records + sidecars are the same idea with less nesting.
