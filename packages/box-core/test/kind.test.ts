// SPDX-License-Identifier: LicenseRef-Proprietary
import { describe, expect, it } from "vitest";
import { fileKind, looksLikeText } from "../src/index.js";

describe("fileKind", () => {
  it("maps every previewable family", () => {
    expect(fileKind("a/b.png")).toBe("image");
    expect(fileKind("icon.svg")).toBe("image");
    expect(fileKind("clip.mov")).toBe("video");
    expect(fileKind("mix.flac")).toBe("audio");
    expect(fileKind("doc.pdf")).toBe("pdf");
    expect(fileKind("page.html")).toBe("html");
    expect(fileKind("data.csv")).toBe("csv");
    expect(fileKind("font.woff2")).toBe("font");
    expect(fileKind("brand.ase")).toBe("palette");
    expect(fileKind("painting.kra")).toBe("zip");
    expect(fileKind("scene.glb")).toBe("model3d");
    expect(fileKind("env.exr")).toBe("texture");
    expect(fileKind("s.frag")).toBe("code");
    expect(fileKind("src/app.tsx")).toBe("code");
    expect(fileKind("shader.wgsl")).toBe("code");
    expect(fileKind("notes/a.md")).toBe("text");
    expect(fileKind("cfg.yaml")).toBe("text");
    expect(fileKind("Dockerfile")).toBe("text");
  });

  it(".box.canvas is its own kind, not text", () => {
    expect(fileKind(".box/main.box.canvas")).toBe("board");
  });

  it("binaries get typed-tile kinds", () => {
    expect(fileKind("pack.rar")).toBe("archive");
    expect(fileKind("brush.psd")).toBe("image"); // decoded via ag-psd composite
    expect(fileKind("photo.cr3")).toBe("raw");
    expect(fileKind("grade.cube")).toBe("lut");
    expect(fileKind("rig.usdz")).toBe("model3d");
    expect(fileKind("scene.lwo2")).toBe("model3d");
    expect(fileKind("mystery.bin")).toBe("other");
    expect(fileKind("no-extension")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(fileKind("PHOTO.JPG")).toBe("image");
    expect(fileKind("FONT.TTF")).toBe("font");
  });

  it("dotfiles resolve their inner name as the extension", () => {
    expect(fileKind(".gitignore")).toBe("text");
    expect(fileKind(".env")).toBe("text");
    expect(fileKind(".npmrc")).toBe("text");
    expect(fileKind("proj/.eslintrc.json")).toBe("text");
    expect(fileKind(".unknownext")).toBe("other");
  });
});

describe("looksLikeText", () => {
  it("accepts prose, code, and data", () => {
    expect(looksLikeText("# Hello\n\nSome **markdown** prose.\n")).toBe(true);
    expect(looksLikeText("const x = 1;\nfunction f() {}\n")).toBe(true);
    expect(looksLikeText('{"a":1,"b":[2,3]}\n')).toBe(true);
    expect(looksLikeText("line1\nline2\tTabbed\r\n")).toBe(true);
  });

  it("rejects binaries and empty input", () => {
    expect(looksLikeText("")).toBe(false);
    expect(looksLikeText("PNG\x89\x50\x4e\x47\x00\x01\x02")).toBe(false);
    expect(looksLikeText("a\0b\0c")).toBe(false);
    // >5% C0 control chars (excluding tab/lf/cr) reads as binary
    expect(looksLikeText("ab\x01\x02\x03\x04\x05\x06\x07\x08")).toBe(false);
  });

  it("NUL anywhere in the input disqualifies, not just the sample", () => {
    const s = "x".repeat(5000) + "\0";
    expect(looksLikeText(s)).toBe(false);
  });
});
