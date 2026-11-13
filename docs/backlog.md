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

## Noisy-room tip: a "Try again" button

**Problem.** When the result screen shows "Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic.", the only way to act on it is to save or keep the result and find Recalibrate later.

**Proposed.** A **Try again** action next to the tip that reruns Step 2 (the voice step), keeping the room reading, like the voice-failure retry (`retryVoice()`). Not designed or built yet.

## Extension: narrow the meeting content-script matches

**Problem.** `content-scripts/meeting-detect.js` matches `https://*.zoom.us/*`, `https://teams.microsoft.com/*` and `https://teams.live.com/*`, broader than the meeting pages need. Meet is confirmed; Zoom and Teams web meetings haven't been tested in a real call.

**Proposed.** After real Zoom and Teams calls, narrow each match to the hosts and paths their meeting pages actually use (for example Zoom's web client path). Not built yet.
