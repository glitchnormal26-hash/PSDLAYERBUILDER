import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectMockupSurfaces } from '../src/surface-detection.js';

async function synthetic(svg: string, name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'psdlayer-detect-'));
  const file = path.join(dir, name);
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#4c5158' } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(file);
  return file;
}

describe('detectMockupSurfaces', () => {
  it('fits a perspective quad for a flat screen-like surface', async () => {
    const file = await synthetic(
      '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><polygon points="170,145 645,120 675,430 145,455" fill="#f5f5f3"/></svg>',
      'screen.png',
    );
    const result = await detectMockupSurfaces(file, { hint: 'screen', count: 2, maxDimension: 800 });
    const top = result.candidates[0];
    expect(top.kind).toBe('quad');
    expect(top.confidence).toBeGreaterThan(0.5);
    expect(Math.min(top.quad[0], top.quad[6])).toBeLessThan(220);
    expect(Math.max(top.quad[2], top.quad[4])).toBeGreaterThan(600);
  });

  it('recognizes an elliptical round sign and provides a mask polygon', async () => {
    const file = await synthetic(
      '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><ellipse cx="430" cy="300" rx="190" ry="145" fill="#f7f7f5"/></svg>',
      'round.png',
    );
    const result = await detectMockupSurfaces(file, { hint: 'round-sign', count: 1, maxDimension: 800 });
    const top = result.candidates[0];
    expect(top.kind).toBe('ellipse');
    expect(top.ellipse).toBeTruthy();
    expect(top.polygon.length).toBe(48);
    expect(top.ellipse!.cx).toBeGreaterThan(380);
    expect(top.ellipse!.cx).toBeLessThan(480);
  });

  it('returns native cylinder-warp guidance for label surfaces', async () => {
    const file = await synthetic(
      '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect x="285" y="145" width="230" height="330" rx="18" fill="#f4f0e8"/></svg>',
      'label.png',
    );
    const result = await detectMockupSurfaces(file, { hint: 'label', count: 1, maxDimension: 800 });
    expect(result.candidates[0].kind).toBe('cylinder');
    expect(result.candidates[0].nativeWarp?.style).toBe('cylinder');
    expect(result.candidates[0].nativeWarp?.cylinderCurve).toBeGreaterThan(0.5);
  });
});
