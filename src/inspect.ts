import { readFile } from 'node:fs/promises';
import { readPsd } from 'ag-psd';

export interface LayerTreeNode {
  name: string;
  path: string;
  type: 'group' | 'text' | 'smart-object' | 'raster' | 'other';
  hidden: boolean;
  clipping: boolean;
  hasMask: boolean;
  hasVectorMask: boolean;
  hasEffects: boolean;
  smartObject?: {
    linkedFileId?: string;
    embeddedName?: string;
    transformPoints?: number;
    hasWarp: boolean;
  };
  children?: LayerTreeNode[];
}

function classify(layer: any): LayerTreeNode['type'] {
  if (Array.isArray(layer.children)) return 'group';
  if (layer.placedLayer) return 'smart-object';
  if (layer.text) return 'text';
  if (layer.imageData || layer.canvas || layer.rawData || (Number.isFinite(layer.left) && Number.isFinite(layer.right))) return 'raster';
  return 'other';
}

function toNode(layer: any, parent: string[], linkedById: Map<string, any>): LayerTreeNode {
  const name = layer.name ?? '(unnamed)';
  const path = [...parent, name];
  const children = Array.isArray(layer.children) ? layer.children.map((child: any) => toNode(child, path, linkedById)) : undefined;
  const linkedId = layer.placedLayer?.id;
  const linked = linkedId ? linkedById.get(linkedId) : undefined;
  return {
    name,
    path: path.join('/'),
    type: classify(layer),
    hidden: Boolean(layer.hidden),
    clipping: Boolean(layer.clipping),
    hasMask: Boolean(layer.mask),
    hasVectorMask: Boolean(layer.vectorMask),
    hasEffects: Boolean(layer.effects),
    ...(layer.placedLayer ? {
      smartObject: {
        linkedFileId: linkedId,
        embeddedName: linked?.name,
        transformPoints: Array.isArray(layer.placedLayer.transform) ? layer.placedLayer.transform.length : undefined,
        hasWarp: Boolean(layer.placedLayer.warp),
      },
    } : {}),
    ...(children ? { children } : {}),
  };
}

export async function inspectPsd(file: string): Promise<{ width: number; height: number; linkedFiles: number; layers: LayerTreeNode[] }> {
  const bytes = await readFile(file);
  const psd: any = readPsd(bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const linkedById = new Map((psd.linkedFiles ?? []).map((linked: any) => [linked.id, linked]));
  return {
    width: psd.width,
    height: psd.height,
    linkedFiles: linkedById.size,
    layers: (psd.children ?? []).map((layer: any) => toNode(layer, [], linkedById)),
  };
}
