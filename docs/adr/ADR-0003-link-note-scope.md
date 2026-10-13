# ADR-0003 - Link notes are workspace-global (OQ-4)

| Status                              | Date       | Supersedes |
| ----------------------------------- | ---------- | ---------- |
| **Accepted - pending group ratify** | 2026-10-12 | -          |

## Context

When an edge connects two objects, does its `link-*.md` belong to the
workspace (any board can reference it) or to the board where it was drawn?
Objects may appear on multiple boards (FR-203/303), so the question decides
whether "the relationship between file A and file B" exists once or per view.

## Decision

Link notes are **workspace-global**. The note lives beside user files (not
inside `.box/`), its edge is referenced by `box-link` on whichever boards
display it, and `board` in frontmatter records only the board it was drawn
on (informational). Deleting the note removes the edge from every board.

## Consequences

- "The relationship between A and B" is a fact about the _files_, not about
  one view - matches Christian's model ("an arrow documents the join").
- The graph/index can answer "what relates to X" without knowing boards.
- Sync engine handles the multi-board edge case already (I-6).
- Orphan/broken states surface workspace-wide, not per-board.

## Rejected alternatives

- **Per-board notes:** two arrows between the same objects would mean two
  notes - duplicates of the same "fact," violating single-truth.
- **Notes inside `.box/`:** hides link documentation in app territory; notes
  are first-class user content and belong in user space.
