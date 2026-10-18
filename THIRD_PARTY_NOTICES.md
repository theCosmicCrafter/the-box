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

| our file                                                                                                         | source                                 | source license    | adapted                                                                                                                                     | left out                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri/src/lib.rs` (`rename_with_retry`, `is_transient_lock`, fsync ordering in `write_atomic`) | `storytold/craft-libs` `crates/atomic` | Apache-2.0 OR MIT | Windows rename retry with exponential backoff on sharing/lock violations; sync_file < rename durability ordering; failed-rename tmp cleanup | trait/fault-injection layer, permission modes, symlink resolution, dir sync (Unix), WASM stubs |

## Candidate donors already surveyed (pre-register, for reference)

| source                                                                      | license                               | intended use                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `obsidian-master-control-mcp` (canvas.py, canvas_operations.py)             | ours (local project)                  | port node/edge model, 14 ops, helpers → `box-core`                                                     |
| `CanvasMCPClient` frontend slices                                           | ours (local project)                  | port camera/selection logic → `box-ui`                                                                 |
| `perfect-freehand` 1.2.3                                                    | MIT                                   | dependency (pinned), ink strokes                                                                       |
| `Lorien-main`                                                               | TBD-check                             | stroke-format reference patterns                                                                       |
| `AnimRef`, `GitNexus`, `reference-vault`, `PhotoMapAI`, `KAssetManager`     | check per repo before any salvage     | UX/index/semantic reference                                                                            |
| `hokusai`, `brushlib-wasm`                                                  | check (possible copyleft flag)        | Stage 5 brush option - patterns only until license verified                                            |
| `storytold/craft-libs` (`atomic`, `settings`, `cms` crates)                 | Apache-2.0 OR MIT                     | atomic-write hardening (ported); settings recovery pattern (`move_aside`, `.bak`) adopted as reference |
| `storytold/vectorcraft` (`brush`, `svg`, `pathops` crates)                  | Apache-2.0                            | donor candidates: WASM brush engine (Stage 5), stroke-split erase, richer .ink.svg ops                 |
| `storytold/figcraft` (`engine`, `geom` crates)                              | Apache-2.0 OR MIT                     | canvas/selection reference (egui model - patterns only)                                                |
| `rea` (theCosmicCrafter fork of morluto/rea)                                | MIT                                   | verification/forensics tool, not embedded                                                              |
| `basis_transcoder.js/.wasm` (vendored from `three/examples/jsm/libs/basis`) | Apache-2.0 (Basis) + MIT (three shim) | KTX2 texture decode runtime, served from `apps/desktop/src/renderer/public/basis/`                     |
| `utif` 3.1.0                                                                | MIT                                   | dependency (pinned), TIFF decode -> node previews                                                      |
| `ag-psd` 31.0.3                                                             | MIT                                   | dependency (pinned), PSD/PSB composite -> node previews                                                |

_Rule: a donor's license is recorded in this file **before** any of its code
lands in `packages/`._
