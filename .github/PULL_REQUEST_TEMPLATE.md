## What

<!-- one paragraph: what changed and why -->

## Requirement linkage

<!-- e.g. Implements FR-107 / fixes problem-item #N / docs: ADR-000X -->

## Test evidence

<!-- output of gates: typecheck / lint / test / test:invariants / test:formats / e2e.
     Paste failing-then-passing or fixture evidence for sync changes. -->

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` green
- [ ] Invariant tests green for any sync/format change
- [ ] Docs updated if this touches format, scope, or conventions (doc-first rule)

## UI changes

<!-- screenshots or recording, if any -->

## Sign-off

- [ ] Commits carry DCO sign-off (`git commit -s` → `Signed-off-by:`) - recommended now, enforced when public
- [ ] Adapted code has provenance header + THIRD_PARTY_NOTICES row
