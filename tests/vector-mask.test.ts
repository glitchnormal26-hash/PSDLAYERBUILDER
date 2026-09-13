import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { buildMockup } from '../src/engine.js';
import { vectorMaskContains } from '../src/vector-mask.js';

describe('vector masks', () => {
  it('evaluates polygon masks for the convenience composite', () => {
    const mask = { paths: [{ points: [[10, 10], [50, 10], [50, 50], [10, 50]] as [number, number][] }] };
    expect(vectorMaskContains(mask, 20, 20)).toBe(true);
    expect(vectorMaskContains(mask, 5, 5)).toBe(false);
  });

  it('writes a native PSD vector mask that survives a round trip', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-vector-'));
    await sharp({ create: { width: 60, height: 60, channels: 4, background: '#ff3366' } }).png().toFile(path.join(dir, 'art.png'));
    const result = await buildMockup({
      version: 1,
      document: { width: 100, height: 100 },
      layers: [{
        type: 'raster',
        name: 'VECTOR',
        source: 'art.png',
        x: 10,
        y: 10,
        vectorMask: {
          feather: 2,
          paths: [{ points: [[10, 10], [70, 10], [70, 70], [10, 70]] }],
        },
      }],
    }, { output: 'vector.psd', cwd: dir });

    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(psd.children[0].vectorMask?.paths?.[0]?.knots).toHaveLength(4);
    expect(psd.children[0].mask).toBeTruthy();
    expect(psd.children[0].mask.vectorMaskFeather).toBe(2);
  });
});
