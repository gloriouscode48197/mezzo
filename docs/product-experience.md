# Mezzo Product Experience

**Version:** V2
**Status:** Canonical Product Experience

---

# Purpose

This document describes Mezzo from the user's perspective.

It is the canonical reference for the experience users should have when interacting with Mezzo.

Where `CLAUDE.md` defines the product's philosophy, terminology, architectural boundaries, and decision-making principles, this document defines how those principles are expressed through the user experience.

If implementation conflicts with this document, first align on the intended experience before changing the implementation.

---

# Product Summary

Mezzo is a privacy-first voice awareness tool that helps people become more aware of their speaking volume during meetings.

It does not record speech.

It does not transcribe conversations.

It does not analyze conversation content.

It provides gentle, real-time visual awareness relative to the user's own calibrated speaking profile.

Mezzo is intentionally calm.

It should support the conversation without becoming part of it.

---

# North Star

A successful experience with Mezzo feels almost invisible.

The user opens Mezzo, starts monitoring, keeps the Mezzo Companion beside the meeting, and notices it only when needed.

The experience should increase awareness without creating interruption, anxiety, or embarrassment.

---

# Product Mental Model

From the user's perspective there are only two named product experiences.

## Mezzo

Mezzo is Picture-in-Picture–first: the Mezzo Companion is the one operational surface. Mezzo (the browser page) is not part of that operational workflow — it has exactly two narrow jobs, depending on whether a Companion exists yet:

* **Before a Companion exists:** introduce the product, and — as one narrow, deliberate exception — prepare and request microphone access (see "Learn About Mezzo," below, and CLAUDE.md's Non-Negotiable Decisions, "permission should follow understanding"). Still no profile selection and no calibration; its one operational action beyond the permission gate itself is opening the Mezzo Companion.
* **While a Companion is open:** stay open to keep the Companion running, say whether monitoring is active, and offer one recovery action (Close Companion) for when the Companion's own native ✕ isn't reachable. If the Companion closes without the user asking this page to close it (another picture-in-picture window replaced it, or its own ✕), it offers to reopen it.

Every other responsibility that used to live here — preparing for monitoring, selecting/calibrating/recalibrating a profile, managing the saved-profile library, managing an active session, recovering monitoring — now belongs to the Mezzo Companion alone. Users may still move between these two states of the same page, but they should never feel like they're doing anything there beyond "get me to the Companion" and "I can see it's running."

---

## Mezzo Companion

The Mezzo Companion is the small always-on-top monitoring window displayed beside the user's meeting.

It is the primary monitoring experience — and now the *only* operational one. Every decision a user makes about their voice — calibrate, recalibrate, pick a profile, delete one, start monitoring, stop — happens here.

It provides:

* live visualization
* ambient awareness
* monitoring state
* profile selection and management
* calibration and recalibration
* lightweight session controls when appropriate

There is only one Companion.

Users should never encounter additional concepts such as:

* Companion Window
* Floating Companion
* Control Room
* Control Page
* Bring Companion to Front
* Pop Out

Those distinctions exist only within the implementation.

---

# Supporting Experiences

These experiences support Mezzo but are not separate products.

## Marketing / Onboarding

One page, one implementation (`index.html`) — not two separate experiences handing off to each other. Before the Companion exists, this page is doing both jobs at once:

Marketing purpose:

* introduce Mezzo
* explain its purpose
* establish trust
* communicate privacy
* encourage users to try the product

Onboarding purpose: reduce uncertainty about *what Mezzo is*, then hand off to the Mezzo Companion. It no longer introduces Speaking Profiles or supports calibration — none of that happens here. It does, however, explain microphone access and request it — the one deliberate exception to "everything operational lives in the Companion" (see "Learn About Mezzo," below, and CLAUDE.md's Non-Negotiable Decisions).

This page reflects the browser's *current* microphone-permission state — never first-time-vs-returning visit history, and never a persisted "have I seen this before" flag. Depending on that live state (`navigator.permissions.query`, falling back to "prompt"), it shows one of three things:

* **prompt** (first visit, or "Allow this time"): the marketing page. A two-column hero ("For headphone calls in shared spaces" / "Focus on the meeting while Mezzo minds the volume." with the coworking illustration) holding **Enable microphone**, the page's only button, and the privacy line "Mezzo only measures volume. Nothing you say is recorded."; then **How it works**, a centered column of three numbered steps (Allow your mic, Calibrate in the Companion, Glance at the ring) with three still ring chips (Within range, Approaching, Outside range).
* **granted:** "You're ready to use Mezzo", "Microphone access is on. Open the Companion to pick a speaking profile and start monitoring.", and a separate **Open Mezzo Companion** action.
* **denied:** "Your browser has blocked microphone access", with the site-controls guidance and the page's real host in an address-bar illustration.

A fourth, **running**, replaces all three while the Companion is open (see "Dock," below). Granting access and opening the Companion are always two separate, deliberate clicks — never chained into one, so opening the Companion always has its own fresh user gesture (see "Calibration," below, for why this matters). There is no separate "Try Mezzo" step or intermediate launcher screen between the marketing content and the Companion opening — just this permission gate, resolved before the Companion ever exists.

The experience should feel:

* calm
* spacious
* approachable

It uses the Lantern visual system (dark charcoal surface, Geist type, chartreuse primary actions); the running state is the website's one cream surface.

---

## Dock

Internal term only (retired name: Anchor page) — see Canonical Terminology in `CLAUDE.md`. It is the same browser page as Marketing/Onboarding, before a Companion exists; once a Companion is open, it becomes the **running** state: a minimal surface that must stay open to keep the Companion running.

The running state (cream surface, charcoal text, the website's one light theme):

* a status line (Geist Mono, small, with a dot): "Monitoring is not active" until monitoring starts, then "Monitoring is active", updating live — the only thing on the page that changes, announced to screen readers when it does
* "Your Companion is open"
* "Keep this page open while using Mezzo. Closing it will also close the Mezzo Companion."
* **Close Companion**, a quiet text link: the recovery action for a Companion buried behind other windows — the one thing this page is allowed to do

The status line collapses the Companion's states to one distinction: Welcome, Ready, Calibrating and every decision screen all read "not active." No calibration UI, no profile UI, no Start monitoring, no Stop, no Save.

**Reopen Companion.** Chrome allows one picture-in-picture window at a time, and the newest wins: Meet's mini window (opened manually, or automatically on a tab switch or screen share) closes the Companion. When the Companion closes in any way other than this page's Close Companion link — which includes its own native ✕, since the two look the same from inside — the page stays on the cream surface with "The Companion closed", a **Reopen Companion** button and a **Done** link. Reopen opens it again from that click with the same profile (an unsaved one included, still in memory only), and resumes monitoring if it was running. Done returns to the granted page. That page keeps the privacy line, "Mezzo only measures volume. Nothing you say is recorded."

The Mezzo Companion, not the Dock, is meant to stay available across an entire meeting-filled day — monitoring starts and stops independently inside it, session by session, without the Companion needing to reopen.

User-facing copy never names this page — it says things like "Your Companion is open in its own window."

---

# Experience Goals

Every experience should reinforce:

* calm
* trust
* restraint
* privacy
* clarity
* peripheral awareness

Users should always understand:

* what Mezzo is doing
* why it is doing it
* what they can do next

The interface should describe the current situation rather than instructing users how to behave.

---

# First-Time User Journey

The intended first-run experience is:

Marketing Website — introduces Mezzo and doubles as Onboarding; there is no separate "Try Mezzo" step or second page to click through to first (see "Marketing / Onboarding")

↓

Enable microphone — this page explains why access is needed, then this action is the actual moment microphone permission is requested (see "Learn About Mezzo")

↓

Permission granted — a brief confirmation, with its own separate **Open Mezzo Companion** action; opening the Companion is never chained onto the permission grant itself

↓

Open Mezzo Companion — does not choose anything on the user's behalf, and opens the Companion directly rather than navigating anywhere

↓

Mezzo Companion opens, showing Welcome — a first-time-only moment, not an instant calibration redirect (see "Companion States → Welcome")

↓

Create speaking profile — Welcome's one action; opens the calibration-introduction screen (C1). Microphone access is already granted by this point, so nothing is requested again here.

↓

I'm ready, from C1 — begins capture; the microphone was already granted back on the marketing page, so this resolves silently, with no second prompt

↓

Active calibration — a 3-2-1, then six seconds of listening, with a live six-segment level meter; no manual "I'm done" action (see "Calibration")

↓

"Your new speaking profile is ready" — Save speaking profile, Keep temporarily, or Discard (see "Calibration → On Completion")

↓

Ready, with the new profile selected — "Ready for your first conversation" (see "Profile Model → Saving and Updating")

↓

Start monitoring

↓

Monitoring — using the unsaved profile, or a newly saved one

↓

Meeting

↓

Stop (inside the Companion) — returns directly to Ready. If the profile in use was still unsaved, it simply stays selected and available there, still unsaved, exactly as it was before Stop was pressed — nothing forces a save decision before the user can do anything else.

↓

Companion Ready (still open — start again, save the unsaved profile, switch profiles, recalibrate, or close)

↓

Close the Dock, or close the Companion natively, to end the session

---

## Learn About Mezzo

Before the browser ever shows its own microphone-permission prompt, users should understand, from the introductory page itself:

* what Mezzo does
* what Mezzo does not do
* that monitoring begins only when they choose
* why microphone access is needed
* that audio is processed locally, never recorded, never transcribed, and never stored or sent elsewhere

This page is where microphone access is now explained *and* requested — the one narrow, deliberate exception to "the Companion is the sole operational surface" (see CLAUDE.md's Non-Negotiable Decisions, "permission should follow understanding," and "Marketing / Onboarding" above for the three permission-state screens this produces). The principle behind moving it here: a first-time user should never see the browser's raw permission prompt with no context, and — separately — microphone permission cannot be reliably requested from within the Mezzo Companion's own Picture-in-Picture window, so asking here rather than there isn't only a trust choice, it's the only reliable one.

This page reflects the browser's *current* permission state, not visit history — a returning user whose browser already grants access sees the brief confirmation screen directly, with no re-explanation forced on them, exactly as they'd expect from a page that's just checking, not re-litigating.

Privacy messaging should be specific, calm, and verifiable.

---

## Calibration

Calibration should feel like preparation.

It should never imply that there is one objectively correct speaking volume.

Microphone permission is requested exactly once per browser, on Home's own Enable microphone action, before the Companion ever opens — never inside the Companion itself, and never chained onto the click that opens it (see "Learn About Mezzo"). By the time capture actually begins, permission has normally already been granted, so the Companion's own acquire attempt resolves silently. The one exception is access being revoked after the Companion has already opened — see "Companion States → Microphone Access Blocked" for that narrower, defensive case.

### Calibration Entry

Reaching capture always starts with a short instructional step (C1) first, except when recalibrating a profile that already exists:

* **First-time calibration** — Welcome's Create speaking profile — goes through C1 first.
* **Create new profile**, from a saved-profile Ready state — also goes through C1 first: it's creating a brand-new profile from scratch, so the brief instructional step stays useful.
* **Recalibrate**, on a saved or unsaved profile — skips C1 and begins capture immediately. Recalibrating is a faster, repeat action for someone who has already been through calibration before, so the instructional step isn't needed again.

C1 ("Create speaking profile" / "Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain.") explains, briefly, what the user should do before capture starts — not why microphone access is needed, which Home already covered before the Companion opened. Its one action, "I'm ready," begins capture; microphone permission is normally already granted by this point, so this resolves silently rather than prompting again. A **Cancel** text link returns to wherever C1 was opened from (Welcome, or the same Ready state, with its selection and any existing temporary profile left untouched) without starting calibration or changing any profile.

### Active Calibration

Calibrating's heading follows the phase — "Get ready" through the 3-2-1, then "Speak at your meeting volume" while listening (with a "Recalibrating {name}" label above it when recalibrating a saved profile). The heading stays put at the top; below it, centered above Cancel, one slot shows the 3-2-1 number and then "Listening… Ns", with the six-segment level meter and a hint beneath:

* **3-2-1** — only the countdown number, in the meter's place, and "Stay quiet for a moment…": the room's own noise level is measured from these readings and saved with the profile, so silence helps. The meter stays hidden.
* **Listening, six seconds** — the meter appears; "Listening… Ns", counting down / "Keep talking until the timer ends." The meter's lit segments follow the live, filtered microphone level, so the user can see their voice being picked up without being shown a target. It completes automatically; there is no manual "I'm done" action.
* **Cancel** stops capture, discards the partial samples, and returns to where calibration started.

Two one-time screen-reader announcements mark the start of each phase; nothing is announced every second. With reduced motion, the segments follow the level directly, without easing. Exact sizes and values: `docs/prd/range-ring-and-lantern-refresh.md` §8.

If microphone access is blocked or denied at this point — access must have been revoked after the Companion already opened, since Home's own permission gate already ensured it was granted before the Companion could open at all — calibration cannot continue: a dedicated recovery screen explains what happened and how to fix it (see "Companion States → Microphone Access Blocked"), with an in-app Try again rather than requiring a manual page reload.

### On Completion

A brief processing moment — "Saving your calibration…" when recalibrating a saved profile, otherwise "Creating your speaking profile…", with a spinner where the countdown was and no Cancel — then a decision screen whose actions depend on why calibration was run. If speech sat less than 12 dB above the room's own noise, either screen also says: "Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic."

**A new profile** (Create speaking profile, Create new profile, or Recalibrate on the temporary profile) shows "Your new speaking profile is ready" / "What would you like to do with it?":

* **Save speaking profile** — opens the naming screen (see "Profile Model → Saving and Updating")
* **Keep temporarily** — keeps it as the temporary profile, selected on Ready ("Available until you close the Companion")
* **Discard** — throws it away and restores the previous selection (or Welcome, if nothing else exists)

**Recalibrate, on a saved profile**, does not touch that profile yet. It shows "New calibration ready" / "Save it to “{name}”?", with:

* **Update “{name}”** — overwrites the saved profile's calibration in place, keeping its name and identity, and returns to Ready with it selected
* **Keep temporarily** — leaves the saved profile completely untouched, and keeps the new calibration as the temporary profile instead, selected on return
* **Discard** — leaves everything as it was

Nothing is written to a saved profile merely by entering calibration or by capture completing — only Update does that, and only for the one profile Recalibrate was started from. There is no path from a session-only calibration to silently replacing a saved profile — only to explicitly doing so, visibly, by name (see "Profile Model → Saving and Updating").

---

## Start Monitoring

There is exactly one Start monitoring, reachable only from the Companion's own Ready screen — first session of the day and every one after are the identical action; there is no separate, page-driven "first session" variant anymore.

When the Companion is in its Ready state, show, always in this order:

1. Ready heading — see "Ready Heading" below
2. "Speaking profile" label
3. A collapsed selector trigger, showing the currently selected profile's name (or "Unsaved profile")
4. A contextual line for that selection: **Save profile** for the temporary profile; for a saved profile, nothing — or "Made before the new sound filter. Recalibrate" when it was saved before calibration peaks were recorded — **Recalibrate** there is an inline link that recalibrates that profile (see "Profile Model")
5. Start monitoring
6. A privacy disclaimer

This order never changes — selecting a different profile updates the selector's contents and the contextual actions beneath it, but never restructures the screen around them. The selector itself expands into an overlay panel rather than an anchored dropdown (see "Companion States → Ready").

Selecting Start monitoring should:

* start the monitoring session, with whichever profile is selected, as-is
* lock profile selection
* transition the Companion into its Monitoring state, in Compact (see "Compact Companion")

Selecting Recalibrate or Create new profile (both in the selector panel) should transition the Companion into calibration (see "Calibration" above) — not directly into Monitoring.

Monitoring should never begin automatically on its own, without this explicit action. This lets the user start monitoring sessions, recalibrate a profile, or run a fresh calibration, at any point in the day, entirely inside the Companion — Mezzo (Home/Dock) is never involved in any of these decisions.

## Ready Heading

"Ready for your first conversation" appears only right after first setup: monitoring has never started (a one-way, persisted condition that survives Companion restarts) and no profile has been saved yet. Every other time — any saved profile, or once monitoring has started — Ready reads "Ready when you are." The "Speaking profile" eyebrow above the selector has no colon.

## Deferred: Post-Session Acknowledgment

A rotating, varied acknowledgment message on returning to Ready after a session (something warmer than the plain heading alone) is approved conceptually, but is not part of the current experience. It has not been designed, and no layout space is reserved for it. Treat it as a future Ready-state enhancement, not a gap in what's described above.

---

# Returning User Journey

Returning users should experience as little friction as possible.

The intended flow is:

Open Mezzo Companion (from Home — the one action; it does not choose a profile itself)

↓

Mezzo Companion opens, showing Ready — previously used saved profile is selected and visible; a temporary profile that was never saved does not persist across visits and is never what's restored here (only **Reopen Companion**, after an involuntary close, brings one back — see "Recovery → Mezzo Companion Closed")

↓

Start monitoring (as-is), or Recalibrate first if the environment has changed

↓

Monitoring

↓

Meeting

↓

Stop (inside the Companion)

↓

Companion Ready (still open — start again, switch profiles, recalibrate, or close)

↓

Close the Dock, or close the Companion natively, to end the session

Returning users should not repeat onboarding unless required.

If no saved profile exists yet — including when the last session used an unsaved profile that was never saved — the Companion opens to Welcome (zero saved profiles, and no unsaved profile carried over — see "Profile Model") instead of Ready, and guides the user through Create speaking profile before monitoring begins.

---

# Meeting Prompt Journey

When a supported meeting is detected, the extension shows a small banner at the top of the meeting page: "Meeting detected" / "Monitor with Mezzo?", with **Open Mezzo** and **Not now** (and a close control). It uses the Lantern look of the extension popup: a charcoal card, the chartreuse ring, a chartreuse button, a sage link.

Selecting Open Mezzo should:

* open Mezzo
* restore the previous profile when possible
* allow the user to review their setup — now inside the Companion's own Ready screen, not on Home, since Home no longer shows profile information
* require an explicit Start monitoring action

Do not imply that monitoring begins directly from the meeting prompt.

The user should always begin monitoring intentionally.

Today, "Open Mezzo" opens Mezzo in its own Chrome window, in front and focused (or brings the existing one forward) — a normal window with an address bar, about 800×720, lined up with the meeting window's right edge and kept fully on screen — on Home; the user still clicks Open Mezzo Companion there, since Chrome only opens a Companion from a click inside the Mezzo page. It's a separate window rather than a tab next to the meeting, since switching tabs can trigger Meet's mini window; and it keeps the address bar, since its site controls are how someone fixes a blocked microphone. There is never a second Mezzo: both the toolbar popup and the meeting banner find Mezzo's Home in any tab of any window (matching the site's address, not only the window the extension made) and bring that one forward instead.

## Extension Popup

The toolbar popup has three states, decided by where Mezzo's Home is open (any tab, any window):

* **Not open** — the "mezzo" wordmark, "A gentle nudge when you're talking louder than you'd like.", an **Open Mezzo** button, "Opens in its own window. Only measures volume.", and Privacy and Settings links.
* **The tab in front** (the active tab of the focused window) — the wordmark with an "Open" label and "You're on Mezzo." No button.
* **Open elsewhere** — the wordmark with an "Open" label, "Mezzo is already open.", and **Go to Mezzo**, which focuses that window (restoring it if minimized) and activates that tab.

It never shows profile or monitoring state. In a locally loaded (developer) copy only, Settings has a Mezzo address field, so the extension can open a preview deployment instead of the live site. The toolbar badge marks a detected meeting in charcoal and chartreuse.

---

# Monitoring Lifecycle

Every monitoring session, first one of the day and every one after, now follows the identical lifecycle — there is no more special-cased "first session skips Ready because Mezzo already chose a profile" path, because Mezzo never chooses a profile. Opening the Companion always lands on Welcome (zero saved profiles and no unsaved profile) or Ready, never straight into Monitoring:

Ready (Mezzo Companion open, monitoring inactive)

↓

Start monitoring (using the selected profile as-is), or Recalibrate / Create new profile first (inside the Companion — see "Calibration")

↓

Monitoring Active

↓

Meeting

↓

Stop (inside the Companion)

↓

Ready — directly, always. If the profile just used was still unsaved, it simply remains selected and available there, still unsaved, exactly as it was before Stop was pressed — nothing forces a save decision before the user can do anything else. See "Profile Model → Saving and Updating" for how it can be saved, replaced, or discarded once back at Ready.

The experience should remain predictable throughout the entire lifecycle.

Users should always understand:

* whether monitoring is active
* which profile is active, and whether it's a saved profile or an unsaved one
* how to start monitoring again, whether the Companion is still open or has closed
* how to end the session

Monitoring should never continue ambiguously.

Recovery should feel like a normal part of the experience rather than an error condition.

---

# Dock Experience

See "Dock" under Product Mental Model for what the running state shows. It supports recovery and keeping the Mezzo Companion alive — nothing operational, and it is not meant to be the user's focus during a meeting. It mirrors only one thing about the Companion: whether monitoring is active.

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it on this page, and never duplicates its Start monitoring or Stop controls here, or any profile/calibration control.

## Recovery

This screen offers exactly one action while the Companion is open: **Close Companion**. It has the exact same effect as the Companion's own native window-close control, whatever the Companion's current state — stops monitoring (or, mid-Calibrating, stops capture and discards whatever partial samples existed), closes the Companion, and returns to Home — and exists only because the floating window's own ✕ may not always be easy to find (e.g. behind other windows). Because the user asked for it here, it does not offer Reopen afterward. It is deliberately not framed as "End Session."

After any other close, the page offers **Reopen Companion** and **Done** instead (see "Recovery → Mezzo Companion Closed").

---

# Mezzo Companion Experience

The Mezzo Companion is the primary monitoring experience.

It should remain visually quiet while still communicating meaningful changes in speaking volume.

A user should understand its current state with a brief peripheral glance rather than sustained attention.

The Companion should:

* open at a useful default size, and resize appropriately as it moves between its pre-monitoring screens and Monitoring (Compact by default, Expanded on request)
* remain legible at each of its fixed sizes
* prioritize the visualization over controls
* communicate monitoring status clearly
* remain visually stable throughout a meeting

The Companion should feel like a quiet instrument—not a dashboard.

Before monitoring ever begins, the Companion moves through several distinct screens — Welcome, the calibration-introduction step (C1), Calibrating, and Ready, plus recovery and decision screens (Microphone Access Blocked, the calibration result, and the profile save/replace/delete decisions covered under "Profile Model") — before reaching Monitoring itself, which has two layouts, Compact and Expanded. See below for each.

Every screen follows one spacing scale and one 280px column, in three layouts: a sequence (Calibrating), with the heading fixed at the top so nothing moves between steps; a single choice (Welcome, the calibration introduction, Ready), centered, with 24px between groups; and a decision (the result and save/update/delete screens), centered below the decision bar. It uses the Lantern visual system throughout (`docs/prd/range-ring-and-lantern-refresh.md` §4): one dark theme, Geist type, cream primary buttons, sage text links, and chartreuse reserved for one meaning inside the Companion — the over-range band. Screens come in three layers: a flat screen, the Ready selector's menu panel over a dimmed screen, and decision states, which turn the whole window a lighter grey with a 44px header bar naming the decision and actions pinned to the bottom.

---

# Companion States

They should never feel like one screen with elements shown or hidden — each is a genuinely different experience with a different purpose, even though most of the pre-monitoring ones share one fixed size (see "Companion Sizing," below).

## Welcome

Purpose: the first thing a genuinely new user sees inside the Companion — a deliberate moment, not an instant redirect into calibration.

Target size: shared with every other pre-monitoring screen — see "Companion Sizing."

Reached exactly once: the very first time the Companion opens with zero saved profiles and no temporary profile (see "Profile Model"). Shows the lowercase "mezzo" wordmark as its heading, "A gentle nudge when you're talking louder than you'd like. First, a quick voice calibration.", then **Create speaking profile** with "Mezzo doesn't record audio or transcribe speech." beneath it. The window's own title reads "Mezzo, welcome." here. Its one action, **Create speaking profile**, opens the calibration-introduction screen (C1) — this does not itself request microphone access. There is no secondary dismiss action on Welcome; closing the Companion remains available through the native window control regardless of which screen is showing.

Once a saved profile or an unsaved profile exists, the Companion never shows Welcome again for the rest of that Companion-open lifetime.

## Calibration Introduction (C1)

Purpose: a short instructional step before capture begins, explaining what the user should do.

Target size: shared with every other pre-monitoring screen.

Reached from Welcome's Create speaking profile, and from Ready's Create new profile — see "Calibration → Calibration Entry" for the full rule (Recalibrate skips this screen). Its one action, **I'm ready**, begins the 3-2-1 and the six-second capture. Microphone permission is normally already granted by this point — Home's own permission gate handled that before the Companion ever opened — so this doesn't prompt again. A **Cancel** text link returns to wherever C1 was opened from — Welcome, or the same Ready state, with its selection and any existing unsaved profile untouched — without starting calibration or changing any profile.

## Ready

Purpose: preparation.

Target size: fixed, shared with every other pre-monitoring screen — see "Companion Sizing" for why this no longer depends on saved-profile count.

Reached whenever the Companion opens with a usable profile (saved or temporary) already available, and always after stopping monitoring. Every Companion open goes through Welcome or Ready — never straight to Monitoring — with one exception: **Reopen Companion** after an involuntary close resumes monitoring if it was running (see "Recovery → Mezzo Companion Closed").

Ready's layout is always, in this order: the heading (see "Ready Heading"), a "Speaking profile" label, a collapsed selector trigger, contextual actions for whichever profile is selected, Start monitoring, and a privacy disclaimer — see "Start Monitoring" above for the full behavior, and "Profile Model" for the selector's grouped contents and every contextual action.

The selector opens a menu panel attached to its trigger, over a dimmed screen; the panel scrolls internally without ever changing the Companion's own window size (see "Companion Sizing"). Each row carries its own Recalibrate and Delete (or, for the temporary profile, Discard) icon actions, and **Create new profile** sits in the panel's footer. The selected profile is marked distinctly from a hovered or keyboard-focused one.

From Ready, users can review the selected profile, choose another existing one, calibrate a new one, recalibrate any one, save or discard the temporary one, delete a saved one, or start monitoring. There is no in-Companion control to close it — the native Picture-in-Picture window-close control is the only way, from any state.

The visualization is intentionally hidden. Monitoring is inactive.

Ready always uses the shared pre-monitoring size — there is no Compact Ready variant.

Ready has no in-page title bar either — the real Document Picture-in-Picture window chrome is the only title bar, the same as every other state.

---

## Calibrating

Purpose: measurement — either a fresh, session-only calibration, or a recalibration of one specific saved or unsaved profile. See "Calibration" above for the full behavior; this section only covers what's specific to the Companion.

Target size: shared with every other pre-monitoring screen.

Reached from C1's "I'm ready," or directly from a Recalibrate action (see "Calibration → Calibration Entry"). Shows the 3-2-1 and six-second capture with the live level meter (see "Calibration → Active Calibration"), a brief automatic completion, and then the mode-appropriate result screen — a navigation, not a modal overlaid on this one. On a microphone-permission failure specifically, shows the dedicated Microphone Access Blocked screen below instead of a generic failure message; every other failure shows a calm, specific message with Try Again/Back, and never fails silently.

Calibrating always uses the shared pre-monitoring size — it never appears in Compact.

Its Cancel link stops capture and returns to where calibration started; closing the Companion does the same, per "Mezzo Companion Closed" under Recovery, below.

---

## Microphone Access Blocked

Purpose: recovery, specifically for a denied or unavailable microphone — a dedicated screen, not the generic Calibration Failed message every other failure uses. Now a narrower, defensive case than it once was: Home's own permission gate (see "Learn About Mezzo") handles the primary, before-the-Companion-opens denial, so this screen is reached only if access is revoked *after* the Companion has already opened — most plausibly during a later Recalibrate. It is kept, deliberately, rather than retired, precisely because Home's gate can't prevent that later case.

Target size: shared with every other pre-monitoring screen.

Explains what happened and how to fix it, alongside a schematic illustration pointing at the browser's own address-bar permission icon, and offers an in-app **Try again** — re-attempts calibration directly, no manual page reload needed — alongside **Back**, which returns to Ready without touching microphone state.

---

## Monitoring

Purpose: ambient awareness.

Monitoring opens in **Compact** (220×220), the peripheral default; **Expand** resizes it to Expanded (382×480). Both are `applyLayoutMode()`'s targets for an explicit action — manual resizing is otherwise freeform, at any aspect ratio, and never snaps back.

It shows:

* the **Range Ring** — the live visualization (see "Monitoring States" and "Visualization Principles"); its edge is always 60% of the window's short side
* the selected profile name (read only), above the ring — in Compact, Geist Mono 11px uppercase; it steps aside while the over-range band shows
* **Stop**, bottom-left: a 32px icon in windows under about 300px on the short side, a "Stop" pill at least 44px tall above that; its accessible name is always "Stop monitoring"
* **Compact** (in Expanded) or **Expand** (in Compact), top-right — the same corner, so nothing appears to move across the switch

There is no visible status text: the four zone labels are announced to screen readers only (see "Monitoring States"). There is no Pause — Stop and Start monitoring cover it, and one control keeps the window quiet.

Users cannot change profiles, calibrate, or recalibrate while monitoring — all three require stopping first.

Stopping monitoring ends the session, releases the microphone, and returns directly to Ready with the same profile selected — see "Monitoring Lifecycle."

---

## Companion Sizing

Welcome, C1, Calibrating, Microphone Access Blocked, Ready, and every profile save/replace/delete decision screen (see "Profile Model") all share one fixed size, regardless of how many profiles are saved. Ready used to grow taller as more profiles were saved, each shown as an always-visible row; the current selector instead expands as an overlay panel that scrolls internally within the existing card, so the surrounding window never needs to resize as the profile library grows. Monitoring keeps its own two sizes, Expanded and Compact, unrelated to profile count. See `CLAUDE.md`'s Non-Negotiable Decisions for the exact pixel values.

---

# Compact Companion

Compact is an intentional product mode, and the default for every monitoring session — not a responsive fallback for small windows.

Target size: 220×220.

It exists only while monitoring. Its purpose is peripheral awareness: at rest, the ring and the profile name, with Stop and Expand quiet (35% opacity) until the pointer hovers the window or either control receives keyboard focus. Both remain real, focusable buttons the entire time; on touch/no-hover devices they are shown outright.

It does not display:

* a title bar or wordmark — the real Document Picture-in-Picture window chrome is the only title bar
* monitoring status text

Stop in Compact behaves identically to Stop in Expanded. Closing the native Picture-in-Picture window remains a separate action, available from every state — see "Recovery → Mezzo Companion Closed."

Expanding (and compacting again) never interrupts monitoring, the selected profile, or the current zone.

---

# Profile Model

A **speaking profile** is the umbrella term for any voice calibration Mezzo can use as its reference for monitoring — saved or unsaved. Avoid "range" as the general user-facing name for this model; where a speaking profile's own underlying calibration measurement needs naming specifically, "calibration" is the word — a calibration is never described as if it were itself the persistent, saved thing.

A **saved profile** is a persistent, reusable identity for an environment or situation — "Kitchen," "Home Office," "Coffee Shop" — not a single-use calibration. Its calibration can be refreshed at any time via Recalibrate without changing its identity: same id, same name, same position in the library. Recalibrating "Kitchen" updates "Kitchen" — it never creates "Kitchen 2," never requires renaming, and never requires deleting the profile it replaces. A user may save at most five profiles at a time.

An **unsaved profile** — called the **Temporary profile** in the interface — is a just-completed calibration that hasn't been given a name yet. It is held in memory only — never written to any storage the browser tab keeps around. (Internally, the runtime object behind it still carries a fixed placeholder value, `Current speaking range`, in its own `name` field — this is implementation detail only, never shown to the user. Don't conflate the two.) At most one unsaved profile exists at a time: recalibrating it, or calibrating a new one from a saved-profile selection, always replaces whichever one existed before, never adds a second. An unsaved profile:

* can be used for monitoring, without ever being named or saved
* can be recalibrated, saved, or discarded
* appears in the same selector as saved profiles, grouped separately — see "Selecting a Profile" below
* remains available even when a saved profile is selected instead
* does not count toward the five-profile limit
* disappears when the Companion closes — except that after an involuntary close, the running page's **Reopen Companion** brings it back from memory (see "Recovery → Mezzo Companion Closed"); Done, Close Companion, or leaving the page discards it

Selecting Recalibrate never risks losing a completed calibration: recalibrating a saved profile always asks — Update the saved profile, Keep temporarily, or Discard (see "Calibration → On Completion") — before anything changes.

A saved profile stores its id, name, speaking level, spread, calibration time, `peakDb` (how far above the speaking level the calibration's own peaks reached) and `roomNoiseDb` (the room's noise during the 3-2-1). A profile saved before peaks were recorded still works, with an older end-of-range rule, and Ready suggests recalibrating it.

Calibration, recalibration, profile selection, saving, replacing, discarding, and deleting all happen inside the Mezzo Companion now — there is no second, page-level implementation of any of it to keep in sync, and no handoff between two surfaces to reason about.

## Selecting a Profile

Ready's selector shows whichever profile is currently active, and opens a panel listing every available one. When both a temporary and one or more saved profiles exist, the panel groups them — a "Temporary" section first, with the note "Disappears when you close Mezzo", then a "Saved profiles" section. Selecting a row updates the current selection and closes the panel; it never starts monitoring, and never deletes or discards anything else. Every row has a Recalibrate icon action; each saved profile's row also has Delete, and the temporary profile's row has Discard. **Create new profile** is the panel's footer action.

## Saved-Profile Actions

**Recalibrate** (any row) and **Create new profile** (the panel footer) are always available. Create new profile begins calibration from scratch, through the calibration-introduction step (see "Calibration"); it does not touch the selected saved profile at all. At five saved profiles it shows the five-profile-limit screen instead, without starting calibration.

## Saving and Updating

With the temporary profile selected, Ready offers **Save profile** (the result screen's **Save speaking profile** does the same). Below the five-profile limit, this opens a naming screen — "Name this profile" — with Cancel and Save actions; Save stays disabled until a name is entered.

* A name that doesn't match any saved profile's name creates a new saved profile, selects it, and removes the unsaved profile. A toast confirms: `Profile “{Name}” saved`.
* A name that matches an existing saved profile's name instead — trimmed, case-insensitive; a saved profile's own stored display name and casing are never changed by this comparison — shows a warning (`A profile named “{Name}” already exists.`) and changes the button from Save to Update. Updating overwrites that profile's calibration in place, exactly as Recalibrate's own Update would, removes the unsaved profile, and selects the updated profile. A toast confirms instead: `Profile “{Name}” updated`.
* **Cancel** returns to Ready, leaving the unsaved profile exactly as it was.

Both Save and Update show a brief processing state on their own button, and guard against a duplicate submission, before the toast appears. The toast is transient, announces itself politely to assistive tech, and never shifts Ready's layout or takes focus.

Recalibrate remains the primary, deliberate way to intentionally update a known profile. The naming screen's own name-matching path is an equivalent, explicit alternative for the moment an unsaved profile turns out to belong to a profile the user already has — not a second, looser way to overwrite something by accident.

## Five-Profile Limit

Five saved profiles is the maximum. The limit applies only to saved profiles — an unsaved profile stays fully usable even when five are already saved. Selecting **Save profile** (or **Create new profile**) while at the limit doesn't open the naming screen or start calibration; instead it shows a dedicated screen: `5 of 5 profiles saved` / `Delete a saved profile before saving this one.` — with **Manage profiles**, which returns to Ready with the selector open so a saved profile can be deleted there, and Cancel in the bar. The user has to open the selector, delete a saved profile there, then choose Save profile again.

## Discarding an Unsaved Profile

Discard, from the selector's own row-level control, removes the unsaved profile with no confirmation — nothing was ever saved for it to protect. If the unsaved profile was the one selected: a saved profile still existing afterward means the most recently used one becomes selected; none existing means the Companion returns to Welcome, exactly as if calibration had never happened. If a different, saved profile was selected instead, discarding the unsaved one leaves that selection untouched — removing it from the background never changes what's active.

## Deleting a Saved Profile

Deleting a saved profile uses a dedicated, full-screen confirmation — never a small floating dialog or a browser-native confirmation — with **Delete** as an outline button (a destructive action isn't the bright default) and Cancel in the bar, asking plainly whether to permanently remove it. Canceling changes nothing. Confirming shows a brief processing state on Delete, with Cancel disabled for that same moment, before actually removing it — then, if it was the selected profile, falls back in order: the unsaved profile, if one exists; otherwise the most recently used remaining saved profile; otherwise Welcome, if nothing usable is left at all. If removal doesn't succeed, both actions become available again, the profile stays in the library exactly as it was, the current selection is untouched, and a brief, calm message explains it didn't work — the screen never remains stuck on its processing state.

Renaming a saved profile does not exist as a feature yet. If it's ever built, it belongs here too, alongside delete.

---

# Monitoring States

These are the four awareness zones shown while the Companion is Monitoring — distinct from the Companion's own Ready/Monitoring states above, which describe what the Companion is doing rather than how loud the user is. Their labels — Listening, Within range, Approaching end of range, Outside range — are not shown on screen; they are announced to screen readers, debounced so they don't chatter. The Range Ring alone carries them visually.

Monitoring states describe what is happening. They do not evaluate the user, and they do not prescribe behavior.

The ring has three parts: a **range edge** (a circle marking the end of the user's range, always visible), a **voice circle** that follows the momentary level, and an **over-range band**, a flat chartreuse ring outside the edge, present only over range.

| Zone | What the user sees |
|---|---|
| Listening | Not speaking, or below the speaking threshold. The voice circle rests small and faint; the edge is equally quiet. Not a negative state. |
| Within range | The circle grows with the voice, comfortably inside the edge. Calm and balanced. |
| Approaching end of range | The circle grows toward the edge and brightens; the edge thickens and turns sage. Gentle awareness, not correction. |
| Outside range | The circle fills the edge and the chartreuse band appears outside it, growing with how far over. The brightest color in the product. |

Attention rises in three steps of brightness and size, which work in peripheral vision and don't depend on hue. Never blink, flash, pulse aggressively, or simulate alarms. Chartreuse is a nudge, not a warning.

Where the range comes from: the end of range sits just above the calibration's own peaks (so speaking at the calibrated level never reads as Outside range), Approaching is the last 2 dB before it, and zones are judged on a short-term level that a single emphasized syllable can't move. Exact rules and tuned values: `docs/prd/range-ring-and-lantern-refresh.md` §5.

---

# Visualization Principles

The visualization behaves like a natural system. Changes should feel like changes in energy rather than software notifications.

* **The container stays fixed.** The ring never causes surrounding layout changes; it scales with the window's short side.
* **Motion communicates state**, never decoration: the circle rises quickly and falls gently, settles to rest over a second when the user stops speaking, and the band grows from a thin ring and shrinks back before fading, so it doesn't flicker at the edge.
* **Silence and room noise don't move it.** A speech-band filter keeps fan rumble and hiss out of the level, and the circle stays at rest unless the voice is clearly above the room's measured noise.
* **Color reinforces state; it is not the primary channel.** Grey-taupe for the voice, sage for approaching, chartreuse only over range. With reduced motion, the circle still follows the voice, and the band appears at a fixed thickness instead of growing.

Tuned values live in the ring, zone and audio settings objects (`src/range-ring.js`, `src/engine.js`, `src/audio.js`); the public playground at `/playground/` drives a frozen copy of them live.

---

# Recovery

Recovery is part of the normal monitoring lifecycle.

It should never feel like failure.

Users should always understand:

* what happened
* whether monitoring is still active
* what they can do next

---

## Mezzo Companion Closed

Monitoring can never continue without the Mezzo Companion open. If the Companion closes, whatever was happening stops immediately and microphone resources are released, not left running invisibly. In-progress calibration is discarded, and a recalibration leaves its target saved profile untouched; a decision screen closes with no partial write, since none of them touch storage until their own affirmative action completes.

What happens next depends on how it closed:

* **Close Companion, on the running page** — the user asked for it there, so Mezzo returns to the granted page. A temporary profile is discarded.
* **Any other close** — another picture-in-picture window replacing it (Chrome allows one at a time, and Meet's mini window wins), or the Companion's own native ✕. Mezzo can't tell these apart, so the page stays on the cream running surface: "The Companion closed" / "Another mini window, like Meet's, may have closed it. Reopen it to pick up where you left off.", with **Reopen Companion** and **Done**.
  * **Reopen Companion** opens it again from that click, with the same profile selected (a temporary one included, from memory), and resumes monitoring if it was running.
  * **Done** discards the offer (and any temporary profile) and returns to the granted page.

Opening the Companion from Home always starts fresh: Welcome or Ready, never monitoring.

---

## Mezzo Closed

Closing the Dock (the browser tab) ends the monitoring session — this is the primary way a session ends; there is no dedicated End Session control.

Ending the session should:

* stop monitoring
* release microphone access
* close the Mezzo Companion
* return the experience to a predictable state

---

## Unsupported Browser

Document Picture-in-Picture support is required to use Mezzo — there is no alternate in-page monitoring experience anymore (retired: the old "monitoring continues within Mezzo" fallback directly contradicted having one operational surface).

If the browser does not support the Mezzo Companion:

Explain the limitation clearly, on Home, before asking for anything else.

Do not offer a degraded or parallel monitoring experience in this browser.

Suggested language:

> Your browser doesn't support the Mezzo Companion, which Mezzo needs to work. Try Mezzo in Chrome or Edge.

Do not rename Mezzo, and do not repurpose Home as a monitoring surface, simply because a browser can't run the Companion.

---

## Microphone Access

If microphone permission is denied:

Clearly explain:

* what happened
* why access is needed
* how to grant permission
* how to return to a ready state

Never fail silently.

Microphone permission is requested from exactly one place — Home's own permission gate, before the Companion ever opens (see "Learn About Mezzo" and "Calibration") — so there is exactly one *primary* recovery experience to get right, on Home itself. A second, narrower recovery screen exists inside the Companion (Microphone Access Blocked) purely for access being revoked after the Companion has already opened — not a second version of the same first-run problem to keep in sync, but a genuinely different scenario Home's own gate can't reach. Keep both calm, specific, and consistent with each other in tone even though their copy differs.

---

# Privacy Experience

Privacy should be reinforced at moments where users naturally have questions.

Especially:

* before microphone permission, on Home, before the Companion ever opens
* on Home, while introducing the product, and on the running page
* on the Privacy page and in the extension popup

Core promises should remain simple and verifiable:

* audio is processed locally
* audio is never recorded
* audio is never stored
* audio is never transmitted as part of the core experience
* speech is never transcribed
* conversation content is never analyzed

Speaking Profile data is the one thing Mezzo does persist, and only locally — see `CLAUDE.md`'s Non-Negotiable Decisions and the Privacy page for the exact claim.

Trust should come from consistent behavior rather than reassurance alone.

---

# Experience Principles

Every interaction should reinforce:

* Calm
* Trust
* Restraint
* Clarity
* Presence
* User control

The interface should:

* describe rather than judge
* guide rather than interrupt
* support rather than supervise

The user should always feel in control of their own speaking behavior.

The visualization is the product's visual hero. Every other interface element should justify its existence — prefer progressive disclosure over exposing every control at once. Preparation and monitoring are intentionally different experiences, and the Companion is an ambient object, not a control panel.

---

# Experience Review Checklist

Before shipping a feature, ask:

## Understanding

* Would a first-time user know what to do?
* Is the relationship between Mezzo and the Mezzo Companion clear?
* Are unnecessary implementation details hidden?

## Trust

* Is microphone behavior clearly explained?
* Are privacy promises accurate?
* Does the experience avoid surprises?

## Simplicity

* Can the flow be shorter without becoming ambiguous?
* Are duplicate checkpoints avoided?
* Is there only one clear path into monitoring?

## Consistency

* Is the Mezzo Companion the only experience called a Companion?
* Does the terminology match `CLAUDE.md`?
* Do all entry points converge on the same mental model?

## Recovery

* Can users understand what happened?
* Is there a clear next step?
* Can monitoring ever continue invisibly or ambiguously?

## Calm

* Is attention requested only when necessary?
* Does the experience remain ambient?
* Does the interface describe rather than correct?

If the answer to any of these questions is "no," revisit the experience before implementation.

---

# Success Criteria

A successful experience with Mezzo should feel effortless.

The user:

* understands how to begin monitoring
* trusts how Mezzo handles microphone access
* keeps the Mezzo Companion beside the meeting
* notices changes through peripheral awareness
* never feels judged or interrupted
* understands how to recover if something closes
* finishes the meeting feeling more aware of their speaking volume

The product should quietly support the conversation without becoming part of it.
