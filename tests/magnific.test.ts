import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildMockup } from '../src/engine.js';
import { preflightMagnific, preflightMagnificBatch } from '../src/magnific.js';

describe('Magnific preflight', () => {
  it('flags a mockup with no Smart Object and an undersized preview', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-magnific-'));
    const background = path.join(dir, 'background.png');
    await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ffffff' } }).png().toFile(background);

    const psd = path.join(dir, 'sample.psd');
    const jpg = path.join(dir, 'sample.jpg');
    await buildMockup({
      version: 1,
      document: { width: 1200, height: 1200 },
      layers: [{ type: 'raster', name: 'BACKGROUND', source: 'background.png', width: 1200, height: 1200 }],
    }, { output: psd, cwd: dir, generateComposite: false });
    await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#dddddd' } }).jpeg().toFile(jpg);

    const result = await preflightMagnific(psd, jpg, { type: 'mockup' });
    expect(result.ok).toBe(false);
    expect(result.checks.some((item) => item.code === 'MOCKUP_SMART_OBJECT_REQUIRED' && item.status === 'fail')).toBe(true);
    expect(result.checks.some((item) => item.code === 'PREVIEW_WIDTH' && item.status === 'fail')).toBe(true);
  });

  it('detects a missing same-name JPG in batch mode', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-magnific-batch-'));
    const source = path.join(dir, 'source.png');
    await sharp({ create: { width: 16, height: 16, channels: 4, background: '#333333' } }).png().toFile(source);
    await buildMockup({
      version: 1,
      document: { width: 1200, height: 1200 },
      layers: [{ type: 'smart-object', name: 'Place your design here (Double click to edit)', source: 'source.png', x: 100, y: 100, width: 800, height: 800 }],
    }, { output: path.join(dir, 'orphan.psd'), cwd: dir, generateComposite: false });

    const result = await preflightMagnificBatch(dir, { type: 'mockup' });
    expect(result.ok).toBe(false);
    expect(result.results[0].checks[0].code).toBe('PREVIEW_PAIR_MISSING');
  });
});
