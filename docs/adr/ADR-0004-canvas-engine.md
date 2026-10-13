# ADR-0004 - Canvas engine: custom DOM + salvaged camera logic (OQ-7)

| Status       | Date       | Supersedes |
| ------------ | ---------- | ---------- |
| **Accepted** | 2026-10-13 | -          |

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
- **tldraw's own renderer is DOM/SVG** - `DefaultCanvas.tsx` renders `<svg>`,
  every shape wraps `SVGContainer.tsx`, zero WebGL in the renderer core
  (verified in the cloned repo 2026-10-13). Custom DOM is the same
  technology class as the benchmark, not the budget option.
- **tldraw license includes telemetry** (verified 2026-10-13): the key
  mechanism "may collect and transmit usage data to tldraw for license
  compliance purposes" and detects deployment environments - a hard
  violation of the zero-cloud rule independent of price.
- **No WebGL whiteboard is pure WebGL**: Obsidian's canvas is PixiJS
  underneath with DOM text-node overlays; Figma is the same pattern. A
  board whose nodes are documents needs DOM nodes regardless, so WebGL is
  strictly an additive layer, never a replacement.
- tldraw pricing (verified 2026-10-13): no published figure - value-based,
  sales-gated; hobby license watermarked, startup discount, 100-day trial.
- **Ratification (2026-10-13):** Rich approved this decision with the
  directive to mimic tldraw's interaction model and patterns as closely as
  possible without copying code - study-only clean-room reuse.

## Decision

Custom React DOM renderer: nodes as DOM elements (media-native: `<img>`,
`<video>` come free), edges + ink as Canvas2D/SVG overlays, camera math
ported from `canvasSlice` to Zustand. Konva is the documented fallback if
DOM perf misses the ≥30fps/500-object budget. PixiJS remains the far upgrade
path (WebGL) for Stage 5+.

**Renderer seam (required):** camera math and hit-testing live behind a
`Viewport`/`SceneRenderer` boundary in `box-ui`; node kinds render behind a
per-kind renderer interface. If WebGL escalation ever happens it replaces
the edge/ink/background layers - not the model, not reconcile, not tests.
**Interaction model: mimic tldraw** - wheel scroll pans, ctrl/cmd+wheel
zooms to cursor, space or middle-drag pans, click selects, drag moves
nodes. Patterns studied; no code copied.

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
