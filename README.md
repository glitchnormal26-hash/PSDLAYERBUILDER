# PSDLAYERBUILDER

Manifest-driven engine for generating Photoshop PSD mockups with a clean, editable layer tree.

## What it builds

- Nested Photoshop groups
- Raster layers with position, size, opacity, visibility and common blend modes
- Embedded smart-object layers with the original source file stored in the PSD
- Editable text metadata
- Composite preview for apps that do not render PSD layers themselves
- A CLI to build and inspect PSD files

The portable writer uses `ag-psd` 31.0.2. The project intentionally keeps its own manifest model separate from the PSD library so another backend (Photoshop UXP, Rust, cloud worker) can be added later without changing mockup definitions.

## Quick start

```bash
npm install
npm run example
```

The example PSD is written to:

```text
examples/output/basic-mockup.psd
```

Build your own manifest:

```bash
npm run build
node dist/cli.js build path/to/mockup.json -o output/mockup.psd
```

Inspect a PSD layer tree:

```bash
node dist/cli.js inspect output/mockup.psd
```

## Manifest

Layer order is **top to bottom**, matching the Photoshop Layers panel.

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
      "x": 500,
      "y": 350,
      "width": 1000,
      "height": 700
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

Paths in `source` are resolved relative to the manifest file. HTTP/HTTPS sources are deliberately rejected; download assets before building so a build is deterministic.

## Architecture

```text
mockup.json
    │
    ▼
Zod validation
    │
    ▼
Layer compiler ────────┬─ raster cache / preview
    │                  └─ embedded smart-object source
    ▼
ag-psd document model
    │
    ├─ editable layer tree
    ├─ linkedFiles
    └─ composite preview
    │
    ▼
output.psd
```

The manifest is the stable API. `src/engine.ts` is the current portable backend; `src/types.ts` is intentionally backend-neutral.

## Smart objects

For a `smart-object` layer, PSDLAYERBUILDER writes both:

1. a raster preview/cached layer image; and
2. the original source bytes in the PSD linked-file structure with `placedLayer` metadata.

This gives Photoshop an editable embedded source while keeping a useful preview in readers that only understand raster layer data.

## Text layers

Text is written as editable Photoshop text metadata and the writer asks Photoshop to invalidate/re-render text layers. `ag-psd` still has incomplete text-layer generation, so Photoshop can display a refresh/update prompt on first open. For production typography where exact first-open rendering is mandatory, a future Photoshop UXP backend should perform the final text render.

## Current boundaries

- Portable output is RGB PSD; PSB and non-RGB authoring are not part of the current backend.
- The current smart-object preview is axis-aligned. Perspective/warp metadata and Photoshop-quality raster cache generation are planned separately.
- The composite is a convenience preview; it currently flattens image-backed layers with normal alpha compositing and does not attempt to reproduce every Photoshop blend/effect.
- PSD is limited to 30,000 × 30,000 and the manifest adds a 300 MP safety cap to avoid accidental memory exhaustion.

## Development

```bash
npm run typecheck
npm test
npm run build
```

CI runs those checks on every push and pull request.

## Roadmap

1. Perspective quad / warp smart objects
2. Masks and clipping-mask manifest syntax
3. Layer effects (shadow, stroke, overlays)
4. Photoshop UXP finalizer for pixel-perfect text and smart-object cache regeneration
5. PSD-template import + named placeholder replacement
6. Optional PSB backend for very large documents

## License

MIT
