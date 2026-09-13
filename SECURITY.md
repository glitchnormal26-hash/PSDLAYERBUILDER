# Security Policy

## Supported version

The current `main` branch and the latest tagged release are supported.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose users to malicious PSDs, unsafe file handling, dependency compromise, or arbitrary code execution. Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available.

Include the affected command or API, a minimal reproduction, expected impact, and any suggested mitigation. Avoid attaching sensitive production artwork or proprietary PSD files; use a minimized synthetic sample when possible.

## Security boundaries

PSDLAYERBUILDER treats manifest files, PSD templates and image assets as untrusted input. Remote asset URLs are rejected by the portable builder. Document dimensions, vector point counts and replacement counts have explicit safety limits to reduce accidental resource exhaustion. The Photoshop UXP finalizer does not request unrestricted local filesystem access.
