import sharp from 'sharp';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function readRgba(file: string, width?: number, height?: number): Promise<RgbaImage> {
  let pipeline = sharp(file, { failOn: 'error' }).ensureAlpha();
  if (width || height) {
    pipeline = pipeline.resize({ width, height, fit: 'fill', withoutEnlargement: false });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export async function imageMetadata(file: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Unable to determine image dimensions: ${file}`);
  return { width: metadata.width, height: metadata.height };
}

export function parseHexColor(hex = '#000000'): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function solidRgba(width: number, height: number, hex: string, alpha = 255): RgbaImage {
  const { r, g, b } = parseHexColor(hex);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return { width, height, data };
}
