// SPDX-License-Identifier: LicenseRef-Proprietary
// useNodeOps.ts - node lifecycle: create/place/import/paste/delete/
// group/ungroup/duplicate, arrow-drop node+edge creation, in-place
// file editing (FR-104), and the OS file-drop hookup. Extracted from
// App.tsx; every mutation goes through the capture-undo wrappers and
// ends in saveBoard, and external bytes land as real files first
// (files-are-truth - nodes only reference workspace-rel paths).

import type { CanvasEdge, CanvasNode, Side } from "@box/core";
import { createEdgePlan, newNodeId } from "@box/core";
import type { Camera } from "@box/ui";
import { gridPlaceRect, screenToWorld, useBoxStore } from "@box/ui";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { applyPlan } from "./bridge.js";

export function useNodeOps(deps: {
  saveBoard: () => Promise<void>;
  rescan: () => Promise<void>;
  addNodeC: (n: CanvasNode) => void;
  removeNodeC: (id: string) => void;
  updateNodeC: (id: string, patch: Record<string, unknown>) => void;
  addEdge: (e: CanvasEdge) => void;
  fileTexts: Map<string, string>;
  setFileTexts: Dispatch<SetStateAction<Map<string, string>>>;
  camRef: { current: Camera };
  vpElRef: { current: HTMLDivElement | null };
  jumpToNode: (id: string) => void;
}) {
  const {
    saveBoard,
    rescan,
    addNodeC,
    removeNodeC,
    updateNodeC,
    addEdge,
    fileTexts,
    setFileTexts,
    camRef,
    vpElRef,
    jumpToNode,
  } = deps;
  const { workspaceRoot } = useBoxStore();

  // The text node currently being edited in place (double-click create,
  // drop-edge target, or commit target).
  const [editingNode, setEditingNode] = useState<string | null>(null);
  // FR-104: text-kind file node being edited in place.
  const [fileEdit, setFileEdit] = useState<{
    nodeId: string;
    file: string;
    text: string;
  } | null>(null);

  // Node creation: double-click empty canvas or drop a file from the list.
  const createTextNode = async (wx: number, wy: number) => {
    const node: CanvasNode = {
      id: newNodeId(),
      type: "text",
      x: Math.round(wx),
      y: Math.round(wy),
      width: 220,
      height: 90,
      text: "",
    };
    addNodeC(node);
    setEditingNode(node.id);
    await saveBoard();
  };

  const placeFile = async (path: string, wx: number, wy: number) => {
    await placeFiles([path], wx, wy);
  };

  // N files cascade-diagonal from the drop point; one board write total.
  const placeFiles = async (paths: string[], wx: number, wy: number) => {
    for (let i = 0; i < paths.length; i++) {
      const node: CanvasNode = {
        id: newNodeId(),
        type: "file",
        x: Math.round(wx) + i * 40,
        y: Math.round(wy) + i * 40,
        width: 260,
        height: 180,
        file: paths[i]!,
      };
      addNodeC(node);
    }
    await saveBoard();
  };

  // FR-202: place a Box file at the current viewport center (the "+"
  // affordance) or at a dropped world point (pick-up click).
  const placeAtViewCenter = async (path: string) => {
    const vp = vpElRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const w = screenToWorld(camRef.current, r.width / 2, r.height / 2);
    await placeFiles([path], w.x - 130, w.y - 90);
  };

  // Quick-open pick: already on the board -> jump to it (Obsidian
  // switcher semantics); unplaced -> drop at viewport center.
  const quickOpenPick = async (path: string) => {
    const b = useBoxStore.getState().board;
    const hit = b?.nodes.find((n) => n.type === "file" && n.file === path);
    if (hit) {
      jumpToNode(hit.id);
      return;
    }
    await placeAtViewCenter(path);
  };

  const placeAllGrid = async (paths: string[]) => {
    const nodes = useBoxStore.getState().board?.nodes ?? [];
    const next = [...nodes];
    for (let i = 0; i < paths.length; i++) {
      const g = gridPlaceRect(next, i);
      const node: CanvasNode = {
        id: newNodeId(),
        type: "file",
        x: g.x,
        y: g.y,
        width: 260,
        height: 180,
        file: paths[i]!,
      };
      addNodeC(node);
      next.push(node);
    }
    await saveBoard();
  };

  // External files are COPIED into the workspace (files-are-truth: nodes
  // only ever reference workspace-rel paths). Skipped entries are surfaced,
  // never silent.
  const importAndPlace = async (srcPaths: string[], wx: number, wy: number) => {
    if (!window.box || srcPaths.length === 0) return;
    const r = await window.box.importFiles(srcPaths);
    const s = useBoxStore.getState();
    if (!r.ok || r.skipped.length > 0) {
      s.setProblems(r.skipped.map((x) => `skipped ${x.src}: ${x.reason}`));
    }
    if (r.imported.length > 0) {
      await placeFiles(
        r.imported.map((x) => x.rel),
        wx,
        wy,
      );
      await rescan();
    }
  };

  // Clipboard → canvas: image items become real .png files (pasted bytes
  // are user content, so they land as files like everything else); text
  // becomes a text node already carrying the content.
  const pasteAt = async (wx: number, wy: number) => {
    if (!navigator.clipboard?.read) {
      useBoxStore.getState().setProblems(["clipboard read unsupported"]);
      return;
    }
    let items: ClipboardItem[];
    try {
      items = await navigator.clipboard.read();
    } catch (e) {
      useBoxStore.getState().setProblems([`clipboard read denied: ${e}`]);
      return;
    }
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith("image/"));
      if (imgType) {
        const blob = await item.getType(imgType);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000)
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const r = await window.box!.newBinaryFile(
          "",
          "paste",
          "png",
          btoa(bin),
        );
        if (r.ok && r.path) await placeFile(r.path, wx, wy);
        else
          useBoxStore
            .getState()
            .setProblems([`paste failed: ${r.error ?? "unknown"}`]);
        return;
      }
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        const node: CanvasNode = {
          id: newNodeId(),
          type: "text",
          x: Math.round(wx),
          y: Math.round(wy),
          width: 260,
          height: 120,
          text: text.slice(0, 4000),
        };
        addNodeC(node);
        await saveBoard();
        return;
      }
    }
    useBoxStore.getState().setProblems(["clipboard: nothing placeable"]);
  };

  // Ctrl+V: paste at the viewport center (same content paths as the
  // context-menu paste, just keyboard-driven).
  const pasteAtCenter = async () => {
    const vp = vpElRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const w = screenToWorld(camRef.current, r.width / 2, r.height / 2);
    await pasteAt(w.x, w.y);
  };

  // OS drag-drop: Tauri intercepts file drops (HTML5 never sees them) and
  // reports physical-pixel positions - convert through dpr + the live
  // camera into world coords, import the files, place the nodes.
  useEffect(() => {
    const api = window.box;
    if (!workspaceRoot || !api?.onFileDrop) return;
    let un: (() => void) | null = null;
    void api
      .onFileDrop((paths, x, y) => {
        const el = vpElRef.current;
        if (!el || paths.length === 0) return;
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = screenToWorld(
          camRef.current,
          x / dpr - r.left,
          y / dpr - r.top,
        );
        void importAndPlace(paths, w.x, w.y);
      })
      .then((u) => {
        un = u;
      });
    return () => un?.();
    // importAndPlace reads fresh state internally; workspace gate only
  }, [workspaceRoot]);

  // Arrow released over empty canvas: create the target text node and the
  // edge in one plan (note write, then board write - I-1 ordering holds).
  const dropEdgeAt = async (
    fromId: string,
    fromSide: Side,
    wx: number,
    wy: number,
  ) => {
    const s = useBoxStore.getState();
    const b = s.board;
    const boardPath = s.boardPath;
    if (!workspaceRoot || !b || !boardPath) return;
    const node: CanvasNode = {
      id: newNodeId(),
      type: "text",
      x: Math.round(wx) - 110,
      y: Math.round(wy) - 45,
      width: 220,
      height: 90,
      text: "",
    };
    const grown: typeof b = { ...b, nodes: [...b.nodes, node] };
    const { plan, edge } = createEdgePlan(grown, boardPath, fromId, node.id, {
      fromSide,
      toSide: "left",
    });
    const errors = await applyPlan(workspaceRoot, plan);
    if (errors.length === 0) {
      addNodeC(node);
      addEdge(edge);
      setEditingNode(node.id);
      void rescan();
    } else {
      useBoxStore.getState().setProblems(errors);
    }
  };

  // Delete key on a selected node: remove the placement, keep the file.
  const deleteNode = async (id: string) => {
    removeNodeC(id);
    await saveBoard();
  };

  // Multi-delete: one capture + one board write for the whole set.
  const deleteNodes = async (ids: string[]) => {
    for (const id of ids) removeNodeC(id);
    await saveBoard();
  };

  // JSON Canvas groups: spatial membership (node center inside bounds),
  // so creating a group is just placing a bigger rect around the set.
  const groupSelection = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b) return;
    const ns = b.nodes.filter((n) => ids.includes(n.id));
    if (ns.length === 0) return;
    const PAD = 48;
    const x0 = Math.min(...ns.map((n) => n.x)) - PAD;
    const y0 = Math.min(...ns.map((n) => n.y)) - PAD;
    const x1 = Math.max(...ns.map((n) => n.x + n.width)) + PAD;
    const y1 = Math.max(...ns.map((n) => n.y + n.height)) + PAD;
    addNodeC({
      id: newNodeId(),
      type: "group",
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
      label: "Group",
    });
    await saveBoard();
  };

  // Ungroup removes the group rect only - members are never touched.
  const ungroupSelection = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b) return;
    const groups = ids.filter((id) =>
      b.nodes.some((n) => n.id === id && n.type === "group"),
    );
    for (const id of groups) removeNodeC(id);
    if (groups.length > 0) await saveBoard();
  };

  // Ctrl+D duplicate: text/link/group nodes clone their record; file
  // nodes copy the file on disk first (files-are-truth - two nodes may
  // not share one object identity).
  const duplicateNodes = async (ids: string[]) => {
    const b = useBoxStore.getState().board;
    if (!b || !window.box) return;
    for (const id of ids) {
      const n = b.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (n.type === "file") {
        const r = await window.box.copyFile(n.file);
        if (!r.ok || !r.path) {
          useBoxStore
            .getState()
            .setProblems([`duplicate failed: ${r.error ?? "unknown"}`]);
          continue;
        }
        addNodeC({
          ...n,
          id: newNodeId(),
          x: n.x + 32,
          y: n.y + 32,
          file: r.path,
        });
        continue;
      }
      addNodeC({ ...n, id: newNodeId(), x: n.x + 32, y: n.y + 32 });
    }
    await saveBoard();
    await rescan();
  };

  const commitText = async (id: string, text: string) => {
    updateNodeC(id, { text });
    setEditingNode(null);
    await saveBoard();
  };

  // FR-104: in-place editing for text-kind file nodes - read the file,
  // edit, write back atomically. Round-trips through the same path the
  // excerpt loader uses so the preview refreshes.
  const startFileEdit = async (node: CanvasNode) => {
    const root = useBoxStore.getState().workspaceRoot;
    if (!root || !window.box || node.type !== "file") return;
    const t = await window.box.readFile(root, node.file);
    if (t === null) {
      useBoxStore.getState().setProblems([`cannot read ${node.file}`]);
      return;
    }
    setFileEdit({ nodeId: node.id, file: node.file, text: t });
  };
  const commitFileEdit = async (nodeId: string, text: string) => {
    const fe = fileEdit;
    setFileEdit(null);
    const root = useBoxStore.getState().workspaceRoot;
    if (!fe || fe.nodeId !== nodeId || !root || !window.box) return;
    if (text === fe.text) return;
    const r = await window.box.writeFileAtomic(root, fe.file, text);
    if (!r.ok) {
      useBoxStore.getState().setProblems([`save failed: ${fe.file}`]);
      return;
    }
    setFileTexts(new Map(fileTexts).set(fe.file, text.slice(0, 400)));
  };

  return {
    editingNode,
    fileEdit,
    setFileEdit,
    createTextNode,
    placeFile,
    placeFiles,
    placeAtViewCenter,
    quickOpenPick,
    placeAllGrid,
    importAndPlace,
    pasteAt,
    pasteAtCenter,
    dropEdgeAt,
    deleteNode,
    deleteNodes,
    groupSelection,
    ungroupSelection,
    duplicateNodes,
    commitText,
    startFileEdit,
    commitFileEdit,
  };
}
