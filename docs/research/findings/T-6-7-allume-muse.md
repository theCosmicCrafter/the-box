# T-6 + T-7 - Allume (née Muse) - merged targets

| | |
|---|---|
| **Method** | first-party sources: allume.com, App Store listing, allume.com/updates, museapp.com memos |
| **Verified** | 2026-10-13 |
| **Status** | Complete (external docs; binary uninspectable - Apple-only, verified) |

## Identity - verified

**Allume and Muse are the same product.** Muse rebranded to Allume in
2025 ("Muse is now Allume" - allume.com; App Store listing title:
"Allume - for focused thinking, Formerly Muse Canvas for Ideas").
Targets T-6 and T-7 collapse into one.

## Platform - verified

iPad, iPhone, Mac only (App Store listing + allume.com download links).
**No Windows or Android build exists.** The binary cannot be inspected
on this machine - a platform limitation, not an oversight.

## Model - from first-party docs (their claims, cited)

- **Nested boards**: boards inside boards inside boards, linkable to any
  previous one (their core differentiator).
- **Local-first data with instant sync** (App Store copy).
- **`.allume` shared board bundles** - a portable export format
  introduced with the rebrand (allume.com/updates).
- **Linked cards + excerpts**: reference boards from multiple places;
  excerpt parts of PDFs/images without losing source context.
- **MCP server on Mac** (v3.5+): assistants can "list workspaces, search
  boards, open documents, read board contents, create, edit, and delete
  cards, and browse and organize your inbox" (allume.com/updates).
- Design memos at museapp.com/memos document their reasoning: they
  deliberately chose zooming nested boards over a free infinite canvas
  (disorientation concerns), and a chromeless gesture-first UI.

## Adopt vs reject

| adopt | reject |
|---|---|
| Nested boards (board-as-node inside another board) - matches our "board is a file, file can be a node" | zooming-only navigation model |
| Excerpt-with-source-context concept (annotated crops linking back) | Apple-only silo |
| In-app agent surface (their MCP server) - second vendor picking this pattern, after Heptabase's CLI | - |

## Implication

Two mature products (Allume MCP, Heptabase CLI) both expose canvas state
through an **in-app local agent server**, not through file formats. Direct
precedent for `box-mcp`'s embedded-server design - and our file-truth
model remains the differentiator they don't have.
