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

export interface MagnificRebuildSlotRecipe { label: string; hint: SurfaceHint; }
export interface MagnificRebuildRecipe { slots: MagnificRebuildSlotRecipe[]; }
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
  slots: Array<{ label: string; hint: SurfaceHint; kind: SurfaceCandidate['kind']; confidence: number }>;
  preflight: MagnificPreflightResult;
  warnings: string[];
}
export interface MagnificRebuildResult { ok: boolean; outputDirectory: string; items: MagnificRebuildItem[]; warnings: string[]; }

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const slot = (label: string, hint: SurfaceHint): MagnificRebuildSlotRecipe => ({ label, hint });

export function inferMagnificRebuildRecipe(file: string): MagnificRebuildRecipe {
  const name = path.basename(file, path.extname(file)).toLowerCase().replace(/[_-]+/g, ' ');
  if (/stationery/.test(name)) return { slots: [slot('LETTERHEAD', 'page'), slot('CARD FRONT', 'card'), slot('CARD BACK', 'card'), slot('ENVELOPE', 'page')] };
  if (/takeaway/.test(name)) return { slots: [slot('BAG', 'bag'), slot('BOX LID', 'box')] };
  if (/magazine/.test(name)) return { slots: [slot('LEFT PAGE', 'page'), slot('RIGHT PAGE', 'page')] };
  if (/gallery/.test(name)) return { slots: [slot('FRAME LEFT', 'frame'), slot('FRAME MIDDLE', 'frame'), slot('FRAME RIGHT', 'frame')] };
  if (/device workspace|workspace/.test(name)) return { slots: [slot('TABLET SCREEN', 'screen'), slot('PHONE SCREEN', 'screen')] };
  if (/wine/.test(name)) return { slots: [slot('BOTTLE LABEL', 'cylinder'), slot('TUBE FRONT', 'cylinder')] };
  if (/round.*sign|store sign/.test(name)) return { slots: [slot('ROUND SIGN', 'round-sign')] };
  if (/amber.*jar|supplement.*jar|\bjar\b/.test(name)) return { slots: [slot('JAR LABEL', 'cylinder')] };
  if (/\bcan\b/.test(name)) return { slots: [slot('CAN LABEL', 'cylinder')] };
  if (/laptop/.test(name)) return { slots: [slot('SCREEN', 'screen')] };
  if (/phone/.test(name)) return { slots: [slot('PHONE SCREEN', 'screen')] };
  if (/bus.*stop|poster/.test(name)) return { slots: [slot('POSTER', 'poster')] };
  if (/business.*card/.test(name)) return { slots: [slot('BUSINESS CARD', 'card')] };
  if (/frame/.test(name)) return { slots: [slot('FRAME', 'frame')] };
  if (/tote/.test(name)) return { slots: [slot('TOTE PRINT', 'garment')] };
  if (/shirt|tshirt|t-shirt/.test(name)) return { slots: [slot('SHIRT PRINT', 'garment')] };
  if (/coffee.*packaging|coffee.*bag/.test(name)) return { slots: [slot('BAG', 'bag')] };
  if (/gift.*box|box/.test(name)) return { slots: [slot('BOX LID', 'box')] };
  if (/skincare|cosmetic/.test(name)) return { slots: [slot('PACKAGE FRONT', 'box')] };
  return { slots: [slot('DESIGN', inferSurfaceHintFromFilename(file))] };
}

function bounds(candidate: SurfaceCandidate, width?: number, height?: number) {
  const xs = candidate.polygon.map(([x]) => x);
  const ys = candidate.polygon.map(([, y]) => y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(width ?? Number.MAX_SAFE_INTEGER, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(height ?? Number.MAX_SAFE_INTEGER, Math.ceil(Math.max(...ys)));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), right, bottom };
}

function iou(a: SurfaceCandidate, b: SurfaceCandidate): number {
  const aa = bounds(a); const bb = bounds(b);
  const left = Math.max(aa.left, bb.left); const top = Math.max(aa.top, bb.top);
  const right = Math.min(aa.right, bb.right); const bottom = Math.min(aa.bottom, bb.bottom);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(1, aa.width * aa.height + bb.width * bb.height - intersection);
}

function chooseCandidate(result: SurfaceDetectionResult, used: SurfaceCandidate[], index: number): SurfaceCandidate {
  const free = result.candidates.filter((candidate) => !used.some((existing) => iou(existing, candidate) > 0.48));
  return free[index] ?? free[0] ?? result.candidates[index] ?? result.candidates[0];
}

function targetSize(width: number, height: number): { width: number; height: number; warning?: string } {
  const minScale = Math.max(1, 2001 / Math.min(width, height));
  const maxScale = Math.min(1, 4999 / Math.max(width, height));
  const scale = Math.min(minScale, maxScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    ...(minScale > maxScale ? { warning: 'Extreme aspect ratio cannot satisfy both preview minimum and PSD maximum dimensions; manual review required.' } : {}),
  };
}

function averageAspect(candidate: SurfaceCandidate): number {
  const q = candidate.quad;
  const d = (a: number, b: number, c: number, e: number) => Math.max(1, Math.hypot(c - a, e - b));
  const w = (d(q[0], q[1], q[2], q[3]) + d(q[6], q[7], q[4], q[5])) / 2;
  const h = (d(q[0], q[1], q[6], q[7]) + d(q[2], q[3], q[4], q[5])) / 2;
  return Math.max(0.2, Math.min(5, w / h));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
}

async function placeholder(file: string, label: string, candidate: SurfaceCandidate): Promise<void> {
  const aspect = averageAspect(candidate);
  const width = aspect >= 1 ? 1800 : Math.max(720, Math.round(1800 * aspect));
  const height = aspect >= 1 ? Math.max(720, Math.round(1800 / aspect)) : 1800;
  const size = Math.max(42, Math.round(Math.min(width, height) / 9));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#20242a"/><stop offset="1" stop-color="#667180"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><path d="M0 ${height * .16}L${width} ${height * .04}M0 ${height * .84}L${width} ${height * .96}" stroke="#fff" stroke-opacity=".3" stroke-width="8"/><text x="50%" y="46%" text-anchor="middle" font-family="Arial" font-size="${size}" font-weight="700" fill="#fff">PLACE DESIGN</text><text x="50%" y="59%" text-anchor="middle" font-family="Arial" font-size="${Math.round(size * .48)}" fill="#fff">${escapeXml(label)}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

function localPolygon(points: Point[], left: number, top: number): string {
  return points.map(([x, y]) => `${(x - left).toFixed(1)},${(y - top).toFixed(1)}`).join(' ');
}

async function makeLighting(scene: string, candidate: SurfaceCandidate, sceneWidth: number, sceneHeight: number, output: string) {
  const box = bounds(candidate, sceneWidth, sceneHeight);
  await sharp(scene).extract({ left: box.left, top: box.top, width: box.width, height: box.height }).grayscale().normalise().linear(0.34, 84).png().toFile(output);
  return box;
}

async function warpedBuffer(file: string, candidate: SurfaceCandidate): Promise<{ input: Buffer; left: number; top: number }> {
  const source = await readRgba(file);
  const warped = warpPerspective(source, candidate.quad);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${warped.image.width}" height="${warped.image.height}"><polygon points="${localPolygon(candidate.polygon, warped.left, warped.top)}" fill="#fff"/></svg>`);
  const input = await sharp(Buffer.from(warped.image.data), { raw: { width: warped.image.width, height: warped.image.height, channels: 4 } }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return { input, left: warped.left, top: warped.top };
}

async function makePreview(scene: string, slots: Array<{ candidate: SurfaceCandidate; artwork: string; lighting: string; box: ReturnType<typeof bounds> }>, output: string): Promise<void> {
  const composites: any[] = [];
  for (const item of slots) {
    const warped = await warpedBuffer(item.artwork, item.candidate);
    composites.push({ input: warped.input, left: warped.left, top: warped.top, blend: 'over' });
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${item.box.width}" height="${item.box.height}"><polygon points="${localPolygon(item.candidate.polygon, item.box.left, item.box.top)}" fill="#fff"/></svg>`);
    const lighting = await sharp(item.lighting).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    composites.push({ input: lighting, left: item.box.left, top: item.box.top, blend: 'soft-light' });
  }
  await sharp(scene).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(output);
}

export async function rebuildMagnificBatch(options: MagnificRebuildOptions): Promise<MagnificRebuildResult> {
  const input = path.resolve(options.inputDirectory);
  const output = path.resolve(options.outputDirectory);
  const delivery = path.join(output, 'delivery');
  const manifests = path.join(output, 'manifests');
  const review = path.join(output, 'review');
  const workRoot = path.join(output, '.work');
  await Promise.all([delivery, manifests, review, workRoot].map((directory) => mkdir(directory, { recursive: true })));
  const files = (await readdir(input, { withFileTypes: true })).filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error(`No supported source images found in ${input}`);

  const items: MagnificRebuildItem[] = [];
  const threshold = Math.max(0, Math.min(1, options.minimumConfidence ?? 0.5));
  const analysisSize = Math.max(480, Math.min(2400, options.maxAnalysisDimension ?? 1600));

  for (const fileName of files) {
    const source = path.join(input, fileName);
    const base = path.basename(fileName, path.extname(fileName));
    const work = path.join(workRoot, base);
    await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) throw new Error(`Unable to read dimensions: ${source}`);
    const size = targetSize(meta.width, meta.height);
    const warnings: string[] = size.warning ? [size.warning] : [];
    const scene = path.join(work, 'scene.jpg');
    await sharp(source).resize(size.width, size.height, { fit: 'fill' }).toColourspace('srgb').jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toFile(scene);

    const recipe = inferMagnificRebuildRecipe(fileName);
    const cache = new Map<SurfaceHint, Promise<SurfaceDetectionResult>>();
    const usage = new Map<SurfaceHint, number>();
    const used: SurfaceCandidate[] = [];
    const built: Array<{ label: string; hint: SurfaceHint; candidate: SurfaceCandidate; artwork: string; lighting: string; box: ReturnType<typeof bounds> }> = [];

    for (const spec of recipe.slots) {
      let pending = cache.get(spec.hint);
      if (!pending) { pending = detectMockupSurfaces(scene, { hint: spec.hint, count: 10, maxDimension: analysisSize }); cache.set(spec.hint, pending); }
      const detection = await pending;
      const index = usage.get(spec.hint) ?? 0; usage.set(spec.hint, index + 1);
      const candidate = chooseCandidate(detection, used, index); used.push(candidate);
      if (candidate.confidence < threshold) warnings.push(`${spec.label}: ${(candidate.confidence * 100).toFixed(0)}% detection confidence; inspect review overlay.`);
      const artwork = path.join(work, `artwork-${built.length + 1}.png`);
      const lighting = path.join(work, `lighting-${built.length + 1}.png`);
      await placeholder(artwork, spec.label, candidate);
      const box = await makeLighting(scene, candidate, size.width, size.height, lighting);
      built.push({ label: spec.label, hint: spec.hint, candidate, artwork, lighting, box });
    }

    const overlay = path.join(review, `${base}-detection.jpg`);
    await renderSurfaceDetectionOverlay(scene, { image: { width: size.width, height: size.height }, analysis: { width: size.width, height: size.height, scale: 1 }, hint: 'auto', candidates: built.map((item) => item.candidate), warnings: [] }, overlay);

    const layers: LayerSpec[] = built.map((item) => {
      const vectorMask = candidateVectorMask(item.candidate);
      return {
        type: 'group', name: `EDIT — ${item.label}`, opened: true, children: [
          { type: 'raster', name: `Surface lighting — ${item.label} (Do not edit)`, source: path.relative(work, item.lighting), x: item.box.left, y: item.box.top, width: item.box.width, height: item.box.height, blendMode: 'soft light', clipping: true, vectorMask },
          { type: 'smart-object', name: `Place your design here — ${item.label} (Double click to edit)`, source: path.relative(work, item.artwork), quad: item.candidate.quad, vectorMask, ...(item.candidate.nativeWarp ? { nativeWarp: item.candidate.nativeWarp } : {}) },
        ],
      } as LayerSpec;
    });
    layers.push({ type: 'raster', name: 'BACKGROUND — Mockup scene', source: path.relative(work, scene), x: 0, y: 0, width: size.width, height: size.height });
    const manifestObject: MockupManifest = { version: 1, document: { width: size.width, height: size.height, dpi: 72, background: '#ffffff' }, layers };
    const manifestFile = path.join(manifests, `${base}.mockup.json`);
    await writeFile(manifestFile, JSON.stringify(manifestObject, null, 2));
    const psd = path.join(delivery, `${base}.psd`);
    await buildMockup(manifestObject, { output: psd, cwd: work, generateComposite: false });
    const preview = path.join(delivery, `${base}.jpg`);
    await makePreview(scene, built, preview);
    const preflight = await preflightMagnific(psd, preview, { type: 'mockup', createdByAi: Boolean(options.createdByAi) });
    items.push({ source, psd, preview, manifest: manifestFile, overlay, slots: built.map((item) => ({ label: item.label, hint: item.hint, kind: item.candidate.kind, confidence: item.candidate.confidence })), preflight, warnings });
  }

  const warnings: string[] = [];
  if (items.some((item) => !item.preflight.ok)) warnings.push('One or more PSD/JPG pairs failed automatic Magnific preflight.');
  if (items.some((item) => item.warnings.length)) warnings.push('One or more geometry detections require visual review.');
  await writeFile(path.join(output, 'rebuild-report.json'), JSON.stringify({ items, warnings }, null, 2));
  return { ok: items.every((item) => item.preflight.ok), outputDirectory: output, items, warnings };
}
