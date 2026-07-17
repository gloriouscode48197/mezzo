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
* select or create profiles
* calibrate when needed
* start monitoring
* manage an active session
* recover monitoring
* end monitoring

Users may move between different pages or windows while using Mezzo, but they should never feel like they are switching between different products.

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
* introduce profiles
* support calibration
* prepare the user to begin monitoring

Onboarding should reduce uncertainty before monitoring begins.

Users should understand:

* why microphone access is needed
* what Mezzo does with microphone input
* when monitoring begins
* how profiles work

Onboarding should never feel like a test.

It is preparation.

---

## Anchor Page

Internal term only — see Canonical Terminology in `CLAUDE.md`. It is the browser page that must stay open to keep the Mezzo Companion running: the same page that shows the Speaking Profile page and onboarding before a Companion exists, and that keeps the Companion alive once one does.

The Anchor page:

* keeps the Mezzo Companion running
* reflects whether monitoring is active or inactive
* explains why the page must remain open
* closes the Companion if it closes itself

It is not the primary monitoring interface, and should not duplicate the Start Monitoring or Stop controls that belong inside the Companion.

The Mezzo Companion, not the Anchor page, is meant to stay available across an entire meeting-filled day — monitoring starts and stops independently inside it, session by session, without the Companion needing to reopen.

User-facing copy never names this page — it says things like "this page," "keep this page open," or "closing this page will also close the Mezzo Companion." Full behavior: "Anchor Page Experience," below.

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

Choose:

* Recommended Profile
* Create Custom Profile

↓

Calibrate if creating a Custom Profile

↓

Calibration completes automatically

↓

Choose:

* Save (transitions in place to naming, below)
* Try Again (restarts calibration directly)
* Discard (returns to Choose a Profile)

↓

Name the profile, if saving

↓

Speaking Profile page — selected profile visible

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

End Session

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

## Choose a Profile

Users should be able to begin quickly.

Offer:

* Recommended
* Create Custom Profile
* Previously Saved Profiles (when available)

The Recommended profile minimizes setup.

Custom profiles allow users to define a preferred speaking range for their own environment.

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

Try Again discards this take and restarts calibration capture directly, with no separate landing step in between. Discard abandons the calibration result entirely and returns to Choose a Profile. Save transitions that same modal, in place, to a "Name your profile" step — never a second modal or a separate page — where naming and saving completes the new Custom Profile.

There is no way to continue into monitoring with an unsaved calibration, and no temporary or session-only profile is ever created — calibration always ends in either a saved Custom Profile or nothing at all.

---

## Start Monitoring

After onboarding, a profile is already selected and visible in Mezzo. The primary action is:

Start Monitoring

Selecting it opens the Mezzo Companion directly into its Monitoring state, using that profile immediately — from the same Mezzo page that just handled onboarding, no second window. That single action should:

* confirm microphone access
* start the monitoring session
* open the Companion straight into Monitoring
* transition Mezzo into its Monitoring Active status

There is no intermediate Companion Ready checkpoint and no second Start Monitoring action for this first session — avoid presenting multiple "Ready" checkpoints across separate windows before monitoring can begin. Monitoring should never begin automatically on its own, without this explicit action.

---

## Start Monitoring Again (from the Companion)

Once the user stops monitoring, the Companion remains open and returns to its own Ready state — this is where a second, later "Start Monitoring" lives, inside the Mezzo Companion, not on Mezzo itself.

When the Companion is in its Ready state, show:

* selected profile (the previously used one, still selected)
* profile selector
* Start Monitoring

Selecting Start Monitoring there should:

* start the monitoring session again, with whichever profile is selected
* lock profile selection
* transition the Companion into its Monitoring state
* transition Mezzo into its Monitoring Active status

This lets the user start additional monitoring sessions later in the day without ever returning to Mezzo.

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

End Session

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

The Anchor page supports monitoring, recovery, and keeping the Mezzo Companion alive. Its own "Ready" and "Monitoring Active" statuses below mirror, but are distinct from, the Companion's own Ready and Monitoring states — see Companion States.

During an active meeting, it is not intended to be the user's primary focus.

Its responsibility is to keep the monitoring session understandable and recoverable.

## Ready State

This status screen is only reached once the Mezzo Companion already exists — after stopping monitoring, or if a first attempt to start couldn't acquire the microphone. It is not where the first session begins: that Start Monitoring control lives on Mezzo's own Speaking Profile page, before any Companion exists. Once the Companion is open, Mezzo itself does not also show a profile selector or a Start Monitoring control — those live inside the Mezzo Companion, which owns starting and stopping monitoring from that point on. Mezzo's own Ready state is a status report: the Companion is open and waiting.

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it. Reporting status is the only job of this screen while the Companion is open.

When the Companion is open but monitoring has not started, Mezzo should display:

* Mezzo Companion is open
* Ready
* supporting copy explaining the next step happens in the Companion
* End Session

Suggested language:

> Start monitoring from the Mezzo Companion when you're ready.

End Session is distinct from closing Mezzo: it stops monitoring if active, releases the microphone, and closes the Mezzo Companion — returning Mezzo to the Speaking Profile page (profile library), with the current profile still selected and Start Monitoring as the primary action, rather than closing Mezzo itself. Closing Mezzo entirely is a separate action — see Recovery.

Users should never need a second checkpoint on this window before the first session's monitoring can begin — Mezzo's own Start Monitoring already handles that. This screen exists only for what happens after the Companion is already open.

---

## Monitoring Active

Once monitoring begins, Mezzo should communicate:

* Monitoring is active
* End Session

It should also explain the relationship between Mezzo and the active session, and that the Companion remains visible without any action needed.

Suggested language:

> The Mezzo Companion will stay visible above your other windows.

The Anchor page should not duplicate the live visualization while the Mezzo Companion is available.

Users should feel comfortable minimizing or ignoring Mezzo during the meeting.

---

# Mezzo Companion Experience

The Mezzo Companion is the primary monitoring experience.

It should remain visually quiet while still communicating meaningful changes in speaking volume.

A user should understand its current state with a brief peripheral glance rather than sustained attention.

The Companion should:

* open at a useful default size
* support resizing
* remain legible at supported sizes
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

The Companion's first open of the day goes directly to Monitoring — Mezzo already chose the profile, so there is nothing to prepare. Ready is reached only afterward, by stopping monitoring, and is where subsequent same-day sessions begin.

The Ready state allows users to:

* review the selected profile
* choose another existing profile
* create a new profile (by returning to Mezzo)
* start monitoring
* close the Companion

The visualization is intentionally hidden. Monitoring is inactive.

Ready always uses the Expanded layout.

---

## Monitoring

Purpose: ambient awareness.

Monitoring displays:

* current monitoring state
* selected profile (read only)
* live visualization

Users cannot change profiles while monitoring.

Stopping monitoring returns to Ready.

---

# Compact Companion

Compact is an intentional product mode, not a responsive fallback for small windows.

It exists only while monitoring. Its purpose is peripheral awareness.

The Compact Companion intentionally removes interface chrome. It displays:

* the visualization
* an Expand control

It does not display:

* the MEZZO wordmark
* monitoring status text
* profile information
* Stop

Closing the native Picture-in-Picture window is the canonical way to stop monitoring from Compact mode. This is an intentional product decision, not a missing feature: it stops monitoring, releases the microphone, and follows the same recovery path described under Mezzo Companion Closed below — the Companion closes, and Mezzo returns to the Speaking Profile page with Start Monitoring as the primary action.

Expanding always returns to the Expanded layout without interrupting monitoring, the selected profile, or the current monitoring state.

---

# Profile Model

Profile responsibilities are intentionally divided between Mezzo and the Companion.

In Mezzo:

* create profiles
* calibrate
* manage profiles

In the Companion:

* select an existing profile
* monitor using that profile

The Companion does not contain profile creation. Instead, its profile menu ends with:

> Create New Profile…

Selecting this returns the user to Mezzo's profile creation flow.

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

Monitoring can never continue without the Mezzo Companion open. If the Companion closes — the native window control, "Close Companion," "Create New Profile…," or End Session — monitoring stops immediately if it was active, and microphone resources are released — not left running invisibly.

There is no separate "Mezzo Companion is closed" status screen and no Re-open Companion action. Instead, Mezzo returns directly to the Speaking Profile page (profile library), with the current profile still selected and the primary action:

Start Monitoring

Selecting it opens a fresh Companion directly into Monitoring, exactly like the first session — it never resumes monitoring on its own.

---

## Mezzo Closed

Closing Mezzo ends the monitoring session.

When possible, users should understand this before the window closes.

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
