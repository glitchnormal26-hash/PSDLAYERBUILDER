import type { RgbaImage } from './image.js';
import type { Quad } from './types.js';

interface Matrix3 {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  g: number; h: number; i: number;
}

function projectiveMatrix(quad: Quad): Matrix3 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-12) throw new Error('Perspective quad is degenerate');
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
    i: 1,
  };
}

function invert(m: Matrix3): Matrix3 {
  const A = m.e * m.i - m.f * m.h;
  const B = -(m.d * m.i - m.f * m.g);
  const C = m.d * m.h - m.e * m.g;
  const D = -(m.b * m.i - m.c * m.h);
  const E = m.a * m.i - m.c * m.g;
  const F = -(m.a * m.h - m.b * m.g);
  const G = m.b * m.f - m.c * m.e;
  const H = -(m.a * m.f - m.c * m.d);
  const I = m.a * m.e - m.b * m.d;
  const det = m.a * A + m.b * B + m.c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Perspective transform is not invertible');
  return { a: A / det, b: D / det, c: G / det, d: B / det, e: E / det, f: H / det, g: C / det, h: F / det, i: I / det };
}

function sampleBilinear(image: RgbaImage, x: number, y: number, out: Uint8Array, offset: number): void {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * image.width + x0) * 4;
  const i10 = (y0 * image.width + x1) * 4;
  const i01 = (y1 * image.width + x0) * 4;
  const i11 = (y1 * image.width + x1) * 4;

  for (let channel = 0; channel < 4; channel += 1) {
    out[offset + channel] = Math.round(
      image.data[i00 + channel] * w00 +
      image.data[i10 + channel] * w10 +
      image.data[i01 + channel] * w01 +
      image.data[i11 + channel] * w11,
    );
  }
}

export function warpPerspective(image: RgbaImage, quad: Quad): { image: RgbaImage; left: number; top: number } {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const left = Math.floor(Math.min(...xs));
  const top = Math.floor(Math.min(...ys));
  const right = Math.ceil(Math.max(...xs));
  const bottom = Math.ceil(Math.max(...ys));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  if (width * height > 80_000_000) throw new Error('Perspective preview exceeds the 80 megapixel safety limit');

  const localQuad: Quad = [
    quad[0] - left, quad[1] - top,
    quad[2] - left, quad[3] - top,
    quad[4] - left, quad[5] - top,
    quad[6] - left, quad[7] - top,
  ];
  const inverse = invert(projectiveMatrix(localQuad));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const denominator = inverse.g * px + inverse.h * py + inverse.i;
      if (Math.abs(denominator) < 1e-12) continue;
      const u = (inverse.a * px + inverse.b * py + inverse.c) / denominator;
      const v = (inverse.d * px + inverse.e * py + inverse.f) / denominator;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      sampleBilinear(image, u * (image.width - 1), v * (image.height - 1), data, (y * width + x) * 4);
    }
  }

  return { image: { width, height, data }, left, top };
}
