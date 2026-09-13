# PSDLAYERBUILDER

Manifest-driven engine for generating and modifying Photoshop PSD mockups with a clean, editable layer tree.

## Core capabilities

- Nested Photoshop groups
- Raster layers with position, size, opacity, visibility and common blend modes
- Embedded smart objects with the original source stored inside the PSD
- **Perspective smart objects** using an 8-point document-space quad, including a generated perspective raster cache
- **Template replacement**: replace a named smart object inside an existing PSD while preserving the rest of the template
- Editable text metadata
- Composite preview for generated PSDs
- CLI commands to build, replace and inspect PSD files

The portable writer uses `ag-psd` 31.0.2. The manifest model is kept separate from the PSD backend so a Photoshop UXP, Rust or cloud backend can be added later without changing mockup definitions.

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

### Replace a smart object in an existing template

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

## Manifest

Layer order is **top to bottom**, matching the Photoshop Layers panel. Paths in `source` are relative to the manifest file.

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
      "quad": [420, 330, 1570, 380, 1500, 1100, 500, 1040]
    },
    {
      "type": "raster",
      "name": "SHADOW",
      "source": "assets/shadow.png",
      "x": 450,
      "y": 1000,
      "opacity": 0.45,
      "blendMode": "multiply"
    }
  ]
}
```

For axis-aligned placement, omit `quad` and use `x`, `y`, `width`, and `height` instead.

## Why there are two workflows

### 1. Build from scratch

Use JSON when the mockup is programmatically defined. The engine creates groups, raster layers, text metadata and embedded smart objects. Perspective artwork is rasterized into the layer cache with a projective transform while the source remains embedded and editable.

### 2. Replace inside a Photoshop-made template

Use `replace` when the visual mockup already exists in Photoshop and contains lighting, masks, effects, displacement or other authored details. PSDLAYERBUILDER finds the named smart object, replaces its embedded source, refreshes the projective cache, and writes a new PSD without flattening the template.

This is the preferred production workflow for high-fidelity product mockups because Photoshop-authored effects stay in the source template.

## Architecture

```text
                    ┌──────── build ──────── mockup.json
                    │                          │
artwork.png ────────┤                    Zod validation
                    │                          │
                    │                    layer compiler
                    │                          │
                    │                 perspective rasterizer
                    │                          │
                    │                    ag-psd writer
                    │                          │
                    └──────── replace ─── template.psd
                                               │
                                        named smart object
                                               │
                                      embedded source swap
                                               │
                                        ag-psd writer
                                               │
                                               ▼
                                           output.psd
```

## Smart objects

Each generated smart-object layer contains both a cached raster and the original artwork bytes via PSD linked-file metadata. The `placedLayer.transform` stores the placement quad, so the layer remains a smart object instead of becoming a permanently flattened raster.

The built-in perspective rasterizer uses inverse projective mapping and bilinear RGBA sampling. This gives non-Photoshop readers a meaningful cache while Photoshop still receives the embedded source and placement metadata.

## Text layers

Text is written as editable Photoshop text metadata and the writer asks Photoshop to re-render it. `ag-psd` text-layer generation is not complete, so Photoshop can show a refresh/update prompt on first open. For pixel-perfect automated typography, a later Photoshop UXP backend can perform the final render.

## Current boundaries

- Portable authoring is RGB PSD, not PSB.
- A Photoshop `warp` beyond the 4-corner projective transform is preserved by the template workflow, but the portable cache only renders the projective part; Photoshop should perform the final warp render.
- Generated composite previews use normal alpha compositing. Layer blend modes/effects remain stored on layers but are not fully reproduced in the flattened convenience preview.
- PSD dimensions are capped at 30,000 × 30,000 and the manifest has a 300 MP guard. Composite and perspective cache generation have an 80 MP memory guard.
- Remote asset URLs are rejected to keep builds deterministic.

## Development

```bash
npm run typecheck
npm test
npm run build
```

CI runs those checks on pushes and pull requests.

## Roadmap

1. Raster/vector masks and clipping-mask manifest syntax
2. Layer effects (drop shadow, stroke, overlays)
3. Displacement-map preview backend
4. Photoshop UXP finalizer for native warp/text cache regeneration
5. Multiple named slot replacement in one command
6. Optional PSB backend for very large documents

## License

MIT
