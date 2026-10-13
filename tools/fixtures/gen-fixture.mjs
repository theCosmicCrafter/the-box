// SPDX-License-Identifier: LicenseRef-Proprietary
// Fixture workspace generator - creates a small valid Box workspace on disk.
// Usage: node tools/fixtures/gen-fixture.mjs <target-dir>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/fixtures/gen-fixture.mjs <target-dir>");
  process.exit(1);
}

const EDGE = "7f3a9c2b1d4e5f6a";

// Minimal PNG encoder - a gradient so image previews actually render.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y, w, h);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
// Warm dusk gradient with a diagonal band - visibly an image, not a box.
const PNG = png(320, 200, (x, y, w, h) => [
  Math.round(40 + 120 * (x / w)),
  Math.round(60 + 40 * (y / h)),
  Math.round(90 + (Math.abs(x - y) < 30 ? 120 : 0)),
  255,
]);

const board = {
  "box-format": "box.canvas/1",
  nodes: [
    {
      id: "n-aaa111",
      type: "file",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      file: "img/concept.png",
      "box-placement": { "2d": { x: 0, y: 0, w: 200, h: 150 }, "3d": null },
    },
    {
      id: "n-bbb222",
      type: "file",
      x: 320,
      y: 0,
      width: 200,
      height: 150,
      file: "notes/faction-a.md",
      "box-placement": { "2d": { x: 320, y: 0, w: 200, h: 150 }, "3d": null },
    },
  ],
  edges: [
    {
      id: EDGE,
      fromNode: "n-aaa111",
      toNode: "n-bbb222",
      toEnd: "arrow",
      "box-link": `link-${EDGE}.md`,
    },
  ],
};

const note = `---
box-edge: ${EDGE}
box-format: box.link/1
from: n-aaa111
to: n-bbb222
board: main.box.canvas
from-file: img/concept.png
to-file: notes/faction-a.md
type: inspired-by
created: 2026-10-12T14:31:00Z
---

This armor concept is the visual basis for Faction A's rank insignia.
`;

mkdirSync(join(target, ".box"), { recursive: true });
mkdirSync(join(target, "img"), { recursive: true });
mkdirSync(join(target, "notes"), { recursive: true });
writeFileSync(join(target, "img", "concept.png"), PNG);
writeFileSync(
  join(target, "notes", "faction-a.md"),
  "# Faction A\n\nRank insignia sketches and lore.\n",
);
writeFileSync(
  join(target, "notes", "unplaced.md"),
  "# Unplaced note\n\nThis file has no placement record yet.\n",
);
writeFileSync(
  join(target, ".box", "main.box.canvas"),
  JSON.stringify(board, null, 2) + "\n",
);
writeFileSync(join(target, `link-${EDGE}.md`), note);
writeFileSync(join(target, ".box", "tombstones.json"), "[]\n");
console.log(`fixture workspace written to ${target}`);
