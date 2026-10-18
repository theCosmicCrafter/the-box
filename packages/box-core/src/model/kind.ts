// SPDX-License-Identifier: LicenseRef-Proprietary
// fileKind - extension to presentation-kind mapping. Every file that lands
// in the workspace must be presentable on canvas: native previews where
// the platform renders them, dedicated presenters for fonts/palettes/
// archives/3D/textures, a typed tile (ext badge + size) everywhere else.
// The table is grounded in Eagle 4.0's real dispatch (app/js/thumbs/
// thumb.js + config.js format lists, verified from the installed app):
// their model-viewer runs o3dv, texture-viewer runs three.js EXR/RGBE
// loaders - we use three.js for both lanes. The "box-media" node key
// stays the escape hatch when an extension lies.

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html"
  | "csv"
  | "board"
  | "font"
  | "palette"
  | "zip"
  | "model3d"
  | "texture"
  | "code"
  | "text"
  | "archive"
  | "document"
  | "raw"
  | "lut"
  | "other";

const BY_EXT: Record<string, FileKind> = {
  // raster + vector images: svg renders through <img> natively.
  // (Eagle's jxl/heic need ImageMagick - Chromium won't decode them.)
  png: "image",
  jpg: "image",
  jpeg: "image",
  jfif: "image",
  jpe: "image",
  webp: "image",
  gif: "image",
  avif: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  ico: "image",
  icns: "image",
  svg: "image",
  // video/audio the browser decodes (Eagle VIDEO_FORMATS/AUDIO_FORMATS)
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mkv: "video",
  avi: "video",
  wmv: "video",
  flv: "video",
  mpg: "video",
  mpeg: "video",
  mts: "video",
  m2ts: "video",
  "3gp": "video",
  f4v: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  opus: "audio",
  weba: "audio",
  pdf: "pdf",
  html: "html",
  htm: "html",
  csv: "csv",
  tsv: "csv",
  // FontFace API previews (Eagle font-viewer equivalent)
  ttf: "font",
  otf: "font",
  ttc: "font",
  otc: "font",
  woff: "font",
  woff2: "font",
  // color palettes - parsed to a swatch strip
  gpl: "palette", // GIMP
  pal: "palette", // JASC-PAL
  hex: "palette", // #rrggbb per line
  ase: "palette", // Adobe Swatch Exchange (binary, parsed in ZipPreview lane? no - PalettePreview fetches bytes)
  // zip-family containers: list contents, and pull embedded thumbnails
  // (kra/procreate/xd/sketch/docx/epub all carry preview images - fflate,
  // the same lib Eagle ships in texture-viewer)
  zip: "zip",
  kra: "zip",
  procreate: "zip",
  xd: "zip",
  sketch: "zip",
  docx: "zip",
  xlsx: "zip",
  pptx: "zip",
  epub: "zip",
  jar: "zip",
  vsdx: "zip",
  xmind: "zip",
  mindnode: "zip",
  odt: "zip",
  // three.js model loaders (Eagle MODEL_FORMATS superset)
  obj: "model3d",
  gltf: "model3d",
  glb: "model3d",
  fbx: "model3d",
  stl: "model3d",
  ply: "model3d",
  dae: "model3d",
  "3ds": "model3d",
  // 3mf/ifc have no maintained three loader -> tile via "other" path? No:
  // keep them model3d, the presenter falls back to a tile on parse fail.
  "3mf": "model3d",
  ifc: "model3d",
  blend: "model3d",
  c4d: "model3d",
  // wider DCC/point-cloud/mocap set - three.js loaders (USD covers
  // usd/usda/usdc/usdz; BVH renders as a skeleton helper)
  usd: "model3d",
  usda: "model3d",
  usdc: "model3d",
  usdz: "model3d",
  pcd: "model3d",
  xyz: "model3d",
  bvh: "model3d",
  lwo: "model3d",
  lwo2: "model3d",
  // GPU textures: three.js EXR/RGBE/TGA/DDS loaders (Eagle texture-viewer)
  exr: "texture",
  hdr: "texture",
  tga: "texture",
  dds: "texture",
  ktx2: "texture",
  // raster formats Chromium can't decode - parsed in the renderer
  // (utif for tiff, ag-psd for psd, embedded-JPEG walk for RAW) or via
  // shell thumbnail (heic/jxl/anything a WIC codec covers)
  psd: "image",
  psb: "image",
  psdt: "image",
  heic: "image",
  heif: "image",
  jxl: "image",
  // color lookup tables (Resolve/Iridas .cube, .3dl, .lut) - parsed to a
  // gradient preview strip
  cube: "lut",
  "3dl": "lut",
  lut: "lut",
  // code gets syntax highlighting; shaders are the reason this kind exists
  glsl: "code",
  frag: "code",
  vert: "code",
  geom: "code",
  comp: "code",
  tesc: "code",
  tese: "code",
  wgsl: "code",
  hlsl: "code",
  fx: "code",
  fxh: "code",
  cginc: "code",
  shader: "code",
  usf: "code",
  js: "code",
  mjs: "code",
  cjs: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  css: "code",
  scss: "code",
  less: "code",
  py: "code",
  rb: "code",
  rs: "code",
  go: "code",
  java: "code",
  kt: "code",
  swift: "code",
  c: "code",
  h: "code",
  cpp: "code",
  hpp: "code",
  cc: "code",
  cs: "code",
  lua: "code",
  r: "code",
  sql: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  bat: "code",
  ps1: "code",
  vue: "code",
  svelte: "code",
  diff: "code",
  patch: "code",
  // readable text: prose, data, config, logs
  md: "text",
  txt: "text",
  markdown: "text",
  rst: "text",
  org: "text",
  tex: "text",
  json: "text",
  jsonc: "text",
  json5: "text",
  jsonl: "text",
  xml: "text",
  plist: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  cfg: "text",
  conf: "text",
  log: "text",
  env: "text",
  properties: "text",
  editorconfig: "text",
  gitignore: "text",
  npmrc: "text",
  dockerfile: "text",
  makefile: "text",
  cmake: "text",
  mk: "text",
  gradle: "text",
  lock: "text",
  ipynb: "text",
  adoc: "text",
  texi: "text",
  po: "text",
  pot: "text",
  srt: "text",
  vtt: "text",
  nfo: "text",
  diz: "text",
  // non-zip archives: typed tiles (zip-family is "zip" above)
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  xz: "archive",
  lz4: "archive",
  zst: "archive",
  // design/office binaries: typed tiles until per-format parsers land
  // (Eagle's psd.js/ai.js/indesign.js/native.js lane)
  doc: "document",
  rtf: "document",
  xls: "document",
  ppt: "document",
  potx: "document",
  key: "document",
  numbers: "document",
  pages: "document",
  // psd/psb/psdt moved to "image" (ag-psd composite decode)
  ai: "document",
  eps: "document",
  indd: "document",
  indt: "document",
  idml: "document",
  cdr: "document",
  clip: "document",
  af: "document",
  afphoto: "document",
  afdesign: "document",
  afpub: "document",
  fig: "document",
  graffle: "document",
  pxd: "document",
  eddx: "document",
  emmx: "document",
  dwg: "document",
  dxf: "document",
  skp: "document",
  // camera RAW (Eagle raw.js extracts the embedded jpeg - deep parser;
  // tile for now)
  raw: "raw",
  dng: "raw",
  cr2: "raw",
  cr3: "raw",
  crw: "raw",
  nef: "raw",
  nrw: "raw",
  arw: "raw",
  orf: "raw",
  mrw: "raw",
  erf: "raw",
  pef: "raw",
  raf: "raw",
  rw2: "raw",
  sr2: "raw",
  srw: "raw",
  x3f: "raw",
  "3fr": "raw",
};

/**
 * Presentation kind for a workspace-relative path. ".box.canvas" wins
 * before extension lookup (a board is its own kind, not "text").
 * Unknown or missing extensions are "other" - the renderer still tries
 * a text sniff on small files before settling for a tile.
 */
export function fileKind(path: string): FileKind {
  // ADR-0009: any *.canvas is a board candidate (".box.canvas" ends
  // ".canvas"); foreign spec files ingest in place on open.
  if (path.endsWith(".canvas")) return "board";
  const base = path.slice(path.lastIndexOf("/") + 1);
  const lower = base.toLowerCase();
  // extensionless well-known text files (Dockerfile, Makefile, LICENSE...)
  const dot = lower.lastIndexOf(".");
  const ext = dot <= 0 ? lower : lower.slice(dot + 1);
  const byExt = BY_EXT[ext];
  if (byExt !== undefined) return byExt;
  if (dot < 0) {
    // no dot at all: known basenames read as text
    if (
      lower === "dockerfile" ||
      lower === "makefile" ||
      lower === "license" ||
      lower === "readme" ||
      lower === "changelog"
    )
      return "text";
    return "other";
  }
  return "other";
}
