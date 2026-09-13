import { readFile } from 'node:fs/promises';
import { readPsd } from 'ag-psd';

export interface LayerTreeNode {
  name: string;
  type: 'group' | 'text' | 'smart-object' | 'raster' | 'other';
  hidden: boolean;
  children?: LayerTreeNode[];
}

function classify(layer: any): LayerTreeNode['type'] {
  if (Array.isArray(layer.children)) return 'group';
  if (layer.placedLayer) return 'smart-object';
  if (layer.text) return 'text';
  if (layer.imageData || layer.canvas || layer.rawData) return 'raster';
  return 'other';
}

function toNode(layer: any): LayerTreeNode {
  const children = Array.isArray(layer.children) ? layer.children.map(toNode) : undefined;
  return {
    name: layer.name ?? '(unnamed)',
    type: classify(layer),
    hidden: Boolean(layer.hidden),
    ...(children ? { children } : {}),
  };
}

export async function inspectPsd(file: string): Promise<{ width: number; height: number; layers: LayerTreeNode[] }> {
  const bytes = await readFile(file);
  const psd: any = readPsd(bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  return {
    width: psd.width,
    height: psd.height,
    layers: (psd.children ?? []).map(toNode),
  };
}
