import { z } from 'zod';

const blendModes = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color dodge', 'color burn', 'hard light', 'soft light', 'difference', 'exclusion',
] as const;

const baseLayer = {
  name: z.string().min(1).max(255),
  visible: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  blendMode: z.enum(blendModes).optional(),
};

const rasterLayer = z.object({
  ...baseLayer,
  type: z.literal('raster'),
  source: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const smartObjectLayer = z.object({
  ...baseLayer,
  type: z.literal('smart-object'),
  source: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  dpi: z.number().positive().max(2400).optional(),
});

const textLayer = z.object({
  ...baseLayer,
  type: z.literal('text'),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  font: z.string().min(1).optional(),
  size: z.number().positive().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

type AnyLayerSchema = z.ZodTypeAny;
const layerSchema: AnyLayerSchema = z.lazy(() => z.discriminatedUnion('type', [
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
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).refine((doc) => doc.width * doc.height <= 300_000_000, {
    message: 'Document exceeds the 300 megapixel safety limit',
  }),
  layers: z.array(layerSchema).max(10000),
});
