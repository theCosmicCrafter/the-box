// SPDX-License-Identifier: LicenseRef-Proprietary

import { describe, it, expect } from 'vitest';
import { isPathRel, resolveInside } from '../src/model/paths.js';

describe('isPathRel', () => {
  it.each([
    ['a.png', true],
    ['img/deep/a.png', true],
    ['.box/main.box.canvas', true],
    ['link-7f3a9c2b1d4e5f6a.md', true],
    ['../up.png', false],
    ['a/../../b.png', false],
    ['C:\\abs.png', false],
    ['C:/abs.png', false],
    ['/abs.png', false],
    ['trailing/', false],
    ['back\\slash.png', false],
    ['dot./file.png', false],
    ['space /file.png', false],
    ['', false],
    [123, false],
  ])('isPathRel(%j) = %s', (input, expected) => {
    expect(isPathRel(input)).toBe(expected);
  });
});

describe('resolveInside', () => {
  it('resolves valid paths', () => {
    expect(resolveInside('/ws', 'img/a.png')).toBe('/ws/img/a.png');
  });
  it('rejects escapes', () => {
    expect(resolveInside('/ws', '../evil.png')).toBeNull();
    expect(resolveInside('/ws', 'a/../../evil.png')).toBeNull();
    expect(resolveInside('/ws', 'C:/evil.png')).toBeNull();
  });
});
