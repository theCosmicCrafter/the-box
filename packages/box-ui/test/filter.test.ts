import { describe, expect, it } from "vitest";
import type { FileNode, TextNode } from "@box/core";
import { matchNode } from "../src/canvas/CanvasFilter.js";

const mkFileNode = (id: string, file: string): FileNode => ({
  id,
  type: "file",
  file,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

const mkTextNode = (id: string, text: string): TextNode => ({
  id,
  type: "text",
  text,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

describe("CanvasFilter matchNode", () => {
  it("matches all nodes when query is empty and kind is all", () => {
    const node = mkFileNode("1", "concept.png");
    expect(matchNode(node, "", "all")).toBe(true);
  });

  it("matches by file extension prefix .ext", () => {
    const img = mkFileNode("1", "render.png");
    const doc = mkFileNode("2", "notes.md");
    expect(matchNode(img, ".png", "all")).toBe(true);
    expect(matchNode(doc, ".png", "all")).toBe(false);
    expect(matchNode(doc, ".md", "all")).toBe(true);
  });

  it("matches by filename query substring", () => {
    const node = mkFileNode("1", "assets/hero_character.png");
    expect(matchNode(node, "hero", "all")).toBe(true);
    expect(matchNode(node, "villain", "all")).toBe(false);
  });

  it("matches text node body", () => {
    const node = mkTextNode("1", "Important project milestone deadline");
    expect(matchNode(node, "milestone", "all")).toBe(true);
    expect(matchNode(node, "unrelated", "all")).toBe(false);
  });

  it("matches document text excerpts from fileTexts map", () => {
    const node = mkFileNode("1", "notes/lore.md");
    const texts = new Map([["notes/lore.md", "Ancient dragon lore and myth"]]);
    expect(matchNode(node, "dragon", "all", texts)).toBe(true);
    expect(matchNode(node, "spaceship", "all", texts)).toBe(false);
  });

  it("filters correctly by kind pill", () => {
    const img = mkFileNode("1", "photo.png");
    const doc = mkFileNode("2", "story.md");
    const txt = mkTextNode("3", "canvas note");
    const model = mkFileNode("4", "scene.blend");

    expect(matchNode(img, "", "image")).toBe(true);
    expect(matchNode(doc, "", "image")).toBe(false);

    expect(matchNode(doc, "", "text")).toBe(true);
    expect(matchNode(txt, "", "text")).toBe(true);
    expect(matchNode(img, "", "text")).toBe(false);

    expect(matchNode(model, "", "model3d")).toBe(true);
    expect(matchNode(img, "", "model3d")).toBe(false);
  });
});
