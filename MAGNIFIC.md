# Magnific Contributor preflight

PSDLAYERBUILDER includes an opinionated preflight for PSD/JPG pairs intended for Magnific Contributor submission.

The checks are based on the contributor requirements supplied for this project. Marketplace rules can change, so always compare the final result with the current Magnific contributor documentation before upload.

## Single pair

```bash
npm run build
node dist/cli.js magnific-check product-mockup.psd \
  --preview product-mockup.jpg \
  --type mockup
```

Supported types:

- `mockup`
- `template`
- `graphic-elements`

For a resource containing AI-generated material:

```bash
node dist/cli.js magnific-check product-mockup.psd \
  --preview product-mockup.jpg \
  --type mockup \
  --ai
```

Use `--strict` to make warnings fail the CLI command as well as hard failures.

## Batch directory

Put matching `.psd` and `.jpg` pairs in one directory, with identical base names:

```text
minimal-poster.psd
minimal-poster.jpg
coffee-bag.psd
coffee-bag.jpg
```

Then run:

```bash
node dist/cli.js magnific-batch ./delivery --type mockup
```

The batch command rejects a PSD with no same-name JPG preview.

## Automatically checked

The preflight checks:

- identical PSD/JPG base names
- `.psd` and `.jpg` delivery extensions
- PSD file size 1.5 MB to 250 MB
- JPG file size 0.5 MB to 80 MB
- JPG width and height in the 2,000-10,000 px range
- mockup / graphic-elements PSD dimensions above 1,000 px and below 5,000 px
- RGB for mockup / graphic elements and CMYK for templates
- 150-300 dpi metadata for templates
- explicitly untagged ICC profile flag when exposed by the PSD parser
- unnamed/default layer names
- at least one Smart Object for mockups
- embedded Smart Object source integrity / external-source dependency
- a clear replacement-oriented Smart Object layer name
- no editable text layers for Graphic Elements submissions

## Manual review remains mandatory

Some contributor requirements are semantic/legal and cannot be reliably decided from PSD structure alone. The command reports these as `manual` checks instead of pretending they are machine-verifiable:

- exact ICC profile identity (for example sRGB or Coated FOGRA 27)
- Photoshop CC open/save compatibility
- whether example photos are excluded from the PSD and IMAGE NOT INCLUDED is displayed where required
- brand, logo, trademark, signature, watermark and QR-code review
- originality, copyright and commercial-use rights
- font licensing and typography quality
- visual quality of perspective/masking and whether the preview demonstrates the mockup function
- AI declaration and visual artifact review
- submission title and keywords

## Recommended Smart Object label

For mockups, use a clear English name such as:

```text
Place your design here (Double click to edit)
```

A submission should not be considered marketplace-ready merely because the preflight returns `ok: true`; all `manual` items still require human review.
