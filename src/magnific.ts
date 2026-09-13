import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { readPsd } from 'ag-psd';
import sharp from 'sharp';

export type MagnificAssetType = 'mockup' | 'template' | 'graphic-elements';
export type MagnificCheckStatus = 'pass' | 'fail' | 'warning' | 'manual';

export interface MagnificCheck {
  status: MagnificCheckStatus;
  code: string;
  message: string;
  actual?: string | number;
  expected?: string;
  layerPath?: string;
}

export interface MagnificPreflightOptions {
  type?: MagnificAssetType;
  createdByAi?: boolean;
}

export interface MagnificPreflightResult {
  ok: boolean;
  type: MagnificAssetType;
  psd: string;
  preview: string;
  checks: MagnificCheck[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    manual: number;
  };
}

export interface MagnificBatchResult {
  ok: boolean;
  directory: string;
  total: number;
  passed: number;
  failed: number;
  results: MagnificPreflightResult[];
}

interface IndexedLayer {
  layer: any;
  name: string;
  displayPath: string;
}

const PSD_MIN_BYTES = 1_500_000;
const PSD_MAX_BYTES = 250_000_000;
const JPG_MIN_BYTES = 500_000;
const JPG_MAX_BYTES = 80_000_000;
const PREVIEW_MIN_PX = 2000;
const PREVIEW_MAX_PX = 10000;
const PSD_MIN_PX = 1000;
const PSD_MAX_PX = 5000;

function indexLayers(layers: any[], parent: string[] = []): IndexedLayer[] {
  const result: IndexedLayer[] = [];
  for (const layer of layers) {
    const name = String(layer.name ?? '').trim();
    const parts = [...parent, name || '(unnamed)'];
    result.push({ layer, name, displayPath: parts.join('/') });
    if (Array.isArray(layer.children)) result.push(...indexLayers(layer.children, parts));
  }
  return result;
}

function addRangeCheck(
  checks: MagnificCheck[],
  code: string,
  label: string,
  actual: number,
  minExclusive: number,
  maxExclusive: number,
  unit: string,
): void {
  const pass = actual > minExclusive && actual < maxExclusive;
  checks.push({
    status: pass ? 'pass' : 'fail',
    code,
    message: pass
      ? `${label} is within the Magnific range.`
      : `${label} is outside the Magnific range.`,
    actual: `${actual} ${unit}`,
    expected: `>${minExclusive} and <${maxExclusive} ${unit}`,
  });
}

function addInclusiveRangeCheck(
  checks: MagnificCheck[],
  code: string,
  label: string,
  actual: number,
  min: number,
  max: number,
  unit: string,
): void {
  const pass = actual >= min && actual <= max;
  checks.push({
    status: pass ? 'pass' : 'fail',
    code,
    message: pass
      ? `${label} is within the Magnific range.`
      : `${label} is outside the Magnific range.`,
    actual: `${actual} ${unit}`,
    expected: `${min}-${max} ${unit}`,
  });
}

function summarize(checks: MagnificCheck[]) {
  return {
    passed: checks.filter((item) => item.status === 'pass').length,
    failed: checks.filter((item) => item.status === 'fail').length,
    warnings: checks.filter((item) => item.status === 'warning').length,
    manual: checks.filter((item) => item.status === 'manual').length,
  };
}

function manualChecks(type: MagnificAssetType, createdByAi: boolean): MagnificCheck[] {
  const checks: MagnificCheck[] = [
    { status: 'manual', code: 'PHOTOS_AND_PLACEHOLDERS', message: 'Confirm example/placeholder photos are not embedded in the delivery PSD. If an external example photo appears only in the JPG preview, clearly mark IMAGE NOT INCLUDED.' },
    { status: 'manual', code: 'BRAND_TRADEMARK_REVIEW', message: 'Confirm the PSD and preview contain no prohibited logos, trademarks, branded product marks, signatures or watermarks.' },
    { status: 'manual', code: 'COPYRIGHT_ORIGINALITY', message: 'Confirm the resource and all included elements are original or otherwise eligible for Magnific submission and commercial use.' },
    { status: 'manual', code: 'PHOTOSHOP_CC_COMPATIBILITY', message: 'Open/save the final delivery in a supported Photoshop CC version and verify there are no repair/compatibility dialogs.' },
    { status: 'manual', code: 'ICC_PROFILE_IDENTITY', message: type === 'template' ? 'Verify the embedded CMYK profile is Coated FOGRA 27.' : 'Verify the embedded RGB profile is an accepted profile; sRGB is recommended for mockups.' },
    { status: 'manual', code: 'TITLE_AND_KEYWORDS', message: 'Complete relevant title and keywords in the Magnific dashboard or CSV before submission.' },
  ];

  if (type === 'mockup') {
    checks.push({ status: 'manual', code: 'MOCKUP_VISUAL_QUALITY', message: 'Verify replacement artwork follows the object perspective/shape naturally and the JPG preview clearly demonstrates the editable area with a real example design or text.' });
  }
  if (type === 'template') {
    checks.push({ status: 'manual', code: 'FONT_AND_TYPOGRAPHY', message: 'Verify fonts are commercially licensed, editable text remains editable, typography is readable, spacing is clean and there are no typos.' });
  }
  checks.push({
    status: 'manual',
    code: 'AI_DECLARATION',
    message: createdByAi
      ? 'This resource is marked as containing AI. Ensure Created by AI is selected during submission and manually inspect for malformed text, repeated artifacts and low-quality details.'
      : 'Confirm whether any part of the PSD or preview was AI-generated. If yes, mark Created by AI during submission.',
  });
  return checks;
}

function colorModeName(colorMode: number | undefined): string {
  if (colorMode === 3) return 'RGB';
  if (colorMode === 4) return 'CMYK';
  if (colorMode === 1) return 'Grayscale';
  if (colorMode === 2) return 'Indexed';
  if (colorMode === 9) return 'Lab';
  return colorMode === undefined ? 'unknown' : `mode-${colorMode}`;
}

export async function preflightMagnific(
  psdFile: string,
  previewFile: string,
  options: MagnificPreflightOptions = {},
): Promise<MagnificPreflightResult> {
  const type = options.type ?? 'mockup';
  const psdPath = path.resolve(psdFile);
  const previewPath = path.resolve(previewFile);
  const checks: MagnificCheck[] = [];

  const [psdStats, previewStats, psdBytes, previewMetadata] = await Promise.all([
    stat(psdPath),
    stat(previewPath),
    readFile(psdPath),
    sharp(previewPath, { failOn: 'error' }).metadata(),
  ]);

  const psdBase = path.basename(psdPath, path.extname(psdPath));
  const previewBase = path.basename(previewPath, path.extname(previewPath));
  checks.push({
    status: psdBase === previewBase ? 'pass' : 'fail',
    code: 'PAIR_FILENAME',
    message: psdBase === previewBase ? 'PSD and JPG preview base names are identical.' : 'PSD and JPG preview must use identical base names.',
    actual: `${path.basename(psdPath)} + ${path.basename(previewPath)}`,
    expected: 'identical base names',
  });

  checks.push({
    status: path.extname(psdPath).toLowerCase() === '.psd' ? 'pass' : 'fail',
    code: 'PSD_EXTENSION',
    message: 'Delivery file must use the .PSD extension.',
    actual: path.extname(psdPath),
    expected: '.psd',
  });
  checks.push({
    status: path.extname(previewPath).toLowerCase() === '.jpg' ? 'pass' : 'fail',
    code: 'PREVIEW_EXTENSION',
    message: 'Preview must use the .JPG extension.',
    actual: path.extname(previewPath),
    expected: '.jpg',
  });

  addInclusiveRangeCheck(checks, 'PSD_FILE_SIZE', 'PSD file size', psdStats.size, PSD_MIN_BYTES, PSD_MAX_BYTES, 'bytes');
  addInclusiveRangeCheck(checks, 'PREVIEW_FILE_SIZE', 'JPG preview file size', previewStats.size, JPG_MIN_BYTES, JPG_MAX_BYTES, 'bytes');

  if (!previewMetadata.width || !previewMetadata.height) throw new Error(`Unable to determine JPG dimensions: ${previewPath}`);
  addInclusiveRangeCheck(checks, 'PREVIEW_WIDTH', 'Preview width', previewMetadata.width, PREVIEW_MIN_PX, PREVIEW_MAX_PX, 'px');
  addInclusiveRangeCheck(checks, 'PREVIEW_HEIGHT', 'Preview height', previewMetadata.height, PREVIEW_MIN_PX, PREVIEW_MAX_PX, 'px');

  const psd: any = readPsd(psdBytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const layers = indexLayers(psd.children ?? []);
  const smartObjects = layers.filter((entry) => Boolean(entry.layer.placedLayer));
  const textLayers = layers.filter((entry) => Boolean(entry.layer.text));
  const linkedFiles = psd.linkedFiles ?? [];
  const linkedById = new Map<string, any>(linkedFiles.map((file: any) => [String(file.id), file]));

  if (type === 'mockup' || type === 'graphic-elements') {
    addRangeCheck(checks, 'PSD_WIDTH', 'PSD width', Number(psd.width), PSD_MIN_PX, PSD_MAX_PX, 'px');
    addRangeCheck(checks, 'PSD_HEIGHT', 'PSD height', Number(psd.height), PSD_MIN_PX, PSD_MAX_PX, 'px');
  }

  const actualColorMode = colorModeName(psd.colorMode);
  const wantsCmyk = type === 'template';
  const colorPass = wantsCmyk ? psd.colorMode === 4 : psd.colorMode === 3;
  checks.push({
    status: colorPass ? 'pass' : 'fail',
    code: 'COLOR_MODE',
    message: colorPass ? `PSD color mode is ${actualColorMode}.` : `${type} requires ${wantsCmyk ? 'CMYK' : 'RGB'} color mode.`,
    actual: actualColorMode,
    expected: wantsCmyk ? 'CMYK' : 'RGB',
  });

  if (psd.imageResources?.iccUntaggedProfile === true) {
    checks.push({ status: 'fail', code: 'ICC_UNTAGGED', message: 'PSD is explicitly marked as having an untagged ICC profile. Embed the required profile before submission.' });
  } else {
    checks.push({ status: 'warning', code: 'ICC_PROFILE_PARSE_LIMIT', message: 'Portable preflight can confirm color mode and detect an explicitly untagged profile, but exact ICC profile identity must be verified in Photoshop.' });
  }

  if (type === 'template') {
    const info = psd.imageResources?.resolutionInfo;
    const horizontal = Number(info?.horizontalResolution);
    const vertical = Number(info?.verticalResolution);
    if (Number.isFinite(horizontal) && Number.isFinite(vertical)) {
      addInclusiveRangeCheck(checks, 'DPI_HORIZONTAL', 'Horizontal resolution', horizontal, 150, 300, 'dpi');
      addInclusiveRangeCheck(checks, 'DPI_VERTICAL', 'Vertical resolution', vertical, 150, 300, 'dpi');
    } else {
      checks.push({ status: 'fail', code: 'DPI_MISSING', message: 'Template PSD has no readable resolution metadata.', expected: '150-300 dpi' });
    }
  }

  const unnamed = layers.filter((entry) => !entry.name || /^layer\s*\d*$/i.test(entry.name));
  checks.push({
    status: unnamed.length === 0 ? 'pass' : 'warning',
    code: 'LAYER_NAMING',
    message: unnamed.length === 0 ? 'No unnamed/default layer names were detected.' : `${unnamed.length} layer(s) use empty/default names; use clear English layer names before submission.`,
    actual: unnamed.length,
    expected: '0 unnamed/default layers',
  });

  if (type === 'mockup') {
    checks.push({
      status: smartObjects.length > 0 ? 'pass' : 'fail',
      code: 'MOCKUP_SMART_OBJECT_REQUIRED',
      message: smartObjects.length > 0 ? `${smartObjects.length} Smart Object layer(s) detected.` : 'Mockup PSD must provide a functional Smart Object replacement area.',
      actual: smartObjects.length,
      expected: 'at least 1 functional Smart Object',
    });

    const helpfulName = smartObjects.some((entry) => /place\s+your\s+design|your\s+design|double\s*click|replace/i.test(entry.name));
    checks.push({
      status: helpfulName ? 'pass' : 'warning',
      code: 'SMART_OBJECT_INSTRUCTION_NAME',
      message: helpfulName ? 'At least one Smart Object has a clear replacement-oriented layer name.' : 'Use a clear layer name such as “Place your design here (Double click to edit)”.',
    });
  }

  for (const entry of smartObjects) {
    const id = entry.layer.placedLayer?.id;
    const linked = id ? linkedById.get(String(id)) : undefined;
    if (!id || !linked) {
      checks.push({ status: 'fail', code: 'SMART_OBJECT_SOURCE_MISSING', message: 'Smart Object has no embedded source entry.', layerPath: entry.displayPath });
      continue;
    }
    if (!linked.data || Number(linked.data.length ?? linked.data.byteLength ?? 0) === 0) {
      checks.push({ status: 'fail', code: 'EXTERNAL_SMART_OBJECT_DEPENDENCY', message: 'Smart Object source is not embedded in the PSD; external dependencies are not allowed for a self-contained delivery.', layerPath: entry.displayPath });
    }
  }

  if (smartObjects.length > 0 && !checks.some((item) => item.code === 'SMART_OBJECT_SOURCE_MISSING' || item.code === 'EXTERNAL_SMART_OBJECT_DEPENDENCY')) {
    checks.push({ status: 'pass', code: 'SMART_OBJECT_EMBEDDED_SOURCES', message: 'All detected Smart Objects have embedded source data.' });
  }

  if (type === 'graphic-elements') {
    checks.push({
      status: textLayers.length === 0 ? 'pass' : 'fail',
      code: 'GRAPHIC_ELEMENTS_NO_TEXT',
      message: textLayers.length === 0 ? 'No editable text layers detected.' : 'Graphic Elements submissions must not contain text elements.',
      actual: textLayers.length,
      expected: '0 text layers',
    });
  }

  checks.push(...manualChecks(type, options.createdByAi ?? false));
  const summary = summarize(checks);
  return {
    ok: summary.failed === 0,
    type,
    psd: psdPath,
    preview: previewPath,
    checks,
    summary,
  };
}

export async function preflightMagnificBatch(
  directory: string,
  options: MagnificPreflightOptions = {},
): Promise<MagnificBatchResult> {
  const root = path.resolve(directory);
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const lowerToActual = new Map(files.map((name) => [name.toLowerCase(), name]));
  const psdFiles = files.filter((name) => path.extname(name).toLowerCase() === '.psd').sort();
  const results: MagnificPreflightResult[] = [];

  for (const psdName of psdFiles) {
    const base = path.basename(psdName, path.extname(psdName));
    const jpgName = lowerToActual.get(`${base}.jpg`.toLowerCase());
    if (!jpgName) {
      const checks: MagnificCheck[] = [{ status: 'fail', code: 'PREVIEW_PAIR_MISSING', message: `No same-name JPG preview found for ${psdName}.`, expected: `${base}.jpg` }];
      results.push({
        ok: false,
        type: options.type ?? 'mockup',
        psd: path.join(root, psdName),
        preview: path.join(root, `${base}.jpg`),
        checks,
        summary: summarize(checks),
      });
      continue;
    }
    results.push(await preflightMagnific(path.join(root, psdName), path.join(root, jpgName), options));
  }

  const passed = results.filter((result) => result.ok).length;
  return {
    ok: results.length > 0 && passed === results.length,
    directory: root,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
