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
* **While a Companion is open:** stay open to keep the Companion running, show whether monitoring is active or inactive, and offer one recovery action (Close Companion) for when the Companion's own native ✕ isn't reachable.

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

This page reflects the browser's *current* microphone-permission state — never first-time-vs-returning visit history, and never a persisted "have I seen this before" flag. Depending on that live state, it shows one of three things: an explanation of why access is needed with an **Enable microphone** action, a brief confirmation once access is granted with a separate **Open Mezzo Companion** action, or a recovery message if access is denied. Granting access and opening the Companion are always two separate, deliberate clicks — never chained into one, so opening the Companion always has its own fresh user gesture (see "Calibration," below, for why this matters). There is no separate "Try Mezzo" step or intermediate launcher screen between the marketing content and the Companion opening — just this permission gate, resolved before the Companion ever exists.

The experience should feel:

* warm
* editorial
* spacious
* approachable

The product itself should remain the visual hero.

---

## Dock

Internal term only (retired name: Anchor page) — see Canonical Terminology in `CLAUDE.md`. It is the same browser page as Marketing/Onboarding, before a Companion exists; once a Companion is open, it becomes a minimal status surface that must stay open to keep the Companion running.

The Dock:

* keeps the Mezzo Companion running
* reflects whether monitoring is active or not, via a small plain-text status line
* explains why the page must remain open
* offers Close Companion, a recovery action — the one thing the Dock is allowed to do beyond reporting status
* closes the Companion if it closes itself

It is not the primary monitoring interface, and it is not a second operational surface. It has no calibration UI, no profile UI, no Start monitoring, no Stop, no Save — it does not duplicate any Companion control, full stop. It does not run a second visualization or reflect real session data beyond that one status line — see "Dock Experience," below, for exactly what it shows and why.

The Mezzo Companion, not the Dock, is meant to stay available across an entire meeting-filled day — monitoring starts and stops independently inside it, session by session, without the Companion needing to reopen.

User-facing copy never names this page — it says things like "this page," "keep this page open," or "closing this page will also close the Mezzo Companion."

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

Active calibration — six seconds, a live countdown and horizontal listening bar; no manual "I'm done" action (see "Calibration")

↓

Calibration completes automatically, producing an unsaved profile — it becomes selected immediately, with no separate decision screen in between

↓

Ready, with the unsaved profile selected — "Ready for your first conversation." From here: start monitoring immediately without saving, or save it first (see "Profile Model → Saving and Replacement")

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

C1 explains, briefly, what the user should do before capture starts — not why microphone access is needed, which Home already covered before the Companion opened. Its one action, "I'm ready," begins capture; microphone permission is normally already granted by this point, so this resolves silently rather than prompting again. A Back text link returns to wherever C1 was opened from (Welcome, or the same Ready state, with its selection and any existing unsaved profile left untouched) without starting calibration or changing any profile.

### Active Calibration

Calibration lasts six seconds and completes automatically — there is no manual "I'm done" action. It shows a live countdown ("Listening… 6s," ticking down) and a horizontal volume bar that fills proportionally to detected input, flanked by Quiet/Loud scale labels — enough to communicate active measurement without implying recording or transcription.

If microphone access is blocked or denied at this point — access must have been revoked after the Companion already opened, since Home's own permission gate already ensured it was granted before the Companion could open at all — calibration cannot continue: a dedicated recovery screen explains what happened and how to fix it (see "Companion States → Microphone Access Blocked"), with an in-app Try again rather than requiring a manual page reload.

### On Completion

Which result appears depends on why calibration was run:

**Session-mode calibration** (Create speaking profile, or Create new profile from a saved-profile Ready state) produces an unsaved profile immediately — no separate decision screen. It becomes selected, and Ready shows it with its own contextual actions (see "Profile Model").

**Recalibrate**, on a saved profile, does not touch that profile yet. It shows a decision screen instead — "Replace existing '{name}' profile?" — offering:

* **Replace** — overwrites the saved profile's calibration in place, keeping its name and identity, and returns to Ready with it selected
* **Keep as unsaved** — leaves the saved profile completely untouched, and keeps the new calibration as a fresh unsaved profile instead, selected on return

**Recalibrate**, on the unsaved profile itself, has nothing else at stake to protect: it simply replaces the unsaved profile directly with the new result, selected on return.

Nothing is written to a saved profile merely by entering calibration or by capture completing — only Replace does that, and only for the one profile Recalibrate was started from. There is no path from a session-only calibration to silently replacing a saved profile — only to explicitly doing so, visibly, by name (see "Profile Model → Saving and Replacement").

---

## Start Monitoring

There is exactly one Start monitoring, reachable only from the Companion's own Ready screen — first session of the day and every one after are the identical action; there is no separate, page-driven "first session" variant anymore.

When the Companion is in its Ready state, show, always in this order:

1. Ready heading — see "First-Conversation Copy" below
2. "Speaking profile" label
3. A collapsed selector trigger, showing the currently selected profile's name (or "Unsaved profile")
4. Contextual actions for that selection — Recalibrate, plus Save profile or Create new profile depending on what's selected (see "Profile Model")
5. Start monitoring
6. A privacy disclaimer

This order never changes — selecting a different profile updates the selector's contents and the contextual actions beneath it, but never restructures the screen around them. The selector itself expands into an overlay panel rather than an anchored dropdown (see "Companion States → Ready").

Selecting Start monitoring should:

* start the monitoring session, with whichever profile is selected, as-is
* lock profile selection
* transition the Companion into its Monitoring state
* transition the Dock into its "Monitoring is active" status

Selecting Recalibrate or Create new profile should transition the Companion into calibration (see "Calibration" above) — not directly into Monitoring.

Monitoring should never begin automatically on its own, without this explicit action. This lets the user start monitoring sessions, recalibrate a profile, or run a fresh calibration, at any point in the day, entirely inside the Companion — Mezzo (Home/Dock) is never involved in any of these decisions.

## First-Conversation Copy

The Ready heading reads "Ready for your first conversation." until the user has actually started monitoring for the first time — not merely calibrated, saved, recalibrated, switched profiles, opened and closed a decision state, or closed and reopened Mezzo before ever starting a session. Once monitoring has started for the first time, ever, every later Ready state shows "Ready for your next conversation." instead. This is a one-way, persisted condition: it survives Companion restarts and never reverts back to the first-conversation copy.

## Deferred: Post-Session Acknowledgment

A rotating, varied acknowledgment message on returning to Ready after a session (something warmer than the plain heading alone) is approved conceptually, but is not part of the current experience. It has not been designed, and no layout space is reserved for it. Treat it as a future Ready-state enhancement, not a gap in what's described above.

---

# Returning User Journey

Returning users should experience as little friction as possible.

The intended flow is:

Open Mezzo Companion (from Home — the one action; it does not choose a profile itself)

↓

Mezzo Companion opens, showing Ready — previously used saved profile is selected and visible; an unsaved profile that was never saved does not persist across visits (it doesn't even survive a Companion close within the same visit — see "Profile Model") and is never what's restored here

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

When a supported meeting is detected, the extension may offer:

Open Mezzo

Not Now

Selecting Open Mezzo should:

* open Mezzo
* restore the previous profile when possible
* allow the user to review their setup — now inside the Companion's own Ready screen, not on Home, since Home no longer shows profile information
* require an explicit Start monitoring action

Do not imply that monitoring begins directly from the meeting prompt.

The user should always begin monitoring intentionally.

Whether "Open Mezzo" from this prompt should land on Home first (requiring one more click, Open Mezzo Companion) or open the Companion directly, given the user already expressed clear intent by responding to the prompt, has not been revisited under the PiP-first model and is out of scope for this pass.

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

Ready — directly, always. If the profile just used was still unsaved, it simply remains selected and available there, still unsaved, exactly as it was before Stop was pressed — nothing forces a save decision before the user can do anything else. See "Profile Model → Saving and Replacement" for how it can be saved, replaced, or discarded once back at Ready.

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

The Dock (retired name: Anchor Page Experience) supports recovery and keeping the Mezzo Companion alive — nothing operational. Its own "active"/"inactive" status below mirrors, but is distinct from, the Companion's own Ready and Monitoring states — see Companion States.

During an active meeting, it is not intended to be the user's primary focus.

Its responsibility is to keep the monitoring session understandable and recoverable — nothing more. There is no End Session (or any other) button on this screen beyond Close Companion. A monitoring session ends by closing this page, which closes the Companion too, or by closing the Companion itself using its native window control.

## What It Shows

Once the Companion is open — whether monitoring is active or the Companion is sitting on Welcome, Ready, Calibrating, or any decision state — the Dock shows the same structure, with one thing that changes:

* a small status line: "Monitoring is active" while monitoring, or "Monitoring is not active" for every other Companion state — the only part of this screen that reflects real session state. Deliberately collapsed to this one externally meaningful distinction (2026-08-17 redesign) rather than surfacing every one of the Companion's own internal states (Welcome, Ready, C1, Calibrating, and every decision screen all read as "not active" here) — the wording itself carries the meaning, not color alone
* a fixed heading: "Your Companion is open" — shown regardless of the status above it
* guidance to keep the page open and that closing it closes the Companion too: "Keep this page open while using Mezzo." / "Closing it will also close the Mezzo Companion."
* Close Companion — see "Recovery" below

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it, and never duplicates its Start monitoring or Stop controls here, or any profile/calibration control. Reporting status and offering Close Companion (a recovery action, not a status or monitoring control — see "Recovery") are the only jobs of this screen while the Companion is open. The Dock no longer shows an illustrative preview of the Companion window (retired 2026-08-17 — the redesigned Dock is text-only) — see CLAUDE.md's Engineering Notes for the history of that decision.

## Recovery

Users should never need a second checkpoint on this page before monitoring can begin — Open Mezzo Companion already handles getting them there, and the Companion's own Welcome/Ready screens handle everything after. Once the Companion is open, this screen offers exactly one action: **Close Companion**. It has the exact same effect as the Companion's own native window-close control, whatever the Companion's current state — stops monitoring (or, mid-Calibrating, stops capture and discards whatever partial samples existed), closes the Companion, and returns to Home — and exists only because the floating window's own ✕ may not always be easy to find (e.g. behind other windows). See "Mezzo Companion Closed" under Recovery, below, for what happens to an in-progress calibration or an unsaved profile specifically. It is deliberately not framed as "End Session": it isn't a second way to decide you're done, it's the same close action the native control already performs, made reachable from the page. Beyond that, this screen exists only to report status once the Companion is already open, and to explain how closing things works.

---

# Mezzo Companion Experience

The Mezzo Companion is the primary monitoring experience.

It should remain visually quiet while still communicating meaningful changes in speaking volume.

A user should understand its current state with a brief peripheral glance rather than sustained attention.

The Companion should:

* open at a useful default size, and resize appropriately as it moves between its pre-monitoring screens, Expanded Monitoring, and Compact
* remain legible at each of its fixed sizes
* prioritize the visualization over controls
* communicate monitoring status clearly
* remain visually stable throughout a meeting

The Companion should feel like a quiet instrument—not a dashboard.

Before monitoring ever begins, the Companion moves through several distinct screens — Welcome, the calibration-introduction step (C1), Calibrating, and Ready, plus two recovery/decision screens (Microphone Access Blocked, and the profile save/replace/delete decisions covered under "Profile Model") — before reaching Monitoring itself, which has two layouts, Expanded and Compact. See below for each.

---

# Companion States

They should never feel like one screen with elements shown or hidden — each is a genuinely different experience with a different purpose, even though most of the pre-monitoring ones share one fixed size (see "Companion Sizing," below).

## Welcome

Purpose: the first thing a genuinely new user sees inside the Companion — a deliberate moment, not an instant redirect into calibration.

Target size: shared with every other pre-monitoring screen — see "Companion Sizing."

Reached exactly once: the very first time the Companion opens with zero saved profiles and no unsaved profile from an earlier session (an unsaved profile never survives a Companion close — see "Profile Model"). Explains, briefly, what's about to happen. Its one action, **Create speaking profile**, opens the calibration-introduction screen (C1) — this does not itself request microphone access. There is no secondary dismiss action on Welcome; closing the Companion remains available through the native window control regardless of which screen is showing.

Once a saved profile or an unsaved profile exists, the Companion never shows Welcome again for the rest of that Companion-open lifetime.

## Calibration Introduction (C1)

Purpose: a short instructional step before capture begins, explaining what the user should do.

Target size: shared with every other pre-monitoring screen.

Reached from Welcome's Create speaking profile, and from Ready's Create new profile — see "Calibration → Calibration Entry" for the full rule (Recalibrate skips this screen). Its one action, **I'm ready**, begins the six-second capture. Microphone permission is normally already granted by this point — Home's own permission gate handled that before the Companion ever opened — so this doesn't prompt again. A **Back** text link returns to wherever C1 was opened from — Welcome, or the same Ready state, with its selection and any existing unsaved profile untouched — without starting calibration or changing any profile.

## Ready

Purpose: preparation.

Target size: fixed, shared with every other pre-monitoring screen — see "Companion Sizing" for why this no longer depends on saved-profile count.

Reached whenever the Companion opens with a usable profile (saved or unsaved) already available, and always after stopping monitoring. Every session, first included, goes through Welcome or Ready — never straight to Monitoring.

Ready's layout is always, in this order: the first/next-conversation heading, a "Speaking profile" label, a collapsed selector trigger, contextual actions for whichever profile is selected, Start monitoring, and a privacy disclaimer — see "Start Monitoring" above for the full behavior, and "Profile Model" for the selector's grouped contents and every contextual action.

The selector expands into an overlay panel, positioned over the card's own bounds, rather than an anchored dropdown — this keeps it fully visible regardless of where the trigger sits in the small window, and lets it scroll internally without ever changing the Companion's own window size (see "Companion Sizing"). The selected profile is marked distinctly from a hovered or keyboard-focused one.

From Ready, users can review the selected profile, choose another existing one, calibrate a new one, recalibrate the selected one, save or discard an unsaved one, delete a saved one, or start monitoring. There is no in-Companion control to close it — the native Picture-in-Picture window-close control is the only way, from any state.

The visualization is intentionally hidden. Monitoring is inactive.

Ready always uses the Expanded layout — there is no Compact Ready variant.

Ready has no in-page title bar either — the real Document Picture-in-Picture window chrome is the only title bar, the same as every other state.

---

## Calibrating

Purpose: measurement — either a fresh, session-only calibration, or a recalibration of one specific saved or unsaved profile. See "Calibration" above for the full behavior; this section only covers what's specific to the Companion.

Target size: shared with every other pre-monitoring screen.

Reached from C1's "I'm ready," or directly from Ready's Recalibrate (see "Calibration → Calibration Entry"). Shows a live countdown and a horizontal, proportional volume bar, a brief automatic completion, and then the mode-appropriate result (see "Calibration" above) — a navigation to the next screen, not a modal overlaid on this one. On a microphone-permission failure specifically, shows the dedicated Microphone Access Blocked screen below instead of a generic failure message; every other failure shows a calm, specific message with Try Again/Back, and never fails silently.

Calibrating always uses the Expanded layout, same as Ready — it never appears in Compact, since it exists only before Monitoring begins.

There is no in-Companion control to cancel and back out of an in-progress capture; closing the Companion is the way out, per "Mezzo Companion Closed" under Recovery, below.

---

## Microphone Access Blocked

Purpose: recovery, specifically for a denied or unavailable microphone — a dedicated screen, not the generic Calibration Failed message every other failure uses. Now a narrower, defensive case than it once was: Home's own permission gate (see "Learn About Mezzo") handles the primary, before-the-Companion-opens denial, so this screen is reached only if access is revoked *after* the Companion has already opened — most plausibly during a later Recalibrate. It is kept, deliberately, rather than retired, precisely because Home's gate can't prevent that later case.

Target size: shared with every other pre-monitoring screen.

Explains what happened and how to fix it, alongside a schematic illustration pointing at the browser's own address-bar permission icon, and offers an in-app **Try again** — re-attempts calibration directly, no manual page reload needed — alongside **Back**, which returns to Ready without touching microphone state.

---

## Monitoring

Purpose: ambient awareness.

Target size (Expanded): 382×480 (2026-08-18 redesign — was 290×420; 382 now matches every pre-monitoring screen's own width instead of standing alone as narrower). This is `applyLayoutMode()`'s own Expand target, resized to on an explicit Expand action — manual resizing is otherwise freeform, including at aspect ratios other than 382:480, and never snaps or locks to that ratio.

The presentation is centered on the same axis Ready's and Calibrating's own heading occupies. Monitoring displays:

* current monitoring state (Listening / Within range / Approaching end of range / Outside range), in the display serif, keeping the same live per-zone color the earlier presentation used
* selected profile name (read only), set small and low-contrast directly beneath the status, with no "Profile:" label — the position and typography already make clear what it is
* live visualization
* a single centered Stop monitoring pill — a quiet, low-contrast pill (the same visual language as every other secondary Companion action), never a large full-width button
* a Compact toggle — its own icon-only "window chrome" control, permanently anchored in the top-right corner, not part of the Stop control row

Users cannot change profiles, calibrate, or recalibrate while monitoring — all three require stopping first.

Stopping monitoring returns directly to Ready, always — see "Monitoring Lifecycle."

**Responsive behavior below the 382×480 reference** is purely presentational — it never changes which Companion mode (Expanded vs. Compact) is active, only how much of Expanded's own content fits at the window's current real size. As the window is manually resized smaller, content sheds in this order (and reappears in exact reverse order as it grows back): the profile name drops first; the Stop pill then becomes a small icon-only control anchored bottom-left (always visible at that size, unlike Compact's own hover-gated treatment below); the status text drops last, leaving only the visualization, the bottom-left Stop icon, and the top-right Compact toggle. The visualization itself is the only element that ever changes size in response to resizing — type and controls stay fixed. Resized *larger* than 382×480, the visualization's containing area caps at roughly 300×300 and the extra room becomes balanced padding around it, rather than enlarging the circle or any text/control past its normal size.

---

## Companion Sizing

Welcome, C1, Calibrating, Microphone Access Blocked, Ready, and every profile save/replace/delete decision screen (see "Profile Model") all share one fixed size, regardless of how many profiles are saved. Ready used to grow taller as more profiles were saved, each shown as an always-visible row; the current selector instead expands as an overlay panel that scrolls internally within the existing card, so the surrounding window never needs to resize as the profile library grows. Monitoring keeps its own two sizes, Expanded and Compact, unrelated to profile count. See `CLAUDE.md`'s Non-Negotiable Decisions for the exact pixel values.

---

# Compact Companion

Compact is an intentional product mode, not a responsive fallback for small windows.

Target size: 220×220 — a hard floor for this explicit mode; Compact never presents fuller content just because it happens to be manually resized larger than its own target.

It exists only while monitoring. Its purpose is peripheral awareness.

The Compact Companion removes all interface chrome, keeping only what's essential at a glance. At rest it displays only the visualization — even the Stop and Expand controls stay hidden until the pointer hovers the window or either control receives keyboard focus, at which point both fade in (opacity only, never `display`/`visibility` — both remain real, focusable buttons the entire time, so a keyboard user tabbing through the Companion still reaches them). On touch/no-hover devices, both are shown outright rather than left reachable only by an unreliable hover state.

Once revealed, it displays:

* the visualization
* Stop, bottom-left corner, icon-only
* Expand, top-right corner, icon-only — deliberately the same corner Expanded's own Compact toggle occupies, so nothing appears to move across the mode switch (Stop keeps the opposite, bottom-left corner in both the shrunk-Expanded responsive tier above and here in Compact itself)

It does not display, even when the corner controls are revealed:

* a title bar or wordmark — the real Document Picture-in-Picture window chrome is the only title bar, in both Expanded and Compact
* monitoring status text
* profile information

Stop in Compact behaves identically to Stop in Expanded: it stops monitoring and returns the Companion to Ready, without closing it. Closing the native Picture-in-Picture window remains a separate, more final action, available from Compact the same as from every other state: it stops monitoring, releases the microphone, and follows the recovery path described under Mezzo Companion Closed below — the Companion closes, and Mezzo returns to Home.

Expanding always returns to the Expanded layout without interrupting monitoring, the selected profile, or the current monitoring state.

---

# Profile Model

A **speaking profile** is the umbrella term for any voice calibration Mezzo can use as its reference for monitoring — saved or unsaved. Avoid "range" as the general user-facing name for this model; where a speaking profile's own underlying calibration measurement needs naming specifically, "calibration" is the word — a calibration is never described as if it were itself the persistent, saved thing.

A **saved profile** is a persistent, reusable identity for an environment or situation — "Kitchen," "Home Office," "Coffee Shop" — not a single-use calibration. Its calibration can be refreshed at any time via Recalibrate without changing its identity: same id, same name, same position in the library. Recalibrating "Kitchen" updates "Kitchen" — it never creates "Kitchen 2," never requires renaming, and never requires deleting the profile it replaces. A user may save at most five profiles at a time.

An **unsaved profile** is a just-completed calibration that hasn't been given a name yet. It exists only for the current Companion session, held in memory only — never written to any storage the browser tab keeps around, so it cannot accidentally outlive the Companion window it was created in. (Internally, the runtime object behind it still carries a fixed placeholder value, `Current speaking range`, in its own `name` field — this is implementation detail only, never shown to the user; the interface always calls it "Unsaved profile." Don't conflate the two.) At most one unsaved profile exists at a time: recalibrating it, or calibrating a new one from a saved-profile selection, always replaces whichever one existed before, never adds a second. An unsaved profile:

* can be used for monitoring, without ever being named or saved
* can be recalibrated, saved, or discarded
* appears in the same selector as saved profiles, grouped separately — see "Selecting a Profile" below
* remains available even when a saved profile is selected instead
* does not count toward the five-profile limit
* disappears the moment the Companion closes, saved or not

Selecting Recalibrate never risks losing a completed calibration: recalibrating a saved profile always asks — Replace the saved profile, or Keep as unsaved instead (see "Calibration" above) — before anything changes, and recalibrating an unsaved profile simply replaces it directly, with nothing else at stake to protect.

Calibration, recalibration, profile selection, saving, replacing, discarding, and deleting all happen inside the Mezzo Companion now — there is no second, page-level implementation of any of it to keep in sync, and no handoff between two surfaces to reason about.

## Selecting a Profile

Ready's selector shows whichever profile is currently active, and expands into a panel listing every available one. When both an unsaved and one or more saved profiles exist, the panel groups them — an "Unsaved" section first, with a note that it disappears when Mezzo closes, then a "Saved profiles" section — rather than mixing them into one flat list. Selecting a row updates the current selection and closes the panel; it never starts monitoring, and never deletes or discards anything else. Each saved profile's row includes a delete control; the unsaved profile's row includes a discard control instead.

## Saved-Profile Actions

With a saved profile selected, Ready offers **Recalibrate** always, and **Create new profile** only while fewer than five profiles are saved — hidden entirely at the limit, since starting a new one there would lead nowhere until an existing profile is deleted first. Create new profile begins calibration from scratch, through the calibration-introduction step (see "Calibration"), producing a fresh unsaved profile; it does not touch the selected saved profile at all.

## Saving and Replacement

With an unsaved profile selected, Ready also offers **Save profile**. Below the five-profile limit, this opens a naming screen — "Name this profile" — with Cancel and Save actions; Save stays disabled until a name is entered.

* A name that doesn't match any saved profile's name creates a new saved profile, selects it, and removes the unsaved profile. A toast confirms: `Profile "{Name}" saved`.
* A name that matches an existing saved profile's name instead — trimmed, case-insensitive; a saved profile's own stored display name and casing are never changed by this comparison — shows a warning (`A profile named "{Name}" already exists.`) and changes the button from Save to Replace. Replacing overwrites that profile's calibration in place, exactly as Recalibrate's own Replace would, removes the unsaved profile, and selects the replaced profile. A toast confirms instead: `Profile "{Name}" replaced`.
* **Cancel** returns to Ready, leaving the unsaved profile exactly as it was.

Both Save and Replace show a brief processing state on their own button, and guard against a duplicate submission, before the toast appears. The toast is transient, announces itself politely to assistive tech, and never shifts Ready's layout or takes focus.

Recalibrate remains the primary, deliberate way to intentionally update a known profile. The naming screen's own name-matching path is an equivalent, explicit alternative for the moment an unsaved profile turns out to belong to a profile the user already has — not a second, looser way to overwrite something by accident.

## Five-Profile Limit

Five saved profiles is the maximum. The limit applies only to saved profiles — an unsaved profile stays fully usable even when five are already saved. Selecting **Save profile** while at the limit doesn't open the naming screen at all; instead it shows a dedicated screen: `5 of 5 profiles saved` / `Delete a saved profile before saving this one.` — a close action only, no delete or replacement control embedded in it. The user has to open the selector, delete a saved profile there, then choose Save profile again.

## Discarding an Unsaved Profile

Discard, from the selector's own row-level control, removes the unsaved profile with no confirmation — nothing was ever saved for it to protect. If the unsaved profile was the one selected: a saved profile still existing afterward means the most recently used one becomes selected; none existing means the Companion returns to Welcome, exactly as if calibration had never happened. If a different, saved profile was selected instead, discarding the unsaved one leaves that selection untouched — removing it from the background never changes what's active.

## Deleting a Saved Profile

Deleting a saved profile uses a dedicated, full-screen confirmation — never a small floating dialog or a browser-native confirmation — asking plainly whether to permanently remove it. Canceling changes nothing. Confirming shows a brief processing state on Delete, with Cancel disabled for that same moment, before actually removing it — then, if it was the selected profile, falls back in order: the unsaved profile, if one exists; otherwise the most recently used remaining saved profile; otherwise Welcome, if nothing usable is left at all. If removal doesn't succeed, both actions become available again, the profile stays in the library exactly as it was, the current selection is untouched, and a brief, calm message explains it didn't work — the screen never remains stuck on its processing state.

Renaming a saved profile does not exist as a feature yet. If it's ever built, it belongs here too, alongside delete.

---

# Monitoring States

These are the four awareness states shown while the Companion is Monitoring — distinct from the Companion's own Ready/Monitoring states above, which describe what the Companion is doing rather than how loud the user is. Display labels (2026-08-18 redesign — sentence case, see `CLAUDE.md`'s Canonical Terminology): Listening, Within range, Approaching end of range, Outside range. The zone-classification logic, thresholds, and visualization behavior these headings describe are unchanged by that relabeling — only the on-screen wording and casing changed.

Monitoring states describe what is happening.

They do not evaluate the user.

They do not prescribe behavior.

## Listening

The user is not currently speaking, or speech remains below the active speaking threshold. (Display label retired from "Quiet" as of the 2026-08-18 redesign; the underlying zone is unchanged.)

Visual characteristics:

* calm field
* subtle continuous motion
* minimal propagation
* quiet reassurance that monitoring is active

Listening is not a negative state.

---

## Within range

The user's speaking volume is within the preferred range.

Visual characteristics:

* center point
* one perfect circular contour
* warm white
* gentle breathing
* subtle glow while speaking
* restrained propagation

This state should feel calm and balanced.

---

## Approaching end of range

The user's speaking volume is moving toward the edge of the preferred range.

Visual characteristics:

* second contour appears
* outer contour becomes slightly organic
* motion becomes more noticeable
* remains warm white

Purpose:

Provide gentle awareness before stronger visual emphasis becomes necessary.

Approaching end of range is descriptive, not corrective. It supersedes the older "Approaching Range" label (and, as of the 2026-08-18 redesign, the Title Case "Approaching End of Range" — casing only, same term) — use this exact sentence-case form consistently.

---

## Outside range

The user's speaking volume is outside the preferred range.

Visual characteristics:

* third contour appears
* visualization transitions to Mezzo orange
* stronger glow
* increased propagation
* smooth continuous motion

Never:

* blink
* flash
* pulse aggressively
* simulate alarms

Outside range communicates awareness without judgment.

---

# Visualization Principles

The visualization behaves like a natural system.

Changes should feel like changes in energy rather than software notifications.

## Geometry

The visualization grows through accumulation.

Each monitoring state adds information rather than replacing the previous state.

Concretely: rising energy introduces a new outer contour that emerges from the currently active contour's own displayed size — not from nothing, and not from a fixed resting radius — and grows outward smoothly from there. That new outer contour becomes the active, radiating one the moment it starts emerging. Falling energy reverses this the same way: the outer contour recedes and radiating activity transfers back to the next contour inward, rather than the whole visualization jumping between fixed states.

The container remains fixed.

The visualization should never cause surrounding layout changes.

---

## Motion

Motion communicates state.

It should never exist purely for decoration.

Motion should feel:

* continuous
* organic
* restrained
* responsive

Avoid abrupt transitions whenever possible.

---

## Color

Color reinforces state.

It should not become the primary communication channel.

Warm white communicates normal activity.

Mezzo orange communicates increased awareness.

The transition between them should remain smooth and continuous.

---

## Propagation

Propagation should appear to originate naturally from the visualization.

When contours become organic, propagated contours should inherit that same geometry.

Avoid detached, perfectly circular propagation once the active contour has evolved into a more organic form.

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

Monitoring can never continue without the Mezzo Companion open. If the Companion closes — only ever via its native window-close control, since there is no in-app Close Companion action — whatever was happening stops immediately, and microphone resources are released, not left running invisibly. What that means depends on the state the Companion was in:

* **Monitoring, with a saved profile in use** — monitoring simply stops, exactly as if Stop had been pressed, then the Companion closes.
* **Monitoring, with an unsaved profile in use** — the same stop happens, but the native window-close control cannot be intercepted to offer a save decision first, so the unsaved profile is lost with no way to recover it afterward (see "Profile Model" — this is by design, not an oversight: an unsaved profile is held in memory only, specifically so it can't outlive the Companion window). Home should calmly acknowledge this — e.g. noting that the last session's calibration wasn't saved — rather than implying anything was preserved. This is a real, known tradeoff: the interceptable **Close Companion** button on this same page (see "Dock Experience") could in principle offer a save decision before closing, since it isn't a native browser control; whether it should is an open product question, not yet settled.
* **Welcome, C1, or Calibrating** — nothing has been created yet at Welcome or C1, so there's nothing to lose; mid-capture in Calibrating, capture stops immediately and whatever partial samples existed are discarded. A recalibration in progress leaves its target saved profile completely untouched; closing mid-Recalibrate is always safe for the profile being recalibrated.
* **A profile save/replace/delete decision screen open** — closes cleanly with no partial write: none of these screens touch storage until their own explicit affirmative action (Save, Replace, Delete) actually completes.

There is no separate "Mezzo Companion is closed" status screen and no Re-open Companion action. Instead, Mezzo returns directly to Home. Home does not track or display which profile was in use, or offer to resume anything — its one action, regardless of how the previous session ended, is:

Open Mezzo Companion

Selecting it opens a fresh Companion, which then decides Welcome or Ready for itself the same way it always does — it never resumes monitoring on its own, and Home never makes that decision on the Companion's behalf.

---

## Mezzo Closed

Closing the Dock (the browser tab) ends the monitoring session — this is the primary way a session ends; there is no dedicated End Session control.

When possible, users should understand this before the page closes — see the Dock's own footer guidance ("Closing it will also close the Mezzo Companion").

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
* on Home, while introducing the product
* on the Privacy page

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
