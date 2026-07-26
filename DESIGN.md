# Design system

The tokens in `app/globals.css` are the source of truth. This file explains what
each one is *for*, so the answer to "what size is a heading" or "what colour is a
warning" lives next to the code rather than in a slide deck.

Background and rationale: `plans/plan-design-system.md`.

## The one rule

**Use tokens, never raw palette classes.** `bg-amber-100`, `text-green-600` and
`border-blue-500` are all bugs — not because they look wrong, but because a fund
that white-labels the app still gets amber locks and blue chips. Every colour
must resolve through a CSS variable so `themeCssVars()` (`lib/theme.ts`) can
repoint it.

The app currently carries ~996 raw palette usages across 105 files. They are
being migrated; don't add more.

## Colour

### Neutrals

Warm-tinted, not pure greyscale — paper is `#fdfdfc`, ink is `#1c1a17`. The cast
is under 1% chroma: it reads as considered rather than coloured, and it is the
main thing separating this from a default shadcn install.

| Token | Use |
| --- | --- |
| `--background` | The page. Tinted paper |
| `--foreground` | Body text |
| `--card` | Pure white — cards lift off the paper without needing a border |
| `--muted` / `--muted-foreground` | Secondary surfaces and secondary text |
| `--border` / `--input` | Hairlines. 1.34:1 against paper — visible, not loud |
| `--accent` | shadcn's **subtle hover surface**. NOT the brand accent |

`--accent` keeps its shadcn meaning because renaming it would touch every
`hover:bg-accent` in the app. The brand accent is `--brand`.

### Brand accent — evergreen

Hue 164. Eleven stops, `--brand-50` … `--brand-950`, generated from a fixed
saturation/lightness curve (`RAMP_STOPS` in `lib/theme.ts`). Every stop is
contrast-verified; `lib/theme.test.ts` pins the ramp against the values
hardcoded here so the two cannot drift.

| Role | Stop | Contrast |
| --- | --- | --- |
| Primary CTA fill (light) | `brand-700` `#276353` | white text at 7.05:1 |
| CTA hover / pressed | `brand-800` | |
| Link + accent text on paper | `brand-700` | 6.91:1 |
| Focus ring | `brand-600` | |
| **Dark-mode accent text** | `brand-400` / `brand-500` | 7.06 / 5.14:1 on the dark surface |
| Tinted surfaces | `brand-50` / `brand-100` | |
| Borders on tinted surfaces | `brand-200` | |

Light mode uses 700 for accent text; **dark mode must use 400 or 500** — 700 on
the dark surface is 2.40:1 and fails. Write it as
`text-brand-700 dark:text-brand-400`.

### `--primary` vs `--brand`

Two different jobs, and the distinction is load-bearing:

- **`--primary`** is *this deployment's* action colour. Neutral by default; the
  per-fund theme overrides it. A fund's buttons should be the fund's colour.
- **`--brand`** is *Hemrock's* colour. The marketing site is not under a fund
  theme, so it always renders evergreen.

Inside the app, `themeCssVars()` regenerates the whole `--brand-*` ramp from the
fund's accent hue, so tints and hairlines follow the fund rather than falling
back to evergreen. The fund's chosen value stays the fill — it is **not**
relocated onto stop 700, because amber pushed to 700 is brown.

### Status

Amber is a **warning**, not a brand colour. That is the whole reason a separate
accent exists. Each status token is verified both as text on paper and as a fill
with white text (≥ 4.5:1 either way).

| Token | Meaning | Light |
| --- | --- | --- |
| `--success` | Completed, reconciled, passing | `#1f7a50` |
| `--warning` | Needs attention, locked, beta, stale | `#a56112` |
| `--info` | Neutral notice | `#1f61ad` |
| `--destructive` | Failed, deleting, irreversible | `#bc2424` |

Each has a `-foreground` (text on the fill) and a `-subtle` (tinted background).
Use `bg-warning-subtle text-warning` for a callout, `bg-warning
text-warning-foreground` for a badge.

### Charts

`--chart-1` … `--chart-5` are still the stock shadcn values and unrelated to the
brand. Due a pass of their own — see `plans/plan-design-system.md` §8.

## Typography

**Inter** for everything (`--font-sans`). **Newsreader** for display
(`--font-display`, `font-display` in Tailwind). Newsreader is deliberately absent
from `FONT_OPTIONS` — it is Hemrock's voice, so a fund theme cannot override it.

Named steps, defined in `tailwind.config.ts`. Each carries its own line-height
and tracking, so an eyebrow can't be reassembled wrongly by hand:

| Class | Size | Use |
| --- | --- | --- |
| `text-display` | clamp 42 → 68px | Marketing hero. **Weight 400** |
| `text-title` | clamp 30 → 46px | Marketing section headings. **Weight 400** |
| `text-heading` | clamp 20 → 24px | Sub-headings, prices |
| `text-lede` | 18px / 1.65 | Hero subtitle, section intros |
| `text-label` | 13px | Dense UI labels |
| `text-caption` | 12px | Fine print |
| `text-eyebrow` | 11px / 700 / uppercase / .09em | Section eyebrows |

Tailwind's `text-xs` … `text-2xl` still work and remain correct for dense app UI.

**Display type is light, not bold.** `font-display text-display font-normal`.
Large + light reads as expensive; large + bold reads as a dashboard. Setting a
display heading to `font-semibold` undoes the entire effect.

### Numbers

**Use `tabular-nums`, not `font-mono`.** Column alignment needs tabular figures;
Inter ships them. `font-mono` costs letterform quality and makes money look like
code.

`font-mono` is for content a machine cares about literally: code blocks, IDs,
API keys, OTP inputs.

## Radius

`--radius: 0.25rem` for controls, `--radius-card: 0.5rem` for cards (matching
hemrock.com). Use `rounded-card` for card surfaces, `rounded-lg`/`md`/`sm` for
controls. A per-fund `radius` overrides `--radius` and derives `--radius-card`
one step softer.

## Elevation

Restrained by design. `shadow-sm` on cards; the tinted paper does the separating.
Shadows don't read in dark mode, so pair them: `shadow-sm dark:shadow-none
dark:border`.

## Motion

`--ease-out` (`ease-out-soft`) for most transitions, `--ease-expo` (`ease-expo`)
for larger movements. Keep durations at or under 200ms.

## Layout

| | |
| --- | --- |
| Marketing container | 1100px |
| Prose measure | 640px |
| Marketing section rhythm | 80–112px (`mb-20 md:mb-28`) |

App page widths are not yet settled — see `plans/plan-design-system.md` §6.

---

## Divergences from hemrock.com/brand

The published guide is accurate on colour — its Ink / Paper / Dark / Muted /
Border values match this repo's tokens exactly. It needs these additions to
describe what actually ships:

1. **Typeface.** Already correct (Inter), now also true here — this repo
   previously defaulted to the system stack.
2. **Radius.** Add the `0.25rem` control / `0.5rem` card pair. The guide is
   currently silent.
3. **Tinted neutrals.** Paper is `#fdfdfc` and ink `#1c1a17`, not `#FFFFFF` and
   `#0A0A0A`. The guide's values are the untinted originals.
4. **"Monochrome by design"** needs amending. The *mark* stays monochrome — those
   logo rules are good and unchanged. The *product* now has one accent
   (evergreen) plus a defined status set.
5. **Everything under Typography, Status, Radius, Elevation and Motion above** is
   absent from the guide entirely. That is why nobody used it.
