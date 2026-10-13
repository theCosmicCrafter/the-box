# DEVOPS.md - Toolchain, Gates, CI, Environments, Machine Rules

|             |                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| **Status**  | Contract - materializes with Stage 0 scaffold. Until a gate is automated it runs manually before merge. |
| **Version** | 0.2 - 2026-10-12                                                                                        |

## 1. Toolchain (pinned; verified 2026-10-12 via npm view + release notes)

| tool                              | pin                                                                                          | notes                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Node                              | 24.x (dev runtime; the webview is the app runtime, not Node)                                 |                                                                                                    |
| npm                               | bundled                                                                                      | workspaces only - never yarn/pnpm                                                                  |
| TypeScript                        | 5.x strict (NodeNext, ESM)                                                                   | `tsconfig.base.json` at root; TS 7 exists but pin 5.x until ecosystem settles - revisit next cycle |
| Rust                              | stable MSVC (1.99 verified)                                                                  | platform layer language; VS Build Tools 2022 required on Windows                                   |
| Tauri                             | **2.12.x** (`tauri` 2.12.3, `@tauri-apps/cli` + `@tauri-apps/api` 2.x)                       | ADR-0006; WebView2 runtime 154.x verified; macOS uses WKWebView                                    |
| React / react-dom                 | 19.3.0                                                                                       |                                                                                                    |
| Vitest                            | 5.0.4                                                                                        |                                                                                                    |
| Zustand                           | 5.0.15                                                                                       |                                                                                                    |
| node:sqlite                       | Node 24 built-in (index tool, not the app runtime)                                           | **probe at scaffold**; fallback better-sqlite3                                                     |
| CodeMirror                        | @codemirror/state 6.7.6, view 6.43.14, lang-markdown 6.5.2, language 6.13.1, commands 6.11.1 | link-note editor only                                                                              |
| gray-matter                       | 4.0.3                                                                                        | frontmatter                                                                                        |
| perfect-freehand                  | 1.2.3 (MIT)                                                                                  | ink                                                                                                |
| tauri bundler                     | in-tree (`tauri build` → NSIS/MSI on Windows)                                                | Stage 5 packaging; verified producing 2-3 MiB installers                                           |
| Python (sidecars only, if needed) | 3.12 via project venv                                                                        | `PYTHONUTF8=1` every launch; never global pip                                                      |

Dependency policy: exact pins, no ranges, new deps ≥7 days old. Check
`reference/` for salvageable code before adding anything.

## 2. Repo conventions

- `main` always green. Short-lived `feat/`, `fix/`, `docs/` branches; merge
  via PR. No long-lived dev branches.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`) with optional scope: `feat(box-core): ...`.
- **Doc-first:** format/pillar/scope changes update docs + ADR in the same PR.
- **DCO sign-off:** `git commit -s` recommended now, enforced when public
  (gate below).
- **SPDX:** every source file carries `// SPDX-License-Identifier: <id>`;
  adapted files also carry the provenance header (§5).

## 3. Quality gates

| gate             | command                                                                                                                                  | blocks merge       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| typecheck        | `npm run typecheck` (`tsc -b` workspace refs)                                                                                            | yes                |
| lint             | `npm run lint` (ESLint flat)                                                                                                             | yes                |
| unit tests       | `npm test` (Vitest)                                                                                                                      | yes                |
| rust gates       | `cargo check` + `cargo clippy` + `cargo fmt --check` + `cargo test` in `apps/desktop/src-tauri` (incl. `adversarial` module)             | yes                |
| invariant suite  | `npm run test:invariants` - tests named `invariant-I<N>-<slug>`, 1:1 with DATA-MODEL §invariants                                         | yes                |
| format check     | `npm run test:formats` - fixture files parse/serialize/round-trip; Prettier `format:check` excludes `src-tauri/target` + `src-tauri/gen` | yes                |
| live-app CDP     | `tauri dev` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` + `tools/cdp-eval.mjs` probes (TEST-PLAN §10)         | manual before ship |
| FOSS (post-code) | `reuse lint` (SPDX coverage), license-compat vs THIRD_PARTY_NOTICES, DCO check on PRs (post-public), community-health file presence      | yes when activated |

## 4. CI contract (write `.github/workflows/ci.yml` at Stage 0)

```yaml
on: [push, pull_request]
jobs:
  gates:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
        with: { components: clippy, rustfmt }
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test
      - run: npm run test:invariants && npm run test:formats
      - run: cargo check && cargo clippy && cargo test
        working-directory: apps/desktop/src-tauri
      # - run: reuse lint                # enable when code exists
```

Later job: `package` - `tauri build` (NSIS + MSI on Windows, dmg on macOS,
iOS via Xcode on a macOS runner) on `v*` tag push.

## 5. Provenance (FOSS hygiene)

- Adapted file header: `// SPDX-License-Identifier: <our license>` +
  `// Adapted from <repo path/URL> (<source license>): <what taken>; left out: <what>`.
- One row per adapted file in `THIRD_PARTY_NOTICES.md`:
  `{file, source, source license, adaptation summary}`.
- Survey rule (SOTA-SURVEY): copyleft/nonstandard-license donors are
  "patterns only" unless the group overrides by ADR.

## 6. Environments

| env                              | purpose              | rules                                                                               |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `fixtures/` generated workspaces | automated tests      | Deterministic generator in `tools/`; small committed corpus + generated large cases |
| `TheBox-Dev` sandbox             | manual dev           | A folder the developer picks; **never a real vault before Stage 3**                 |
| Dogfood                          | Christian's real use | After Stage 3 only; keep a copy-on-first-open backup habit                          |

Env-var table (all localhost, no secrets):

| var              | default                                     | overrides                                                  |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `BOX_VON_URL`    | `http://127.0.0.1:8770/v1/systemone`        | decisions endpoint (mirrors `TYPESAFE_API_URL` convention) |
| `BOX_WINNOW_URL` | `http://127.0.0.1:47311/hook/post-tool-use` | prune sidecar                                              |
| `BOX_OLLAMA_URL` | `http://127.0.0.1:11434`                    | embeddings/heavy tasks (Stage 4)                           |
| `BOX_LOG_DIR`    | `<workspace>/.box/logs/`                    | diagnostics                                                |

Secrets live in Bitwarden - never `.env` files, never committed.

## 7. Diagnostics

- Log: structured JSON lines to `.box/logs/app.log` (rolling, ≤10MB).
- Levels: error / warn / info / debug; debug off by default.
- No telemetry, ever. The log is the only diagnostics channel; it stays
  inside the workspace.

## 8. Machine rules (this workstation - binding for dev work here)

- One RTX 5090 shared with ComfyUI (`:8189`) and Von (`:8770`, ~1.5GB
  resident). Check ComfyUI `/queue` before GPU work; ask before multi-minute
  GPU jobs. The app itself must never need the GPU.
- **Zero cloud:** no code or workspace data to external APIs. All AI calls
  are localhost.
- Deletion = Recycle Bin - in app code and dev scripts alike.
- `PYTHONUTF8=1` on every Python launch.
- Search local drives (D:, F:, G:) before downloading any model/tool.

## 9. Runbook

| situation                               | action                                                                                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace won't open                    | `tools/rebuild-index` - index reconstructs from files; a broken cache is never fatal                                                                                                                                                                      |
| Orphaned notes / broken edges           | Problem-items panel lists them; repair via reconcile, never manual `.canvas` edits                                                                                                                                                                        |
| Watcher storms                          | Debounce+full-scan mode is automatic (DATA-MODEL §5.2.5); check `.box/logs/`                                                                                                                                                                              |
| Von offline                             | Expected state - Stage 4 features hide; verify with `curl 127.0.0.1:8770/v1/systemone`                                                                                                                                                                    |
| Live Von probe (deferred task from R-1) | `curl -s -X POST 127.0.0.1:8770/v1/systemone -H "Content-Type: application/json" -d '{"state":{"t":"probe"},"questions":{"q":{"type":"noul","instructions":"test?","criteria":{"true":"y","false":"n"}}}}'` - record response + timing in ARCHITECTURE §2 |
