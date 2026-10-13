# SOTA Survey - Tooling Decisions Before Any Install

| | |
|---|---|
| **Status** | Completed survey - verdicts feed DEVOPS §Toolchain and ARCHITECTURE §Stack |
| **Date** | 2026-10-12 |
| **Rule** | No dependency is installed and no tool is run until its slot is surveyed here. Verdicts may be revised only by ADR. |

Method: for each slot, candidates are compared on fit-to-pillar (files-are-truth,
zero-cloud, zero-native-deps preference), maturity, license, and maintenance
signal. `compat-flag` means the license constrains reuse; flag rows get
"patterns only, no code copied" unless the group overrides by ADR.

## Decision matrix

| Slot | Candidates | Verdict | Reason | License / flag |
|---|---|---|---|---|
| **Canvas engine** | tldraw SDK, Konva (+react-konva), PixiJS 8, salvaged CanvasMCPClient slices, custom DOM+Canvas2D | **Custom DOM renderer + salvaged camera/selection logic** (OQ-7 → ADR-0004) | tldraw SDK 4.0 requires a license key for any production use (dev-mode free, hobby tier watermarked, commercial paid; key-enforced) - hard flag for a group project that may ship. Konva is the credible fallback if DOM perf disappoints. CanvasMCPClient gives proven pan/zoom/selection math, not a data model we want anyway. | tldraw: custom license-key scheme - **flagged, out**. Konva: MIT. PixiJS: MIT. |
| **File watcher** | chokidar 5, @parcel/watcher, watchman | **chokidar 5.0.0** | Pure JS - keeps zero-native-deps story with node:sqlite. @parcel/watcher (VS Code's watcher) is faster and native-prebuilt; registered as the upgrade path if R-2/event-fidelity testing shows gaps. watchman: Windows support is second-class. | chokidar: MIT. @parcel/watcher: MIT. |
| **Embedded DB** | node:sqlite, better-sqlite3 | **node:sqlite** | Electron 44.0.0 embeds Node 24.18.1 (verified 2026-10-12, releases.electronjs.org); node:sqlite is flag-free since Node 22.13 and release-candidate since 24.15 - synchronous API, zero native modules, zero electron-rebuild. Risk: RC status, verify presence in Electron main at scaffold (probe R-3). Fallback: better-sqlite3. | node: built-in. better-sqlite3: MIT. |
| **Markdown editor** | CodeMirror 6, Milkdown/TipTap, Monaco | **CodeMirror 6** | Small embeddable editor for link notes; same engine Obsidian uses (familiar behavior for users). TipTap/Milkdown are full rich-text frameworks - heavier than a frontmatter-aware md editor needs. Monaco is IDE-scale. | CM6: MIT. |
| **State** | Redux Toolkit, Zustand 5, tldraw signals | **Zustand 5** | ResonanceStudio-proven on this stack; minimal; fits custom canvas (donor slices port to it cleanly). RTK only if we salvaged Redux wholesale - we are not. | MIT both. |
| **Frontmatter/YAML** | gray-matter, js-yaml, yaml | **gray-matter** | Purpose-built for `---` frontmatter in .md files; tiny; battle-tested. | MIT. |
| **ID generation** | crypto.randomUUID, ulid, nanoid | **crypto.randomUUID() built-in** | Zero deps; 16-hex slice matches the verified Obsidian/donor ID convention (`uuid4().hex[:16]`). | built-in. |
| **Vector index (Stage 4)** | LanceDB, sqlite-vec, Qdrant local | **sqlite-vec** (if node:sqlite lands), LanceDB fallback | Keeps the index on one embedded engine - no second native/service dep. LanceDB is the proven-capable fallback (memory-lancedb precedent on this machine). Qdrant adds a service, violates the embeddable preference. | sqlite-vec: MIT/Apache. LanceDB: Apache-2.0. |
| **Graph index (Stage 3+)** | Kùzu, sqlite adjacency, in-memory+rebuild | **sqlite adjacency now; Kùzu at OQ-2** | YAGNI - edges are already files; adjacency tables answer PoC graph queries. Revisit when queries demand real graph ops (paths, patterns). | Kùzu: MIT. |
| **Shell** | Electron 44, Tauri 2 | **Electron 44** (evidence recorded, not re-litigated) | ResonanceStudio-proven; Node 24.18.1 gives node:sqlite; `shell.openPath`/`shell.trashItem`/`chokidar` zero-friction; Tauri's mobile argument deferred to Stage 5 iPad ADR (OQ-3). | Electron: MIT. |
| **Packaging** | electron-builder, electron-forge | **electron-builder** | Standard for NSIS targets; ResonanceStudio uses it. | MIT. |
| **E2E runner** | Playwright, WebdriverIO, custom selftest | **custom selftest-to-file + Playwright (renderer)** | House rule verified in ResonanceStudio: Electron console output never reaches a bash pipe on Windows - proofs write result files. Playwright drives renderer-level UI tests where appropriate. | Playwright: Apache-2.0. |
| **Stroke lib** | perfect-freehand (API verified), alternatives | **perfect-freehand 1.2.3** | API verified 2026-10-12: `getStroke(points, StrokeOptions) -> Vec2[]` polygon outline → SVG `d`; `simulatePressure` covers the no-stylus path; tiny, dep-free. | **MIT** (verified npm). |

## Flags raised

- **tldraw SDK - out.** Production requires a purchased or watermarked license key (SDK-enforced). Recorded, not debated further unless the group wants a commercial dependency.
- **electron@44.7.0** released 2026-10-08 - inside the 7-day freshness rule. Pin `44.6.0` (or nearest ≥7-day patch) for now; bump next cycle.
- **node:sqlite is release-candidate**, not stable - verify availability inside Electron's patched Node at scaffold (probe R-3). If absent → better-sqlite3 fallback path is documented, verdict flips by ADR.
- **Von daemon was offline at probe time** (2026-10-12, curl → 000). Wire format verified from `jev-mcp/server.py` source instead; live probe recorded as a runbook task.

## Open questions generated

| OQ | Question | Lean |
|---|---|---|
| OQ-7 | Canvas engine: custom-DOM+salvage (recommended) vs Konva | custom - ADR-0004 drafted |
| - | Vector DB maturity (sqlite-vec on node:sqlite specifically) | defer to Stage 4 spike |

## Source links (verified 2026-10-12)

- Electron 44.0.0 release notes - Node 24.18.1: `releases.electronjs.org/release/v44.0.0`
- node:sqlite status: `nodejs.org/dist/latest-v24.x/docs/api/sqlite.html`
- tldraw license: `tldraw.dev/community/license`, `tldraw.dev/blog/tldraw-sdk-4-0`
- Contributor Covenant 3.0: `contributor-covenant.org/version/3/0/` (released 2025-07-28)
- npm: `electron@44` latest 44.7.0, `chokidar@5.0.0`, `perfect-freehand@1.2.3` (MIT)
