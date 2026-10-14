// SPDX-License-Identifier: LicenseRef-Proprietary
// BoardView - a parsed Board rendered through the Viewport seam:
// EdgeLayer (SVG, world space) under NodeViews (DOM, world space).
// Owns interaction state: node selection, edge selection + delete key,
// and the edge-draft state machine (handle drag -> live preview ->
// drop on target -> onCreateEdge with the sides actually used).

import type { Board, CanvasNode, InkStroke, Side } from "@box/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Camera } from "./camera.js";
import { DEFAULT_CAMERA, zoomToFit } from "./camera.js";
import { nodeVisible, worldViewport } from "./cull.js";
import type { DraftEdge } from "./EdgeLayer.js";
import { EdgeLayer, anchor } from "./EdgeLayer.js";
import type { InkPoint } from "./ink.js";
import { strokeToPath } from "./ink.js";
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
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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

  const nodeHandlers = useMemo(() => {
    const nodeById = (id: string) =>
      propsRef.current.board.nodes.find((x) => x.id === id);
    const nodeAtW = (wx: number, wy: number): CanvasNode | null => {
      const nodes = propsRef.current.board.nodes;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]!;
        if (
          wx >= n.x &&
          wx <= n.x + n.width &&
          wy >= n.y &&
          wy <= n.y + n.height
        )
          return n;
      }
      return null;
    };
    return {
      onSelect: (id: string) => {
        setSelected(id);
        setSelectedEdge(null);
        propsRef.current.onSelectEdge?.(null);
      },
      onMove: (id: string, x: number, y: number) =>
        propsRef.current.onMove?.(id, x, y),
      onResize: (id: string, w: number, h: number) =>
        propsRef.current.onResize?.(id, w, h),
      onCommit: () => propsRef.current.onCommit?.(),
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
    setSelected(n.id);
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

  // Edge delete + escape, only while a board view is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        selectEdge(null);
        setDraft(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdge) {
          props.onDeleteEdge?.(selectedEdge);
          selectEdge(null);
        } else if (selected) {
          // Removing a node removes the placement only - the file stays,
          // its edges render broken (I-7), and notes are never destroyed.
          props.onDeleteNode?.(selected);
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedEdge, props.onDeleteEdge, props.onDeleteNode]);

  // tldraw culling: off-viewport nodes get display:none (still in the DOM -
  // hit-testable, selectable, exportable) but skip paint/layout cost.
  const view = useMemo(
    () => (vpSize ? worldViewport(cam, vpSize.w, vpSize.h) : null),
    [cam, vpSize],
  );
  const unCullable = useMemo(() => {
    const s = new Set<string>();
    if (selected) s.add(selected);
    if (props.editingNode) s.add(props.editingNode);
    if (props.fileEdit?.nodeId) s.add(props.fileEdit.nodeId);
    if (inkDraft?.nodeId) s.add(inkDraft.nodeId);
    return s;
  }, [selected, props.editingNode, props.fileEdit?.nodeId, inkDraft?.nodeId]);

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
        setSelected(null);
        selectEdge(null);
      }}
      viewportRef={vpRef}
      onDropFile={props.onDropFile}
      onEmptyDoubleClick={props.onEmptyDoubleClick}
      onBackgroundMenu={props.onCanvasMenu}
    >
      <EdgeLayer
        board={props.board}
        brokenEdges={brokenEdges}
        selectedId={selectedEdge}
        viewRect={view ?? undefined}
        onSelect={(id) => {
          selectEdge(id);
          setSelected(null);
        }}
        draft={draftGeom}
      />
      {props.board.nodes.map((n) => (
        <NodeView
          key={n.id}
          node={n}
          cameraRef={camRef}
          culled={
            view !== null && !unCullable.has(n.id) && !nodeVisible(n, view)
          }
          selected={selected === n.id}
          broken={brokenNodes.has(n.id)}
          dropTarget={draft?.overId === n.id}
          resolveMedia={props.resolveMedia}
          excerpt={n.type === "file" ? props.fileTexts?.get(n.file) : undefined}
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
