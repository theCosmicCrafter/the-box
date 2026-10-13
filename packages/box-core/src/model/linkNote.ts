// SPDX-License-Identifier: LicenseRef-Proprietary
// Link-note parse/serialize - DATA-MODEL §3.
// Frontmatter is YAML between --- fences; parsed via gray-matter (surveyed
// slot, MIT). Unknown frontmatter keys are preserved verbatim on rewrite
// (user keys are theirs; box-* keys are app-managed).

import matter from "gray-matter";
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

/** Total parser - bad frontmatter is a problem item, never a throw. */
export function parseLinkNote(
  raw: string,
  path: string,
): ParseResult<LinkNote> {
  const problems: ProblemItem[] = [];
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    return {
      value: null,
      problems: [
        { kind: "malformed-note", path, detail: "unparseable frontmatter" },
      ],
    };
  }
  const fm = parsed.data as Record<string, unknown>;

  const edgeId = fm["box-edge"];
  if (typeof edgeId !== "string" || !isEdgeId(edgeId)) {
    problems.push({
      kind: "malformed-note",
      path,
      detail: `box-edge invalid: ${String(edgeId)}`,
    });
  } else {
    const slug = edgeIdFromNoteName(baseName(path));
    if (slug !== null && slug !== edgeId) {
      problems.push({
        kind: "malformed-note",
        path,
        detail: `filename slug ${slug} != box-edge ${edgeId}`,
      });
    }
  }
  if (fm["box-format"] !== LINK_NOTE_FORMAT) {
    problems.push({
      kind: "malformed-note",
      path,
      detail: `box-format expected ${LINK_NOTE_FORMAT}, got ${String(fm["box-format"])}`,
    });
  }
  for (const k of ["from", "to"] as const) {
    const v = fm[k];
    if (typeof v !== "string" || !isNodeId(v)) {
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
    problems.push({
      kind: "malformed-note",
      path,
      detail: `created missing or not a date: ${String(created)}`,
    });
  }

  if (problems.length > 0) {
    return { value: null, problems };
  }
  return {
    value: {
      path,
      frontmatter: fm as LinkNoteFrontmatter,
      body: parsed.content.replace(/^\r?\n/, ""),
    },
    problems,
  };
}

/**
 * Deterministic serializer: required keys first in canonical order, then any
 * unknown/user keys in their existing order, then body.
 */
export function serializeLinkNote(note: LinkNote): string {
  const fm = note.frontmatter as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const k of CANONICAL_ORDER) {
    if (fm[k] !== undefined) ordered[k] = fm[k];
  }
  for (const k of Object.keys(fm)) {
    if (!(CANONICAL_ORDER as readonly string[]).includes(k)) ordered[k] = fm[k];
  }
  const body = note.body.replace(/^\n+/, "");
  return matter.stringify(`\n${body}`, ordered);
}
