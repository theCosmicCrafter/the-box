// SPDX-License-Identifier: LicenseRef-Proprietary
// Link-note parse/serialize - DATA-MODEL §3.
// Frontmatter is YAML between --- fences. Handled in-house: gray-matter
// routes both directions through Node's Buffer, which does not exist in the
// WebView2 renderer - box-core depends on no Node globals. Unknown frontmatter
// keys are preserved verbatim on rewrite (user keys are theirs; box-* keys
// are app-managed).

import { load as loadYaml } from "js-yaml";
import type { ParseResult } from "./board.js";
import { edgeIdFromNoteName, isEdgeId, isNodeId } from "./ids.js";
import { baseName } from "./paths.js";
import type { LinkNote, LinkNoteFrontmatter, ProblemItem } from "./types.js";
import { LINK_NOTE_FORMAT } from "./types.js";

const CANONICAL_ORDER = [
  "box-edge",
  "box-format",
  "from",
  "to",
  "board",
  "from-file",
  "to-file",
  "type",
  "created",
] as const;

/**
 * Split `---`-fenced frontmatter from body. Tolerates BOM and CRLF. Returns
 * null when there is no fence pair - the caller reports it as malformed.
 */
function splitFrontmatter(
  raw: string,
): { frontmatter: string; content: string } | null {
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const lines = text.split("\n");
  if (lines[0] === undefined || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === "---") {
      return {
        frontmatter: lines.slice(1, i).join("\n"),
        content: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}

/** Total parser - bad frontmatter is a problem item, never a throw. */
export function parseLinkNote(
  raw: string,
  path: string,
): ParseResult<LinkNote> {
  const problems: ProblemItem[] = [];
  let fatal = false;
  const split = splitFrontmatter(raw);
  let data: unknown;
  if (split !== null) {
    try {
      data = loadYaml(split.frontmatter);
    } catch {
      return {
        value: null,
        problems: [
          { kind: "malformed-note", path, detail: "unparseable frontmatter" },
        ],
      };
    }
  } else {
    return {
      value: null,
      problems: [
        { kind: "malformed-note", path, detail: "missing frontmatter fences" },
      ],
    };
  }
  const fm = (
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? data
      : {}
  ) as Record<string, unknown>;

  const edgeId = fm["box-edge"];
  if (typeof edgeId !== "string" || !isEdgeId(edgeId)) {
    fatal = true;
    problems.push({
      kind: "malformed-note",
      path,
      detail: `box-edge invalid: ${String(edgeId)}`,
    });
  } else {
    const slug = edgeIdFromNoteName(baseName(path));
    if (slug !== null && slug !== edgeId) {
      // ERR-3: filename slug != box-edge is surfaced, but non-fatal:
      // reconcile repairs box-edge frontmatter to match filename (filename is identity).
      problems.push({
        kind: "malformed-note",
        path,
        detail: `filename slug ${slug} != box-edge ${edgeId}`,
      });
    }
  }
  if (fm["box-format"] !== LINK_NOTE_FORMAT) {
    fatal = true;
    problems.push({
      kind: "malformed-note",
      path,
      detail: `box-format expected ${LINK_NOTE_FORMAT}, got ${String(fm["box-format"])}`,
    });
  }
  for (const k of ["from", "to"] as const) {
    const v = fm[k];
    if (typeof v !== "string" || !isNodeId(v)) {
      fatal = true;
      problems.push({
        kind: "malformed-note",
        path,
        detail: `${k} missing or not a node id: ${String(v)}`,
      });
    }
  }
  // js-yaml's timestamp schema yields a Date for unquoted ISO values;
  // accept either and normalize to an ISO string.
  const created = fm["created"];
  if (created instanceof Date && !Number.isNaN(created.getTime())) {
    fm["created"] = created.toISOString();
  } else if (
    typeof created === "string" &&
    !Number.isNaN(Date.parse(created))
  ) {
    fm["created"] = new Date(created).toISOString();
  } else {
    fatal = true;
    problems.push({
      kind: "malformed-note",
      path,
      detail: `created missing or not a date: ${String(created)}`,
    });
  }

  if (fatal) {
    return { value: null, problems };
  }
  return {
    value: {
      path,
      frontmatter: fm as LinkNoteFrontmatter,
      // Strip the serializer's framing newlines exactly: one after the
      // fence, one before EOF. Both are write-side artifacts - without the
      // trailing strip every save-load cycle grows bodies by a newline.
      body: (split.content ?? "").replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
    },
    problems,
  };
}

/**
 * Deterministic serializer: required keys first in canonical order, then any
 * unknown/user keys in their existing order, then body.
 *
 * Emitted by hand - gray-matter.stringify routes through its toFile helper,
 * which calls Buffer.from(); Buffer is a Node global and does not exist in the
 * Tauri WebView2 renderer. box-core must not depend on Node globals.
 */
const PLAIN_KEY = /^[A-Za-z0-9_-]+$/;
// Bare scalars: start letter/underscore (never a digit - keeps numbers and
// ISO dates quoted so js-yaml can't reinterpret them), no YAML indicator
// characters inside, no trailing space.
const PLAIN_SCALAR = /^[A-Za-z_](?:[A-Za-z0-9_ ./-]*[A-Za-z0-9_./-])?$/;
const RESERVED = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "on",
  "off",
  "null",
  "~",
  "",
]);

// YAML 1.2 admits JSON as a subset, so JSON.stringify is a correct fallback
// for every non-plain value (strings, arrays, objects, null).
function yamlScalar(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (
    typeof v === "string" &&
    PLAIN_SCALAR.test(v) &&
    !RESERVED.has(v.toLowerCase())
  )
    return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function serializeLinkNote(note: LinkNote): string {
  const fm = note.frontmatter as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of CANONICAL_ORDER) {
    if (fm[k] !== undefined) ordered[k] = fm[k];
  }
  for (const k of Object.keys(fm)) {
    if (!(CANONICAL_ORDER as readonly string[]).includes(k)) ordered[k] = fm[k];
  }
  const lines: string[] = [];
  for (const [k, v] of Object.entries(ordered)) {
    if (v === undefined) continue;
    lines.push(
      `${PLAIN_KEY.test(k) ? k : JSON.stringify(k)}: ${yamlScalar(v)}`,
    );
  }
  const body = note.body.replace(/^\n+/, "");
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}
