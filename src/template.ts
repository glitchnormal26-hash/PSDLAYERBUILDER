import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsd, writePsdBuffer } from 'ag-psd';
import { imageMetadata, readRgba } from './image.js';
import { warpPerspective } from './perspective.js';
import type { Quad, ReplaceSmartObjectOptions, ReplaceSmartObjectResult } from './types.js';

function findLayerByName(layers: any[], name: string): any | undefined {
  for (const layer of layers) {
    if (layer.name === name) return layer;
    if (Array.isArray(layer.children)) {
      const nested = findLayerByName(layer.children, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

export async function replaceSmartObject(options: ReplaceSmartObjectOptions): Promise<ReplaceSmartObjectResult> {
  const template = path.resolve(options.template);
  const artwork = path.resolve(options.artwork);
  const output = path.resolve(options.output);
  const warnings: string[] = [];

  // Keep untouched bitmap channels compressed/raw. This avoids a Canvas dependency,
  // reduces memory usage, and preserves source layer pixels without a decode/re-encode cycle.
  const psd: any = readPsd(await readFile(template), {
    useRawData: true,
    useRawThumbnail: true,
  });
  const layer = findLayerByName(psd.children ?? [], options.layerName);
  if (!layer) throw new Error(`Layer not found: ${options.layerName}`);
  if (!layer.placedLayer?.id) throw new Error(`Layer is not a smart object: ${options.layerName}`);

  const linked = (psd.linkedFiles ?? []).find((file: any) => file.id === layer.placedLayer.id);
  if (!linked) throw new Error(`Embedded source for smart object "${options.layerName}" was not found`);

  const artworkBytes = new Uint8Array(await readFile(artwork));
  const metadata = await imageMetadata(artwork);
  linked.data = artworkBytes;
  linked.name = path.basename(artwork);
  layer.placedLayer.width = metadata.width;
  layer.placedLayer.height = metadata.height;

  const transform = layer.placedLayer.transform;
  if (Array.isArray(transform) && transform.length === 8) {
    const warped = warpPerspective(await readRgba(artwork), transform as Quad);
    layer.rawData = undefined;
    layer.imageData = warped.image;
    layer.canvas = undefined;
    layer.left = warped.left;
    layer.top = warped.top;
    layer.right = warped.left + warped.image.width;
    layer.bottom = warped.top + warped.image.height;
    if (layer.placedLayer.warp) {
      warnings.push('The template contains Photoshop warp metadata. The embedded artwork was replaced and the cache was perspective-rendered, but Photoshop should perform the final warp render on open.');
    }
  } else {
    warnings.push('Smart object has no supported 8-point transform; embedded source was replaced but its layer cache was left unchanged.');
  }

  // Do not preserve stale flattened pixels after replacing a smart-object source.
  psd.rawCompositeData = undefined;
  psd.imageData = undefined;
  psd.canvas = undefined;
  if (psd.imageResources) {
    psd.imageResources.thumbnail = undefined;
    psd.imageResources.thumbnailRaw = undefined;
  }

  const buffer = writePsdBuffer(psd, {
    generateThumbnail: false,
    trimImageData: false,
    logMissingFeatures: true,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, buffer);

  return { output, bytes: buffer.byteLength, layerName: options.layerName, warnings };
}
