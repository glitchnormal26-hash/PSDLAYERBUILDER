import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { buildMockup } from '../src/engine.js';
import { replaceSmartObjects } from '../src/template.js';

describe('replaceSmartObjects', () => {
  it('replaces duplicate layer names deterministically by full path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-batch-'));
    for (const [name, color] of [['first.png', '#ff0000'], ['front.png', '#00ff00'], ['back.png', '#0000ff']] as const) {
      await sharp({ create: { width: 24, height: 18, channels: 4, background: color } }).png().toFile(path.join(dir, name));
    }

    await buildMockup({
      version: 1,
      document: { width: 160, height: 100 },
      layers: [
        { type: 'group', name: 'FRONT', children: [{ type: 'smart-object', name: 'SLOT', source: 'first.png', x: 5, y: 5, width: 50, height: 40 }] },
        { type: 'group', name: 'BACK', children: [{ type: 'smart-object', name: 'SLOT', source: 'first.png', x: 80, y: 5, width: 50, height: 40 }] },
      ],
    }, { output: 'template.psd', cwd: dir });

    await expect(replaceSmartObjects({
      template: path.join(dir, 'template.psd'),
      replacements: [{ selector: { name: 'SLOT' }, artwork: 'front.png' }],
      output: path.join(dir, 'ambiguous.psd'),
      cwd: dir,
    })).rejects.toThrow(/ambiguous/i);

    const result = await replaceSmartObjects({
      template: path.join(dir, 'template.psd'),
      replacements: [
        { selector: { path: ['FRONT', 'SLOT'] }, artwork: 'front.png' },
        { selector: { path: ['BACK', 'SLOT'] }, artwork: 'back.png' },
      ],
      output: path.join(dir, 'result.psd'),
      cwd: dir,
    });
    expect(result.replacements).toHaveLength(2);

    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const frontId = psd.children[0].children[0].placedLayer.id;
    const backId = psd.children[1].children[0].placedLayer.id;
    const linkedById = new Map(psd.linkedFiles.map((file: any) => [file.id, file]));
    expect((linkedById.get(frontId) as any).name).toBe('front.png');
    expect((linkedById.get(backId) as any).name).toBe('back.png');
  });
});
