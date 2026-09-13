export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color dodge'
  | 'color burn'
  | 'hard light'
  | 'soft light'
  | 'difference'
  | 'exclusion';

export type Quad = [number, number, number, number, number, number, number, number];

export interface DropShadowEffectSpec {
  color?: string;
  opacity?: number;
  angle?: number;
  distance?: number;
  size?: number;
  spread?: number;
  blendMode?: BlendMode;
  useGlobalLight?: boolean;
}

export interface StrokeEffectSpec {
  color?: string;
  opacity?: number;
  size?: number;
  position?: 'inside' | 'center' | 'outside';
  blendMode?: BlendMode;
}

export interface ColorOverlayEffectSpec {
  color?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface LayerEffectsSpec {
  dropShadow?: DropShadowEffectSpec;
  stroke?: StrokeEffectSpec;
  colorOverlay?: ColorOverlayEffectSpec;
}

export interface LayerMaskSpec {
  source: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  invert?: boolean;
  feather?: number;
  defaultColor?: 0 | 255;
}

export interface DisplacementSpec {
  source: string;
  scaleX?: number;
  scaleY?: number;
  channel?: 'luminance' | 'red' | 'green' | 'blue' | 'alpha';
  edge?: 'clamp' | 'transparent';
}

export interface BaseLayerSpec {
  name: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  clipping?: boolean;
  effects?: LayerEffectsSpec;
}

export interface GroupLayerSpec extends BaseLayerSpec {
  type: 'group';
  opened?: boolean;
  children: LayerSpec[];
}

export interface RasterLayerSpec extends BaseLayerSpec {
  type: 'raster';
  source: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  mask?: LayerMaskSpec;
  displacement?: DisplacementSpec;
}

export interface SmartObjectLayerSpec extends BaseLayerSpec {
  type: 'smart-object';
  source: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  dpi?: number;
  /** Absolute document coordinates: TL, TR, BR, BL. Overrides x/y/width/height. */
  quad?: Quad;
  mask?: LayerMaskSpec;
  displacement?: DisplacementSpec;
}

export interface TextLayerSpec extends BaseLayerSpec {
  type: 'text';
  text: string;
  x: number;
  y: number;
  font?: string;
  size?: number;
  color?: string;
}

export type LayerSpec = GroupLayerSpec | RasterLayerSpec | SmartObjectLayerSpec | TextLayerSpec;

export interface MockupManifest {
  version: 1;
  document: {
    width: number;
    height: number;
    dpi?: number;
    background?: string;
  };
  layers: LayerSpec[];
}

export interface BuildOptions {
  output: string;
  cwd?: string;
  generateComposite?: boolean;
}

export interface BuildResult {
  output: string;
  bytes: number;
  layerCount: number;
  smartObjectCount: number;
  warnings: string[];
}

export interface ReplaceSmartObjectOptions {
  template: string;
  layerName: string;
  artwork: string;
  output: string;
}

export interface ReplaceSmartObjectResult {
  output: string;
  bytes: number;
  layerName: string;
  warnings: string[];
}
