# CONTRIBUTING - The Box

A group project with a doc-first culture. Docs are the contract; code follows.

## Ground rules

1. **Read order:** `CONTEXT.md` → `docs/PRD.md` → `docs/DATA-MODEL.md` →
   `docs/adr/` before proposing anything structural.
2. **Doc-first:** design decisions land in docs (+ ADR) before code. If code
   and docs disagree on `main`, docs win until amended by ADR.
3. **Small PRs:** one concern per PR. `feat:`, `fix:`, `docs:`, `test:`,
   `refactor:`, `chore:` conventional commits.
4. **Tests travel with code.** Every `DATA-MODEL.md` invariant has a test
   named `invariant-I<N>-<slug>`; new invariants → new doc row + new test.
5. **Pinned deps, ≥7 days old.** Check `reference/` for salvageable code
   before adding a dependency - and survey the slot in
   `docs/research/SOTA-SURVEY.md` first.
6. **Zero cloud.** No network calls outside the optional localhost AI layer.
7. **Recoverable deletion only** - in the app and in dev scripts alike.

## Licensing and contribution terms

- Project is currently `UNLICENSED - all rights reserved, private`
  (LICENSE file; OQ-8 decides the public license - lean: Apache-2.0).
- Contributions land under the project's license once chosen; until then,
  contributing means contributing to the private project under the same
  terms. The DCO below is how you certify you have the right to contribute.

## DCO (Developer Certificate of Origin)

Sign off every commit with `git commit -s`, which adds:

```
Signed-off-by: Your Name <you@example.com>
```

This certifies (per the standard DCO, <https://developercertificate.org>):
the work is yours or based on appropriately licensed prior work, you have
the right to submit it under the project license, and you understand the
contribution is public once the project is. Recommended now; enforced by a
CI gate when the repo goes public.

## SPDX and provenance

- Every new source file starts with `// SPDX-License-Identifier: <id>`
  (the interim id is `LicenseRef-Proprietary` until OQ-8 resolves).
- Adapted code carries a provenance comment:
  `// Adapted from <repo/path> (<license>): <what taken>; left out: <what>`
  plus a row in `THIRD_PARTY_NOTICES.md` - required **before** merge.
- While private, licenses do not gate reuse; provenance is still mandatory,
  and a compat sweep gates any public release (see `THIRD_PARTY_NOTICES.md`
  and ADR-0005).

## Security

Report vulnerabilities **privately** per `SECURITY.md` - no public issues
for security findings. The threat model is in `docs/SECURITY-THREATS.md`.

## Workflow

1. Pick the FR/stage you're implementing; reference it in the PR
   (`Implements FR-107`). Templates live in `.github/`.
2. Branch `feat/<slug>` → implement with tests → `npm run typecheck`,
   `npm run lint`, `npm test`, `npm run test:invariants`,
   `npm run test:formats` green locally.

Formatting is committed, not per-machine: `.prettierrc` (80 cols, double
quotes, LF), `.gitattributes` (LF everywhere), `.vscode/settings.json`
(formatOnSave via the Prettier extension). `npm run format` rewrites the
tree; `npm run format:check` verifies. `source.organizeImports` on save is
disabled repo-wide - it silently prunes imports added mid-edit. If your
editor formats differently, its config loses to the committed one. 3. PR: what/why, FR linkage, test evidence, screenshots for UI. 4. Review: second pair of eyes for code; docs-only may self-merge. 5. Squash-merge; `main` stays green.

## Roles

| Role      | Owns                                             |
| --------- | ------------------------------------------------ |
| Christian | Product calls - scope, UX feel, dogfood sign-off |
| Rich      | Architecture, formats, infra, gates              |

See `GOVERNANCE.md` for the decision process and ADR rules. Open decisions
live in `docs/adr/ADR-0001-foundation.md` - to pick one up, write the ADR
and propose it in a PR.

## Fixture workspaces

Tests and manual dev use generated fixtures (`tools/`) or a `TheBox-Dev`
sandbox folder. **Never run dev builds against a real vault before
Stage 3** - sync hardening ships first.
