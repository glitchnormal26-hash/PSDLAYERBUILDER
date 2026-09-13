import { z } from 'zod';

const blendModes = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color dodge', 'color burn', 'hard light', 'soft light', 'difference', 'exclusion',
] as const;

const warpStyles = [
  'cylinder', 'arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper',
  'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist',
] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const opacity = z.number().min(0).max(1);
const pixelAmount = z.number().finite().min(0).max(10000);

const effects = z.object({
  dropShadow: z.object({
    color: hexColor.optional(),
    opacity: opacity.optional(),
    angle: z.number().finite().min(-360).max(360).optional(),
    distance: pixelAmount.optional(),
    size: pixelAmount.optional(),
    spread: pixelAmount.optional(),
    blendMode: z.enum(blendModes).optional(),
    useGlobalLight: z.boolean().optional(),
  }).optional(),
  stroke: z.object({
    color: hexColor.optional(),
    opacity: opacity.optional(),
    size: pixelAmount.optional(),
    position: z.enum(['inside', 'center', 'outside']).optional(),
    blendMode: z.enum(blendModes).optional(),
  }).optional(),
  colorOverlay: z.object({
    color: hexColor.optional(),
    opacity: opacity.optional(),
    blendMode: z.enum(blendModes).optional(),
  }).optional(),
}).optional();

const baseLayer = {
  name: z.string().min(1).max(255),
  visible: z.boolean().optional(),
  opacity: opacity.optional(),
  blendMode: z.enum(blendModes).optional(),
  clipping: z.boolean().optional(),
  effects,
};

const mask = z.object({
  source: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  invert: z.boolean().optional(),
  feather: z.number().finite().min(0).max(10000).optional(),
  defaultColor: z.union([z.literal(0), z.literal(255)]).optional(),
});

const vectorMaskPath = z.object({
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(2000),
  operation: z.enum(['combine', 'subtract', 'intersect', 'exclude']).optional(),
  closed: z.boolean().optional(),
});

const vectorMask = z.object({
  paths: z.array(vectorMaskPath).min(1).max(128),
  invert: z.boolean().optional(),
  linked: z.boolean().optional(),
  feather: z.number().finite().min(0).max(10000).optional(),
  fillStartsWithAllPixels: z.boolean().optional(),
}).refine((value) => value.paths.reduce((sum, path) => sum + path.points.length, 0) <= 20000, {
  message: 'Vector mask exceeds the 20,000 point safety limit',
});

const displacement = z.object({
  source: z.string().min(1),
  scaleX: z.number().finite().min(-4096).max(4096).optional(),
  scaleY: z.number().finite().min(-4096).max(4096).optional(),
  channel: z.enum(['luminance', 'red', 'green', 'blue', 'alpha']).optional(),
  edge: z.enum(['clamp', 'transparent']).optional(),
});

const nativeWarp = z.object({
  style: z.enum(warpStyles),
  bend: z.number().finite().min(-100).max(100).optional(),
  perspective: z.number().finite().min(-100).max(100).optional(),
  perspectiveOther: z.number().finite().min(-100).max(100).optional(),
  rotate: z.enum(['horizontal', 'vertical']).optional(),
  cylinderCurve: z.number().finite().min(0.02).max(0.98).optional(),
});

const rasterLayer = z.object({
  ...baseLayer,
  type: z.literal('raster'),
  source: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mask: mask.optional(),
  vectorMask: vectorMask.optional(),
  displacement: displacement.optional(),
});

const quad = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
]);

const smartObjectLayer = z.object({
  ...baseLayer,
  type: z.literal('smart-object'),
  source: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  dpi: z.number().positive().max(2400).optional(),
  quad: quad.optional(),
  mask: mask.optional(),
  vectorMask: vectorMask.optional(),
  displacement: displacement.optional(),
  nativeWarp: nativeWarp.optional(),
});

const textLayer = z.object({
  ...baseLayer,
  type: z.literal('text'),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  font: z.string().min(1).optional(),
  size: z.number().positive().max(2000).optional(),
  color: hexColor.optional(),
});

let layerSchema: any;
layerSchema = z.lazy(() => z.discriminatedUnion('type', [
  rasterLayer,
  smartObjectLayer,
  textLayer,
  z.object({
    ...baseLayer,
    type: z.literal('group'),
    opened: z.boolean().optional(),
    children: z.array(layerSchema),
  }),
]));

export const mockupManifestSchema = z.object({
  version: z.literal(1),
  document: z.object({
    width: z.number().int().positive().max(30000),
    height: z.number().int().positive().max(30000),
    dpi: z.number().positive().max(2400).optional(),
    background: hexColor.optional(),
  }).refine((doc) => doc.width * doc.height <= 300_000_000, {
    message: 'Document exceeds the 300 megapixel safety limit',
  }),
  layers: z.array(layerSchema).max(10000),
});

const replacementEntry = z.object({
  layer: z.string().min(1).optional(),
  path: z.array(z.string().min(1)).min(1).max(64).optional(),
  artwork: z.string().min(1),
}).refine((entry) => Number(Boolean(entry.layer)) + Number(Boolean(entry.path)) === 1, {
  message: 'Each replacement must specify exactly one of layer or path',
});

export const replacementMapSchema = z.object({
  replacements: z.array(replacementEntry).min(1).max(1000),
});
