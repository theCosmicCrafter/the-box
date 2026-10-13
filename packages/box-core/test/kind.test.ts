// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, expect, it } from "vitest";
import { fileKind } from "../src/index.js";

describe("fileKind", () => {
  it("maps every previewable family", () => {
    expect(fileKind("a/b.png")).toBe("image");
    expect(fileKind("icon.svg")).toBe("image");
    expect(fileKind("clip.mov")).toBe("video");
    expect(fileKind("mix.flac")).toBe("audio");
    expect(fileKind("doc.pdf")).toBe("pdf");
    expect(fileKind("data.csv")).toBe("csv");
    expect(fileKind("font.woff2")).toBe("font");
    expect(fileKind("notes/a.md")).toBe("text");
    expect(fileKind("src/app.tsx")).toBe("text");
    expect(fileKind("cfg.yaml")).toBe("text");
  });

  it(".box.canvas is its own kind, not text", () => {
    expect(fileKind(".box/main.box.canvas")).toBe("board");
  });

  it("binaries get typed-tile kinds", () => {
    expect(fileKind("pack.zip")).toBe("archive");
    expect(fileKind("scene.blend")).toBe("model3d");
    expect(fileKind("brush.psd")).toBe("document");
    expect(fileKind("mystery.bin")).toBe("other");
    expect(fileKind("no-extension")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(fileKind("PHOTO.JPG")).toBe("image");
    expect(fileKind("FONT.TTF")).toBe("font");
  });
});
