# THIRD_PARTY_NOTICES.md - Adapted-code register

Every file adapted from a donor project gets a header comment and a row here.
Format: `{file, source, source license, what was adapted, what was left out}`.
Convention adopted from ResonanceStudio's provenance rule.

Reuse policy (house doctrine, same as ResonanceStudio): while this project is
private, **license terms do not gate reuse** - any license may be adopted as
code, not only as patterns. Provenance is recorded regardless, and a
license-compat sweep is a mandatory gate before any public release or
distribution (see `docs/adr/ADR-0005-license.md`). The only exclusions are
`.env`/credential material and anything else an ADR explicitly forbids.

## Register

| our file                                          | source | source license | adapted | left out |
| ------------------------------------------------- | ------ | -------------- | ------- | -------- |
| _(pending - first adaptation adds the first row)_ |        |                |         |          |

## Candidate donors already surveyed (pre-register, for reference)

| source                                                                  | license                           | intended use                                                |
| ----------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `obsidian-master-control-mcp` (canvas.py, canvas_operations.py)         | ours (local project)              | port node/edge model, 14 ops, helpers → `box-core`          |
| `CanvasMCPClient` frontend slices                                       | ours (local project)              | port camera/selection logic → `box-ui`                      |
| `perfect-freehand` 1.2.3                                                | MIT                               | dependency (pinned), ink strokes                            |
| `Lorien-main`                                                           | TBD-check                         | stroke-format reference patterns                            |
| `AnimRef`, `GitNexus`, `reference-vault`, `PhotoMapAI`, `KAssetManager` | check per repo before any salvage | UX/index/semantic reference                                 |
| `hokusai`, `brushlib-wasm`                                              | check (possible copyleft flag)    | Stage 5 brush option - patterns only until license verified |
| `rea` (theCosmicCrafter fork of morluto/rea)                            | MIT                               | verification/forensics tool, not embedded                   |

_Rule: a donor's license is recorded in this file **before** any of its code
lands in `packages/`._
