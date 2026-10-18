# SOTA Survey - Tooling Decisions Before Any Install

|            |                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| **Status** | Completed survey - verdicts feed DEVOPS §Toolchain and ARCHITECTURE §Stack                                          |
| **Date**   | 2026-10-12                                                                                                          |
| **Rule**   | No dependency is installed and no tool is run until its slot is surveyed here. Verdicts may be revised only by ADR. |

Method: for each slot, candidates are compared on fit-to-pillar (files-are-truth,
zero-cloud, zero-native-deps preference), maturity, license, and maintenance
signal. `compat-flag` means the license constrains reuse; flag rows get
"patterns only, no code copied" unless the group overrides by ADR.

## Decision matrix

| Slot                       | Candidates                                                                                       | Verdict                                                                     | Reason                                                                                                                                                                                                                                                                                                                                   | License / flag                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Canvas engine**          | tldraw SDK, Konva (+react-konva), PixiJS 8, salvaged CanvasMCPClient slices, custom DOM+Canvas2D | **Custom DOM renderer + salvaged camera/selection logic** (OQ-7 → ADR-0004) | tldraw SDK 4.0 requires a license key for any production use (dev-mode free, hobby tier watermarked, commercial paid; key-enforced) - hard flag for a group project that may ship. Konva is the credible fallback if DOM perf disappoints. CanvasMCPClient gives proven pan/zoom/selection math, not a data model we want anyway.        | tldraw: custom license-key scheme - **flagged, out**. Konva: MIT. PixiJS: MIT. |
| **File watcher**           | chokidar 5, @parcel/watcher, watchman                                                            | **chokidar 5.0.0**                                                          | Pure JS - keeps zero-native-deps story with node:sqlite. @parcel/watcher (VS Code's watcher) is faster and native-prebuilt; registered as the upgrade path if R-2/event-fidelity testing shows gaps. watchman: Windows support is second-class.                                                                                          | chokidar: MIT. @parcel/watcher: MIT.                                           |
| **Embedded DB**            | node:sqlite, better-sqlite3                                                                      | **node:sqlite**                                                             | Electron 44.0.0 embeds Node 24.18.1 (verified 2026-10-12, releases.electronjs.org); node:sqlite is flag-free since Node 22.13 and release-candidate since 24.15 - synchronous API, zero native modules, zero electron-rebuild. Risk: RC status, verify presence in Electron main at scaffold (probe R-3). Fallback: better-sqlite3.      | node: built-in. better-sqlite3: MIT.                                           |
| **Markdown editor**        | CodeMirror 6, Milkdown/TipTap, Monaco                                                            | **CodeMirror 6**                                                            | Small embeddable editor for link notes; same engine Obsidian uses (familiar behavior for users). TipTap/Milkdown are full rich-text frameworks - heavier than a frontmatter-aware md editor needs. Monaco is IDE-scale.                                                                                                                  | CM6: MIT.                                                                      |
| **State**                  | Redux Toolkit, Zustand 5, tldraw signals                                                         | **Zustand 5**                                                               | ResonanceStudio-proven on this stack; minimal; fits custom canvas (donor slices port to it cleanly). RTK only if we salvaged Redux wholesale - we are not.                                                                                                                                                                               | MIT both.                                                                      |
| **Frontmatter/YAML**       | gray-matter, js-yaml, yaml                                                                       | **gray-matter**                                                             | Purpose-built for `---` frontmatter in .md files; tiny; battle-tested.                                                                                                                                                                                                                                                                   | MIT.                                                                           |
| **ID generation**          | crypto.randomUUID, ulid, nanoid                                                                  | **crypto.randomUUID() built-in**                                            | Zero deps; 16-hex slice matches the verified Obsidian/donor ID convention (`uuid4().hex[:16]`).                                                                                                                                                                                                                                          | built-in.                                                                      |
| **Vector index (Stage 4)** | LanceDB, sqlite-vec, Qdrant local                                                                | **sqlite-vec** (if node:sqlite lands), LanceDB fallback                     | Keeps the index on one embedded engine - no second native/service dep. LanceDB is the proven-capable fallback (memory-lancedb precedent on this machine). Qdrant adds a service, violates the embeddable preference.                                                                                                                     | sqlite-vec: MIT/Apache. LanceDB: Apache-2.0.                                   |
| **Graph index (Stage 3+)** | Kùzu, sqlite adjacency, in-memory+rebuild                                                        | **sqlite adjacency now; Kùzu at OQ-2**                                      | YAGNI - edges are already files; adjacency tables answer PoC graph queries. Revisit when queries demand real graph ops (paths, patterns).                                                                                                                                                                                                | Kùzu: MIT.                                                                     |
| **Shell**                  | Electron 44, Tauri 2                                                                             | **Electron 44** (evidence recorded, not re-litigated)                       | ResonanceStudio-proven; Node 24.18.1 gives node:sqlite; `shell.openPath`/`shell.trashItem`/`chokidar` zero-friction; Tauri's mobile argument deferred to Stage 5 iPad ADR (OQ-3).                                                                                                                                                        | Electron: MIT.                                                                 |
| **Packaging**              | electron-builder, electron-forge                                                                 | **electron-builder**                                                        | Standard for NSIS targets; ResonanceStudio uses it.                                                                                                                                                                                                                                                                                      | MIT.                                                                           |
| **E2E runner**             | Playwright, WebdriverIO, custom selftest                                                         | **custom selftest-to-file + Playwright (renderer)**                         | House rule verified in ResonanceStudio: Electron console output never reaches a bash pipe on Windows - proofs write result files. Playwright drives renderer-level UI tests where appropriate.                                                                                                                                           | Playwright: Apache-2.0.                                                        |
| **Stroke lib**             | perfect-freehand (API verified), alternatives                                                    | **perfect-freehand 1.2.3**                                                  | API verified 2026-10-12: `getStroke(points, StrokeOptions) -> Vec2[]` polygon outline → SVG `d`; `simulatePressure` covers the no-stylus path; tiny, dep-free.                                                                                                                                                                           | **MIT** (verified npm).                                                        |
| **Shell icon extraction**  | systemicons, hand-rolled SHGetFileInfo+GDI+ PNG pipe, app.getFileIcon (Electron-only)            | **systemicons 0.9.13**                                                      | Eagle tiles show the OS-associated icon for unparseable binaries (blend/c4d/dwg). systemicons wraps SHGetFileInfoW on Windows, NSWorkspace on macOS, GTK on Linux, returns PNG bytes - one call cross-platform vs a per-OS GDI+/Cairo icon pipeline. MIT, no transitive deps of consequence.                                             | **MIT** (verified crates.io).                                                  |
| **Shell thumbnails**       | hand-rolled IShellItemImageFactory, WIC resize, cache-db                                         | **hand-rolled IShellItemImageFactory + image crate**                        | Windows Explorer thumbs for video frames, heic, cr3, .blend (Blender registers a handler). IShellItemImageFactory returns an HBITMAP; `image` 0.25 re-encodes to PNG for the `.box/thumbs/` cache. Pure-Rust WIC alternative does not exist; going through the shell means every app's installed thumb handlers work for free.           | `image`: **MIT** (verified crates.io); windows crate feature-gated.            |
| **PSD/PSB preview**        | ag-psd, psd.js (stale), PSD spec reader                                                          | **ag-psd 31.0.3**                                                           | Composite-thumbnail read path only (`composite: true`); ag-psd is the maintained fork (psd.js dormant since 2020), parses both PSD and PSB, and skips heavy layer decoding. Falls back to shell thumb when a file has no composite (Maximize Compatibility off).                                                                         | **MIT** (verified npm).                                                        |
| **TIFF decode**            | utif, tiff.js (stale), geotiff                                                                   | **utif 3.1.0**                                                              | utif decodes uncompressed/LZW/packbits TIFF to RGBA; geotiff targets geo tags not general imagery; tiff.js is a 2015-era wasm build. Untyped package - local `utif.d.ts` shim.                                                                                                                                                           | **MIT** (verified npm).                                                        |
| **RAW preview**            | libraw wasm, dcraw wasm, embedded-JPEG TIFF walker                                               | **embedded-JPEG walker (zero deps)**                                        | Every TIFF-family RAW (dng/cr2/nef/arw/rw2/orf) already carries a full-res or preview JPEG at IFD tags 0x0201/0x0202. A ~100-line parser extracts it - covers most of the RAW market with no codec. libraw/dcraw wasm ports are multi-MB and demosaic into megapixels; overkill for a tile. cr3 (ISO-BMFF) falls through to shell thumb. | in-repo, no dep.                                                               |
| **LUT preview**            | ocio wasm, three ColorCorrection, .cube parser                                                   | **in-repo .cube parser + strip renderer**                                   | `.cube`/`.3dl` are tiny text/binary tables; parsing + tri-linear-sampling a hue x value strip is ~150 lines. OCIO wasm is ~10MB and targets color-managed pipelines, not thumbnails. .look/.csp/.mga get text previews; binary luts fall to shell thumb.                                                                                 | in-repo, no dep.                                                               |
| **USD family**             | three.js USDZLoader only, usd-rs wasm                                                            | **three.js `USDLoader` (r180)**                                             | r180's USDLoader parses usd/usda/usdc/usdz in pure JS (usdc embedded-crate handles the binary) - covers all four exts with no wasm download; our beforeAll hook ran before USDLoader existed.                                                                                                                                            | bundled with three (MIT).                                                      |
| **KTX2/GPU textures**      | three KTX2Loader + Basis wasm, custom basis pipeline                                             | **three `KTX2Loader` + vendored `basis_transcoder`**                        | Loader needs the basis transcoder wasm at runtime - copied from `three/examples/jsm/libs/basis` into `public/basis/` (third-party, eslint-ignored). `detectSupport(renderer)` reuses the preview GL context.                                                                                                                             | Basis transcoder: Apache-2.0 (vendored from three).                            |
| **Model-format sweep**     | add loaders per format, cap at text/standard                                                     | **three.js loaders: PCD, XYZ, BVH, LWO, USD**                               | All five are MIT-licensed three examples loaders, zero deps. PCD/XYZ return `Points` (not Mesh) - rendered with PointsMaterial. LWO covers lightwave lwo/lwo2/bwo via `@types/three` typings. Proprietary binaries (max/mb/c4d/r3d) stay icon tiles - no wasm parser exists.                                                             | bundled with three (MIT).                                                      |

## Flags raised

- **tldraw SDK - out.** Production requires a purchased or watermarked license key (SDK-enforced). Recorded, not debated further unless the group wants a commercial dependency.
- **electron@44.7.0** released 2026-10-08 - inside the 7-day freshness rule. Pin `44.6.0` (or nearest ≥7-day patch) for now; bump next cycle.
- **node:sqlite is release-candidate**, not stable - verify availability inside Electron's patched Node at scaffold (probe R-3). If absent → better-sqlite3 fallback path is documented, verdict flips by ADR.
- **Von daemon was offline at probe time** (2026-10-12, curl → 000). Wire format verified from `jev-mcp/server.py` source instead; live probe recorded as a runbook task.

## Open questions generated

| OQ   | Question                                                    | Lean                      |
| ---- | ----------------------------------------------------------- | ------------------------- |
| OQ-7 | Canvas engine: custom-DOM+salvage (recommended) vs Konva    | custom - ADR-0004 drafted |
| -    | Vector DB maturity (sqlite-vec on node:sqlite specifically) | defer to Stage 4 spike    |

## Source links (verified 2026-10-12)

- Electron 44.0.0 release notes - Node 24.18.1: `releases.electronjs.org/release/v44.0.0`
- node:sqlite status: `nodejs.org/dist/latest-v24.x/docs/api/sqlite.html`
- tldraw license: `tldraw.dev/community/license`, `tldraw.dev/blog/tldraw-sdk-4-0`
- Contributor Covenant 3.0: `contributor-covenant.org/version/3/0/` (released 2025-07-28)
- npm: `electron@44` latest 44.7.0, `chokidar@5.0.0`, `perfect-freehand@1.2.3` (MIT)

## storytold/ArtCraft survey (added 2026-10-20)

`github.com/orgs/storytold` is the ArtCraft org: clean-room Rust reimplementations
of creative apps (61 repos, all Apache-2.0 or Apache/MIT dual). Cloned to
`reference/storytold/` for donor mining: `craft-libs` (3.5 MB), `figcraft`
(28 MB), `vectorcraft` (58 MB).

### Adopted this pass

- **`craft-libs/crates/atomic`** — crash-safe file replacement: fsync staged
  file before rename, Windows rename retry (7 attempts, 10 ms doubling,
  200 ms cap) on sharing/lock violations and `PermissionDenied`, tmp cleanup
  on failure. Ported into `write_atomic` (THIRD_PARTY_NOTICES row). Direct
  fix for the classic Windows AV/indexer rename flake - ours was write+rename
  with no fsync and no retry.
- **`craft-libs/crates/settings`** — recovery patterns worth adopting for
  `.box/settings.json` corruption: `move_aside` renames a damaged file to
  `name.broken-<unix-ts>.<ext>` (never destroys data), `write_backup` keeps
  `.bak` of last-good. Reference only for now; renderer-side settings module
  already degrades to defaults.
- **`vectorcraft/crates/brush`** — brush definitions + stroke-to-fill geometry
  (`stroke_pieces` single source, renderer caches pieces). Donor for the
  parked WASM brush engine (ROADMAP Stage 5).
- **`vectorcraft/crates/pathops`** — boolean path ops (`boolean.rs`,
  `offset.rs`, `planar.rs`). Donor for stroke-splitting erase (tldraw-style
  partial erase) if FR-106 ever graduates from whole-stroke removal.
- **`vectorcraft/crates/svg`** — full SVG import/export. Donor if `.ink.svg`
  ever needs richer path types beyond our polygon subset.
- **`figcraft`** — full design-tool document engine (625 .rs files, egui
  renderer). Different render model from our DOM canvas; patterns-only
  reference for selection/annotation depth.

### Not adopted (evaluated, wrong fit)

- figcraft `geom/transform.rs` — kurbo `Affine`-based; our `camera.ts`
  (translate+zoom) is simpler and correct for our model.
- `soundcraft`/`filmcraft`/`pdfcraft`/`wordcraft` — full Rust media engines;
  our previews are HTML5/WebView2-native. Revisit only if WKWebView codec
  gaps or a PDF node type justify a renderer dependency.
