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

It provides gentle, real-time visual awareness relative to a preferred speaking range.

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

* **Before a Companion exists:** introduce the product. Nothing else. No profile selection, no calibration, no microphone permission request — its one action is opening the Mezzo Companion.
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

## Marketing

Purpose:

* introduce Mezzo
* explain its purpose
* establish trust
* communicate privacy
* encourage users to try the product

The marketing experience should feel:

* warm
* editorial
* spacious
* approachable

The product itself should remain the visual hero.

---

## Onboarding

Purpose: introduce Mezzo, then hand off to the Mezzo Companion. Nothing more.

Onboarding no longer explains microphone access, introduces Speaking Profiles, or supports calibration — none of that happens here anymore. It happens inside the Companion, the moment it's relevant (see "Companion States → Welcome" and "Calibration").

Onboarding should reduce uncertainty about *what Mezzo is* before handing off. It is one short moment, not a multi-step preparation sequence — its only interactive element is **Open Mezzo Companion**.

---

## Dock

Internal term only (retired name: Anchor page) — see Canonical Terminology in `CLAUDE.md`. It is the same browser page as Onboarding, before a Companion exists; once a Companion is open, it becomes a minimal status surface that must stay open to keep the Companion running.

The Dock:

* keeps the Mezzo Companion running
* reflects whether monitoring is active or inactive, via a small status indicator
* shows a static, illustrative preview of the Companion — not a live view — so a user who has never opened one knows roughly what to expect
* explains why the page must remain open
* offers Close Companion, a recovery action — the one thing the Dock is allowed to do beyond reporting status
* closes the Companion if it closes itself

It is not the primary monitoring interface, and it is not a second operational surface. It has no calibration UI, no profile UI, no Start Monitoring, no Stop, no Save — it does not duplicate any Companion control, full stop. Its Companion preview does not run a second visualization or reflect real session data — see "Dock Experience," below, for exactly what it shows and why.

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

Marketing Website

↓

Try Mezzo

↓

Learn what Mezzo does

↓

Open Mezzo Companion — the one action on this page; it does not request microphone permission and does not choose anything on the user's behalf

↓

Mezzo Companion opens, showing Welcome — a first-time-only moment, not an instant calibration redirect (see "Companion States → Welcome")

↓

Understand microphone access, inside the Companion

↓

Grant microphone permission, when calibration begins — the first point anything asks for it

↓

Calibrate for this session — a first-time user has no saved profile to reuse, so this is the only path in; speak naturally for a short period

↓

Calibration completes automatically

↓

Calibrated — a temporary Speaking Range is ready. Choose:

* Start Monitoring (uses the temporary range immediately, without saving)
* Save as New Profile (names and persists it, does not by itself start monitoring)
* Try Again (restarts calibration directly, discarding this take)
* Discard (abandons this calibration entirely, returns to Welcome)

↓

Name the profile, if saving

↓

Start Monitoring

↓

Monitoring — using either the temporary calibration or the newly saved profile

↓

Meeting

↓

Stop (inside the Companion)

↓

If the profile in use is still temporary (never saved): a save prompt — "Save this as a speaking profile?" — Save (names it — see "Monitoring Lifecycle" for what naming it can do) or Discard (dropped for good)

↓

Companion Ready (still open — start again, switch profiles, recalibrate, or close)

↓

Close the Dock, or close the Companion natively, to end the session

---

## Learn About Mezzo

Before the Companion ever asks for microphone access, users should understand, from the introductory page alone:

* what Mezzo does
* what Mezzo does not do
* that monitoring begins only when they choose

Microphone access itself is explained later, inside the Companion, at the moment it's actually requested (see "Companion States → Welcome") — not here, since this page never requests it.

Privacy messaging should be specific, calm, and verifiable.

---

## Calibration

Calibration should feel like preparation.

It should never imply that there is one objectively correct speaking volume.

Microphone permission is requested exactly once per browser, at the moment calibration first begins — never earlier (not on Companion open, not on Welcome appearing) and never anywhere outside the Companion. Explain, before capture starts:

* what the user should do
* what Mezzo is measuring
* what will happen next

Calibration completes automatically — there is no manual "I'm done" action. Its result then surfaces as a decision, presented as a modal overlay on top of the calibration screen rather than a separate page. Which actions appear depends on why calibration was run:

**Calibrate for this session** (no existing profile involved):

* Start Monitoring — uses the resulting temporary Speaking Range immediately, without saving
* Save as New Profile — names and persists it as a new Speaking Profile; does not by itself start monitoring
* Try Again — discards this take and restarts calibration capture directly, no separate landing step in between
* Discard — abandons the result entirely, returns to Welcome (zero saved profiles) or Ready (one or more)

**Recalibrate** (refreshing an existing saved profile — "Kitchen," for example):

* Update "Kitchen" & Start Monitoring — writes the new measurement to that profile and starts monitoring
* Update "Kitchen" — writes the new measurement to that profile, returns to Ready, does not start monitoring
* Try Again — discards this take and restarts calibration capture directly
* Discard — abandons the result entirely; "Kitchen" is left exactly as it was before Recalibrate was selected

Never label the recalibrate-mode primary action "Start Monitoring" alone — it also writes to the saved profile, and the label must say so.

Avoid, in either mode: Cancel, Continue Without Saving, Use Once, Not Now.

Nothing is written to a saved profile merely by entering calibration or by capture completing — only the explicit Update actions above do that, and only for the one profile Recalibrate was started from. A session-only calibration never touches any saved profile unless the user explicitly chooses Save as New Profile here, and this specific action always creates a new profile, never overwrites an existing one — Save as New Profile is not the only place a temporary calibration can later be named, though: see "Monitoring Lifecycle" for the Stop-time save prompt, a separate, later moment with its own explicit create-or-update outcome based on the name entered there. There is no path from Calibrate for this session to silently replacing a saved profile — only to explicitly doing so, visibly, by name.

---

## Start Monitoring

There is exactly one Start Monitoring, reachable only from the Companion's own Ready screen — first session of the day and every one after are now the identical action; there is no separate, page-driven "first session" variant anymore.

When the Companion is in its Ready state, show:

* "Ready for the next conversation." (or, the very first time, Welcome — see "Companion States → Welcome")
* selected profile (the previously used one, still selected)
* profile selector, offering any saved profiles and Calibrate for this session
* a Recalibrate action, reachable for a saved profile — whether that's a control on every row or a single action for whichever profile is currently selected (e.g. "Recalibrate Kitchen," appearing once a profile is selected) is not yet settled; compare both at the Companion's real 320px width before building either.
* Start Monitoring

Selecting Start Monitoring should:

* start the monitoring session, with whichever profile is selected, as-is
* lock profile selection
* transition the Companion into its Monitoring state
* transition the Dock into its "Monitoring is active" status

Selecting Recalibrate should transition the Companion into Calibrating, in recalibrate mode for that profile (see "Calibration" above) — not directly into Monitoring.

Monitoring should never begin automatically on its own, without this explicit action. This lets the user start monitoring sessions, recalibrate a saved profile, or run a fresh session-only calibration, at any point in the day, entirely inside the Companion — Mezzo (Home/Dock) is never involved in any of these decisions.

---

# Returning User Journey

Returning users should experience as little friction as possible.

The intended flow is:

Open Mezzo Companion (from Home — the one action; it does not choose a profile itself)

↓

Mezzo Companion opens, showing Ready — previously used saved profile is selected and visible; a temporary calibration that was never saved does not persist across visits and is never what's restored here

↓

Start Monitoring (as-is), or Recalibrate first if the environment has changed

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

If no saved profile exists yet — including when the last session used a temporary calibration that was never saved — the Companion opens to Welcome (zero saved profiles) instead of Ready, and guides the user through Calibrate for this session before monitoring begins.

---

# Meeting Prompt Journey

When a supported meeting is detected, the extension may offer:

Open Mezzo

Not Now

Selecting Open Mezzo should:

* open Mezzo
* restore the previous profile when possible
* allow the user to review their setup — now inside the Companion's own Ready screen, not on Home, since Home no longer shows profile information
* require an explicit Start Monitoring action

Do not imply that monitoring begins directly from the meeting prompt.

The user should always begin monitoring intentionally.

Whether "Open Mezzo" from this prompt should land on Home first (requiring one more click, Open Mezzo Companion) or open the Companion directly, given the user already expressed clear intent by responding to the prompt, has not been revisited under the PiP-first model and is out of scope for this pass.

---

# Monitoring Lifecycle

Every monitoring session, first one of the day and every one after, now follows the identical lifecycle — there is no more special-cased "first session skips Ready because Mezzo already chose a profile" path, because Mezzo never chooses a profile. Opening the Companion always lands on Welcome (zero saved profiles) or Ready (one or more), never straight into Monitoring:

Ready (Mezzo Companion open, monitoring inactive)

↓

Start Monitoring (using the selected saved profile as-is), or Calibrate for this session / Recalibrate first (inside the Companion)

↓

Monitoring Active

↓

Meeting

↓

Stop (inside the Companion)

↓

If the profile just used was temporary and never saved: a save prompt (see below)

↓

Ready

## Save Prompt

Reached from Stop only, and only when the profile just used is still temporary (never saved) — stopping with a saved profile in use returns straight to Ready, no prompt.

"Save this as a speaking profile?" — Save or Discard.

* **Discard** drops the temporary calibration for good. Never modifies a saved profile.
* **Save** advances to naming it. What happens next depends entirely on the name entered, normalized for comparison only (surrounding whitespace trimmed, case-insensitive) — a saved profile's own stored display name/casing is never changed by this comparison:
  * A name that doesn't match any saved profile creates a new one. Helper text says so, and the primary button reads **Save Profile**.
  * A name that matches an existing saved profile's name instead explicitly updates that profile's calibration in place — same id, same name, same library position, exactly as Recalibrate would. This is never silent: helper text changes to say "This calibration will update your existing '{Profile Name}' profile," and the primary button itself changes to **Update {Profile Name}**, so the outcome is visible before the user commits to it — the changing text and label are what make it explicit, not a confirmation dialog on top.
  * A unique name is blocked, with an explanatory message, once five profiles are already saved. Matching an existing name to update it is never blocked by the limit, since updating never grows the library.
* Both outcomes clear the temporary calibration, select the resulting profile, and return to Ready — the same landing spot either way, just with a different profile now selected.

Recalibrate, from Ready, remains the primary, deliberate way to intentionally update a known profile. The save prompt's name-matching path is an equivalent, explicit alternative for the moment a temporary calibration turns out to belong to a profile the user already has — not a second, looser way to overwrite something by accident.

The experience should remain predictable throughout the entire lifecycle.

Users should always understand:

* whether monitoring is active
* which profile is active, and whether it's a saved profile or a temporary, unsaved calibration
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

Once the Companion is open — whether monitoring is active or the Companion is sitting on its own Ready screen — the Dock shows the same structure, with one thing that changes:

* a small status indicator: a filled dot and "Monitoring is active." while monitoring, or a hollow dot and "Monitoring is inactive." while the Companion is Ready — the only part of this screen that reflects real session state
* a fixed heading: "Your Mezzo Companion is open" — shown regardless of the status above it
* a static illustrative preview of the Companion window — see "Companion Preview" below
* a caption explaining the preview: "The Mezzo Companion is the floating window you'll use while monitoring."
* Close Companion — see "Recovery" below
* a divider
* guidance to keep the page open and that closing it closes the Companion too: "Keep this page open while using Mezzo." / "Closing it will also close the Mezzo Companion."

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it, and never duplicates its Start Monitoring or Stop controls here, or any profile/calibration control. Reporting status and offering Close Companion (a recovery action, not a status or monitoring control — see "Recovery") are the only jobs of this screen while the Companion is open.

## Companion Preview

The preview shown on the Dock is a fixed, illustrative graphic, not a live view into the real Companion. It always shows the same reference imagery — an Expanded Monitoring Companion in "Approaching End of Range" territory — regardless of the user's actual profile, actual zone, or whether the Companion is really Monitoring or sitting on Ready.

This is intentional: the preview exists to show a first-time user what the Companion looks like, not to report live status (the status indicator above it already does that, accurately). It does not run a second monitoring or visualization loop, does not read the user's real profile or zone. Its status/profile text and its "Stop"/"Compact" controls are rendered as abstract placeholder bars and icons, not literal readable text — deliberately, so nothing in this illustration can be mistaken for the real, live status indicator sitting directly above it.

## Recovery

Users should never need a second checkpoint on this page before monitoring can begin — Open Mezzo Companion already handles getting them there, and the Companion's own Welcome/Ready screens handle everything after. Once the Companion is open, this screen offers exactly one action: **Close Companion**. It has the exact same effect as the Companion's own native window-close control, whatever the Companion's current state — stops monitoring (or, mid-Calibrating, stops capture and discards whatever partial samples existed), closes the Companion, and returns to Home — and exists only because the floating window's own ✕ may not always be easy to find (e.g. behind other windows). See "Mezzo Companion Closed" under Recovery, below, for what happens to an in-progress calibration or an unsaved temporary profile specifically. It is deliberately not framed as "End Session": it isn't a second way to decide you're done, it's the same close action the native control already performs, made reachable from the page. Beyond that, this screen exists only to report status once the Companion is already open, and to explain how closing things works.

---

# Mezzo Companion Experience

The Mezzo Companion is the primary monitoring experience.

It should remain visually quiet while still communicating meaningful changes in speaking volume.

A user should understand its current state with a brief peripheral glance rather than sustained attention.

The Companion should:

* open at a useful default size, and resize appropriately as it moves between Welcome, Ready, Expanded Monitoring, and Compact
* remain legible at each of its fixed sizes
* prioritize the visualization over controls
* communicate monitoring status clearly
* remain visually stable throughout a meeting

The Companion should feel like a quiet instrument—not a dashboard.

The Companion has four states — Welcome, Ready, Calibrating, and Monitoring — and, while Monitoring, two layouts, Expanded and Compact. See below for each.

---

# Companion States

The Companion has four distinct states. They should never feel like one screen with elements shown or hidden — Welcome, Ready, Calibrating, and Monitoring are different experiences with different purposes.

## Welcome

Purpose: the first thing a genuinely new user sees inside the Companion — a deliberate moment, not an instant redirect into calibration.

Target size: 320×354, the same fixed size as Ready — it does not get its own dedicated size.

Reached exactly once: the very first time the Companion opens with zero saved profiles. Explains, briefly, what's about to happen — that Mezzo needs to learn the user's natural speaking volume before it can monitor, and that microphone access will be requested next. Its one action begins calibration (Calibrate for this session) — this is also the first moment microphone permission is ever requested (see "Calibration").

Once a saved profile exists — from finishing this first calibration, or from any later Save as New Profile — the Companion never shows Welcome again; every later zero-saved-profile state (e.g. after deleting the last saved profile) still routes to Welcome, since the underlying condition ("nothing saved yet") is the same regardless of history.

## Ready

Purpose: preparation.

Target size: 320×354 — its own fixed size, not shared with Monitoring's Expanded size.

Reached whenever the Companion opens with one or more saved profiles already existing, and by stopping monitoring thereafter. Every session, first included, goes through Ready or Welcome — never straight to Monitoring; there is no more special case that skips this checkpoint.

Ready shows:

* "Ready for the next conversation."
* a profile selector, offering any saved profiles and Calibrate for this session
* a Recalibrate action for a saved profile — per-row vs. select-then-Recalibrate placement is a still-open question, pending a real-width comparison; a select-first pattern (choose a profile, then see "Recalibrate Kitchen") is the likely stronger default at 320px, but not yet confirmed
* Start Monitoring
* profile deletion and the 5-profile limit — see "Profile Model"

The profile selector opens a centered menu over the Companion, rather than an anchored dropdown — this keeps it fully visible regardless of where the trigger sits in the small window. The selected profile is marked distinctly from a hovered or keyboard-focused one.

From Ready, users can review the selected profile, choose another existing one, calibrate a new one, recalibrate the selected one, or start monitoring. There is no in-Companion control to close it — the native Picture-in-Picture window-close control is the only way, from any state.

The visualization is intentionally hidden. Monitoring is inactive.

Ready always uses the Expanded layout — there is no Compact Ready variant.

Ready has no in-page title bar either — the real Document Picture-in-Picture window chrome is the only title bar, the same as every other state.

---

## Calibrating

Purpose: measurement — either a fresh, session-only calibration, or a recalibration of one specific saved profile. See "Calibration" above for the full behavior and the two modes' distinct commit actions; this section only covers what's specific to the Companion.

Target size: 320×354, the same fixed size as Ready — it does not get its own dedicated size.

Reached from Welcome or Ready by selecting Calibrate for this session or Recalibrate on a saved profile. Shows a live, speaking-driven meter and short countdown, a brief automatic completion, and then the mode-appropriate Calibrated decision (see "Calibration" above) as a modal overlay on this same screen — not a navigation to a different one. On failure, Calibration Failed offers Try Again in the same mode, per "Calibration" above; it never fails silently.

Calibrating always uses the Expanded layout, same as Ready — it never appears in Compact, since it exists only before Monitoring begins.

There is no in-Companion control to cancel and back out of an in-progress capture; closing the Companion is the way out, per "Mezzo Companion Closed" under Recovery, below.

---

## Monitoring

Purpose: ambient awareness.

Target size (Expanded): 290×420.

Monitoring displays:

* current monitoring state (Quiet / Within Range / Approaching End of Range / Outside Range)
* selected profile (read only) — when the active profile is a temporary, unsaved calibration, this line says so explicitly, so the user always knows whether their range is persisted
* live visualization
* Stop
* Compact

Users cannot change profiles, calibrate, or recalibrate while monitoring — all three require stopping first.

Stopping monitoring returns to Ready, except when the profile in use is still temporary and unsaved: see "Monitoring Lifecycle → Save Prompt."

---

# Compact Companion

Compact is an intentional product mode, not a responsive fallback for small windows.

Target size: 220×220.

It exists only while monitoring. Its purpose is peripheral awareness.

The Compact Companion removes most interface chrome, keeping only what's essential at a glance. It displays:

* the visualization
* Stop and Expand controls, as icon-only corner overlays (Stop bottom-left, Expand bottom-right) — no visible text label on either, same restrained treatment as the rest of Compact

It does not display:

* a title bar or wordmark — the real Document Picture-in-Picture window chrome is the only title bar, in both Expanded and Compact
* monitoring status text
* profile information

Stop in Compact behaves identically to Stop in Expanded: it stops monitoring and returns the Companion to Ready, without closing it. Closing the native Picture-in-Picture window remains a separate, more final action, available from Compact the same as from every other state: it stops monitoring, releases the microphone, and follows the recovery path described under Mezzo Companion Closed below — the Companion closes, and Mezzo returns to Home.

Expanding always returns to the Expanded layout without interrupting monitoring, the selected profile, or the current monitoring state.

---

# Profile Model

A **saved profile** is a persistent, reusable identity for an environment or situation — "Kitchen," "Home Office," "Coffee Shop" — not a single-use calibration. Its calibration (the actual speaking-range measurement) can be refreshed at any time via Recalibrate without changing its identity: same id, same name, same position in the library. Recalibrating "Kitchen" updates "Kitchen" — it never creates "Kitchen 2," never requires renaming, and never requires deleting the profile it replaces.

A **temporary calibration** exists only for the current session. It becomes a saved profile if the user explicitly chooses Save as New Profile (pre-monitoring), or names it at the Stop-time save prompt with a name that doesn't match an existing profile (see "Monitoring Lifecycle → Save Prompt"); otherwise it is discarded when the session ends. A temporary calibration never *silently* overwrites a saved profile: Recalibrate is the primary, deliberate way to update one, and the Stop-time save prompt offers an equivalent, explicit alternative — naming a temporary calibration with a name that matches an existing profile updates that profile's calibration in place, but only visibly so, via the save prompt's own changing helper text and primary button label, never as a side effect of anything else.

Calibration, recalibration, profile selection, profile deletion, and starting monitoring all happen inside the Mezzo Companion now — there is no second, page-level implementation of any of it to keep in sync, and no handoff between two surfaces to reason about.

In the Companion:

* select an existing saved profile, start monitoring with it as-is
* calibrate a new profile for this session, optionally saving it as a new profile once monitoring stops
* recalibrate an existing saved profile in place
* delete a saved profile, and see the 5-profile limit enforced, from its own Ready screen
* monitor using whichever profile — saved or temporary — is active

Renaming a saved profile does not exist as a feature yet. If it's ever built, it belongs here too, alongside delete — there is no separate profile-management surface for it to live on instead.

Selecting Calibrate for this session or Recalibrate in the Companion does not close it or hand off anywhere — it transitions the Companion itself into Calibrating (see "Companion States" above), in place.

---

# Monitoring States

These are the four awareness states shown while the Companion is Monitoring — distinct from the Companion's own Ready/Monitoring states above, which describe what the Companion is doing rather than how loud the user is.

Monitoring states describe what is happening.

They do not evaluate the user.

They do not prescribe behavior.

## Quiet

The user is not currently speaking, or speech remains below the active speaking threshold.

Visual characteristics:

* calm field
* subtle continuous motion
* minimal propagation
* quiet reassurance that monitoring is active

Quiet is not a negative state.

---

## Within Range

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

## Approaching End of Range

The user's speaking volume is moving toward the edge of the preferred range.

Visual characteristics:

* second contour appears
* outer contour becomes slightly organic
* motion becomes more noticeable
* remains warm white

Purpose:

Provide gentle awareness before stronger visual emphasis becomes necessary.

Approaching End of Range is descriptive, not corrective. It supersedes the older "Approaching Range" label — use the full name consistently.

---

## Outside Range

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

Outside Range communicates awareness without judgment.

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
* **Monitoring, with a temporary, unsaved calibration in use** — the same stop happens, but the native window-close control cannot be intercepted to show a save prompt first, so the temporary calibration is lost with no way to recover it afterward. Home should calmly acknowledge this — e.g. noting that the last session's calibration wasn't saved — rather than implying anything was preserved. This is a real, known tradeoff: the interceptable **Close Companion** button on this same page (see "Dock Experience") could in principle offer a save prompt before closing, since it isn't a native browser control; whether it should is an open product question, not yet settled.
* **Calibrating, in either mode** — capture stops immediately and whatever partial samples existed are discarded. A recalibration in progress leaves its target saved profile completely untouched; closing mid-Recalibrate is always safe for the profile being recalibrated.

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

Microphone permission is now requested from exactly one place — inside the Companion, when calibration first begins (see "Calibration") — so there is only one recovery experience to get right, not several to keep consistent with each other.

---

# Privacy Experience

Privacy should be reinforced at moments where users naturally have questions.

Especially:

* before microphone permission, inside the Companion, when calibration first begins
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
