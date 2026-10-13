# ADR-0005 - Project license: private-until-decided, default Apache-2.0 (OQ-8)

| Status                                                       | Date       | Supersedes |
| ------------------------------------------------------------ | ---------- | ---------- |
| **Proposed - group decision required before public release** | 2026-10-12 | -          |

## Context

The Box is a group project that may go public. FOSS hygiene requires an
explicit license posture now: files carry SPDX identifiers, a LICENSE file
or an explicit private marker, and contribution terms are defined.

## Options

| option           | consequences                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **MIT**          | Max permissive; simplest for contributors; no patent grant                                       |
| **Apache-2.0**   | Permissive + express patent grant; LF-recommended default for new projects; slightly longer text |
| **Keep private** | All rights reserved; FOSS files still correct; going public later costs one commit               |

## Proposal

- **Now:** `UNLICENSED - all rights reserved, private` marker + full FOSS
  file set (CoC, SECURITY, GOVERNANCE, THIRD_PARTY_NOTICES, templates).
- **On going public:** default to **Apache-2.0** unless the group prefers
  MIT. Patent grant protects a novel-format project; LF convention.

## Interaction with donors

House doctrine (same as ResonanceStudio): while private, license terms do not
gate reuse - provenance is recorded in THIRD_PARTY_NOTICES regardless. Before
any public release, a license-compat sweep over the notices table is a
mandatory gate: copyleft donor code would force copyleft terms or extraction.
The decision is cheap to make later because the provenance record exists now.

## Consequences

- No blocking decision today; the repo is compliant either way.
- SPDX headers required in all new source files regardless.
- Contributions before licensing land under the interim private terms
  stated in CONTRIBUTING.md.
