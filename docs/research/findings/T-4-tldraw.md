# T-4 - tldraw (deep look)

|              |                                                               |
| ------------ | ------------------------------------------------------------- |
| **Method**   | clone `tldraw/tldraw` + license read                          |
| **Verified** | 2026-10-12                                                    |
| **Status**   | Complete - **out as a dependency; high-value study material** |

## What tldraw actually is

tldraw is both a product (tldraw.com whiteboard) and an embeddable SDK -
arguably the most polished React infinite-canvas engine in existence. The
repo is a monorepo; the SDK is what you'd integrate:

```
packages/
  editor      the canvas engine (interaction, camera, shapes, tools)
  store       signals-based reactive store (@tldraw/state)
  tlschema    record schema: shapes, bindings, migrations, validators
  state       the signals library
  state-react React bindings for signals
  assets      shape/tool assets
  ui          the default UI chrome
```

## The license (why it's out)

`tldraw/LICENSE.md` (custom, read verbatim 2026-10-12):

- **Development Environment** use is free.
- **Production Environment** ("any production deployment... where the
  software is used to provide functionality to end users") requires a
  **License Key** - programmatically enforced. Paid commercial, or the
  hobby tier renders a watermark.
- The key check lives in the SDK itself - not honor-system.

For a group project that may ship or go public: hard disqualifier, recorded
in SOTA-SURVEY and ADR-0004.

## Architecture worth stealing (patterns, not code)

1. **Schema + migrations** (`tlschema/src/migrations`, `createTLSchema`):
   records declare a version and a migration chain; opening old data runs
   the chain. Our `box-format` needs exactly this when `box.canvas/2` ever
   ships - adopt the _pattern_: `{version, migrate(old)→new}` per format.
2. **Bindings as first-class records** (`TLBinding`, `TLArrowBinding`):
   an arrow's attachment is a separate typed record `{fromId, toId, props
{anchor, terminal}}`, not fields buried inside shapes. Validates our
   design instinct: the connection is an entity, not a decoration - we go
   further and make it a file.
3. **Signals store** (`@tldraw/state`): granular reactivity - only the
   changed node's components re-render. Zustand gives us a lighter version
   of this; if the canvas ever chokes at scale, their "computed value
   derivation" pattern is the reference.
4. **Shape util contract**: each shape type implements a util class with
   lifecycle hooks (onResize/onDrag/onEdit) - our file-node renderers will
   want the same uniform contract (`ObjectRenderer` interface).
5. **Presence derivation** (`createPresenceStateDerivation`): multiplayer
   cursor/selection state - parked (single-user scope) but noted.

## What we keep from the evaluation

- The benchmark: tldraw IS the UX bar for canvas polish (arrow snapping,
  label editing, shape handles). Christian should dogfood tldraw.com as a
  feel reference.
- Migration-chain pattern for `box-format` versioning (DATA-MODEL §10).
- "Binding record" naming in our index schema (edge record ↔ note file).

## Rejects

- Their whole data model (records in their own JSON store) - we're files-first.
- Their license, obviously.
