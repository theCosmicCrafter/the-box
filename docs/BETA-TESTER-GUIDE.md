# The Box - Beta Tester Guide

Thanks for testing The Box. This is an early beta build: the core loop is
stable and tested, but expect rough edges. Everything below is what you
need to install it, learn it in ten minutes, and report problems.

## What The Box is

A local-first world-building canvas. Think of it as a lighter Obsidian
with a smarter canvas:

- **Objects are files.** Every tile on the canvas is a real file in a
  folder you choose. Drag a `.png` onto the canvas and it is still just
  `img/concept.png` on disk. Nothing is hidden inside a database.
- **Arrows are notes.** Drawing an arrow between two objects creates a
  real Markdown file (`link-<id>.md`) you can open and edit anywhere.
- **Edits round-trip.** Change a file in VS Code or Photoshop and the
  canvas updates. Move a tile and the board file on disk changes.
- **Ink lives in sidecars.** Freehand marks go in `<file>.ink.svg` next
  to the file - your media is never modified.
- **Your tools stay usable.** Open-with launches Photoshop, Blender,
  whatever you already use.
- **AI is opt-in and proposal-only** (and off by default). Nothing ever
  phones home; there is no cloud account, no sync server, no telemetry.

## Install (Windows)

1. Run the installer you received - either `The Box_0.1.0_x64_en-US.msi`
   or `The Box_0.1.0_x64-setup.exe` (NSIS). Both install the same app.
2. **Windows SmartScreen will warn** that the app is unrecognized. That
   is expected: this beta is unsigned (no code-signing certificate yet).
   Click "More info" then "Run anyway".
3. Launch **The Box** from the Start menu.

Uninstall later via Settings > Apps, or rerun the MSI and choose Remove.

## First run: pick a workspace

The Box has no documents of its own - you point it at a folder and that
folder becomes your workspace.

1. Click **Open workspace folder** in the sidebar (or the ribbon).
2. Pick any folder - an empty one is cleanest for a first look. If you
   pick a folder with files, they show up in the sidebar tree immediately.
3. The Box creates `.box/main.box.canvas` (your first board) and opens it.
4. Optional: click **Scaffold workspace** in the sidebar to seed the
   recommended folder layout (atlas / calendar / cards / extras /
   sources / spaces).

On next launch the app reopens your last workspace automatically.

## The core loop (try this first)

1. **Place files on the canvas.** Drag a file from the sidebar tree onto
   the canvas, or use the "+" on a Box panel row, or just drag files in
   from Windows Explorer - they are copied into the workspace and placed.
2. **Make a text note.** Double-click empty canvas. Type, click away.
   The note lives in the board file itself.
3. **Draw an arrow.** Drag from a node's edge handle to another node.
   Check the file tree: a new `link-....md` note appeared. That arrow IS
   that file.
4. **Edit the arrow's note.** Click the arrow - a note panel opens on
   the right with its frontmatter (type, endpoints) and body text. Save
   and the board stays in sync.
5. **Round-trip check.** Open the same folder in Explorer, edit a note
   in Notepad, watch the canvas update within a second or two.

## Controls reference

Press `?` or `F1` in the app for the searchable version of this list.

### Canvas

| Input | Action |
| --- | --- |
| Space or middle-click drag | Pan |
| Mouse wheel | Zoom |
| Shift+1 | Fit all objects |
| Shift+0 | Reset zoom to 100% |
| Shift+2 | Zoom to selection |
| Minimap (bottom right) | Click/drag to navigate |
| Status bar (bottom) | Zoom %, in/out/reset/fit buttons |

### Selection and organization

| Input | Action |
| --- | --- |
| Left-drag on empty canvas | Marquee select |
| Shift+click | Toggle node in selection |
| Ctrl+A | Select all |
| Arrow keys | Nudge selection 10px |
| Delete | Remove placement (the file stays on disk) |
| Ctrl+D | Duplicate (file nodes copy the file too) |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Right-click a multi-selection | Align, Distribute, Tidy into grid |

### Search and undo

| Input | Action |
| --- | --- |
| Ctrl+P | Quick-open palette (jump to placed file or place an unplaced one) |
| Ctrl+F | Search and kind-filter overlay; Enter / Shift+Enter cycles matches |
| Ctrl+Z / Ctrl+Y | Undo / redo (survives app restarts via a per-board oplog) |

### Files and nodes

| Input | Action |
| --- | --- |
| Double-click empty canvas | New text note |
| Double-click a text/markdown tile | Edit in place |
| Double-click an image | Full-window inspector |
| Alt+double-click | Reveal in Windows Explorer |
| Ctrl+V | Paste (image bytes become real .png files; text becomes a note) |
| Ctrl+W | Close current board |
| Right-click a node | Open externally, Open with..., colors, inspect, find related, recycle |

### Ink

| Input | Action |
| --- | --- |
| Ribbon pen | Draw mode - strokes land in `<file>.ink.svg` |
| Ribbon eraser | Erase strokes |
| Ribbon move | Select and move strokes |
| Ctrl+Z (ink mode) | Undo last stroke |

### Other

| Input | Action |
| --- | --- |
| `?` or F1 | Shortcut cheatsheet |
| Ctrl+Shift+E | Export canvas snapshot (PNG at 2x, or SVG) |
| Right-click a file in the tree | Open, reveal, copy path, new file, trash |
| Sidebar "new board" field + Enter | Create another board (tabs appear on top) |
| Sidebar Box panel | Unplaced files; click a row to pick it up and place by clicking the canvas |

## Open-with (your real tools)

Right-click a file node and choose **Open with...** to pick an app once
(Photoshop for .png, Blender for .blend, etc.). The Box remembers per
extension in `.box/settings.json`. A plain double-click or **Open
externally** uses that preference, falling back to the Windows default.
"Reset default app" in the same menu clears the preference.

## What is safe

- Deletes go to the **Recycle Bin**, never a hard delete.
- Board writes are atomic (temp file + rename), so a crash mid-save
  cannot truncate your board.
- Imported/dropped files are copied in; your originals outside the
  workspace are never touched.
- Everything stays on your machine. No accounts, no telemetry, no sync.
  The only network-capable feature (local AI proposals at 127.0.0.1) is
  off unless you enable it in `.box/settings.json`.

## Known beta limitations

- Windows only for now (macOS/Linux come later; the file format is
  portable already).
- One workspace open at a time.
- Boards are the JSON Canvas format (`.canvas` / `.box.canvas`), so
  Obsidian's Canvas can open them, but The Box adds `box-*` extensions
  other tools will ignore.
- The semantic "find related" search needs a local Ollama at
  `127.0.0.1:11434` with `bge-m3` pulled; without it the feature silently
  falls back to a local hash embedding (results are weaker but still
  ranked). Not required for normal use.
- Unsigned binary: SmartScreen warning on install is expected.
- `.ink.svg` sidecars and `link-*.md` notes are real files - if you move
  or rename them outside the app, the watcher reconciles rather than
  guessing, but the cleanest path is editing through the app.

## Reporting bugs

Easiest: press `?` or `F1` in the app and click **Report an issue** -
it copies a diagnostics summary (version, platform, board stats, current
problems) to your clipboard and opens the issue tracker. Paste the
diagnostics into the report.

Or file issues directly at:
<https://github.com/theCosmicCrafter/the-box/issues>

Most useful to include:

1. What you did and what you expected vs what happened.
2. A screenshot (Win+Shift+S) or the canvas state.
3. The exact file name if a specific file misbehaves.
4. Whether the problem survives restarting the app.

Your workspace is just files, so worst case you can zip the folder and
share it (minus anything private) to reproduce an issue.

## If something goes wrong

- **Canvas looks empty after launch**: open the sidebar and click a
  `.canvas` file in the tree, or press the ribbon rescan button.
- **Problems row appears at the bottom**: click it - it jumps the camera
  to the offending object. It usually means a file a tile points at was
  moved or deleted outside the app.
- **Truly stuck**: closing and relaunching is safe; the board file and
  undo log are on disk. The app session file lives at
  `%APPDATA%\dev.thebox.canvas\box-session.json` - deleting it just
  forgets your last workspace.
