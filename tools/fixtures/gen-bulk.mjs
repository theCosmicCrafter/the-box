// SPDX-License-Identifier: LicenseRef-Proprietary
// Bulk fixture generator - NFR-03/04 scale targets.
//   node tools/fixtures/gen-bulk.mjs <target-dir> [files=5000] [nodes=500]
// Creates <files> mixed user files across nested dirs plus a <nodes>-node
// board (.box/main.box.canvas) with a sparse edge set + matching link notes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const target = process.argv[2];
const FILE_COUNT = Number(process.argv[3] ?? 5000);
const NODE_COUNT = Number(process.argv[4] ?? 500);
if (!target) {
  console.error(
    "usage: node tools/fixtures/gen-bulk.mjs <target-dir> [files] [nodes]",
  );
  process.exit(1);
}

// Tiny valid PNG (reused buffer - perf fixtures don't need unique pixels).
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
const PNG1 = (() => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 0);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0, 60, 90, 140, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})();

const KINDS = [
  ["md", (i) => `# Note ${i}\n\nBody text for fixture file ${i}.\n`],
  ["txt", (i) => `fixture text ${i}\n`],
  ["png", () => PNG1],
  ["json", (i) => JSON.stringify({ i, kind: "fixture" }) + "\n"],
  ["csv", (i) => `a,b,c\n${i},${i + 1},${i + 2}\n`],
];
const DIRS = [
  "notes",
  "assets/img",
  "assets/data",
  "world/factions",
  "world/places",
  "refs",
];

const hex = (n) => n.toString(16).padStart(16, "0").slice(-16);
const placed = [];
const nodes = [];
const edges = [];
const notes = [];

mkdirSync(join(target, ".box"), { recursive: true });

for (let i = 0; i < FILE_COUNT; i++) {
  const dir = DIRS[i % DIRS.length];
  const [ext, make] = KINDS[i % KINDS.length];
  const rel = `${dir}/f${i}.${ext}`;
  mkdirSync(join(target, dir), { recursive: true });
  writeFileSync(join(target, rel), make(i));
  if (ext === "md" && placed.length < NODE_COUNT) {
    placed.push(rel);
    const col = placed.length % 25;
    const row = Math.floor(placed.length / 25);
    const [x, y, w, h] = [col * 300, row * 240, 260, 200];
    const id = `n-${hex(i).slice(-10)}`;
    nodes.push({
      id,
      type: "file",
      x,
      y,
      width: w,
      height: h,
      file: rel,
      "box-placement": { "2d": { x, y, w, h }, "3d": null },
    });
  }
}

// Sparse edge set: ~40% of nodes get one forward edge each.
const edgeCount = Math.floor(nodes.length * 0.4);
for (let e = 0; e < edgeCount; e++) {
  const from = nodes[e].id;
  const to = nodes[nodes.length - 1 - e].id;
  const eid = hex(e + 1);
  edges.push({
    id: eid,
    fromNode: from,
    toNode: to,
    toEnd: "arrow",
    "box-link": `link-${eid}.md`,
  });
  notes.push(
    `---\nbox-edge: "${eid}"\nbox-format: box.link/1\nfrom: ${from}\nto: ${to}\nboard: main.box.canvas\nfrom-file: ${nodes[e].file}\nto-file: ${nodes[nodes.length - 1 - e].file}\ncreated: 2026-10-13T00:00:00Z\n---\n\nEdge ${e}.\n`,
  );
}
notes.forEach((n, i) =>
  writeFileSync(join(target, `link-${hex(i + 1)}.md`), n),
);
writeFileSync(
  join(target, ".box", "main.box.canvas"),
  JSON.stringify({ "box-format": "box.canvas/1", nodes, edges }, null, 2) +
    "\n",
);
writeFileSync(join(target, ".box", "tombstones.json"), "[]\n");
console.log(
  `bulk fixture: ${FILE_COUNT} files, ${nodes.length} nodes, ${edges.length} edges -> ${target}`,
);
