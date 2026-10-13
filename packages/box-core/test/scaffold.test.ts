// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, expect, it } from "vitest";
import {
  ACCESS_DIRS,
  hasScaffoldDirs,
  missingScaffoldFiles,
  scaffoldFiles,
} from "../src/index.js";

describe("scaffold", () => {
  it("seeds every ACCESS dir plus a root home note", () => {
    const paths = scaffoldFiles().map((f) => f.path);
    expect(paths).toContain("home.md");
    for (const d of ACCESS_DIRS) expect(paths).toContain(`${d}/${d}.md`);
  });

  it("reports all seeds missing from an empty workspace", () => {
    expect(missingScaffoldFiles(new Set()).length).toBe(scaffoldFiles().length);
  });

  it("never lists an existing file - create-if-missing, no clobber", () => {
    const existing = new Set(["home.md", "atlas/atlas.md"]);
    const missing = missingScaffoldFiles(existing).map((f) => f.path);
    expect(missing).not.toContain("home.md");
    expect(missing).not.toContain("atlas/atlas.md");
    expect(missing).toContain("cards/cards.md");
  });

  it("hasScaffoldDirs: true when any ACCESS dir has content", () => {
    expect(hasScaffoldDirs([])).toBe(false);
    expect(hasScaffoldDirs(["notes/a.md", "img/x.png"])).toBe(false);
    expect(hasScaffoldDirs(["spaces/project-x.md"])).toBe(true);
    // a same-named file is not a dir
    expect(hasScaffoldDirs(["atlas"])).toBe(false);
  });
});
