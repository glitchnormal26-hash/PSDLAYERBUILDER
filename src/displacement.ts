import type { RgbaImage } from './image.js';
import type { DisplacementSpec } from './types.js';

type Channel = NonNullable<DisplacementSpec['channel']>;
type EdgeMode = NonNullable<DisplacementSpec['edge']>;

function mapValue(data: Uint8Array, index: number, channel: Channel): number {
  if (channel === 'red') return data[index];
  if (channel === 'green') return data[index + 1];
  if (channel === 'blue') return data[index + 2];
  if (channel === 'alpha') return data[index + 3];
  return Math.round(data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722);
}

function normalizeMap(value: number): number {
  return Math.max(-1, Math.min(1, (value - 128) / 127));
}

function readPixel(image: RgbaImage, x: number, y: number, channel: number, edge: EdgeMode): number {
  if (edge === 'transparent' && (x < 0 || y < 0 || x >= image.width || y >= image.height)) return 0;
  const cx = Math.max(0, Math.min(image.width - 1, x));
  const cy = Math.max(0, Math.min(image.height - 1, y));
  return image.data[(cy * image.width + cx) * 4 + channel];
}

function bilinear(image: RgbaImage, x: number, y: number, channel: number, edge: EdgeMode): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;

  const a = readPixel(image, x0, y0, channel, edge);
  const b = readPixel(image, x1, y0, channel, edge);
  const c = readPixel(image, x0, y1, channel, edge);
  const d = readPixel(image, x1, y1, channel, edge);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return Math.round(top + (bottom - top) * fy);
}

export function displaceRgba(source: RgbaImage, map: RgbaImage, spec: DisplacementSpec): RgbaImage {
  if (source.width !== map.width || source.height !== map.height) {
    throw new Error('Displacement map dimensions must match the source preview');
  }

  const scaleX = spec.scaleX ?? 12;
  const scaleY = spec.scaleY ?? 12;
  const channel = spec.channel ?? 'luminance';
  const edge = spec.edge ?? 'clamp';
  const data = new Uint8Array(source.data.length);

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const i = (y * source.width + x) * 4;
      const amount = normalizeMap(mapValue(map.data, i, channel));
      const sx = x - amount * scaleX;
      const sy = y - amount * scaleY;
      data[i] = bilinear(source, sx, sy, 0, edge);
      data[i + 1] = bilinear(source, sx, sy, 1, edge);
      data[i + 2] = bilinear(source, sx, sy, 2, edge);
      data[i + 3] = bilinear(source, sx, sy, 3, edge);
    }
  }

  return { width: source.width, height: source.height, data };
}
