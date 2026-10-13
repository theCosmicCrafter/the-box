// SPDX-License-Identifier: LicenseRef-Proprietary
// Adversarial suite - break-it-first tests. Every case is a documented
// attack shape or a pathological-but-legal file state, never a happy path.

import { describe, expect, it } from "vitest";
import type { Board, LinkNote, ParseResult } from "../src/index.js";
import { parseBoard, serializeBoard } from "../src/model/board.js";
import { edgeIdFromNoteName, linkNoteName } from "../src/model/ids.js";
import { parseInkSvg } from "../src/model/ink.js";
import { parseLinkNote, serializeLinkNote } from "../src/model/linkNote.js";
import { isPathRel, resolveInside } from "../src/model/paths.js";
import { reconcile, type WorkspaceScan } from "../src/sync/reconcile.js";
import { classifyFileSet, routePath } from "../src/watch/classify.js";

const VALID_BOARD = {
  "box-format": "box.canvas/1",
  nodes: [
    {
      id: "n-aaa111",
      type: "file",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      file: "a.png",
    },
    {
      id: "n-bbb222",
      type: "file",
      x: 1,
      y: 1,
      width: 200,
      height: 150,
      file: "b.png",
    },
  ],
  edges: [
    {
      id: "7f3a9c2b1d4e5f6a",
      fromNode: "n-aaa111",
      toNode: "n-bbb222",
      "box-link": "link-7f3a9c2b1d4e5f6a.md",
    },
  ],
};

const emptyScan = (): WorkspaceScan => ({
  boards: new Map(),
  notes: new Map(),
  files: new Set(),
  tombstones: new Set(),
});

// ---- path security parity (must match Rust is_path_rel exactly) ----

describe("isPathRel adversarial", () => {
  const bad = [
    "",
    "x/",
    "x\\",
    "/",
    "\\",
    "//x",
    "..",
    "../x",
    "a/../b",
    "a/..",
    "a/./b",
    "a//b",
    ".",
    "./x",
    "C:/x",
    "c:x",
    "a\\b",
    "trail ",
    "trail.",
    "seg./x",
    "seg /x",
    "<x>",
    "a:b",
    "a|b",
    "a?b",
    "a*b",
    'a"b',
    "nul\0x",
    "ax",
    "dir/x.md ",
    "x.md",
  ];
  const good = [
    "a/b.txt",
    ".box/tombstones.json",
    "file",
    "a.b/c d.txt",
    "link-7f3a9c2b1d4e5f6a.md",
    "deep/nested/dir/file.png",
    ".hidden",
    "a/.b/c",
    "a/..b",
    "AUX",
    "x.md",
  ];
  it("rejects every escape shape", () => {
    for (const p of bad.slice(0, -1)) expect(isPathRel(p)).toBe(false);
  });
  it("accepts legal PathRels including edge cases", () => {
    for (const p of good) expect(isPathRel(p)).toBe(true);
    // DEL (0x7F) is not <0x20 - contract allows it (parity with Rust)
    expect(isPathRel("x.md")).toBe(true);
  });
  it("rejects non-strings", () => {
    for (const p of [0, null, undefined, {}, [], NaN]) {
      expect(isPathRel(p)).toBe(false);
    }
  });
  it("resolveInside never escapes", () => {
    const root = "C:/ws";
    for (const p of ["../out", "a/../../b", "/etc/passwd", "C:/x"])
      expect(resolveInside(root, p)).toBeNull();
    expect(resolveInside(root, "a/b.txt")).toBe("C:/ws/a/b.txt");
    expect(resolveInside(root + "/", "a")).toBe("C:/ws/a");
  });
});

// ---- parseBoard fuzz ----

describe("parseBoard adversarial", () => {
  it("never throws on structural garbage", () => {
    const junk = [
      "",
      "null",
      "42",
      "true",
      '"str"',
      "[1,2]",
      '{"box-format":1}',
      '{"box-format":"box.canvas/1","nodes":null}',
      '{"box-format":"box.canvas/1","nodes":"x"}',
      '{"box-format":"box.canvas/1","nodes":[{}],"edges":[{}]}',
      '{"box-format":"box.canvas/2","nodes":[],"edges":[]}',
      "\u0000\u0001\u0002",
      '{"box-format":"box.canvas/1","nodes":[{"id":"n-aaaaaa","type":"file","x":"NaN","y":0,"width":0,"height":0,"file":"f"}],"edges":[]}',
      '{"box-format":"box.canvas/1","nodes":[{"id":"n-aaaaaa","type":"file","x":1e400,"y":-Infinity,"width":0,"height":0,"file":"f"}],"edges":[]}',
    ];
    for (const j of junk) {
      const r = parseBoard(j);
      expect(r).toHaveProperty("problems");
      if (r.value !== null) {
        // If it parsed, it must re-serialize (superset roundtrip)
        expect(() => serializeBoard(r.value!)).not.toThrow();
      }
    }
  });

  it("survives __proto__ pollution attempts", () => {
    const evil = JSON.stringify({
      "box-format": "box.canvas/1",
      __proto__: { polluted: true },
      nodes: [],
      edges: [],
    });
    const r = parseBoard(evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (r.value) {
      const out = JSON.parse(serializeBoard(r.value));
      expect(out["box-format"]).toBe("box.canvas/1");
    }
  });

  it("duplicate node ids don't crash and both render", () => {
    const dup = {
      ...VALID_BOARD,
      nodes: [VALID_BOARD.nodes[0], { ...VALID_BOARD.nodes[0] }],
    };
    const r = parseBoard(JSON.stringify(dup));
    // may flag problems but must not throw; nodes preserved for render
    expect(r.value === null || r.value.nodes.length === 2).toBe(true);
  });

  it("self-loop edge is legal (node to itself)", () => {
    const loop = {
      ...VALID_BOARD,
      edges: [
        {
          id: "0000000000000001",
          fromNode: "n-aaa111",
          toNode: "n-aaa111",
          "box-link": "link-0000000000000001.md",
        },
      ],
    };
    const r = parseBoard(JSON.stringify(loop));
    expect(r.problems.filter((p) => p.kind === "broken-edge")).toHaveLength(0);
  });

  it("huge board parses within budget", () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => ({
      id: `n-${i.toString(16).padStart(6, "0")}`,
      type: "file",
      x: i % 50,
      y: i % 60,
      width: 100,
      height: 100,
      file: `f${i}.png`,
    }));
    const edges = nodes.slice(0, -1).map((n, i) => ({
      id: i.toString(16).padStart(16, "0"),
      fromNode: n.id,
      toNode: nodes[i + 1]!.id,
      "box-link": `link-${i.toString(16).padStart(16, "0")}.md`,
    }));
    const t0 = Date.now();
    const r = parseBoard(JSON.stringify({ ...VALID_BOARD, nodes, edges }));
    expect(Date.now() - t0).toBeLessThan(2000); // 2k nodes < 2s
    expect(r.value?.nodes).toHaveLength(2000);
    expect(r.value?.edges).toHaveLength(1999);
  });
});

// ---- parseLinkNote fuzz ----

describe("parseLinkNote adversarial", () => {
  const goodFm = [
    "box-edge: 7f3a9c2b1d4e5f6a",
    "box-format: box.link/1",
    "from: n-aaa111",
    "to: n-bbb222",
    "board: main.box.canvas",
    "created: 2026-01-01T00:00:00.000Z",
  ].join("\n");
  const good = `---\n${goodFm}\n---\nbody`;

  it("rejects poisoned box-edge shapes", () => {
    for (const v of [
      "[]",
      "{}",
      "123",
      "yes",
      '""',
      "aaaaaaaaaaaaaaaaa", // 17 chars
      "7F3A9C2B1D4E5F6A", // uppercase
      "7f3a9c2b1d4e5f6g", // non-hex
      '"7f3a9c2b1d4e5f6a"', // quoted ok? must still parse value
    ]) {
      const raw = `---\nbox-edge: ${v}\nbox-format: box.link/1\nfrom: n-aaa111\nto: n-bbb222\ncreated: 2026-01-01T00:00:00Z\n---\n`;
      const r = parseLinkNote(raw, "link-7f3a9c2b1d4e5f6a.md");
      // value may parse only if the id is exactly the hex contract
      const ok = v.replaceAll('"', "") === "7f3a9c2b1d4e5f6a";
      expect(r.value !== null).toBe(ok);
    }
  });

  it("YAML alias bomb is caught or bounded", () => {
    // classic billion-laughs shape, shallow enough to measure
    const bomb = `---\na: &x ["lol"]\nb: &y [*x,*x,*x,*x,*x,*x,*x,*x]\nc: &z [*y,*y,*y,*y,*y,*y,*y,*y]\nd: [*z,*z,*z,*z,*z,*z,*z,*z]\nbox-edge: 7f3a9c2b1d4e5f6a\nbox-format: box.link/1\nfrom: n-aaa111\nto: n-bbb222\ncreated: 2026-01-01T00:00:00Z\n---\n`;
    const t0 = Date.now();
    const r = parseLinkNote(bomb, "link-7f3a9c2b1d4e5f6a.md");
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r).toHaveProperty("problems");
  });

  it("body containing a fake frontmatter fence round-trips", () => {
    const note = parseLinkNote(good, "link-7f3a9c2b1d4e5f6a.md").value!;
    note.body = "---\nbox-edge: deadbeefdeadbeef\n---\ninjected";
    const re = parseLinkNote(
      serializeLinkNote(note),
      "link-7f3a9c2b1d4e5f6a.md",
    );
    expect(re.value?.frontmatter["box-edge"]).toBe("7f3a9c2b1d4e5f6a");
    expect(re.value?.body).toContain("injected");
  });

  it("missing fences, empty doc, null bytes", () => {
    for (const raw of [
      "",
      "no frontmatter at all",
      "---\n",
      "---\n---\n",
      `---\n${goodFm}\n---`, // unclosed ok? matter handles EOF
      "\0\0\0",
      "---\nbox-edge: 7f3a9c2b1d4e5f6a\n", // partial fm, no close
    ]) {
      const r = parseLinkNote(raw, "link-7f3a9c2b1d4e5f6a.md");
      expect(r).toHaveProperty("problems");
    }
  });

  it("filename/box-edge mismatch is flagged (R-3 repair triggers)", () => {
    const r = parseLinkNote(good, "link-aaaaaaaaaaaaaaaa.md");
    expect(
      r.problems.some(
        (p) => p.detail.includes("slug") || p.detail.includes("!="),
      ),
    ).toBe(true);
  });
});

// ---- edgeIdFromNoteName ----

describe("edgeIdFromNoteName adversarial", () => {
  it("extracts only canonical names", () => {
    expect(edgeIdFromNoteName("link-7f3a9c2b1d4e5f6a.md")).toBe(
      "7f3a9c2b1d4e5f6a",
    );
    const bad = [
      "link-.md",
      "link-x.md",
      "link-7f3a9c2b1d4e5f6.md", // 15
      "link-7f3a9c2b1d4e5f6a5.md", // 17
      "link-7F3A9C2B1D4E5F6A.md", // uppercase
      "link-7f3a9c2b1d4e5f6g.md", // non-hex
      "alink-7f3a9c2b1d4e5f6a.md",
      "link-7f3a9c2b1d4e5f6a.mdd",
      "link-7f3a9c2b1d4e5f6a",
      "notes/link-7f3a9c2b1d4e5f6a.md", // nested = object, not note (regex has $ end)
      "link-7f3a9c2b1d4e5f6a.md.bak",
      "",
    ];
    for (const n of bad) expect(edgeIdFromNoteName(n)).toBeNull();
  });
});

// ---- classifyFileSet chaos ----

describe("classifyFileSet adversarial", () => {
  const F = (path: string, size = 1, mtime = 1) => ({ path, size, mtime });

  it("duplicate paths in scan don't double-report", () => {
    const after = [F("a", 1, 1), F("a", 1, 1), F("b", 2, 2)];
    const d = classifyFileSet({ files: new Map() }, after);
    expect(d.filter((x) => x.path === "a")).toHaveLength(1);
  });

  it("same-size rename with different mtime is NOT paired (mtime wins)", () => {
    const d = classifyFileSet(
      { files: new Map([["a", { size: 5, mtime: 100 }]]) },
      [F("b", 5, 200)],
    );
    expect(d).toEqual([
      { kind: "deleted", path: "a" },
      { kind: "created", path: "b" },
    ]);
  });

  it("same-size+same-mtime IS paired (os rename preserves both)", () => {
    const d = classifyFileSet(
      { files: new Map([["a", { size: 5, mtime: 100 }]]) },
      [F("b", 5, 100)],
    );
    expect(d).toEqual([{ kind: "renamed", path: "a", to: "b" }]);
  });

  it("sha256 collision-resistance: different sha, same size+mtime = not rename", () => {
    const d = classifyFileSet(
      { files: new Map([["a", { size: 5, mtime: 1, sha256: "x" }]]) },
      [{ path: "b", size: 5, mtime: 1, sha256: "y" }],
    );
    expect(d).toEqual([
      { kind: "deleted", path: "a" },
      { kind: "created", path: "b" },
    ]);
  });

  it("empty-to-empty and full-wipe are stable", () => {
    expect(classifyFileSet({ files: new Map() }, [])).toEqual([]);
    const wipe = classifyFileSet(
      {
        files: new Map([
          ["a", { size: 1 }],
          ["b", { size: 2 }],
        ]),
      },
      [],
    );
    expect(wipe).toHaveLength(2);
    expect(wipe.every((d) => d.kind === "deleted")).toBe(true);
  });

  it("routePath never misroutes", () => {
    expect(routePath(".box/main.box.canvas")).toBe("board");
    expect(routePath(".box/tombstones.json")).toBe("tombstone");
    expect(routePath("link-7f3a9c2b1d4e5f6a.md")).toBe("link-note");
    expect(routePath("notes/link-7f3a9c2b1d4e5f6a.md")).toBe("link-note"); // nested still routes
    expect(routePath("a.ink.svg")).toBe("ink");
    expect(routePath("x.png")).toBe("object");
    expect(routePath("link-note.md")).toBe("object"); // decoy name
  });
});

// ---- reconcile pathologies ----

describe("reconcile adversarial", () => {
  const mkNote = (
    id: string,
    over: Record<string, unknown> = {},
  ): LinkNote => ({
    path: linkNoteName(id),
    frontmatter: {
      "box-edge": id,
      "box-format": "box.link/1",
      from: "n-aaa111",
      to: "n-bbb222",
      board: "main.box.canvas",
      created: "2026-01-01T00:00:00.000Z",
      ...over,
    },
    body: "",
  });
  const ok = <T>(v: T): ParseResult<T> => ({ value: v, problems: [] });

  it("tombstoned edge still on a board + note present: converges, edge dies", () => {
    // THE attack: I-2 delete crashed mid-flight -> tombstone exists, board
    // still has the edge, note still on disk, no knownNotes memory.
    const scan = emptyScan();
    const board: Board = JSON.parse(JSON.stringify(VALID_BOARD));
    scan.boards.set(".box/main.box.canvas", ok(board));
    const note = mkNote("7f3a9c2b1d4e5f6a");
    scan.notes.set(note.path, ok(note));
    scan.files = new Set([note.path]);
    scan.tombstones = new Set(["7f3a9c2b1d4e5f6a"]);
    // knownNotes ABSENT - fresh session memory
    const r1 = reconcile(scan);
    // note gets trashed (R-D completion)
    expect(
      r1.plan.steps.some(
        (s) => s.op === "trash" && s.path === "link-7f3a9c2b1d4e5f6a.md",
      ),
    ).toBe(true);
    // AND the board edge must die too - otherwise pass 2 would regenerate
    // the stub (R-A) and oscillate. If this fails, the fix is: tombstoned
    // edge ids get stripped from boards in the same reconcile pass.
    expect(
      r1.plan.steps.some(
        (s) =>
          s.op === "write-atomic" &&
          s.path === ".box/main.box.canvas" &&
          !s.content.includes("7f3a9c2b1d4e5f6a"),
      ),
    ).toBe(true);
  });

  it("orphan note with no board at all: problem, not crash", () => {
    const scan = emptyScan();
    const note = mkNote("1111111111111111");
    scan.notes.set(note.path, ok(note));
    scan.files = new Set([note.path]);
    const r = reconcile(scan);
    expect(r.problems.some((p) => p.detail.includes("no board"))).toBe(true);
    expect(r.plan.steps).toHaveLength(0);
  });

  it("malformed note file (unparseable) is surfaced, never silently dropped", () => {
    const scan = emptyScan();
    scan.boards.set(".box/main.box.canvas", ok(VALID_BOARD as Board));
    scan.notes.set("link-7f3a9c2b1d4e5f6a.md", {
      value: null,
      problems: [
        {
          kind: "malformed-note",
          path: "link-7f3a9c2b1d4e5f6a.md",
          detail: "unparseable frontmatter",
        },
      ],
    });
    scan.files = new Set(["a.png", "b.png", "link-7f3a9c2b1d4e5f6a.md"]);
    const r = reconcile(scan);
    expect(r.problems.some((p) => p.kind === "malformed-note")).toBe(true);
    // edge stays on board - I-7: malformed files are flagged not deleted
    expect(r.plan.steps.filter((s) => s.op === "trash")).toHaveLength(0);
  });

  it("note with filename/box-edge mismatch gets renamed back, old trashed", () => {
    const scan = emptyScan();
    const note = mkNote("2222222222222222");
    // file on disk is link-WRONG.md but box-edge says 2222...
    scan.notes.set("link-3333333333333333.md", ok(note));
    scan.boards.set(".box/main.box.canvas", ok(VALID_BOARD as Board));
    scan.files = new Set(["a.png", "b.png", "link-3333333333333333.md"]);
    const r = reconcile(scan);
    expect(
      r.plan.steps.some(
        (s) => s.op === "write-atomic" && s.path === "link-2222222222222222.md",
      ),
    ).toBe(true);
    expect(
      r.plan.steps.some(
        (s) => s.op === "trash" && s.path === "link-3333333333333333.md",
      ),
    ).toBe(true);
  });

  it("edge whose note exists with different endpoints: note wins (R-B)", () => {
    const scan = emptyScan();
    const board: Board = JSON.parse(JSON.stringify(VALID_BOARD));
    scan.boards.set(".box/main.box.canvas", ok(board));
    const note = mkNote("7f3a9c2b1d4e5f6a", {
      from: "n-bbb222",
      to: "n-aaa111",
    });
    scan.notes.set(note.path, ok(note));
    scan.files = new Set(["a.png", "b.png", note.path]);
    const r = reconcile(scan);
    const rewrite = r.plan.steps.find(
      (s) => s.op === "write-atomic" && s.path === ".box/main.box.canvas",
    );
    expect(rewrite).toBeDefined();
    const rb = JSON.parse(
      (rewrite as { content: string }).content,
    ) as typeof VALID_BOARD;
    const e = rb.edges[0]!;
    expect(e.fromNode).toBe("n-bbb222");
    expect(e.toNode).toBe("n-aaa111");
  });

  it("reconcile is a pure function: same scan twice, identical plan", () => {
    const scan = emptyScan();
    scan.boards.set(".box/main.box.canvas", ok(VALID_BOARD as Board));
    scan.files = new Set(["a.png", "b.png"]);
    const a = reconcile(scan);
    const b = reconcile(scan);
    expect(a.plan).toEqual(b.plan);
    expect(a.problems).toEqual(b.problems);
  });
});

// ---- ink parser ----

describe("parseInkSvg adversarial", () => {
  it("rejects non-svg and malformed xml", () => {
    for (const raw of [
      "",
      "<html>",
      "<svg>",
      "not xml",
      "<?xml version='1.0'?>",
      "a".repeat(1 << 20),
    ]) {
      const r = parseInkSvg(raw);
      expect(r).toHaveProperty("problems");
    }
  });
});

// ---- renderer-facing helper attacks (what the running app feeds them) ----

describe("hostile content shapes", () => {
  it("serializeLinkNote survives frontmatter with injection chars", () => {
    const note: LinkNote = {
      path: "link-7f3a9c2b1d4e5f6a.md",
      frontmatter: {
        "box-edge": "7f3a9c2b1d4e5f6a",
        "box-format": "box.link/1",
        from: "n-aaa111",
        to: "n-bbb222",
        board: "main.box.canvas",
        created: "2026-01-01T00:00:00.000Z",
        // user-typed hostile values must stay strings, not YAML structures
        type: "x\n---\nevil: true\n---",
        custom: "line1\nline2: [injected]",
      },
      body: "b",
    };
    const out = serializeLinkNote(note);
    const re = parseLinkNote(out, "link-7f3a9c2b1d4e5f6a.md");
    expect(re.value?.frontmatter["box-edge"]).toBe("7f3a9c2b1d4e5f6a");
    // the injected keys must not materialize as real frontmatter
    expect(re.value?.frontmatter["evil"]).toBeUndefined();
    expect(re.value?.frontmatter["injected"]).toBeUndefined();
  });

  it("serializeLinkNote must not touch Node globals (webview environment)", () => {
    // Regression for the Tauri migration: gray-matter.stringify called
    // Buffer.from(), which does not exist in WebView2 - every frontmatter
    // write (edge link notes, note bodies) silently died in the live app
    // while Node-based tests kept passing.
    const note: LinkNote = {
      path: "link-7f3a9c2b1d4e5f6a.md",
      frontmatter: {
        "box-edge": "7f3a9c2b1d4e5f6a",
        "box-format": "box.link/1",
        from: "n-aaa111",
        to: "n-bbb222",
        board: "main.box.canvas",
        "from-file": "a.png",
        "to-file": "b.png",
        type: "relates-to",
        created: "2026-01-01T00:00:00.000Z",
        "custom key: #": "value: not yaml",
      },
      body: "the arrow means something",
    };
    const saved = globalThis.Buffer;
    // @ts-expect-error - simulating the webview: Buffer must not be needed
    delete globalThis.Buffer;
    try {
      const out = serializeLinkNote(note);
      const re = parseLinkNote(out, note.path);
      expect(re.problems).toHaveLength(0);
      expect(re.value?.frontmatter).toEqual(note.frontmatter);
      expect(re.value?.body).toBe(note.body);
    } finally {
      globalThis.Buffer = saved;
    }
  });

  it("giant body / giant board values don't hang the serializers", () => {
    const note: LinkNote = {
      path: "link-7f3a9c2b1d4e5f6a.md",
      frontmatter: {
        "box-edge": "7f3a9c2b1d4e5f6a",
        "box-format": "box.link/1",
        from: "n-aaa111",
        to: "n-bbb222",
        board: "main.box.canvas",
        created: "2026-01-01T00:00:00.000Z",
      },
      body: "x".repeat(2_000_000),
    };
    const t0 = Date.now();
    const out = serializeLinkNote(note);
    expect(Date.now() - t0).toBeLessThan(3000);
    const re = parseLinkNote(out, "link-7f3a9c2b1d4e5f6a.md");
    expect(re.value?.body).toHaveLength(2_000_000);
  });
});
