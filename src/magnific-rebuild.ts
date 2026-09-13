import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildMockup } from './engine.js';
import { readRgba } from './image.js';
import { preflightMagnific, type MagnificPreflightResult } from './magnific.js';
import { warpPerspective } from './perspective.js';
import { candidateVectorMask, detectMockupSurfaces, type SurfaceCandidate, type SurfaceDetectionResult, type SurfaceHint } from './surface-detection.js';
import { inferSurfaceHintFromFilename, renderSurfaceDetectionOverlay } from './surface-review.js';
import type { LayerSpec, MockupManifest, Point } from './types.js';

export interface MagnificRebuildSlotRecipe {
  label: string;
  hint: SurfaceHint;
}

export interface MagnificRebuildRecipe {
  slots: MagnificRebuildSlotRecipe[];
}

export interface MagnificRebuildOptions {
  inputDirectory: string;
  outputDirectory: string;
  createdByAi?: boolean;
  minimumConfidence?: number;
  maxAnalysisDimension?: number;
}

export interface MagnificRebuildItem {
  source: string;
  psd: string;
  preview: string;
  manifest: string;
  overlay: string;
  slots: Array<{
    label: string;
    hint: SurfaceHint;
    kind: SurfaceCandidate['kind'];
    confidence: number;
  }>;
  preflight: MagnificPreflightResult;
  warnings: string[];
}

export interface MagnificRebuildResult {
  ok: boolean;
  outputDirectory: string;
  items: MagnificRebuildItem[];
  warnings: string[];
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

function normalizeName(file: string): string {
  return path.basename(file, path.extname(file)).toLowerCase().replace(/[_-]+/g, ' ');
}

export function inferMagnificRebuildRecipe(file: string): MagnificRebuildRecipe {
  const name = normalizeName(file);
  if (/stationery/.test(name)) return { slots: [
    { label: 'LETTERHEAD', hint: 'page' },
    { label: 'CARD FRONT', hint: 'card' },
    { label: 'CARD BACK', hint: 'card' },
    { label: 'ENVELOPE', hint: 'page' },
  ] };
  if (/takeaway/.test(name)) return { slots: [
    { label: 'BAG', hint: 'bag' },
    { label: 'BOX LID', hint: 'box' },
  ] };
  if (/open magazine|magazine/.test(name)) return { slots: [
    { label: 'LEFT PAGE', hint: 'page' },
    { label: 'RIGHT PAGE', hint: 'page' },
  ] };
  if (/gallery frames|gallery/.test(name)) return { slots: [
    { label: 'FRAME LEFT', hint: 'frame' },
    { label: 'FRAME MIDDLE', hint: 'frame' },
    { label: 'FRAME RIGHT', hint: 'frame' },
  ] };
  if (/device workspace|workspace/.test(name)) return { slots: [
    { label: 'TABLET SCREEN', hint: 'screen' },
    { label: 'PHONE SCREEN', hint: 'screen' },
  ] };
  if (/wine packaging|wine/.test(name)) return { slots: [
    { label: 'BOTTLE LABEL', hint: 'cylinder' },
    { label: 'TUBE FRONT', hint: 'cylinder' },
  ] };
  if (/round.*sign|store sign/.test(name)) return { slots: [{ label: 'ROUND SIGN', hint: 'round-sign' }] };
  if (/amber.*jar|supplement.*jar|\bjar\b/.test(name)) return { slots: [{ label: 'JAR LABEL', hint: 'cylinder' }] };
  if (/\bcan\b/.test(name)) return { slots: [{ label: 'CAN LABEL', hint: 'cylinder' }] };
  if (/laptop/.test(name)) return { slots: [{ label: 'SCREEN', hint: 'screen' }] };
  if (/phone/.test(name)) return { slots: [{ label: 'PHONE SCREEN', hint: 'screen' }] };
  if (/bus.*stop|poster/.test(name)) return { slots: [{ label: 'POSTER', hint: 'poster' }] };
  if (/business.*card/.test(name)) return { slots: [{ label: 'BUSINESS CARD', hint: 'card' }] };
  if (/frame/.test(name)) return { slots: [{ label: 'FRAME', hint: 'frame' }] };
  if (/tote/.test(name)) return { slots: [{ label: 'TOTE PRINT', hint: 'garment' }] };
  if (/shirt|tshirt|t-shirt/.test(name)) return { slots: [{ label: 'SHIRT PRINT', hint: 'garment' }] };
  if (/coffee.*packaging|coffee.*bag/.test(name)) return { slots: [{ label: 'BAG', hint: 'bag' }] };
  if (/gift.*box|box/.test(name)) return { slots: [{ label: 'BOX LID', hint: 'box' }] };
  if (/skincare|cosmetic/.test(name)) return { slots: [{ label: 'PACKAGE FRONT', hint: 'box' }] };
  return { slots: [{ label: 'DESIGN', hint: inferSurfaceHintFromFilename(file) }] };
}

function candidateBounds(candidate: SurfaceCandidate, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const xs = candidate.polygon.map((point) => point[0]);
  const ys = candidate.polygon.map((point) => point[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(height, Math.ceil(Math.max(...ys)));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function boundsIou(a: SurfaceCandidate, b: SurfaceCandidate): number {
  const bounds = (candidate: SurfaceCandidate) => {
    const xs = candidate.polygon.map((point) => point[0]);
    const ys = candidate.polygon.map((point) => point[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const aa = bounds(a);
  const bb = bounds(b);
  const left = Math.max(aa[0], bb[0]);
  const top = Math.max(aa[1], bb[1]);
  const right = Math.min(aa[2], bb[2]);
  const bottom = Math.min(aa[3], bb[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const areaA = Math.max(1, (aa[2] - aa[0]) * (aa[3] - aa[1]));
  const areaB = Math.max(1, (bb[2] - bb[0]) * (bb[3] - bb[1]));
  return intersection / (areaA + areaB - intersection);
}

function chooseCandidate(result: SurfaceDetectionResult, used: SurfaceCandidate[], hintIndex: number): SurfaceCandidate {
  const preferred = result.candidates.filter((candidate) => !used.some((existing) => boundsIou(existing, candidate) > 0.48));
  return preferred[hintIndex] ?? preferred[0] ?? result.candidates[hintIndex] ?? result.candidates[0];
}

function computeTargetSize(width: number, height: number): { width: number; height: number; warning?: string } {
  const lowerScale = Math.max(1, 2001 / Math.min(width, height));
  const upperScale = Math.min(1, 4999 / Math.max(width, height));
  let scale = Math.min(lowerScale, upperScale);
  let warning: string | undefined;
  if (lowerScale > upperScale) {
    scale = upperScale;
    warning = 'Source aspect ratio cannot satisfy both the 2,000 px preview minimum and the <5,000 px PSD maximum on every axis; resized to stay below the PSD maximum.';
  }
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), warning };
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char));
}

function averageQuadAspect(candidate: SurfaceCandidate): number {
  const q = candidate.quad;
  const dist = (x1: number, y1: number, x2: number, y2: number) => Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const w = (dist(q[0], q[1], q[2], q[3]) + dist(q[6], q[7], q[4], q[5])) / 2;
  const h = (dist(q[0], q[1], q[6], q[7]) + dist(q[2], q[3], q[4], q[5])) / 2;
  return Math.max(0.2, Math.min(5, w / h));
}

async function createPlaceholder(file: string, label: string, candidate: SurfaceCandidate): Promise<void> {
  const aspect = averageQuadAspect(candidate);
  const maxDimension = 1800;
  const width = aspect >= 1 ? maxDimension : Math.max(720, Math.round(maxDimension * aspect));
  const height = aspect >= 1 ? Math.max(720, Math.round(maxDimension / aspect)) : maxDimension;
  const fontSize = Math.max(42, Math.round(Math.min(width, height) / 9));
  const safeLabel = xmlEscape(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#20242a"/><stop offset="1" stop-color="#5d6775"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <path d="M0 ${height * 0.18} L${width} ${height * 0.03} M0 ${height * 0.82} L${width} ${height * 0.97}" stroke="#fff" stroke-opacity="0.3" stroke-width="${Math.max(4, fontSize / 12)}"/>
    <text x="50%" y="46%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff">PLACE DESIGN</text>
    <text x="50%" y="58%" text-anchor="middle" font-family="Arial,sans-serif" font-size="${Math.round(fontSize * 0.48)}" fill="#fff" fill-opacity="0.88">${safeLabel}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

function localPolygon(points: Point[], left: number, top: number): string {
  return points.map(([x, y]) => `${(x - left).toFixed(1)},${(y - top).toFixed(1)}`).join(' ');
}

async function makeLightingTexture(scene: string, candidate: SurfaceCandidate, sceneWidth: number, sceneHeight: number, output: string): Promise<{ left: number; top: number; width: number; height: number }> {
  const box = candidateBounds(candidate, sceneWidth, sceneHeight);
  await sharp(scene)
    .extract(box)
    .grayscale()
    .normalise({ lower: 2, upper: 98 })
    .linear(0.34, 84)
    .png()
    .toFile(output);
  return box;
}

async function warpedArtworkBuffer(placeholder: string, candidate: SurfaceCandidate): Promise<{ input: Buffer; left: number; top: number }> {
  const source = await readRgba(placeholder);
  const warped = warpPerspective(source, candidate.quad);
  const polygon = localPolygon(candidate.polygon, warped.left, warped.top);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${warped.image.width}" height="${warped.image.height}"><polygon points="${polygon}" fill="#fff"/></svg>`);
  const input = await sharp(Buffer.from(warped.image.data.buffer, warped.image.data.byteOffset, warped.image.data.byteLength), {
    raw: { width: warped.image.width, height: warped.image.height, channels: 4 },
  }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return { input, left: warped.left, top: warped.top };
}

async function buildPreview(scene: string, slots: Array<{ candidate: SurfaceCandidate; placeholder: string; lighting: string; lightingBox: { left: number; top: number; width: number; height: number } }>, output: string): Promise<void> {
  const composites: sharp.OverlayOptions[] = [];
  for (const slot of slots) {
    const warped = await warpedArtworkBuffer(slot.placeholder, slot.candidate);
    composites.push({ input: warped.input, left: warped.left, top: warped.top, blend: 'over' });
    const polygon = localPolygon(slot.candidate.polygon, slot.lightingBox.left, slot.lightingBox.top);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${slot.lightingBox.width}" height="${slot.lightingBox.height}"><polygon points="${polygon}" fill="#fff"/></svg>`);
    const lighting = await sharp(slot.lighting).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    composites.push({ input: lighting, left: slot.lightingBox.left, top: slot.lightingBox.top, blend: 'soft-light' });
  }
  await sharp(scene)
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(output);
}

function smartObjectName(label: string): string {
  return `Place your design here — ${label} (Double click to edit)`;
}

export async function rebuildMagnificBatch(options: MagnificRebuildOptions): Promise<MagnificRebuildResult> {
  const inputDirectory = path.resolve(options.inputDirectory);
  const outputDirectory = path.resolve(options.outputDirectory);
  const deliveryDirectory = path.join(outputDirectory, 'delivery');
  const manifestDirectory = path.join(outputDirectory, 'manifests');
  const reviewDirectory = path.join(outputDirectory, 'review');
  const workRoot = path.join(outputDirectory, '.work');
  await mkdir(deliveryDirectory, { recursive: true });
  await mkdir(manifestDirectory, { recursive: true });
  await mkdir(reviewDirectory, { recursive: true });
  await mkdir(workRoot, { recursive: true });

  const sourceFiles = (await readdir(inputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sourceFiles.length) throw new Error(`No supported source images found in ${inputDirectory}`);

  const items: MagnificRebuildItem[] = [];
  const batchWarnings: string[] = [];
  const minimumConfidence = Math.max(0, Math.min(1, options.minimumConfidence ?? 0.5));
  const maxAnalysisDimension = Math.max(480, Math.min(2400, options.maxAnalysisDimension ?? 1600));

  for (const fileName of sourceFiles) {
    const source = path.join(inputDirectory, fileName);
    const baseName = path.basename(fileName, path.extname(fileName));
    const workDirectory = path.join(workRoot, baseName);
    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(workDirectory, { recursive: true });
    const warnings: string[] = [];
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Unable to determine source dimensions: ${source}`);
    const target = computeTargetSize(metadata.width, metadata.height);
    if (target.warning) warnings.push(target.warning);
    const scene = path.join(workDirectory, 'scene.jpg');
    await sharp(source, { failOn: 'error' })
      .resize({ width: target.width, height: target.height, fit: 'fill' })
      .toColourspace('srgb')
      .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
      .toFile(scene);

    const recipe = inferMagnificRebuildRecipe(fileName);
    const detectionCache = new Map<SurfaceHint, Promise<SurfaceDetectionResult>>();
    const hintUsage = new Map<SurfaceHint, number>();
    const used: SurfaceCandidate[] = [];
    const builtSlots: Array<{ label: string; hint: SurfaceHint; candidate: SurfaceCandidate; placeholder: string; lighting: string; lightingBox: { left: number; top: number; width: number; height: number } }> = [];

    for (const slot of recipe.slots) {
      let pending = detectionCache.get(slot.hint);
      if (!pending) {
        pending = detectMockupSurfaces(scene, { hint: slot.hint, count: 10, maxDimension: maxAnalysisDimension });
        detectionCache.set(slot.hint, pending);
      }
      const detection = await pending;
      const index = hintUsage.get(slot.hint) ?? 0;
      hintUsage.set(slot.hint, index + 1);
      const candidate = chooseCandidate(detection, used, index);
      used.push(candidate);
      if (candidate.confidence < minimumConfidence) warnings.push(`${slot.label}: detection confidence ${(candidate.confidence * 100).toFixed(0)}% is below the ${(minimumConfidence * 100).toFixed(0)}% production threshold; review the overlay.`);
      const placeholder = path.join(workDirectory, `artwork-${builtSlots.length + 1}.png`);
      const lighting = path.join(workDirectory, `lighting-${builtSlots.length + 1}.png`);
      await createPlaceholder(placeholder, slot.label, candidate);
      const lightingBox = await makeLightingTexture(scene, candidate, target.width, target.height, lighting);
      builtSlots.push({ label: slot.label, hint: slot.hint, candidate, placeholder, lighting, lightingBox });
    }

    const overlayDetection: SurfaceDetectionResult = {
      image: { width: target.width, height: target.height },
      analysis: { width: target.width, height: target.height, scale: 1 },
      hint: 'auto',
      candidates: builtSlots.map((slot) => slot.candidate),
      warnings: [],
    };
    const overlay = path.join(reviewDirectory, `${baseName}-detection.jpg`);
    await renderSurfaceDetectionOverlay(scene, overlayDetection, overlay);

    const layers: LayerSpec[] = [];
    for (const slot of builtSlots) {
      const mask = candidateVectorMask(slot.candidate);
      layers.push({
        type: 'group',
        name: `EDIT — ${slot.label}`,
        opened: true,
        children: [
          {
            type: 'raster',
            name: `Surface lighting — ${slot.label} (Do not edit)`,
            source: path.relative(workDirectory, slot.lighting),
            x: slot.lightingBox.left,
            y: slot.lightingBox.top,
            width: slot.lightingBox.width,
            height: slot.lightingBox.height,
            blendMode: 'soft light',
            clipping: true,
            vectorMask: mask,
          },
          {
            type: 'smart-object',
            name: smartObjectName(slot.label),
            source: path.relative(workDirectory, slot.placeholder),
            quad: slot.candidate.quad,
            vectorMask: mask,
            ...(slot.candidate.nativeWarp ? { nativeWarp: slot.candidate.nativeWarp } : {}),
          },
        ],
      });
    }
    layers.push({ type: 'raster', name: 'BACKGROUND — Mockup scene', source: path.relative(workDirectory, scene), x: 0, y: 0, width: target.width, height: target.height });

    const manifestObject: MockupManifest = {
      version: 1,
      document: { width: target.width, height: target.height, dpi: 72, background: '#ffffff' },
      layers,
    };
    const manifestFile = path.join(manifestDirectory, `${baseName}.mockup.json`);
    await writeFile(manifestFile, JSON.stringify(manifestObject, null, 2));
    const psd = path.join(deliveryDirectory, `${baseName}.psd`);
    await buildMockup(manifestObject, { output: psd, cwd: workDirectory, generateComposite: false });
    const preview = path.join(deliveryDirectory, `${baseName}.jpg`);
    await buildPreview(scene, builtSlots, preview);
    const preflight = await preflightMagnific(psd, preview, { type: 'mockup', createdByAi: Boolean(options.createdByAi) });
    items.push({
      source,
      psd,
      preview,
      manifest: manifestFile,
      overlay,
      slots: builtSlots.map((slot) => ({ label: slot.label, hint: slot.hint, kind: slot.candidate.kind, confidence: slot.candidate.confidence })),
      preflight,
      warnings,
    });
  }

  if (items.some((item) => !item.preflight.ok)) batchWarnings.push('One or more rebuilt pairs failed automatic Magnific preflight. Check each item before submission.');
  if (items.some((item) => item.warnings.length)) batchWarnings.push('One or more surface detections require visual review. Use the files in the review directory.');
  await writeFile(path.join(outputDirectory, 'rebuild-report.json'), JSON.stringify({ items, warnings: batchWarnings }, null, 2));
  return { ok: items.every((item) => item.preflight.ok), outputDirectory, items, warnings: batchWarnings };
}
