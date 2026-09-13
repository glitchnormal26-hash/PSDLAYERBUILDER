import { parseHexColor } from './image.js';
import type { LayerEffectsSpec } from './types.js';

function pixels(value: number) {
  return { units: 'Pixels' as const, value };
}

export function compileEffects(spec?: LayerEffectsSpec): any | undefined {
  if (!spec) return undefined;

  const effects: any = { scale: 1 };

  if (spec.dropShadow) {
    const shadow = spec.dropShadow;
    effects.dropShadow = [{
      present: true,
      showInDialog: true,
      enabled: true,
      color: parseHexColor(shadow.color ?? '#000000'),
      opacity: shadow.opacity ?? 0.35,
      angle: shadow.angle ?? 120,
      distance: pixels(shadow.distance ?? 12),
      size: pixels(shadow.size ?? 18),
      choke: pixels(shadow.spread ?? 0),
      blendMode: shadow.blendMode ?? 'multiply',
      useGlobalLight: shadow.useGlobalLight ?? true,
      layerConceals: true,
    }];
  }

  if (spec.stroke) {
    const stroke = spec.stroke;
    effects.stroke = [{
      present: true,
      showInDialog: true,
      enabled: true,
      size: pixels(stroke.size ?? 2),
      position: stroke.position ?? 'inside',
      fillType: 'color',
      blendMode: stroke.blendMode ?? 'normal',
      opacity: stroke.opacity ?? 1,
      color: parseHexColor(stroke.color ?? '#000000'),
    }];
  }

  if (spec.colorOverlay) {
    const overlay = spec.colorOverlay;
    effects.solidFill = [{
      present: true,
      showInDialog: true,
      enabled: true,
      blendMode: overlay.blendMode ?? 'normal',
      opacity: overlay.opacity ?? 1,
      color: parseHexColor(overlay.color ?? '#000000'),
    }];
  }

  return Object.keys(effects).length > 1 ? effects : undefined;
}
