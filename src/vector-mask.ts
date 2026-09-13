import type { RgbaImage } from './image.js';
import type { VectorBooleanOperation, VectorMaskSpec } from './types.js';

export function compileVectorMask(spec: VectorMaskSpec): any {
  return {
    paths: spec.paths.map((path) => ({
      open: path.closed === false,
      operation: path.operation ?? 'combine',
      knots: path.points.map(([x, y]) => ({
        linked: false,
        points: [x, y, x, y, x, y],
      })),
    })),
    invert: spec.invert ?? false,
    notLink: spec.linked === false,
    disable: false,
    fillStartsWithAllPixels: spec.fillStartsWithAllPixels ?? false,
  };
}

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crosses = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function combine(current: boolean, next: boolean, operation: VectorBooleanOperation): boolean {
  switch (operation) {
    case 'subtract': return current && !next;
    case 'intersect': return current && next;
    case 'exclude': return current !== next;
    case 'combine':
    default: return current || next;
  }
}

export function vectorMaskContains(spec: VectorMaskSpec, x: number, y: number): boolean {
  let inside = spec.fillStartsWithAllPixels ?? false;
  for (const path of spec.paths) {
    const next = pointInPolygon(x, y, path.points);
    inside = combine(inside, next, path.operation ?? 'combine');
  }
  return spec.invert ? !inside : inside;
}

export function applyVectorMaskForComposite(source: RgbaImage, layerLeft: number, layerTop: number, spec: VectorMaskSpec): RgbaImage {
  const data = new Uint8Array(source.data);
  for (let y = 0; y < source.height; y += 1) {
    const docY = layerTop + y + 0.5;
    for (let x = 0; x < source.width; x += 1) {
      const docX = layerLeft + x + 0.5;
      if (vectorMaskContains(spec, docX, docY)) continue;
      data[(y * source.width + x) * 4 + 3] = 0;
    }
  }
  return { width: source.width, height: source.height, data };
}
