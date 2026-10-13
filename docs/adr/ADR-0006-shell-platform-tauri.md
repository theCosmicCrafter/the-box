# ADR-0006 - Shell platform: Electron -> Tauri 2

| Status       | Date       | Supersedes                 |
| ------------ | ---------- | -------------------------- |
| **Accepted** | 2026-10-13 | ADR-0001 D-6 shell portion |

## Context

ADR-0001 D-6 picked Electron 44 on "ResonanceStudio proves it; zero learning
surface" grounds. Two facts changed since:

1. Christian (product owner, dogfooder) is on **macOS**. Electron means a
   bundled Chromium we control end to end; Tauri on macOS means WKWebView.
   The renderer must be verified on WebKit either way.
2. The iPad path (OQ-3, Stage 5) has exactly one viable answer: Tauri 2
   mobile. Electron cannot ship iOS at all.

The API surface question settled early: every Electron API consumed
(`protocol.handle` + Range, recursive `fs.watch`, `shell.openPath`/
`trashItem`/`showItemInFolder`, `dialog`, `app.getPath`, sandbox+contextBridge
IPC) has a verified Tauri equivalent (see T-15 evidence).

## Evidence (verified 2026-10-13, T-15)

- **Tauri 2.12 stable** (released 2026-10-10): mobile plugins, iOS build via
  Xcode, HMR to devices. iOS builds require a macOS host - Christian's Mac
  covers it.
- **`register_uri_scheme_protocol` + `HttpRange` are in-tree**: the official
  `examples/streaming` is our `box://` handler's exact shape - path decode,
  range parse, 206 with `Content-Range`. The built-in `asset` protocol
  already implements fs-scope-gated ranged file serving, equivalent to our
  `resolveInside` + Range code.
- **WebKit media gaps mostly closed by Safari 18.4** (verified via WebKit
  commits + MDN): VP8/VP9/AV1/HEVC/WebM all present (HEVC _better_ than
  Chromium on Apple silicon); `decodeAudioData` rewrote onto AVAssetReader
  with FLAC/AAC/MP3/Opus tests; Ogg Opus/Vorbis added; muted+inline autoplay
  allowed. Residual quirk: PDF inside `<iframe>` renders a blank synthesised
  wrapper - fix is `<embed>` or pdf.js (verified in karakeep PR #2806).
- **On Windows nothing changes for the renderer**: Tauri renders WebView2,
  which is the same Chromium engine already verified. The per-engine tax is
  only paid when macOS/Linux/iOS ship, and iOS is WKWebView under every
  framework (Apple mandates it).
- **Weight**: ~15MB binary vs ~250MB Electron install; RAM baseline lighter
  (shared WebView2 runtime vs bundled Chromium).
- **Cost honestly stated**: `main/index.ts` (~540 lines) ports to Rust:
  `scanDir`, the watch->debounce->reconcile->exec loop, `box://` protocol,
  tombstone ledger. `box-core` and `box-ui` are pure TS and run in the
  webview unchanged - the reconcile logic stays in one place (renderer).
- Known constraint: **Windows custom schemes serve as
  `http(s)://box.localhost/`** (WebView2 limitation); macOS/iOS get real
  `box://`. `resolveMedia` must emit per-platform URL shapes.

## Decision

**Switch to Tauri 2.** Windows keeps the verified Chromium renderer for
free; macOS gains the iPad path and accepts a one-time WKWebView
re-verification pass on the presenters (tracked as hardening tasks).

Architecture boundary that survives: `IVault` is the seam - Rust owns
filesystem/watcher/protocol/native-shell; renderer (React + box-core pure
TS) owns model/reconcile/canvas. Same split as before, new runtime.

## Consequences

- Node in main dies; Rust becomes the platform language. `cargo test` joins
  vitest in gates.
- `apps/desktop` electron-vite -> plain vite + `@tauri-apps/cli` devDep.
- CDP verification survives: WebView2 honors
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`.
- Presenter re-verification matrix opens for WKWebView (macOS) at Stage 5
  prep - PDF via `<embed>`, codec spot-checks, font/WebGL parity.

## Rejected alternatives

- **Stay Electron:** kills OQ-3 (no iOS), pays 250MB+ per install forever,
  buys nothing the product needs that Tauri lacks on Windows.
- **Electron desktop + separate iPad client:** two apps, two codebases, the
  PWA viewer would still be WebKit - pays the tax without the unity.
- **NW.js / neutralino / Ultralight:** same Chromium-bundle trade or weaker
  ecosystem; no mobile story.

## Verification results (2026-10-13, migration landed)

The port shipped and was verified live, not just on paper:

- `cargo check`/`clippy`/`fmt`/`test` clean; `tauri build` produces working
  NSIS (2.19 MiB) and MSI (3.14 MiB) installers - ~1% of the Electron
  footprint predicted.
- Live under WebView2 (CDP via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
--remote-debugging-port=9223`): all 11 `window.box` commands round-trip,
  `box://` (as `https://box.localhost`) serves real bytes with correct MIME
  - Range 206s, watcher->debounce->renderer-reconcile->store converged
    byte-exact after a 100-op filesystem storm on a scratch workspace, corrupt
    board surfaced as a `malformed-board` problem item (never a crash), and
    `lastWorkspace` session persistence round-trips.
- IPC fuzz via `__TAURI_INTERNALS__.invoke`: wrong types/missing fields/
  traversal attempts all rejected cleanly by serde + `resolve_inside` +
  `bound_root` session binding.
- Adversarial suite found and fixed 7 real defects (recorded in
  TEST-PLAN §10): 416-vs-404 unsatisfiable ranges, malformed `bytes=`
  handling, duplicate-path classifier double-report, tombstoned-edge
  oscillation (I-2 completion now strips board edges same-pass), zip
  thumbnail decompression cap (64MB), tombstone edge-id validation, link-note
  body round-trip newline drift.

What did NOT survive the port: `chokidar` was already unused (Electron main
used raw `fs.watch`); `electron`, `electron-vite`, `electron-builder` are
gone from `apps/desktop/package.json`.
