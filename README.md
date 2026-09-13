# PSDLAYERBUILDER

Production-grade Node/TypeScript engine for creating and modifying editable Photoshop PSD mockups without flattening the layer structure.

## v1.0 capabilities

- nested Photoshop groups and raster layers
- embedded Smart Objects with original source bytes stored in the PSD
- axis-aligned and 4-corner perspective Smart Object placement
- deterministic **batch Smart Object replacement** with full layer-path selectors
- shared Smart Object instance detection and cache refresh
- native bitmap masks and native polygon vector masks
- native Photoshop clipping-mask flags
- editable layer effects: drop shadow, stroke and color overlay
- displacement-map raster-cache preview
- editable text metadata
- PSD `inspect` and structural `doctor` commands
- atomic template output writes
- optional Photoshop **UXP finalizer** for native Smart Object rerendering
- CI on Node 20, 22 and 24 plus production dependency security audit

The portable PSD backend is `ag-psd` 31.0.2. The manifest API is intentionally backend-neutral so native Photoshop or another writer can be added without changing mockup definitions.

## Quick start

```bash
npm install
npm run example
```

The example writes `examples/output/basic-mockup.psd`.

## Build a PSD from JSON

```bash
npm run build
node dist/cli.js build mockup.json -o output/mockup.psd
```

Example layer:

```json
{
  "type": "smart-object",
  "name": "YOUR DESIGN",
  "source": "assets/design.png",
  "quad": [420, 330, 1570, 380, 1500, 1100, 500, 1040],
  "mask": {
    "source": "assets/product-mask.png",
    "feather": 1.5
  },
  "vectorMask": {
    "feather": 1,
    "paths": [
      {
        "operation": "combine",
        "points": [[450, 350], [1540, 390], [1470, 1070], [510, 1020]]
      }
    ]
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
}
```

Vector-mask coordinates are document-space pixels. Paths support `combine`, `subtract`, `intersect` and `exclude`. Straight polygon points are written as native PSD Bezier knots; Photoshop can edit the resulting vector mask.

## Replace one Smart Object

For a unique layer name:

```bash
node dist/cli.js replace template.psd \
  --layer "YOUR DESIGN" \
  --artwork artwork.png \
  -o output/final.psd
```

For large templates with duplicate names, use an exact layer path:

```bash
node dist/cli.js replace template.psd \
  --path "FRONT/Product/YOUR DESIGN" \
  --artwork front.png \
  -o output/final.psd
```

If `--layer` matches more than one layer, the engine fails rather than silently replacing the wrong Smart Object.

## Batch replacement

Create a replacement map:

```json
{
  "replacements": [
    {
      "path": ["FRONT", "YOUR DESIGN"],
      "artwork": "assets/front.png"
    },
    {
      "path": ["BACK", "YOUR DESIGN"],
      "artwork": "assets/back.png"
    }
  ]
}
```

Then perform every replacement in a single PSD read/write cycle:

```bash
node dist/cli.js replace-many template.psd \
  --map replacements.json \
  -o output/final.psd
```

Artwork paths inside the map are relative to the map file. The engine preflights all targets and artwork before mutating the PSD, rejects conflicting replacements for a shared embedded source, and refreshes every Smart Object instance that shares the replaced source.

## Inspect and validate

```bash
node dist/cli.js inspect output/final.psd
node dist/cli.js doctor output/final.psd
node dist/cli.js doctor output/final.psd --strict
```

`inspect` reports layer paths and key editable features. `doctor` checks Smart Object/link integrity, unsupported transforms, duplicate paths, shared sources and other structural conditions. Errors make the result unhealthy; `--strict` also treats warnings as a failing CLI result.

## Photoshop UXP finalizer

The portable writer deliberately does not pretend to reproduce every Photoshop renderer. For custom warp, Smart Filters, exact text rendering and other Photoshop-native caches, load the plugin in `uxp-finalizer/` with Adobe UXP Developer Tool.

The finalizer uses Photoshop's native renderer to open/save Smart Object contents, attempts Update All Modified Content for linked objects, saves the parent PSD, and reports per-layer failures. Its manifest uses v5 and requests no unrestricted filesystem permission.

Recommended high-fidelity workflow:

```text
Photoshop-authored template.psd
          |
          v
psdlayer replace-many
          |
          v
portable PSD with updated embedded artwork + projective caches
          |
          v
open in Photoshop -> run PSDLAYERBUILDER Finalizer
          |
          v
Photoshop-native warp/filter/text caches -> delivery PSD
```

## Native vs preview behavior

Bitmap masks, vector masks, clipping flags and supported layer effects are stored as editable PSD metadata. The convenience composite generated by the portable builder applies bitmap masks and hard-edged vector polygons, but it does not attempt to emulate all Photoshop blend/effect/clipping behavior. Vector feather is preserved natively but not blurred in the lightweight composite.

For Smart Objects, displacement is cache-only in the portable backend. The embedded source remains editable. If the production template uses Photoshop Displace or another Smart Filter, author that filter in Photoshop and use template replacement + UXP finalization.

## Safety and limits

- remote asset URLs are rejected
- PSD width/height are limited to 30,000 px
- manifest documents are capped at 300 MP
- composite, displacement and perspective-cache work is guarded for very large images
- vector masks are limited to 20,000 points per layer definition
- batch replacement is limited to 1,000 entries
- template writes use a temporary file and atomic rename to avoid leaving a partially written output

## Current format boundaries

The portable backend writes RGB PSD, not PSB. `ag-psd` text authoring remains incomplete, so Photoshop can request a text refresh on first open. Complex Photoshop warp and advanced Smart Filters are preserved by template round-tripping but should be finalized by Photoshop itself.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check:uxp
```

CI runs the suite on Node 20, 22 and 24 and fails on high/critical vulnerabilities in production dependencies. Dependabot is configured for npm and GitHub Actions updates.

## License

MIT
