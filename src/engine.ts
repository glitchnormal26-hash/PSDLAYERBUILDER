import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writePsdBuffer } from 'ag-psd';
import { readRgba, imageMetadata, parseHexColor, solidRgba, type RgbaImage } from './image.js';
import { mockupManifestSchema } from './schema.js';
import type { BuildOptions, BuildResult, LayerSpec, MockupManifest } from './types.js';

interface CompileContext {
  cwd: string;
  dpi: number;
  linkedFiles: any[];
  smartObjectCount: number;
  layerCount: number;
  warnings: string[];
  compositeEntries: CompositeEntry[];
}

interface CompositeEntry {
  image: RgbaImage;
  left: number;
  top: number;
  opacity: number;
}

function resolveSource(cwd: string, source: string): string {
  if (/^[a-z]+:\/\//i.test(source)) throw new Error(`Remote sources are not allowed: ${source}`);
  return path.resolve(cwd, source);
}

function commonLayer(spec: LayerSpec) {
  return {
    name: spec.name,
    hidden: spec.visible === false,
    opacity: spec.opacity ?? 1,
    blendMode: spec.blendMode ?? 'normal',
  };
}

async function compileLayer(spec: LayerSpec, ctx: CompileContext): Promise<any> {
  ctx.layerCount += 1;

  if (spec.type === 'group') {
    const children = [];
    for (const child of spec.children) children.push(await compileLayer(child, ctx));
    return {
      ...commonLayer(spec),
      opened: spec.opened ?? true,
      children,
    };
  }

  if (spec.type === 'text') {
    const color = parseHexColor(spec.color ?? '#111111');
    ctx.warnings.push(`Text layer "${spec.name}" is editable, but Photoshop may ask to refresh text rendering on first open.`);
    return {
      ...commonLayer(spec),
      text: {
        text: spec.text,
        transform: [1, 0, 0, 1, spec.x, spec.y],
        style: {
          font: { name: spec.font ?? 'ArialMT' },
          fontSize: spec.size ?? 48,
          fillColor: color,
        },
      },
    };
  }

  const source = resolveSource(ctx.cwd, spec.source);
  const x = Math.round(spec.x ?? 0);
  const y = Math.round(spec.y ?? 0);
  const original = await imageMetadata(source);
  const targetWidth = Math.round(spec.width ?? original.width);
  const targetHeight = Math.round(spec.height ?? original.height);
  const preview = await readRgba(source, targetWidth, targetHeight);

  if (spec.visible !== false) {
    ctx.compositeEntries.push({ image: preview, left: x, top: y, opacity: spec.opacity ?? 1 });
  }

  const layer: any = {
    ...commonLayer(spec),
    top: y,
    left: x,
    bottom: y + preview.height,
    right: x + preview.width,
    imageData: preview,
  };

  if (spec.type === 'smart-object') {
    ctx.smartObjectCount += 1;
    const linkId = randomUUID();
    const placedId = randomUUID();
    const sourceBytes = new Uint8Array(await readFile(source));
    ctx.linkedFiles.push({ id: linkId, name: path.basename(source), data: sourceBytes });
    layer.placedLayer = {
      id: linkId,
      placed: placedId,
      type: 'raster',
      transform: [
        x, y,
        x + targetWidth, y,
        x + targetWidth, y + targetHeight,
        x, y + targetHeight,
      ],
      width: original.width,
      height: original.height,
      resolution: { value: spec.dpi ?? ctx.dpi, units: 'Density' },
    };
  }

  return layer;
}

function compositeOver(base: RgbaImage, entry: CompositeEntry): void {
  const { image, left, top, opacity } = entry;
  const startX = Math.max(0, left);
  const startY = Math.max(0, top);
  const endX = Math.min(base.width, left + image.width);
  const endY = Math.min(base.height, top + image.height);
  if (startX >= endX || startY >= endY) return;

  for (let y = startY; y < endY; y += 1) {
    const sourceY = y - top;
    for (let x = startX; x < endX; x += 1) {
      const sourceX = x - left;
      const si = (sourceY * image.width + sourceX) * 4;
      const di = (y * base.width + x) * 4;
      const sourceAlpha = (image.data[si + 3] / 255) * opacity;
      if (sourceAlpha <= 0) continue;
      const destinationAlpha = base.data[di + 3] / 255;
      const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) continue;

      for (let channel = 0; channel < 3; channel += 1) {
        const source = image.data[si + channel] / 255;
        const destination = base.data[di + channel] / 255;
        const out = (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outAlpha;
        base.data[di + channel] = Math.round(out * 255);
      }
      base.data[di + 3] = Math.round(outAlpha * 255);
    }
  }
}

function buildComposite(manifest: MockupManifest, entries: CompositeEntry[]): RgbaImage {
  const { width, height, background = '#ffffff' } = manifest.document;
  const base = solidRgba(width, height, background, 255);
  for (const entry of [...entries].reverse()) compositeOver(base, entry);
  return base;
}

export async function buildMockup(input: unknown, options: BuildOptions): Promise<BuildResult> {
  const manifest = mockupManifestSchema.parse(input) as MockupManifest;
  const cwd = options.cwd ?? process.cwd();
  const output = path.resolve(cwd, options.output);
  const ctx: CompileContext = {
    cwd,
    dpi: manifest.document.dpi ?? 72,
    linkedFiles: [],
    smartObjectCount: 0,
    layerCount: 0,
    warnings: [],
    compositeEntries: [],
  };

  const children = [];
  for (const layer of manifest.layers) children.push(await compileLayer(layer, ctx));

  const psd: any = {
    width: manifest.document.width,
    height: manifest.document.height,
    children,
    linkedFiles: ctx.linkedFiles,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: ctx.dpi,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: ctx.dpi,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches',
      },
    },
  };

  const pixels = manifest.document.width * manifest.document.height;
  if (options.generateComposite !== false && pixels <= 80_000_000) {
    psd.imageData = buildComposite(manifest, ctx.compositeEntries);
  } else if (options.generateComposite !== false) {
    ctx.warnings.push('Composite preview skipped because the document exceeds 80 megapixels. Editable layers are still written.');
  }

  const buffer = writePsdBuffer(psd, {
    generateThumbnail: false,
    trimImageData: true,
    invalidateTextLayers: true,
    logMissingFeatures: true,
  });

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buffer);

  return {
    output,
    bytes: buffer.byteLength,
    layerCount: ctx.layerCount,
    smartObjectCount: ctx.smartObjectCount,
    warnings: ctx.warnings,
  };
}

export async function buildMockupFile(manifestFile: string, output: string): Promise<BuildResult> {
  const absoluteManifest = path.resolve(manifestFile);
  const source = JSON.parse(await readFile(absoluteManifest, 'utf8'));
  return buildMockup(source, { output, cwd: path.dirname(absoluteManifest) });
}
