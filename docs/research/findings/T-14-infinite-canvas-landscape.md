# T-14: Infinite Canvas landscape survey

Date verified: 2026-10-13. Method: web sources only (product pages, whitepaper,
AAAI paper, GitHub). No binaries inspected; claims below are vendor-published
unless marked.

## The category itself

`infinitecanvas.tools` (open source, github.com/museapphq/infinitecanvas.tools)
is the Muse team's category microsite. It documents the lineage: Sutherland's
Sketchpad (1963) -> Scott McCloud's "Infinite Canvas" comics manifesto (~2000s,
the monitor as a window onto an endless plane) -> Miro/Figma/Origami/MindNode.
Useful as the category map and donor-app index.

## Apps surveyed and what each proves

| App                                           | Shape                                 | Novel / worth-stealing                                                                                                                                                                              | Evidence                                      |
| --------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Infinite Canvas (Christian Tietze, iOS/macOS) | Vector sketch, SVG under the hood     | Undo history persisted inside the file: reopen a doc, undo last year's stroke. Constant-screen-width strokes let detail nest fractally as you zoom                                                  | App Store listing                             |
| Endless Paper (iPad)                          | One forever-document, files abolished | Spatial arrangement IS the document model; zero file management. We reject its "no files" axiom but prove the same claim our way: spatial first, files underneath                                   | endlesspaper.app                              |
| InfinitiCanvas (Windows)                      | Pen-first teaching whiteboard         | Frame-accurate stroke smoothing is the differentiator ("handwriting looks like itself"). Auto-save per stroke, tabbed pages on one infinite surface                                                 | infiniticanvas.com                            |
| Koll.ai Infinite Canvas                       | Node-graph AI video pipeline          | Edges carry typed payloads: text feeds prompt text, images feed visual refs (`@`-mentions pull upstream node output). Nearest living relative to our arrows-are-notes, but with execution semantics | canvas.koll.ai                                |
| Atlas (macOS)                                 | Infinite canvas + terminal + kanban   | AI CLI (Claude Code) runs as a first-class canvas node; Metal-accelerated render                                                                                                                    | atlascanvas.app                               |
| AI Infinity Canvas (iOS)                      | SDXL outpainting                      | Mobile generative-fill; border extension by prompt                                                                                                                                                  | AppRecs listing                               |
| Gabriel Ferrate's Infinite Canvas             | Collaborative AI mural                | Grid-cell mural with edge-inpainting continuity; "biomes" = per-region style constraints; honest windowed-inpainting infra notes on a small budget                                                  | infinite-canvas.gabrielferrate.com/whitepaper |
| Infinite-Canvas (AAAI paper)                  | Video outpainting method              | Distribute outpainting across spatial windows + merge, beats GPU memory limits at 9x scale; code at github.com/mayuelala/FollowYourCanvas                                                           | AAAI proceedings 2025                         |
| PerchanceAI Canvas                            | Browser multi-modal gen workspace     | Unified image+video+audio spatial board over cloud GPU                                                                                                                                              | perchanceai.art/canvas                        |

## What The Box should take

Adopted into ROADMAP.md:

- **Undo-as-file-data** (Tietze): persist the op log in or beside `.box.canvas`;
  undo survives restart. Fits files-are-truth better than any donor.
- **Typed edge payloads** (Koll.ai): our link notes already carry `type:`;
  Stage 4 can let a `type` mean executable semantics (prompt ref, dataflow)
  without breaking arrows-are-notes.
- **Regions with parameters** (Ferrate biomes): group/frame nodes carrying
  per-region config (generation params, view filter). Same mechanism as the
  Box holding area, generalized.
- **AI/CLI as canvas objects** (Atlas): Stage 4 nodes can host Von/Ollama/
  ComfyUI sessions; local-only invariant already holds.
- **Windowed processing** (AAAI): chunked ops for very large boards; also the
  technique the 3D north star needs for big-canvas outpainting.
- **Stroke smoothing is feel** (InfinitiCanvas/perfect-freehand): already our
  ink path; the survey confirms smoothing quality, not feature count, is what
  artists notice.
- **OS-native icon fallback** (Eagle native.js analog): `app.getFileIcon` IPC
  so typed tiles show real shell icons for unparseable binaries
  (blend/c4d/dwg).
- **Deferred parser queue**: ag-psd (PSD), camera-RAW embedded-JPEG
  extraction, HEIC/JXL decoders. Each gated on a real file in Christian's
  library needing it.

## Rejected / noted

- "Files abolished" model (Endless Paper): we keep files as truth; the
  survey strengthens rather than refutes the wedge.
- Proprietary format copies (fig/sketch parsers): pattern study only.
