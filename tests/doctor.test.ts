import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { doctorPsd } from '../src/doctor.js';
import { buildMockup } from '../src/engine.js';

describe('doctorPsd', () => {
  it('reports healthy generated PSD structure and feature counts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-doctor-'));
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ffaa00' } }).png().toFile(path.join(dir, 'art.png'));
    await buildMockup({
      version: 1,
      document: { width: 80, height: 80 },
      layers: [{
        type: 'smart-object',
        name: 'ART',
        source: 'art.png',
        x: 10,
        y: 10,
        vectorMask: { paths: [{ points: [[10, 10], [30, 10], [30, 30], [10, 30]] }] },
      }],
    }, { output: 'healthy.psd', cwd: dir });

    const result = await doctorPsd(path.join(dir, 'healthy.psd'));
    expect(result.ok).toBe(true);
    expect(result.stats.smartObjects).toBe(1);
    expect(result.stats.vectorMasks).toBe(1);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
  });
});
