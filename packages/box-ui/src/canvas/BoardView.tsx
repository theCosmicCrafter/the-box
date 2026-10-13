// SPDX-License-Identifier: LicenseRef-Proprietary
// BoardView - a parsed Board rendered through the Viewport seam:
// EdgeLayer (SVG, world space) under NodeViews (DOM, world space).

import { useMemo, useState } from 'react';
import type { Board } from '@box/core';
import { Viewport } from './Viewport.js';
import { EdgeLayer } from './EdgeLayer.js';
import { NodeView } from './NodeView.js';
import type { Camera } from './camera.js';
import { DEFAULT_CAMERA } from './camera.js';

export interface BoardViewProps {
  board: Board;
  brokenNodes?: Set<string>; // node ids whose file is missing from the workspace
  brokenEdges?: Set<string>; // edge ids with dangling endpoint
  onMove?: (id: string, x: number, y: number) => void;
  onCommit?: () => void; // persist after an interaction settles
}

export function BoardView(props: BoardViewProps) {
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const [selected, setSelected] = useState<string | null>(null);
  const brokenNodes = props.brokenNodes ?? useMemo(() => new Set<string>(), []);
  const brokenEdges = useMemo(() => {
    if (props.brokenEdges) return props.brokenEdges;
    const ids = new Set(props.board.nodes.map((n) => n.id));
    return new Set(props.board.edges.filter((e) => !ids.has(e.fromNode) || !ids.has(e.toNode)).map((e) => e.id));
  }, [props.board, props.brokenEdges]);

  return (
    <Viewport camera={cam} onCameraChange={setCam} onBackgroundClick={() => setSelected(null)}>
      <EdgeLayer board={props.board} brokenEdges={brokenEdges} />
      {props.board.nodes.map((n) => (
        <NodeView
          key={n.id}
          node={n}
          camera={cam}
          selected={selected === n.id}
          broken={brokenNodes.has(n.id)}
          onSelect={setSelected}
          onMove={props.onMove ?? (() => {})}
          onCommit={props.onCommit ?? (() => {})}
        />
      ))}
    </Viewport>
  );
}
