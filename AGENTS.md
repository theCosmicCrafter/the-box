# AGENTS.md - The Box

Rules for any agent (human or AI) working in this repository.

## Read order before any change

1. `CONTEXT.md` - what this project is
2. `docs/PRD.md` - what we are building
3. `docs/DATA-MODEL.md` - the binding file-format contract
4. `docs/ARCHITECTURE.md` - package contracts + verified facts
5. `docs/adr/` - what is decided vs. open
6. `docs/research/SOTA-SURVEY.md` - before touching any dependency

**Doc-first rule:** any change to file formats, sync semantics, pillars, or scope lands in docs
(+ ADR entry) _before_ code. If code and docs disagree, docs win until the ADR is amended.

## Repo rules

- `reference/` contains third-party donor projects for study and salvage. **Shipped code never
  imports from `reference/`.** Salvaged code is copied into `packages/` with provenance noted
  (SPDX header + `THIRD_PARTY_NOTICES.md` row - required before merge).
- TypeScript `strict` everywhere. No `any` without a comment explaining why.
- Pinned dependency versions per `docs/DEVOPS.md` §1. No `latest`, no unbounded ranges.
  New deps ≥7 days old AND surveyed in `docs/research/SOTA-SURVEY.md` first.
- Nothing network-dependent in `box-core`. All AI/decision calls are optional layers above it.
- Tests: Vitest. Every `box-core` invariant in `docs/DATA-MODEL.md` has a test named
  `invariant-I<N>-<slug>` - see `docs/TEST-PLAN.md`.
- Plain prose, no em dashes, UTF-8 LF in all docs and source.

## Machine rules (apply everywhere - this workstation)

- `PYTHONUTF8=1` on every Python launch.
- One RTX 5090 is shared with ComfyUI (`127.0.0.1:8189`) and Von System One (`127.0.0.1:8770`,
  ~1.5 GB VRAM). Check ComfyUI `/queue` before GPU work; ask before multi-minute GPU jobs.
- **Zero cloud / Anthropic Guard:** agent decision models, routing, and tool sieves run locally
  (Von :8770, Winnow :47311, Ollama :11434). Never send code or vault data to external APIs
  without explicit user direction.
- Deletion means Recycle Bin / recoverable state - never `unlink` user files.
- Secrets live in Bitwarden Secrets Manager. Never commit secrets, never log their values.
- Search local drives (D:, F:, G:) before downloading any model or tool.

## Verification before claiming done

- `npm run typecheck` clean, `npm run lint` clean, `npm test` green.
- Every sync-invariant test in `box-core` passes.
- A change touching file formats includes a round-trip test proving the file survives
  read → modify → write → reopen.
