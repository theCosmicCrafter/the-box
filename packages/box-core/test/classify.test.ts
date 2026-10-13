// SPDX-License-Identifier: LicenseRef-Proprietary
// Watch classifier tests - §5.2. Deltas classify by existence after a quiet
// window: created/deleted/modified/renamed, rename pairing by content
// identity (sha > size+mtime > size).

import { describe, it, expect } from "vitest";
import { classifyFileSet, routePath } from "../src/watch/classify.js";
import type { FileEntry } from "../src/vault/vault.js";

const prev = (entries: [string, number, number?][]) =>
  ({
    files: new Map(
      entries.map(([path, size, mtime]) => [path, { size, mtime }]),
    ),
  }) as const;

const after = (entries: [string, number, number?][]): FileEntry[] =>
  entries.map(([path, size, mtime]) => ({ path, size, mtime }));

describe("classifyFileSet", () => {
  it("detects created and deleted", () => {
    const d = classifyFileSet(
      prev([
        ["a.md", 10, 1],
        ["gone.md", 5, 1],
      ]),
      after([
        ["a.md", 10, 1],
        ["new.md", 7, 9],
      ]),
    );
    expect(d).toContainEqual({ kind: "created", path: "new.md" });
    expect(d).toContainEqual({ kind: "deleted", path: "gone.md" });
    expect(d).toHaveLength(2);
  });

  it("detects modified by size", () => {
    const d = classifyFileSet(
      prev([["a.md", 10, 1]]),
      after([["a.md", 11, 1]]),
    );
    expect(d).toEqual([{ kind: "modified", path: "a.md" }]);
  });

  it("detects same-size modified by mtime", () => {
    const d = classifyFileSet(
      prev([["a.md", 10, 1]]),
      after([["a.md", 10, 2]]),
    );
    expect(d).toEqual([{ kind: "modified", path: "a.md" }]);
  });

  it("pairs a rename by size+mtime, not as delete+create", () => {
    const d = classifyFileSet(
      prev([["old.md", 10, 42]]),
      after([["renamed.md", 10, 42]]),
    );
    expect(d).toEqual([{ kind: "renamed", path: "old.md", to: "renamed.md" }]);
  });

  it("mtime disambiguates a rename from a same-size coincidence", () => {
    const d = classifyFileSet(
      prev([["old.md", 10, 42]]),
      after([
        ["renamed.md", 10, 42],
        ["fresh.md", 10, 99],
      ]),
    );
    expect(d).toContainEqual({
      kind: "renamed",
      path: "old.md",
      to: "renamed.md",
    });
    expect(d).toContainEqual({ kind: "created", path: "fresh.md" });
    expect(d).toHaveLength(2);
  });

  it("sha256 wins over size for rename pairing", () => {
    const before = {
      files: new Map([["old.md", { size: 10, sha256: "aa" }]]),
    };
    const d = classifyFileSet(before, [
      { path: "bait.md", size: 10, sha256: "bb" },
      { path: "real.md", size: 10, sha256: "aa" },
    ]);
    expect(d).toContainEqual({
      kind: "renamed",
      path: "old.md",
      to: "real.md",
    });
    expect(d).toContainEqual({ kind: "created", path: "bait.md" });
  });
});

describe("routePath", () => {
  it.each([
    [".box/tombstones.json", "tombstone"],
    [".box/main.box.canvas", "board"],
    ["link-7f3a9c2b1d4e5f6a.md", "link-note"],
    ["notes/link-7f3a9c2b1d4e5f6a.md", "link-note"],
    ["img/a.png.ink.svg", "ink"],
    ["img/a.png", "object"],
    ["notes/plain.md", "object"],
  ])("routePath(%j) = %s", (p, expected) => {
    expect(routePath(p)).toBe(expected);
  });
});
