// SPDX-License-Identifier: LicenseRef-Proprietary
// IDs - DATA-MODEL §8.
// Edge id: 16 lowercase hex (donor convention uuid4().hex[:16], verified).
// Node id: `n-<hex>` (6+ chars); donor-style 16-hex node ids accepted on read.

// crypto.randomUUID is a web-standard global (Node 19+, all modern browsers):
// no import needed, and the purity lint bans node:* in box-core anyway.

const EDGE_ID = /^[0-9a-f]{16}$/;
const NODE_ID = /^n-[0-9a-z]{6,}$/;
const DONOR_NODE_ID = /^[0-9a-f]{16}$/;

function hex(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function newEdgeId(): string {
  return hex().slice(0, 16);
}

export function newNodeId(): string {
  return `n-${hex().slice(0, 12)}`;
}

export function isEdgeId(id: string): boolean {
  return EDGE_ID.test(id);
}

export function isNodeId(id: string): boolean {
  return NODE_ID.test(id) || DONOR_NODE_ID.test(id);
}

export function linkNoteName(edgeId: string): string {
  return `link-${edgeId}.md`;
}

/** Edge id embedded in a link-note filename, or null if the name isn't one. */
export function edgeIdFromNoteName(name: string): string | null {
  const m = /^link-([0-9a-f]{16})\.md$/.exec(name);
  return m?.[1] ?? null;
}
