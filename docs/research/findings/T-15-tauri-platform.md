# T-15 - Shell platform: Electron → Tauri 2 (research + landed migration)

|            |                                                               |
| ---------- | ------------------------------------------------------------- |
| **Status** | **done + landed** - migration shipped and verified 2026-10-13 |
| **Date**   | 2026-10-13                                                    |
| **ADR**    | [ADR-0006](../../adr/ADR-0006-shell-platform-tauri.md)        |

## Why the question was reopened

ADR-0001 D-6 chose Electron on thin grounds. Two facts changed: Christian is
on macOS (WKWebView either way), and the iPad path (OQ-3) has exactly one
answer - Electron cannot ship iOS, Tauri 2 mobile can.

## Verified platform facts (2026-10-13)

| claim checked           | result                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri Windows engine    | WebView2 = same Chromium already verified; renderer unchanged                                                                                 |
| Tauri macOS/iOS engine  | WKWebView (Apple mandates WebKit for everything on iOS anyway)                                                                                |
| WebKit codec gaps       | mostly closed by Safari 18.4: VP8/VP9/AV1/HEVC/WebM, `decodeAudioData` rewritten (FLAC/AAC/MP3/Opus/Ogg tests), muted+inline autoplay allowed |
| residual WebKit quirk   | PDF in `<iframe>` renders blank - fix `<embed>` or pdf.js                                                                                     |
| custom protocol + Range | `register_uri_scheme_protocol` + `http_range` in-tree; official streaming example matches our handler shape                                   |
| Windows custom scheme   | resolves `https://box.localhost/<path>` - `resolveMedia` emits per-platform URL + `?v=<mtime>` cache-bust                                     |
| iOS builds              | real but **require macOS/Xcode host** - Christian's Mac covers it                                                                             |
| installer size          | measured: NSIS 2.19 MiB, MSI 3.14 MiB (Electron ~250 MiB)                                                                                     |
| CDP debugging           | works via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`                                                                |

## What actually moved

- `main/index.ts` (Electron main, ~540 lines) → `src-tauri/src/lib.rs` (Rust):
  `walkdir` scan, `notify` watcher + 250ms debounce → `box:fs-dirty` event,
  temp+rename atomic writes, `trash` crate, `opener` crate, `box://` protocol
  (MIME via `mime_guess`+`infer`, Range 200/206/416, 8 MiB/request cap),
  session file under `app_data_dir`.
- **Reconcile moved to the renderer** (`sync.ts`): `box-core` is pure TS, so
  the classify→reconcile→WritePlan→exec loop runs inside the webview. Rust
  executes fs steps; it never invents writes. `box-ui` untouched.
- `bridge.ts` exposes `window.box` over `invoke`/`listen` - same 11-method
  surface the renderer already consumed.
- `electron`, `electron-vite`, `electron-builder` removed from
  `apps/desktop/package.json`; `chokidar` was already unused (raw `fs.watch`
  was in use).

## WebView2 ≠ Node: the globals audit

The migration's nastiest live-only bug was a **dependency** assumption, not
our code: `gray-matter` calls `Buffer.from()` in both its parse and stringify
paths. `Buffer` is a Node global — present in Electron's renderer (Node
integration) and in vitest (Node env), absent in WebView2. Every frontmatter
write (edge link notes, note-body saves) threw inside `createEdgePlan` before
touching disk: no edge, no note, no error surfaced — an unhandled rejection.

Result: gray-matter removed from `box-core`; frontmatter is now an in-house
`---` fence splitter + `js-yaml` for parse + a deterministic scalar emitter
(JSON.stringify for non-plain values - JSON is a YAML 1.2 subset). The
regression test deletes `globalThis.Buffer` so Node-env tests reproduce the
webview condition. **Rule: anything renderer-reachable must be audited for
Node-only globals (`Buffer`, `process`, `require`, `__dirname`) — vitest will
never catch these because it runs under Node.** Verified browser-safe in our
tree: `js-yaml`, `fflate`, `three`, `perfect-freehand`, `@tauri-apps/api`.

## Security work the port added (adversarial suite drove it)

- `bound_root`: mutating commands bind to the session root opened by
  `fs_open_workspace`/`fs_watch_workspace` - IPC can't aim writes at foreign
  roots.
- `fs_append_tombstone` enforces exactly-16-hex edge ids.
- Range handling distinguishes malformed (error) vs unsatisfiable (416 +
  `Content-Range: */len`); 8 MiB served cap per request.
- Path validation `resolve_inside` is parity-tested against `box-core`
  `isPathRel` (golden table in `src-tauri/src/adversarial.rs`).

## Cross-platform audit (2026-10-13, pre-Windows-release)

Every platform-coupled surface was checked; all features are already
universal:

| surface              | implementation                                                                                                                         | status                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| open/reveal external | `opener` crate (explorer / `open -R` / xdg-open)                                                                                       | universal                                                                       |
| trash                | `trash` crate (Recycle Bin / macOS Trash)                                                                                              | universal                                                                       |
| file pickers         | `rfd` native dialogs                                                                                                                   | universal                                                                       |
| fs watcher           | `notify`                                                                                                                               | universal                                                                       |
| media URLs           | `platform()` cmd → `box.localhost` on Windows, real `box://` elsewhere                                                                 | universal                                                                       |
| shortcuts            | `ctrl \|\| meta`, `Delete \|\| Backspace`                                                                                              | universal                                                                       |
| clipboard paste      | `navigator.clipboard`                                                                                                                  | universal                                                                       |
| rel paths            | `/` canonical; `is_path_rel` rejects `\\`, drive letters, `..`                                                                         | universal                                                                       |
| CSP                  | covers both `box:` and `https://box.localhost`                                                                                         | universal                                                                       |
| minted filenames     | `sanitize_filename` strips forbidden chars **and** Windows device stems (`con`, `nul`, `aux`, `com1-9`, `lpt1-9`, `clock$` → `file-*`) | fixed this pass - Mac-created workspaces must not mint names Windows can't open |
| bundle identifier    | was `dev.thebox.app` (`.app` suffix collides with macOS bundle ext)                                                                    | fixed → `dev.thebox.canvas`                                                     |

Left for the Mac pass (bundle/config, not features): `icon.icns` for the
.app bundle; WKWebView media-codec spot-checks; `useHttpsScheme` is a
no-op there (real `box://` registers natively).

## What stays unverified (honest list)

- macOS/WKWebView presenter pass (Stage 5; needs the Mac)
- iOS build (needs the Mac + Xcode)
- Packaged app smoke test on a clean machine (installers build; not yet
  installed-and-run on a fresh box)
