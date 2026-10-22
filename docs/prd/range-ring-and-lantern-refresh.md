# Mezzo — Range Ring Monitoring Visual and Lantern Visual Refresh

## Product Requirements Document

**Status:** Proposed<br>
**Implementation status:** Not implemented. Nothing in this document describes shipped behavior. `docs/product-experience.md` must not be updated until it ships.<br>
**Milestone:** V2 (polish, consistency, implementation quality). This is a visual and presentation change. It adds no new functionality.<br>
**Product:** Mezzo<br>
**Feature area:** Monitoring visualization, Companion visual system, Home page, design tokens<br>
**Design reference:** Claude design canvas "Mezzo redesign: final" (the explorations live in "Mezzo redesign directions (archive)"). Interactive reference for the ring: `design/prototypes/ring-experiment.html`.

---

## 1. Overview

Mezzo works, but it looks dated and generic, and two things in the current design work against the product itself:

- The Monitoring visual undersells the product. The wave ring is about 150px across in a 382×480 window, and the over-range nudge is low contrast.
- The status label ("Within range", "Outside range"...) changes constantly while someone is talking. A word that keeps changing pulls the eye more than the visual does, which is the opposite of "never distracting."

This PRD proposes, in priority order:

1. **Replace the wave visual with the Range Ring**: a voice circle inside a visible range edge, with a flat chartreuse band outside the edge when the user is over range.
2. **Remove the visible status label** from Monitoring. Keep it as hidden, debounced screen-reader text.
3. **Adopt the "Lantern" visual system** across Home and the Companion: one dark theme, Geist, a small palette with one job per color, sharper buttons.
4. **Make layers obvious**: a clear difference between a screen, a menu, and a decision state.
5. **Consolidate design tokens first**, so the refresh is applied once, not screen by screen.

---

## 2. Problem

### 2.1 The visual doesn't escalate clearly

Mezzo's promise is "Always reassuring. Occasionally attention-grabbing. Never distracting." Today all four zones look similar at a glance: the ring changes shape and color slightly, and the meaning is carried mostly by the label. In peripheral vision, people notice brightness and size much more than shape or text, so the current design relies on the channel people are least likely to perceive.

### 2.2 The label flickers

Zone changes are frequent during normal speech. Each change rewrites the heading text. This was confirmed in the ring experiment (`design/prototypes/ring-experiment.html`), where the visual alone was readable without any label.

### 2.3 Layers are hard to tell apart

The selector panel, decision states (save, replace, delete), and ordinary screens share the same surface color and similar layout. Users can't easily tell whether they are in a menu, a decision, or on the main screen. The new-profile result screen even uses a one-off card that no other screen uses.

### 2.4 The look is inconsistent and token-free

- Home is light cream; the Companion is dark charcoal. Nothing visually links them.
- The homepage hero shows orange wavy rings that don't match what the Companion actually shows.
- Orange is used both for primary buttons and for "Outside range," so the nudge color has two meanings.
- `src/mezzo-session.js` has 100+ hard-coded colors instead of using `design-tokens/mezzo-tokens.css`.

---

## 3. Goals and Non-Goals

### Goals

- A Monitoring visual whose attention level matches the zone: quiet within range, a little attention when approaching, a clear nudge when over.
- No text that changes during monitoring.
- One visual system across Home and the Companion.
- A layer system users can read from the background alone.
- One source of truth for color, type, radius, and spacing.

### Non-goals

- Changing zone classification, thresholds, calibration math, or `OUTSIDE_ENTRY_DWELL_MS` (`src/engine.js` stays the source of truth).
- New features, settings, or controls. User-selectable glow colors and alternative shapes are explicitly out of scope (see §12).
- Changing the decision-state rule. Save, replace, and delete stay full-screen states, never modals.
- Changing canonical copy, except where §6 removes the visible status label.

---

## 4. Visual System ("Lantern")

### 4.1 Theme

One dark theme for both Home and the Companion.

### 4.2 Color roles

Each color has one job. The key rule: **chartreuse is Mezzo's brand color on the website, but inside the Companion it only ever means the over-range nudge.** Chartreuse is a nudge, not a warning: it should never read as an error or alarm.

| Token (proposed) | Value | Website | Companion |
|---|---|---|---|
| `--color-bg` | `#2D2E31` | Background | Screen background |
| `--color-bg-decision` | `#38393C` | | Decision-state background |
| `--color-bg-menu` | `#3C3D40` | | Menu panel |
| `--color-accent` | `#DEDE65` (chartreuse) | Primary button, highlighted words (as text color), text selection | Over-range band and glow only |
| `--color-text` | `#F3EBDE` (cream) | Headings, main text | Headings, primary buttons |
| `--color-link` | `#CEE2C4` (sage) | Small accents | Text links, Approaching edge |
| `--color-text-muted` | `#ABA698` | Body, captions | Labels, hints, profile name |
| `--color-voice` | `#8E897B` | | Voice circle (at 40% opacity at rest) |

Contrast (checked against `#2D2E31`): cream 11.5:1, sage 9.9:1, chartreuse 9.5:1, muted text 5.6:1. Dark text on chartreuse 9.5:1.

This replaces "Mezzo orange" (`--hanko-text` and the `--zone-*-color` tokens). Orange is retired.

### 4.3 Typography

- **Geist** for everything. Headings at weight 500 to 600 with tight letter spacing (about -0.04em); body at 400.
- **Geist Mono**, uppercase with wide tracking, for small labels only.
- Replaces Noto Serif JP and Sora.

### 4.4 Shape

- Buttons and inputs: sharp rectangles, 3px corners. No pill shapes.
- The circle is the only graphic shape. It is used for the hero and the Monitoring visual. No other illustrations.
- Wordmark: lowercase "mezzo", text only.

### 4.5 Buttons

| Kind | Website | Companion |
|---|---|---|
| Primary | Chartreuse fill, dark text | Cream fill, dark text |
| Secondary | 1px cream outline (30%), cream text | Same |
| Text link | Sage | Sage |

The existing 320px max-width cap on full-width Companion buttons stays.

---

## 5. Proposal 1: The Range Ring

### 5.1 Anatomy

- **Range edge**: a circle marking the end of the user's range. Always visible.
- **Voice circle**: a filled circle that grows with the user's smoothed level.
- **Over-range band**: a flat chartreuse ring outside the edge, with a tight glow on its outer edge. Only present when over range.

No center dot. No other decoration.

### 5.2 States

| Zone | Voice circle | Range edge | Band |
|---|---|---|---|
| 0 Listening | Tiny, `--color-voice` at 40% | 1.5px cream at 60%, very faint fill | None |
| 1 Within range | Grows with level, 40% opacity | Same | None |
| 2 Approaching end of range | Solid `--color-voice`, nearly fills the edge | 3px solid sage | None |
| 3 Outside range | Fills the edge | Hidden under the band | Flat chartreuse, grows with how far over |

Attention rises in three steps, each using brightness and size, which work in peripheral vision and don't depend on hue:

1. At rest there is very little to look at.
2. Approaching, the circle brightens and the edge thickens.
3. Over range, the brightest color in the product appears.

### 5.3 Continuous, not stepped

The table describes the look at each zone, but motion should be continuous:

- Voice circle size and opacity follow the smoothed level, not the zone.
- The band's thickness follows how far past the end of range the level is, up to a maximum. Reference values from the design: 11px just over, 20px over, 29px well over, 38px far over, at a 170px edge.
- Growth and shrinking are eased; nothing snaps or flashes.

### 5.4 Timing

- The band appears only when the engine commits zone 3 (after `OUTSIDE_ENTRY_DWELL_MS`, currently 500ms). The visual must not show the band on a raw, uncommitted spike.
- Nothing may flicker at the edge. If the level hovers around the end of range, the band fades rather than toggling.
- Existing sustained-drift behavior (`SUSTAINED_DRIFT_MS`) is reviewed during implementation; it may become band intensity rather than a separate effect.

### 5.5 Sizes

- **Expanded (382×480):** edge about 236px. The ring is centered; the existing responsive tiers still apply.
- **Compact (220×220):** edge about 140px; band and glow scaled down so they don't touch the window edge at maximum.
- Above 382×480 the ring stops growing, as today.

### 5.6 Implementation boundary

- A new renderer replaces `MezzoWaveVisualizer` (`src/wave-visualizer.js`).
- It reads the engine's committed zone and the smoothed level. It never classifies zones itself.
- Rendering can be canvas or CSS; the ring experiment uses canvas. Choose whichever keeps 60fps with no layout work per frame.

---

## 6. Proposal 2: Remove the Visible Status Label

- Monitoring no longer shows "Listening / Within range / Approaching end of range / Outside range" as visible text. The profile name stays at the top.
- The four labels stay canonical as **accessible text**: a visually hidden live region announces zone changes, debounced (proposed: only after a zone has held for about 1 second, and only for changes into or out of Outside range) so it doesn't chatter.
- CLAUDE.md's Canonical Terminology must note that these labels are now screen-reader-only.

---

## 7. Proposal 3: Layers

Three levels, readable from the background alone:

| Level | Used for | Look |
|---|---|---|
| 1. Screen | Welcome, calibration intro, Calibrating, Ready, Monitoring, microphone blocked | Flat `--color-bg` |
| 2. Menu | Ready's profile selector | `--color-bg-menu` panel with 1px border and shadow, attached to its trigger; the screen behind dims (about 60% black scrim); trigger shows an open state |
| 3. Decision | New-profile result, Save profile, Replace / Keep as unsaved, five-profile limit, Delete | Whole window turns `--color-bg-decision`; a 44px header bar names the decision in Geist Mono and holds Cancel in the corner; actions pinned to the bottom |

Decision states stay full-screen, per CLAUDE.md. The one-off card on the new-profile result screen is removed.

---

## 8. Proposal 4: Calibrating

Replace the flat orange meter:

- A 6px sage progress ring with rounded ends, on a faint track, about 130px across. It fills over the six-second capture.
- A large countdown number (about 40px) in the center. No gray fill.
- Copy below: "Talk normally for a few seconds." (new copy, to be confirmed)
- Open question: add a small, faint voice circle inside the ring so users can see the microphone responding (§13).

---

## 9. Proposal 5: Home

Revised 2026-10-22: this replaces the earlier Home spec (the "Be heard without filling the room." hero, the slate ring tile, the benefits list, and the Get started band with its scroll button).

**How the page picks its state.** On load, Home reads `navigator.permissions.query({ name: "microphone" })` and shows one of three states. Without the permissions API it falls back to "prompt". A "granted" result still runs the real acquire/release probe before the granted state shows (unchanged).

| Permission | State shown |
|---|---|
| `prompt` (first visit, or "Allow this time") | The marketing page below |
| `granted` | "You're ready to use Mezzo" |
| `denied` | "Your browser has blocked microphone access" |

**Header (all states).** Unchanged: the lowercase "mezzo" wordmark, Home and Privacy, the thin divider, and the chartreuse underline on the active link. Text selection uses chartreuse with dark text.

### Prompt state

**Hero** (on `--color-bg`, #2D2E31):
- Two columns, both vertically centered: text on the left, the illustration on the right (at most about 620px wide). On mobile they stack, with the illustration below the button.
- Eyebrow: "For headphone calls in shared spaces", in Geist Mono uppercase, muted (#B0AB9E).
- H1, one sentence in two parts: "Focus on the meeting" in cream on its own line, then "while Mezzo minds the volume." in muted with `text-wrap: balance`. 48px on desktop, about 38px at 390px.
- Subhead, muted: "Set a range you're comfortable with. A soft glow nudges you when your voice drifts outside it, before it carries." "soft glow" is chartreuse and never breaks across lines.
- The real "Enable microphone" button: chartreuse with charcoal text and 3px corners. It is the only button on the page.
- Under it, 13px muted: "Mezzo only measures volume. Nothing you say is recorded."
- Illustration: `assets/hero-coworking.svg`, inlined, keeping its `role="img"` and `aria-label`, colors unchanged. Its faded lines use solid premixed colors so crossings don't brighten, and some shapes fill with #2D2E31 to hide lines behind them, so the hero background must stay #2D2E31.

**How it works** (a full-bleed slate #38393C band, `id="how-it-works"`):
- Left: h2 "How it works" and "It takes about a minute. Everything happens in your browser."
- Right: a vertical ordered list with chartreuse Geist Mono numbers and thin dividers.
  1. **Allow your mic.** "Choose "Allow on every visit" to skip this step next time."
  2. **Calibrate in the Companion.** "Talk normally for a few seconds in the floating window. Mezzo sets a range that fits your voice, your mic, and your room."
  3. **Glance at the ring.** "It stays quiet while you talk."
- Under step 03, a row of three chips that wraps on mobile. Each chip has a 36px still Range Ring (aria-hidden), a Geist Mono label, and two words.

  | Chip | Label color | Ring | Text |
  |---|---|---|---|
  | Within range | muted | faint voice circle, thin cream edge | Keep going |
  | Approaching | sage | #8E897B voice circle, 2px sage edge | Getting close |
  | Outside range | chartreuse | #8E897B voice circle, chartreuse band with a small glow | Ease back |

The benefits section and the large ring tiles are removed. Their points now live in the eyebrow, step 02, and the privacy line.

### Granted state

Layout, heading, and the "Open Mezzo Companion" button unchanged. Copy:
- "Microphone access is on. Open the Companion to pick a speaking profile and start monitoring."
- Privacy line: "Mezzo only measures volume. Nothing you say is recorded."

### Denied state

Unchanged. The address-bar chip shows the page's real host (`window.location.host`), never a hard-coded one.

### Dock and unsupported browser

Same type, colors, and buttons; copy unchanged.

---

## 9a. Details That Apply Everywhere

- **Icons:** no ring-style glyphs. Use the wordmark on Welcome, a simple sage dot as a bullet (for example next to the profile name), and a solid circle with a slash for microphone blocked.
- **Focus:** a 2px sage focus ring (`:focus-visible`) on every interactive element, website and Companion.
- **Line breaks:** `text-wrap: balance` on headings and `text-wrap: pretty` on body text, captions, and list items, so lines break evenly with no single-word last lines.
- **Still images** of the ring (marketing, case study) show the voice circle at a mid-conversation size, so a small centered dot never reads as a record button.

---

## 10. Proposal 6: Tokens First

Before any visual change:

1. Define the tokens in §4 in `design-tokens/mezzo-tokens.css` (and `.json`).
2. Replace hard-coded colors in `src/mezzo-session.js`, `landing.css`, and `calibration.css` with tokens, with no visual change yet.
3. Then switch the token values and fonts to Lantern.

This makes the refresh reviewable as small, safe steps and leaves one place to change later.

---

## 11. Requirements

### 11.1 Functional

1. Monitoring renders the Range Ring as in §5. Zone classification is unchanged.
2. The band never appears before the engine commits zone 3.
3. No visible text changes during monitoring.
4. A hidden live region announces state changes per §6.
5. Compact renders the same ring at Compact size; hover/focus-revealed controls are unchanged.
6. Menu and decision states follow §7.
7. Calibrating follows §8.
8. Home follows §9.
9. All colors come from tokens.

### 11.2 Accessibility

- All text meets 4.5:1 (see §4.2).
- States differ in brightness and size, not only hue.
- Respect `prefers-reduced-motion`: replace easing with short crossfades and keep the band static instead of growing smoothly.
- The hidden live region is the only spoken output during monitoring.

---

## 12. Out of Scope (Parked)

- **User-chosen glow color** (a short, curated set of equally bright colors, never red). Possible later.
- **Alternative shapes** (for example a butterfly). Not recommended: harder to read at a glance, and it weakens the ring as the brand mark.
- **Material effects** (neon, glass, metallic). Neon tube was the strongest option if revisited, and only in the over-range band.
- **Microphone indicator on Ready.** Covered by `docs/prd/mic-and-distance-mismatch.md`.

---

## 13. Open Questions

1. **Approaching cue strength.** Is a lighter circle plus a 3px sage edge noticeable enough in real use? Test live.
2. **Band maximum.** At what dB over the end of range should the band reach full thickness? The ring experiment used about +4 dB.
3. **Live-region debounce.** Confirm about 1 second and "into/out of Outside range only" with a screen-reader user if possible.
4. **Sustained drift.** Keep `SUSTAINED_DRIFT_MS` as a separate effect, or fold it into band intensity?
5. **Calibrating.** Confirm "Talk normally for a few seconds," and decide whether to show a small voice circle inside the progress ring.
6. **Website chartreuse buttons.** Confirmed in design; revisit if it ever causes confusion with the in-product nudge.

---

## 14. Acceptance Criteria

- Within range, the only things on the Monitoring screen are the profile name, the faint circle, the range edge, the Compact toggle, and Stop monitoring.
- Approaching, the circle is visibly brighter and the edge is a thick sage line.
- Over range (after the 500ms dwell), the chartreuse band appears and grows with level; a brief spike under the dwell shows no band.
- No visible text changes while talking.
- A screen reader hears state changes no more than about once per second.
- Chartreuse appears in the Companion only in the over-range band.
- Menu, decision, and screen states are distinguishable by background alone.
- `src/mezzo-session.js` contains no hard-coded colors outside the token file.
- `docs/product-experience.md` and CLAUDE.md are updated only when this ships.

---

## 15. Testing

- **Unit (`npm test`):** any new mapping helpers (level to circle size and opacity, overshoot to band thickness) are pure functions with tests. Engine tests unchanged.
- **Playwright (`npm run test:pip`):** update `tests/monitoring-presentation.spec.js` for the removed visible label and the new structure; add checks that the band is absent within range and present after zone 3 commits; verify the live region; verify layer backgrounds on menu and decision states. Follow CLAUDE.md's process-safety rules.
- **Manual:** real voice on real hardware across all four zones in Expanded and Compact; brief emphasis should not show the band; hovering at the edge should not flicker.

---

## 16. Guardrails

Do not:

- Change zone thresholds, smoothing, or `OUTSIDE_ENTRY_DWELL_MS`.
- Use chartreuse for anything in the Companion except the over-range band.
- Show changing text during monitoring.
- Turn decision states into modals.
- Add settings, colors, or shapes for users to choose.
- Edit `docs/product-experience.md` before this ships.
