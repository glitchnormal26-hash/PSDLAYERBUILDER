# Magnific batch rebuild

PSDLAYERBUILDER 1.4 adds a production batch rebuild pipeline for turning source mockup photos into editable Photoshop PSD/JPG delivery pairs.

## Command

Build the TypeScript project first, then run:

```bash
npm run build
npm run magnific:rebuild -- ./source-images ./magnific-output
```

Or use the installed binary:

```bash
psdlayer-rebuild ./source-images ./magnific-output
```

Optional flags:

```text
--ai
--min-confidence 0.5
--max-analysis-dimension 1600
```

## What the pipeline does

For every supported source image it:

1. Normalizes the source scene to sRGB pixels and keeps the PSD below 5,000 px per axis where possible.
2. Infers semantic mockup intent from the filename and uses explicit multi-slot recipes for common scenes such as stationery, open magazines, gallery frames, device workspaces, takeaway packaging and wine packaging.
3. Runs surface detection with a semantic hint and rejects overlapping candidates when assigning multiple editable slots.
4. Uses perspective quads for flat surfaces, 48-point vector masks for circular signs, and native Photoshop cylinder warp metadata for jars, cans and bottles.
5. Creates embedded Smart Objects named `Place your design here — ... (Double click to edit)`.
6. Extracts a grayscale surface-lighting texture from the original scene and places it as a clipped Soft Light layer above each editable Smart Object.
7. Generates a full-size JPG preview with perspective artwork and the scene lighting reapplied.
8. Writes visual detection overlays into `review/` and records confidence values in `rebuild-report.json`.
9. Runs the Magnific PSD/JPG preflight on every generated pair.

## Output layout

```text
magnific-output/
  delivery/
    example.psd
    example.jpg
  manifests/
    example.mockup.json
  review/
    example-detection.jpg
  rebuild-report.json
```

Only the same-name PSD/JPG pairs in `delivery/` are intended as contributor delivery files. Manifests and detection overlays are review/support artifacts.

## Review gates

Automatic geometry is intentionally confidence-scored. A candidate below the configured confidence threshold is still built so it can be inspected, but the report contains a warning and the detection overlay must be reviewed before submission.

The rebuild pipeline cannot establish copyright, trademark, stock-license redistribution rights, font licensing, AI provenance, or subjective visual quality. Those remain manual contributor checks even when automatic technical preflight passes.
