# Backlog

Ideas and small changes that aren't designed or built yet. Not canonical: `docs/product-experience.md` describes what's shipped. Move an item out of here once it's built.

## Toasts: lead with the verb

**Problem.** Toasts show for about 2 seconds, and the current strings put the verb last (`Profile “Kitchen” deleted`), so people may miss what happened.

**Proposed.** Lead with the verb: "Saved “Coffee Shop”", "Updated “Lunch Room”", "Deleted “Kitchen”".

**Current toasts** (all in `src/mezzo-session.js`, inline at each `showToast()` call):

| Shown after | Current string | Verb first? |
| --- | --- | --- |
| Save profile (new name) | Speaking profile saved | No, and no name |
| Save profile matching a name, or a recalibration's Update | Profile “{name}” updated | No |
| Delete | Profile “{name}” deleted | No |
| Keep temporarily | Available until you close the Companion | No verb; describes the result |
| Discard (temporary profile) | New profile discarded | No |

Each should be checked against the same rule. Not designed or built yet; tests in `tests/ready-screen-flows.spec.js` and the docs assert the current strings and would change with it.
