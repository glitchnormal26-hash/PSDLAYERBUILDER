# PSDLAYERBUILDER

Manifest-driven engine for generating and modifying Photoshop PSD mockups with a clean, editable layer tree.

## Core capabilities

- Nested Photoshop groups
- Raster layers with position, size, opacity, visibility and blend modes
- Embedded smart objects with original source bytes stored inside the PSD
- Perspective smart objects using an 8-point document-space quad
- Native bitmap layer masks
- Native Photoshop clipping-mask flags
- Native editable layer effects: drop shadow, stroke and color overlay
- Displacement-map raster-cache preview for fabric, paper and curved-surface mockups
- Template replacement: replace a named smart object inside an existing PSD while preserving the rest of the template
- Editable text metadata
- Composite preview for generated PSDs
- CLI commands to build, replace and inspect PSD files

The portable writer uses `ag-psd` 31.0.2. The manifest model is backend-neutral so a Photoshop UXP, Rust or cloud backend can be added later without changing mockup definitions.

## Quick start

```bash
npm install
npm run example
```

The example PSD is written to `examples/output/basic-mockup.psd`.

### Build from a manifest

```bash
npm run build
node dist/cli.js build path/to/mockup.json -o output/mockup.psd
```

### Replace a smart object in an existing Photoshop template

```bash
node dist/cli.js replace template.psd \
  --layer "YOUR DESIGN" \
  --artwork artwork.png \
  -o output/final.psd
```

### Inspect a PSD layer tree

```bash
node dist/cli.js inspect output/final.psd
```

## Manifest example

Layer order is top-to-bottom, matching the Photoshop Layers panel. Asset paths are relative to the manifest file.

```json
{
  "version": 1,
  "document": {
    "width": 2000,
    "height": 1500,
    "dpi": 144,
    "background": "#f3f3f3"
  },
  "layers": [
    {
      "type": "smart-object",
      "name": "YOUR DESIGN",
      "source": "assets/design.png",
      "quad": [420, 330, 1570, 380, 1500, 1100, 500, 1040],
      "mask": {
        "source": "assets/product-mask.png",
        "feather": 1.5
      },
      "displacement": {
        "source": "assets/fabric-displacement.png",
        "scaleX": 8,
        "scaleY": 5,
        "channel": "luminance"
      },
      "effects": {
        "stroke": {
          "size": 2,
          "position": "inside",
          "color": "#ffffff",
          "opacity": 0.7
        }
      }
    },
    {
      "type": "raster",
      "name": "LIGHTING",
      "source": "assets/highlight.png",
      "x": 420,
      "y": 330,
      "blendMode": "screen",
      "clipping": true
    },
    {
      "type": "raster",
      "name": "SHADOW",
      "source": "assets/shadow.png",
      "x": 450,
      "y": 1000,
      "opacity": 0.45,
      "blendMode": "multiply",
      "effects": {
        "dropShadow": {
          "color": "#000000",
          "opacity": 0.25,
          "angle": 120,
          "distance": 18,
          "size": 28,
          "spread": 0
        }
      }
    }
  ]
}
```

For axis-aligned smart-object placement, omit `quad` and use `x`, `y`, `width`, and `height`.

## Masks

`mask.source` can be PNG/JPEG/WebP. RGB is converted to luminance and multiplied by source alpha. White reveals, black hides. `invert`, `feather`, explicit mask bounds and Photoshop `defaultColor` are supported. The mask is written as native PSD user-mask data, while the generated composite preview also applies it.

## Clipping masks

Set `"clipping": true` on a layer to store Photoshop's native clipping flag. Photoshop will clip it to the eligible layer beneath it. The lightweight generated composite does not currently emulate clipping groups; the PSD layer structure remains editable and correct for Photoshop.

## Layer effects

Supported manifest effects are `dropShadow`, `stroke`, and `colorOverlay`. They are stored as editable Photoshop layer effects rather than baked pixels. The convenience composite does not render these effects.

## Displacement maps

`displacement` deforms the raster cache using inverse sampling with bilinear interpolation. A value of 128 is neutral; darker and brighter values shift sampling in opposite directions. Supported channels are `luminance`, `red`, `green`, `blue`, and `alpha`, with `clamp` or `transparent` edge handling.

For smart objects, displacement is intentionally cache-only in the portable backend: the embedded artwork remains editable, but the PSD does not contain a native Photoshop Displace smart filter. For production mockups requiring editable Photoshop smart filters, author the filter in a template and use the `replace` workflow; template metadata is preserved.

## Production workflows

### Build from scratch

Use JSON when the mockup is programmatically defined. The engine creates groups, raster layers, editable metadata, masks, effects and embedded smart objects.

### Replace inside a Photoshop-authored template

Use `replace` when the visual mockup already exists in Photoshop and contains advanced lighting, masks, effects, smart filters, displacement, warp or other authored details. PSDLAYERBUILDER replaces the named embedded artwork and preserves the template structure through raw PSD channel round-tripping.

This is the preferred workflow for high-fidelity apparel, packaging and product mockups.

## Current boundaries

- Portable authoring is RGB PSD, not PSB.
- Perspective uses a 4-corner projective transform. Complex Photoshop warp is preserved by the template workflow but not authored from JSON yet.
- Generated composite previews use normal alpha compositing; Photoshop blend/effect/clipping semantics are stored but not fully rasterized into that convenience preview.
- PSD dimensions are capped at 30,000 x 30,000 with a 300 MP manifest guard. Composite and displacement preview work has an 80 MP guard.
- Remote asset URLs are rejected to keep builds deterministic.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

CI runs these checks on pushes and pull requests.

## Roadmap

1. Multiple named smart-object replacements in a single command
2. Native vector-mask authoring
3. Photoshop UXP finalizer for native smart filters, custom warp and exact text rendering
4. Optional PSB backend for very large documents

## License

MIT
