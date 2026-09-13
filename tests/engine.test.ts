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

  it('writes native mask, clipping and layer effects metadata', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-fx-'));
    await sharp({ create: { width: 24, height: 24, channels: 4, background: '#44aaee' } }).png().toFile(path.join(dir, 'art.png'));
    await sharp({ create: { width: 24, height: 24, channels: 4, background: '#ffffff' } }).png().toFile(path.join(dir, 'mask.png'));
    await sharp({ create: { width: 24, height: 24, channels: 4, background: '#808080' } }).png().toFile(path.join(dir, 'disp.png'));

    const output = 'out/fx.psd';
    const result = await buildMockup({
      version: 1,
      document: { width: 100, height: 100 },
      layers: [{
        type: 'raster',
        name: 'FX',
        source: 'art.png',
        x: 10,
        y: 12,
        clipping: true,
        mask: { source: 'mask.png', feather: 2 },
        displacement: { source: 'disp.png', scaleX: 4, scaleY: 2 },
        effects: {
          dropShadow: { color: '#112233', opacity: 0.4, distance: 5, size: 7 },
          stroke: { color: '#ffffff', size: 3, position: 'inside' },
          colorOverlay: { color: '#ff0000', opacity: 0.1 },
        },
      }],
    }, { output, cwd: dir });

    const bytes = await readFile(path.join(dir, output));
    const psd: any = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const layer = psd.children[0];

    expect(layer.clipping).toBe(true);
    expect(layer.mask).toBeTruthy();
    expect(layer.effects?.dropShadow?.[0]?.enabled).toBe(true);
    expect(layer.effects?.stroke?.[0]?.size?.value).toBe(3);
    expect(layer.effects?.solidFill?.[0]?.opacity).toBeCloseTo(0.1);
    expect(result.warnings.some((warning) => warning.includes('Clipping masks'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Layer effects'))).toBe(true);
  });
});
