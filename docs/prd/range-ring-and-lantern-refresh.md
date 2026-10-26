# Mezzo — Range Ring Monitoring Visual and Lantern Visual Refresh

## Product Requirements Document

**Status:** Implemented<br>
**Implementation status:** Built on the `v3` branch (2026-10). This document describes what ships; each rule that changed during the build carries a *Changed during build* note with the reason. `docs/product-experience.md` describes the current behavior.<br>
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

- Changing how zones are defined beyond §5.3–§5.4 (`src/engine.js` stays the source of truth; the ring never classifies zones itself).
  *Changed during build: zones were tuned with a real voice in the ring tuner; the old rules let normal speech peaks read as Outside range and delayed a loud start.*
- New features, settings, or controls. User-selectable glow colors and alternative shapes are explicitly out of scope (see §12).
- Changing the decision-state rule. Save, replace, and delete stay full-screen states, never modals.
- Changing canonical copy, except where §6 removes the visible status label.

---

## 4. Visual System ("Lantern")

### 4.1 Theme

One dark theme for both Home and the Companion, with one exception: the running page is cream (§9).

*Changed during build: the running page is cream; the dark Companion needs contrast behind it.*

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
| `--color-text-muted` | `#B0AB9E` | Body, captions | Labels, hints, profile name |
| `--color-voice` | `#8E897B` | | Voice circle (at 40% opacity at rest) |

Contrast (checked against `#2D2E31`): cream 11.5:1, sage 9.9:1, chartreuse 9.5:1, muted text 5.9:1. Dark text on chartreuse 9.5:1.

*Changed during build: muted text is `#B0AB9E`, not `#ABA698`, matching the tokens and §8.*

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

Revised 2026-10-22 with values tuned against a real voice in the ring tuner (`design/prototypes/ring-tuner.html`; a frozen public copy lives at `/playground/`). Each value below gives its reason.

### 5.1 Anatomy

- **Range edge**: a circle marking the end of the user's range. Always visible.
- **Voice circle**: a filled circle that follows the user's momentary level.
- **Over-range band**: a flat chartreuse ring outside the edge, with a tight glow on its outer edge. Only present when over range.

No center dot. No other decoration.

### 5.2 States

| Zone | Voice circle | Range edge | Band |
|---|---|---|---|
| 0 Listening | Rests at 20% of the edge, `--color-voice` at 45% | 1.5px `--color-voice` at 45%, very faint fill | None |
| 1 Within range | 45% of the edge at the calibrated level, 55% at the top of Within range; 45% opacity | Same | None |
| 2 Approaching end of range | Grows to 80% at the end of range, opacity rising to solid | 3px solid sage | None |
| 3 Outside range | Fills the edge | Hidden under the band | Flat chartreuse, grows with how far over |

- **Rest edge color:** the edge at rest is `--color-voice` at an opacity (`voice.edgeOpacity`, default 0.45) that can never be higher than the voice circle at rest (`voice.opacityRest`, 0.45). The two values are tied in code, so the edge can never outshine the circle; edge and circle read as one quiet object. The earlier cream edge was the brightest thing on screen at rest.
- **Sizes:** at the calibrated level, the circle sits at 45%, comfortably inside the edge. Before tuning it nearly filled the ring at normal speech and showed the sage edge.

Attention rises in three steps, each using brightness and size, which work in peripheral vision and don't depend on hue:

1. At rest there is very little to look at.
2. Approaching, the circle brightens and the edge thickens.
3. Over range, the brightest color in the product appears.

### 5.3 Where the range comes from

- **End of range = the calibration's 95th-percentile level + 1.5 dB**, saved with the profile as `peakDb` (dB above the speaking level). Rule: speaking at your calibrated level must never trigger Outside range. Average + spread let normal speech peaks cross the line.
- **Safety cap 12 dB.** In peaks mode the end of range never sits higher than this above the speaking level. The old +6/7 dB cap would pull it back below the person's own peaks.
- **Approaching = the last 2 dB before the end of range.** At 1 × spread, ordinary speech regularly showed the sage edge.
- **Listening below −4 × spread.** Wide, so pauses between words don't count as Listening.
- **Fallback** for profiles saved before peaks were recorded: end of range = min(2 × spread, 7 dB). These profiles still work, and Ready suggests recalibrating them.

### 5.4 What the zones read, and timing

- **Zones are judged on a short-term level:** the 60th percentile of the voiced frames in the last 600 ms. A single emphasized syllable covers too little of the window to move it. A sustained change moves it once it covers about 40% of the window, so the zone follows in about 200–250 ms. A mean was tried: one loud syllable could lift it, and a loud start took long to pull it up.
- **Voiced frames only:** frames where the circle's own gate is closed (silence or room noise) are left out, so the silence before someone starts talking doesn't dilute the window and delay a loud start.
- **Raw level for zones:** zones read the raw per-frame level, not `audio.js`'s EMA, which would add 50–150 ms. The EMA is still used for calibration samples.
- **Outside dwell 150 ms, grace 200 ms.** The window already ignores single syllables, so the dwell only bridges the last moments. Only time actually over the line counts toward it. Dips shorter than the grace don't reset the count, and leaving Outside needs 200 ms back under the line, so the band doesn't flicker off between words.
- **No flicker at the edge:** the band grows from a thin ring and shrinks back before fading (grow 150 ms, shrink 150 ms, fade 100 ms).
- Sustained drift (`SUSTAINED_DRIFT_MS`) still only feeds analytics.

*Changed during build: zones were tuned with a real voice in the ring tuner; the old rules let normal speech peaks read as Outside range and delayed a loud start.*

### 5.5 Motion

- **The circle follows the momentary level:** the raw per-frame level, lightly smoothed (100 ms), then eased in linear RMS (rise 150 ms, fall 400 ms) before conversion to dB. Easing in RMS makes a rise read quickly and a fall settle gently.
- **Settle to rest, 1000 ms:** when a gate closes, the circle eases to its rest size over a second, instead of the 400 ms fall used between words. A gate only changes the circle's target, never its displayed size, so nothing snaps.
- **Band:** full thickness (18% of the edge) at 2 dB over the end of range.

### 5.6 Silence and noise

- **Speech-band filter, on:** a 120 Hz high-pass then a 3400 Hz low-pass (the telephone speech band) before the level is measured, for both the circle and the zones. This keeps fan rumble and hiss from moving either. Browser noise suppression stays off, and automatic gain stays off.
- **Silence floor −25 dB:** below 25 dB under the speaking level, the circle rests, with 1.5 dB hysteresis.
- **Room noise:** measured during the calibration's 3-2-1 as the median raw level, and saved with the profile as `roomNoiseDb`. In monitoring, the circle rests unless the level is 4 dB above it.
- **Noisy rooms:** where speech sits less than 12 dB above the room, the margin drops to 2 dB so a soft voice still moves the circle. The result screen then says: "Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic."

### 5.7 Sizes and the default window

- **Monitoring opens in Compact (220×220)**, the peripheral default. The window is freely resizable.
- **Size bands**, by the window's short side and recomputed on resize: Mini under 160, Compact 160 to 299, Expanded 300 and up; edge spacing 8 / 12 / 16px.
- **Ring size:** sized for full Outside range. Its maximum extent (edge plus the band at its widest plus the glow) equals the space between the top row and the bottom row, less twice the edge spacing, and it's centered there. In Mini that space is the whole window.
- **Profile name:** Geist Mono 11px, 0.12em, uppercase, #B0AB9E at every size; visible in every ring state in Compact and Expanded, hidden in Mini.
- **Controls:** 32×32 targets, #B0AB9E icons at full opacity, no boxes.
  - Compact: icon-only Stop bottom left, Expand top right, always visible.
  - Expanded: a labeled "Stop" button styled like the secondary buttons, and a Compact view icon top right.
  - Mini: ring only at rest; Stop and Expand fade in over soft scrims on hover or keyboard focus, and hide 2s after both leave.
  - Hover turns icons cream over a 10% cream square (16% pressed); a tooltip names icon-only controls after about 500ms, never over the ring. Focus gets the sage ring.
  - Stop's accessible name is always "Stop monitoring".
- **What Stop does:** it ends the session, releases the microphone, and returns to Ready with the current profile still selected.
- **No pause:** an earlier Pause/Resume was removed. Stop and Start monitoring cover it, and one control keeps the peripheral window quiet.

*Changed during build: Monitoring opens in Compact instead of Expanded, and Pause was removed; Compact is the peripheral view the product is for, and one control keeps it quiet. Later (2026-10-26): the 60%-of-short-side ring and the 35%-opacity controls were replaced by the size bands above. The ring had to step the name aside at full Outside, and 35% opacity failed the 3:1 contrast minimum for icons.*
- Band and glow are scaled so they never touch the window edge.

### 5.8 Implementation boundary

- `src/range-ring.js` replaces `MezzoWaveVisualizer`. It reads the engine's committed zone and boundaries; it never classifies zones itself.
- DOM and CSS custom properties; no layout work per frame.
- Every tuned value lives in a settings object (`DEFAULT_RING_SETTINGS`, `DEFAULT_ZONE_SETTINGS`, `DEFAULT_AUDIO_SETTINGS`, `DEFAULT_CALIBRATION_RING_SETTINGS`), which the tuner drives live.

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
| 3. Decision | New-profile result, Save profile, Update / Keep temporarily / Discard, five-profile limit, Delete | Whole window turns `--color-bg-decision`; a 44px header bar names the decision in Geist Mono and holds Cancel in the corner; actions pinned to the bottom |

Decision states stay full-screen, per CLAUDE.md. The one-off card on the new-profile result screen is removed.

---

## 8. Proposal 4: Calibrating

Revised 2026-10-22. The user must see live feedback that their voice is being captured, so this replaces the countdown-number version.

Top to bottom, at the shared 380×364 pre-monitoring size (revised again 2026-10-22: a segmented level meter replaces the progress ring and voice circle):

- **Heading:** "Get ready" during the 3-2-1, then "Speak at your meeting volume" while listening. Geist 500, 20px, cream, centered, `text-wrap: balance`. When recalibrating a saved profile, the existing "Recalibrating {name}" mono label stays above it.
- **Level meter**, centered about 52px below the heading:
  - Six segments, 34×14px, 6px gaps, 2px corners. Lit segments are sage (#CEE2C4); unlit ones are cream at 12%.
  - The lit count follows the live, filtered microphone level, eased like the Range Ring (150ms rise, 400ms fall), on the old meter's -55 to -30 dB scale, so normal speech lights about 3–4 segments.
  - It reacts during the 3-2-1 as a mic check, then during the capture.
  - `role="meter"`, `aria-label` "Your voice level", `aria-valuenow` 0–6.
  - Why a meter: it says "your voice is being picked up" without suggesting a target size or a range that doesn't exist yet. The ring and circle looked like Monitoring before there was anything to monitor.
- **The 3-2-1**: only the countdown number (Geist 500, 36px, cream) in the meter's place, with "Stay quiet for a moment…" below; the meter is hidden while the room's noise is measured.
- **Status**, 18px below the meter: "Preparing microphone…" (if acquiring is slow), empty during the 3-2-1, then "Listening… Ns" counting down. Sage, 15px, weight 500, `aria-hidden`. This is the only time cue.
- **Hint**, 6px below: "Stay quiet for a moment…" during the 3-2-1, then "Keep talking until the timer ends." 13px, muted (#B0AB9E).

*Changed during build: the meter showed during the 3-2-1 as a mic check, and the copy said "talk normally"; the 3-2-1 now asks for quiet (it measures the room), and the listening heading names the target: your meeting volume.*
- **Cancel**, a sage text link pinned to the bottom. Behavior unchanged.
- **Room noise** is measured from the 3-2-1's readings (§5.6) and saved with the profile.

The horizontal meter bar, "Background sounds may move the meter too.", the progress ring and the calibrating voice circle are all removed.

*Changed during build: a segmented level meter replaced the filling progress ring, which felt rushed.*

**Accessibility.** The existing live region is kept, with its two one-time announcements ("Stay quiet for a moment. Calibration starts in 3 seconds." and "Listening for 6 seconds."). Nothing is announced every second.

**Reduced motion.** The segments still follow the level, without easing: the meter is the feedback.

**Sizes.** Calibrating always runs at the 380×364 pre-monitoring size; it can't be reached in Compact.

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
  2. **Calibrate in the Companion.** "Speak for a few seconds at the volume you want for your meetings. Mezzo sets a range that fits your voice, your mic, and your room."
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

### Running page (Dock)

While the Companion is open, the page turns cream (`[data-surface="cream"]`, charcoal text): a status line ("Monitoring is not active" / "Monitoring is active", live), "Your Companion is open", "Keep this page open while using Mezzo. Closing it will also close the Mezzo Companion.", and a quiet charcoal **Close Companion** link.

*Changed during build: the running page went back to the original wording and status line after a live Meet test; the privacy line shows only on the closed page.*

*Changed during build: the running page is cream, not dark; the dark Companion needs contrast behind it.*

**Reopen Companion.** Chrome allows one picture-in-picture window at a time, and the newest wins. After any close other than Close Companion (another mini window, or the Companion's own ✕, which look the same), the page stays cream with "The Companion closed", a charcoal **Reopen Companion** button and a **Done** link. Reopen opens it from that click with the same profile (a temporary one too) and resumes monitoring if it was running; Done returns to the granted state.

*Changed during build: Reopen Companion was added because Meet's mini window and screen sharing close the Companion.*

### Unsupported browser

Same type, colors, and buttons; copy unchanged.

---

## 9a. Details That Apply Everywhere

- **Icons:** no ring-style glyphs. Use the wordmark on Welcome, a simple sage dot as a bullet (for example next to the profile name), and a solid circle with a slash for microphone blocked.
- **Focus:** a 2px sage focus ring (`:focus-visible`) on every interactive element, website and Companion.
- **Line breaks:** `text-wrap: balance` on headings and `text-wrap: pretty` on body text, captions, and list items, so lines break evenly with no single-word last lines.
- **Still images** of the ring (marketing, case study) show the voice circle at a mid-conversation size, so a small centered dot never reads as a record button.
- **Sound:** the speech-band filter (120–3400 Hz) is on wherever Mezzo measures a level: calibration, monitoring, and the Home permission probe. Noise suppression and automatic gain are off everywhere.
- **Profiles saved before 2026-10-22** were measured without the filter and have no `peakDb`/`roomNoiseDb`. They're kept and still work, using the spread-based fallback. Ready shows "Made before the new sound filter. Recalibrate" under them, with Recalibrate as an inline link that updates them in place.
- **Playground:** a frozen public copy of the tuner at `/playground/`, with its own module copies, outside the nav. The tuner and playground preview Monitoring only (no Calibrating preview).
- **Welcome:** no "Welcome" heading. The "mezzo" wordmark is the screen's h1, at the top: 30px, Geist 600, letter-spacing -0.045em, cream, lowercase. Body: "A gentle nudge when you're talking louder than you'd like. First, a quick voice calibration." The button and privacy line are unchanged. While Welcome shows, the window's accessible name (its document title) is "Mezzo, welcome."

---

## 9b. Extension

The extension follows the same Lantern look, with no chartreuse (inside the product it's only the Outside range nudge): charcoal surfaces, cream primary buttons, sage text links, Geist and Geist Mono.

**Toolbar popup** (16px padding; heading → 8 → body → 16 → button; Privacy and Settings links in every state, 20px from the bottom). It says what's open, the Mezzo tab or the Companion:

* **No Mezzo tab** — the "mezzo" wordmark (no status chip), "A gentle nudge when you're talking louder than you'd like.", a cream **Open Mezzo** button, and "Opens in its own window." / "Only measures volume."
* **The Mezzo tab is open, no Companion** — a muted "TAB OPEN" chip with an outline dot, "The Mezzo tab is open. Open the Companion from there to start.", and a cream **Go to Mezzo tab** button.
* **The Companion is open, not monitoring** — a sage "COMPANION OPEN" chip with an outline dot, "Your Companion is open, but not monitoring. It floats above your other windows.", and an outline **Go to Mezzo tab** button.
* **Monitoring** — a sage "MONITORING" chip with a solid dot, "Mezzo is monitoring. The Companion floats above your other windows.", and an outline **Go to Mezzo tab** button.

"Go to Mezzo tab" focuses the existing tab without opening, navigating or reloading anything; the popup never tries to open or focus the Companion, since Chrome only opens one from a click in the page and it already floats above other windows. The state comes from the Mezzo tab's own session state (the same source as the running page's status line); without an answer within about 300ms the popup shows "TAB OPEN".

*Changed during build: an earlier popup said only "Mezzo is already open" / "Go to Mezzo", which didn't say whether the page or the Companion was open.*

**In-Meet banner:** one state for every case. A charcoal card with no icon (the text sits on the 16px left padding): "Meeting detected" → 4 → "Monitor with Mezzo?" → 16 → a cream **Open Mezzo** button and a muted **Not now** text button 16px apart, and an X (Dismiss) in the corner. **Open Mezzo** uses the popup's logic: an open Mezzo tab is focused with its window, never reloaded or duplicated; otherwise Mezzo opens in its own window. **Not now** and the X dismiss it for this meeting.

*Changed during build: the banner's ring icon was removed (2026-10-26).* **Toolbar badge:** a cream dot on charcoal when a meeting is detected.

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

1. Monitoring renders the Range Ring as in §5. Zones follow §5.3–§5.4: end of range from calibration peaks, a 600 ms percentile window over voiced frames, and a 150 ms dwell with 200 ms grace.
   *Changed during build: zones were tuned with a real voice in the ring tuner; the old rules let normal speech peaks read as Outside range and delayed a loud start.*
2. The band never appears before the engine commits zone 3.
3. No visible text changes during monitoring.
4. A hidden live region announces state changes per §6.
5. Monitoring opens in Compact (220×220) and renders the same ring at every size; Stop and Expand are revealed on hover or focus. There is no Pause.
   *Changed during build: Compact became the default and Pause was removed (see §5.7).*
6. Menu and decision states follow §7.
7. Calibrating follows §8.
8. Home follows §9.
9. All colors come from tokens.

### 11.2 Accessibility

- All text meets 4.5:1 (see §4.2).
- States differ in brightness and size, not only hue.
- Respect `prefers-reduced-motion`: the voice circle still follows the voice; the band appears at a fixed thickness with only its 100 ms fade, and doesn't grow. The calibrating meter follows the level directly, without easing.
  *Changed during build: the circle keeps following the voice and the band appears without growing, instead of crossfades; the ring is the feedback.*
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
5. **Calibrating.** Resolved 2026-10-22: a six-segment level meter that follows the voice, with "Speak at your meeting volume" / "Keep talking until the timer ends." (§8). It replaced a progress ring with a voice circle inside.
6. **Website chartreuse buttons.** Confirmed in design; revisit if it ever causes confusion with the in-product nudge.

---

## 14. Acceptance Criteria

- Monitoring opens in Compact. Within range, the only things on screen are the profile name, the faint circle and the range edge; Stop and Expand appear on hover or focus. There is no Pause.
  *Changed during build: Compact default, no Pause (see §5.7).*
- Approaching, the circle is visibly brighter and the edge is a thick sage line.
- Over range (after the 150 ms dwell, with 200 ms grace), the chartreuse band appears and grows with level; a single emphasized syllable shows no band, and speaking at the calibrated level never shows it.
  *Changed during build: zones were tuned with a real voice in the ring tuner; the old rules let normal speech peaks read as Outside range and delayed a loud start.*
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

- Change the zone rules in §5.3–§5.4 without re-tuning them against a real voice.
  *Changed during build: zones were tuned with a real voice in the ring tuner; the old rules let normal speech peaks read as Outside range and delayed a loud start.*
- Use chartreuse for anything in the Companion except the over-range band.
- Show changing text during monitoring.
- Turn decision states into modals.
- Add settings, colors, or shapes for users to choose.
- Edit `docs/product-experience.md` before this ships.
