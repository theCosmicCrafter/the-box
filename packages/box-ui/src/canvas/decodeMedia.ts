// decodeMedia.ts - raster decoders for formats Chromium won't touch.
// Pure functions (ArrayBuffer in, canvas/blob out) so every lane is
// unit-testable; the React wrappers live in previews.tsx.
//
// Coverage rationale (creative-tech corpus):
//   tif/tiff  -> UTIF (mature, tiny)
//   psd/psb   -> ag-psd composite (flattened preview, no layer UI needed)
//   RAW (dng/cr2/nef/arw/rw2/orf/pef/...) -> embedded JPEG inside the
//                TIFF container; a format walk, not a demosaic
//   heic/jxl  -> no maintained pure-JS decoder we will ship; these fall
//                through to the shell-thumbnail lane (WIC codecs do the
//                work the user's OS already owns)
//   cube/3dl  -> LUT parse + gradient strip

/** TIFF-based RAW: pull the largest embedded JPEG preview. */
export function extractRawJpeg(buf: ArrayBuffer): Blob | null {
  const dv = new DataView(buf);
  if (dv.byteLength < 8) return null;
  // endian mark: "II" little, "MM" big (DNG/NEF/CR2 are TIFF-family)
  const le = dv.getUint16(0) === 0x4949;
  if (!le && dv.getUint16(0) !== 0x4d4d) return null;
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) return null;

  // IFD entries: tag(2) type(2) count(4) value/offset(4)
  const readIfd = (
    off: number,
    depth: number,
    out: { off: number; len: number }[],
    seen: Set<number>,
  ): void => {
    if (depth > 6 || off <= 0 || off + 2 > dv.byteLength || seen.has(off))
      return;
    seen.add(off);
    const n = u16(off);
    let jpegOff = 0;
    let jpegLen = 0;
    const subIfds: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > dv.byteLength) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const val = e + 8;
      // 0x0201/0x0202 - JPEGInterchangeFormat(+Length), the classic
      // RAW preview pair (also used for TIFF thumbnail IFDs)
      if (tag === 0x0201) jpegOff = u32(val);
      else if (tag === 0x0202) jpegLen = u32(val);
      else if (tag === 0x014a && type === 4)
        // SubIFD chain
        for (let k = 0; k < count && k < 16; k++)
          subIfds.push(u32(u32(val) + k * 4));
      else if (tag === 0x8769 && type === 4)
        subIfds.push(u32(val)); // ExifIFD
      // Some RAWs (ARW/NEF variants) stash the preview under tag
      // 0x2001 (MakerNote-adjacent JPEG blob) - checked by magic below.
      else if (tag === 0x2001 && type === 7 && count > 64) {
        const o = u32(val);
        if (
          o + 2 <= dv.byteLength &&
          dv.getUint8(o) === 0xff &&
          dv.getUint8(o + 1) === 0xd8
        ) {
          jpegOff = o;
          jpegLen = count;
        }
      }
    }
    if (jpegOff > 0 && jpegLen > 0 && jpegOff + jpegLen <= dv.byteLength) {
      // keep it only if it's really JPEG (SOI magic)
      if (dv.getUint8(jpegOff) === 0xff && dv.getUint8(jpegOff + 1) === 0xd8)
        out.push({ off: jpegOff, len: jpegLen });
    }
    for (const s of subIfds) readIfd(s, depth + 1, out, seen);
    // next IFD in the linked list
    const next = off + 2 + n * 12;
    if (next + 4 <= dv.byteLength) readIfd(u32(next), depth + 1, out, seen);
  };

  const found: { off: number; len: number }[] = [];
  readIfd(u32(4), 0, found, new Set());
  if (found.length === 0) return null;
  // largest embedded JPEG wins (thumbs exist at several resolutions)
  found.sort((a, b) => b.len - a.len);
  const j = found[0];
  if (j === undefined) return null;
  return new Blob([buf.slice(j.off, j.off + j.len)], { type: "image/jpeg" });
}

// ---------- LUT parsing (.cube Iridas, .3dl Autodesk) ------------------

export interface ParsedLut {
  title: string;
  size: number; // LUT_3D_SIZE (1 for 1D luts)
  is3d: boolean;
  data: Float32Array; // packed rgb triples, size^3 * 3 (or size*3 for 1D)
}

/** Iridas/Adobe .cube - the Resolve/DaVinci interchange format. */
export function parseCube(text: string): ParsedLut | null {
  let size = 0;
  let title = "";
  let is3d = true;
  const domMin = [0, 0, 0];
  const domMax = [1, 1, 1];
  const rows: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const head = (line.split(/\s+/)[0] ?? "").toUpperCase();
    if (head === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "");
    } else if (head === "LUT_3D_SIZE") {
      size = parseInt(line.split(/\s+/)[1] ?? "", 10);
      is3d = true;
    } else if (head === "LUT_1D_SIZE") {
      size = parseInt(line.split(/\s+/)[1] ?? "", 10);
      is3d = false;
    } else if (head === "DOMAIN_MIN") {
      line
        .split(/\s+/)
        .slice(1, 4)
        .forEach((v, i) => (domMin[i] = parseFloat(v)));
    } else if (head === "DOMAIN_MAX") {
      line
        .split(/\s+/)
        .slice(1, 4)
        .forEach((v, i) => (domMax[i] = parseFloat(v)));
    } else if (/^-?[\d.eE+]/.test(line)) {
      const t = line.split(/\s+/).map(parseFloat);
      if (t.length >= 3 && !t.slice(0, 3).some(Number.isNaN))
        rows.push(t[0]!, t[1]!, t[2]!);
    }
  }
  const need = size > 0 ? (is3d ? size ** 3 : size) : 0;
  if (need === 0 || rows.length < need * 3) return null;
  const data = new Float32Array(rows.slice(0, need * 3));
  // apply domain scaling if the lut declares one
  if (domMin.some((v) => v !== 0) || domMax.some((v) => v !== 1)) {
    for (let i = 0; i < 3; i++) {
      const lo = domMin[i] ?? 0;
      const hi = domMax[i] ?? 1;
      if (hi !== 1 || lo !== 0) {
        for (let k = i; k < data.length; k += 3)
          data[k] = Math.min(hi, Math.max(lo, data[k] ?? 0));
      }
    }
  }
  return { title, size, is3d, data };
}

/**
 * Autodesk/Flame .3dl - no keywords. An optional first line is the shaper
 * mesh (arbitrary count of values); the LUT body is N x N x N RGB triplets
 * in integer range (10-bit 0..1023 common, 16-bit seen in the wild).
 */
export function parse3dl(text: string): ParsedLut | null {
  const rows: number[][] = [];
  let mesh: number[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const t = line
      .split(/\s+/)
      .map(parseFloat)
      .filter((v) => !Number.isNaN(v));
    if (t.length === 0) continue;
    if (rows.length === 0 && mesh === null && t.length !== 3) {
      mesh = t; // shaper mesh line - not a triplet
      continue;
    }
    if (t.length === 3) rows.push(t);
  }
  // a 3-value first line is ambiguous (mesh vs data): prefer all-rows cube,
  // else drop the first row as the mesh
  let size = Math.round(Math.cbrt(rows.length));
  let body = rows;
  if (size < 2 || size ** 3 !== rows.length) {
    body = rows.slice(1);
    size = Math.round(Math.cbrt(body.length));
  }
  if (size < 2 || size ** 3 !== body.length) return null;
  const flat = body.flat();
  const max = Math.max(...flat);
  const scale = max > 4095 ? 65535 : max > 1 ? 1023 : 1;
  const data = new Float32Array(flat.map((v) => v / scale));
  return { title: "", size, is3d: true, data };
}

/** Apply a parsed LUT to a hue+ramp strip; returns canvas pixels. */
export function lutStrip(
  lut: ParsedLut,
  cols: number,
  rowsN: number,
): { w: number; h: number; px: Uint8ClampedArray<ArrayBuffer> } {
  const w = cols;
  const h = rowsN;
  const px = new Uint8ClampedArray(w * h * 4);
  const n = lut.size;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const sample3d = (
    r: number,
    g: number,
    b: number,
  ): [number, number, number] => {
    const fr = r * (n - 1);
    const fg = g * (n - 1);
    const fb = b * (n - 1);
    const r0 = Math.floor(fr);
    const g0 = Math.floor(fg);
    const b0 = Math.floor(fb);
    const r1 = Math.min(n - 1, r0 + 1);
    const g1 = Math.min(n - 1, g0 + 1);
    const b1 = Math.min(n - 1, b0 + 1);
    const tr = fr - r0;
    const tg = fg - g0;
    const tb = fb - b0;
    const at = (ri: number, gi: number, bi: number, c: number) =>
      lut.data[(bi * n * n + gi * n + ri) * 3 + c] ?? 0;
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const c00 = lerp(at(r0, g0, b0, c), at(r1, g0, b0, c), tr);
      const c10 = lerp(at(r0, g1, b0, c), at(r1, g1, b0, c), tr);
      const c01 = lerp(at(r0, g0, b1, c), at(r1, g0, b1, c), tr);
      const c11 = lerp(at(r0, g1, b1, c), at(r1, g1, b1, c), tr);
      out[c] = lerp(lerp(c00, c10, tg), lerp(c01, c11, tg), tb);
    }
    return out;
  };
  const sample1d = (v: number, c: number) => {
    const f = v * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = f - i0;
    return lerp(lut.data[i0 * 3 + c] ?? 0, lut.data[i1 * 3 + c] ?? 0, t);
  };
  // input ramp: hue sweep across x (full sat), value down y - the
  // "printer test strip" that makes any LUT legible at a glance.
  const hsv = (
    hDeg: number,
    s: number,
    v: number,
  ): [number, number, number] => {
    const c = v * s;
    const x = c * (1 - Math.abs(((hDeg / 60) % 2) - 1));
    const m = v - c;
    const seg = Math.floor(hDeg / 60) % 6;
    const base: [number, number, number] =
      seg === 0
        ? [c, x, 0]
        : seg === 1
          ? [x, c, 0]
          : seg === 2
            ? [0, c, x]
            : seg === 3
              ? [0, x, c]
              : seg === 4
                ? [x, 0, c]
                : [c, 0, x];
    return [base[0] + m, base[1] + m, base[2] + m];
  };
  for (let y = 0; y < h; y++) {
    const v = 1 - y / (h - 1); // top bright -> bottom dark
    for (let x = 0; x < w; x++) {
      const [r, g, b] = hsv((x / (w - 1)) * 360, 0.85, v);
      const [or, og, ob] = lut.is3d
        ? sample3d(r, g, b)
        : [sample1d(r, 0), sample1d(g, 1), sample1d(b, 2)];
      const i = (y * w + x) * 4;
      px[i] = Math.min(255, Math.max(0, or * 255));
      px[i + 1] = Math.min(255, Math.max(0, og * 255));
      px[i + 2] = Math.min(255, Math.max(0, ob * 255));
      px[i + 3] = 255;
    }
  }
  return { w, h, px };
}
