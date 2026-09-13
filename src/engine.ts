import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writePsdBuffer } from 'ag-psd';
import { displaceRgba } from './displacement.js';
import { compileEffects } from './effects.js';
import { readRgba, imageMetadata, parseHexColor, solidRgba, type RgbaImage } from './image.js';
import { warpPerspective } from './perspective.js';
import { mockupManifestSchema } from './schema.js';
import { applyVectorMaskForComposite, compileVectorMask } from './vector-mask.js';
import type { BuildOptions, BuildResult, LayerMaskSpec, LayerSpec, MockupManifest, NativeWarpSpec, Quad } from './types.js';

interface CompileContext {
  cwd: string;
  dpi: number;
  linkedFiles: any[];
  smartObjectCount: number;
  layerCount: number;
  warnings: string[];
  compositeEntries: CompositeEntry[];
  collectComposite: boolean;
  warnedCompositeClipping: boolean;
  warnedCompositeEffects: boolean;
  warnedVectorFeather: boolean;
  metadataCache: Map<string, Promise<{ width: number; height: number }>>;
  sourceBytesCache: Map<string, Promise<Uint8Array>>;
}

interface CompositeEntry {
  image: RgbaImage;
  left: number;
  top: number;
  opacity: number;
}

interface CompiledMask {
  image: RgbaImage;
  left: number;
  top: number;
  defaultColor: 0 | 255;
  native: any;
}

function resolveSource(cwd: string, source: string): string {
  if (/^[a-z]+:\/\//i.test(source)) throw new Error(`Remote sources are not allowed: ${source}`);
  return path.resolve(cwd, source);
}

function getMetadata(ctx: CompileContext, source: string): Promise<{ width: number; height: number }> {
  let pending = ctx.metadataCache.get(source);
  if (!pending) {
    pending = imageMetadata(source);
    ctx.metadataCache.set(source, pending);
  }
  return pending;
}

function getSourceBytes(ctx: CompileContext, source: string): Promise<Uint8Array> {
  let pending = ctx.sourceBytesCache.get(source);
  if (!pending) {
    pending = readFile(source).then((bytes) => bytes as Uint8Array);
    ctx.sourceBytesCache.set(source, pending);
  }
  return pending;
}

function commonLayer(spec: LayerSpec, ctx: CompileContext) {
  const effects = compileEffects(spec.effects);
  if (ctx.collectComposite && effects && !ctx.warnedCompositeEffects) {
    ctx.warnings.push('Layer effects are stored as editable Photoshop effects; the convenience composite preview does not rasterize them.');
    ctx.warnedCompositeEffects = true;
  }
  if (ctx.collectComposite && spec.clipping && !ctx.warnedCompositeClipping) {
    ctx.warnings.push('Clipping masks are stored natively; the convenience composite preview does not emulate clipping groups.');
    ctx.warnedCompositeClipping = true;
  }
  return {
    name: spec.name,
    hidden: spec.visible === false,
    opacity: spec.opacity ?? 1,
    blendMode: spec.blendMode ?? 'normal',
    clipping: spec.clipping ?? false,
    ...(effects ? { effects } : {}),
  };
}

function grayscaleMask(source: RgbaImage, invert: boolean): RgbaImage {
  const data = new Uint8Array(source.data.length);
  for (let i = 0; i < source.data.length; i += 4) {
    const lum = Math.round(source.data[i] * 0.2126 + source.data[i + 1] * 0.7152 + source.data[i + 2] * 0.0722);
    let value = Math.round(lum * (source.data[i + 3] / 255));
    if (invert) value = 255 - value;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width: source.width, height: source.height, data };
}

async function compileMask(spec: LayerMaskSpec, layerLeft: number, layerTop: number, width: number, height: number, ctx: CompileContext): Promise<CompiledMask> {
  const source = resolveSource(ctx.cwd, spec.source);
  const maskWidth = Math.round(spec.width ?? width);
  const maskHeight = Math.round(spec.height ?? height);
  const image = grayscaleMask(await readRgba(source, maskWidth, maskHeight), spec.invert ?? false);
  const left = Math.round(spec.x ?? layerLeft);
  const top = Math.round(spec.y ?? layerTop);
  const defaultColor: 0 | 255 = spec.defaultColor ?? 0;

  return {
    image,
    left,
    top,
    defaultColor,
    native: {
      top,
      left,
      bottom: top + image.height,
      right: left + image.width,
      defaultColor,
      disabled: false,
      positionRelativeToLayer: false,
      fromVectorData: false,
      userMaskFeather: spec.feather ?? 0,
      imageData: image,
    },
  };
}

function applyMaskForComposite(source: RgbaImage, layerLeft: number, layerTop: number, mask: CompiledMask): RgbaImage {
  const data = new Uint8Array(source.data);
  for (let y = 0; y < source.height; y += 1) {
    const docY = layerTop + y;
    for (let x = 0; x < source.width; x += 1) {
      const docX = layerLeft + x;
      const mx = docX - mask.left;
      const my = docY - mask.top;
      let value: number = mask.defaultColor;
      if (mx >= 0 && my >= 0 && mx < mask.image.width && my < mask.image.height) {
        value = mask.image.data[(my * mask.image.width + mx) * 4];
      }
      const i = (y * source.width + x) * 4;
      data[i + 3] = Math.round(data[i + 3] * (value / 255));
    }
  }
  return { width: source.width, height: source.height, data };
}

function compileNativeWarp(spec: NativeWarpSpec, transform: Quad | undefined): any | undefined {
  if (!transform) return undefined;
  const xs = [transform[0], transform[2], transform[4], transform[6]];
  const ys = [transform[1], transform[3], transform[5], transform[7]];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const rotate = spec.rotate ?? 'horizontal';
  const perspective = spec.perspective ?? 0;
  const perspectiveOther = spec.perspectiveOther ?? 0;

  if (spec.style === 'cylinder') {
    const seededCurve = 0.5 + (spec.bend ?? 18) / 200;
    const curve = Math.max(0.02, Math.min(0.98, spec.cylinderCurve ?? seededCurve));
    const height = Math.max(1, bottom - top);
    const inset = Math.min(height * 0.18, Math.abs(curve - 0.5) * height * 0.55);
    const boundsTop = top + inset;
    const boundsBottom = bottom - inset;
    return {
      style: 'cylinder',
      values: [left, boundsBottom, right, boundsTop, 0.5, 0.5, curve],
      perspective,
      perspectiveOther,
      rotate,
      bounds: {
        top: { value: boundsTop, units: 'Pixels' },
        left: { value: left, units: 'Pixels' },
        bottom: { value: boundsBottom, units: 'Pixels' },
        right: { value: right, units: 'Pixels' },
      },
      uOrder: 4,
      vOrder: 4,
    };
  }

  return {
    style: spec.style,
    value: spec.bend ?? 0,
    perspective,
    perspectiveOther,
    rotate,
  };
}

async function compileLayer(spec: LayerSpec, ctx: CompileContext): Promise<any> {
  ctx.layerCount += 1;

  if (spec.type === 'group') {
    const children = [];
    for (const child of spec.children) children.push(await compileLayer(child, ctx));
    return { ...commonLayer(spec, ctx), opened: spec.opened ?? true, children };
  }

  if (spec.type === 'text') {
    const color = parseHexColor(spec.color ?? '#111111');
    ctx.warnings.push(`Text layer "${spec.name}" is editable, but Photoshop may ask to refresh text rendering on first open.`);
    return {
      ...commonLayer(spec, ctx),
      text: {
        text: spec.text,
        transform: [1, 0, 0, 1, spec.x, spec.y],
        style: { font: { name: spec.font ?? 'ArialMT' }, fontSize: spec.size ?? 48, fillColor: color },
      },
    };
  }

  const source = resolveSource(ctx.cwd, spec.source);
  const original = await getMetadata(ctx, source);
  let preview: RgbaImage;
  let x: number;
  let y: number;
  let placedTransform: Quad | undefined;

  if (spec.type === 'smart-object' && spec.quad) {
    const sourceImage = await readRgba(source);
    const warped = warpPerspective(sourceImage, spec.quad);
    preview = warped.image;
    x = warped.left;
    y = warped.top;
    placedTransform = spec.quad;
  } else {
    x = Math.round(spec.x ?? 0);
    y = Math.round(spec.y ?? 0);
    const targetWidth = Math.round(spec.width ?? original.width);
    const targetHeight = Math.round(spec.height ?? original.height);
    preview = await readRgba(source, targetWidth, targetHeight);
    if (spec.type === 'smart-object') {
      placedTransform = [
        x, y,
        x + preview.width, y,
        x + preview.width, y + preview.height,
        x, y + preview.height,
      ];
    }
  }

  if (spec.displacement) {
    const pixels = preview.width * preview.height;
    if (pixels > 80_000_000) {
      ctx.warnings.push(`Displacement skipped for "${spec.name}" because its preview exceeds 80 megapixels.`);
    } else {
      const mapPath = resolveSource(ctx.cwd, spec.displacement.source);
      const map = await readRgba(mapPath, preview.width, preview.height);
      preview = displaceRgba(preview, map, spec.displacement);
      if (spec.type === 'smart-object') {
        ctx.warnings.push(`Displacement on smart object "${spec.name}" is baked into the raster cache only; the embedded artwork remains editable but does not contain a native Photoshop displacement filter.`);
      }
    }
  }

  const mask = spec.mask ? await compileMask(spec.mask, x, y, preview.width, preview.height, ctx) : undefined;
  const vectorMask = spec.vectorMask ? compileVectorMask(spec.vectorMask) : undefined;

  if (ctx.collectComposite && spec.visible !== false) {
    let compositePreview = mask ? applyMaskForComposite(preview, x, y, mask) : preview;
    if (spec.vectorMask) {
      compositePreview = applyVectorMaskForComposite(compositePreview, x, y, spec.vectorMask);
      if ((spec.vectorMask.feather ?? 0) > 0 && !ctx.warnedVectorFeather) {
        ctx.warnings.push('Vector-mask feather is stored natively in the PSD; the convenience composite preview uses a hard vector edge.');
        ctx.warnedVectorFeather = true;
      }
    }
    ctx.compositeEntries.push({ image: compositePreview, left: x, top: y, opacity: spec.opacity ?? 1 });
  }

  let nativeMask = mask?.native;
  if (spec.vectorMask) {
    if (!nativeMask) {
      nativeMask = {
        top: y,
        left: x,
        bottom: y + preview.height,
        right: x + preview.width,
        defaultColor: 0,
        disabled: false,
        positionRelativeToLayer: false,
        fromVectorData: true,
      };
    }
    nativeMask.vectorMaskFeather = spec.vectorMask.feather ?? 0;
  }

  const layer: any = {
    ...commonLayer(spec, ctx),
    top: y,
    left: x,
    bottom: y + preview.height,
    right: x + preview.width,
    imageData: preview,
    ...(nativeMask ? { mask: nativeMask } : {}),
    ...(vectorMask ? { vectorMask } : {}),
  };

  if (spec.type === 'smart-object') {
    ctx.smartObjectCount += 1;
    const linkId = randomUUID();
    const placedId = randomUUID();
    const sourceBytes = await getSourceBytes(ctx, source);
    ctx.linkedFiles.push({ id: linkId, name: path.basename(source), data: sourceBytes });
    const nativeWarp = spec.nativeWarp ? compileNativeWarp(spec.nativeWarp, placedTransform) : undefined;
    layer.placedLayer = {
      id: linkId,
      placed: placedId,
      type: 'raster',
      transform: placedTransform,
      width: original.width,
      height: original.height,
      resolution: { value: spec.dpi ?? ctx.dpi, units: 'Density' },
      ...(nativeWarp ? { warp: nativeWarp } : {}),
    };
    if (nativeWarp) ctx.warnings.push(`Smart object "${spec.name}" contains native Photoshop ${spec.nativeWarp!.style} warp metadata. Run the UXP finalizer after replacement for Photoshop-native cache rendering.`);
  }

  return layer;
}

function compositeOverOpaque(base: RgbaImage, entry: CompositeEntry): void {
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
      const alpha = (image.data[si + 3] / 255) * opacity;
      if (alpha <= 0) continue;
      const di = (y * base.width + x) * 4;
      if (alpha >= 1) {
        base.data[di] = image.data[si];
        base.data[di + 1] = image.data[si + 1];
        base.data[di + 2] = image.data[si + 2];
      } else {
        const inverse = 1 - alpha;
        base.data[di] = Math.round(image.data[si] * alpha + base.data[di] * inverse);
        base.data[di + 1] = Math.round(image.data[si + 1] * alpha + base.data[di + 1] * inverse);
        base.data[di + 2] = Math.round(image.data[si + 2] * alpha + base.data[di + 2] * inverse);
      }
    }
  }
}

function buildComposite(manifest: MockupManifest, entries: CompositeEntry[]): RgbaImage {
  const { width, height, background = '#ffffff' } = manifest.document;
  const base = solidRgba(width, height, background, 255);
  for (let index = entries.length - 1; index >= 0; index -= 1) compositeOverOpaque(base, entries[index]);
  return base;
}

export async function buildMockup(input: unknown, options: BuildOptions): Promise<BuildResult> {
  const manifest = mockupManifestSchema.parse(input) as MockupManifest;
  const cwd = options.cwd ?? process.cwd();
  const output = path.resolve(cwd, options.output);
  const pixels = manifest.document.width * manifest.document.height;
  const requestedComposite = options.generateComposite !== false;
  const collectComposite = requestedComposite && pixels <= 80_000_000;
  const warnings: string[] = [];
  if (requestedComposite && !collectComposite) {
    warnings.push('Composite preview skipped because the document exceeds 80 megapixels. Editable layers are still written.');
  }

  const ctx: CompileContext = {
    cwd,
    dpi: manifest.document.dpi ?? 72,
    linkedFiles: [],
    smartObjectCount: 0,
    layerCount: 0,
    warnings,
    compositeEntries: [],
    collectComposite,
    warnedCompositeClipping: false,
    warnedCompositeEffects: false,
    warnedVectorFeather: false,
    metadataCache: new Map(),
    sourceBytesCache: new Map(),
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

  if (collectComposite) psd.imageData = buildComposite(manifest, ctx.compositeEntries);

  const buffer = writePsdBuffer(psd, {
    generateThumbnail: false,
    trimImageData: true,
    invalidateTextLayers: true,
    logMissingFeatures: true,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buffer);

  return { output, bytes: buffer.byteLength, layerCount: ctx.layerCount, smartObjectCount: ctx.smartObjectCount, warnings: ctx.warnings };
}

export async function buildMockupFile(
  manifestFile: string,
  output: string,
  options: Pick<BuildOptions, 'generateComposite'> = {},
): Promise<BuildResult> {
  const absoluteManifest = path.resolve(manifestFile);
  const source = JSON.parse(await readFile(absoluteManifest, 'utf8'));
  return buildMockup(source, {
    output: path.resolve(output),
    cwd: path.dirname(absoluteManifest),
    generateComposite: options.generateComposite,
  });
}
