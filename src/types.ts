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

export interface BaseLayerSpec {
  name: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
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
}

export interface SmartObjectLayerSpec extends BaseLayerSpec {
  type: 'smart-object';
  source: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  dpi?: number;
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
