// SPDX-License-Identifier: LicenseRef-Proprietary
// FileTree - the Obsidian explorer pattern: hierarchical vault tree inside
// a persistent sidebar. Folders first, alphabetical; chevron toggles
// expand; file rows carry type icons and drag onto the canvas with the
// same application/x-box-file payload the flat FileList used. The whole
// point vs the old list: the tree stays visible while a board is open.

import { useMemo, useState } from "react";
import { Icon, type IconName } from "./icons.js";
import type { WorkspaceFile } from "./store.js";

interface TreeDir {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}
interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}
type TreeNode = TreeDir | TreeFile;

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, TreeDir>([["", root]]);
  const ensureDir = (path: string): TreeDir => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const parent = ensureDir(path.split("/").slice(0, -1).join("/"));
    const dir: TreeDir = {
      kind: "dir",
      name: path.split("/").pop() ?? path,
      path,
      children: [],
    };
    dirs.set(path, dir);
    parent.children.push(dir);
    return dir;
  };
  for (const f of files) {
    const parts = f.path.split("/");
    const parent = ensureDir(parts.slice(0, -1).join("/"));
    parent.children.push({
      kind: "file",
      name: parts[parts.length - 1]!,
      path: f.path,
    });
  }
  const sort = (ns: TreeNode[]) =>
    ns.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "dir"
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    );
  const walk = (d: TreeDir) => {
    sort(d.children);
    for (const c of d.children) if (c.kind === "dir") walk(c);
  };
  walk(root);
  return root.children;
}

function fileIcon(path: string): IconName {
  const p = path.toLowerCase();
  if (p.endsWith(".box.canvas")) return "board";
  if (/\.(png|jpe?g|webp|gif|avif|tiff?)$/.test(p)) return "image";
  if (/\.(mp4|webm|mov|mkv)$/.test(p)) return "film";
  if (/\.(mp3|wav|flac|ogg|m4a)$/.test(p)) return "music";
  if (/^link-[0-9a-f]{16}\.md$/.test(p.split("/").pop() ?? "")) return "link";
  if (p.endsWith(".md") || p.endsWith(".txt")) return "fileText";
  return "file";
}

/**
 * DATA-MODEL §1: returns true when `path` is a user object eligible for
 * "The Box" (unplaced holding area), excluding app-managed `.box/` files,
 * root-level `link-<16hex>.md` relationship notes, and bound `.ink.svg`
 * sidecar overlays.
 */
export function isBoxUserObject(
  path: string,
  boundInkPaths?: ReadonlySet<string>,
): boolean {
  if (path === ".box" || path.startsWith(".box/")) return false;
  if (!/\//.test(path) && /^link-[0-9a-f]{16}\.md$/.test(path)) return false;
  if (boundInkPaths?.has(path)) return false;
  return true;
}

export function FileTree(props: {
  files: WorkspaceFile[];
  /** Currently open board - highlighted in the tree. */
  activePath?: string | undefined;
  onOpen?: (path: string) => void;
  /**
   * FR-202 "the Box": when set, only user files NOT placed on any board
   * show - placing one makes it leave the list.
   */
  unplacedOnly?: boolean | undefined;
  placedPaths?: Set<string> | undefined;
  boundInkPaths?: Set<string> | undefined;
}) {
  const visible = useMemo(
    () =>
      props.unplacedOnly
        ? props.files.filter(
            (f) =>
              isBoxUserObject(f.path, props.boundInkPaths) &&
              !props.placedPaths?.has(f.path),
          )
        : props.files,
    [props.files, props.unplacedOnly, props.placedPaths, props.boundInkPaths],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  // Top-level dirs start expanded (better first-run demo); toggles persist
  // for the component's life - the tree remounts per workspace anyway.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => (
    <li key={n.path}>
      {n.kind === "dir" ? (
        <>
          <button
            className="tree-row tree-dir"
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => toggle(n.path)}
          >
            <Icon
              name={collapsed.has(n.path) ? "chevronRight" : "chevronDown"}
              size={12}
            />
            <Icon name="folder" size={14} />
            <span>{n.name}</span>
          </button>
          {!collapsed.has(n.path) && (
            <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>
          )}
        </>
      ) : (
        <button
          className={
            "tree-row tree-file" +
            (props.activePath === n.path ? " active" : "") +
            (n.path.endsWith(".box.canvas") ? " is-board" : "")
          }
          style={{ paddingLeft: 6 + depth * 14 + 16 }}
          draggable
          title={
            n.path.endsWith(".box.canvas")
              ? "click to open - or drag onto a board to place"
              : "drag onto a board to place it"
          }
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-box-file", n.path)
          }
          onClick={() => {
            if (n.path.endsWith(".box.canvas")) props.onOpen?.(n.path);
          }}
        >
          <Icon name={fileIcon(n.path)} size={14} />
          <span>{n.name}</span>
        </button>
      )}
    </li>
  );

  return (
    <div className="file-tree">
      <ul>{tree.map((n) => renderNode(n, 0))}</ul>
      {visible.length === 0 && (
        <p className="empty">
          {props.unplacedOnly
            ? "The Box is empty - everything is placed."
            : "No files in this workspace yet."}
        </p>
      )}
    </div>
  );
}
