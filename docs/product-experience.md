# Mezzo Product Experience

**Version:** V2  
**Status:** Current Product Vision

---

# Purpose

This document describes Mezzo from the **user's perspective**, not the implementation.

Its goal is to ensure that product decisions, engineering work, and design all reinforce the same mental model.

If implementation details conflict with this document, pause and discuss the product experience before changing code.

---

# Product Summary

Mezzo is a private, ambient speaking companion that helps people become more aware of their speaking volume during conversations.

Mezzo is intentionally calm.

It does not interrupt.

It does not analyze speech.

It simply provides gentle visual feedback that allows people to self-regulate naturally.

---

# Core Product Principle

Users should never need to understand browser APIs, extension architecture, or technical limitations.

They should simply experience:

```text
Learn about Mezzo

↓

Launch Mezzo

↓

Start Monitoring

↓

Floating Companion appears

↓

Glance occasionally while speaking
```

Everything else is implementation.

---

# The Three Experiences

## 1. Marketing Experience

Purpose:

Help people understand:

- What Mezzo is
- Why it exists
- Why they should trust it

Pages include:

- Home
- Privacy
- How It Works
- Future documentation

Visual language:

- Warm
- Editorial
- Spacious
- Uses the complete Mezzo design palette

The product itself should remain the visual hero.

---

## 2. Companion Window

Purpose:

Manage the monitoring session.

The Companion is **not** where monitoring happens.

Responsibilities:

- Launch monitoring
- Select profiles
- Create profiles
- Recover the Floating Companion
- End monitoring
- Explain session state

Visual language:

- Light
- Calm
- Functional

During meetings, users should rarely need to look at it.

---

## 3. Floating Companion

Purpose:

Provide ambient speaking awareness.

This is the primary product experience.

Visual language:

- Dark
- Minimal
- Optimized for peripheral vision

The Floating Companion should feel like a quiet instrument—not a dashboard.

---

# First-Time User Journey

```text
Website

↓

Click Try Mezzo

↓

Understand microphone permission

↓

Choose:

• Recommended
or
• Custom Profile

↓

Calibrate (if needed)

↓

Ready

↓

Companion Window opens

↓

Start Monitoring

↓

Floating Companion opens

↓

Meeting

↓

End Monitoring
```

## Goals

The first experience should:

- Build trust
- Require minimal decisions
- Clearly explain why permissions are needed
- Never surprise the user

---

# Returning User Journey

```text
Launch Extension

↓

Companion Window opens

↓

Previous profile already selected

↓

Start Monitoring

↓

Floating Companion opens

↓

Meeting

↓

End Monitoring
```

Returning users should experience as little friction as possible.

---

# During a Meeting

The user should primarily interact with the Floating Companion.

The Companion Window remains open only because it owns the monitoring session.

Users should be able to:

- Ignore it
- Minimize it
- Return to it if needed

---

# Session Ownership

The Companion owns:

- microphone
- monitoring engine
- profiles
- session lifecycle

The Floating Companion owns:

- visualization
- ambient feedback

Closing the Companion ends the session.

Closing the Floating Companion should allow recovery whenever the browser permits.

---

# Monitoring States

## Within Range

Visual language:

- Center dot
- One perfect circular ring
- Warm white
- Gentle breathing

If speaking:

- subtle glow
- restrained propagation

The visualization should feel calm.

---

## Approaching Range

Visual language:

- Add one outer contour
- Slight organic distortion
- Motion becomes more noticeable

Purpose:

Catch attention before correction becomes necessary.

---

## Outside Range

Visual language:

- Add third contour
- Transition to Mezzo orange
- Stronger glow
- More energetic propagation

Purpose:

Become noticeable without feeling alarming.

Never blink.

Never flash.

Never punish.

---

# Recovery

## Floating Companion closes

Monitoring continues.

The Companion displays:

> Floating Companion closed.

Actions:

- Show Floating Companion
- End Monitoring

---

## Companion closes

Explain:

Closing the Companion ends the monitoring session because it owns the session.

---

## Browser doesn't support Floating Companion

The Companion becomes the monitoring experience.

This is an alternate supported experience—not a degraded fallback.

Users should understand why this experience differs.

---

# Design Principles

Everything should reinforce:

Calm.

Presence.

Restraint.

Trust.

Avoid:

- dashboards
- alerts
- gamification
- aggressive colors
- unnecessary motion

Every visual element should communicate meaning.

---

# Product Philosophy

Mezzo should feel like:

A trusted companion sitting quietly beside you.

Never the center of attention.

Never the loudest thing on your screen.

---

# Experience Review Checklist

Before shipping any feature, ask:

### Understanding

- Does this make the product easier to understand?
- Would a first-time user know what to do?

### Trust

- Does this reinforce privacy?
- Does it avoid surprises?

### Simplicity

- Is there a simpler flow?
- Are we exposing browser implementation details unnecessarily?

### Consistency

- Does this reinforce the Companion / Floating Companion mental model?
- Does it use the established terminology?

### Calm

- Is the experience still ambient?
- Are we attracting attention only when necessary?

If the answer to any of these questions is "no," revisit the design before implementing.

---

# North Star

A successful Mezzo session feels almost invisible.

The user launches it, forgets it's there, notices it only when needed, and finishes the meeting feeling more aware—not interrupted.