// SPDX-License-Identifier: LicenseRef-Proprietary
// Ink sidecar (.ink.svg) - DATA-MODEL §2.3 box-ink, SECURITY-THREATS §2.
// Our own files use a strict allowlist shape: <svg><path d ... box-* attrs/></svg>.
// Foreign/invalid SVG is a problem item, never rendered, never rewritten.

import type { InkSidecar, InkStroke, ProblemItem } from "./types.js";
import type { ParseResult } from "./board.js";

const ALLOWED_PATH_ATTRS =
  /^(d|stroke|stroke-width|stroke-linecap|stroke-linejoin|fill|opacity|data-[a-z-]+|box-[a-z-]+)$/;
const PATH_RE = /<path\b([^>]*)\/?>/g;
const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

/** Total parser: allowlist only; anything else is flagged, not rendered. */
export function parseInkSvg(
  raw: string,
  path = "<ink>",
): ParseResult<InkSidecar> {
  const problems: ProblemItem[] = [];
  if (!raw.includes("<svg")) {
    return {
      value: null,
      problems: [
        { kind: "malformed-note", path, detail: "not an svg document" },
      ],
    };
  }
  if (/<script|javascript:|<foreignObject|xlink:href\s*=\s*"(?!#)/i.test(raw)) {
    problems.push({
      kind: "malformed-note",
      path,
      detail:
        "svg contains forbidden element/attr (script, remote ref, foreignObject)",
    });
  }
  const strokes: InkStroke[] = [];
  for (const m of raw.matchAll(PATH_RE)) {
    const attrs = m[1] ?? "";
    const stroke: InkStroke = { d: "" };
    let bad = false;
    for (const a of attrs.matchAll(ATTR_RE)) {
      const name = a[1] ?? "";
      const val = a[2] ?? "";
      if (!ALLOWED_PATH_ATTRS.test(name)) {
        bad = true;
        problems.push({
          kind: "malformed-note",
          path,
          detail: `path attr not in allowlist: ${name}`,
        });
        continue;
      }
      (stroke as Record<string, unknown>)[name] =
        name === "stroke-width" ? Number(val) : val;
    }
    if (stroke.d === "") {
      problems.push({
        kind: "malformed-note",
        path,
        detail: "path element missing d",
      });
      bad = true;
    }
    if (!bad) strokes.push(stroke);
  }
  if (problems.length > 0) return { value: null, problems };
  return { value: { strokes }, problems };
}

/** Canonical emit: one path per stroke, deterministic attribute order. */
export function serializeInkSvg(sidecar: InkSidecar): string {
  const lines = sidecar.strokes.map((s) => {
    const w = s["stroke-width"] ?? 4;
    const c = s["stroke"] ?? "currentColor";
    const extras = Object.entries(s)
      .filter(([k]) => !["d", "stroke", "stroke-width"].includes(k))
      .map(([k, v]) => ` ${k}="${String(v)}"`)
      .join("");
    return `  <path d="${s.d}" fill="${c}" stroke="none" stroke-width="${w}"${extras}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" box-format="box.ink/1">\n${lines.join("\n")}\n</svg>\n`;
}
