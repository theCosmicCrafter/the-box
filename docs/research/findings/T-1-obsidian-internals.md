# T-1 - Obsidian internals (obsidian.asar)

|              |                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------- |
| **Method**   | `npx @electron/asar extract` on `obsidian.asar` → `app.js` (3.9MB bundled JS) read directly |
| **Verified** | 2026-10-12                                                                                  |
| **Status**   | Complete (canvas scope; deeper file-watch semantics still open if needed)                   |

## Findings that feed the contract

1. **Unknown-key preservation is a designed feature, not a side effect.**
   Every node and edge object carries `unknownData = {}`. On `getData()`
   (serialize): `g(g({}, unknownData), {id, x, y, width, height})` - unknown
   keys spread FIRST, then Obsidian's own keys override. Consequence: our
   `box-*` keys round-trip through Obsidian untouched (verified at parser
   level, completing the advanced-canvas plugin evidence). A colliding key
   name would be overridden - another reason `box-` namespacing is correct.
2. **ID generation** is `Ub(16)` - 16-char random id on node/edge create,
   matching the donor `uuid4().hex[:16]` convention our `newEdgeId` follows.
3. **Dangling refs normalize to `""`** on one path (`p.fromNode=r[p.fromNode]||""`),
   elsewhere preserved - mixed behavior, we keep "preserve + flag broken" (I-7).
4. **Canvas is a built-in plugin** (`db.plugins.canvas`) with actions:
   `actionNewCanvas`, `actionSwapFile` (swap a node's underlying file - worth
   stealing as a feature), `labelNoMedia`.
5. **Saves are debounced** via `Gl(fn, ms)` (1s config, 200ms folds) - same
   debounce discipline as our watcher design (DATA-MODEL §5.2).
6. **Renames route through the internal file index**: `fsPromises.rename`
   then `reconcileInternalFile` then `trigger("renamed")` - matches our
   classify-by-existence + update-refs approach (R-G).
7. **Rendering is PixiJS** (`lib/pixi.min.js` bundled) - Obsidian's canvas
   uses WebGL under the hood at scale. Supports the "custom DOM first,
   PixiJS later" staged path in ADR-0004.
8. Nodes carry `aspectRatio` and `zIndex` runtime fields - zIndex is
   runtime-only (array order remains file truth, per spec).

## What we adopt vs reject

| adopt                                                                    | reject                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `unknownData` preservation pattern (we get it free via index signatures) | label-only decorative edges (ours are always note-backed) |
| Debounced save discipline (already in spec)                              | normalize-dangling-to-"" (we preserve + flag)             |
| `actionSwapFile` node-file swap as a UX feature idea                     | internal index as anything but cache                      |

## Implication for The Box

OQ-1 closed with direct parser evidence (ADR-0002 stands). The interop
promise is real: a user can open our `.box.canvas` in Obsidian, move things,
save - our `box-*` data survives.
