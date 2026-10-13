// SPDX-License-Identifier: LicenseRef-Proprietary
// BoardView - a parsed Board rendered through the Viewport seam:
// EdgeLayer (SVG, world space) under NodeViews (DOM, world space).
// Owns interaction state: node selection, edge selection + delete key,
// and the edge-draft state machine (handle drag -> live preview ->
// drop on target -> onCreateEdge with the sides actually used).

import type { Board, CanvasNode, Side } from "@box/core";
import { useEffect, useMemo, useState } from "react";
import type { DraftEdge } from "./EdgeLayer.js";
import { EdgeLayer, anchor } from "./EdgeLayer.js";
import { NodeView } from "./NodeView.js";
import { Viewport } from "./Viewport.js";
import type { Camera } from "./camera.js";
import { DEFAULT_CAMERA } from "./camera.js";

export interface BoardViewProps {
  board: Board;
  brokenNodes?: Set<string> | undefined;
  brokenEdges?: Set<string> | undefined;
  onMove?: (id: string, x: number, y: number) => void;
  onCommit?: () => void;
  onCreateEdge?: (
    fromNodeId: string,
    toNodeId: string,
    fromSide: Side,
    toSide: Side,
  ) => void;
  onDeleteEdge?: (edgeId: string) => void;
  /** Fires on every edge-selection change (id, or null when cleared). */
  onSelectEdge?: (edgeId: string | null) => void;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
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
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedEdge
      ) {
        props.onDeleteEdge?.(selectedEdge);
        selectEdge(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdge, props.onDeleteEdge]);

  const nodeAt = (wx: number, wy: number): CanvasNode | null => {
    for (let i = props.board.nodes.length - 1; i >= 0; i--) {
      const n = props.board.nodes[i]!;
      if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height)
        return n;
    }
    return null;
  };

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
      onBackgroundClick={() => {
        setSelected(null);
        selectEdge(null);
      }}
    >
      <EdgeLayer
        board={props.board}
        brokenEdges={brokenEdges}
        selectedId={selectedEdge}
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
          camera={cam}
          selected={selected === n.id}
          broken={brokenNodes.has(n.id)}
          dropTarget={draft?.overId === n.id}
          onSelect={(id) => {
            setSelected(id);
            selectEdge(null);
          }}
          onMove={props.onMove ?? (() => {})}
          onCommit={props.onCommit ?? (() => {})}
          onDraftStart={(nodeId, side) => {
            const w = anchor(n, side);
            setDraft({
              fromId: nodeId,
              fromSide: side,
              x: w.x,
              y: w.y,
              overId: null,
            });
          }}
          onDraftMove={(wx, wy) => {
            setDraft((d) => {
              if (!d) return d;
              const over = nodeAt(wx, wy);
              return {
                ...d,
                x: wx,
                y: wy,
                overId: over && over.id !== d.fromId ? over.id : null,
              };
            });
          }}
          onDraftEnd={(wx, wy) => {
            if (draft) {
              const over = nodeAt(wx, wy);
              if (over && over.id !== draft.fromId) {
                props.onCreateEdge?.(
                  draft.fromId,
                  over.id,
                  draft.fromSide,
                  sideToward(over, wx, wy),
                );
              }
            }
            setDraft(null);
          }}
        />
      ))}
    </Viewport>
  );
}
