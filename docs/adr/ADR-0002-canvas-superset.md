# ADR-0002 - `.box.canvas` is a JSON Canvas superset (OQ-1)

| Status | Date | Supersedes |
|---|---|---|
| **Accepted - pending group ratify** | 2026-10-12 | - |

## Context

Two options for the board format: plain JSON Canvas 1.0 (max interop, no
extension room) vs a spec-compatible superset carrying `box-*` extension
fields (placement records, ink refs, link refs). The JSON Canvas spec does
not define unknown-key handling.

## Evidence

Verified 2026-10-12 on this machine: Obsidian tolerates **and preserves**
unknown keys in `.canvas` files - `advanced-canvas`'s installed `main.js`
writes `floating`, `fromFloating`, `toFloating`, `edgeStyle`, `customColor`,
`canvasData`, `metadata` into canvas JSON and the values persist across
saves (the plugin ecosystem depends on it). Superset fields therefore
survive round-trips through Obsidian, not just parses.

## Decision

`.box.canvas` = JSON Canvas 1.0 + `box-*` extension fields (DATA-MODEL §2).
Spec-standard `x/y/width/height` always emitted alongside `box-placement`
so third-party readers see a valid board.

## Consequences

- Interop preserved: Obsidian and spec readers open our boards.
- Our semantics ride inside the same file - no parallel format.
- Dogfood check remains: open a real `.box.canvas` in Obsidian at Stage 1
  and record the result (manual verification list).

## Rejected alternatives

- **Plain JSON Canvas + separate `*.box.json` sidecar:** survives even hostile
  parsers but splits board truth across two files - the exact complexity the
  superset avoids. Retained as documented fallback if dogfood check fails.
