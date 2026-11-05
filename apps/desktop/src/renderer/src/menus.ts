// SPDX-License-Identifier: LicenseRef-Proprietary
// menus.ts - context-menu declarations for canvas, nodes, and the file
// tree, extracted from App.tsx. Builders return MenuItem[]; the app
// owns placement via setMenu. Submenus re-open through deps.openMenu.
// Everything here is a declaration - no state lives in this module.

import type { CanvasNode, InkStroke } from "@box/core";
import { BOARD_FORMAT, fileKind, serializeBoard } from "@box/core";
import type { MenuItem, MenuSpec } from "@box/ui";
import { useBoxStore } from "@box/ui";
import type { makeSaver } from "./settings.js";

export interface MenuDeps {
  /** setMenu - submenus re-open at the same client position. */
  openMenu: (spec: MenuSpec) => void;
  updateNodeC: (id: string, patch: Record<string, unknown>) => void;
  updateNode: (id: string, patch: Record<string, unknown>) => void;
  removeNodeC: (id: string) => void;
  saveBoard: () => Promise<void>;
  rescan: () => Promise<unknown>;
  loadBoardFile: (rel: string) => Promise<unknown>;
  deleteNode: (id: string) => Promise<void>;
  deleteNodes: (ids: string[]) => Promise<void>;
  groupSelection: (ids: string[]) => Promise<void>;
  duplicateNodes: (ids: string[]) => Promise<void>;
  runAlign: (
    type: "left" | "centerX" | "right" | "top" | "centerY" | "bottom",
    ids: string[],
  ) => Promise<void>;
  runDistribute: (
    axis: "horizontal" | "vertical",
    ids: string[],
  ) => Promise<void>;
  runTidyGrid: (ids: string[]) => Promise<void>;
  findRelated: (node: CanvasNode) => Promise<void>;
  openExternalSmart: (rel: string) => Promise<void>;
  startFileEdit: (node: CanvasNode) => Promise<void>;
  setInspectPath: (path: string | null) => void;
  openWithMap: Record<string, string>;
  setOpenWithMap: (map: Record<string, string>) => void;
  savePrefs: { current: ReturnType<typeof makeSaver> | null };
  inkMap: Map<string, InkStroke[]>;
  setInkMap: (map: Map<string, InkStroke[]>) => void;
  createTextNode: (wx: number, wy: number) => Promise<void>;
  placeFile: (path: string, wx: number, wy: number) => Promise<void>;
  importAndPlace: (paths: string[], wx: number, wy: number) => Promise<void>;
  pasteAt: (wx: number, wy: number) => Promise<void>;
}

const problems = (...msgs: string[]) =>
  useBoxStore.getState().setProblems(msgs);

export function buildCanvasMenu(
  d: MenuDeps,
  wx: number,
  wy: number,
): MenuItem[] {
  return [
    {
      label: "New text note",
      icon: "type",
      hint: "dbl-click",
      onPick: () => void d.createTextNode(wx, wy),
    },
    {
      label: "New document",
      icon: "fileText",
      onPick: () =>
        void (async () => {
          const r = await window.box!.newFile("", "untitled", "md", "");
          if (r.ok && r.path) await d.placeFile(r.path, wx, wy);
          else if (!r.ok) problems(`new document failed: ${r.error}`);
          await d.rescan();
        })(),
    },
    {
      label: "New board",
      icon: "board",
      onPick: () =>
        void (async () => {
          const r = await window.box!.newFile(
            ".box",
            "board",
            "box.canvas",
            serializeBoard({
              nodes: [],
              edges: [],
              "box-format": BOARD_FORMAT,
            }),
          );
          if (r.ok && r.path) {
            await d.rescan();
            await d.loadBoardFile(r.path);
          } else if (!r.ok) {
            problems(`new board failed: ${r.error}`);
          }
        })(),
    },
    {
      label: "Import files…",
      icon: "import",
      onPick: () =>
        void window.box!.pickFiles(false).then((p) => d.importAndPlace(p, wx, wy)),
    },
    {
      label: "Import image…",
      icon: "image",
      onPick: () =>
        void window.box!.pickFiles(true).then((p) => d.importAndPlace(p, wx, wy)),
    },
    {
      label: "Paste",
      icon: "clipboard",
      hint: "ctrl+v",
      disabled: !("clipboard" in navigator && "read" in navigator.clipboard),
      onPick: () => void d.pasteAt(wx, wy),
    },
  ];
}

// Q2: FileTree context menu - file ops the tree didn't expose. The
// vault root ("") only offers creation; rows get open/reveal/copy/
// delete plus board-open for .canvas files. Returns null when no
// workspace is open (the caller skips setMenu).
export function buildTreeMenu(
  d: MenuDeps,
  path: string,
  isDir: boolean,
): MenuItem[] | null {
  const workspaceRoot = useBoxStore.getState().workspaceRoot;
  if (!workspaceRoot || !window.box) return null;
  const items: MenuItem[] = [];
  if (isDir) {
    items.push({
      label: "New file here",
      icon: "filePlus",
      onPick: () =>
        void (async () => {
          const r = await window.box!.newFile(path, "untitled", "md", "");
          if (r.ok) await d.rescan();
          else problems(`new file failed: ${r.error}`);
        })(),
    });
  } else {
    if (path.endsWith(".canvas")) {
      items.push({
        label: "Open board",
        icon: "board",
        onPick: () => void d.loadBoardFile(path),
      });
    }
    items.push(
      {
        label: "Open",
        icon: "external",
        onPick: () => void d.openExternalSmart(path),
      },
      {
        label: "Reveal in Explorer",
        icon: "folder",
        onPick: () => void window.box!.revealFile(path),
      },
      {
        label: "Copy path",
        icon: "clipboard",
        onPick: () => void navigator.clipboard.writeText(path),
      },
      {
        label: "Move to trash",
        icon: "trash",
        danger: true,
        onPick: () =>
          void (async () => {
            const r = await window.box!.trashFile(workspaceRoot, path);
            if (r.ok) await d.rescan();
            else problems(`trash failed: ${path} - ${r.error}`);
          })(),
      },
    );
  }
  return items;
}

export function buildNodeMenu(
  d: MenuDeps,
  node: CanvasNode,
  cx: number,
  cy: number,
  selectedIds?: string[],
): MenuItem[] {
  const items: MenuItem[] = [];
  const multi = selectedIds && selectedIds.length >= 2 ? selectedIds : null;

  if (multi) {
    items.push(
      {
        label: "Align…",
        icon: "box",
        onPick: () => {
          const alignSubmenu: MenuItem[] = [
            {
              label: "Align left",
              onPick: () => void d.runAlign("left", multi),
            },
            {
              label: "Align center (horizontal)",
              onPick: () => void d.runAlign("centerX", multi),
            },
            {
              label: "Align right",
              onPick: () => void d.runAlign("right", multi),
            },
            {
              label: "Align top",
              onPick: () => void d.runAlign("top", multi),
            },
            {
              label: "Align center (vertical)",
              onPick: () => void d.runAlign("centerY", multi),
            },
            {
              label: "Align bottom",
              onPick: () => void d.runAlign("bottom", multi),
            },
          ];
          d.openMenu({ x: cx, y: cy, items: alignSubmenu });
        },
      },
      {
        label: "Distribute…",
        icon: "box",
        disabled: multi.length < 3,
        onPick: () => {
          const distSubmenu: MenuItem[] = [
            {
              label: "Distribute horizontally",
              onPick: () => void d.runDistribute("horizontal", multi),
            },
            {
              label: "Distribute vertically",
              onPick: () => void d.runDistribute("vertical", multi),
            },
          ];
          d.openMenu({ x: cx, y: cy, items: distSubmenu });
        },
      },
      {
        label: "Tidy into grid",
        icon: "grid",
        onPick: () => void d.runTidyGrid(multi),
      },
      {
        label: `Group ${multi.length} nodes`,
        icon: "box",
        hint: "ctrl+g",
        onPick: () => void d.groupSelection(multi),
      },
      {
        label: `Duplicate ${multi.length} nodes`,
        icon: "filePlus",
        hint: "ctrl+d",
        onPick: () => void d.duplicateNodes(multi),
      },
      {
        label: `Remove ${multi.length} from canvas`,
        icon: "file",
        danger: true,
        hint: "del",
        onPick: () => void d.deleteNodes(multi),
      },
    );
  }

  // Track 3: Local semantic intelligence
  items.push({
    label: "Find related notes",
    icon: "search",
    onPick: () => void d.findRelated(node),
  });

  if (node.type === "file") {
    const file = node.file;
    const ext = `.${(file.split(".").pop() ?? "").toLowerCase()}`;
    items.push(
      {
        label: "Open externally",
        icon: "external",
        hint: "dbl-click",
        onPick: () => void d.openExternalSmart(file),
      },
      {
        label: "Open with…",
        icon: "external",
        onPick: () =>
          void (async () => {
            const app = await window.box?.pickApp();
            if (!app) return;
            const r = await window.box!.openWith(file, app);
            if (r.ok) {
              const next = { ...d.openWithMap, [ext]: app };
              d.setOpenWithMap(next);
              d.savePrefs.current?.({ openWith: next });
            } else {
              problems(`open-with failed: ${r.error}`);
            }
          })(),
      },
    );
    if (d.openWithMap[ext] !== undefined) {
      items.push({
        label: `Reset default app for ${ext}`,
        icon: "refresh",
        onPick: () => {
          const next = { ...d.openWithMap };
          delete next[ext];
          d.setOpenWithMap(next);
          d.savePrefs.current?.({ openWith: next });
        },
      });
    }
    items.push({
      label: "Reveal in Explorer",
      icon: "folderOpen",
      hint: "alt+dbl",
      onPick: () => void window.box?.revealFile(file),
    });
    // JSON Canvas `color` is spec-native ("1"-"6" presets + hex) - a
    // chained menu keeps the flat ContextMenu component untouched.
    items.push({
      label: "Set color…",
      icon: "pen",
      onPick: () => {
        const swatch = (v: string | null, label: string): MenuItem => ({
          label,
          onPick: () => {
            d.updateNodeC(node.id, { color: v ?? undefined });
            void d.saveBoard();
          },
        });
        const items2: MenuItem[] = [
          swatch(null, "Default"),
          swatch("1", "Red"),
          swatch("2", "Orange"),
          swatch("3", "Yellow"),
          swatch("4", "Green"),
          swatch("5", "Cyan"),
          swatch("6", "Purple"),
        ];
        d.openMenu({ x: cx, y: cy, items: items2 });
      },
    });
    if (fileKind(file) === "image") {
      items.push({
        label: "Inspect",
        icon: "image",
        onPick: () => d.setInspectPath(file),
      });
    }
    if (fileKind(file) === "text" || fileKind(file) === "code") {
      items.push({
        label: "Edit in place",
        icon: "type",
        hint: "dbl-click",
        onPick: () => void d.startFileEdit(node),
      });
    }
    if (typeof node["box-ink"] === "string") {
      items.push({
        label: "Clear ink strokes",
        icon: "eraser",
        onPick: () =>
          void (async () => {
            const rel = node["box-ink"];
            if (typeof rel !== "string") return;
            const root = useBoxStore.getState().workspaceRoot;
            if (!root) return;
            await window.box!.trashFile(root, rel);
            d.updateNode(node.id, { "box-ink": undefined });
            const m = new Map(d.inkMap);
            m.delete(node.id);
            d.setInkMap(m);
            await d.saveBoard();
          })(),
      });
    }
    items.push(
      {
        label: "Remove from canvas",
        icon: "file",
        onPick: () => void d.deleteNode(node.id),
      },
      {
        label: "Move file to Recycle Bin",
        icon: "trash",
        danger: true,
        onPick: () =>
          void (async () => {
            const r = await window.box!.trashFile(
              useBoxStore.getState().workspaceRoot!,
              file,
            );
            if (r.ok) {
              // The node would render broken (I-7); an intentional delete
              // removes the placement too - the watcher reconciles edges.
              d.removeNodeC(node.id);
              await d.saveBoard();
              await d.rescan();
            } else {
              problems(`trash failed: ${r.error}`);
            }
          })(),
      },
    );
  } else {
    if (node.type === "group") {
      // ADR-0008 regions: a group carrying `box-region` is a named zone
      // with parameters. label=region name, locked=children ignore drags.
      const region = node["box-region"] as
        { v?: number; locked?: boolean } | undefined;
      if (region === undefined) {
        items.push({
          label: "Make region",
          icon: "box",
          onPick: () => {
            d.updateNodeC(node.id, { "box-region": { v: 1, locked: false } });
            void d.saveBoard();
          },
        });
      } else {
        items.push(
          {
            label:
              region.locked === true ? "Unlock children" : "Lock children",
            icon: "move",
            onPick: () => {
              d.updateNodeC(node.id, {
                "box-region": { ...region, locked: region.locked !== true },
              });
              void d.saveBoard();
            },
          },
          {
            label: "Remove region",
            icon: "file",
            onPick: () => {
              d.updateNodeC(node.id, { "box-region": undefined });
              void d.saveBoard();
            },
          },
        );
      }
    }
    items.push({
      label: "Remove from canvas",
      icon: "file",
      onPick: () => void d.deleteNode(node.id),
    });
  }
  return items;
}
