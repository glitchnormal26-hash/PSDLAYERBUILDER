import { readFile } from 'node:fs/promises';
import { readPsd } from 'ag-psd';
import type { PsdDiagnostic, PsdDoctorResult } from './types.js';

interface IndexedLayer {
  layer: any;
  name: string;
  path: string[];
  displayPath: string;
}

function indexLayers(layers: any[], parent: string[] = []): IndexedLayer[] {
  const result: IndexedLayer[] = [];
  for (const layer of layers) {
    const name = layer.name ?? '(unnamed)';
    const layerPath = [...parent, name];
    result.push({ layer, name, path: layerPath, displayPath: layerPath.join('/') });
    if (Array.isArray(layer.children)) result.push(...indexLayers(layer.children, layerPath));
  }
  return result;
}

export async function doctorPsd(file: string): Promise<PsdDoctorResult> {
  const psd: any = readPsd(await readFile(file), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const index = indexLayers(psd.children ?? []);
  const diagnostics: PsdDiagnostic[] = [];
  const linkedFiles = psd.linkedFiles ?? [];
  const linkedIds = new Set(linkedFiles.map((linked: any) => linked.id));
  const pathCounts = new Map<string, number>();
  const linkReferences = new Map<string, string[]>();

  for (const entry of index) {
    pathCounts.set(entry.displayPath, (pathCounts.get(entry.displayPath) ?? 0) + 1);
    const layer = entry.layer;
    if (!layer.placedLayer) continue;
    const id = layer.placedLayer.id;
    if (!id) {
      diagnostics.push({ severity: 'error', code: 'SMART_OBJECT_ID_MISSING', message: 'Smart object has no linked-file id.', layerPath: entry.displayPath });
      continue;
    }
    if (!linkedIds.has(id)) {
      diagnostics.push({ severity: 'error', code: 'SMART_OBJECT_SOURCE_MISSING', message: `Embedded source ${id} is missing.`, layerPath: entry.displayPath });
    }
    const refs = linkReferences.get(id) ?? [];
    refs.push(entry.displayPath);
    linkReferences.set(id, refs);

    const transform = layer.placedLayer.transform;
    if (!Array.isArray(transform) || transform.length !== 8) {
      diagnostics.push({ severity: 'warning', code: 'UNSUPPORTED_SMART_OBJECT_TRANSFORM', message: 'Portable cache refresh requires an 8-point transform.', layerPath: entry.displayPath });
    }
    if (layer.placedLayer.warp) {
      diagnostics.push({ severity: 'info', code: 'PHOTOSHOP_WARP_PRESENT', message: 'Photoshop warp metadata is present; use the UXP finalizer after replacement for native rerendering.', layerPath: entry.displayPath });
    }
  }

  for (const [layerPath, count] of pathCounts) {
    if (count > 1) diagnostics.push({ severity: 'warning', code: 'DUPLICATE_LAYER_PATH', message: `Layer path occurs ${count} times and cannot be selected deterministically by path.`, layerPath });
  }

  for (const [id, refs] of linkReferences) {
    if (refs.length > 1) {
      diagnostics.push({ severity: 'info', code: 'SHARED_SMART_OBJECT_SOURCE', message: `Embedded source ${id} is shared by ${refs.length} smart-object instances: ${refs.join(', ')}` });
    }
  }

  for (const linked of linkedFiles) {
    if (!linkReferences.has(linked.id)) diagnostics.push({ severity: 'info', code: 'ORPHAN_LINKED_FILE', message: `Embedded source ${linked.name ?? linked.id} is not referenced by a smart-object layer.` });
  }

  const stats = {
    layers: index.length,
    groups: index.filter((entry) => Array.isArray(entry.layer.children)).length,
    smartObjects: index.filter((entry) => Boolean(entry.layer.placedLayer)).length,
    textLayers: index.filter((entry) => Boolean(entry.layer.text)).length,
    masks: index.filter((entry) => Boolean(entry.layer.mask)).length,
    vectorMasks: index.filter((entry) => Boolean(entry.layer.vectorMask)).length,
    linkedFiles: linkedFiles.length,
  };
  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    width: psd.width,
    height: psd.height,
    stats,
    diagnostics,
  };
}
