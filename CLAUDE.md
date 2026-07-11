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
- `.type-monitoring-within` / `.type-monitoring-outside` — defined but currently unused. The
  monitoring heading (`.mon-heading`) is fixed at 24px across all states (Listening / Within
  Range / Outside of Range) per the monitoring-experience PRD's layout-stability requirement —
  only the text content changes, never the size.
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
`src/engine.js` classifies volume relative to the calibrated baseline into 4 zones (0-3), which
`src/voice-circle.js` renders directly as the ring level (they're the same number — there is
intentionally no ring beyond 3, and no volume tier beyond zone 3 either):
- Zone 0, "Listening" (below ~30% of baseline) → ring-0 (base circle only)
- Zone 1, "Within Range" target (at baseline) → ring-1
- Zone 2, "Within Range" acceptable → ring-2
- Zone 3, "Outside of Range" (open-ended above the acceptable threshold) → ring-3

Exact multipliers live as named constants at the top of `src/engine.js` and are meant to be
tuned there without touching the interaction model.

The circle container is a **constant size** (`--circle-container`) in every state — it never
scales with volume or zone. Only the rings themselves (opacity/visibility, color, drift) and the
pulse animation move; the component's overall footprint must never change.

### Coaching State (Outside of Range)
Mezzo coaches rather than alerts — **the background never changes** while monitoring, and there
is no blinking. The moment volume crosses into "Outside of Range" (zone 3):
- The center circle and all rings recolor from neutral gray to Mezzo orange (`--hanko-fill:
  #C4593A`) via a CSS `filter` on the existing gray brush-stroke art — no colored SVG assets
  exist or are needed. The recolor fades smoothly (~450ms), not an instant snap.
- Rings 1-3 begin a subtle organic drift (~2-4px, slow, independent per ring); the center circle
  (ring-0) always stays fixed.
- If volume stays at zone 3 continuously for **1 second**, drift escalates (larger radius,
  faster, still independent per ring) — this is a pure duration flag owned by `monitoring.js`,
  not a louder-volume zone from `engine.js`.
- Returning to zone ≤2 fades back to gray and settles the drift immediately (the CSS
  transitions provide the smooth "return to center" feel).

## Key Technical Notes
- Volume "range" is based on calibration (user's baseline speaking volume)
- The orange color tint and subtle drift appear immediately on crossing into "Outside of Range"
  (zone 3); drift only escalates after 1 continuous second there, to avoid reacting to brief
  spikes. The background never changes and there is no blinking.
- PiP and webpage monitoring are mutually exclusive — never both at once
- Closing PiP stops monitoring entirely
- Browser mic permissions must be handled gracefully