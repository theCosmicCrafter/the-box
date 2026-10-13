# SECURITY-THREATS.md - Threat Model and Hardening Rules

|             |                                                 |
| ----------- | ----------------------------------------------- |
| **Status**  | Contract - parser and IO rules here are binding |
| **Version** | 0.1 - 2026-10-12                                |

The Box is local-first, single-user, no network outside optional localhost AI
calls. The honest threat model is therefore narrow and specific: **the
workspace is the attack surface.** A workspace may be received from someone
else (a shared world, a downloaded board pack, a git clone). Every file in it
is parsed by us.

## 1. Trust boundaries

| boundary                  | rule                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer → Rust IPC       | **Untrusted.** `invoke` args are serde-validated; all paths pass `resolve_inside`; mutating commands bind to the session root (`bound_root`) - a caller cannot write/trash/tombstone outside the workspace the app opened. `fs_append_tombstone` enforces exactly-16-hex edge ids. |
| `box://` protocol         | Path is percent-decoded then `resolve_inside`-checked; Range requests bounded to 8 MiB served per request; unsatisfiable → 416 with `Content-Range: */len`; malformed → error. No traversal, no unbounded reads.                                                                   |
| Workspace files → parsers | **Untrusted.** Every `.box.canvas`, `link-*.md`, `.ink.svg`, frontmatter block may be hostile or corrupt. Parsers must be total functions: worst case = problem item, never a crash, never a write outside the workspace.                                                          |
| App → filesystem          | All paths from file content are **untrusted**: `file`, `box-ink`, `box-link`, `from-file`, `to-file`. Resolve via `resolveInside(root, rel)` - a `PathRel` that escapes the workspace root is rejected as malformed (same policy as ResonanceStudio's `PathRel` rule).             |
| App → external tools      | `shell.openPath` only ever receives resolved-in-workspace absolute paths or registered app paths from user prefs. Never constructed from file content strings.                                                                                                                     |
| box-mcp → agents          | Agents get the same invariant enforcement as the UI; MCP surface is read-mostly, writes go through `box-core`.                                                                                                                                                                     |
| Localhost AI services     | Output is advisory data, never executable; decision responses are parsed typed-first, range-clamped (p∈[0,1]).                                                                                                                                                                     |

## 2. Enumerated threats and required handling

| threat                                                                       | handling                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path traversal** via `file: "../../etc/passwd"` or absolute paths          | PathRel validation (DATA-MODEL §2.3): reject, problem item. No file access is ever attempted outside root.                                                                                                                                                                              |
| **Frontmatter injection**: `box-*` key smuggling, YAML bombs, duplicate keys | js-yaml parse inside try/catch + key allowlist for app-managed fields; YAML anchors/aliases rejected (plain subset only); body size capped (10MB).                                                                                                                                      |
| **Billion-laughs / degenerate SVG** in `.ink.svg`                            | Parse via DOMParser with entity expansion off (SVG/XML parser defaults disallow external entities); element/attr allowlist (`svg`, `path`, `g`, `title`; `d`, `stroke*`, `fill`, `viewBox`, `box-*`); anything else dropped, problem item.                                              |
| **Zip-bomb / giant media**                                                   | Size check before decode: image ≤200MP equivalent, video/audio streamed not buffered; oversize → placeholder + problem item (ERR-6). Zip previews extract **only thumbnail-named entries** and reject `originalSize` (uncompressed, not compressed size) > 64 MiB before decompressing. |
| **Malicious `.canvas`**: huge arrays, NaN/Infinity coords, id collisions     | Bounds on counts (nodes ≤100k), coords ints within ±1e7, duplicate ids → problem item (DATA-MODEL §8, §9).                                                                                                                                                                              |
| **Link note as script vector**: `javascript:` links in rendered markdown     | Render markdown with link sanitization; link notes are plain md rendered in a sandboxed view - no remote resources, no raw HTML.                                                                                                                                                        |
| **Watcher-induced DoS**: event flood                                         | Debounce + full-scan + "indexing" state (DATA-MODEL §5.2.5).                                                                                                                                                                                                                            |
| **Tombstone ledger tampering**                                               | Tombstones only _complete_ deletes; worst case = a note stays deleted. Entries expire in 30 days.                                                                                                                                                                                       |
| **Tainted `settings.json`** (open-with app path pointing at malware)         | App paths are user-set through the prefs UI, never from workspace files; `.box/settings.json` edits are read but app paths must exist on disk and are shown in prefs.                                                                                                                   |

## 3. Non-negotiables reaffirmed

- Zero cloud: no code or workspace content leaves localhost (Von/Winnow/
  Ollama only, all optional).
- No secrets anywhere: repo, fixtures, logs, workspace files.
- Recoverable deletion only.
- Third-party readers: we emit spec-clean JSON Canvas + `box-*` keys; we never
  rely on another app's trust of our files.
- Renderer hardening (Electron): `contextIsolation` on, `nodeIntegration`
  off, sandbox on; all main/renderer traffic via the IPC contract only.
