// SPDX-License-Identifier: LicenseRef-Proprietary
// NodeView - per-kind DOM renderer + drag/select. Pointer math runs in
// world space via the camera prop, so nodes move correctly at any zoom.
// Broken file nodes keep their geometry and render visibly broken (I-7).

import { useRef } from 'react';
import type { CanvasNode } from '@box/core';
import { baseName } from '@box/core';
import type { Camera } from './camera.js';
import { screenToWorld } from './camera.js';

export interface NodeViewProps {
  node: CanvasNode;
  camera: Camera;
  selected: boolean;
  broken: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onCommit: () => void;
}

function label(n: CanvasNode): string {
  switch (n.type) {
    case 'text':
      return n.text.length > 240 ? `${n.text.slice(0, 240)}…` : n.text;
    case 'file':
      return baseName(n.file);
    case 'link':
      return n.url;
    case 'group':
      return n.label ?? '';
  }
}

export function NodeView(props: NodeViewProps) {
  const { node, camera } = props;
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // node drags must not become viewport pans
    drag.current = { px: e.clientX, py: e.clientY, ox: node.x, oy: node.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    props.onSelect(node.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const a = screenToWorld(camera, 0, 0);
    const b = screenToWorld(camera, e.clientX - drag.current.px, e.clientY - drag.current.py);
    props.onMove(node.id, Math.round(drag.current.ox + b.x - a.x), Math.round(drag.current.oy + b.y - a.y));
  };

  const onPointerUp = () => {
    if (drag.current) {
      drag.current = null;
      props.onCommit();
    }
  };

  const cls = [
    'node',
    `node-${node.type}`,
    props.selected ? 'selected' : '',
    props.broken ? 'broken' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      {node.type === 'file' && <span className="node-kind">file</span>}
      {props.broken && <span className="node-flag">missing</span>}
      <div className="node-label">{label(node)}</div>
    </div>
  );
}
