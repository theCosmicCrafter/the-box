# T-3 - Kinopio

|              |                                     |
| ------------ | ----------------------------------- |
| **Method**   | clone `kinopio-club/kinopio-client` |
| **Verified** | 2026-10-12                          |
| **Status**   | Complete (data model)               |

## Findings

1. **Connections are first-class records** (`useConnectionStore`):
   `{id, startItemId, endItemId, connectionTypeId, controlPoint}` - typed
   relationships where `connectionType` = a named, colored relationship
   kind (user-created types: "depends on", "related to" etc.).
2. **Items are cards/boxes** with x/y in space coordinates; cards carry
   name + frames; boxes are visual containers.
3. **API-queue architecture**: every mutation is queued
   (`createConnection`, `updateConnection` ops by name) for sync - it's a
   server-synced web app, not local-first.
4. Connection paths are computed (`getConnectionPathBetweenItems`) from
   item rects + control points - bezier routing similar to our edge layer.

## Adopt vs reject

| adopt                                                                                                                                                           | reject                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Named connection types with color** - the "meaning" lives on the type, maps directly to our link-note `type` field (supports/contradicts/inspired-by/part-of) | server-first sync model |
| Control-point bezier edge routing reference                                                                                                                     | cards-not-files model   |

## Implication

Kinopio is the closest existing "typed connections" UX - their type is a
name+color label; ours is a whole document. Worth dogfooding for the feel
of typing an edge.
