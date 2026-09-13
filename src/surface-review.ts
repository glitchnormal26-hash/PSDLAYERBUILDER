import path from 'node:path';
import sharp from 'sharp';
import type { SurfaceDetectionResult, SurfaceHint } from './surface-detection.js';

export function inferSurfaceHintFromFilename(file: string): SurfaceHint {
  const name = path.basename(file).toLowerCase().replace(/[_-]+/g, ' ');
  if (/round.*sign|sign.*round|circular.*sign|circle.*sign/.test(name)) return 'round-sign';
  if (/laptop|notebook|monitor|screen|tablet|phone|smartphone|device/.test(name)) return 'screen';
  if (/bus.*stop|poster|billboard|advertising.*panel|lightbox/.test(name)) return 'poster';
  if (/gallery|frame|framed|interior.*art/.test(name)) return 'frame';
  if (/magazine|book|page|letterhead|stationery|paper|document/.test(name)) return 'page';
  if (/business.*card|card/.test(name)) return 'card';
  if (/tote|shopping.*bag|canvas.*bag|paper.*bag|coffee.*bag|pouch/.test(name)) return 'bag';
  if (/shirt|tshirt|t-shirt|hoodie|sweatshirt|garment|apparel/.test(name)) return 'garment';
  if (/jar|can\b|bottle|wine|supplement|cosmetic.*container/.test(name)) return 'cylinder';
  if (/box|carton|package|packaging/.test(name)) return 'box';
  return 'auto';
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char));
}

export async function renderSurfaceDetectionOverlay(source: string, result: SurfaceDetectionResult, output: string): Promise<string> {
  const { width, height } = result.image;
  const strokeWidth = Math.max(2, Math.round(Math.max(width, height) / 700));
  const fontSize = Math.max(18, Math.round(Math.max(width, height) / 55));
  const markup: string[] = [];

  result.candidates.forEach((candidate, index) => {
    const confidence = Math.round(candidate.confidence * 100);
    const stroke = candidate.confidence >= 0.7 ? '#25d366' : candidate.confidence >= 0.5 ? '#ffd166' : '#ff5c5c';
    const points = candidate.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    markup.push(`<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke"/>`);
    const x = Math.max(0, Math.min(...candidate.polygon.map((p) => p[0])));
    const y = Math.max(fontSize + 4, Math.min(...candidate.polygon.map((p) => p[1])));
    const label = xmlEscape(`#${index + 1} ${candidate.kind} ${confidence}%`);
    markup.push(`<rect x="${x}" y="${y - fontSize - 6}" width="${fontSize * 8.5}" height="${fontSize + 10}" rx="4" fill="rgba(0,0,0,0.68)"/>`);
    markup.push(`<text x="${x + 6}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="#fff">${label}</text>`);
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markup.join('')}</svg>`;
  await sharp(source, { failOn: 'error' }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(output);
  return path.resolve(output);
}
