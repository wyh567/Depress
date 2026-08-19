# `components/ui/` — Broadsheet primitives (T-06)

Presentational primitives translated from the approved Claude Design export
(`D:\depress-ui-handoff\claude-design`, Broadsheet design system) into this
app's own Tailwind v4 pipeline. **Not a copy** of the export's `styles.css`,
`support.js`, `_ds_bundle.js`, or any `.dc.html` markup — those are canvas
tooling, not portable React.

## Status

Everything in this directory is **standalone and currently unused**. Nothing
here is imported by any live screen, so nothing here changes the rendered
application yet. Wiring a primitive into a real component (e.g. replacing
the `<select>` in `compile-controls.tsx` with `SegmentedControl`) is later,
separately-approved slice work — see `.agents/tasks/T-06-production-ui-implementation.md`.

## Rules for using these

- **Take every value from the CSS custom properties in `app/globals.css`**
  (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`,
  `var(--shadow-*)`, `var(--text-*)`). Never hardcode a hex, a font name, or
  a px value the tokens already carry.
- **One accent for interaction.** `--color-accent` (cyan) is the only color
  for focus, selection, citation, and active state. `--color-accent-2`
  (magenta) is the rarer second spot — error / missing-reference states —
  never both accents in one small component.
- **Focus is always the 2px accent ring** at 2px offset
  (`focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]
  focus-visible:outline-offset-2`) — never the browser default.
- **When a primitive replaces an existing live control, it must carry that
  control's existing accessible name** (`aria-label`, `role`, or literal
  text — whichever the test suite already asserts), not the design's
  visible copy where the two differ. See `SegmentedControl`'s `groupProps`
  escape hatch for this.
- **No new component may register a TipTap/ProseMirror schema node or
  mark.** These are pure presentational primitives; the editor schema stays
  exactly `Document, Paragraph, Text, Heading(1–3), Bold, Italic, UndoRedo,
  Citation` regardless of what the toolbar looks like.

## Files

| File | What it is |
|---|---|
| `button.tsx` | `primary` (solid ink fill — one per surface) / `secondary` (outlined) / `ghost` (text-only) / `icon` (square icon-only) |
| `tag.tsx` | Small labels tinted from the ramps: `accent` / `accent-2` / `neutral` / `outline` |
| `field.tsx` | `Field` (label wrapper), `Input`, `Textarea` on native elements — no script |
| `segmented-control.tsx` | A compact option group (publication template, citation style) |

## Font status

`--font-heading` / `--font-body` currently resolve to a serif system-font
fallback stack (`ui-serif, Georgia, "Times New Roman", serif`), **not**
Source Serif 4. No Source Serif 4 binary exists in this repository or in
any already-approved dependency, and per owner instruction this task does
not fetch one from the Google Fonts CDN, unpkg, or any other external
source. See `apps/web/lib/fonts.ts` for the full status note and the
upgrade path once an approved local asset is available.

## Explicitly not done here

- No dark-mode variants — Broadsheet is a single light system.
- No icon set — Phosphor duotone is the design's icon choice; the package
  vs. inline-SVG decision is deferred to whichever later slice first needs
  an icon.
- No `.cmyk` / `.cmyk-num` / `.halftone` print treatments — out of scope
  for this slice.
