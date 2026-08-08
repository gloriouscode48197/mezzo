---
name: project-onboarding
description: Use at the start of every new Claude Code session on Mezzo before making any code changes. Establishes accurate understanding of current product docs, architecture, and implementation state by reading CLAUDE.md and the product-experience docs, then verifying them against the actual codebase, before proposing or implementing any change.
---

# Project Onboarding

Use this skill at the beginning of every new Claude Code session before making any code changes.

## Objective

Establish an accurate understanding of the current state of the Mezzo project before proposing or implementing changes.

Do not assume previous conversational context. Treat the repository as the source of truth.

---

## Step 1 — Review project documentation

Read and summarize:

1. `CLAUDE.md`
2. The primary UX/Product Experience document
3. Any additional documentation referenced by those files that is directly relevant to the requested work

Pay particular attention to:

- product vision
- current UX flows
- terminology
- architectural conventions
- implementation constraints
- known technical debt
- active MVP decisions
- historical decisions that should not be reintroduced

---

## Step 2 — Verify documentation against implementation

Before proposing changes:

- inspect the current implementation
- identify any differences between documentation and code
- determine whether documentation appears outdated
- note any areas where implementation has evolved beyond the docs

If discrepancies exist, clearly identify:

- Documentation says...
- Implementation does...
- Recommendation...

Do not silently assume one is correct.

---

## Step 3 — Understand the requested feature

Before writing code:

- identify the relevant modules
- explain the existing implementation
- describe how the requested work fits into the current architecture
- identify potential edge cases
- identify risks or unintended consequences

If a simpler implementation exists, recommend it.

---

## Step 4 — Produce an implementation plan

Before modifying code, provide:

- summary of current behavior
- proposed behavior
- files likely to change
- architecture impact
- testing approach

Wait for approval if the requested change could materially affect UX, architecture, or existing behavior.

---

## Guiding Principles

Favor:

- extending existing architecture
- consistency with current UX
- simplicity
- maintainability
- incremental changes

Avoid:

- unnecessary abstractions
- duplicate state
- duplicate logic
- introducing new patterns when existing ones work
- changing established UX without explaining why

---

## Success Criteria

Before implementation, you should be able to explain:

- where we are today
- how the current system works
- how the proposed change integrates into the existing architecture
- why the proposed solution is preferable

---

## Completion

Once implementation is complete, run the `docs-sync` skill before considering the task finished.

The project is not complete until documentation has been reviewed for accuracy and updated where necessary.
