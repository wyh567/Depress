// Broadsheet type tokens (T-06 Slice 1 + font-closure mini-slice).
//
// Font status: RESOLVED for source, NOT YET BOUND to the application.
//
// The approved visual reference (Claude Design export, Broadsheet system)
// specifies Source Serif 4 for every piece of text, headings and body
// alike, with true italic (never a synthesized oblique). Owner authorized
// exactly one source for this: the official `adobe-fonts/source-serif`
// GitHub repository, release `4.005R`, OFL-1.1. The two files this module
// loads are vendored under `apps/web/app/fonts/source-serif-4/` — see the
// provenance note (`SOURCE.md`) and license (`OFL.txt`) in that directory
// for exactly where they came from, their SHA-256 hashes, and why the
// TrueType-flavored WOFF2 pair was chosen over the CFF2-flavored one
// (owner explicitly excluded CFF2 variable OTF assets).
//
// This uses `next/font/local` against those two local files only —
// no Google Fonts runtime CDN, no unpkg, no external network fetch at
// build or run time.
//
// IMPORTANT — this file defines the loader but nothing in the live
// application imports `sourceSerif4` yet. Per owner instruction this
// font-closure mini-slice does not touch `app/layout.tsx` or any live
// component; binding the font to the rendered app (and updating
// `--font-heading` / `--font-body` in `app/globals.css` away from the
// fallback stack) is separate, later-slice work requiring its own
// approval.
import localFont from "next/font/local";

// Variable font: one file covers the full weight axis the design uses
// (400 body copy, 600 headings) per style. `weight` is expressed as a
// range so next/font/local treats this as a variable font rather than a
// single static weight.
export const sourceSerif4 = localFont({
  src: [
    {
      path: "../app/fonts/source-serif-4/SourceSerif4Variable-Roman.ttf.woff2",
      style: "normal",
      weight: "200 900",
    },
    {
      path: "../app/fonts/source-serif-4/SourceSerif4Variable-Italic.ttf.woff2",
      style: "italic",
      weight: "200 900",
    },
  ],
  variable: "--font-source-serif-4",
  display: "swap",
});

// Fallback stack used by app/globals.css today (`--font-heading` /
// `--font-body`) while the real font above stays unbound. Kept as an
// exported constant, not just a comment, so a later slice that swaps the
// tokens over has a single source of truth for what it's replacing.
export const FALLBACK_SERIF_STACK =
  'ui-serif, Georgia, "Times New Roman", serif';

// Deliberately empty until a later, separately-approved slice binds
// `sourceSerif4` into `app/layout.tsx` — see the file header. Kept as
// exported names (rather than removed) so call sites written against
// them fail loudly (empty className is a no-op) instead of silently
// rendering a substituted typeface.
export const headingFontClassName = "";
export const bodyFontClassName = "";
