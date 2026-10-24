# ADR-0013: Workstation Completeness - Export, Shortcuts, Edge Styling, and Board Tabs

- **Status:** Decided
- **Date:** 2026-10-23
- **Deciders:** Antigravity, USER
- **Pillars:** Files are truth, Arrows are notes, Zero cloud, Deletion is recoverable.

---

## 1. Context

The Box has achieved rock-solid kernel stability (Invariants I-1 through I-9 pass, 220 unit tests, 29 adversarial tests). Following the addition of Canvas Layout Tools (Track 1), Local Semantic Indexing (Track 3), and Search & Filter (Track 4), four critical capabilities are needed to make The Box a self-contained, daily-driver creative tech workstation:

1. **Canvas Snapshot & High-Res Export (PNG / SVG):** Users need to capture and share boards, groups, or selections without third-party screenshot utilities.
2. **Keyboard Shortcut Cheatsheet & Discoverability (`?` / `F1`):** The app contains over 20 professional keybindings (Obsidian/Figma conventions) that must be visible in-app.
3. **Edge Styling (Color, Line Style, Bidirectional Arrows):** JSON Canvas specification supports edge colors and endpoint directions; visual graph diagrams need solid/dashed lines, custom colors, and bidirectional semantic links.
4. **Multi-Board Tab Bar & Recent Workspaces (FR-203 UX):** Workspaces contain multiple `.canvas` files (e.g. `main.box.canvas`, `moodboard.canvas`). Switching boards must be instant via a clean tab bar, and recent workspaces should be accessible from the ribbon and welcome screen.

---

## 2. Decision

### 2.1 Canvas Snapshot & Export
- Implemented as a zero-dependency client-side utility in `@box/ui` (`exportCanvas.ts`).
- Generates a standalone, standards-compliant SVG document covering the bounding box of placed nodes (or active selection), including backgrounds, node borders, text content, kind badges, and curved edge paths with arrow markers.
- PNG export renders the generated SVG to an offscreen `<canvas>` at selectable DPI scales (1x, 2x for Retina/Print) and converts via `canvas.toBlob()`.
- Download is triggered directly via the browser DOM (`a.download`) or saved into workspace assets.

### 2.2 Keyboard Shortcut Cheatsheet (`HelpModal`)
- Modal overlay triggered by Ribbon `?` button, `?` key (when not in an input/textarea), or `F1`.
- Categorized into Canvas & View, Selection & Placement, Search & Tools, Inking, and File Management.
- Accessible via keyboard (Escape closes) with backdrop dismissal.

### 2.3 Edge Styling Contract
- Spec-native properties on `CanvasEdge`:
  - `color`: JSON Canvas preset (`"1"` through `"6"`) or hex `"#RRGGBB"`.
  - `fromEnd`: `"none" | "arrow"`.
  - `toEnd`: `"none" | "arrow"`.
  - `lineStyle`: `"solid" | "dashed" | "dotted"` (forward-tolerant JSON Canvas extension).
- In `EdgeLayer.tsx`: SVG markers use `context-stroke` / `currentColor` to reflect edge colors. `strokeDasharray` applies to dashed/dotted lines.
- In `NotePanel.tsx`: Interactive selector pills for Direction (`->`, `<->`, `--`), Style (`Solid`, `Dashed`, `Dotted`), and Color swatches.

### 2.4 Multi-Board Tab Bar & Recent Workspaces
- `TabBar` component in `@box/ui` rendered directly above the board viewport.
- Lists all `.canvas` files detected by the workspace watcher, highlighting the active board.
- Clicking a tab switches `boardPath` instantly without reloading the workspace.
- `recentWorkspaces` list persisted in `.box/settings.json` and `localStorage`, providing quick-switch options in the Ribbon and Welcome view.

---

## 3. Invariants & Zero-Cloud Compliance

- **Invariant I-9:** Exporting, styling edges, and switching tabs never move existing node coordinates automatically.
- **Zero Cloud:** All rendering, rasterization, and settings persist locally without network egress.
