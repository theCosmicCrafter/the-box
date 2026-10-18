# ADR-0008 - Regions: parameterized group nodes

- **Status:** Accepted
- **Date:** 2026-10-17
- **Relates:** DATA-MODEL §2.5, FR-202 (The Box), T-14 (Ferrate biome pattern), ADR-0007

## Context

JSON Canvas group nodes already exist and pass through unknown keys
verbatim. The Stage-2 roadmap calls for "regions with parameters":
group/frame nodes carrying per-region config, generalizing the same
mechanism as the Box holding area (a region is a zone that _means_
something). Ferrate's mural whitepaper calls these "biomes": per-region
constraint/config bags that today hold view/behavior params and in
Stage 4 can hold generation params without a format change.

## Decision

A region is a `type: "group"` node carrying a `box-region` key:

```json
"box-region": {
  "v": 1,
  "locked": false,
  "params": {}
}
```

| field    | type   | required | semantics                                                                                            |
| -------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `v`      | int    | yes      | schema version, currently 1                                                                          |
| `locked` | bool   | no       | children inside the region ignore drags/marquee-moves (region itself still moves, carrying them)     |
| `params` | object | no       | opaque string->JSON bag, preserved verbatim; reserved for view filters and Stage-4 generation params |

Region name stays in spec `label`; region tint stays in spec `color`
(preset or `#RRGGBB`). No new node type: a region is still a spec group
to every other reader - unknown `box-region` is ignored forward-compatibly.

Writer rules mirror the codebase norm: preserve unknown keys inside
`box-region` on rewrite (NFR-07 forward tolerance); `params` contents are
never interpreted by board code paths.

## Why not new node type / separate file

- A `type: "region"` would break spec readers; a group with an extra key
  degrades to a plain group everywhere else.
- A sidecar file would break "one board file per canvas" and add a sync
  surface for zero benefit - the config is per-node, not per-workspace.
- `.box/settings.json` is workspace-level prefs; region config is board
  content and must live in the board file so it round-trips with the data.

## Behaviors (v1)

- **Locked:** nodes whose center is inside a locked region's bounds are
  not moved by drags, marquee multi-drags, or arrow nudges. The region
  node itself remains draggable and still carries its members.
- **Name/tint:** `label`/`color` already render on groups; the region
  badge marks the node in BoxPanel-independent UI (corner tag).
- **Region settings:** context menu on a group node offers
  "Region settings" -> name, color preset, locked toggle; writing them
  goes through `updateNode` so undo covers it.

## Consequences

- DATA-MODEL §2.5 gains the `box-region` table; board parser validates
  `v === 1` shape loosely (missing/extra keys tolerated, wrong-shaped
  `box-region` ignored rather than fatal - malformed-region becomes a
  problem item only if it breaks JSON).
- Stage-4 generation params land in `params` with no format change.
- Cost: one extra node key; no new files, no new sync semantics.
