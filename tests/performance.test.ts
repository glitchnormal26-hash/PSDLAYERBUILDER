import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPsd } from 'ag-psd';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildMockup } from '../src/engine.js';
import { replaceSmartObjects } from '../src/template.js';

describe('performance paths', () => {
  it('skips composite-only warnings/work while preserving native vector masks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-perf-build-'));
    const source = path.join(dir, 'source.png');
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff00ff' } }).png().toFile(source);

    const result = await buildMockup({
      version: 1,
      document: { width: 64, height: 64 },
      layers: [{
        type: 'raster',
        name: 'ART',
        source: 'source.png',
        clipping: true,
        vectorMask: {
          feather: 2,
          paths: [{ points: [[4, 4], [60, 4], [60, 60], [4, 60]] }],
        },
      }],
    }, { output: 'low-memory.psd', cwd: dir, generateComposite: false });

    expect(result.warnings.some((warning) => warning.includes('convenience composite'))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('Vector-mask feather'))).toBe(false);

    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(psd.children[0].vectorMask?.paths?.length).toBe(1);
    expect(psd.children[0].clipping).toBe(true);
  });

  it('reuses one artwork across multiple Smart Object replacements in a single batch', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-perf-replace-'));
    const original = path.join(dir, 'original.png');
    const replacement = path.join(dir, 'replacement.png');
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff0000' } }).png().toFile(original);
    await sharp({ create: { width: 30, height: 10, channels: 4, background: '#0000ff' } }).png().toFile(replacement);

    await buildMockup({
      version: 1,
      document: { width: 100, height: 100 },
      layers: [
        { type: 'smart-object', name: 'A', source: 'original.png', quad: [5, 5, 45, 5, 45, 45, 5, 45] },
        { type: 'smart-object', name: 'B', source: 'original.png', quad: [55, 5, 95, 5, 95, 45, 55, 45] },
      ],
    }, { output: 'template.psd', cwd: dir, generateComposite: false });

    const result = await replaceSmartObjects({
      template: path.join(dir, 'template.psd'),
      replacements: [
        { selector: { name: 'A' }, artwork: replacement },
        { selector: { name: 'B' }, artwork: replacement },
      ],
      output: path.join(dir, 'final.psd'),
    });

    expect(result.replacements).toHaveLength(2);
    const psd: any = readPsd(await readFile(result.output), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    expect(psd.linkedFiles).toHaveLength(2);
    expect(psd.linkedFiles.every((file: any) => file.name === 'replacement.png')).toBe(true);
  });
});
