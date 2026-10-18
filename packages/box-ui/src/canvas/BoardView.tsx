// SPDX-License-Identifier: LicenseRef-Proprietary
// BoardView - a parsed Board rendered through the Viewport seam:
// EdgeLayer (SVG, world space) under NodeViews (DOM, world space).
// Owns interaction state: node selection, edge selection + delete key,
// and the edge-draft state machine (handle drag -> live preview ->
// drop on target -> onCreateEdge with the sides actually used).

import type { Board, CanvasNode, InkStroke, Side } from "@box/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { DEFAULT_CAMERA, screenToWorld, zoomToFit } from "./camera.js";
import { nodeVisible, worldViewport } from "./cull.js";
import type { DraftEdge } from "./EdgeLayer.js";
import { EdgeHandles, EdgeLayer, anchor } from "./EdgeLayer.js";
import type { InkPoint } from "./ink.js";
import { strokeToPath } from "./ink.js";
import { MiniMap } from "./MiniMap.js";
import { NodeView } from "./NodeView.js";
import { Viewport } from "./Viewport.js";

export interface BoardViewProps {
  board: Board;
  brokenNodes?: Set<string> | undefined;
  brokenEdges?: Set<string> | undefined;
  /** File path -> short text excerpt for document nodes. */
  fileTexts?: Map<string, string> | undefined;
  /** File path -> byte size for typed tiles. */
  fileSizes?: Map<string, number> | undefined;
  /** Node currently in text-edit mode (set by platform on create). */
  editingNode?: string | null | undefined;
  /** File node in content-edit mode + its full current text (FR-104). */
  fileEdit?: { nodeId: string; text: string } | null | undefined;
  /** Ink mode: draw captures strokes on file nodes, erase removes them,
   *  edit selects+drags existing strokes (FR-307 partial). */
  inkMode?: "off" | "draw" | "erase" | "edit" | undefined;
  /** Active ink stroke color (CSS color, default "#e8b931"). */
  inkColor?: string | undefined;
  /** Active ink stroke width in px (default 10). */
  inkSize?: number | undefined;
  /** Parsed .ink.svg strokes per node id (platform loads sidecars). */
  inkByNodeId?: Map<string, InkStroke[]> | undefined;
  resolveMedia?: ((rel: string) => string) | undefined;
  resolveIcon?: ((rel: string) => Promise<string | null>) | undefined;
  resolveThumb?: ((rel: string) => Promise<string | null>) | undefined;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, w: number, h: number) => void;
  onCommit?: () => void;
  onTextCommit?: (id: string, text: string) => void;
  onFileCommit?: (id: string, text: string) => void;
  onFileEditCancel?: (id: string) => void;
  onEditFile?: ((node: CanvasNode) => void) | undefined;
  /** Finished ink stroke: node-local points with pressure (FR-105). */
  onInkStroke?: (nodeId: string, points: InkPoint[]) => void;
  /** Eraser pass over node-local point (FR-106). */
  onInkErase?: (nodeId: string, lx: number, ly: number) => void;
  /** Ink edit mode: stroke dragged by (dx, dy) node-local px. */
  onInkStrokeMove?:
    | ((nodeId: string, strokeIndex: number, dx: number, dy: number) => void)
    | undefined;
  /** Imperative focus request: camera fits this node when nonce changes. */
  focusNode?: { id: string; nonce: number } | null | undefined;
  /** Imperative zoom-to-fit request: camera fits all nodes (Shift+1). */
  fitAllRequest?: { nonce: number } | undefined;
  onDeleteNode?: (id: string) => void;
  /** Batch placement-removal (one board write); falls back to onDeleteNode. */
  onDeleteNodes?: (ids: string[]) => void;
  /** Ctrl+G: wrap the selection in a spec `group` node (spatial members). */
  onGroup?: (ids: string[]) => void;
  /** Ctrl+Shift+G: remove group nodes in the selection (children stay). */
  onUngroup?: (ids: string[]) => void;
  /** Ctrl+D: duplicate the selection (files copy on disk - truth). */
  onDuplicate?: (ids: string[]) => void;
  /** Ctrl+V: platform pastes clipboard content at viewport center. */
  onPasteRequest?: () => void;
  /** Edge endpoint dropped on a node - re-route keeping id + note. */
  onRetargetEdge?: (
    edgeId: string,
    end: "from" | "to",
    nodeId: string,
    side: Side,
  ) => void;
  onCreateEdge?: (
    fromNodeId: string,
    toNodeId: string,
    fromSide: Side,
    toSide: Side,
  ) => void;
  onDeleteEdge?: (edgeId: string) => void;
  /** Fires on every edge-selection change (id, or null when cleared). */
  onSelectEdge?: (edgeId: string | null) => void;
  /** Workspace file dropped onto the canvas at world coords. */
  onDropFile?: (path: string, wx: number, wy: number) => void;
  /** Double-click on empty canvas at world coords (text-node affordance). */
  onEmptyDoubleClick?: (wx: number, wy: number) => void;
  /** Double-click on an image node -> full-window inspector (PureRef/Eagle). */
  onInspectNode?: (nodeId: string) => void;
  /** Double-click on a non-image file node -> OS default app. */
  onOpenFile?: (file: string) => void;
  /** Alt+double-click on a file node -> OS file manager. */
  onRevealFile?: (file: string) => void;
  /** Right-click on empty canvas (world + client coords for menus). */
  onCanvasMenu?: (wx: number, wy: number, cx: number, cy: number) => void;
  /** Right-click on a node (client coords for menus). */
  onNodeMenu?: (node: CanvasNode, cx: number, cy: number) => void;
  /** Camera stream - the platform needs live camera for OS-drop->world. */
  onCameraChange?: (cam: Camera) => void;
  /** External ref to the viewport element (for drop coord conversion). */
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  /** Edge draft released over empty canvas - "connect to nothing yet". */
  onDropEdgeAt?: (
    fromId: string,
    fromSide: Side,
    wx: number,
    wy: number,
  ) => void;
}

interface Draft {
  fromId: string;
  fromSide: Side;
  x: number;
  y: number;
  overId: string | null;
}

/** Edge re-route gesture: which endpoint is being dragged + cursor pos. */
interface Retarget {
  edgeId: string;
  end: "from" | "to";
  x: number;
  y: number;
  overId: string | null;
}

/** Side of `node` facing `wx,wy` - dominant axis from the node's center. */
function sideToward(node: CanvasNode, wx: number, wy: number): Side {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = wx - cx;
  const dy = wy - cy;
  return Math.abs(dx) > Math.abs(dy)
    ? dx > 0
      ? "right"
      : "left"
    : dy > 0
      ? "bottom"
      : "top";
}

export function BoardView(props: BoardViewProps) {
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const innerVpRef = useRef<HTMLDivElement | null>(null);
  // Callers (the app) get the same element for drop coordinate math.
  const vpRef = props.viewportRef ?? innerVpRef;

  // Camera stream outward: Tauri file-drop events land as window coords
  // and need the live camera to convert to world space.
  useEffect(() => {
    props.onCameraChange?.(cam);
  }, [cam]);

  // Open = fit everything (mounted once per board via key={boardPath}).
  useEffect(() => {
    const el = vpRef.current;
    if (!el || props.board.nodes.length === 0) return;
    const r = el.getBoundingClientRect();
    const xs = props.board.nodes.map((n) => [n.x, n.x + n.width]).flat();
    const ys = props.board.nodes.map((n) => [n.y, n.y + n.height]).flat();
    setCam(
      zoomToFit(
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        },
        r.width,
        r.height,
      ),
    );
    // mount-only: fit once when the board opens
  }, []);

  // Zoom-to-fit request (Shift+1): refit all nodes when nonce changes.
  useEffect(() => {
    if (!props.fitAllRequest) return;
    const el = vpRef.current;
    if (!el || props.board.nodes.length === 0) return;
    const r = el.getBoundingClientRect();
    const xs = props.board.nodes.map((n) => [n.x, n.x + n.width]).flat();
    const ys = props.board.nodes.map((n) => [n.y, n.y + n.height]).flat();
    setCam(
      zoomToFit(
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        },
        r.width,
        r.height,
      ),
    );
  }, [props.fitAllRequest?.nonce]);

  // Viewport size for culling - ResizeObserver so panel toggles re-measure.
  const [vpSize, setVpSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setVpSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setVpSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [retarget, setRetarget] = useState<Retarget | null>(null);
  const [inkDraft, setInkDraft] = useState<{
    nodeId: string;
    points: InkPoint[];
  } | null>(null);
  const inkDraftRef = useRef<{
    nodeId: string;
    points: InkPoint[];
  } | null>(null);

  // Perf (500-node pan): NodeView is memoized, so every callback it receives
  // must be referentially stable - otherwise camera state changes re-render
  // all nodes every frame. Live values (props, camera, draft) travel through
  // refs; handlers read them at event time.
  const propsRef = useRef(props);
  propsRef.current = props;
  const camRef = useRef(cam);
  camRef.current = cam;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selRef = useRef(sel);
  selRef.current = sel;
  const nudgeTimer = useRef<number | null>(null);

  const nodeById = (id: string) =>
    propsRef.current.board.nodes.find((x) => x.id === id);
  const nodeAtW = (wx: number, wy: number): CanvasNode | null => {
    const nodes = propsRef.current.board.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height)
        return n;
    }
    return null;
  };

  // ADR-0008 locked regions: a non-group node whose center sits inside a
  // region with locked:true cannot move on its own - drags, marquee
  // multi-drags, and nudges ignore it. A dragged region still carries its
  // members (the carry block in onMove skips this check).
  // Members carried by an in-flight group drag; snapshotted at gesture
  // start so fast drags can't outrun members at the region edge.
  const carryIdsRef = useRef<Set<string> | null>(null);

  const lockOwner = (n: CanvasNode): string | null => {
    if (n.type === "group") return null;
    const cx = n.x + n.width / 2;
    const cy = n.y + n.height / 2;
    for (const g of propsRef.current.board.nodes) {
      if (g.type !== "group") continue;
      const r = g["box-region"] as { locked?: boolean } | undefined;
      if (r?.locked !== true) continue;
      if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height)
        return g.id;
    }
    return null;
  };

  const nodeHandlers = useMemo(() => {
    return {
      onSelect: (id: string, additive: boolean) => {
        setSel((cur) => {
          if (additive) {
            const next = new Set(cur);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }
          // Pressing an already-selected node keeps the set so group drag
          // works; pressing an unselected one collapses to just it.
          return cur.has(id) ? cur : new Set([id]);
        });
        setSelectedEdge(null);
        propsRef.current.onSelectEdge?.(null);
      },
      onMove: (id: string, x: number, y: number) => {
        const cur = propsRef.current;
        const dragged = cur.board.nodes.find((n) => n.id === id);
        if (!dragged) return;
        if (lockOwner(dragged) !== null) return;
        // Group move: when a selected node is dragged, every other selected
        // node travels by the same delta (standard canvas-app behavior).
        const dx = x - dragged.x;
        const dy = y - dragged.y;
        const selIds = selRef.current;
        if (selIds.size > 1 && selIds.has(id)) {
          for (const oid of selIds) {
            if (oid === id) continue;
            const n = cur.board.nodes.find((m) => m.id === oid);
            if (n && lockOwner(n) === null)
              cur.onMove?.(oid, n.x + dx, n.y + dy);
          }
        }
        // Spatial groups (JSON Canvas): dragging a group drags every member.
        // Membership is snapshotted once at gesture start - re-checking live
        // bounds per frame lets a fast drag outrun a member and strand it
        // just outside the region edge.
        if (dragged.type === "group") {
          if (carryIdsRef.current === null) {
            carryIdsRef.current = new Set(
              cur.board.nodes
                .filter((n) => {
                  if (n.id === id || n.type === "group") return false;
                  const cx = n.x + n.width / 2;
                  const cy = n.y + n.height / 2;
                  return (
                    cx >= dragged.x &&
                    cx <= dragged.x + dragged.width &&
                    cy >= dragged.y &&
                    cy <= dragged.y + dragged.height
                  );
                })
                .map((n) => n.id),
            );
          }
          for (const nid of carryIdsRef.current) {
            if (selIds.size > 1 && selIds.has(nid)) continue;
            const n = cur.board.nodes.find((m) => m.id === nid);
            if (n) cur.onMove?.(n.id, n.x + dx, n.y + dy);
          }
        }
        cur.onMove?.(id, x, y);
      },
      onResize: (id: string, w: number, h: number) =>
        propsRef.current.onResize?.(id, w, h),
      onCommit: () => {
        carryIdsRef.current = null;
        propsRef.current.onCommit?.();
      },
      onTextCommit: (id: string, t: string) =>
        propsRef.current.onTextCommit?.(id, t),
      onFileCommit: (id: string, t: string) =>
        propsRef.current.onFileCommit?.(id, t),
      onFileEditCancel: (id: string) => propsRef.current.onFileEditCancel?.(id),
      onEditFile: (n: CanvasNode) => propsRef.current.onEditFile?.(n),
      onInkStart: (id: string, lx: number, ly: number, p: number) => {
        const next = { nodeId: id, points: [{ x: lx, y: ly, p }] };
        inkDraftRef.current = next;
        setInkDraft(next);
      },
      onInkMove: (id: string, lx: number, ly: number, p: number) => {
        const d = inkDraftRef.current;
        if (!d || d.nodeId !== id) return;
        const next = { ...d, points: [...d.points, { x: lx, y: ly, p }] };
        inkDraftRef.current = next;
        setInkDraft(next);
      },
      onInkEnd: (id: string) => {
        const cur = inkDraftRef.current;
        if (cur && cur.nodeId === id && cur.points.length > 0)
          propsRef.current.onInkStroke?.(id, cur.points);
        inkDraftRef.current = null;
        setInkDraft(null);
      },
      onInkErase: (id: string, lx: number, ly: number) =>
        propsRef.current.onInkErase?.(id, lx, ly),
      onInkStrokeMove: (id: string, i: number, dx: number, dy: number) =>
        propsRef.current.onInkStrokeMove?.(id, i, dx, dy),
      onInspect: (id: string) => propsRef.current.onInspectNode?.(id),
      onOpenExternal: (rel: string) => propsRef.current.onOpenFile?.(rel),
      onReveal: (rel: string) => propsRef.current.onRevealFile?.(rel),
      onContextMenu: (n: CanvasNode, cx: number, cy: number) =>
        propsRef.current.onNodeMenu?.(n, cx, cy),
      onDraftStart: (nodeId: string, side: Side) => {
        const n = nodeById(nodeId);
        if (!n) return;
        const w = anchor(n, side);
        setDraft({
          fromId: nodeId,
          fromSide: side,
          x: w.x,
          y: w.y,
          overId: null,
        });
      },
      onDraftMove: (wx: number, wy: number) => {
        setDraft((d) => {
          if (!d) return d;
          const over = nodeAtW(wx, wy);
          return {
            ...d,
            x: wx,
            y: wy,
            overId: over && over.id !== d.fromId ? over.id : null,
          };
        });
      },
      onDraftEnd: (wx: number, wy: number) => {
        const d = draftRef.current;
        if (d) {
          const over = nodeAtW(wx, wy);
          if (over && over.id !== d.fromId) {
            propsRef.current.onCreateEdge?.(
              d.fromId,
              over.id,
              d.fromSide,
              sideToward(over, wx, wy),
            );
          } else if (over === null) {
            propsRef.current.onDropEdgeAt?.(d.fromId, d.fromSide, wx, wy);
          }
        }
        setDraft(null);
      },
    };
  }, []);

  // Jump-to-object: platform sets {id, nonce}; camera fits the node once
  // per request (FR-205).
  useEffect(() => {
    if (!props.focusNode) return;
    const n = props.board.nodes.find((x) => x.id === props.focusNode?.id);
    const el = vpRef.current;
    if (!n || !el) return;
    const r = el.getBoundingClientRect();
    setCam(
      zoomToFit(
        { x: n.x - 80, y: n.y - 80, w: n.width + 160, h: n.height + 160 },
        r.width,
        r.height,
      ),
    );
    setSel(new Set([n.id]));
  }, [props.focusNode?.nonce]);
  const brokenNodes = props.brokenNodes ?? useMemo(() => new Set<string>(), []);
  const brokenEdges = useMemo(() => {
    if (props.brokenEdges) return props.brokenEdges;
    const ids = new Set(props.board.nodes.map((n) => n.id));
    return new Set(
      props.board.edges
        .filter((e) => !ids.has(e.fromNode) || !ids.has(e.toNode))
        .map((e) => e.id),
    );
  }, [props.board, props.brokenEdges]);

  // Single funnel so every selection change reports outward (note panel).
  const selectEdge = (id: string | null) => {
    setSelectedEdge(id);
    props.onSelectEdge?.(id);
  };

  // Selection keys: escape, delete, ctrl/cmd+A, arrow nudge. Guarded so
  // text inputs/areas keep their own semantics.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt?.closest?.("input,textarea,[contenteditable='true']")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        setSel(new Set());
        selectEdge(null);
        setDraft(null);
      } else if (mod && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSel(new Set(props.board.nodes.map((n) => n.id)));
      } else if (e.shiftKey && e.key === "@") {
        // Shift+2: zoom to selection (Obsidian convention).
        if (sel.size === 0) return;
        e.preventDefault();
        const ns = props.board.nodes.filter((n) => sel.has(n.id));
        const x0 = Math.min(...ns.map((n) => n.x));
        const y0 = Math.min(...ns.map((n) => n.y));
        const x1 = Math.max(...ns.map((n) => n.x + n.width));
        const y1 = Math.max(...ns.map((n) => n.y + n.height));
        const r = vpRef.current?.getBoundingClientRect();
        if (r)
          setCam(
            zoomToFit(
              { x: x0 - 60, y: y0 - 60, w: x1 - x0 + 120, h: y1 - y0 + 120 },
              r.width,
              r.height,
            ),
          );
      } else if (e.shiftKey && e.key === ")") {
        // Shift+0: reset to 100% zoom about the current view center.
        e.preventDefault();
        const r = vpRef.current?.getBoundingClientRect();
        if (r)
          setCam((c) => ({
            z: 1,
            x: c.x + (r.width / 2) * (1 / c.z - 1),
            y: c.y + (r.height / 2) * (1 / c.z - 1),
          }));
      } else if (mod && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) props.onUngroup?.([...sel]);
        else if (sel.size > 0) props.onGroup?.([...sel]);
      } else if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        if (sel.size > 0) props.onDuplicate?.([...sel]);
      } else if (mod && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        props.onPasteRequest?.();
      } else if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        if (sel.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 50 : 10;
        const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy =
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        for (const id of sel) {
          const n = props.board.nodes.find((m) => m.id === id);
          if (n && lockOwner(n) === null)
            props.onMove?.(id, n.x + dx, n.y + dy);
        }
        // Held-arrow repeats coalesce into one board write after the burst.
        if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
        nudgeTimer.current = window.setTimeout(() => props.onCommit?.(), 350);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdge) {
          props.onDeleteEdge?.(selectedEdge);
          selectEdge(null);
        } else if (sel.size > 0) {
          // Removing a node removes the placement only - the file stays,
          // its edges render broken (I-7), and notes are never destroyed.
          if (props.onDeleteNodes) props.onDeleteNodes([...sel]);
          else for (const id of sel) props.onDeleteNode?.(id);
          setSel(new Set());
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    sel,
    selectedEdge,
    props.board,
    props.onDeleteEdge,
    props.onDeleteNode,
    props.onDeleteNodes,
    props.onGroup,
    props.onUngroup,
    props.onDuplicate,
    props.onPasteRequest,
    props.onMove,
    props.onCommit,
  ]);

  // tldraw culling: off-viewport nodes get display:none (still in the DOM -
  // hit-testable, selectable, exportable) but skip paint/layout cost.
  const view = useMemo(
    () => (vpSize ? worldViewport(cam, vpSize.w, vpSize.h) : null),
    [cam, vpSize],
  );
  const unCullable = useMemo(() => {
    const s = new Set<string>(sel);
    if (props.editingNode) s.add(props.editingNode);
    if (props.fileEdit?.nodeId) s.add(props.fileEdit.nodeId);
    if (inkDraft?.nodeId) s.add(inkDraft.nodeId);
    return s;
  }, [sel, props.editingNode, props.fileEdit?.nodeId, inkDraft?.nodeId]);

  // Marquee: rubber-band rect in world space; hits replace the set, or
  // union into it when shift was held at drag start (standard behavior).
  const onMarquee = useCallback(
    (
      rect: { x: number; y: number; w: number; h: number },
      _phase: "move" | "end",
      additive: boolean,
    ) => {
      const hits = new Set(
        props.board.nodes
          .filter(
            (n) =>
              n.x < rect.x + rect.w &&
              n.x + n.width > rect.x &&
              n.y < rect.y + rect.h &&
              n.y + n.height > rect.y,
          )
          .map((n) => n.id),
      );
      setSel(additive ? new Set([...selRef.current, ...hits]) : hits);
      if (hits.size > 0) selectEdge(null);
    },
    [props.board.nodes],
  );

  // Edge re-route: pointerdown on a selected edge's endpoint handle starts
  // the gesture; window listeners track the cursor until drop (Obsidian/
  // tldraw re-route pattern). Dropping on a node re-anchors that endpoint;
  // dropping on empty canvas cancels.
  useEffect(() => {
    if (retarget === null) return;
    const vp = vpRef.current;
    const move = (e: PointerEvent) => {
      if (vp === null) return;
      const r = vp.getBoundingClientRect();
      const w = screenToWorld(
        camRef.current,
        e.clientX - r.left,
        e.clientY - r.top,
      );
      const over = nodeAtW(w.x, w.y);
      setRetarget((rt) =>
        rt === null ? rt : { ...rt, x: w.x, y: w.y, overId: over?.id ?? null },
      );
    };
    const up = (e: PointerEvent) => {
      const rt = retarget;
      setRetarget(null);
      if (vp === null || rt === null) return;
      const r = vp.getBoundingClientRect();
      const w = screenToWorld(
        camRef.current,
        e.clientX - r.left,
        e.clientY - r.top,
      );
      const over = nodeAtW(w.x, w.y);
      if (over !== null) {
        const edge = propsRef.current.board.edges.find(
          (x) => x.id === rt.edgeId,
        );
        // Reject no-op drops (same endpoint back on its own node).
        const same =
          edge !== undefined &&
          ((rt.end === "to" && edge.toNode === over.id) ||
            (rt.end === "from" && edge.fromNode === over.id));
        // A node cannot edge to itself.
        const self =
          edge !== undefined &&
          ((rt.end === "to" && edge.fromNode === over.id) ||
            (rt.end === "from" && edge.toNode === over.id));
        if (!same && !self)
          propsRef.current.onRetargetEdge?.(
            rt.edgeId,
            rt.end,
            over.id,
            sideToward(over, w.x, w.y),
          );
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [retarget !== null]);

  // Live draft geometry while re-routing: the dragged endpoint follows the
  // cursor, the fixed endpoint keeps its anchor.
  const retargetGeom: DraftEdge | null = useMemo(() => {
    if (retarget === null) return null;
    const e = props.board.edges.find((x) => x.id === retarget.edgeId);
    if (e === undefined) return null;
    const fixed = nodeById(retarget.end === "to" ? e.fromNode : e.toNode);
    if (fixed === undefined) return null;
    const fixedAnchor = anchor(
      fixed,
      retarget.end === "to" ? (e.fromSide ?? "right") : (e.toSide ?? "left"),
    );
    const cursor = { x: retarget.x, y: retarget.y, nx: 0, ny: 0 };
    return retarget.end === "to"
      ? { from: fixedAnchor, to: cursor, overTarget: retarget.overId !== null }
      : { from: cursor, to: fixedAnchor, overTarget: retarget.overId !== null };
  }, [retarget, props.board.edges]);

  const draftGeom: DraftEdge | null = useMemo(() => {
    if (!draft) return null;
    const fromNode = props.board.nodes.find((n) => n.id === draft.fromId);
    if (!fromNode) return null;
    const a = anchor(fromNode, draft.fromSide);
    if (draft.overId) {
      const over = props.board.nodes.find((n) => n.id === draft.overId);
      if (over) {
        const ta = anchor(over, sideToward(over, draft.x, draft.y));
        return { from: a, to: ta, overTarget: true };
      }
    }
    return {
      from: a,
      to: { x: draft.x, y: draft.y, nx: 0, ny: 0 },
      overTarget: false,
    };
  }, [draft, props.board]);

  return (
    <Viewport
      camera={cam}
      onCameraChange={setCam}
      className={
        props.inkMode === "draw"
          ? "ink-draw"
          : props.inkMode === "erase"
            ? "ink-erase"
            : props.inkMode === "edit"
              ? "ink-edit"
              : undefined
      }
      onBackgroundClick={() => {
        setSel(new Set());
        selectEdge(null);
      }}
      viewportRef={vpRef}
      onDropFile={props.onDropFile}
      onEmptyDoubleClick={props.onEmptyDoubleClick}
      onBackgroundMenu={props.onCanvasMenu}
      onMarquee={onMarquee}
      overlay={
        vpSize ? (
          <MiniMap
            board={props.board}
            viewRect={{
              x: cam.x,
              y: cam.y,
              w: vpSize.w / cam.z,
              h: vpSize.h / cam.z,
            }}
            onNavigate={(wx, wy) =>
              setCam((c) => ({
                ...c,
                x: wx - vpSize.w / c.z / 2,
                y: wy - vpSize.h / c.z / 2,
              }))
            }
          />
        ) : undefined
      }
    >
      <EdgeLayer
        board={props.board}
        brokenEdges={brokenEdges}
        selectedId={selectedEdge}
        viewRect={view ?? undefined}
        zoom={cam.z}
        onSelect={(id) => {
          selectEdge(id);
          setSel(new Set());
        }}
        draft={retargetGeom ?? draftGeom}
      />
      {[...props.board.nodes]
        // Groups render behind their spatial members (JSON Canvas
        // convention - a group is a labeled region, not a z-sibling).
        .sort(
          (a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1),
        )
        .map((n) => (
          <NodeView
            key={n.id}
            node={n}
            cameraRef={camRef}
            culled={
              view !== null && !unCullable.has(n.id) && !nodeVisible(n, view)
            }
            selected={sel.has(n.id)}
            broken={brokenNodes.has(n.id)}
            dropTarget={draft?.overId === n.id}
            resolveMedia={props.resolveMedia}
            resolveIcon={props.resolveIcon}
            resolveThumb={props.resolveThumb}
            excerpt={
              n.type === "file" ? props.fileTexts?.get(n.file) : undefined
            }
            fileSize={
              n.type === "file" ? props.fileSizes?.get(n.file) : undefined
            }
            editing={
              props.editingNode === n.id || props.fileEdit?.nodeId === n.id
            }
            fileEditText={
              props.fileEdit?.nodeId === n.id ? props.fileEdit.text : undefined
            }
            ink={props.inkByNodeId?.get(n.id)}
            inkMode={props.inkMode}
            {...nodeHandlers}
          />
        ))}
      {/* Endpoint handles for the selected edge render after the node DOM so
          they sit above nodes - the anchor point is on a node's border. */}
      <EdgeHandles
        board={props.board}
        selectedId={selectedEdge}
        zoom={cam.z}
        onRetargetStart={(edgeId, end) => {
          const e = propsRef.current.board.edges.find((x) => x.id === edgeId);
          const n = nodeById(
            end === "to" ? (e?.toNode ?? "") : (e?.fromNode ?? ""),
          );
          if (n === undefined) return;
          const a = anchor(
            n,
            end === "to" ? (e?.toSide ?? "left") : (e?.fromSide ?? "right"),
          );
          setRetarget({ edgeId, end, x: a.x, y: a.y, overId: null });
        }}
      />
      {(() => {
        if (!inkDraft) return null;
        const n = props.board.nodes.find((x) => x.id === inkDraft.nodeId);
        if (!n) return null;
        return (
          <svg
            className="ink-draft"
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: n.width,
              height: n.height,
              overflow: "visible",
              pointerEvents: "none",
            }}
            viewBox={`0 0 ${n.width} ${n.height}`}
            preserveAspectRatio="none"
          >
            <path
              d={strokeToPath(inkDraft.points, props.inkSize ?? 10)}
              fill={props.inkColor ?? "#e8b931"}
            />
          </svg>
        );
      })()}
    </Viewport>
  );
}
