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

A successful Mezzo session feels almost invisible.

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

Choose:

* Save Profile
* Continue Without Saving

↓

You're All Set

↓

Open Companion

↓

Mezzo Companion opens, Ready

↓

Start Monitoring (inside the Companion)

↓

Meeting

↓

Stop Monitoring (inside the Companion)

↓

Ready

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

When the user chooses not to save calibration:

Use:

* Continue Without Saving
* Use Once

Avoid:

* Not Now

Include clear supporting copy explaining that the calibration will be available only for the current session.

---

## Open Companion

After onboarding, users open the Mezzo Companion directly — not Mezzo alone.

Avoid presenting multiple "Ready" checkpoints across separate windows before monitoring can begin.

The primary action is:

Open Companion

This opens the Companion in its own Ready state, from the same Mezzo page that just handled onboarding — no second window. It does not request microphone access or start monitoring — those only happen from a later, separate action inside the Companion itself.

---

## Start Monitoring

Start Monitoring lives inside the Mezzo Companion, not on Mezzo itself.

When the Companion is in its Ready state, show:

* selected profile
* profile selector
* Start Monitoring

Monitoring begins only after the user explicitly chooses Start Monitoring inside the Companion. That action should:

* confirm microphone access
* start the monitoring session
* transition the Companion into its Monitoring state
* transition Mezzo into its Monitoring Active status

Monitoring should never begin automatically — including when the Companion itself first opens.

---

# Returning User Journey

Returning users should experience as little friction as possible.

The intended flow is:

Open Mezzo

↓

Previously used profile is selected

↓

You're All Set

↓

Open Companion

↓

Mezzo Companion opens, Ready

↓

Start Monitoring (inside the Companion)

↓

Meeting

↓

Stop Monitoring (inside the Companion)

↓

Ready

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

Every monitoring session follows the same lifecycle.

Ready (Mezzo Companion open, monitoring inactive)

↓

Start Monitoring (inside the Companion)

↓

Monitoring Active

↓

Meeting

↓

Stop Monitoring (inside the Companion)

↓

Ready

The experience should remain predictable throughout the entire lifecycle.

Users should always understand:

* whether monitoring is active
* which profile is active
* how to re-open the Companion
* how to end the session

Monitoring should never continue ambiguously.

Recovery should feel like a normal part of the experience rather than an error condition.
---

# Session Window Experience

The Mezzo window supports preparation, monitoring, recovery, and session management.

During an active meeting, it is not intended to be the user's primary focus.

Its responsibility is to keep the monitoring session understandable and recoverable.

## Ready State

Mezzo itself does not show a profile selector or a Start Monitoring control — those live inside the Mezzo Companion, which owns starting and stopping monitoring. Mezzo's own Ready state is a status report: the Companion is open and waiting.

The Mezzo Companion is a Document Picture-in-Picture window and already stays above other application windows on its own — Mezzo never offers a "bring to front" / "show" / "focus" control for it. Reporting status is the only job of this screen while the Companion is open.

When the Companion is open but monitoring has not started, Mezzo should display:

* Mezzo Companion is open
* Ready
* supporting copy explaining the next step happens in the Companion
* End Session

Suggested language:

> Start monitoring from the Mezzo Companion when you're ready.

End Session is distinct from closing Mezzo: it stops monitoring if active, releases the microphone, and closes the Mezzo Companion, but returns this same screen to its pre-session state rather than closing Mezzo itself. Closing Mezzo entirely is a separate action — see Recovery.

Users should never need a second checkpoint on this window before monitoring can begin — the Companion is the checkpoint.

---

## Monitoring Active

Once monitoring begins, Mezzo should communicate:

* Monitoring is active
* End Session

It should also explain the relationship between Mezzo and the active session, and that the Companion remains visible without any action needed.

Suggested language:

> The Mezzo Companion will stay visible above your other windows.

The Session Window should not duplicate the live visualization while the Mezzo Companion is available.

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

---

# Monitoring States

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

Approaching End of Range is descriptive, not corrective.

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

Monitoring can never continue without the Mezzo Companion open. If the Companion closes while monitoring is active, monitoring stops immediately and microphone resources are released — not left running invisibly.

Mezzo should clearly explain:

> Mezzo Companion is closed.

Supporting language:

> Monitoring is not active.

Available actions:

* Re-open Companion
* End Session

Reopening the Companion returns it to Ready — it never resumes monitoring on its own.

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

A successful Mezzo session should feel effortless.

The user:

* understands how to begin monitoring
* trusts how Mezzo handles microphone access
* keeps the Mezzo Companion beside the meeting
* notices changes through peripheral awareness
* never feels judged or interrupted
* understands how to recover if something closes
* finishes the meeting feeling more aware of their speaking volume

The product should quietly support the conversation without becoming part of it.
