import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir(new URL('../examples/assets/', import.meta.url), { recursive: true });

const artwork = Buffer.from(`
<svg width="1000" height="700" xmlns="http://www.w3.org/2000/svg">
  <rect width="1000" height="700" rx="48" fill="#151515"/>
  <circle cx="500" cy="350" r="220" fill="#f0f0f0"/>
  <text x="500" y="335" text-anchor="middle" font-family="Arial" font-size="68" font-weight="700" fill="#151515">YOUR</text>
  <text x="500" y="420" text-anchor="middle" font-family="Arial" font-size="68" font-weight="700" fill="#151515">DESIGN</text>
</svg>`);

const shadow = Buffer.from(`
<svg width="1000" height="180" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="blur"><feGaussianBlur stdDeviation="36"/></filter></defs>
  <ellipse cx="500" cy="90" rx="390" ry="42" fill="#000" opacity=".72" filter="url(#blur)"/>
</svg>`);

await sharp(artwork).png().toFile(new URL('../examples/assets/artwork.png', import.meta.url));
await sharp(shadow).png().toFile(new URL('../examples/assets/shadow.png', import.meta.url));
console.log('Example assets generated.');
