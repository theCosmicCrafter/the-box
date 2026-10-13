// SPDX-License-Identifier: LicenseRef-Proprietary
// Format round-trip tests - the "test:formats" gate. Every durable format
// parses, serializes, and re-parses identically.

import { describe, it, expect } from "vitest";
import { parseLinkNote, serializeLinkNote } from "../src/model/linkNote.js";
import { parseInkSvg, serializeInkSvg } from "../src/model/ink.js";
import { serializeBoard, parseBoard } from "../src/model/board.js";
import {
  edgeIdFromNoteName,
  linkNoteName,
  newEdgeId,
  isEdgeId,
} from "../src/model/ids.js";

const EDGE = "7f3a9c2b1d4e5f6a";
const NOTE_MD = `---
box-edge: ${EDGE}
box-format: box.link/1
from: n-abc123
to: n-def456
from-file: img/a.png
to-file: notes/b.md
type: inspired-by
created: 2026-10-12T14:31:00Z
---

This armor concept is the visual basis for the insignia.
`;

describe("formats: link note", () => {
  it("parses the contract example", () => {
    const r = parseLinkNote(NOTE_MD, `link-${EDGE}.md`);
    expect(r.value).not.toBeNull();
    expect(r.problems).toEqual([]);
    expect(r.value?.frontmatter["box-edge"]).toBe(EDGE);
    expect(r.value?.body).toContain("armor concept");
  });

  it("round-trips preserving frontmatter and body", () => {
    const r = parseLinkNote(NOTE_MD, `link-${EDGE}.md`).value!;
    const again = parseLinkNote(serializeLinkNote(r), `link-${EDGE}.md`).value!;
    expect(again.frontmatter).toEqual(r.frontmatter);
    expect(again.body.trim()).toBe(r.body.trim());
  });

  it("preserves unknown frontmatter keys", () => {
    const withUserKey = NOTE_MD.replace("created:", "mood: amber\ncreated:");
    const r = parseLinkNote(withUserKey, `link-${EDGE}.md`).value!;
    expect((r.frontmatter as Record<string, unknown>)["mood"]).toBe("amber");
    const out = serializeLinkNote(r);
    expect(out).toContain("mood: amber");
  });

  it("flags filename/box-edge mismatch", () => {
    const r = parseLinkNote(NOTE_MD, "link-0000000000000000.md");
    expect(r.value).toBeNull();
    expect(r.problems.some((p) => p.detail.includes("slug"))).toBe(true);
  });
});

describe("formats: ids", () => {
  it("edge ids are 16 hex and map to filenames", () => {
    const id = newEdgeId();
    expect(isEdgeId(id)).toBe(true);
    expect(linkNoteName(id)).toBe(`link-${id}.md`);
    expect(edgeIdFromNoteName(linkNoteName(id))).toBe(id);
    expect(edgeIdFromNoteName("not-a-link.md")).toBeNull();
  });
});

describe("formats: ink sidecar", () => {
  it("round-trips strokes", () => {
    const sidecar = {
      strokes: [{ d: "M0 0L10 10", stroke: "#ff0000", "stroke-width": 6 }],
    };
    const svg = serializeInkSvg(sidecar);
    expect(svg).toContain('box-format="box.ink/1"');
    const r = parseInkSvg(svg);
    expect(r.value?.strokes[0]?.d).toBe("M0 0L10 10");
    expect(r.value?.strokes[0]?.["stroke-width"]).toBe(6);
  });

  it("flags hostile svg", () => {
    const r = parseInkSvg(
      '<svg><script>alert(1)</script><path d="M0 0"/></svg>',
    );
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("formats: board determinism", () => {
  it("serialize produces stable key order", () => {
    const b = parseBoard(
      JSON.stringify({ "box-format": "box.canvas/1", nodes: [], edges: [] }),
    ).value!;
    const a = serializeBoard(b);
    const c = serializeBoard(b);
    expect(a).toBe(c);
    expect(a.indexOf('"box-format"')).toBeLessThan(a.indexOf('"nodes"'));
  });
});
