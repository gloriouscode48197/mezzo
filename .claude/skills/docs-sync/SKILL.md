---
name: docs-sync
description: Use after completing a feature, UX change, refactor, or architectural change on Mezzo. Compares the final implementation against CLAUDE.md and the Product Experience/UX documentation, identifies drift, and updates the canonical docs so they accurately reflect current behavior before the task is considered complete.
---

# Documentation Sync

Use this skill after completing a feature, UX change, refactor, or architectural change.

## Objective

Ensure Mezzo's documentation accurately reflects the current implementation before the task is considered complete.

Do not assume the documentation is already correct. Compare the final implementation against the documented product behavior.

---

## Step 1 — Review What Changed

Inspect the completed code changes and summarize:

- what behavior changed
- what UX changed
- what terminology changed
- what architecture or state-management behavior changed
- what existing behavior was intentionally preserved

Focus on user-visible behavior and decisions that future development sessions need to understand.

---

## Step 2 — Review Relevant Documentation

Read:

1. `CLAUDE.md`
2. The primary Product Experience / UX document
3. Any PRD, feature document, architecture note, or test documentation directly related to the completed work

Determine whether any of these documents now conflict with the implementation.

---

## Step 3 — Identify Documentation Drift

For each discrepancy, report:

- **Documentation says:** current documented behavior
- **Implementation does:** actual behavior in the code
- **Recommended update:** what the documentation should say now

Do not silently rewrite ambiguous product decisions.

If the implementation appears inconsistent with an intentional product decision, flag it instead of updating the documentation to match potentially incorrect code.

---

## Step 4 — Update the Canonical Documentation

Update documentation when the implemented behavior is intentional and confirmed.

Prioritize the Product Experience document for:

- user flows
- terminology
- interaction behavior
- states and transitions
- permission behavior
- onboarding
- calibration
- speaking profiles
- Ready state
- monitoring behavior
- PiP Companion behavior

Keep the document focused on current product behavior.

Do not preserve obsolete behavior in the main flow merely for historical context.

If historical context is valuable, clearly label it as historical or move it to an appropriate archive / decision log.

---

## Step 5 — Update CLAUDE.md Only When Necessary

Update `CLAUDE.md` when the completed work changes information Claude needs in future development sessions, such as:

- architecture
- important implementation constraints
- canonical files
- testing requirements
- terminology
- known browser limitations
- development workflow
- active product decisions

Do not turn `CLAUDE.md` into a changelog.

Keep it concise and useful for future sessions.

---

## Step 6 — Review Related Documentation

Check whether the completed change affects:

- PRDs
- implementation plans
- UX flow documentation
- architecture documentation
- tests or testing instructions
- README content
- deprecated or historical documents

Do not update unrelated files.

If an older document is now misleading but should remain for history, label it clearly as outdated, historical, or superseded.

---

## Step 7 — Validate the Final State

Before finishing:

- verify documentation matches the final code
- verify terminology is consistent across documents
- verify no active document still describes the old behavior as current
- verify links and referenced filenames are still correct
- inspect the git diff to ensure documentation changes are limited to what is necessary

---

## Final Report

Provide a concise summary with:

### Documentation updated
List each file changed and why.

### No update needed
List relevant files reviewed that remain accurate.

### Potential drift or follow-up
Identify anything that still needs a product decision or further investigation.

### Final source of truth
State which document now defines the current UX behavior.

---

## Guiding Principles

Favor:

- current behavior over stale history
- one canonical source of truth
- concise documentation
- explicit terminology
- documentation that helps the next development session quickly understand the product

Avoid:

- duplicating the same UX specification across multiple files
- preserving obsolete requirements as though they are current
- documenting implementation details that do not help future development
- turning documentation into a chronological log of every change
- updating docs merely to rationalize an accidental implementation
