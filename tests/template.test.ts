import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readPsd } from 'ag-psd';
import { buildMockup } from '../src/engine.js';
import { replaceSmartObject } from '../src/template.js';

describe('replaceSmartObject', () => {
  it('replaces embedded data and preserves the smart-object layer', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-template-'));
    const first = path.join(dir, 'first.png');
    const second = path.join(dir, 'second.png');
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff0000' } }).png().toFile(first);
    await sharp({ create: { width: 30, height: 10, channels: 4, background: '#0000ff' } }).png().toFile(second);

    await buildMockup({
      version: 1,
      document: { width: 100, height: 100 },
      layers: [{ type: 'smart-object', name: 'SLOT', source: 'first.png', quad: [10, 10, 80, 12, 78, 70, 12, 72] }],
    }, { output: 'template.psd', cwd: dir });

    const result = await replaceSmartObject({
      template: path.join(dir, 'template.psd'),
      layerName: 'SLOT',
      artwork: second,
      output: path.join(dir, 'replaced.psd'),
    });
    expect(result.layerName).toBe('SLOT');

    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(psd.children[0].placedLayer).toBeTruthy();
    expect(psd.children[0].placedLayer.width).toBe(30);
    expect(psd.children[0].placedLayer.height).toBe(10);
    expect(psd.linkedFiles?.[0]?.name).toBe('second.png');
  });
});
