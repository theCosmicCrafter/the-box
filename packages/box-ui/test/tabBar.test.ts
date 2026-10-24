// SPDX-License-Identifier: LicenseRef-Proprietary

import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "../src/HelpModal.js";

describe("HelpModal & Shortcuts", () => {
  it("defines comprehensive shortcut categories", () => {
    const categories = SHORTCUT_GROUPS.map((g) => g.category);
    expect(categories).toContain("Canvas Navigation & View");
    expect(categories).toContain("Selection & Organization");
    expect(categories).toContain("Search & Intelligence");
    expect(categories).toContain("Node & File Interactions");
    expect(categories).toContain("Freehand Vector Inking");
  });

  it("includes vital keyboard shortcuts", () => {
    const allItems = SHORTCUT_GROUPS.flatMap((g) => g.items);
    const hasKey = (key: string) =>
      allItems.some((item) => item.keys.includes(key));

    expect(hasKey("Ctrl")).toBe(true);
    expect(hasKey("Shift")).toBe(true);
    expect(hasKey("Space")).toBe(true);
    expect(hasKey("P")).toBe(true);
    expect(hasKey("F")).toBe(true);
    expect(hasKey("A")).toBe(true);
    expect(hasKey("Z")).toBe(true);
  });
});
