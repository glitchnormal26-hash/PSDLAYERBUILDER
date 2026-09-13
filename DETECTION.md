# Mockup surface detection

PSDLAYERBUILDER 1.3 adds explainable geometry detection for mockup source photos. The detector is intentionally image-analysis based and deterministic: it does not call a remote model and does not silently invent high-confidence geometry.

## Command

```bash
npm run build
node dist/cli.js detect-surface source.jpg --hint screen --count 3
```

Hints:

- `screen` — laptop, tablet and phone display planes
- `poster` — poster/billboard/sign panels
- `frame` — framed artwork openings
- `page` — magazine, letterhead and paper faces
- `card` — business cards and small print pieces
- `box` — box lids/front panels
- `bag` — tote and packaging bag faces
- `garment` — apparel print zones
- `round-sign` — circular/elliptical sign faces
- `label` / `cylinder` — cans, jars and bottle labels
- `auto` — generic closed editable surfaces

## How candidates are reasoned about

The detector works on a downscaled analysis image and restores all output coordinates to the original image. It generates several low-texture / neutral / tonal segmentation masks, closes small gaps, finds connected closed regions, fits convex hulls and evaluates each region using:

- closed-surface area
- boundary edge support
- interior color/luminance uniformity
- rectangularity or circularity
- image-center prior
- aspect-ratio prior from the semantic hint

Every result contains `confidence`, quantitative `metrics`, and short `reasons`. These are feature explanations, not hidden model chain-of-thought.

## Shape output

Flat surfaces return an 8-value perspective `quad` ordered TL, TR, BR, BL. Elliptical surfaces return a fitted ellipse plus a 48-point polygon suitable for a native vector mask. Cylinder/label candidates return a quad plus a suggested native Photoshop cylinder warp.

The helper `candidateVectorMask()` converts a candidate polygon to a PSDLAYERBUILDER vector-mask spec.

## Native cylinder warp

Smart-object manifest layers can use:

```json
{
  "type": "smart-object",
  "name": "Place your design here (Double click to edit)",
  "source": "design.png",
  "quad": [500, 400, 900, 400, 900, 1000, 500, 1000],
  "nativeWarp": {
    "style": "cylinder",
    "bend": 18,
    "cylinderCurve": 0.59,
    "rotate": "horizontal"
  }
}
```

This writes Photoshop warp metadata in addition to the projective transform. Use the UXP finalizer after replacement so Photoshop refreshes its native raster cache.

## Production rule

Detection is an assistant, not an approval oracle. Any top candidate below confidence 0.50 is explicitly warned. Curved packaging, fabric folds, occlusions and partly hidden surfaces should still be visually reviewed before marketplace delivery.
