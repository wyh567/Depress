# Source Serif 4 — provenance

Vendored for the T-06 Production UI implementation (Broadsheet design token
work). This directory contains exactly two font files plus this note and
the license — nothing else from the upstream release is included.

## Where these came from

- Repository: `adobe-fonts/source-serif` (official Adobe Type Github org)
- Release: `4.005R` — https://github.com/adobe-fonts/source-serif/releases/tag/4.005R
- Release asset: `source-serif-4.005_WOFF2.zip`
  (https://github.com/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_WOFF2.zip)
- Asset size as published by GitHub: 11,623,196 bytes — the downloaded
  archive matched this exactly.
- Fetched: 2026-08-17, via `curl` directly from `github.com` /
  `objects.githubusercontent.com` (release CDN). No Google Fonts runtime
  CDN, no unpkg, no third-party mirror.

Extracted from the archive's `VAR/` directory:

| File in this directory | Path inside the release zip | SHA-256 |
|---|---|---|
| `SourceSerif4Variable-Roman.ttf.woff2` | `source-serif-4.005_WOFF2/VAR/SourceSerif4Variable-Roman.ttf.woff2` | `940a76eda1388de39d38c8e7a79bf6ea058a387faee0a9f33c8d25c6ba05e1be` |
| `SourceSerif4Variable-Italic.ttf.woff2` | `source-serif-4.005_WOFF2/VAR/SourceSerif4Variable-Italic.ttf.woff2` | `9d28b5749a1ad096a295cb607c521bd1af4cd9979b6f37332daf70143149fb44` |

Both file sizes match the archive's own listing exactly (429,100 and
346,688 bytes respectively) and both carry the WOFF2 magic (`wOF2`).

## Why these two files specifically

The release ships the variable font in two WOFF2 flavors per style: an
`.otf.woff2` (CFF2 outlines, `sfnt` flavor tag `OTTO`) and a `.ttf.woff2`
(TrueType outlines, `sfnt` flavor tag `0x00010000`). Owner instruction
explicitly excluded CFF2 variable OTF assets — confirmed by inspecting each
file's WOFF2 header: both files vendored here report flavor `00010000`
(TrueType), not `4F54544F`/`OTTO` (CFF2). The `.otf.woff2` pair was not
copied into this directory.

This is the minimum file set that reproduces what the approved design
needs: one Roman variable file (covering the full weight axis the design
uses — 400 body, 600 headings) and one true Italic variable file (the
design's readme is explicit that italic must be the font's real italic,
never a synthesized oblique). No static per-weight files were vendored;
the variable axis covers them.

## License

`OFL.txt` in this directory is `SIL Open Font License, Version 1.1`,
fetched from
`https://raw.githubusercontent.com/adobe-fonts/source-serif/4.005R/LICENSE.md`
— pinned to the same `4.005R` tag as the font files, not the (possibly
newer) `main` branch text.

## Status

Vendored only. Not yet loaded by any live page or component — see
`apps/web/lib/fonts.ts` for the `next/font/local` configuration that
reads these two files, and its header comment for the remaining "not
bound to the application yet" scope note.
