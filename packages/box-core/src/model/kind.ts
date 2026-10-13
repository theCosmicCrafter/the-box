// SPDX-License-Identifier: LicenseRef-Proprietary
// fileKind - extension to presentation-kind mapping. Every file that lands
// in the workspace must be presentable on canvas: native previews where
// the platform renders them (img/video/audio/pdf-embed/font-face/text),
// a typed tile (ext badge + size) everywhere else. Eagle previews fonts
// and documents; Heptabase has per-family card kinds - same idea, one
// table. The "box-media" node key stays the escape hatch when an
// extension lies.

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "csv"
  | "board"
  | "font"
  | "text"
  | "archive"
  | "model3d"
  | "document"
  | "other";

const BY_EXT: Record<string, FileKind> = {
  // raster + vector images: svg renders through <img> natively
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  avif: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  ico: "image",
  svg: "image",
  // video/audio the browser decodes
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  opus: "audio",
  pdf: "pdf",
  csv: "csv",
  tsv: "csv",
  // FontFace API previews - the Eagle behavior artists expect
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  // readable text: prose, code, config, logs
  md: "text",
  txt: "text",
  markdown: "text",
  rst: "text",
  org: "text",
  tex: "text",
  json: "text",
  jsonc: "text",
  js: "text",
  mjs: "text",
  cjs: "text",
  ts: "text",
  tsx: "text",
  jsx: "text",
  css: "text",
  scss: "text",
  less: "text",
  html: "text",
  htm: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  ini: "text",
  cfg: "text",
  conf: "text",
  log: "text",
  env: "text",
  sh: "text",
  bat: "text",
  ps1: "text",
  py: "text",
  rb: "text",
  rs: "text",
  go: "text",
  java: "text",
  c: "text",
  h: "text",
  cpp: "text",
  hpp: "text",
  cs: "text",
  sql: "text",
  lua: "text",
  ipynb: "text",
  // containers and binaries that get typed tiles, not bytes
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  xz: "archive",
  obj: "model3d",
  gltf: "model3d",
  glb: "model3d",
  fbx: "model3d",
  stl: "model3d",
  ply: "model3d",
  blend: "model3d",
  doc: "document",
  docx: "document",
  rtf: "document",
  odt: "document",
  epub: "document",
  psd: "document",
  ai: "document",
  kra: "document",
  procreate: "document",
  xcf: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  pages: "document",
  numbers: "document",
  key: "document",
};

/**
 * Presentation kind for a workspace-relative path. ".box.canvas" wins
 * before extension lookup (a board is its own kind, not "text" from .md-
 * like parsing or "other"). Unknown or missing extensions are "other".
 */
export function fileKind(path: string): FileKind {
  if (path.endsWith(".box.canvas")) return "board";
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return "other";
  return BY_EXT[path.slice(dot + 1).toLowerCase()] ?? "other";
}
