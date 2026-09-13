import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readPsd } from 'ag-psd';
import { buildMockup } from '../src/engine.js';

describe('buildMockup', () => {
  it('writes a PSD containing raster and embedded smart-object layers', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-'));
    const image = path.join(dir, 'art.png');
    await sharp({
      create: { width: 32, height: 24, channels: 4, background: '#ff3366' },
    }).png().toFile(image);

    const output = 'out/test.psd';
    const result = await buildMockup({
      version: 1,
      document: { width: 200, height: 160, background: '#ffffff' },
      layers: [
        { type: 'smart-object', name: 'DESIGN', source: 'art.png', x: 20, y: 30, width: 80, height: 60 },
        { type: 'raster', name: 'PIXELS', source: 'art.png', x: 5, y: 6 },
      ],
    }, { output, cwd: dir });

    expect(result.smartObjectCount).toBe(1);
    expect(result.layerCount).toBe(2);

    const bytes = await readFile(path.join(dir, output));
    const psd: any = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    expect(psd.width).toBe(200);
    expect(psd.height).toBe(160);
    expect(psd.children.map((layer: any) => layer.name)).toEqual(['DESIGN', 'PIXELS']);
    expect(psd.children[0].placedLayer).toBeTruthy();
    expect(psd.linkedFiles?.length).toBe(1);
  });
});
