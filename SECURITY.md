# Security

## Reporting a vulnerability

This is a private project - please **do not open a public issue** for
security findings.

- Report to **Rich** (engineering lead) via private channel (DM/email).
- Include: what you found, where (file/format/feature), how to reproduce,
  and your assessment of impact.
- We aim to acknowledge within a few days and fix on a reasonable timeline
  for a local-first single-user app.

## Scope and threat model

The threat model lives in `docs/SECURITY-THREATS.md`. In short: the app is
local-first and the attack surface is **workspace content** - path traversal,
frontmatter injection, degenerate SVG/media, and tainted settings.

## Supported versions

Pre-1.0: only `main` receives fixes.

## Rules for contributors

- Never commit secrets - they live in Bitwarden, not `.env` files.
- All file paths from workspace content must pass `resolveInside` (see
  SECURITY-THREATS §1) before use.
- No network calls outside the optional localhost AI layer.
- Deletion is always recoverable (Recycle Bin).
