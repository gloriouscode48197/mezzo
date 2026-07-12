# Mezzo Design Evolution

> *A high-level record of the major design iterations, the questions they explored, and the outcomes that shaped Mezzo.*

---

# Purpose

This document provides an overview of Mezzo's design evolution.

Each iteration explored a specific product or design question. Some resulted in features that became part of the product, while others helped eliminate ideas that ultimately didn't support the experience.

Detailed explorations, mockups, prompts, and supporting documents live in their respective iteration folders.

---

# Design Philosophy

Throughout the project, one principle remained constant:

> **Mezzo should quietly help people become more aware of their speaking volume without interrupting their conversations.**

Every iteration attempted to improve that balance between awareness and distraction.

---

# Iteration Timeline

---

## Iteration 01 — Defining the Product

**Goal**

Define what Mezzo is and what problem it solves.

**Question**

How can people become more aware of their speaking volume during meetings without relying on notifications or post-meeting analytics?

**Outcome**

Established Mezzo as an ambient, real-time feedback tool focused on self-awareness rather than correction.

**Key Decisions**

- Privacy-first architecture.
- No recordings.
- Real-time feedback only.
- User-controlled speaking profiles.

---

## Iteration 02 — Exploring the Visual Metaphor

**Goal**

Find an emotional design language.

**Question**

What visual system communicates calm awareness instead of judgment?

**Outcome**

Explored Japanese sumi-e, shodo, wabi-sabi, and Zen aesthetics.

These explorations established the emotional tone but proved too expressive for a monitoring interface.

**Key Learning**

Keep the philosophy.

Reduce the ornamentation.

---

## Iteration 03 — Simplifying the Product Experience

**Goal**

Reduce friction.

**Question**

What is the smallest experience required to begin monitoring?

**Outcome**

The browser extension became the primary entry point.

The web application shifted from being the primary experience to acting as Mezzo's control center.

**Key Decisions**

- Extension launches Mezzo.
- PiP becomes the primary monitoring surface.
- Profiles become persistent.
- Returning users start faster.

---

## Iteration 04 — Designing for Peripheral Awareness

**Goal**

Design a visualization that can be understood without demanding attention.

**Question**

How can Mezzo quietly attract attention only when necessary?

**Outcome**

Multiple interaction concepts were explored including:

- organic deformation
- contour fields
- ripple propagation
- orbital highlights
- migrating contours
- glow
- rhythm-based communication

Many concepts were intentionally discarded after evaluation.

**Key Learning**

Motion attracts attention more effectively than shape alone.

---

## Iteration 05 — From Decoration to Meaning

**Goal**

Ensure every visual element communicates something.

**Question**

Why does every ring exist?

**Outcome**

The visualization was simplified.

Rather than permanent decorative rings, each contour now represents increasing distance from the user's calibrated speaking range.

The visualization became additive rather than replacing one animation with another.

**Key Decisions**

- Dot represents the speaker.
- First ring represents equilibrium.
- Additional contours appear only as vocal energy increases.
- Propagation represents detected speech.
- Color represents sustained deviation.

---

## Iteration 06 — Ambient Instrument

**Goal**

Create a coherent interaction language.

**Question**

How should Mezzo communicate through motion?

**Outcome**

The visualization evolved from an animated graphic into an ambient instrument.

Instead of alerts, the interface communicates through gradual accumulation:

- rhythm
- contour
- glow
- warmth
- motion

**Key Learning**

The visualization should feel like observing a physical field rather than reading a meter.

---

## Iteration 07 — Product Integration

**Goal**

Integrate the visualization into the overall product experience.

**Question**

How should users interact with Mezzo before, during, and after meetings?

**Outcome**

Defined:

- Extension-first launch
- Dedicated companion window
- PiP-first monitoring
- Lightweight control room
- Profile persistence
- Simplified monitoring flow

The visualization became one part of a larger ambient experience.

---

# Major Product Decisions

The following decisions significantly influenced Mezzo's direction.

- PiP became the primary interaction surface.
- The browser extension became the primary entry point.
- Monitoring became privacy-first.
- The web app became a companion rather than the primary interface.
- The visual language shifted from expressive ink painting to restrained geometric resonance.
- Motion became the primary communication channel.
- Every visual element was required to communicate a specific piece of information.

---

# Ongoing Exploration

The following areas remain active exploration topics.

- Peripheral awareness
- Motion refinement
- Accessibility
- Glow and contrast
- Ambient lighting integrations
- Shared meeting-space feedback
- Additional companion experiences

---

# Repository Structure

Each iteration has its own folder containing:

- prompts
- mockups
- screenshots
- design rationale
- implementation notes
- lessons learned
- future ideas

This document serves as the index connecting those explorations into a single design narrative.