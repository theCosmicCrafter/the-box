# The Box

> **A lighter Obsidian with a smarter canvas.**
> Objects are files. Arrows are notes. Edits round-trip.

The Box is an independent, local-first desktop canvas for worldbuilding and creative reference.
Everything on the canvas is a real file on disk. Drawing an arrow between two objects creates a
real Markdown note that documents the relationship. Double-clicking an object opens it in your
preferred external editor; when that app saves, the canvas updates. Obsidian is the design
reference, not a dependency - The Box owns its whole stack.

## Status

**Pre-scaffold.** This repository currently contains documentation and a `reference/` folder of
donor projects. No application code exists yet - see `docs/ROADMAP.md` Stage 0.

## Documentation Map

| Document                                                       | Purpose                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)                                   | Product requirements - what we are building and why. **Start here.** Readable layer first, contract layer below. |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)                     | File formats, write semantics, reconcile rules - **the binding contract.**                                       |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Package contracts, IPC, flows, verified facts, salvage map.                                                      |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                           | Stages 0–5 with exit criteria, plus the parked north star.                                                       |
| [`docs/DEVOPS.md`](docs/DEVOPS.md)                             | Pinned toolchain, gates, CI contract, runbook.                                                                   |
| [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)                       | Invariant suite, chaos matrix, fixtures, verification matrix.                                                    |
| [`docs/SECURITY-THREATS.md`](docs/SECURITY-THREATS.md)         | Threat model - the workspace is the attack surface.                                                              |
| [`docs/RESOURCES.md`](docs/RESOURCES.md)                       | Build-asset inventory: donors, services, machine, people.                                                        |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md)                         | Canonical terms - one name per thing.                                                                            |
| [`docs/research/SOTA-SURVEY.md`](docs/research/SOTA-SURVEY.md) | Tooling decisions - nothing installs before its slot is surveyed.                                                |
| [`docs/adr/`](docs/adr/)                                       | ADR-0001 register + settled/proposed decisions (OQ-1..OQ-8).                                                     |
| [`CONTEXT.md`](CONTEXT.md)                                     | Zero-context handoff for a new contributor or agent.                                                             |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                           | Workflow, DCO, SPDX, review - how the group works.                                                               |
| [`GOVERNANCE.md`](GOVERNANCE.md)                               | Who decides what, and how decisions become binding.                                                              |
| [`SECURITY.md`](SECURITY.md)                                   | Private vulnerability reporting.                                                                                 |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)                     | Contributor Covenant 3.0.                                                                                        |
| [`LICENSE`](LICENSE)                                           | UNLICENSED marker - pending OQ-8.                                                                                |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)             | Adapted-code provenance register.                                                                                |
| [`AGENTS.md`](AGENTS.md)                                       | Rules for coding agents operating in this repo.                                                                  |

## The three-file model (the whole idea in one picture)

```
photo.png            ← the object. Never touched by The Box.
photo.png.ink.svg    ← your ink notation over it. Editable forever.
link-7f3a.md         ← the arrow to another object. A real note documenting the join.
```

Three files, three jobs, all readable without The Box. Siloing is impossible by construction.

## Team

- **Christian** - product owner / domain lead (the artist this is for)
- **Rich** - engineering lead
- Group project: all design decisions land in docs before they land in code.
