import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPsd, writePsdBuffer } from 'ag-psd';
import { imageMetadataFromBytes, readRgbaFromBytes, type RgbaImage } from './image.js';
import { warpPerspective } from './perspective.js';
import { replacementMapSchema } from './schema.js';
import type {
  AppliedReplacement,
  Quad,
  ReplacementMap,
  ReplaceSmartObjectOptions,
  ReplaceSmartObjectResult,
  ReplaceSmartObjectsOptions,
  ReplaceSmartObjectsResult,
  SmartObjectReplacement,
  SmartObjectSelector,
} from './types.js';

interface IndexedLayer {
  layer: any;
  name: string;
  path: string[];
  displayPath: string;
}

interface LayerIndex {
  all: IndexedLayer[];
  byName: Map<string, IndexedLayer[]>;
  byPath: Map<string, IndexedLayer[]>;
  byLinkId: Map<string, IndexedLayer[]>;
}

interface ArtworkAsset {
  artworkPath: string;
  artworkBytes: Uint8Array;
  width: number;
  height: number;
}

interface PreparedReplacement extends ArtworkAsset {
  target: IndexedLayer;
  linkId: string;
}

interface LinkGroup {
  linkId: string;
  primary: PreparedReplacement;
  selected: PreparedReplacement[];
  affected: IndexedLayer[];
}

function pathKey(parts: string[]): string {
  return parts.join('\u0000');
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function createLayerIndex(layers: any[]): LayerIndex {
  const index: LayerIndex = {
    all: [],
    byName: new Map(),
    byPath: new Map(),
    byLinkId: new Map(),
  };

  const visit = (items: any[], parent: string[]): void => {
    for (const layer of items) {
      const name = layer.name ?? '(unnamed)';
      const layerPath = [...parent, name];
      const entry: IndexedLayer = { layer, name, path: layerPath, displayPath: layerPath.join('/') };
      index.all.push(entry);
      pushMapValue(index.byName, name, entry);
      pushMapValue(index.byPath, pathKey(layerPath), entry);
      if (layer.placedLayer?.id) pushMapValue(index.byLinkId, layer.placedLayer.id, entry);
      if (Array.isArray(layer.children)) visit(layer.children, layerPath);
    }
  };

  visit(layers, []);
  return index;
}

function selectLayer(index: LayerIndex, selector: SmartObjectSelector): IndexedLayer {
  if (selector.path?.length) {
    const matches = index.byPath.get(pathKey(selector.path)) ?? [];
    if (matches.length === 0) throw new Error(`Layer path not found: ${selector.path.join('/')}`);
    if (matches.length > 1) throw new Error(`Layer path is ambiguous: ${selector.path.join('/')}`);
    return matches[0];
  }

  if (!selector.name) throw new Error('Smart-object selector requires name or path');
  const matches = index.byName.get(selector.name) ?? [];
  if (matches.length === 0) throw new Error(`Layer not found: ${selector.name}`);
  if (matches.length > 1) {
    const choices = matches.map((entry) => entry.displayPath).join(', ');
    throw new Error(`Layer name is ambiguous: ${selector.name}. Use an exact path. Matches: ${choices}`);
  }
  return matches[0];
}

function resolveArtwork(cwd: string, artwork: string): string {
  if (/^[a-z]+:\/\//i.test(artwork)) throw new Error(`Remote artwork is not allowed: ${artwork}`);
  return path.resolve(cwd, artwork);
}

async function writeAtomic(output: string, buffer: Uint8Array): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer);
    try {
      await rename(temporary, output);
    } catch (error: any) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
      await rm(output, { force: true });
      await rename(temporary, output);
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function clearFlattenedPreview(psd: any): void {
  psd.rawCompositeData = undefined;
  psd.imageData = undefined;
  psd.canvas = undefined;
  if (psd.imageResources) {
    psd.imageResources.thumbnail = undefined;
    psd.imageResources.thumbnailRaw = undefined;
  }
}

function loadArtworkAsset(cache: Map<string, Promise<ArtworkAsset>>, artworkPath: string): Promise<ArtworkAsset> {
  let pending = cache.get(artworkPath);
  if (!pending) {
    pending = (async () => {
      const artworkBytes = await readFile(artworkPath);
      const metadata = await imageMetadataFromBytes(artworkBytes, artworkPath);
      return {
        artworkPath,
        artworkBytes,
        width: metadata.width,
        height: metadata.height,
      };
    })();
    cache.set(artworkPath, pending);
  }
  return pending;
}

async function prepareReplacements(index: LayerIndex, replacements: SmartObjectReplacement[], cwd: string): Promise<PreparedReplacement[]> {
  const prepared: PreparedReplacement[] = [];
  const selectedPaths = new Set<string>();
  const artworkCache = new Map<string, Promise<ArtworkAsset>>();

  for (const replacement of replacements) {
    const target = selectLayer(index, replacement.selector);
    if (selectedPaths.has(target.displayPath)) throw new Error(`Layer is replaced more than once: ${target.displayPath}`);
    selectedPaths.add(target.displayPath);

    if (!target.layer.placedLayer?.id) throw new Error(`Layer is not a smart object: ${target.displayPath}`);
    const artworkPath = resolveArtwork(cwd, replacement.artwork);
    const asset = await loadArtworkAsset(artworkCache, artworkPath);
    prepared.push({ ...asset, target, linkId: target.layer.placedLayer.id });
  }

  const artworkByLink = new Map<string, string>();
  for (const item of prepared) {
    const previous = artworkByLink.get(item.linkId);
    if (previous && previous !== item.artworkPath) {
      throw new Error(`Conflicting replacements target shared smart-object source ${item.linkId}: ${previous} vs ${item.artworkPath}`);
    }
    artworkByLink.set(item.linkId, item.artworkPath);
  }
  return prepared;
}

async function refreshInstanceCache(
  entry: IndexedLayer,
  prepared: PreparedReplacement,
  sourceImage: RgbaImage | undefined,
  warnings: string[],
): Promise<void> {
  const layer = entry.layer;
  layer.placedLayer.width = prepared.width;
  layer.placedLayer.height = prepared.height;
  const transform = layer.placedLayer.transform;

  if (Array.isArray(transform) && transform.length === 8) {
    if (!sourceImage) throw new Error(`Internal cache error while rendering ${entry.displayPath}`);
    const warped = warpPerspective(sourceImage, transform as Quad);
    layer.rawData = undefined;
    layer.imageData = warped.image;
    layer.canvas = undefined;
    layer.left = warped.left;
    layer.top = warped.top;
    layer.right = warped.left + warped.image.width;
    layer.bottom = warped.top + warped.image.height;
    if (layer.placedLayer.warp) {
      warnings.push(`Smart object "${entry.displayPath}" contains Photoshop warp metadata. The projective cache was refreshed; use the UXP finalizer for Photoshop-native warp rendering.`);
    }
  } else {
    warnings.push(`Smart object "${entry.displayPath}" has no supported 8-point transform; embedded source changed but its raster cache was left unchanged.`);
  }
}

function createLinkGroups(index: LayerIndex, prepared: PreparedReplacement[]): LinkGroup[] {
  const selectedByLink = new Map<string, PreparedReplacement[]>();
  for (const item of prepared) pushMapValue(selectedByLink, item.linkId, item);
  return [...selectedByLink.entries()].map(([linkId, selected]) => ({
    linkId,
    primary: selected[0],
    selected,
    affected: index.byLinkId.get(linkId) ?? [],
  }));
}

export async function replaceSmartObjects(options: ReplaceSmartObjectsOptions): Promise<ReplaceSmartObjectsResult> {
  if (options.replacements.length === 0) throw new Error('At least one replacement is required');
  if (options.replacements.length > 1000) throw new Error('Replacement count exceeds the 1000 item safety limit');

  const template = path.resolve(options.template);
  const output = path.resolve(options.output);
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];

  const psd: any = readPsd(await readFile(template), { useRawData: true, useRawThumbnail: true });
  const index = createLayerIndex(psd.children ?? []);
  const prepared = await prepareReplacements(index, options.replacements, cwd);
  const linkedById = new Map<string, any>((psd.linkedFiles ?? []).map((file: any) => [file.id, file]));
  const applied: AppliedReplacement[] = [];
  const linkGroups = createLinkGroups(index, prepared);
  const groupsByArtwork = new Map<string, LinkGroup[]>();
  for (const group of linkGroups) pushMapValue(groupsByArtwork, group.primary.artworkPath, group);

  for (const artworkGroups of groupsByArtwork.values()) {
    const needsDecodedCache = artworkGroups.some((group) =>
      group.affected.some((entry) => Array.isArray(entry.layer.placedLayer?.transform) && entry.layer.placedLayer.transform.length === 8));
    const sourceImage = needsDecodedCache
      ? await readRgbaFromBytes(artworkGroups[0].primary.artworkBytes)
      : undefined;

    for (const group of artworkGroups) {
      const item = group.primary;
      const linked = linkedById.get(group.linkId);
      if (!linked) throw new Error(`Embedded source for smart object "${item.target.displayPath}" was not found`);
      linked.data = item.artworkBytes;
      linked.name = path.basename(item.artworkPath);

      for (const instance of group.affected) await refreshInstanceCache(instance, item, sourceImage, warnings);

      for (const selectedItem of group.selected) {
        applied.push({
          layerPath: selectedItem.target.displayPath,
          artwork: selectedItem.artworkPath,
          linkedFileId: group.linkId,
          affectedLayerPaths: group.affected.map((entry) => entry.displayPath),
        });
      }

      if (group.affected.length > group.selected.length) {
        warnings.push(`Replacement for "${item.target.displayPath}" also updated ${group.affected.length - group.selected.length} shared smart-object instance(s).`);
      }
    }
  }

  clearFlattenedPreview(psd);
  const buffer = writePsdBuffer(psd, {
    generateThumbnail: false,
    trimImageData: false,
    logMissingFeatures: true,
  });
  await writeAtomic(output, buffer);
  return { output, bytes: buffer.byteLength, replacements: applied, warnings };
}

export async function replaceSmartObject(options: ReplaceSmartObjectOptions): Promise<ReplaceSmartObjectResult> {
  const result = await replaceSmartObjects({
    template: options.template,
    replacements: [{ selector: { name: options.layerName }, artwork: options.artwork }],
    output: options.output,
  });
  return { output: result.output, bytes: result.bytes, layerName: options.layerName, warnings: result.warnings };
}

export async function replaceSmartObjectsFromMap(template: string, mapFile: string, output: string): Promise<ReplaceSmartObjectsResult> {
  const absoluteMap = path.resolve(mapFile);
  const parsed = replacementMapSchema.parse(JSON.parse(await readFile(absoluteMap, 'utf8'))) as ReplacementMap;
  return replaceSmartObjects({
    template,
    replacements: parsed.replacements.map((entry) => ({
      selector: entry.path ? { path: entry.path } : { name: entry.layer },
      artwork: entry.artwork,
    })),
    output,
    cwd: path.dirname(absoluteMap),
  });
}
