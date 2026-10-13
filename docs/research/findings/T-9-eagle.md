# T-9 - Eagle (asset manager, installed)

|              |                                                             |
| ------------ | ----------------------------------------------------------- |
| **Method**   | eagle-mcp-server code read (local project knows the layout) |
| **Verified** | 2026-10-12                                                  |
| **Status**   | Complete                                                    |

## Findings

1. **Library = folder of item folders** (`library/images/<item_id>.info/`):
   each item is a folder containing the asset file at original name +
   `metadata.json` + a thumbnail. The library is plain folders - readable
   without Eagle running (file-first precedent at scale).
2. **Metadata lives beside the asset** in `metadata.json` - same
   sidecar-adjacent pattern family as our `box-placement` / `.ink.svg`.
3. Eagle exposes a local HTTP API (what eagle-mcp-server wraps) for
   item/library operations - precedent that local apps CAN be
   externally-driven cleanly.

## Adopt vs reject

| adopt                                                                                               | reject                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Per-item container holding asset + metadata + thumb (strong precedent for object = folder-of-files) | `.info` dir per file adds clutter vs our flat+sidecars (ours is cleaner for a creative vault) |
| Local-API-for-agents precedent (box-mcp does this for our boards)                                   | -                                                                                             |

## Implication

Eagle proves the "folder as database" model survives contact with real
asset libraries at scale - tens of thousands of items. Our placement
records + sidecars are the same idea with less nesting.

## Appendix B — Eagle 4.0 preview architecture (verified in installed bundle, C:\Program Files\Eagle\resources\app.asar)

**Thumbnail dispatch** (`app/js/thumbs/thumb.js`): per-extension handler map. Verified entries: images (png/jpg/webp/avif/jxl/gif/bmp/ico/icns/svg/tga/tif/exr/hdr/eps/dds) via dedicated parsers or ImageMagick (`utils/magick.js`); fonts ttf/otf/ttc/otc/woff/woff2 (Typr.js parsing + specimen); 17 camera RAW formats via `raw.js` (embedded jpeg extraction); office doc/xls/ppt + iwork key/numbers/pages via shell converters; design psd/psb/psdt/ai/xd/indd/idml/eps via dedicated extractors; design binaries with no parser (c4d/blend/cdr/clip/af/skp/dwg) via `native.js` = OS-native thumbnails; fig/sketch/graffle via qlmanage (macOS QuickLook); html/url/mhtml via mhtml.js.

**config.js format lists (verbatim)**: VIDEO `ts,3gp,360,afx,vap,eva,mp4,mov,m4v,webm,mkv,avi,wmv,mpg,mts,flv,m2ts,f4v` · AUDIO `mp3,wav,flac,ogg,aac,m4a` · MODEL `glb,obj,fbx,3ds,3mf,dae,ifc,ply,stl` · FONT `ttf,otf,ttc,woff,woff2`.

**3D**: `app/model-viewer/` ships o3dv.website.min.js (Online3DViewer by kovacsv/Storytold) — the same author ships `storytold/figcraft` (clean-room Figma-style canvas in Rust). **Textures**: `app/texture-viewer/` ships `three.min.js` + EXRLoader + RGBELoader + fflate.module.js — our three.js+fflate pairing mirrors it exactly.

**Adopted**: three.js loaders (OBJ/GLTF/GLB/STL/PLY/FBX/DAE/3DS/3MF) → rotating in-node WebGL preview; EXR/HDR/TGA/DDS → tone-mapped texture render; fflate → zip-family (kra/procreate/xd/sketch/docx/xlsx/epub/xmind) embedded-thumbnail extraction + entry listing; palettes (gpl/pal/hex/ase binary parser) → swatch strip; FontFace specimens; WebAudio waveform; sandboxed iframe for html; PDFium iframe for pdf; hand-rolled syntax highlighter (comments/strings/keywords/directives per c-like|hash-comment|sh families) for code+shaders; printable-byte sniff so unknown extensions still excerpt as text. What remains tile-only: jxl/heic (no Chromium decode), camera RAW (Eagle's raw.js extracts embedded jpeg — deep parser, deferred), psd/ai/indd/dwg/cdr (proprietary parsers, deferred).
