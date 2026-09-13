import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPsd } from 'ag-psd';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildMockup } from '../src/engine.js';

describe('native smart-object warp', () => {
  it('round-trips Photoshop cylinder warp metadata', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-warp-'));
    const art = path.join(dir, 'art.png');
    await sharp({ create: { width: 60, height: 100, channels: 4, background: '#ffffff' } }).png().toFile(art);
    const result = await buildMockup({
      version: 1,
      document: { width: 320, height: 320 },
      layers: [{
        type: 'smart-object',
        name: 'Place your design here (Double click to edit)',
        source: 'art.png',
        quad: [90, 55, 230, 55, 230, 265, 90, 265],
        nativeWarp: { style: 'cylinder', bend: 18, cylinderCurve: 0.59, rotate: 'horizontal' },
      }],
    }, { output: 'warp.psd', cwd: dir, generateComposite: false });

    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const warp = psd.children[0].placedLayer.warp;
    expect(warp.style).toBe('cylinder');
    expect(warp.values).toHaveLength(7);
    expect(warp.rotate).toBe('horizontal');
    expect(warp.uOrder).toBe(4);
    expect(warp.vOrder).toBe(4);
  });
});
