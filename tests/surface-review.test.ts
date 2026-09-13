import { describe, expect, it } from 'vitest';
import { inferSurfaceHintFromFilename } from '../src/surface-review.js';

describe('inferSurfaceHintFromFilename', () => {
  it('maps descriptive mockup filenames to useful detector priors', () => {
    expect(inferSurfaceHintFromFilename('03_laptop_screen_mockup.jpeg')).toBe('screen');
    expect(inferSurfaceHintFromFilename('10_round_store_sign.jpeg')).toBe('round-sign');
    expect(inferSurfaceHintFromFilename('14_cold_white_can.jpeg')).toBe('cylinder');
    expect(inferSurfaceHintFromFilename('13_open_magazine.jpeg')).toBe('page');
    expect(inferSurfaceHintFromFilename('08_folded_tshirts.jpeg')).toBe('garment');
  });
});
