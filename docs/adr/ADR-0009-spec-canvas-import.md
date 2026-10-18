# ADR-0009 - Foreign `.canvas` ingest (JSON Canvas interop)

- **Status:** Accepted
- **Date:** 2026-10-17
- **Relates:** DATA-MODEL §2, ADR-0002 (superset), FR-112, I-1 (files are truth)

## Context

The Box's `.box.canvas` is already a JSON Canvas 1.0 superset, but the
app only _wrote_ the format: board discovery scanned `.box/*.box.canvas`
and `fileKind` ignored plain `.canvas`. A user arriving with an existing
vault (Obsidian Canvas, spec-conformant exporters) would see their boards
as dead tiles - the exact lock-in failure the kernel forbids.

## Decision

Any `*.canvas` file anywhere in the workspace is a board candidate.
Opening one whose `box-format` marker is missing runs a **one-time,
in-place normalization**, then the file is a first-class board:

1. Node ids failing `isNodeId` remap to `n-<hex>`; a foreign id map fixes
   every edge `fromNode`/`toNode` reference.
2. Edge ids failing `isEdgeId` remap to 16-hex; every edge gains
   `box-link: link-<edgeid>.md`.
3. For each imported edge a real `link-<edgeid>.md` note is written
   (`box.link/1` frontmatter: `box-edge`, `from`, `to`, `created`, plus
   `from-file`/`to-file` denorms for file endpoints). Arrows are notes -
   imported arrows get notes like native ones.
4. `box-format: "box.canvas/1"` is added; all other top-level, node, and
   edge keys are preserved verbatim (spec + forward tolerance both ways).
5. The file keeps its `.canvas` name and location - Obsidian and other
   spec readers still open it; our `box-` keys are unknown keys to them
   and ride along on their saves.

Non-conforming JSON (not an object, `nodes`/`edges` not arrays) is not a
canvas at all: it becomes a `malformed-board` problem item and the file
is left untouched - import never destroys.

## Why in-place instead of import-copy

A copy under `.box/` would fork the board: the user's original keeps
working for other tools while ours diverges - two sources of truth.
In-place normalization keeps ONE file readable by both apps, which is the
entire point of choosing an open superset. The write is additive except
id remapping, which preserves edge semantics exactly.

## Consequences

- `fileKind` maps `*.canvas` -> board (covers `.box.canvas`).
- Board open path tolerates spec files; normalization is idempotent
  (a normalized file parses cleanly, so re-opening never rewrites).
- Imported edges' link notes are workspace-global files at root, same as
  native ones; the board records them via `box-link` as usual.
- Cost: one-time write bursts proportional to edge count.
