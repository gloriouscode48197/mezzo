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

Onboarding purpose: reduce uncertainty about *what Mezzo is*, then hand off to the Mezzo Companion. It no longer introduces speaking profiles or supports calibration — none of that happens here. It does, however, explain microphone access and request it — the one deliberate exception to "everything operational lives in the Companion" (see "Learn About Mezzo," below, and CLAUDE.md's Non-Negotiable Decisions).

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
* "Keep this page open while you use Mezzo"
* "It runs your Companion. You can minimize this window or switch tabs, but closing this page closes the Companion. When you're done, click Close Companion."
* **Close Companion**, a quiet text link: the recovery action for a Companion buried behind other windows — the one thing this page is allowed to do

The status line collapses the Companion's states to one distinction: Welcome, Ready, Calibrating and every decision screen all read "not active." No calibration UI, no profile UI, no Start monitoring, no Stop, no Save.

**Reopen Companion.** Chrome allows one picture-in-picture window at a time, and the newest wins: Meet's mini window (opened manually, or automatically on a tab switch or screen share) closes the Companion. When the Companion closes in any way other than this page's Close Companion link — which includes its own native ✕, since the two look the same from inside — the page stays on the cream surface with the status line "Monitoring is not active" (as on the open page) above "The Companion closed", a **Reopen Companion** button and a **Done** link. Reopen opens it again from that click with the same profile (an unsaved one included, still in memory only), and resumes monitoring if it was running. Done returns to the granted page. The status line matches the open page's (2026-11-11), so the line above the heading always says whether monitoring is running, and here it confirms nothing is listening: the microphone is released whenever the Companion closes, including a close that lands while the microphone was still being opened (2026-11-10), so Mezzo never listens while nothing is shown. That page keeps the privacy line, "Mezzo only measures volume. Nothing you say is recorded."

**Meet in the same window.** If Mezzo and Meet are tabs in the same window and the user switches to the Mezzo tab during a call, Meet opens its mini window, the Companion closes, and the page shows "The Companion closed" with Reopen. With Mezzo in its own window, switching to it isn't a tab switch, and the Companion stays open (confirmed in a real Meet call, 2026-10-26). This is why the extension opens Mezzo in its own window.

The Mezzo Companion, not the Dock, is meant to stay available across an entire meeting-filled day — monitoring starts and stops independently inside it, session by session, without the Companion needing to reopen.

User-facing copy never names this page; it says what to do with it: "Keep this page open while you use Mezzo." (2026-11-13; was "Your Companion is open". The page has to stay open because it runs the Companion, and it may be minimized or left behind other tabs, but closing it closes the Companion.)

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

Create speaking profile — Welcome's one action; opens Step 1's prep screen. Microphone access is already granted by this point, so nothing is requested again here.

↓

Step 1 of 2 — "First, let's hear the room"; I'm ready starts 3 seconds of listening to the room (the microphone was already granted back on the marketing page, so this resolves silently, with no second prompt)

↓

Step 2 of 2 — "Now speak at the level you want to maintain"; I'm ready starts 6 seconds of listening to the voice; no manual "I'm done" action (see "Calibration")

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

Every calibration is two steps, and each step has a prep screen and a listening screen ("say it once, then count"): the prep screen says which step it is, what to do and for how long, then waits for **I'm ready**; the listening screen only names what Mezzo is listening to, with a large countdown. Nothing is measured on a prep screen.

* **First-time setup**: Welcome's **Create speaking profile** → Step 1 prep → Step 1 listening (3s) → Step 2 prep → Step 2 listening (6s) → the result screen.
* **Create new profile**, from Ready's selector: the same steps.
* **Recalibrate**, on a saved profile: the same steps, ending on the recalibration result ("New calibration ready"). Every screen of the flow (both prep screens, both listening screens, the processing screen and the result) has the same header bar, "Recalibrating {name}": 44px, slate, a bottom border, a mono 11px uppercase label. Each screen's own layout is unchanged below it, centered in the space under the bar; the steps keep their charcoal background and the result its slate one.
* **Recalibrate**, on the temporary profile: by design, it's a new calibration, so it takes the first-time steps with no header bar, processes as "Creating your speaking profile…" and ends on the new-profile result. First-time setup and Create new profile have no bar either.

There is no separate introduction screen any more: the old "Create speaking profile" screen with its "I'm ready" (C1) is retired, since each step's prep screen does its job.

### The Steps

**Step 1 prep**: "Step 1 of 2" / **First, let's hear the room** / "For 3 seconds, Mezzo measures the background noise without your voice, so it can tell the two apart." / **I'm ready** / Cancel.

**Step 1 listening**: "Step 1 of 2" / **Background noise only (no talking)**, with "(no talking)" on its own line, then a 3-to-1 countdown, the six-segment level meter showing the live level, and "Mezzo is listening to the room." under it. The room's noise level is measured during these 3 seconds and saved with the profile.

**Step 2 prep**: "Step 2 of 2" / **Now speak at the level you want to maintain** / "Talk for 6 seconds at a level that won't carry to people nearby." / **I'm ready** / Cancel. The microphone stays open between the steps, but nothing is measured until I'm ready.

**Step 2 listening**: "Step 2 of 2" / **Keep talking until the timer ends**, then a 6-to-1 countdown, the meter, and "At a level that won't carry to people nearby." under it. The voice is captured during these 6 seconds. It completes on its own; there is no "I'm done" action.

Both listening screens share one layout and the same sage meter. They lead with the instruction: after a few runs people skim the prep screens and only read the screen they can't leave, so the instruction is the heading and the countdown is smaller (48px). The heading always reserves two lines, so the countdown and meter sit in the same place in both steps and on the processing screen after them. Cancel is pinned at the bottom of each. Prep screens use the single-choice layout (eyebrow, 8, heading, 8, body, 24, I'm ready, then Cancel); listening screens use the sequence layout (eyebrow, 8, heading at the top; the countdown, 16, the meter, 8, the helper, centered below). When recalibrating a saved profile, the "Recalibrating {name}" bar sits above all of it.

* **Cancel**, from any step, stops calibration, discards what it measured, and returns to where it started: Welcome for first-time setup, Ready otherwise.
* **Try again**, after a failure: "Didn't catch enough clear speech" (or any other failure of the voice capture) returns to Step 2's prep screen, since the room reading is still valid; a failure before the room was measured (the microphone, or calibration already open in another Mezzo tab) returns to Step 1's.

Focus moves to the heading on each prep screen. Each listening screen is announced once, politely, reading the step and the heading ("Step 1 of 2. Background noise only (no talking). 3 seconds."; "Step 2 of 2. Keep talking until the timer ends. 6 seconds."), never every second; the countdown itself is hidden from screen readers. Screens switch without animation. If acquiring the microphone takes a moment, "Preparing microphone…" shows in the countdown's place until the step starts. Exact sizes and values: `docs/prd/range-ring-and-lantern-refresh.md` §8.

If microphone access is blocked or denied at this point — access must have been revoked after the Companion already opened, since Home's own permission gate already ensured it was granted before the Companion could open at all — calibration cannot continue: a dedicated recovery screen explains what happened and how to fix it (see "Companion States → Microphone Access Blocked"), with an in-app Try again rather than requiring a manual page reload.

### On Completion

A brief processing moment — "Saving your calibration…" when recalibrating a saved profile, otherwise "Creating your speaking profile…", with a spinner where the countdown was and no Cancel — then a decision screen whose actions depend on why calibration was run. If speech sat less than 10 dB above the room's own noise, either screen also says: "Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic." (10 dB since 2026-11-10, was 12: quiet offices with a soft meeting voice measured 11.7 to 14.2 dB and got the tip about a third of the time, while genuinely noisy rooms measured 5.5 and 8.3. The circle's own noise gate, 4 dB above the room or 2 dB where speech sits under 12 dB above it, is unchanged.)

**A new profile** (Create speaking profile, Create new profile, or Recalibrate on the temporary profile) shows "Your new speaking profile is ready" / "What would you like to do with it?":

* **Save speaking profile** — opens the naming screen (see "Profile Model → Saving and Updating")
* **Keep temporarily** — keeps it as the temporary profile, selected on Ready ("Available until you close the Companion")
* **Discard** — throws it away and restores the previous selection (or Welcome, if nothing else exists)

**Recalibrate, on a saved profile**, does not touch that profile yet. It shows "New calibration ready" / "Save it to “{name}”?", with:

* **Update “{name}”** — overwrites the saved profile's calibration in place, keeping its name and identity, and returns to Ready with it selected, where a toast confirms: `Profile “{name}” updated`
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

## Study Check-In (Round 4)

Only for study testers; without a tester code none of this shows and nothing is stored. Settings: `src/study-config.js`. Logic: `src/study.js`. The whole journey, every surface's copy, the data sent, edge cases and the reason behind each decision: `docs/ux/round4-study.md`.

* **Tester code.** Opening any Mezzo page (Home or `/study`) with `?study=CODE` saves the code in this browser, for the whole site: sessions started from Home, the extension's meeting prompt or its toolbar all use it. The stage, the first-session date and the last session belong to the code: a new code starts at "Your usual calls", and switching back to an earlier code finds its own again. `?study=clear` removes the code and every code's study data. The parameter then leaves the address bar.
* **Session data.** Each monitoring session's length (Start to Stop), speaking time and glow count are kept as "the last session" while a code is saved. Speaking time is the time the circle's noise gate counted the level as voice (it stays open about a second after each phrase while the circle eases down, and that counts too); glows are one per move into Outside range, from the zone the engine already committed. Both only read what monitoring already computes. Stop, closing the Companion and closing the page all end it. Reopen Companion after an involuntary close continues the same session.
* **When the check-in is offered.** A session with at least 1 minute of speech (`minSpeechMs`; there is no minimum length, 2026-11-11), ended under 2 hours ago, during the study's 14 days, not yet opened or skipped. A pending check-in stays in every view below until it's opened, skipped, or the 2 hours pass; opening or skipping it anywhere clears it everywhere, in this tab and others. Once per session (a session continued by Reopen keeps its answer).
* **Card.** On Ready, below the privacy line: "How did your call go?", "1-minute check-in", **Open check-in** (filled with a translucent cream, lighter than Start monitoring; opens the check-in form in a new tab, pre-filled) and **Skip this one**, on a panel slightly lighter than the window, no chartreuse. Because it reads the stored last session, a session ended by closing the window gets its card the next time the Companion opens to Ready. It never covers or disables Start monitoring.
* **Page cards.** "Call over? How did your call go?", **Open check-in** and **Skip this one**, on the main tab in every view where a check-in can be pending (one card per view, the same pending check-in):
  * the **"Companion closed"** page, below Reopen Companion and Done. Open check-in there ends the call like Stop (Reopen then opens to Ready); source `companion_closed`. Reopen continues the session, and the card waits while that call runs.
  * the **"Keep this page open"** page, below Close Companion, while the Companion isn't monitoring (hidden mid-call, including while Reopen is continuing one); source `companion_open`.
  * the page the tab returns to after **Done** or **Close Companion** (the granted Home), below Open Mezzo Companion, also on a later visit while one is pending; source `home`.
  Without a tester code none of them show.
* **`/study` page.** Not linked anywhere. Its own look, apart from every Mezzo page: a white page with a short, full-width muted slate-blue (#44607A) header band that scrolls away with the page, reading "Mezzo study" in white (in place of the wordmark) with only a Privacy link, slate-blue buttons with white text (the secondary one outlined in slate), no charcoal, cream or chartreuse, and the same in light and dark system themes. Without a code: "This page is for study participants." With one: "Thanks for joining the Mezzo study", "Your study code: {code}", then all three parts, and "How study data is handled" at the bottom. Each part is a row: its heading, a status on the right and, when it has something to open, a chevron (a real button with `aria-expanded`, so Enter and Space open and close it). The current part starts open. A finished part starts collapsed with "Completed ✓" (in slate). An upcoming part is grayed out (heading, status and line in the muted color, 6.6:1, still easy to read) and shows a status and a one-line description, with no toggle, since nothing in it is reachable yet (its content is removed from the page) and a control that opens nothing would only confuse; its heading stays in the heading outline.
  * **Part 1: Your usual calls** (current in the baseline stage; Part 2 "Unlocks after Part 1": "Use Mezzo on your calls for about 2 weeks. I'll email you when it's ready."; Part 3 "After Part 2": "A few questions about your whole time with Mezzo, about 2 weeks after Part 2 starts. Finish it to get your $5 gift card."): under the study code, "Bookmark this page. You'll come back here after each call.", then "Mezzo comes later. I'll email it to you once you've given feedback on 2 calls." in a callout (a pale slate tint, 10% of the header color, with the normal dark text at about 13:1; the only callout on the page), "For now, take your next 2 calls as you normally would. After each one, come back here and click Check in after a call. It takes about a minute.", then a bordered box with "Only give feedback on calls where:" and a list (you're wearing headphones / people are nearby / you speak, even a little) and, to its right (below it on a phone), **Check in after a call** (the baseline form, tester code only). Below the box, two checkboxes the tester ticks for themselves, "I finished check-in 1" and "I finished check-in 2", kept per tester code in this browser and never sent; with both ticked: "You're done with Part 1. Thank you! I'll email you Mezzo soon.", in the callout's pale slate with a small slate check before it. No way into the app, only the privacy page. Once Part 2 is unlocked, Part 1 is done: its instructions and its check-in button are removed from the page (so no baseline check-in comes in after someone has used Mezzo), and opened it shows the two checkboxes as the tester left them, read only (drawn by the page, so they keep full contrast), and "Thanks for your feedback on your usual calls."
  * **Part 2: With Mezzo**, from `?start=1` (with a code; remembered) or the first monitoring session, whichever comes first. Under the study code: "Bookmark this page. You'll come back here after calls and for the wrap-up." Part 1 done, Part 2 current, Part 3 upcoming ("Opens {Month day}": "A few questions about your whole time with Mezzo. I'll email you a reminder. Finish it to get your $5 gift card."). Two lettered steps (a small slate A or B marker, centered on its heading's line; an ordered list), side by side as equal columns on screens 760px and wider (the stage widens to 760px; tops aligned, and each step's button sits right under its own text, so step A has no gap below it) and stacked on a phone, step A first:
    * "A Use Mezzo on your calls": "Open Mezzo and start monitoring on calls where:" with a list (you're wearing headphones / people are nearby / you'll speak, even a little), then "With the Chrome extension, Mezzo also offers to start when a Google Meet call begins." followed by a **Get the extension** text link to the Chrome Web Store (`STUDY_CONFIG.extensionUrl`; hidden while it's empty), then **Open Mezzo** (through the extension 1.0.6+ when installed: its own normal window, or the open Mezzo brought forward; otherwise an 800×720 window of the page's own, or this tab if that's blocked).
    * "B Check in after your call": "When you stop monitoring, Mezzo asks how your call went. Look for this card:", a small picture of the whole Companion Ready screen, everything but the check-in card dimmed to 40% and the card outlined in a light slate (`study/checkin-card.png`, 200px wide (never wider than its column), rounded with a thin border; regenerated by `tests/capture-study-card.spec.js`), "Please check in after at least 2 calls.", then a small heading "Missed the card?", **Check in after a call** (the check-in form; the last session's data rides along whenever it ended within 2 hours, whatever its speaking time: the 1-minute-of-speech rule is only for the cards), and under it a small note, "Best within 2 hours of your call."
    * **Part 3: Wrap-up**, from day 14: Parts 1 and 2 done and collapsed, Part 3 current and open: "A few questions about your whole time with Mezzo. Finish it to get your $5 gift card." and **Wrap up the study** (tester code only).
* **End of study.** 14 days from the start of the With Mezzo stage (the local date of `?start=1` or the first session, whichever came first), the wrap-up opens and the check-in stops being offered. The tester code stays saved.
* **What's sent.** Nothing by Mezzo. The form link carries the tester code, the existing anonymous ID, the source (`companion`, `companion_closed`, `companion_open`, `home` or `study_page`), and for a recent session (from a card: one that meets the card's rules; from `/study`: one that ended within 2 hours) its date, minutes, speaking minutes (`mezzo_speech_minutes`, one decimal), glow count, the Companion view used most (`mezzo_view`: Expanded, Compact or Mini, by time spent in each) and that view's most-used window size (`mezzo_window`, WIDTHxHEIGHT in pixels, e.g. 240x186), and minutes since it ended; the form records them only if the tester submits it.

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

When a supported meeting is detected, the extension shows a small banner at the top of the meeting page, the same in every case: "Meeting detected" / "Monitor with Mezzo?", a cream **Open Mezzo** button, a **Not now** text button, and an X (Dismiss). It uses the Lantern look of the extension popup: a charcoal card with no icon. **Open Mezzo** works like the popup's buttons: if a Mezzo tab is open, that tab and its window come forward (never reloaded or duplicated); otherwise Mezzo opens in its own window. **Not now** and the X dismiss the banner for this meeting; it shows again only on the next call.

Selecting Open Mezzo should:

* open Mezzo
* restore the previous profile when possible
* allow the user to review their setup — now inside the Companion's own Ready screen, not on Home, since Home no longer shows profile information
* require an explicit Start monitoring action

Do not imply that monitoring begins directly from the meeting prompt.

The user should always begin monitoring intentionally.

Today, "Open Mezzo" opens Mezzo in its own Chrome window, in front and focused (or brings the existing one forward) — a normal window with an address bar, about 800×720, lined up with the meeting window's right edge and kept fully on screen — on Home; the user still clicks Open Mezzo Companion there, since Chrome only opens a Companion from a click inside the Mezzo page. It's a separate window rather than a tab next to the meeting, since switching tabs can trigger Meet's mini window; and it keeps the address bar, since its site controls are how someone fixes a blocked microphone. There is never a second Mezzo: both the toolbar popup and the meeting banner find Mezzo's Home in any tab of any window (matching the site's address, not only the window the extension made) and bring that one forward instead.

## Extension Popup

The toolbar popup says plainly what is open, the Mezzo tab (the page) or the Companion (the floating window), in one of four states:

* **No Mezzo tab** — the "mezzo" wordmark (no status chip), "A gentle nudge when you're talking louder than you'd like.", a cream **Open Mezzo** button, and "Opens in its own window." / "Only measures volume."
* **The Mezzo tab is open, no Companion** — a muted "TAB OPEN" chip with an outline dot, "The Mezzo tab is open. Open the Companion from there to start.", and a cream **Go to Mezzo tab** button.
* **The Companion is open, not monitoring** — a sage "COMPANION OPEN" chip with an outline dot, "Your Companion is open, but not monitoring. It floats above your other windows.", and an outline **Go to Mezzo tab** button.
* **Monitoring** — a sage "MONITORING" chip with a solid dot, "Mezzo is monitoring. The Companion floats above your other windows.", and an outline **Go to Mezzo tab** button.

Every state keeps the Privacy and Settings links. **Go to Mezzo tab** focuses the existing Mezzo tab and its window (restoring it if minimized); it never opens a new tab and never navigates or reloads the page. The popup only sends `FOCUS_MEZZO_TAB` to the background and closes; the background finds the Mezzo tab, activates it, then focuses its window (or opens Mezzo if the tab closed meanwhile). Focusing a window closes the popup, so the popup can't finish the switch itself. The popup never tries to open or focus the Companion: Chrome only opens one from a click inside the page, extensions can't focus it, and it already floats above other windows.

The popup learns the state from the Mezzo tab itself, from the same session state as the running page's "Monitoring is active / not active" line, so the two never disagree. It asks when it opens and updates live while it's open; if the tab doesn't answer within about 300ms, it shows "TAB OPEN". It never shows a profile name or anything about volume. In a locally loaded (developer) copy only, Settings has a Mezzo address field, so the extension can open a preview deployment instead of the live site. The toolbar badge marks a detected meeting with a cream dot on charcoal.

**Permissions (1.0.6, 2026-11-09).** Host access is the Mezzo site only. Meeting detection runs from the content script's own matches (Meet, Zoom, Teams), so it needs no host access of its own; only finding the Mezzo tab does. Less access means a shorter install warning. 1.0.6 also lets `/study`'s Open Mezzo ask the extension to open Mezzo, through the page bridge, so it uses the same launcher as the popup and banner.

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

Before monitoring ever begins, the Companion moves through several distinct screens — Welcome, the two calibration steps (each a prep screen and a listening screen), and Ready, plus recovery and decision screens (Microphone Access Blocked, the calibration result, and the profile save/replace/delete decisions covered under "Profile Model") — before reaching Monitoring itself, which has two layouts, Compact and Expanded. See below for each.

Every screen follows one spacing scale and one 280px column, in three layouts: a sequence (the listening screens), with the eyebrow fixed at the top so nothing moves between steps; a single choice (Welcome, the calibration prep screens, Ready), centered, with 24px between groups; and a decision (the result and save/update/delete screens), centered below the decision bar. It uses the Lantern visual system throughout (`docs/prd/range-ring-and-lantern-refresh.md` §4): one dark theme, Geist type, cream primary buttons, sage text links, and chartreuse reserved for one meaning inside the product (the Companion and the extension) — the over-range band. Screens come in three layers: a flat screen, the Ready selector's menu panel over a dimmed screen, and decision states, which turn the whole window a lighter grey with a 44px header bar naming the decision and actions pinned to the bottom.

---

# Companion States

They should never feel like one screen with elements shown or hidden — each is a genuinely different experience with a different purpose, even though most of the pre-monitoring ones share one fixed size (see "Companion Sizing," below).

## Welcome

Purpose: the first thing a genuinely new user sees inside the Companion — a deliberate moment, not an instant redirect into calibration.

Target size: shared with every other pre-monitoring screen — see "Companion Sizing."

Reached exactly once: the very first time the Companion opens with zero saved profiles and no temporary profile (see "Profile Model"). Shows the lowercase "mezzo" wordmark as its heading, "A gentle nudge when you're talking louder than you'd like. First, a quick voice calibration.", then **Create speaking profile** with "Mezzo only measures volume. Nothing you say is recorded." beneath it. The window's own title reads "Mezzo, welcome." here. Its one action, **Create speaking profile**, opens Step 1's prep screen (see "Calibration → The Steps"); this does not itself request microphone access. There is no secondary dismiss action on Welcome; closing the Companion remains available through the native window control regardless of which screen is showing.

Once a saved profile or an unsaved profile exists, the Companion never shows Welcome again for the rest of that Companion-open lifetime.

## Calibration Prep (Step 1 and Step 2)

Purpose: say which step is next, what to do and for how long, before anything is measured.

Target size: shared with every other pre-monitoring screen.

Step 1's prep screen is where every calibration starts: Welcome's Create speaking profile, Ready's Create new profile, and Recalibrate. Step 2's follows Step 1's listening screen, or a failed voice capture's Try again. Each has one action, **I'm ready**, which starts that step's listening, and a **Cancel** link back to where calibration started. See "Calibration → The Steps" for the copy.

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

Reached from either prep screen's "I'm ready" (see "Calibration → The Steps"). Shows Step 1's 3-second room listening or Step 2's 6-second voice listening, with the large countdown and the live level meter, a brief automatic completion, and then the mode-appropriate result screen — a navigation, not a modal overlaid on this one. On a microphone-permission failure specifically, shows the dedicated Microphone Access Blocked screen below instead of a generic failure message; every other failure shows a calm, specific message with Try Again/Back, and never fails silently.

Calibrating always uses the shared pre-monitoring size — it never appears in Compact.

Its Cancel link stops capture and returns to where calibration started; closing the Companion does the same, per "Mezzo Companion Closed" under Recovery, below.

---

## Microphone Access Blocked

Purpose: recovery, specifically for a denied or unavailable microphone — a dedicated screen, not the generic Calibration Failed message every other failure uses. Now a narrower, defensive case than it once was: Home's own permission gate (see "Learn About Mezzo") handles the primary, before-the-Companion-opens denial, so this screen is reached only if access is revoked *after* the Companion has already opened — most plausibly during a later Recalibrate. It is kept, deliberately, rather than retired, precisely because Home's gate can't prevent that later case.

Target size: shared with every other pre-monitoring screen.

Explains what happened and how to fix it, alongside a schematic illustration pointing at the browser's own address-bar permission icon, and offers an in-app **Try again**, which returns to the prep screen of the step that needs repeating (no manual page reload needed), alongside **Back**, which returns to where calibration started.

---

## Monitoring

Purpose: ambient awareness.

Monitoring opens in **Compact** (220×220 requested; Chrome won't make the window narrower than 240, so it shows at about 240×186 inside), the peripheral default; **Expand** resizes it to Expanded (382×512, the same size as Ready, so going from Ready to Expanded never changes the window's size). Both are `applyLayoutMode()`'s targets for an explicit action — manual resizing is otherwise freeform, at any aspect ratio, and never snaps back.

What the window shows depends on its **size band**, keyed off its short side and recomputed on every resize (never on the layout mode): **Mini** under 160px, **Compact** 160 to 299px, **Expanded** 300px and up. Controls sit 8, 12, or 16px from the edges respectively.

It shows:

* the **Range Ring** — the live visualization (see "Monitoring States" and "Visualization Principles"). **Compact and Mini** (2026-11-11): the ring is the largest thing in the window, beside the toolbar, and sized by its far-over extent, the circle plus its widest band plus the glow's visible reach. It's the largest circle in the window that keeps clear of the edge-docked toolbar (with a 2px margin), so it's never clipped and never reaches the toolbar, at any window size, and the ring is never more than 80% of the short side. At Compact's real 240×186 that's a 126px ring, about 68% of the short side, and the same at 186×240; a square Compact window leaves less room beside the toolbar (119px at 220×220). **Mini** (2026-11-12) sizes the ring to the whole window as if the toolbar weren't there, with the far-over glow clear of the window's edges: the toolbar only fades in on hover or focus, floating over the ring; the ring never moves or resizes for it (66px at 280×110, 85px at 140×140, about 60% of the short side). The name was dropped and the controls grouped so the ring is the largest element in a small window. The glow keeps its full size on purpose: noticing the nudge matters more than a bigger resting ring. **Expanded:** it's sized for its loudest state: at full Outside range, the circle plus its widest band fills the space between the top row (name, Compact view) and the bottom row (Stop), less an equal gap above and below (the band's edge spacing), and it's centered in that space. The soft glow isn't counted there: it may reach into the gap and under the name, never the controls, and it stays inside the window's width (the window's side would otherwise cut it off visibly). While the ring is Outside range, and only then, a soft oval of the window's own background fades in behind the name, feathered to transparent at its edges, which keeps the name at 4.5:1 over the glow; at rest nothing is drawn there. In the Compact band the band's widest width is capped at 0.1 of the edge (0.18 elsewhere), with its whole range scaled down so it still grows with how far over, which lets the ring itself be larger. At 382×512 the edge is about 238px (limited by the glow and the window's width).
* the selected profile name (read only), centered in the top row, in Expanded only: Geist Mono 11px, 0.12em letter-spacing, uppercase via CSS, #B0AB9E, visible in every ring state. Hidden in Compact and Mini (2026-11-11), where the ring takes the whole window.
* **Stop.** In Mini and Compact (2026-11-11) it shares a small toolbar with Expand: one low-contrast panel (a faint cream outline over the window's own color, never chartreuse), docked in the bottom-right corner, flush with the window's edges (2026-11-13): when the window is wider than tall, against the right edge, Stop above Expand; otherwise against the bottom edge, Stop left of Expand; 16px apart, with Expand always in the corner. Only the corner facing into the window is rounded, and the sides touching the window have no border. (History: pinned to the corner with a gap on 2026-11-12, then centered on an edge the same day, then anchored in the corner again, now flush.) The ring is the largest circle that keeps clear of it. **In Mini** (2026-11-12) the toolbar fades in on hover or keyboard focus (and out 2s after both leave). It docks to the edge as in Compact when its whole panel, buttons included, stays clear of the ring's far-over glow (at 280×110, on the right). Otherwise (at 140×140) it floats over the ring, centered in the window, which is the ring's center: Stop and Expand side by side, 16px apart, on a solid backing in the window's own color with the faint outline and rounded corners on every side, so the icons stay readable over the far-over band. **At rest** (2026-11-13) the panel is filled with the window's own color, never lighter, so it doesn't read as a block; a fainter outline keeps the controls recognizable, and the icons are a muted gray (#7E7A72, about 3:1, the minimum for visible controls), so only the glow draws the eye. With the pointer over the window or keyboard focus in it, the icons return to full contrast (#B0AB9E) and the panel lightens slightly; hovering a button still turns it cream. Mini's floating toolbar is solid either way, so it reads over the glow. The placement comes from the window size alone, measured against the far-over glow rather than the current one, so it never changes with volume; it's recalculated on resize. There Stop is icon-only: a 10px square in a 32×32 target. In Expanded it's a labeled "Stop" button styled like the secondary buttons, bottom-left. Its accessible name is always "Stop monitoring".
* **Expand** (Mini and Compact, the toolbar's second button) or **Compact view** (Expanded, top-right), 32×32.

Icons are #B0AB9E at full opacity (about 6:1 on charcoal). On hover an icon turns cream over a 10% cream square (16% while pressed), and after about 500ms a small tooltip names it, beside the control and never over the ring (in Mini, where the ring has the whole window, it's shown above or below the control, or not at all). Expanded's Stop strengthens its border and adds a faint fill on hover. Keyboard focus gets the sage ring and no tooltip. Color and background change over 120ms, with no transition under reduced motion.

In **Mini** the window shows only the ring at rest. The pointer entering it, or keyboard focus on a control, fades Stop and Expand in (150ms) over soft top and bottom scrims; they hide again 2 seconds after the pointer leaves and focus moves out. They stay in the tab order the whole time.

There is no visible status text: the four zone labels are announced to screen readers only (see "Monitoring States"). There is no Pause — Stop and Start monitoring cover it, and one control keeps the window quiet.

Users cannot change profiles, calibrate, or recalibrate while monitoring — all three require stopping first.

Stopping monitoring ends the session, releases the microphone, and returns directly to Ready with the same profile selected — see "Monitoring Lifecycle."

---

## Companion Sizing

Welcome, the calibration prep and listening screens, Microphone Access Blocked, Ready, and every profile save/replace/delete decision screen (see "Profile Model") all share one fixed size, 382×512, regardless of how many profiles are saved. Expanded Monitoring is the same size, so the window stays the same from opening through calibration, Ready and Expanded; only Compact is smaller. Ready used to grow taller as more profiles were saved, each shown as an always-visible row; the current selector instead expands as an overlay panel that scrolls internally within the existing card, so the surrounding window never needs to resize as the profile library grows. Monitoring keeps its own two sizes, Expanded and Compact, unrelated to profile count. Monitoring's pixel values are under "Compact Companion."

---

# Compact Companion

Compact is an intentional product mode, and the default for every monitoring session — not a responsive fallback for small windows.

Target size: 220×220.

It exists only while monitoring. Its purpose is peripheral awareness: the ring and a small toolbar with an icon-only Stop and Expand, always visible (the profile name shows in Expanded) (see "Monitoring" for the size bands; a window shrunk under 160px on the short side becomes Mini, which shows the controls only on hover or focus).

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

A saved profile stores its id, name, speaking level, spread, calibration time, `peakDb` (how far above the speaking level the calibration's own peaks reached) and `roomNoiseDb` (the room's noise during calibration's Step 1). A profile saved before peaks were recorded still works, with an older end-of-range rule, and Ready suggests recalibrating it.

Calibration, recalibration, profile selection, saving, replacing, discarding, and deleting all happen inside the Mezzo Companion now — there is no second, page-level implementation of any of it to keep in sync, and no handoff between two surfaces to reason about.

## Selecting a Profile

Ready's selector shows whichever profile is currently active, and opens a panel listing every available one. When both a temporary and one or more saved profiles exist, the panel groups them — a "Temporary" section first, with the note "Disappears when you close Mezzo", then a "Saved profiles" section. Selecting a row updates the current selection and closes the panel; it never starts monitoring, and never deletes or discards anything else. Every row has a Recalibrate icon action, a circular arrow ("do it again"; a pencil would suggest edit or rename, which Mezzo doesn't offer); each saved profile's row also has Delete, and the temporary profile's row has Discard, a trash can. Both icons share one size, stroke, color and set of hover, pressed and focus states. **Create new profile** is the panel's footer action.

## Saved-Profile Actions

**Recalibrate** (any row) and **Create new profile** (the panel footer) are always available. Create new profile begins calibration from scratch, through the calibration-introduction step (see "Calibration"); it does not touch the selected saved profile at all. At five saved profiles it shows the five-profile-limit screen instead, without starting calibration.

## Saving and Updating

With the temporary profile selected, Ready offers **Save profile** (the result screen's **Save speaking profile** does the same). Below the five-profile limit, this opens a naming screen — "Name this profile" — with Cancel and Save actions; Save stays disabled until a name is entered.

* A name that doesn't match any saved profile's name creates a new saved profile, selects it, and removes the unsaved profile. A toast confirms: `Profile “{Name}” saved`.
* A name that matches an existing saved profile's name instead — trimmed, case-insensitive; a saved profile's own stored display name and casing are never changed by this comparison — shows a warning (`A profile named “{Name}” already exists.`) and changes the button from Save to Update. Updating overwrites that profile's calibration in place, exactly as Recalibrate's own Update would, removes the unsaved profile, and selects the updated profile. A toast confirms instead: `Profile “{Name}” updated`.
* **Cancel** returns to Ready, leaving the unsaved profile exactly as it was.

Both Save and Update show a brief processing state on their own button, and guard against a duplicate submission, before the toast appears. The toast is transient (a 150ms fade in, about 2 seconds shown, a 200ms fade out; no fading with reduced motion), announces itself politely to assistive tech, and never shifts Ready's layout or takes focus. It's a fully rounded chip, lighter than the window, with a thin cream edge, cream text and a small sage check, so it can't be mistaken for a 3px button. It sits centered 12px below the top of the window; in Monitoring it moves below the profile name and corner controls instead of covering them. Every Companion toast uses it: "Speaking profile saved", Profile “{name}” updated (after Update here or after a recalibration's Update), Profile “{name}” deleted, "Available until you close the Companion", and "New profile discarded".

Recalibrate remains the primary, deliberate way to intentionally update a known profile. The naming screen's own name-matching path is an equivalent, explicit alternative for the moment an unsaved profile turns out to belong to a profile the user already has — not a second, looser way to overwrite something by accident.

## Five-Profile Limit

Five saved profiles is the maximum. The limit applies only to saved profiles — an unsaved profile stays fully usable even when five are already saved. Selecting **Save profile** (or **Create new profile**) while at the limit doesn't open the naming screen or start calibration; instead it shows a dedicated screen: `5 of 5 profiles saved` / `Delete a saved profile before saving this one.` — with **Manage profiles**, which returns to Ready with the selector open so a saved profile can be deleted there, and Cancel in the bar. The user has to open the selector, delete a saved profile there, then choose Save profile again.

## Discarding an Unsaved Profile

Discard, from the selector's own row-level control, removes the unsaved profile with no confirmation — nothing was ever saved for it to protect. If the unsaved profile was the one selected: a saved profile still existing afterward means the most recently used one becomes selected; none existing means the Companion returns to Welcome, exactly as if calibration had never happened. If a different, saved profile was selected instead, discarding the unsaved one leaves that selection untouched — removing it from the background never changes what's active.

## Deleting a Saved Profile

Deleting a saved profile uses a dedicated, full-screen confirmation — never a small floating dialog or a browser-native confirmation — with **Delete** as an outline button (a destructive action isn't the bright default) and Cancel in the bar, asking plainly whether to permanently remove it. Canceling changes nothing. Confirming shows a brief processing state on Delete, with Cancel disabled for that same moment, before actually removing it — then, if it was the selected profile, falls back in order: the unsaved profile, if one exists; otherwise the most recently used remaining saved profile; otherwise Welcome, if nothing usable is left at all. A toast then confirms: `Profile “{name}” deleted`. If removal doesn't succeed, no toast appears: both actions become available again, the profile stays in the library exactly as it was, the current selection is untouched, and a brief, calm message explains it didn't work — the screen never remains stuck on its processing state.

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

* **The container stays fixed.** The ring never causes surrounding layout changes; it's sized once per window size for its loudest state, so the band never reaches the name or Stop when it grows into Outside range.
* **Motion communicates state**, never decoration: the circle rises quickly and falls gently, settles to rest over a second when the user stops speaking, and the band grows from a thin ring and shrinks back before fading, so it doesn't flicker at the edge.
* **Silence and room noise don't move it.** A speech-band filter keeps fan rumble and hiss out of the level, and the circle stays at rest unless the voice is clearly above the room's measured noise.
* **Color reinforces state; it is not the primary channel.** Grey-taupe for the voice, sage for approaching, chartreuse only over range. With reduced motion, the circle still follows the voice, and the band appears at a fixed thickness instead of growing.

Tuned values live in the ring, zone and audio settings objects (`src/range-ring.js`, `src/engine.js`, `src/audio.js`); the public playground at `/playground/` drives a frozen copy of them live. The playground has no wordmark or site bar; its intro starts 32px from the top and ends with a "Use Mezzo in your meetings" link to `/`.

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
* **Any other close** — another picture-in-picture window replacing it (Chrome allows one at a time, and Meet's mini window wins), or the Companion's own native ✕. Chrome doesn't tell Mezzo why the window closed, so these can't be told apart, and the page shows the same thing after the user's own ✕ as after another mini window: it stays on the cream running surface, "The Companion closed" / "If you didn't close it, another mini window like Meet's may have. Reopen it to pick up where you left off.", with **Reopen Companion** and **Done**.
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

Study testers see one extra disclosure: the check-in form link carries their study code, anonymous ID and session numbers, and the form records them only if submitted (Privacy page, "Research participants"; see "Study Check-In" above).

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
