// SPDX-License-Identifier: LicenseRef-Proprietary
// Board parse/serialize - DATA-MODEL §2. Ported from
// obsidian-master-control-mcp/canvas.py (ours): node/edge model +
// parse/serialize; left out: Python API, Obsidian vault coupling.
//
// Tolerance rules (contract): parsers are total functions - malformed input
// yields {board: null, problems}, never throws. Unknown keys ride along via
// index signatures and are preserved verbatim on rewrite.

import type { Board, CanvasEdge, CanvasNode, ProblemItem } from './types.js';
import { BOARD_FORMAT } from './types.js';
import { isNodeId, isEdgeId } from './ids.js';
import { isPathRel } from './paths.js';

const NODE_TYPES = new Set(['text', 'file', 'link', 'group']);
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const ENDS = new Set(['none', 'arrow']);
const MAX_NODES = 100_000;
const MAX_COORD = 1e7;

export interface ParseResult<T> {
  value: T | null;
  problems: ProblemItem[];
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nodeProblems(n: Record<string, unknown>, i: number, path: string, seen: Set<string>): ProblemItem[] {
  const problems: ProblemItem[] = [];
  const at = `nodes[${i}]`;
  if (typeof n['id'] !== 'string' || !isNodeId(n['id'])) {
    problems.push({ kind: 'malformed-board', path, detail: `${at}.id missing or invalid` });
  } else if (seen.has(n['id'])) {
    problems.push({ kind: 'duplicate-id', path, detail: `${at}.id duplicates an earlier node` });
  } else {
    seen.add(n['id'] as string);
  }
  if (!NODE_TYPES.has(n['type'] as string)) {
    problems.push({ kind: 'malformed-board', path, detail: `${at}.type invalid: ${String(n['type'])}` });
  }
  for (const f of ['x', 'y', 'width', 'height'] as const) {
    const v = n[f];
    if (!isInt(v) || Math.abs(v) > MAX_COORD || (f.startsWith('w') || f.startsWith('h') ? v < 1 || v > 65535 : false)) {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.${f} out of bounds: ${String(v)}` });
    }
  }
  if (n['type'] === 'file') {
    if (!isPathRel(n['file'])) {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.file not a PathRel: ${String(n['file'])}` });
    }
    const ink = n['box-ink'];
    if (ink !== undefined && (typeof ink !== 'string' || !isPathRel(ink) || !ink.endsWith('.ink.svg'))) {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.box-ink invalid: ${String(ink)}` });
    }
  }
  return problems;
}

function edgeProblems(e: Record<string, unknown>, i: number, path: string, nodeIds: Set<string>, edgeIds: Set<string>): ProblemItem[] {
  const problems: ProblemItem[] = [];
  const at = `edges[${i}]`;
  if (typeof e['id'] !== 'string' || !isEdgeId(e['id'])) {
    problems.push({ kind: 'malformed-board', path, detail: `${at}.id missing or not 16-hex` });
  } else if (edgeIds.has(e['id'])) {
    problems.push({ kind: 'malformed-board', path, detail: `${at}.id duplicate` });
  } else {
    edgeIds.add(e['id']);
  }
  const link = e['box-link'];
  if (typeof link !== 'string' || link !== `link-${e['id']}.md`) {
    problems.push({ kind: 'malformed-board', path, detail: `${at}.box-link missing or mismatched: ${String(link)}` });
  }
  for (const f of ['fromSide', 'toSide'] as const) {
    if (e[f] !== undefined && !SIDES.has(e[f] as string)) {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.${f} invalid` });
    }
  }
  for (const f of ['fromEnd', 'toEnd'] as const) {
    if (e[f] !== undefined && !ENDS.has(e[f] as string)) {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.${f} invalid` });
    }
  }
  for (const f of ['fromNode', 'toNode'] as const) {
    const v = e[f];
    if (typeof v !== 'string') {
      problems.push({ kind: 'malformed-board', path, detail: `${at}.${f} missing` });
    } else if (!nodeIds.has(v)) {
      problems.push({ kind: 'broken-edge', path, detail: `${at}.${f} dangling node ref: ${v}` });
    }
  }
  return problems;
}

/** Total parser: worst case is problem items, never a throw. */
export function parseBoard(json: string, path = '<board>'): ParseResult<Board> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { value: null, problems: [{ kind: 'malformed-board', path, detail: 'not valid JSON' }] };
  }
  if (!isObj(raw)) {
    return { value: null, problems: [{ kind: 'malformed-board', path, detail: 'top level not an object' }] };
  }
  const problems: ProblemItem[] = [];
  if (raw['box-format'] !== BOARD_FORMAT) {
    problems.push({ kind: 'malformed-board', path, detail: `box-format expected ${BOARD_FORMAT}, got ${String(raw['box-format'])}` });
  }
  const rawNodes = raw['nodes'];
  const rawEdges = raw['edges'];
  if (rawNodes !== undefined && !Array.isArray(rawNodes)) {
    problems.push({ kind: 'malformed-board', path, detail: 'nodes not an array' });
  }
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) {
    problems.push({ kind: 'malformed-board', path, detail: 'edges not an array' });
  }
  const nodeList = Array.isArray(rawNodes) ? rawNodes : [];
  const edgeList = Array.isArray(rawEdges) ? rawEdges : [];
  if (nodeList.length > MAX_NODES) {
    problems.push({ kind: 'malformed-board', path, detail: `node count ${nodeList.length} exceeds ${MAX_NODES}` });
  }
  const nodeIds = new Set<string>();
  const nodes: CanvasNode[] = [];
  nodeList.forEach((n, i) => {
    if (isObj(n)) {
      problems.push(...nodeProblems(n, i, path, nodeIds));
      nodes.push(n as CanvasNode);
    } else {
      problems.push({ kind: 'malformed-board', path, detail: `nodes[${i}] not an object` });
    }
  });
  const edgeIds = new Set<string>();
  const edges: CanvasEdge[] = [];
  edgeList.forEach((e, i) => {
    if (isObj(e)) {
      problems.push(...edgeProblems(e, i, path, nodeIds, edgeIds));
      edges.push(e as CanvasEdge);
    } else {
      problems.push({ kind: 'malformed-board', path, detail: `edges[${i}] not an object` });
    }
  });
  const board: Board = { ...(raw as Board), nodes, edges };
  return { value: board, problems };
}

/**
 * Deterministic serializer: canonical field order for objects we write,
 * unknown keys preserved (they're already properties of the objects).
 */
export function serializeBoard(board: Board): string {
  const out: Record<string, unknown> = {
    'box-format': BOARD_FORMAT,
  };
  if (board['version'] !== undefined) out['version'] = board['version'];
  out['nodes'] = board.nodes;
  out['edges'] = board.edges;
  for (const k of Object.keys(board)) {
    if (k !== 'box-format' && k !== 'version' && k !== 'nodes' && k !== 'edges') {
      out[k] = board[k];
    }
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
