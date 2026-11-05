// SPDX-License-Identifier: LicenseRef-Proprietary
import type { Board } from "@box/core";
import { describe, expect, it, vi } from "vitest";
import { EdgeHandles } from "../src/canvas/EdgeLayer.js";

describe("EdgeHandles", () => {
  it("renders handles for an edge with one dangling endpoint and marks it broken", () => {
    const board: Board = {
      "box-format": "box.canvas/1",
      nodes: [
        {
          id: "n-1",
          type: "file",
          file: "a.png",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
      edges: [
        {
          id: "e-1",
          fromNode: "n-1",
          toNode: "n-missing",
          "box-link": "link-e-1.md",
        },
      ],
    };

    const element = EdgeHandles({
      board,
      selectedId: "e-1",
      zoom: 1,
      onRetargetStart: vi.fn(),
    });

    expect(element).not.toBeNull();
    const circles = element!.props.children;
    expect(circles).toHaveLength(2);
    expect(circles[0].props.className).toContain("edge-endpoint");
    expect(circles[0].props.className).not.toContain("broken");
    expect(circles[1].props.className).toContain("edge-endpoint");
    expect(circles[1].props.className).toContain("broken");
  });

  it("returns null when both endpoints are missing (no spatial geometry)", () => {
    const board: Board = {
      "box-format": "box.canvas/1",
      nodes: [],
      edges: [
        {
          id: "e-2",
          fromNode: "n-gone1",
          toNode: "n-gone2",
          "box-link": "link-e-2.md",
        },
      ],
    };

    const element = EdgeHandles({
      board,
      selectedId: "e-2",
      zoom: 1,
      onRetargetStart: vi.fn(),
    });

    expect(element).toBeNull();
  });
});
