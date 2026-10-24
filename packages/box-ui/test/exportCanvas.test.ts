// SPDX-License-Identifier: LicenseRef-Proprietary

import type { Board } from "@box/core";
import { describe, expect, it } from "vitest";
import { computeExportBounds, exportBoardToSvg } from "../src/canvas/exportCanvas.js";

describe("exportCanvas", () => {
  const sampleBoard: Board = {
    "box-format": "box.canvas/1",
    nodes: [
      { id: "n1", type: "text", x: 100, y: 100, width: 200, height: 100, text: "Node 1" },
      { id: "n2", type: "text", x: 400, y: 200, width: 200, height: 100, text: "Node 2" },
      { id: "g1", type: "group", x: 50, y: 50, width: 600, height: 300, label: "My Region" },
    ],
    edges: [
      {
        id: "e1",
        fromNode: "n1",
        toNode: "n2",
        fromSide: "right",
        toSide: "left",
        label: "connects",
        lineStyle: "dashed",
        color: "1",
        "box-link": "link-e1.md",
      },
    ],
  };

  it("computes export bounds accurately with padding", () => {
    const b = computeExportBounds(sampleBoard.nodes, 20);
    // minX is 50, minY is 50, maxX is 650, maxY is 350
    expect(b.minX).toBe(30);
    expect(b.minY).toBe(30);
    expect(b.width).toBe(640);
    expect(b.height).toBe(340);
  });

  it("exports board to valid SVG string", () => {
    const svg = exportBoardToSvg(sampleBoard);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Node 1");
    expect(svg).toContain("Node 2");
    expect(svg).toContain("My Region");
    expect(svg).toContain("stroke-dasharray=\"6,4\"");
    expect(svg).toContain("connects");
    expect(svg).toContain("#e5484d"); // preset 1 tint
  });

  it("filters export by nodeIds when requested", () => {
    const svg = exportBoardToSvg(sampleBoard, { nodeIds: ["n1"] });
    expect(svg).toContain("Node 1");
    expect(svg).not.toContain("Node 2");
    // Edge between n1 and n2 should be omitted since n2 is excluded
    expect(svg).not.toContain("connects");
  });
});
