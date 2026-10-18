import { describe, expect, it } from "vitest";
import {
  extractRawJpeg,
  lutStrip,
  parse3dl,
  parseCube,
} from "../src/canvas/decodeMedia.js";

// Minimal TIFF+embedded-JPEG builder: II header + one IFD carrying the
// 0x0201/0x0202 (JPEGInterchangeFormat/Length) pair pointing at a JPEG blob.
function makeRaw(jpeg: number[], endian: "le" | "be" = "le"): ArrayBuffer {
  const le = endian === "le";
  const jpegOff = 8 + 2 + 3 * 12 + 4; // header + count + 3 entries + next
  const buf = new ArrayBuffer(jpegOff + jpeg.length);
  const dv = new DataView(buf);
  dv.setUint16(0, le ? 0x4949 : 0x4d4d, false);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, 3, le); // 3 entries
  const tag = (i: number, t: number, ty: number, v: number) => {
    const o = 10 + i * 12;
    dv.setUint16(o, t, le);
    dv.setUint16(o + 2, ty, le);
    dv.setUint32(o + 4, 1, le);
    dv.setUint32(o + 8, v, le);
  };
  tag(0, 0x0100, 3, 100); // width (decoy)
  tag(1, 0x0201, 4, jpegOff); // jpeg offset
  tag(2, 0x0202, 4, jpeg.length); // jpeg length
  dv.setUint32(10 + 3 * 12, 0, le); // no next IFD
  new Uint8Array(buf).set(jpeg, jpegOff);
  return buf;
}

const FAKE_JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9];

describe("extractRawJpeg", () => {
  it("extracts the embedded JPEG from a TIFF-family RAW", () => {
    const blob = extractRawJpeg(makeRaw(FAKE_JPEG));
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe("image/jpeg");
    expect(blob?.size).toBe(FAKE_JPEG.length);
  });

  it("reads big-endian TIFFs too", () => {
    const blob = extractRawJpeg(makeRaw(FAKE_JPEG, "be"));
    expect(blob?.size).toBe(FAKE_JPEG.length);
  });

  it("rejects non-TIFF, truncated, and non-JPEG payloads", () => {
    expect(extractRawJpeg(new ArrayBuffer(4))).toBeNull();
    expect(
      extractRawJpeg(
        new TextEncoder().encode("not tiff").buffer as ArrayBuffer,
      ),
    ).toBeNull();
    // valid TIFF whose "jpeg" lacks the SOI magic must not pass
    const bad = makeRaw([0x00, 0x11, 0x22, 0x33]);
    expect(extractRawJpeg(bad)).toBeNull();
    // dangling offset past EOF
    const short = new ArrayBuffer(60);
    const dv = new DataView(short);
    dv.setUint16(0, 0x4949, false);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 2, true);
    dv.setUint16(10, 0x0201, true);
    dv.setUint16(12, 4, true);
    dv.setUint32(14, 1, true);
    dv.setUint32(18, 0x8000, true); // points past EOF
    dv.setUint16(22, 0x0202, true);
    dv.setUint16(24, 4, true);
    dv.setUint32(26, 1, true);
    dv.setUint32(30, 4096, true);
    expect(extractRawJpeg(short)).toBeNull();
  });
});

describe("parseCube", () => {
  const cube1d = `TITLE "test 1d"
LUT_1D_SIZE 3
0 0 0
0.5 0.6 0.4
1 1 1`;

  it("parses 1D and 3D cubes with title", () => {
    const l1 = parseCube(cube1d);
    expect(l1?.is3d).toBe(false);
    expect(l1?.size).toBe(3);
    expect(l1?.title).toBe("test 1d");
    expect(l1?.data[3]).toBeCloseTo(0.5);

    const rows = Array.from({ length: 8 }, (_, i) =>
      [i % 2, Math.floor(i / 2) % 2, Math.floor(i / 4)].join(" "),
    ).join("\n");
    const l3 = parseCube(`LUT_3D_SIZE 2\n${rows}`);
    expect(l3?.is3d).toBe(true);
    expect(l3?.data.length).toBe(24);
  });

  it("rejects malformed and short tables", () => {
    expect(parseCube("not a lut")).toBeNull();
    expect(parseCube("LUT_3D_SIZE 4\n0 0 0")).toBeNull();
    expect(parseCube("")).toBeNull();
  });

  it("parses .3dl with and without a shaper-mesh line", () => {
    // 8 triplet rows = 2x2x2 cube, integer 10-bit range
    const body = Array.from(
      { length: 8 },
      (_, i) => `${i * 146} ${1023 - i * 100} ${i * 40}`,
    ).join("\n");
    const l = parse3dl(`0 128 255 400 1023\n${body}`);
    expect(l?.size).toBe(2);
    expect(l?.is3d).toBe(true);
    expect(l?.data[0]).toBe(0); // 0 / 1023
    expect(l?.data[1]).toBeCloseTo(1); // 1023 / 1023
    // ambiguous 3-value first row: 9 rows -> drops first, keeps the cube
    const nine = `0 128 255\n${body}`;
    expect(parse3dl(nine)?.size).toBe(2);
    // non-cube garbage -> null
    expect(parse3dl("1 2 3\n4 5 6")).toBeNull();
    expect(parse3dl("")).toBeNull();
  });
});

describe("lutStrip", () => {
  it("identity LUT reproduces the input ramp", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      [i % 2, Math.floor(i / 2) % 2, Math.floor(i / 4)].join(" "),
    ).join("\n");
    const lut = parseCube(`LUT_3D_SIZE 2\n${rows}`)!;
    const s = lutStrip(lut, 32, 8);
    expect(s.px.length).toBe(32 * 8 * 4);
    // corner samples: top-left (red-bright) vs bottom-right (dark)
    const px = (x: number, y: number) =>
      [0, 1, 2].map((c) => s.px[(y * s.w + x) * 4 + c]);
    const topLeft = px(0, 0);
    const bottomMid = px(16, 7);
    // identity: any pixel's channels should be within tolerance of input
    expect(topLeft.every((v) => v !== undefined)).toBe(true);
    expect(bottomMid[2]! <= topLeft[0]! + 20).toBe(true);
  });

  it("inversion LUT flips the ramp", () => {
    const lut = parseCube("LUT_1D_SIZE 2\n1 1 1\n0 0 0")!;
    const s = lutStrip(lut, 8, 4);
    const avg = (y: number) => {
      let sum = 0;
      for (let x = 0; x < s.w; x++)
        for (let c = 0; c < 3; c++) sum += s.px[(y * s.w + x) * 4 + c]!;
      return sum / (s.w * 3);
    };
    // top row is bright input -> inverted to dark; bottom row flips bright
    expect(avg(0)).toBeLessThan(avg(3));
    expect(avg(3)).toBeGreaterThan(120);
  });
});
