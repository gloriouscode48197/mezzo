# CLAUDE.md

# Mezzo — Operational Guide for Claude Code

**Product:** Mezzo
**Current Milestone:** V2
**Purpose:** How Claude should think and work on Mezzo — terminology, architecture boundaries, and decision rules that affect implementation. For how Mezzo itself behaves, see `docs/product-experience.md`.

---

# Purpose

This document governs how to work on Mezzo, not what Mezzo is.

`docs/product-experience.md` is the canonical description of the product: values, positioning, user journeys, screen-by-screen behavior, monitoring states, visualization behavior.

This document summarizes only what materially changes implementation behavior — architecture ownership, terminology Claude should type into code, and decision rules. Where a concept is fully explained elsewhere, this file keeps the concise, operational version and points there rather than duplicating it.

When implementation conflicts with this document, determine whether the implementation has drifted before changing the rule.

See the Documentation Map at the end of this file for where everything else lives.

---

# Collaboration Rules

These instructions affect your behavior every session and therefore belong here rather than another document.

* Determine whether a request is exploration, product decision-making, implementation, documentation, or reflection before acting.
* Do not assume the first proposed solution is the settled product decision.
* Ask what problem a request is trying to solve when intent is unclear.
* Preserve settled product decisions unless there is a compelling reason to revisit them.
* Challenge assumptions that weaken clarity, privacy, trust, or the current milestone.
* Do not turn every discussion into an implementation task.

---

# Product Purpose

Mezzo is a privacy-first voice awareness tool that helps people notice their speaking volume during meetings — gentle visual awareness, not evaluation or interruption.

Mezzo is not a coaching app, dashboard, analytics tool, meeting assistant, or accessibility product. It exists to provide calm, peripheral awareness of speaking volume.

> Always reassuring. Occasionally attention-grabbing. Never distracting.

For the full product definition, values, and "what Mezzo is / is not" boundaries, see `docs/product-experience.md`.

---

# Current Milestone: V2

Priorities: polish, simplification, consistency, recovery, documentation, implementation quality, privacy, trust.

Avoid introducing significant new functionality unless the conversation explicitly shifts into exploration.

When uncertain, prefer improving the existing experience over expanding it.

---

# Non-Negotiable Decisions

These are settled. Do not revisit them without an explicit product-strategy conversation.

* Users understand only two product concepts: **Mezzo** and **Mezzo Companion**.
* Mezzo creates and manages profiles, runs calibration, and starts the first monitoring session.
* The Companion handles live monitoring, Stop, its own Ready state, and every subsequent Start Monitoring.
* Start Monitoring, from Mezzo, opens the Companion directly into Monitoring for the first session — there is no intermediate Ready checkpoint.
* Closing the Companion stops monitoring and returns Mezzo to profile selection, on the Speaking Profile page.
* There is no "Re-open Companion" flow. Starting again always opens a fresh Companion straight into Monitoring.
* The Session Window — `try-it.html`/`try-it.js` plus `src/mezzo-session.js` — is the single source of truth for the monitoring session.
* Session state, Companion state, monitoring state, and layout mode are four separate concerns and must never be conflated or inferred from one another.
* Speaking profiles are local-only: stored in the browser, no account required, never uploaded or synced to any server, as part of the profile experience. This describes profile data specifically — it is not a claim that Mezzo makes zero network requests. Anonymous, audio-free product-usage analytics exist separately (see Privacy Principles) and never carry profile content, audio, or volume data.
* Privacy is primarily demonstrated through architecture. Surface it in user-facing copy where it materially affects trust, but do not repeat privacy messaging indiscriminately across every screen.
* Compact mode is an intentional peripheral-awareness mode, not a responsive fallback for small windows.

---

# Privacy Principles

Privacy is a product principle, not a marketing feature.

Mezzo:

* processes audio locally
* never records audio
* never stores audio
* never transmits audio as part of the core monitoring experience
* never transcribes speech
* never analyzes conversation content
* never identifies speakers

Whenever implementation decisions affect privacy, choose the option that most clearly preserves user trust.

If product messaging cannot honestly describe the implementation, change the implementation before the messaging.

---

# Canonical Terminology

Exact strings to use in code, UI copy, and commit messages:

* Mezzo
* Mezzo Companion
* Try Mezzo
* Open Mezzo
* Start Monitoring
* Stop
* Close Companion
* Create New Speaking Profile
* Create New Profile…
* End Session

Two rules that directly affect what gets built:

* There is no "Open Companion" or "Re-open Companion" action — don't build one. Start Monitoring, from Mezzo, opens the Companion and begins the first session; Start Monitoring, from the Companion's own Ready screen, begins every session after that.
* **Create New Speaking Profile** (Mezzo's Speaking Profile page) and **Create New Profile…** (the Companion's profile menu) are two distinct controls — don't merge or rename them to match each other.

Never introduce alternate names for the Companion in code or UI: no Companion Window, Floating Companion, Control Room, Control Page, "Bring Companion to Front," or "Pop Out."

Internal-only terms — never surface to users: Marketing Site, Onboarding, Session Window, Document Picture-in-Picture.

Full terminology usage in context lives in `docs/product-experience.md`.

---

# Product Architecture

Two named experiences, from the user's perspective. Full description: `docs/product-experience.md`'s "Product Mental Model."

## Mezzo

Implemented as the Session Window: `try-it.html`/`try-it.js` — also handles onboarding, since there is only one user-facing Mezzo experience, not a separate window per step — plus `src/mezzo-session.js`, which owns session logic and is reused by that page.

Owns: microphone access, monitoring engine, audio processing, active profile, calibration state, session lifecycle, and the Document Picture-in-Picture integration.

"Session Window" is an architectural term only — never surface it to users.

## Mezzo Companion

Implemented via the Document Picture-in-Picture API.

Owns: live visualization, monitoring awareness, peripheral feedback, Start Monitoring for subsequent same-day sessions (from its own Ready screen), Stop, its own window state, and its own layout mode. Never contains an End Session action — that stays Mezzo's responsibility.

**States** — Ready (always Expanded) and Monitoring — must never be built as one screen with elements toggled. Full behavior: `docs/product-experience.md`'s "Companion States."

**Layout modes**, meaningful only while Monitoring: Expanded (400×500, default) and Compact (220×220). Full behavior: `docs/product-experience.md`'s "Compact Companion."

## Profiles

* Mezzo creates profiles, runs calibration, and manages the saved-profile library.
* The Companion only selects and monitors with an existing profile — it never creates or calibrates one.

---

# Single Source of Truth

The Session Window owns the monitoring session: microphone access, monitoring engine, active profile, calibration, monitoring lifecycle, session recovery, cleanup.

The Companion presents monitoring information. It never independently owns monitoring state.

Four concerns are related but distinct and must never be conflated or inferred from one another:

* **Session state** — whether a monitoring session exists at all. Owned by the Session Window.
* **Companion state** — whether the Companion window is open or closed.
* **Monitoring state** — whether monitoring is active or inactive.
* **Layout mode** — Expanded or Compact, meaningful only while the Companion is open.

Layout mode must never be inferred from window dimensions. Monitoring state must never be inferred from whether the Companion window merely exists.

---

# Product Decision Principles

**Awareness before instruction.** Mezzo describes what's happening — it doesn't judge, correct, or score.

Use: Quiet, Within Range, Approaching End of Range, Outside Range. Never: Too Loud, Warning, Alert, Incorrect, Fix Your Volume, or "Approaching Range" (superseded by "Approaching End of Range"). Full state descriptions: `docs/product-experience.md`'s "Monitoring States."

**Preserve calm.** Never introduce flashing, blinking, urgency without reason, aggressive notification patterns, punitive language, or gamification. Attention increases gradually and continuously, never through abrupt interruption.

**Keep the product peripheral.** The Companion is ambient, not a control panel — don't add controls or exposed settings without strong justification. Prefer progressive disclosure over surfacing every option at once.

---

# Engineering Rules

* Inspect the existing codebase before making large changes.
* Reuse and extend existing systems before rewriting stable ones.
* Preserve established behavior unless intentionally changing the experience.
* Keep product logic, the monitoring engine, UI, visualization, and browser integration separated — business logic independent of rendering; the visualization communicates state, it does not compute it.
* Avoid duplicated business logic and duplicated state.
* Favor explicitness over cleverness. Document architectural decisions.
* If implementation appears to conflict with product intent: stop, and clarify the intended experience before changing architecture.

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

When uncertain: does this make Mezzo feel calmer, clearer, and more trustworthy?

When a proposed implementation conflicts with a Non-Negotiable Decision, preserve the decision unless the conversation explicitly revisits it.

---

# Documentation Map

* **CLAUDE.md** (this file) — operational guide for working on Mezzo: terminology to use in code, architecture boundaries, and decision rules that affect implementation. Changes only when those rules change.
* **`docs/product-experience.md`** — canonical description of the product itself: values, positioning, user journeys, screen-by-screen behavior, monitoring states, visualization behavior.
* **`docs/design-principles.md`** — reusable visual, interaction, motion, and copy principles that extend beyond a single feature. *(proposed — not yet created)*
* **`docs/natural-systems.md`** — the philosophy behind breathing, propagation, contour behavior, organic motion, peripheral awareness. *(proposed — not yet created)*
* **PRDs** — individual feature requirements: problem, goals, scope, constraints, acceptance criteria, open questions. Never redefine the product.
* **`docs/discoveries/`** — browser limitations, implementation discoveries, research, experiments, unresolved questions, and tracked technical debt. Historical record, not canonical. *(proposed — not yet created)*
* **Implementation notes** — temporary constraints, migration plans, technical debt. Never authoritative for product decisions.
