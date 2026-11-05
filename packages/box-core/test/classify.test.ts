// SPDX-License-Identifier: LicenseRef-Proprietary
// Watch classifier tests - §5.2. Deltas classify by existence after a quiet
// window: created/deleted/modified/renamed, rename pairing by content
// identity (sha > size+mtime > size).

import { describe, it, expect } from "vitest";
import { classifyFileSet } from "../src/watch/classify.js";
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

  it("same-size no-mtime collision pairs with first sorted candidate", () => {
    // No content hashing in production (O(workspace) per scan); the
    // residual collision class is documented in classify.ts. With equal
    // sizes and no mtimes, the alphabetically-first create wins the pair.
    const before = {
      files: new Map([["old.md", { size: 10 }]]),
    };
    const d = classifyFileSet(before, [
      { path: "bait.md", size: 10 },
      { path: "real.md", size: 10 },
    ]);
    expect(d).toContainEqual({
      kind: "renamed",
      path: "old.md",
      to: "bait.md",
    });
    expect(d).toContainEqual({ kind: "created", path: "real.md" });
  });
});
