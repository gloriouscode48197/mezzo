# CLAUDE.md

# Mezzo Product Constitution

**Product:** Mezzo
**Current Milestone:** V2
**Purpose:** Canonical product constitution and collaboration guide

---

# Purpose

This document is the primary source of truth for Mezzo.

It defines the product's vision, philosophy, terminology, architectural boundaries, decision-making principles, and documentation system.

Every significant product, design, engineering, and documentation decision should align with this document.

When implementation conflicts with this document, determine whether the implementation has drifted from the intended product experience before changing the product definition.

Detailed user journeys, interaction flows, and monitoring states belong in `product-experience.md`.

Feature-specific requirements belong in PRDs.

Technical discoveries belong in `discoveries/`.

This document defines the durable product philosophy, terminology, architecture, and decision principles for Mezzo. It is intended to preserve the product's mental model across implementation, documentation, and future development. When implementation and this document disagree, first determine whether the product has intentionally evolved. If not, implementation should be brought back into alignment with this constitution.

---

# Product Vision

Mezzo is a privacy-first voice awareness tool that helps people become more aware of their speaking volume during meetings.

Rather than evaluating performance or interrupting conversations, Mezzo provides gentle visual awareness that allows people to naturally self-regulate.

Mezzo exists to support conversations without becoming part of them.

It should feel calm, trustworthy, restrained, and quietly present.

Product principle:

> Always reassuring. Occasionally attention-grabbing. Never distracting.

---

# Product Philosophy

Mezzo is not:

* a decibel meter
* a speech analyzer
* a transcription service
* a meeting assistant
* a productivity dashboard
* a coaching platform
* a behavioral scoring system
* a tool that determines whether someone is objectively "too loud"

Mezzo is:

* an ambient awareness tool
* a private speaking-volume companion
* a lightweight experience that quietly accompanies meetings
* a way to understand speaking volume relative to a preferred range

Every product decision should reinforce those boundaries.

When new ideas are proposed, first determine whether they strengthen Mezzo's core purpose or move it toward becoming a different product.

---

# Product Values

Every experience should reinforce:

* Calm
* Trust
* Restraint
* Privacy
* Peripheral awareness
* Clarity
* User agency

Mezzo should increase awareness without creating anxiety.

It should communicate information without demanding attention.

---

# Privacy Principles

Privacy is not a marketing feature.

It is a product principle.

Mezzo:

* processes audio locally
* never records audio
* never stores audio
* never transmits audio as part of the core monitoring experience
* never transcribes speech
* never analyzes conversation content
* never identifies speakers

Whenever implementation decisions affect privacy, choose the option that most clearly preserves user trust.

If product messaging cannot honestly describe implementation, implementation should change before messaging.

---

# Collaboration Philosophy

This document guides both human collaborators and AI assistants.

The goal is not simply to produce code.

The goal is to preserve the intended product experience while making thoughtful product decisions.

When reviewing requests:

* understand the problem before proposing solutions
* challenge assumptions when appropriate
* explain tradeoffs
* identify emerging product principles
* protect the current milestone from unnecessary expansion

Collaboration should improve product thinking, not merely execute instructions.

---

# Thinking Style

The primary designer often explores solutions before fully articulating the underlying problem.

Do not assume the first proposed solution is the actual decision.

Instead ask:

"What problem is this trying to solve?"

Help distinguish between:

* observations
* insights
* explorations
* product decisions
* implementation tasks
* documentation

Not every idea should become a feature.

Not every discussion should become implementation work.

---

# Working Modes

Before responding to a request, determine which mode best describes the conversation.

## Brainstorming

Explore possibilities.

Encourage discovery.

Avoid turning every idea into implementation.

Capture promising ideas without allowing them to expand the current milestone.

---

## Product Strategy

Clarify:

* product goals
* priorities
* tradeoffs
* scope
* audience
* long-term direction

Challenge additions that weaken Mezzo's focused purpose.

---

## UX Critique

Evaluate:

* comprehension
* hierarchy
* flow
* recovery
* trust
* cognitive load

Explain the underlying user problem rather than only suggesting interface changes.

---

## Design Review

Evaluate whether the experience reinforces:

* calm
* restraint
* peripheral awareness
* natural systems
* trust

Do not evaluate only aesthetics.

---

## Product Architecture

Clarify ownership, boundaries, responsibilities, and lifecycle.

Separate user-facing concepts from implementation details.

---

## Implementation Planning

Assume the product decision already exists.

Focus on:

* sequencing
* dependencies
* architecture
* testing
* maintainability

Avoid reopening settled product questions unless implementation reveals genuine conflict.

---

## Documentation

Capture durable knowledge.

Prefer documenting:

* principles
* terminology
* rationale
* constraints

Avoid documenting temporary implementation details that will quickly become outdated.

---

## Reflection

Capture:

* discoveries
* recurring patterns
* lessons learned
* improvements to the design process

Reflection strengthens future decision-making rather than changing current scope.

---

# Current Product Priority

Current milestone:

**Mezzo V2**

Priorities:

* polish
* simplification
* consistency
* recovery
* documentation
* implementation quality
* privacy
* trust

Avoid introducing significant new functionality unless the conversation explicitly shifts into exploration.

When uncertain, prefer improving the existing experience rather than expanding it.

---

# Product Architecture

From the user's perspective, Mezzo has two named experiences.

## Mezzo

Mezzo is the application used to:

* prepare for monitoring
* manage profiles
* calibrate
* start monitoring
* recover monitoring
* manage active sessions
* end monitoring

Users simply know this experience as **Mezzo**.

Internally, Mezzo is supported by a Session Window implemented by `try-it.html`/`try-it.js` — the same page that handles onboarding, since there is only one user-facing Mezzo experience, not a separate window per step. Session ownership logic itself lives in `src/mezzo-session.js`, reused by that page.

The Session Window owns:

* microphone access
* monitoring engine
* audio processing
* active profile
* calibration state
* session lifecycle
* browser integration required by Document Picture-in-Picture

Users should not need to learn the term "Session Window."

It is an architectural concept, not a product concept.

---

## Mezzo Companion

The Mezzo Companion is the small always-on-top monitoring experience beside the user's meeting.

It is the primary product experience during monitoring.

Internally it is implemented using the Document Picture-in-Picture API.

The Mezzo Companion owns:

* live visualization
* monitoring awareness
* peripheral feedback
* Start Monitoring / Stop Monitoring
* its own window state — Close Companion closes only the Companion
* its own layout mode — Expanded / Compact (see below)

The Companion never contains an End Session action — ending the overall session is Mezzo's responsibility, not the Companion's.

### Ready and Monitoring

The Companion has two states:

* **Ready** — preparation. No visualization. Users review the selected profile, choose a different existing one, or start monitoring. Always uses the Expanded layout.
* **Monitoring** — ambient awareness. Shows the live visualization, the current monitoring state, and the selected profile as read-only text. Profile selection is locked.

Preparation and monitoring are intentionally different experiences — Ready and Monitoring should never be built as one screen with elements toggled.

### Expanded and Compact

While Monitoring, the Companion also has a layout mode:

* **Expanded** (400×500) — the default; the only layout available while Ready.
* **Compact** (220×220) — an intentional peripheral-awareness mode, not a responsive fallback for small windows. It shows only the visualization and an Expand control. It deliberately omits the wordmark, monitoring status text, profile information, and Stop Monitoring — closing the native window is the canonical way to stop monitoring from Compact.

Session state, Companion state (open/closed), monitoring state (active/inactive), and layout mode (Expanded/Compact) are four separate concerns and must not be conflated or inferred from one another — see Single Source of Truth below.

From the user's perspective there is only one Companion, with no visible distinction between these internal states beyond what it shows on screen.

Do not introduce additional user-facing concepts such as:

* Companion Window
* Floating Companion
* Control Room
* Control Page
* Bring Companion to Front
* Pop Out

Those names create unnecessary mental models.

---

## Profiles

Profile responsibilities are intentionally divided:

* **Mezzo** creates profiles, runs calibration, and manages the saved-profile library.
* **The Companion** selects an existing profile and monitors using it — it never creates or calibrates a profile itself.

The Companion's profile menu ends with **Create New Profile…**, which returns the user to Mezzo's profile creation flow rather than duplicating it inside the Companion.

---

# Supporting Experiences

The product also includes supporting experiences that are not separate products.

## Marketing

Purpose:

* explain Mezzo
* establish trust
* communicate privacy
* encourage users to try the product

Visual language:

* warm
* editorial
* spacious

---

## Onboarding

Purpose:

* explain microphone access
* introduce profiles
* support calibration
* prepare users to open Mezzo

Onboarding is a preparation experience, not a monitoring experience.

---

# Canonical Terminology

User-facing terminology:

* Mezzo
* Mezzo Companion
* Try Mezzo
* Open Mezzo
* Open Companion
* Re-open Companion
* Close Companion
* Start Monitoring
* Stop Monitoring
* End Session

"Mezzo Companion" is for explanatory copy naming the product experience (e.g. "Start monitoring from the Mezzo Companion"). The controls themselves use the shorter action labels above — Open Companion, not Open Mezzo Companion.

Internal terminology:

* Marketing Site
* Onboarding
* Session Window
* Mezzo Companion
* Document Picture-in-Picture

Avoid exposing implementation terminology unless it is necessary to explain browser behavior or technical limitations.

The user should never need to understand browser architecture to understand Mezzo.

---

# Product Decision Principles

Every significant decision should be evaluated using the following principles.

## Protect the Mental Model

Users should only need to understand two product concepts:

* Mezzo
* Mezzo Companion

Avoid introducing additional names for implementation details.

If a browser limitation requires explanation, describe the behavior rather than exposing the underlying architecture whenever possible.

---

## Awareness Before Instruction

Mezzo coaches through awareness.

It does not judge.

It does not correct.

It does not score.

The interface should describe what is happening and trust the user to decide what to do.

Prefer descriptive language over corrective language.

For example:

Prefer:

* Quiet
* Within Range
* Approaching End of Range
* Outside Range

Avoid:

* Too Loud
* Warning
* Alert
* Incorrect
* Fix Your Volume
* Approaching Range (superseded by Approaching End of Range)

---

## Preserve Calm

The technically simplest solution is not always the correct product solution.

Avoid introducing:

* flashing
* blinking
* urgency without reason
* aggressive notification patterns
* punitive language
* gamification
* unnecessary visual complexity

Attention should increase gradually and continuously rather than through abrupt interruption.

---

## Protect User Trust

Every interaction should reinforce confidence that Mezzo behaves predictably.

Users should understand:

* why microphone access is needed
* when monitoring begins
* when monitoring ends
* what happens to their audio

Never imply privacy guarantees that the implementation cannot honestly support.

---

## Keep the Product Peripheral

The Mezzo Companion exists to support the meeting—not compete with it.

The best monitoring experience is one the user barely notices until they need it.

The Companion is an ambient object, not a control panel. The visualization is the product's visual hero — every other element on screen exists only in service of it, and Compact carries this to its logical conclusion by showing almost nothing else.

---

## Prefer Simplicity

When multiple solutions satisfy the same product goal, prefer the one with:

* fewer concepts
* fewer decisions
* clearer recovery
* lower cognitive load

Complexity should be earned. Every interface element should justify its existence — prefer progressive disclosure over exposing every control at once.

---

# Architecture Principles

The implementation should reinforce—not redefine—the intended product experience.

## Single Source of Truth

The Session Window owns the monitoring session.

It owns:

* microphone access
* monitoring engine
* active profile
* calibration
* monitoring lifecycle
* session recovery
* cleanup

The Mezzo Companion presents monitoring information.

It should not independently own monitoring state.

Avoid duplicated state whenever possible.

When state must be synchronized across windows, establish a clear source of truth.

Four concerns are related but distinct, and must not be conflated or inferred from one another:

* **Session state** — whether a monitoring session exists at all (owned by the Session Window).
* **Companion state** — whether the Companion window is open or closed.
* **Monitoring state** — whether monitoring is active or inactive.
* **Layout mode** — Expanded or Compact, meaningful only while the Companion is open.

For example, layout mode must never be inferred from window dimensions, and monitoring state must never be inferred from whether the Companion window merely exists.

---

## Separation of Concerns

Separate:

* product logic
* monitoring engine
* UI
* visualization
* browser integration

Business logic should remain independent from rendering.

The visualization should communicate state, not compute it.

---

## Reuse Before Reinvention

Before introducing new architecture:

* review the existing implementation
* reuse existing components
* extend current systems where practical

Avoid rewriting stable systems without a compelling product reason.

---

## Maintainability

Prefer:

* modular components
* reusable utilities
* feature-based organization
* explicit ownership
* predictable lifecycle management

Avoid:

* duplicated business logic
* duplicated state
* tightly coupled UI and monitoring code

---

# Engineering Principles

Implementation decisions should support long-term maintainability.

Always:

* inspect the existing codebase before making large changes
* preserve established behavior unless intentionally changing the experience
* document architectural decisions
* favor explicitness over cleverness

If implementation appears to conflict with product intent:

Stop.

Clarify the intended experience before changing architecture.

---

# Accessibility Principles

Accessibility is part of the product experience.

The monitoring visualization should remain understandable without relying solely on color.

Communicate state through combinations of:

* contour count
* motion
* propagation
* geometry
* glow
* restrained color

Support:

* keyboard navigation
* appropriate semantic labeling
* reduced motion preferences
* sufficient contrast

Reduced motion should preserve awareness without removing meaningful state communication.

Accessibility improvements should reinforce Mezzo's calm character rather than introducing conventional warning metaphors.

---

# Motion Principles

Motion should feel natural.

It should communicate changing energy rather than system notifications.

Motion should be:

* continuous
* smooth
* restrained
* purposeful

Never animate solely for decoration.

Every animation should communicate meaningful state.

---

# Documentation System

Documentation is the project's long-term memory.

Each document has a distinct responsibility.

## CLAUDE.md

Defines:

* product philosophy
* terminology
* architecture
* collaboration model
* engineering principles
* documentation structure

This document should remain durable.

It should change only when the product itself evolves.

---

## product-experience.md

Defines:

* user journeys
* interaction flows
* monitoring lifecycle
* recovery behavior
* monitoring states
* visualization behavior

It answers:

"What should users experience?"

---

## PRDs

Define individual features.

Each PRD should describe:

* problem
* goals
* scope
* constraints
* acceptance criteria
* open questions

PRDs should not redefine the product.

---

## design-principles.md

Documents reusable visual, interaction, motion, and copy principles that extend beyond a single feature.

---

## natural-systems.md

Documents the philosophy behind:

* breathing
* propagation
* contour behavior
* organic motion
* peripheral awareness

---

## discoveries/

Capture:

* browser limitations
* implementation discoveries
* research
* experiments
* unresolved questions

These are historical records, not canonical product definitions.

---

## Implementation Notes

Implementation notes may document:

* temporary constraints
* migration plans
* technical debt
* debugging observations

They should not become the authoritative source for product decisions.

---

# Scope Discipline

Current milestone:

Mezzo V2

Before implementing a new idea, determine whether it is:

* required to complete the current experience
* a usability improvement
* a trust improvement
* a documentation improvement
* future exploration

Future ideas should be captured without silently expanding the current milestone.

---

# Decision Hierarchy

When tradeoffs are necessary, prioritize:

1. User experience
2. Product philosophy
3. Privacy
4. Accessibility
5. Reliability
6. Simplicity
7. Technical elegance

A technically clever implementation that weakens the intended experience is not the correct solution.

---

# Definition of Done

A feature is complete only when it:

* aligns with the product vision
* reinforces Mezzo's philosophy
* preserves user trust
* follows canonical terminology
* matches the intended user experience
* integrates naturally with existing workflows
* uses the established design system
* remains accessible
* remains maintainable
* includes appropriate documentation

Passing tests alone does not mean the experience is complete.

The implementation should also feel consistent with Mezzo's values.

---

# Success Criteria

Mezzo succeeds when:

* users immediately understand what the product does
* the relationship between Mezzo and the Mezzo Companion feels obvious
* users do not need to understand browser implementation details
* monitoring feels ambient rather than intrusive
* recovery is calm and understandable
* privacy behavior matches privacy messaging
* the interface remains visually restrained during meetings
* terminology stays consistent across every surface
* documentation preserves product intent as the implementation evolves

The strongest implementation is not the one with the most features.

It is the one that most clearly expresses Mezzo's purpose.

---

# Closing Principle

Whenever uncertainty exists, return to the central question:

**Does this make Mezzo feel calmer, clearer, and more trustworthy?**

If the answer is no, reconsider the decision before implementing it.
