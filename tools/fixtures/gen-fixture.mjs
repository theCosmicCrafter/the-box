// SPDX-License-Identifier: LicenseRef-Proprietary
// Fixture workspace generator - creates a small valid Box workspace on disk.
// Usage: node tools/fixtures/gen-fixture.mjs <target-dir>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/fixtures/gen-fixture.mjs <target-dir>");
  process.exit(1);
}

const EDGE = "7f3a9c2b1d4e5f6a";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
