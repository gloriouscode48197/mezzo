# Mezzo

Mezzo is a web-based voice volume monitoring tool that helps users practice mindful speaking volume. Users calibrate their natural voice, then Mezzo monitors their volume in real time and gently alerts them when they're too loud for a sustained period.

## Tech Stack
- HTML, CSS, JavaScript (vanilla — no frameworks unless already in use)
- Web Audio API for microphone input and volume analysis (ALREADY IMPLEMENTED — see existing code)
- Picture-in-Picture API for pop-out monitoring
- SVG-based voice visualization using pre-made brush-stroke assets

## Existing Code
- The sound/volume detection algorithm is already built. Do NOT rewrite it.
- Review the existing codebase before making changes to understand what's already in place.
- Build new UI features on top of the existing sound infrastructure.

## Design Tokens
- **CSS tokens:** `/design/mezzo-tokens.css` — import this file. It contains all CSS custom properties, typography classes, and component styles. USE THESE — do not hardcode colors, fonts, or spacing.
- **JSON tokens:** `/design/mezzo-tokens.json` — same values in JSON format if needed for JS.
- **Fonts:** Noto Serif JP (display) and Sora (body) — load from Google Fonts.

### Surface Themes
The token file defines three surface themes via `data-surface` attributes:
- `data-surface="light"` — default state (light background #F0EBE2)
- `data-surface="dark"` — alert/inverted state (dark background #111111)
- `data-surface="mid"` — mid-dark (#3A3A3A, used if needed)

Switch surfaces by changing the `data-surface` attribute on the container element. All child colors automatically update via CSS custom properties.

### Pre-built Typography Classes
Use these directly — don't create your own font styles:
- `.type-hero-heading` — large page titles
- `.type-section-heading` — section titles
- `.type-monitoring-within` — "Within range" heading (24px)
- `.type-monitoring-outside` — "Outside range" heading (41px, larger to grab attention)
- `.type-hero-body` — large body text
- `.type-body` — default body text
- `.type-microcopy` — small helper text
- `.type-tag` — uppercase label tags
- `.type-state-label` — tiny state indicators
- See mezzo-tokens.css for the full list.

### Pre-built Component Classes
- `.btn-primary` — filled CTA button (hanko red)
- `.btn-outline` — outlined secondary button
- `.btn-stop` — stop/action button
- `.pip-pill` — PiP-related pill button

### Circle Sizing Tokens
These control the voice feedback circle at different states:
- `--circle-container: 280px` — max container size
- `--circle-silence: 45px` — when quiet
- `--circle-within: 90px` — within range
- `--circle-elevated: 160px` — elevated volume
- `--circle-sustained: 240px` — sustained loud volume

### Key Colors
- Accent (hanko): `--hanko-fill: #C4593A` (terracotta red)
- Light surface: `--surface: #F0EBE2` (warm off-white)
- Dark surface: `--surface: #111111`

## Design Reference
- Screenshots: `/design/screenshots/`
- SVG assets: `/design/assets/`
- Icons: `microphone-icon.svg`, `pip-icon.svg`
- Match the Figma screenshots as closely as possible

## SVG Circle Asset System (IMPORTANT)

### Naming Convention
`{theme}-bg-circle-ring-{ringCount}-{variant}.svg`

- **theme**: `light` (default) or `dark` (alert state)
- **ringCount**: `0`–`3` (number of outer rings)
- **variant**: `0`, `1`, or `2` — three hand-drawn variations per ring count

### How Variant Cycling Works
Each ring level has 3 SVG variants that are subtly different hand-drawn versions. To create organic, living movement:
- Slowly crossfade between the 3 variants on a loop (every 2-3 seconds)
- This makes the brush strokes appear to shift and breathe
- Combine with a gentle CSS scale pulse

### Ring Level Selection
Based on volume relative to calibrated baseline:
- At or below baseline → ring-0 (base circle only)
- Slightly above → ring-1
- Moderately above → ring-2
- Far above → ring-3
- Divide the above-baseline range into 3 roughly equal zones

You can also use the circle sizing tokens to scale the SVG container:
- Quiet → `--circle-silence` or `--circle-within`
- Elevated → `--circle-elevated`
- Sustained → `--circle-sustained`

### Alert State
When outside range for 5+ seconds:
- Switch from `light-bg` → `dark-bg` SVG assets
- Switch surface theme from `data-surface="light"` → `data-surface="dark"`
- Speed up pulsation
- All colors update automatically via CSS custom properties

## Key Technical Notes
- Volume "range" is based on calibration (user's baseline speaking volume)
- Outside-range alerts only trigger after 5+ continuous seconds of loud volume
- PiP and webpage monitoring are mutually exclusive — never both at once
- Closing PiP stops monitoring entirely
- Browser mic permissions must be handled gracefully