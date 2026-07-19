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

Mezzo is the application used to:

* prepare for monitoring
* select or create Speaking Profiles
* calibrate when needed
* start monitoring
* manage an active session
* recover monitoring
* end monitoring

Users may move between different screens while using Mezzo, but they should never feel like they are switching between different products — it is the same page throughout, from first launch through active monitoring.

---

## Mezzo Companion

The Mezzo Companion is the small always-on-top monitoring window displayed beside the user's meeting.

It is the primary monitoring experience.

It provides:

* live visualization
* ambient awareness
* monitoring state
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

Purpose:

* explain microphone access
* introduce Speaking Profiles
* support calibration
* prepare the user to begin monitoring

Onboarding should reduce uncertainty before monitoring begins.

Users should understand:

* why microphone access is needed
* what Mezzo does with microphone input
* when monitoring begins
* how Speaking Profiles work

Onboarding should never feel like a test.

It is preparation.

---

## Anchor Page

Internal term only — see Canonical Terminology in `CLAUDE.md`. It is the browser page that must stay open to keep the Mezzo Companion running: the same page that shows the Speaking Profile page and onboarding before a Companion exists, and that keeps the Companion alive once one does.

The Anchor page:

* keeps the Mezzo Companion running
* reflects whether monitoring is active or inactive, via a small status indicator
* shows a static, illustrative preview of the Companion — not a live view — so a user who has never opened one knows roughly what to expect
* explains why the page must remain open
* closes the Companion if it closes itself

It is not the primary monitoring interface. It does not duplicate the Companion's real Start Monitoring or Stop controls, and its Companion preview does not run a second visualization or reflect real session data — see "Anchor Page Experience," below, for exactly what it shows and why.

The Mezzo Companion, not the Anchor page, is meant to stay available across an entire meeting-filled day — monitoring starts and stops independently inside it, session by session, without the Companion needing to reopen.

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

Understand microphone access

↓

Grant microphone permission

↓

Choose a Speaking Profile:

* Everyday Conversation
* Create a Speaking Profile

↓

Calibrate if creating a Speaking Profile

↓

Calibration completes automatically

↓

Choose:

* Save (transitions in place to naming, below)
* Try Again (restarts calibration directly)
* Discard (returns to Choose a Speaking Profile)

↓

Name the profile, if saving

↓

Speaking Profile page — selected profile visible, primary action reads "Start Monitoring" (or "Set Up Profile" if a not-yet-created profile is still selected)

↓

Start Monitoring

↓

Mezzo Companion opens, Monitoring

↓

Meeting

↓

Stop (inside the Companion)

↓

Companion Ready (still open — start again, switch profiles, or close)

↓

Close the Anchor page, or close the Companion natively, to end the session

---

## Learn About Mezzo

Before asking for microphone access, users should understand:

* what Mezzo does
* what Mezzo does not do
* why microphone access is required
* that audio remains on the device
* that monitoring begins only when they choose

Privacy messaging should be specific, calm, and verifiable.

---

## Choose a Speaking Profile

Users should be able to begin quickly.

Offer:

* Everyday Conversation, badged "Recommended"
* Create a Speaking Profile ("Calibrated to your voice and environment")
* previously saved Speaking Profiles, once any exist

Everyday Conversation minimizes setup — it requires no calibration.

A created Speaking Profile lets users define a preferred speaking range for their own environment.

The primary action's label reflects the current selection: "Start Monitoring" for Everyday Conversation or any saved profile, "Set Up Profile" when "Create a Speaking Profile" is selected instead.

---

## Calibration

Calibration should feel like preparation.

It should never imply that there is one objectively correct speaking volume.

Explain:

* what the user should do
* what Mezzo is measuring
* what will happen next

Calibration completes automatically — there is no manual "I'm done" action. Its result then surfaces as a save decision, presented as a modal overlay on top of the calibration screen rather than a separate page:

* Save
* Try Again
* Discard

Use:

* Save
* Try Again
* Discard

Avoid:

* Save Profile
* Cancel
* Continue Without Saving
* Use Once
* Not Now

Try Again discards this take and restarts calibration capture directly, with no separate landing step in between. Discard abandons the calibration result entirely and returns to Choose a Speaking Profile. Save transitions that same modal, in place, to a "Name your profile" step — never a second modal or a separate page — where naming and saving completes the new Speaking Profile.

There is no way to continue into monitoring with an unsaved calibration, and no temporary or session-only profile is ever created — calibration always ends in either a saved Speaking Profile or nothing at all.

---

## Start Monitoring

After onboarding, a profile is already selected and visible in Mezzo. The primary action is:

Start Monitoring

Selecting it opens the Mezzo Companion directly into its Monitoring state, using that profile immediately — from the same Mezzo page that just handled onboarding, no second window. That single action should:

* confirm microphone access
* start the monitoring session
* open the Companion straight into Monitoring
* transition the Anchor page into its "Monitoring is active" status

There is no intermediate Companion Ready checkpoint and no second Start Monitoring action for this first session — avoid presenting multiple "Ready" checkpoints across separate windows before monitoring can begin. Monitoring should never begin automatically on its own, without this explicit action.

---

## Start Monitoring Again (from the Companion)

Once the user stops monitoring, the Companion remains open and returns to its own Ready state — this is where a second, later "Start Monitoring" lives, inside the Mezzo Companion, not on Mezzo itself.

When the Companion is in its Ready state, show:

* "Ready for the next conversation."
* selected profile (the previously used one, still selected)
* profile selector
* Start Monitoring

Selecting Start Monitoring there should:

* start the monitoring session again, with whichever profile is selected
* lock profile selection
* transition the Companion into its Monitoring state
* transition the Anchor page into its "Monitoring is active" status

This lets the user start additional monitoring sessions later in the day without ever returning to the Speaking Profile page.

---

# Returning User Journey

Returning users should experience as little friction as possible.

The intended flow is:

Open Mezzo

↓

Previously used profile is selected and visible

↓

Start Monitoring

↓

Mezzo Companion opens, Monitoring

↓

Meeting

↓

Stop (inside the Companion)

↓

Companion Ready (still open — start again, switch profiles, or close)

↓

Close the Anchor page, or close the Companion natively, to end the session

Returning users should not repeat onboarding unless required.

If no profile or onboarding state exists, guide the user through the appropriate first-run experience before monitoring begins.

---

# Meeting Prompt Journey

When a supported meeting is detected, the extension may offer:

Open Mezzo

Not Now

Selecting Open Mezzo should:

* open Mezzo
* restore the previous profile when possible
* allow the user to review their setup
* require an explicit Start Monitoring action

Do not imply that monitoring begins directly from the meeting prompt.

The user should always begin monitoring intentionally.

---

# Monitoring Lifecycle

The very first monitoring session in a given Companion-open lifetime starts directly from Mezzo, with no Ready step first:

Start Monitoring (from Mezzo, the Speaking Profile page)

↓

Monitoring Active

Every session after that, for the rest of the day, follows the same repeating lifecycle instead, starting from the Companion's own Ready screen:

Ready (Mezzo Companion open, monitoring inactive)

↓

Start Monitoring (inside the Companion)

↓

Monitoring Active

↓

Meeting

↓

Stop (inside the Companion)

↓

Ready

The experience should remain predictable throughout the entire lifecycle.

Users should always understand:

* whether monitoring is active
* which profile is active
* how to start monitoring again, whether the Companion is still open or has closed
* how to end the session

Monitoring should never continue ambiguously.

Recovery should feel like a normal part of the experience rather than an error condition.

---

# Anchor Page Experience

The Anchor page supports monitoring, recovery, and keeping the Mezzo Companion alive. Its own "active"/"inactive" status below mirrors, but is distinct from, the Companion's own Ready and Monitoring states — see Companion States.

During an active meeting, it is not intended to be the user's primary focus.

Its responsibility is to keep the monitoring session understandable and recoverable — nothing more. There is no End Session (or any other) button on this screen. A monitoring session ends by closing this page, which closes the Companion too, or by closing the Companion itself using its native window control.

## What It Shows

Once the Companion is open — whether monitoring is active or the Companion is sitting on its own Ready screen — the Anchor page shows the same structure, with one thing that changes:

* a small status indicator: a filled dot and "Monitoring is active." while monitoring, or a hollow dot and "Monitoring is inactive." while the Companion is Ready — the only part of this screen that reflects real session state
* a fixed heading: "Your Mezzo Companion is open" — shown regardless of the status above it
* a static illustrative preview of the Companion window — see "Companion Preview" below
* a caption explaining the preview: "The Mezzo Companion is the floating window you'll use while monitoring."
* Close Companion — see "Recovery" below
* a divider
* guidance to keep the page open and that closing it closes the Companion too: "Keep this page open while using Mezzo." / "Closing it will also close the Mezzo Companion."

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it, and never duplicates its Start Monitoring or Stop controls here. Reporting status and offering Close Companion (a recovery action, not a status or monitoring control — see "Recovery") are the only jobs of this screen while the Companion is open.

## Companion Preview

The preview shown on the Anchor page is a fixed, illustrative graphic, not a live view into the real Companion. It always shows the same reference imagery — an Expanded Monitoring Companion in "Approaching End of Range" territory — regardless of the user's actual profile, actual zone, or whether the Companion is really Monitoring or sitting on Ready.

This is intentional: the preview exists to show a first-time user what the Companion looks like, not to report live status (the status indicator above it already does that, accurately). It does not run a second monitoring or visualization loop, does not read the user's real profile or zone. Its status/profile text and its "Stop"/"Compact" controls are rendered as abstract placeholder bars and icons, not literal readable text — deliberately, so nothing in this illustration can be mistaken for the real, live status indicator sitting directly above it.

## Recovery

Users should never need a second checkpoint on this page before the first session's monitoring can begin — Mezzo's own Start Monitoring already handles that. Once the Companion is open, this screen offers exactly one action: **Close Companion**. It has the exact same effect as the Companion's own native window-close control — stops monitoring, closes the Companion, and returns to the Speaking Profile page — and exists only because the floating window's own ✕ may not always be easy to find (e.g. behind other windows). It is deliberately not framed as "End Session": it isn't a second way to decide you're done, it's the same close action the native control already performs, made reachable from the page. Beyond that, this screen exists only to report status once the Companion is already open, and to explain how closing things works.

---

# Mezzo Companion Experience

The Mezzo Companion is the primary monitoring experience.

It should remain visually quiet while still communicating meaningful changes in speaking volume.

A user should understand its current state with a brief peripheral glance rather than sustained attention.

The Companion should:

* open at a useful default size, and resize appropriately as it moves between Ready, Expanded Monitoring, and Compact
* remain legible at each of its fixed sizes
* prioritize the visualization over controls
* communicate monitoring status clearly
* remain visually stable throughout a meeting

The Companion should feel like a quiet instrument—not a dashboard.

The Companion has two states, Ready and Monitoring, and — while Monitoring — two layouts, Expanded and Compact. See below for each.

---

# Companion States

The Companion has two distinct states. They should never feel like one screen with elements shown or hidden — Ready and Monitoring are different experiences with different purposes.

## Ready

Purpose: preparation.

Target size: 320×354 — its own fixed size, not shared with Monitoring's Expanded size.

The Companion's first open of the day goes directly to Monitoring — Mezzo already chose the profile, so there is nothing to prepare. Ready is reached only afterward, by stopping monitoring, and is where subsequent same-day sessions begin.

Ready shows:

* "Ready for the next conversation."
* a profile selector, offering Everyday Conversation, any saved profiles, and "Create New Profile…"
* Start Monitoring

The profile selector opens a centered menu over the Companion, rather than an anchored dropdown — this keeps it fully visible regardless of where the trigger sits in the small window. The selected profile is marked distinctly from a hovered or keyboard-focused one.

From Ready, users can review the selected profile, choose another existing one, create a new one (which hands off to the Speaking Profile page — see "Profile Model" below), or start monitoring. There is no in-Companion control to close it — the native Picture-in-Picture window-close control is the only way, from any state.

The visualization is intentionally hidden. Monitoring is inactive.

Ready always uses the Expanded layout — there is no Compact Ready variant.

Ready has no in-page title bar either — the real Document Picture-in-Picture window chrome is the only title bar, the same as every Monitoring state.

---

## Monitoring

Purpose: ambient awareness.

Target size (Expanded): 380×420.

Monitoring displays:

* current monitoring state (Quiet / Within Range / Approaching End of Range / Outside Range)
* selected profile (read only)
* live visualization
* Stop
* Compact

Users cannot change profiles while monitoring.

Stopping monitoring returns to Ready.

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

Stop in Compact behaves identically to Stop in Expanded: it stops monitoring and returns the Companion to Ready, without closing it. Closing the native Picture-in-Picture window remains a separate, more final action, available from Compact the same as from every other state: it stops monitoring, releases the microphone, and follows the recovery path described under Mezzo Companion Closed below — the Companion closes, and Mezzo returns to the Speaking Profile page with Start Monitoring as the primary action.

Expanding always returns to the Expanded layout without interrupting monitoring, the selected profile, or the current monitoring state.

---

# Profile Model

Profile responsibilities are intentionally divided between Mezzo and the Companion.

In Mezzo (the Speaking Profile page):

* create Speaking Profiles
* calibrate
* manage saved profiles

In the Companion:

* select an existing profile
* monitor using that profile

The Companion does not contain profile creation. Instead, its profile menu ends with:

> Create New Profile…

Selecting this closes the Companion, brings the Anchor page forward, and transitions that same page, in place, to the first screen of the Create Speaking Profile flow — never a new tab. Saving there returns to the Speaking Profile page with the new profile selected.

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

Monitoring can never continue without the Mezzo Companion open. If the Companion closes — only ever via its native window-close control, since there is no in-app Close Companion action — monitoring stops immediately if it was active, and microphone resources are released — not left running invisibly.

There is no separate "Mezzo Companion is closed" status screen and no Re-open Companion action. Instead, Mezzo returns directly to the Speaking Profile page (profile library), with the current profile still selected and the primary action:

Start Monitoring

Selecting it opens a fresh Companion directly into Monitoring, exactly like the first session — it never resumes monitoring on its own.

"Create New Profile…" (from the Companion's Ready-state dropdown) closes the Companion the same way monitoring-wise, but routes differently: Mezzo comes forward and transitions straight to the first screen of the Create Speaking Profile flow instead of the Speaking Profile page — see "Profile Model." Saving there returns to the Speaking Profile page with the new profile selected, same as any other newly created profile.

---

## Mezzo Closed

Closing the Anchor page (the browser tab) ends the monitoring session — this is the primary way a session ends; there is no dedicated End Session control.

When possible, users should understand this before the page closes — see the Anchor page's own footer guidance ("Closing it will also close the Mezzo Companion").

Ending the session should:

* stop monitoring
* release microphone access
* close the Mezzo Companion
* return the experience to a predictable state

---

## Unsupported Browser

If the browser does not support the Mezzo Companion:

Explain the limitation clearly.

Allow monitoring to continue within Mezzo.

This is an alternate supported experience—not a degraded version of the product.

Suggested language:

> Your browser doesn't support the Mezzo Companion, so monitoring will stay in this window.

Do not rename Mezzo simply because it becomes the monitoring surface.

---

## Microphone Access

If microphone permission is denied:

Clearly explain:

* what happened
* why access is needed
* how to grant permission
* how to return to a ready state

Never fail silently.

The recovery experience should feel the same whether permission is requested during onboarding or while opening Mezzo.

---

# Privacy Experience

Privacy should be reinforced at moments where users naturally have questions.

Especially:

* before microphone permission
* during onboarding
* while preparing to monitor
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
