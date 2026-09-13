import { describe, expect, it } from 'vitest';
import { displaceRgba } from '../src/displacement.js';

function image(values: number[]) {
  const data = new Uint8Array(values.length * 4);
  values.forEach((value, index) => {
    const i = index * 4;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  });
  return { width: values.length, height: 1, data };
}

describe('displaceRgba', () => {
  it('keeps pixels unchanged with a neutral 128 displacement map', () => {
    const source = image([10, 80, 160, 240]);
    const map = image([128, 128, 128, 128]);
    const output = displaceRgba(source, map, { source: 'map.png', scaleX: 20, scaleY: 20 });
    expect(Array.from(output.data)).toEqual(Array.from(source.data));
  });

  it('moves sampling when the map is bright', () => {
    const source = image([10, 80, 160, 240]);
    const map = image([255, 255, 255, 255]);
    const output = displaceRgba(source, map, { source: 'map.png', scaleX: 1, scaleY: 0, edge: 'clamp' });
    expect(output.data[4]).toBe(10);
    expect(output.data[8]).toBe(80);
  });
});
