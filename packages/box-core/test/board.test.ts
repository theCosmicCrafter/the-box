// SPDX-License-Identifier: LicenseRef-Proprietary
// Board parser/serializer tests - DATA-MODEL §2 + formats gate.

import { describe, it, expect } from 'vitest';
import { parseBoard, serializeBoard } from '../src/model/board.js';

const MINIMAL = {
  'box-format': 'box.canvas/1',
  nodes: [
    { id: 'n-a1b2c3', type: 'file', x: 0, y: 0, width: 200, height: 150, file: 'img/a.png' },
    { id: 'n-d4e5f6', type: 'file', x: 300, y: 0, width: 200, height: 150, file: 'img/b.png' },
  ],
  edges: [
    { id: '7f3a9c2b1d4e5f6a', fromNode: 'n-a1b2c3', toNode: 'n-d4e5f6', 'box-link': 'link-7f3a9c2b1d4e5f6a.md' },
  ],
};

describe('parseBoard', () => {
  it('parses a minimal valid board', () => {
    const r = parseBoard(JSON.stringify(MINIMAL), '.box/main.box.canvas');
    expect(r.value).not.toBeNull();
    expect(r.problems).toEqual([]);
    expect(r.value?.nodes).toHaveLength(2);
  });

  it('tolerates and preserves unknown keys (superset contract)', () => {
    const withExtras = {
      ...MINIMAL,
      'box-placement-test': { a: 1 },
      'custom-plugin-key': 'preserve me',
    };
    const r = parseBoard(JSON.stringify(withExtras));
    expect(r.value?.['custom-plugin-key']).toBe('preserve me');
    const out = JSON.parse(serializeBoard(r.value!));
    expect(out['custom-plugin-key']).toBe('preserve me');
    expect(out['box-format']).toBe('box.canvas/1');
  });

  it('returns problems, never throws, on garbage', () => {
    expect(parseBoard('{{{').value).toBeNull();
    expect(parseBoard('[]').value).toBeNull();
    expect(parseBoard('{}').problems.some((p) => p.detail.includes('box-format'))).toBe(true);
  });

  it('flags dangling edge node refs as broken, not malformed', () => {
    const bad = {
      ...MINIMAL,
      edges: [{ id: '7f3a9c2b1d4e5f6a', fromNode: 'n-nope', toNode: 'n-d4e5f6', 'box-link': 'link-7f3a9c2b1d4e5f6a.md' }],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.kind === 'broken-edge')).toBe(true);
  });

  it('flags box-link mismatch', () => {
    const bad = {
      ...MINIMAL,
      edges: [{ ...MINIMAL.edges[0]!, 'box-link': 'link-deadbeefdeadbeef.md' }],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.detail.includes('box-link'))).toBe(true);
  });

  it('rejects non-PathRel file fields', () => {
    const bad = {
      ...MINIMAL,
      nodes: [{ ...MINIMAL.nodes[0]!, file: '../escape.png' }],
    };
    const r = parseBoard(JSON.stringify(bad));
    expect(r.problems.some((p) => p.detail.includes('PathRel'))).toBe(true);
  });
});

describe('serializeBoard', () => {
  it('round-trips a parsed board byte-for-field', () => {
    const r = parseBoard(JSON.stringify(MINIMAL));
    const reparsed = parseBoard(serializeBoard(r.value!));
    expect(reparsed.value?.nodes).toEqual(r.value?.nodes);
    expect(reparsed.value?.edges).toEqual(r.value?.edges);
  });
});
