---
name: pre-commit
description: Use after implementation and documentation updates are complete, but before creating a git commit on Mezzo. Performs a final engineering, UX, and repository-quality review of the diff — correctness, simplicity, consistency, dead code, UX, accessibility, responsive/visual behavior, tests, and documentation sync — and reports whether the work is ready to commit.
---

# Pre-Commit Review

Use this skill after implementation and documentation updates are complete, but before creating a git commit.

## Objective

Perform a final engineering, UX, and repository-quality review of the completed work.

The goal is to catch regressions, unnecessary complexity, documentation drift, accidental changes, and unfinished cleanup before the work is committed.

Do not modify code immediately. First inspect the final diff, summarize findings, and distinguish between:

- issues that should be fixed before commit
- optional improvements
- acceptable tradeoffs
- unrelated pre-existing issues

---

## Step 1 — Review Repository State

Inspect:

- `git status`
- the complete staged and unstaged diff
- newly added files
- deleted files
- renamed files
- generated or temporary files that may have been added accidentally

Confirm that every changed file is relevant to the task.

Flag:

- accidental edits
- unrelated formatting changes
- temporary files
- debug artifacts
- unexpected dependency changes
- generated output that should not be committed

Do not assume every existing change belongs to the current task.

---

## Step 2 — Reconstruct the Intended Change

Briefly summarize:

- the original problem
- the intended behavior
- what was implemented
- what behavior was intentionally preserved

Use the Product Experience document and relevant task documentation to verify intent.

The implementation should be evaluated against the intended product behavior, not merely against whether the code runs.

---

## Step 3 — Review the Code Diff

Review the changed code for:

### Correctness

Check for:

- incorrect conditions
- incomplete state transitions
- missing error handling
- stale state
- race conditions
- browser lifecycle issues
- assumptions that fail on first use or returning use
- failure paths that leave the UI in an invalid state

### Simplicity

Look for:

- unnecessary abstractions
- duplicate logic
- duplicate state
- repeated constants
- avoidable wrappers
- overly complex conditionals
- code introduced only to work around another new piece of code

Prefer the simplest implementation that fits the existing architecture.

### Consistency

Verify that the implementation follows existing:

- naming conventions
- state-management patterns
- component patterns
- event handling
- module boundaries
- error handling
- testing conventions

Avoid introducing a new pattern when an existing one already solves the problem.

---

## Step 4 — Check for Dead or Obsolete Code

Look for code that became unnecessary because of the change.

Check for:

- old event listeners
- retired state
- obsolete permission logic
- unused functions
- unused exports
- unreachable branches
- stale UI copy
- old CSS selectors
- duplicated implementations
- tests that only cover behavior that no longer exists

Do not remove code merely because it appears old.

Verify that it is genuinely unreachable or obsolete before recommending deletion.

---

## Step 5 — Review UX Behavior

For any user-facing change, verify:

- the implemented flow matches the intended UX
- primary and secondary actions are clear
- error states are understandable
- returning-user behavior is correct
- first-time-user behavior is correct
- no unexpected screens, prompts, or transitions were introduced
- the user is not required to understand technical browser behavior

Check wording and terminology against the Product Experience document.

Flag any implementation that technically works but creates confusing UX.

---

## Step 6 — Accessibility Review

For UI changes, inspect for obvious accessibility regressions.

Check:

- semantic HTML
- keyboard accessibility
- focus behavior
- visible focus states
- button vs. link semantics
- accessible labels
- heading hierarchy
- status/error announcements where appropriate
- color-dependent communication
- sufficient text alternatives for meaningful icons

Do not redesign unaffected UI.

Only flag issues introduced or materially affected by the current change unless an existing issue blocks the new experience.

---

## Step 7 — Responsive and Visual Review

If the change affects layout or visual presentation, verify the implementation across relevant viewport sizes.

Check for:

- overflow
- clipping
- unexpected scrollbars
- collapsed spacing
- broken alignment
- text wrapping
- PiP sizing issues
- controls leaving the viewport
- layout rules that behave differently at established breakpoints

Preserve approved visual design unless the task explicitly changes it.

---

## Step 8 — Test Review

Review the tests related to the change.

Confirm:

- existing relevant tests still pass
- new behavior has appropriate coverage
- changed behavior has updated coverage
- failure paths are tested where meaningful
- tests reflect intended UX rather than implementation details
- removed behavior does not leave obsolete tests behind

Run the appropriate test suite.

If there are multiple levels of testing, prioritize:

1. focused unit tests for changed modules
2. relevant integration tests
3. relevant end-to-end or Playwright tests
4. broader regression suite when practical

Report exact test results.

Do not claim tests passed unless they were actually run.

---

## Step 9 — Documentation Verification

Confirm `docs-sync` has been completed.

Verify that:

- the Product Experience document matches the implementation
- `CLAUDE.md` remains accurate
- relevant PRDs or UX documentation are not misleading
- obsolete behavior is not still presented as current
- terminology is consistent

Do not duplicate documentation updates unnecessarily.

---

## Step 10 — Final Diff Audit

Inspect the complete diff one more time after any fixes.

Ask:

- Does every change support the intended task?
- Is anything missing?
- Is anything included that does not belong?
- Did any cleanup accidentally expand the scope?
- Is the implementation more complicated than necessary?
- Would a future developer understand why this change exists?

Prefer a focused commit over an opportunistic cleanup commit.

---

## Final Report

Before committing, provide:

### Ready to commit

State whether the work is ready to commit.

Use one of:

- **Ready to commit**
- **Ready after minor fixes**
- **Not ready to commit**

### Issues to fix before commit

List only issues that materially affect correctness, UX, accessibility, maintainability, testing, or documentation.

### Optional improvements

List non-blocking improvements separately.

### Tests

Report:

- tests run
- pass/fail counts
- any tests not run and why

### Files reviewed

Summarize the files changed by the task.

### Commit scope

Provide a one-sentence description of what this commit should represent.

If useful, suggest a concise commit message.

---

## Guiding Principles

Favor:

- correctness
- focused scope
- consistency with existing architecture
- maintainability
- clear UX
- accessible interaction
- explicit testing
- clean repository history

Avoid:

- unrelated refactors
- speculative cleanup
- premature abstraction
- silently changing product behavior
- hiding unresolved issues behind passing tests
- committing temporary or debugging artifacts

The standard is not "the code works."

The standard is:

**The intended behavior is correct, understandable, tested, documented, and clean enough to preserve in the repository history.**
