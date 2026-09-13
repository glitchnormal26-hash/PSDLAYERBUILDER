import sharp from 'sharp';
import type { Point, Quad } from './types.js';

export type SurfaceHint =
  | 'auto'
  | 'screen'
  | 'poster'
  | 'frame'
  | 'page'
  | 'card'
  | 'box'
  | 'bag'
  | 'garment'
  | 'round-sign'
  | 'label'
  | 'cylinder';

export type DetectedSurfaceKind = 'quad' | 'ellipse' | 'cylinder';

export interface SurfaceDetectionOptions {
  hint?: SurfaceHint;
  count?: number;
  maxDimension?: number;
  minAreaRatio?: number;
  maxAreaRatio?: number;
}

export interface SurfaceCandidateMetrics {
  areaRatio: number;
  rectangularity: number;
  circularity: number;
  edgeSupport: number;
  uniformity: number;
  centrality: number;
  aspectRatio: number;
}

export interface SurfaceCandidate {
  kind: DetectedSurfaceKind;
  confidence: number;
  quad: Quad;
  polygon: Point[];
  ellipse?: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rotation: number;
  };
  nativeWarp?: {
    style: 'cylinder';
    bend: number;
    cylinderCurve: number;
    rotate: 'horizontal' | 'vertical';
  };
  metrics: SurfaceCandidateMetrics;
  reasons: string[];
}

export interface SurfaceDetectionResult {
  image: { width: number; height: number };
  analysis: { width: number; height: number; scale: number };
  hint: SurfaceHint;
  candidates: SurfaceCandidate[];
  warnings: string[];
}

interface AnalysisImage {
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  scale: number;
  luminance: Float32Array;
  saturation: Float32Array;
  gradient: Float32Array;
}

interface Region {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  perimeter: number;
  sumLum: number;
  sumLumSq: number;
  sumGrad: number;
  boundaryGrad: number;
  boundaryCount: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  boundary: Point[];
}

const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));

function percentile(values: Float32Array, fraction: number): number {
  const maxSamples = 60_000;
  const step = Math.max(1, Math.floor(values.length / maxSamples));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  if (!sample.length) return 0;
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor((sample.length - 1) * fraction)))];
}

async function loadAnalysisImage(file: string, maxDimension: number): Promise<AnalysisImage> {
  const metadata = await sharp(file, { failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Unable to determine image dimensions: ${file}`);
  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  const { data, info } = await sharp(file, { failOn: 'error' })
    .resize({ width, height, fit: 'fill', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const luminance = new Float32Array(pixels);
  const saturation = new Float32Array(pixels);
  const gradient = new Float32Array(pixels);

  for (let i = 0; i < pixels; i += 1) {
    const offset = i * info.channels;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    luminance[i] = r * 0.2126 + g * 0.7152 + b * 0.0722;
    saturation[i] = max <= 1e-6 ? 0 : (max - min) / max;
  }

  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const i = y * info.width + x;
      const gx = luminance[i + 1] - luminance[i - 1];
      const gy = luminance[i + info.width] - luminance[i - info.width];
      gradient[i] = clamp(Math.hypot(gx, gy) * 1.75);
    }
  }

  return {
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    width: info.width,
    height: info.height,
    scale,
    luminance,
    saturation,
    gradient,
  };
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (mask[i + dy * width + dx]) { on = 1; break; }
        }
      }
      out[i] = on;
    }
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!mask[i + dy * width + dx]) { on = 0; break; }
        }
      }
      out[i] = on;
    }
  }
  return out;
}

function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  let result = mask;
  result = dilate(result, width, height);
  result = dilate(result, width, height);
  result = erode(result, width, height);
  result = erode(result, width, height);
  return result;
}

function buildMasks(image: AnalysisImage, hint: SurfaceHint): Uint8Array[] {
  const lowGradient = Math.max(0.018, percentile(image.gradient, 0.62));
  const mediumGradient = Math.max(lowGradient * 1.45, percentile(image.gradient, 0.74));
  const bright = percentile(image.luminance, 0.58);
  const dark = percentile(image.luminance, 0.32);
  const base = new Uint8Array(image.luminance.length);
  const neutral = new Uint8Array(base.length);
  const tonal = new Uint8Array(base.length);
  const screen = new Uint8Array(base.length);

  for (let i = 0; i < base.length; i += 1) {
    const g = image.gradient[i];
    const l = image.luminance[i];
    const s = image.saturation[i];
    base[i] = g <= lowGradient && s <= 0.5 ? 1 : 0;
    neutral[i] = g <= mediumGradient && s <= 0.24 && l >= 0.1 ? 1 : 0;
    tonal[i] = g <= lowGradient && (l >= bright || l <= dark) ? 1 : 0;
    screen[i] = g <= mediumGradient && l <= Math.max(0.38, dark + 0.1) ? 1 : 0;
  }

  const masks = [closeMask(base, image.width, image.height), closeMask(neutral, image.width, image.height), closeMask(tonal, image.width, image.height)];
  if (hint === 'screen') masks.push(closeMask(screen, image.width, image.height));
  return masks;
}

function connectedRegions(mask: Uint8Array, image: AnalysisImage, minArea: number, maxArea: number): Region[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const regions: Region[] = [];
  const { width, height } = image;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    const region: Region = {
      area: 0,
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      perimeter: 0,
      sumLum: 0,
      sumLumSq: 0,
      sumGrad: 0,
      boundaryGrad: 0,
      boundaryCount: 0,
      sumX: 0,
      sumY: 0,
      sumXX: 0,
      sumYY: 0,
      sumXY: 0,
      boundary: [],
    };
    let boundarySequence = 0;

    while (head < tail) {
      const index = queue[head++];
      const y = Math.floor(index / width);
      const x = index - y * width;
      region.area += 1;
      region.minX = Math.min(region.minX, x);
      region.minY = Math.min(region.minY, y);
      region.maxX = Math.max(region.maxX, x);
      region.maxY = Math.max(region.maxY, y);
      const lum = image.luminance[index];
      region.sumLum += lum;
      region.sumLumSq += lum * lum;
      region.sumGrad += image.gradient[index];
      region.sumX += x;
      region.sumY += y;
      region.sumXX += x * x;
      region.sumYY += y * y;
      region.sumXY += x * y;

      let boundary = false;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          region.perimeter += 1;
          boundary = true;
          continue;
        }
        const next = ny * width + nx;
        if (!mask[next]) {
          region.perimeter += 1;
          boundary = true;
        } else if (!visited[next]) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (boundary) {
        region.boundaryGrad += image.gradient[index];
        region.boundaryCount += 1;
        if (region.boundary.length < 7000 || boundarySequence % 12 === 0) region.boundary.push([x, y]);
        boundarySequence += 1;
      }
    }

    if (region.area >= minArea && region.area <= maxArea && region.boundary.length >= 4) regions.push(region);
  }
  return regions;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points.slice();
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function simplifyHull(hull: Point[], maxPoints = 64): Point[] {
  if (hull.length <= maxPoints) return hull;
  const out: Point[] = [];
  const step = hull.length / maxPoints;
  for (let i = 0; i < maxPoints; i += 1) out.push(hull[Math.floor(i * step)]);
  return out;
}

function quadFromHull(hull: Point[], region: Region): Quad {
  if (hull.length < 4) return [region.minX, region.minY, region.maxX, region.minY, region.maxX, region.maxY, region.minX, region.maxY];
  let tl = hull[0];
  let tr = hull[0];
  let br = hull[0];
  let bl = hull[0];
  for (const p of hull) {
    if (p[0] + p[1] < tl[0] + tl[1]) tl = p;
    if (p[0] - p[1] > tr[0] - tr[1]) tr = p;
    if (p[0] + p[1] > br[0] + br[1]) br = p;
    if (p[0] - p[1] < bl[0] - bl[1]) bl = p;
  }
  const unique = new Set([tl, tr, br, bl].map((p) => `${p[0]},${p[1]}`));
  if (unique.size < 4) return [region.minX, region.minY, region.maxX, region.minY, region.maxX, region.maxY, region.minX, region.maxY];
  return [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]];
}

function ellipseFromRegion(region: Region): { cx: number; cy: number; rx: number; ry: number; rotation: number; polygon: Point[] } {
  const cx = region.sumX / region.area;
  const cy = region.sumY / region.area;
  const xx = region.sumXX / region.area - cx * cx;
  const yy = region.sumYY / region.area - cy * cy;
  const xy = region.sumXY / region.area - cx * cy;
  const rotation = 0.5 * Math.atan2(2 * xy, xx - yy);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let maxU = 1;
  let maxV = 1;
  for (const [x, y] of region.boundary) {
    const dx = x - cx;
    const dy = y - cy;
    maxU = Math.max(maxU, Math.abs(dx * cos + dy * sin));
    maxV = Math.max(maxV, Math.abs(-dx * sin + dy * cos));
  }
  const polygon: Point[] = [];
  for (let i = 0; i < 48; i += 1) {
    const t = (i / 48) * Math.PI * 2;
    const u = Math.cos(t) * maxU;
    const v = Math.sin(t) * maxV;
    polygon.push([cx + u * cos - v * sin, cy + u * sin + v * cos]);
  }
  return { cx, cy, rx: maxU, ry: maxV, rotation, polygon };
}

function aspectPrior(hint: SurfaceHint, aspect: number): number {
  const closeness = (target: number, tolerance: number): number => Math.exp(-Math.pow((Math.log(Math.max(0.05, aspect)) - Math.log(target)) / tolerance, 2));
  switch (hint) {
    case 'screen': return Math.max(closeness(16 / 9, 0.42), closeness(4 / 3, 0.42));
    case 'poster': return Math.max(closeness(0.7, 0.45), closeness(1.4, 0.45));
    case 'frame': return Math.max(closeness(0.75, 0.5), closeness(1.33, 0.5));
    case 'page': return Math.max(closeness(0.7, 0.45), closeness(1.4, 0.45));
    case 'card': return Math.max(closeness(1.6, 0.38), closeness(0.625, 0.38));
    case 'box': return closeness(1, 0.62);
    case 'bag': return closeness(0.8, 0.62);
    case 'garment': return closeness(1, 0.72);
    case 'round-sign': return closeness(1, 0.36);
    case 'label':
    case 'cylinder': return Math.max(closeness(0.8, 0.65), closeness(1.35, 0.65));
    default: return 0.72;
  }
}

function hintKind(hint: SurfaceHint, metrics: SurfaceCandidateMetrics): DetectedSurfaceKind {
  if (hint === 'round-sign') return 'ellipse';
  if (hint === 'label' || hint === 'cylinder') return 'cylinder';
  if (hint === 'auto' && metrics.circularity > 0.66 && metrics.aspectRatio > 0.65 && metrics.aspectRatio < 1.55) return 'ellipse';
  return 'quad';
}

function metricsForRegion(region: Region, image: AnalysisImage): SurfaceCandidateMetrics {
  const total = image.width * image.height;
  const bboxW = Math.max(1, region.maxX - region.minX + 1);
  const bboxH = Math.max(1, region.maxY - region.minY + 1);
  const areaRatio = region.area / total;
  const rectangularity = clamp(region.area / (bboxW * bboxH));
  const circularity = clamp((4 * Math.PI * region.area) / Math.max(1, region.perimeter * region.perimeter));
  const mean = region.sumLum / region.area;
  const variance = Math.max(0, region.sumLumSq / region.area - mean * mean);
  const uniformity = clamp(1 - Math.sqrt(variance) / 0.24);
  const edgeSupport = clamp((region.boundaryGrad / Math.max(1, region.boundaryCount)) / 0.18);
  const cx = (region.minX + region.maxX) / 2;
  const cy = (region.minY + region.maxY) / 2;
  const dx = (cx - image.width / 2) / (image.width / 2);
  const dy = (cy - image.height / 2) / (image.height / 2);
  const centrality = clamp(1 - Math.hypot(dx, dy) / 1.2);
  return {
    areaRatio,
    rectangularity,
    circularity,
    edgeSupport,
    uniformity,
    centrality,
    aspectRatio: bboxW / bboxH,
  };
}

function scoreRegion(metrics: SurfaceCandidateMetrics, hint: SurfaceHint, kind: DetectedSurfaceKind): number {
  const area = metrics.areaRatio < 0.006 ? metrics.areaRatio / 0.006 : metrics.areaRatio > 0.72 ? clamp((0.9 - metrics.areaRatio) / 0.18) : 1;
  const shape = kind === 'ellipse'
    ? metrics.circularity * 0.68 + (1 - Math.min(1, Math.abs(Math.log(metrics.aspectRatio)))) * 0.32
    : kind === 'cylinder'
      ? metrics.rectangularity * 0.34 + metrics.uniformity * 0.3 + metrics.edgeSupport * 0.36
      : metrics.rectangularity * 0.42 + metrics.uniformity * 0.28 + metrics.edgeSupport * 0.3;
  const prior = aspectPrior(hint, metrics.aspectRatio);
  return clamp(area * 0.18 + shape * 0.47 + prior * 0.23 + metrics.centrality * 0.12);
}

function candidateFromRegion(region: Region, image: AnalysisImage, hint: SurfaceHint): SurfaceCandidate {
  const metrics = metricsForRegion(region, image);
  const kind = hintKind(hint, metrics);
  const hull = convexHull(region.boundary);
  const quad = quadFromHull(hull, region);
  let polygon = simplifyHull(hull, 64);
  let ellipse: SurfaceCandidate['ellipse'];
  let nativeWarp: SurfaceCandidate['nativeWarp'];
  if (kind === 'ellipse') {
    const fitted = ellipseFromRegion(region);
    ellipse = { cx: fitted.cx, cy: fitted.cy, rx: fitted.rx, ry: fitted.ry, rotation: fitted.rotation };
    polygon = fitted.polygon;
  } else if (kind === 'cylinder') {
    const curve = clamp(0.5 + (0.08 + metrics.edgeSupport * 0.06), 0.52, 0.68);
    nativeWarp = { style: 'cylinder', bend: Math.round((curve - 0.5) * 200), cylinderCurve: curve, rotate: 'horizontal' };
  }
  const confidence = scoreRegion(metrics, hint, kind);
  const reasons = [
    `closed-surface area ${(metrics.areaRatio * 100).toFixed(1)}%`,
    `edge support ${(metrics.edgeSupport * 100).toFixed(0)}%`,
    `surface uniformity ${(metrics.uniformity * 100).toFixed(0)}%`,
    `shape fit ${kind === 'ellipse' ? (metrics.circularity * 100).toFixed(0) : (metrics.rectangularity * 100).toFixed(0)}%`,
    `hint/aspect fit ${(aspectPrior(hint, metrics.aspectRatio) * 100).toFixed(0)}%`,
  ];
  return { kind, confidence, quad, polygon, ellipse, nativeWarp, metrics, reasons };
}

function bbox(candidate: SurfaceCandidate): [number, number, number, number] {
  const xs = candidate.polygon.map((p) => p[0]);
  const ys = candidate.polygon.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function iou(a: SurfaceCandidate, b: SurfaceCandidate): number {
  const aa = bbox(a);
  const bb = bbox(b);
  const left = Math.max(aa[0], bb[0]);
  const top = Math.max(aa[1], bb[1]);
  const right = Math.min(aa[2], bb[2]);
  const bottom = Math.min(aa[3], bb[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const areaA = Math.max(1, (aa[2] - aa[0]) * (aa[3] - aa[1]));
  const areaB = Math.max(1, (bb[2] - bb[0]) * (bb[3] - bb[1]));
  return intersection / (areaA + areaB - intersection);
}

function fallbackCandidate(image: AnalysisImage, hint: SurfaceHint): SurfaceCandidate {
  const profiles: Record<SurfaceHint, [number, number]> = {
    auto: [0.46, 0.42], screen: [0.54, 0.38], poster: [0.34, 0.58], frame: [0.36, 0.5], page: [0.33, 0.5], card: [0.45, 0.28], box: [0.42, 0.35], bag: [0.38, 0.48], garment: [0.42, 0.42], 'round-sign': [0.4, 0.4], label: [0.27, 0.37], cylinder: [0.28, 0.4],
  };
  const [wf, hf] = profiles[hint];
  const w = image.width * wf;
  const h = image.height * hf;
  const left = (image.width - w) / 2;
  const top = (image.height - h) / 2;
  const right = left + w;
  const bottom = top + h;
  const metrics: SurfaceCandidateMetrics = { areaRatio: wf * hf, rectangularity: 1, circularity: hint === 'round-sign' ? 0.85 : 0.4, edgeSupport: 0, uniformity: 0, centrality: 1, aspectRatio: w / h };
  const kind: DetectedSurfaceKind = hint === 'round-sign' ? 'ellipse' : hint === 'label' || hint === 'cylinder' ? 'cylinder' : 'quad';
  let polygon: Point[] = [[left, top], [right, top], [right, bottom], [left, bottom]];
  let ellipse: SurfaceCandidate['ellipse'];
  let nativeWarp: SurfaceCandidate['nativeWarp'];
  if (kind === 'ellipse') {
    ellipse = { cx: image.width / 2, cy: image.height / 2, rx: w / 2, ry: h / 2, rotation: 0 };
    polygon = [];
    for (let i = 0; i < 48; i += 1) {
      const t = i / 48 * Math.PI * 2;
      polygon.push([ellipse.cx + Math.cos(t) * ellipse.rx, ellipse.cy + Math.sin(t) * ellipse.ry]);
    }
  }
  if (kind === 'cylinder') nativeWarp = { style: 'cylinder', bend: 18, cylinderCurve: 0.59, rotate: 'horizontal' };
  return {
    kind,
    confidence: 0.24,
    quad: [left, top, right, top, right, bottom, left, bottom],
    polygon,
    ellipse,
    nativeWarp,
    metrics,
    reasons: ['low-confidence fallback geometry; manual review required'],
  };
}

function scaleCandidate(candidate: SurfaceCandidate, inverseScale: number): SurfaceCandidate {
  const scalePoint = (point: Point): Point => [point[0] * inverseScale, point[1] * inverseScale];
  const q = candidate.quad;
  const quad: Quad = [q[0] * inverseScale, q[1] * inverseScale, q[2] * inverseScale, q[3] * inverseScale, q[4] * inverseScale, q[5] * inverseScale, q[6] * inverseScale, q[7] * inverseScale];
  return {
    ...candidate,
    quad,
    polygon: candidate.polygon.map(scalePoint),
    ellipse: candidate.ellipse ? {
      cx: candidate.ellipse.cx * inverseScale,
      cy: candidate.ellipse.cy * inverseScale,
      rx: candidate.ellipse.rx * inverseScale,
      ry: candidate.ellipse.ry * inverseScale,
      rotation: candidate.ellipse.rotation,
    } : undefined,
  };
}

export async function detectMockupSurfaces(file: string, options: SurfaceDetectionOptions = {}): Promise<SurfaceDetectionResult> {
  const hint = options.hint ?? 'auto';
  const count = Math.max(1, Math.min(24, options.count ?? 5));
  const maxDimension = Math.max(320, Math.min(2400, options.maxDimension ?? 1200));
  const image = await loadAnalysisImage(file, maxDimension);
  const total = image.width * image.height;
  const minAreaRatio = clamp(options.minAreaRatio ?? 0.004, 0.0005, 0.35);
  const maxAreaRatio = clamp(options.maxAreaRatio ?? 0.82, minAreaRatio + 0.01, 0.95);
  const regions: Region[] = [];
  for (const mask of buildMasks(image, hint)) regions.push(...connectedRegions(mask, image, total * minAreaRatio, total * maxAreaRatio));

  const ranked = regions
    .map((region) => candidateFromRegion(region, image, hint))
    .filter((candidate) => candidate.confidence >= 0.32)
    .sort((a, b) => b.confidence - a.confidence);
  const deduped: SurfaceCandidate[] = [];
  for (const candidate of ranked) {
    if (deduped.some((existing) => iou(existing, candidate) > 0.72)) continue;
    deduped.push(candidate);
    if (deduped.length >= count) break;
  }
  if (!deduped.length) deduped.push(fallbackCandidate(image, hint));

  const inverseScale = 1 / image.scale;
  const warnings: string[] = [];
  if (deduped[0].confidence < 0.5) warnings.push('Top detection confidence is below 0.50; inspect geometry before production use.');
  if (hint === 'auto') warnings.push('Auto mode ranks generic editable surfaces. A semantic --hint usually improves perspective/shape selection.');
  return {
    image: { width: image.originalWidth, height: image.originalHeight },
    analysis: { width: image.width, height: image.height, scale: image.scale },
    hint,
    candidates: deduped.map((candidate) => scaleCandidate(candidate, inverseScale)),
    warnings,
  };
}

export function candidateVectorMask(candidate: SurfaceCandidate): { paths: { points: Point[]; operation: 'combine'; closed: true }[] } {
  return { paths: [{ points: candidate.polygon, operation: 'combine', closed: true }] };
}
