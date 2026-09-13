import { describe, expect, it } from 'vitest';
import { solidRgba } from '../src/image.js';
import { warpPerspective } from '../src/perspective.js';

describe('warpPerspective', () => {
  it('warps an RGBA image into a document-space quad', () => {
    const source = solidRgba(8, 8, '#ff0000');
    const result = warpPerspective(source, [10, 20, 30, 18, 34, 40, 8, 42]);
    expect(result.left).toBe(8);
    expect(result.top).toBe(18);
    expect(result.image.width).toBe(26);
    expect(result.image.height).toBe(24);
    expect(result.image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });
});
