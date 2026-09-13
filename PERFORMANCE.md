# Performance guide

PSDLAYERBUILDER 1.1 focuses on predictable CPU, memory and I/O behavior for large mockup pipelines.

## What is optimized

- Layer names, paths and Smart Object link IDs are indexed once for template replacement. Selectors and shared-instance lookups are map-based instead of repeatedly scanning the entire layer tree.
- Replacement artwork is read once per unique file. Metadata is parsed from the same in-memory bytes, avoiding a second filesystem read.
- A replacement artwork is decoded to RGBA at most once per batch artwork group and reused for every projective Smart Object cache that needs it.
- Build metadata and embedded Smart Object bytes are cached per source file during one build.
- Composite-only work is skipped completely when `generateComposite` is false or when the document crosses the 80 MP composite guard. Native masks, vector masks and editable layer metadata are still written.
- The convenience composite uses an opaque-background fast path and no longer allocates a reversed copy of the layer-entry array.
- Existing PSD template layers continue to use raw channel round-tripping, avoiding unnecessary decode/re-encode work.

## Lowest-memory build

For production PSDs that will be opened in Photoshop and do not need the portable flattened preview:

```bash
node dist/cli.js build mockup.json -o output.psd --no-composite
```

This is the preferred mode for very large layered mockups because the editable layer tree is still written while composite-only bitmap copies and vector-mask rasterization are skipped.

## Batch replacement

Prefer one `replace-many` operation instead of repeatedly calling `replace` for the same template. The PSD is parsed and serialized once, and duplicate artwork files share their read/decode work within the batch.

```bash
node dist/cli.js replace-many template.psd --map replacements.json -o final.psd
```

## Production workflow

For highest visual fidelity and best throughput, keep complex Photoshop warp/filter behavior in a Photoshop-authored template, run `replace-many`, then run the UXP finalizer once at the end of the batch.
