# Mezzo

## Product Vision

Mezzo is a privacy-first meeting companion that helps people become more aware of their speaking volume during conversations.

Rather than measuring performance or interrupting meetings, Mezzo provides calm, real-time feedback that allows people to naturally self-regulate their speaking volume.

The product should always feel supportive rather than corrective.

**Product principle:**

> Always reassuring. Occasionally attention-grabbing. Never distracting.

---

# Product Philosophy

Mezzo is not:

- a decibel meter
- a speech analyzer
- a transcription service
- a meeting assistant

Mezzo is:

- an ambient companion
- a private self-awareness tool
- a lightweight product that quietly accompanies meetings

Every design and engineering decision should reinforce this philosophy.

---

# Technology

- HTML
- CSS
- Vanilla JavaScript
- Web Audio API
- Document Picture-in-Picture API
- Chrome Extension APIs

The existing audio engine is already implemented.

Do **not** rewrite or replace the monitoring engine unless a task explicitly requires it.

Always build on the existing implementation before introducing new architecture.

---

# Design System

Use the existing design token system.

Files:

- `/design/mezzo-tokens.css`
- `/design/mezzo-tokens.json`

Do not hardcode:

- colors
- spacing
- typography
- component styles

Always prefer the existing design tokens.

---

# Product Architecture

Mezzo consists of three distinct experiences.

Each has a different purpose and intentionally different visual language.

---

## 1. Marketing Experience

Purpose:

Introduce Mezzo, explain how it works, establish trust, and encourage users to begin monitoring.

Examples:

- Home
- Privacy
- How It Works
- Documentation
- Future marketing pages

Visual language:

- Light
- Editorial
- Calm
- Spacious
- Uses the full Mezzo palette

The product itself should remain the visual focal point.

---

## 2. Companion Window

The Companion Window owns the monitoring session.

It exists both as:

- the management interface
- the runtime owner required by the browser

Responsibilities:

- Launch monitoring
- Select profiles
- Manage profiles
- Display monitoring status
- Recover the Floating Companion
- End monitoring

Users are not expected to monitor from this window.

Visual language:

- Light
- Calm
- Functional
- Consistent with the marketing website

The Companion should feel like managing Mezzo—not using Mezzo.

---

## 3. Floating Companion

The Floating Companion is the primary product experience.

Internally it uses the Document Picture-in-Picture API.

Purpose:

Provide real-time ambient speaking awareness while remaining in the user's peripheral vision.

Visual language:

- Dark
- Minimal
- Focused
- Ambient

The Floating Companion should never feel like a dashboard.

It should feel like a quiet instrument.

---

# User Journey

The intended experience is:

Website

↓

Launch Monitoring

↓

Companion Window

↓

Floating Companion

↓

Meeting

Monitoring occurs inside the Floating Companion.

The Companion Window remains open to own the session and support recovery.

Closing the Companion Window ends the monitoring session because the browser requires it.

This dependency should always be communicated clearly to users.

---

# Monitoring Visualization

The visualization communicates speaking state through calm, additive changes rather than alarms.

## Within Range

- Center dot
- One perfect circular ring
- Gentle continuous motion
- Optional subtle glow and propagation while speaking

## Approaching Range

- Add a second outer contour
- Outer contour becomes subtly organic
- Motion becomes slightly more noticeable
- Remains warm white

## Outside Range

- Add a third contour
- Transition to Mezzo orange
- Increase glow and propagation
- Improve peripheral visibility without blinking

---

## Visualization Principles

- The visualization container never changes size.
- The background never flashes or inverts.
- Motion should communicate state, never decorate.
- Every visual element should have a clear purpose.
- Changes should build progressively rather than replacing previous states.

---

# Privacy Principles

Privacy is a product feature.

Audio handling must always follow these rules:

- Process audio locally.
- Never record audio.
- Never store audio.
- Never transmit audio.
- Never transcribe speech.
- Never analyze conversation content.
- Collect only minimal anonymous analytics required to improve the product.

Whenever implementation decisions involve privacy, prefer the most privacy-preserving option.

---

# Visual Language

Mezzo's visual identity is inspired by natural systems rather than technical instrumentation.

Keywords:

- Calm
- Ambient
- Organic
- Peripheral
- Listening
- Presence
- Balance
- Restraint

Avoid:

- Aggressive alerts
- Flashing
- Warning metaphors
- Gamification
- Dashboard aesthetics

---

# Terminology

## Internal

- Companion Window — parent browser window
- Floating Companion — Document Picture-in-Picture window

## User Facing

Prefer:

- Companion
- Floating Companion

Avoid:

- Control Room
- Control Page
- Picture-in-Picture (except in technical documentation)

---

# Engineering Principles

Before implementing new features:

- Review the existing codebase.
- Reuse existing components whenever possible.
- Avoid duplicating business logic.
- Keep monitoring logic independent from UI.
- Prefer composition over duplication.
- Preserve backward compatibility unless explicitly changing behavior.

When implementation and product intent appear to conflict:

**Ask for clarification rather than making assumptions.**

---

# Decision Hierarchy

When making implementation decisions, prioritize in this order:

1. User experience
2. Product philosophy
3. Privacy
4. Accessibility
5. Simplicity
6. Technical elegance

A technically clever implementation that weakens the user experience is not the correct solution.

---

# Definition of Done

A feature is complete only when it:

- Matches the intended user experience.
- Aligns with Mezzo's product philosophy.
- Preserves privacy.
- Integrates naturally with existing workflows.
- Uses the existing design system.
- Remains simple and maintainable.

Passing tests alone does not mean the experience is complete.