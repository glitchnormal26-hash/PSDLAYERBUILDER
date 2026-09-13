import sharp from 'sharp';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function asBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

async function decodeRgba(input: string | Uint8Array, width?: number, height?: number): Promise<RgbaImage> {
  const source = typeof input === 'string' ? input : asBuffer(input);
  let pipeline = sharp(source, { failOn: 'error' }).ensureAlpha();
  if (width || height) {
    pipeline = pipeline.resize({ width, height, fit: 'fill', withoutEnlargement: false });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export async function readRgba(file: string, width?: number, height?: number): Promise<RgbaImage> {
  return decodeRgba(file, width, height);
}

export async function readRgbaFromBytes(bytes: Uint8Array, width?: number, height?: number): Promise<RgbaImage> {
  return decodeRgba(bytes, width, height);
}

async function metadataFrom(input: string | Uint8Array): Promise<{ width: number; height: number }> {
  const source = typeof input === 'string' ? input : asBuffer(input);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Unable to determine image dimensions');
  return { width: metadata.width, height: metadata.height };
}

export async function imageMetadata(file: string): Promise<{ width: number; height: number }> {
  try {
    return await metadataFrom(file);
  } catch (error) {
    throw new Error(`Unable to determine image dimensions: ${file}`, { cause: error });
  }
}

export async function imageMetadataFromBytes(bytes: Uint8Array, label = 'image'): Promise<{ width: number; height: number }> {
  try {
    return await metadataFrom(bytes);
  } catch (error) {
    throw new Error(`Unable to determine image dimensions: ${label}`, { cause: error });
  }
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
