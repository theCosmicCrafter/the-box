# ADR-0004 - Canvas engine: custom DOM + salvaged camera logic (OQ-7)

| Status | Date | Supersedes |
|---|---|---|
| **Proposed - for group decision** | 2026-10-12 | - |

## Context

The canvas surface is the PoC's biggest line item. Candidates surveyed
(`docs/research/SOTA-SURVEY.md`): tldraw SDK, Konva/react-konva, PixiJS 8,
salvaged CanvasMCPClient code, custom DOM.

## Evidence

- **tldraw SDK 4.0 is out** (verified 2026-10-12): production requires a
  license key - dev-mode free, hobby tier watermarked, commercial paid.
  Key-enforced. A shipping group product cannot carry that.
- CanvasMCPClient's salvageable parts are its **Redux slice logic**, not its
  data model: `canvasSlice` (zoom clamp 0.1–5, `zoomToFit`, `panBy`,
  `screenToWorld`/`worldToScreen`, selectionBox, cursor states) - verified
  read 2026-10-12.
- Our node types (file objects, ink overlays, link-note edges) are bespoke;
  a general canvas framework would be bent around them anyway.

## Decision (proposed)

Custom React DOM renderer: nodes as DOM elements (media-native: `<img>`,
`<video>` come free), edges + ink as Canvas2D/SVG overlays, camera math
ported from `canvasSlice` to Zustand. Konva is the documented fallback if
DOM perf misses the ≥30fps/500-object budget. PixiJS remains the far upgrade
path (WebGL) for Stage 5+.

## Consequences

- Zero added deps for the riskiest component; we own the model end to end.
- DOM nodes give media playback, text editing, and ink overlays for free.
- Port surface is small and verified (~1 slice file + 3 display components).
- Risk: we own pan/zoom/selection edge cases a framework would hand us.

## Rejected alternatives

- **tldraw:** license-key requirement disqualifies (above).
- **Konva first:** adds a dep and a scene-graph abstraction to learn while we
  already own proven camera math; kept as fallback, not default.
- **PixiJS first:** perf we don't need at PoC; WebGL complexity for zero
  current benefit - the upgrade path is recorded.
