// SPDX-License-Identifier: LicenseRef-Proprietary
// Board parser/serializer tests - DATA-MODEL §2 + formats gate.

import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "../src/model/board.js";

const MINIMAL = {
  "box-format": "box.canvas/1",
  nodes: [
    {
      id: "n-a1b2c3",
      type: "file",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      file: "img/a.png",
    },
    {
      id: "n-d4e5f6",
      type: "file",
      x: 300,
      y: 0,
      width: 200,
      height: 150,
      file: "img/b.png",
    },
  ],
  edges: [
    {
      id: "7f3a9c2b1d4e5f6a",
      fromNode: "n-a1b2c3",
      toNode: "n-d4e5f6",
      "box-link": "link-7f3a9c2b1d4e5f6a.md",
    },
  ],
};

describe("parseBoard", () => {
  it("parses a minimal valid board", () => {
    const r = parseBoard(JSON.stringify(MINIMAL), ".box/main.box.canvas");
    expect(r.value).not.toBeNull();
    expect(r.problems).toEqual([]);
    expect(r.value?.nodes).toHaveLength(2);
  });

  it("tolerates and preserves unknown keys (superset contract)", () => {
    const withExtras = {
      ...MINIMAL,
      "box-placement-test": { a: 1 },
      "custom-plugin-key": "preserve me",
    };
    const r = parseBoard(JSON.stringify(withExtras));
    expect(r.value?.["custom-plugin-key"]).toBe("preserve me");
    const out = JSON.parse(serializeBoard(r.value!));
    expect(out["custom-plugin-key"]).toBe("preserve me");
    expect(out["box-format"]).toBe("box.canvas/1");
  });

  it("returns problems, never throws, on garbage", () => {
    expect(parseBoard("{{{").value).toBeNull();
    expect(parseBoard("[]").value).toBeNull();
    expect(
      parseBoard("{}").problems.some((p) => p.detail.includes("box-format")),
    ).toBe(true);
  });

  it("flags dangling edge node refs as broken, not malformed", () => {
    const bad = {
      ...MINIMAL,
      edges: [
        {
          id: "7f3a9c2b1d4e5f6a",
          fromNode: "n-nope",
          toNode: "n-d4e5f6",
          "box-link": "link-7f3a9c2b1d4e5f6a.md",
        },
      ],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.kind === "broken-edge")).toBe(true);
  });

  it("flags box-link mismatch", () => {
    const bad = {
      ...MINIMAL,
      edges: [{ ...MINIMAL.edges[0]!, "box-link": "link-deadbeefdeadbeef.md" }],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.detail.includes("box-link"))).toBe(true);
  });

  it("rejects non-PathRel file fields", () => {
    const bad = {
      ...MINIMAL,
      nodes: [{ ...MINIMAL.nodes[0]!, file: "../escape.png" }],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.detail.includes("PathRel"))).toBe(true);
  });
});

describe("serializeBoard", () => {
  it("round-trips a parsed board byte-for-field", () => {
    // Serialization adds box-placement (writers emit both coord forms), so
    // the fixed point is the SECOND round: parse -> write -> parse -> write
    // -> parse must be identical.
    const r1 = parseBoard(
      serializeBoard(parseBoard(JSON.stringify(MINIMAL)).value!),
    );
    const r2 = parseBoard(serializeBoard(r1.value!));
    expect(r2.value?.nodes).toEqual(r1.value?.nodes);
    expect(r2.value?.edges).toEqual(r1.value?.edges);
  });
});

describe("box-placement (DATA-MODEL §2.6, FR-113)", () => {
  it("serialize emits box-placement.2d equal to spec coords, 3d null", () => {
    const out = JSON.parse(
      serializeBoard(parseBoard(JSON.stringify(MINIMAL)).value!),
    );
    const p = out.nodes[0]["box-placement"];
    expect(p["2d"]).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    expect(p["3d"]).toBeNull();
  });

  it("serialize tracks coords after a move and preserves z + 3d + unknown keys", () => {
    const r = parseBoard(JSON.stringify(MINIMAL)).value!;
    const n = r.nodes[0]!;
    n.x = 55;
    n.y = -10;
    n["box-placement"] = {
      "2d": { x: 0, y: 0, w: 200, h: 150, z: 3 },
      "3d": { x: 1, y: 2, z: 3 },
      "future-key": { keep: true },
    };
    const out = JSON.parse(serializeBoard(r));
    const p = out.nodes[0]["box-placement"];
    expect(p["2d"]).toEqual({ x: 55, y: -10, w: 200, h: 150, z: 3 });
    expect(p["3d"]).toEqual({ x: 1, y: 2, z: 3 });
    expect(p["future-key"]).toEqual({ keep: true });
  });

  it("parse prefers box-placement.2d over spec coords", () => {
    const b = {
      ...MINIMAL,
      nodes: [
        {
          ...MINIMAL.nodes[0]!,
          x: 1,
          y: 1,
          "box-placement": {
            "2d": { x: 700, y: 800, w: 90, h: 60 },
            "3d": null,
          },
        },
      ],
      edges: [],
    };
    const r = parseBoard(JSON.stringify(b));
    const n = r.value!.nodes[0]!;
    expect([n.x, n.y, n.width, n.height]).toEqual([700, 800, 90, 60]);
  });

  it("malformed placement reports a problem and leaves spec coords alone", () => {
    const b = {
      ...MINIMAL,
      nodes: [{ ...MINIMAL.nodes[0]!, "box-placement": "oops" }],
      edges: [],
    };
    const r = parseBoard(JSON.stringify(b));
    expect(r.problems.some((p) => p.detail.includes("box-placement"))).toBe(
      true,
    );
    expect(r.value!.nodes[0]!.x).toBe(0);
  });
});
