# GOVERNANCE.md - How decisions are made

A two-owner group project; formal enough to be unambiguous, light enough to
stay fast.

## Roles

| role             | person                 | owns                                                                           |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------ |
| Product owner    | **Christian**          | scope, UX feel, feature calls, dogfood sign-off, the app-list evaluation input |
| Engineering lead | **Rich**               | architecture, file formats, infrastructure, quality gates, tooling             |
| Contributors     | agents + future humans | work inside the conventions here                                               |

A decision needs the owner of its domain; cross-domain decisions (scope vs.
feasibility, format vs. UX) need both.

## Decision process

1. **Doc-first:** a proposal lands as a doc edit or ADR draft before code.
2. **ADR for anything binding:** file formats, pillars, architecture calls,
   tooling choices, license. Template lives in `docs/adr/ADR-0001-foundation.md`.
3. **Register:** open questions live as OQ rows in ADR-0001 with owner,
   due-stage, and lean. An OQ closes when its ADR is written and both owners
   have seen it (async sign-off counts; silence for a week on a flagged
   decision = escalate in chat).
4. **Supersede, don't edit:** settled decisions change only via a new ADR
   referencing the old row.
5. **Docs are the contract:** where docs and code disagree, docs win until
   the ADR amends them.

## Routine authority (no ADR needed)

Bug fixes, tests, doc clarifications, refactors that change no contract,
dependency bumps within pinned policy.

## Requires ADR

Any change to: file formats, sync semantics, pillars, scope (pulling parked
items forward), toolchain majors, dependency additions outside the pinned
table, license.
