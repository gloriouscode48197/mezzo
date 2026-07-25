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
* There is no universal, fixed baseline. Useful monitoring requires calibration, because microphone gain, distance, environment, and speaking level all differ across users and devices.
* Every new monitoring session requires calibration unless the user explicitly starts with an existing saved profile as-is. Calibration is one of the two ordinary ways a session begins, not a rare first-run step.
* A **saved profile** is a persistent, reusable identity — an id, a name, and a fixed position in the library (e.g. "Kitchen," "Home Office," "Coffee Shop"). A **calibration** is just the current measurement attached to that identity. A **temporary calibration** exists only for the current session unless the user explicitly saves it.
* **Recalibrate** is the only action that overwrites a saved profile's calibration, and it updates that profile in place — same id, same name, same library position. It never creates a duplicate ("Kitchen 2"), never requires renaming, and never requires deleting the profile it replaces. **Calibrate for this session** never overwrites anything: it either stays temporary and is discarded, or the user explicitly saves it as a brand-new profile. There is no path from a one-off session calibration to silently replacing an existing profile.
* Both the Mezzo Companion and Mezzo's Speaking Profile page can initiate calibration and recalibration, through the same underlying flow, the same storage operation, and the same commit semantics. The Companion supports quick, in-the-moment adjustment right before a meeting; the Speaking Profile page supports deliberate profile management and pre-meeting preparation. Deleting profiles and enforcing the 5-profile limit remain Mezzo-only.
* The Companion handles live monitoring, Stop, its own Ready state, calibration, recalibration, and every subsequent Start Monitoring.
* Starting monitoring with an existing saved profile, used as-is, still opens the Companion directly into Monitoring with no intermediate checkpoint — this is unchanged. Starting from a fresh calibration or a recalibration is different: Calibrating is a genuine, necessary intermediate state in that case, not a reintroduction of the redundant "Ready checkpoint" this rule originally ruled out.
* Closing the Companion stops monitoring and returns Mezzo to profile selection, on the Speaking Profile page.
* There is no "Re-open Companion" flow. Starting again always opens a fresh Companion, going straight to Monitoring only when it starts from an existing saved profile used as-is — otherwise it opens into Calibrating first.
* `try-it.html`/`try-it.js` plus `src/mezzo-session.js` are the single source of truth for the monitoring session. The same page renders the Speaking Profile page and onboarding before a Companion exists, and takes on the Anchor page role once one does — one file group, not two.
* Session state, Companion state, monitoring state, and layout mode are four separate concerns and must never be conflated or inferred from one another.
* There is no Close Companion button anywhere in the Companion — the native Picture-in-Picture window-close control is the only way to close it directly.
* The Anchor page has one dedicated control: **Close Companion** — a recovery action for closing the floating window when its native ✕ isn't reachable (e.g. it's behind other windows). It has the exact same effect as the Companion's own native window-close control: stops monitoring, closes the Companion, and returns Mezzo to the Speaking Profile page. This is deliberately not a revived End Session control — it isn't framed as a second way to decide the user is done, only as a page-side path to the same close action the native control already performs. A monitoring session otherwise ends by closing the Anchor page (which closes the Companion too) or by closing the Companion natively.
* Speaking profiles are local-only: stored in the browser, no account required, never uploaded or synced to any server, as part of the profile experience. This describes profile data specifically — it is not a claim that Mezzo makes zero network requests. Anonymous, audio-free product-usage analytics exist separately (see Privacy Principles) and never carry profile content, audio, or volume data.
* Privacy is primarily demonstrated through architecture. Surface it in user-facing copy where it materially affects trust, but do not repeat privacy messaging indiscriminately across every screen.
* Compact mode is an intentional peripheral-awareness mode, not a responsive fallback for small windows.
* The Companion has three fixed pixel sizes, not a single default: Ready 320×354, Monitoring Expanded 290×420, Compact 220×220. Calibrating reuses the Ready size (320×354) rather than defining a fourth. Ready and Monitoring Expanded are visually related (both "the Expanded family") but are not the same size — do not merge them back into one constant.
* The Anchor page's embedded Companion preview is static illustrative imagery, not live session UI — see "Anchor Page" below.

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
* Calibrate for this session
* Recalibrate
* Start Monitoring
* Save as New Profile
* Stop
* Close Companion

The recalibrate-mode commit actions are not fixed strings — they interpolate the target profile's name, following the same pattern as the existing delete-confirmation copy ("Delete 'Coffee Shop'?"): **Update {profile name}** and **Update {profile name} & Start Monitoring**. Never label the recalibrate-mode primary action "Start Monitoring" alone — it also writes to the saved profile, and the label must say so.

Terminology rules:

* **Mezzo** is the whole product — never use it to mean only the floating window.
* **Mezzo Companion** is the user-facing name for the floating always-on-top window. Use it on first mention in user-facing explanatory copy; **Companion** is acceptable afterward. Internal documentation may generally say **Companion** once the term is established.
* **Anchor page** is internal-only terminology for the browser page that keeps the Companion running — never surface it in UI copy (see Internal-only terms below).
* **Speaking Profile page** is the user-facing name for the profile-selection, calibration, and recalibration experience. It's the same `try-it.html`/`try-it.js` page as the Anchor page, before a Companion exists.
* **Monitoring session** (or just **Session**) refers only to a period when monitoring is active — not the Anchor page, the browser tab lifecycle, the Companion window's lifecycle, or the overall time Mezzo stays open during the day.

Two rules that directly affect what gets built:

* There is no "Open Companion" or "Re-open Companion" action — don't build one. Start Monitoring, from Mezzo, opens the Companion and begins the first session; Start Monitoring, from the Companion's own Ready screen, begins every session after that.
* **Calibrate for this session** and **Recalibrate** are each a single, unified control — used identically in the Companion and on the Speaking Profile page, not renamed per surface. This deliberately replaces the old split between "Create New Speaking Profile" (Mezzo) and "Create New Profile…" (Companion): now that both surfaces drive the same calibration flow, giving it two different names would work against "do all entry points converge on the same mental model?"

Never introduce alternate names for the Companion in code or UI: no Companion Window, Floating Companion, Control Room, Control Page, "Bring Companion to Front," or "Pop Out."

Internal-only terms — never surface to users: Marketing Site, Onboarding, Anchor page, Document Picture-in-Picture.

Avoid outdated terms that no longer describe the implementation: "Session Window" (retired — see the Non-Negotiable Decisions entry above), "Open Companion" (never existed as a real action), "Everyday Conversation" (retired — see Profiles below; every session now starts from an actual calibration), "Create New Speaking Profile" and "Create New Profile…" (retired — both replaced by the unified "Calibrate for this session," see above), and coaching-oriented language generally (see Product Decision Principles). These may appear when describing history, but not as current-state terminology.

Full terminology usage in context lives in `docs/product-experience.md`.

---

# Product Architecture

Two named experiences, from the user's perspective. Full description: `docs/product-experience.md`'s "Product Mental Model."

## Mezzo

Implemented as `try-it.html`/`try-it.js` — also handles onboarding, since there is only one user-facing Mezzo experience, not a separate window per step — plus `src/mezzo-session.js`, which owns session logic and is reused by that page.

Owns: microphone access, monitoring engine, audio processing, active profile, calibration state, session lifecycle, and the Document Picture-in-Picture integration. The Speaking Profile page is also where calibration and recalibration can be initiated deliberately, away from the time pressure of an about-to-start meeting.

Once the Companion is open, this same page also takes on the narrower Anchor page role described in `docs/product-experience.md`'s "Anchor Page Experience" — a related but distinct internal term for what the page does at that point, not a separate file or a rename of anything.

## Mezzo Companion

Implemented via the Document Picture-in-Picture API, built by `src/mezzo-session.js`.

Owns: live visualization, monitoring awareness, peripheral feedback, calibration, recalibration, Start Monitoring for subsequent same-day sessions (from its own Ready screen), Stop, its own window state, and its own layout mode. Never contains an End Session action — that stays Mezzo's responsibility. Never contains a Close Companion action — the native window-close control is the only way to close it.

**States** — Ready, Calibrating, and Monitoring — must never be built as one screen with elements toggled; each is a distinct experience with a distinct purpose. Full behavior: `docs/product-experience.md`'s "Companion States."

**Fixed sizes**, one per state — see the Non-Negotiable Decisions entry above for exact pixels. Ready is always this size; Monitoring is meaningfully different only in its Expanded/Compact **layout mode**. Full behavior: `docs/product-experience.md`'s "Compact Companion."

## Profiles

* A saved profile is a persistent, reusable identity for an environment or situation (e.g. "Kitchen," "Home Office") — not a single-use calibration. Its calibration can be refreshed via Recalibrate without changing its id, name, or library position.
* Both Mezzo and the Companion can run calibration, run recalibration, and save a temporary calibration as a new profile, all through the same shared flow and storage operation. Deleting profiles and enforcing the 5-profile limit remain Mezzo-only, deliberate management actions.
* A temporary, session-only calibration lives only in session state until explicitly saved as a new profile. If never saved, it is discarded when the session ends — it is never silently promoted to a saved profile, and it never overwrites one.

### Canonical Runtime Profile Shapes

Exactly two shapes exist now, and only two:

```js
// Saved profile — used AS-IS for a saved-profile monitoring session, never
// wrapped. This is the literal object src/profiles.js's getSavedProfiles()/
// addSavedProfile()/updateSavedProfile() already produce.
{ id, name, speakingDb, spreadDb, calibratedTs }

// Temporary calibration — the ONLY shape `temporary: true` ever appears on.
{ name: "Current speaking range", speakingDb, spreadDb, calibratedTs, savedProfileId: null, temporary: true }
```

Saved-versus-temporary is decided by `isTemporaryProfile()` (`profile?.temporary === true`) alone, checked first, always — never inferred from the presence or absence of `id`, from name, or from `calibratedTs` recency.

The older `savedProfileId`-wrapper shape (`{name, speakingDb, savedProfileId}`, no `id`) that try-it.js used to construct for a saved-profile selection is retired — every production caller (`chooseSavedProfile()`, the Calibrated screen's commit handlers, the Companion's Ready-screen row selection) now passes the real saved-profile object straight through. `savedProfileId` only ever appears as part of the temporary shape above; `src/mezzo-session.js`'s `profileMetaText()` treats `id` alone as the "Custom" signal.

---

# Single Source of Truth

`try-it.html`/`try-it.js` plus `src/mezzo-session.js` own the monitoring session: microphone access, monitoring engine, active profile, calibration, monitoring lifecycle, session recovery, cleanup.

The Companion presents monitoring information. It never independently owns monitoring state.

Four concerns are related but distinct and must never be conflated or inferred from one another:

* **Session state** — whether a monitoring session exists at all, including whether one is currently being prepared via calibration (and if so, in which mode — a fresh session-only calibration, or a recalibration of a specific saved profile). Owned by `try-it.js`/`src/mezzo-session.js`.
* **Companion state** — whether the Companion window is open or closed.
* **Monitoring state** — whether monitoring is active or inactive.
* **Layout mode** — Expanded or Compact, meaningful only while the Companion is open.

Layout mode must never be inferred from window dimensions. Monitoring state must never be inferred from whether the Companion window merely exists.

The Anchor page's embedded Companion preview (see `docs/product-experience.md`'s "Anchor Page Experience") is a fixed illustration, not a fifth piece of state — it never reads session state, zone, or profile, and must not be wired up to do so.

Calibration and recalibration are reachable from both Mezzo and the Companion, but the logic behind them lives in one place: a shared calibration controller (capture lifecycle, sample collection, validation, result creation, cancellation, and commit commands), not a shared UI module. Each surface renders its own screens from that controller's state — the controller has no knowledge of DOM, PiP, or which surface is driving it. This keeps Companion DOM behavior and Mezzo page DOM behavior uncoupled from each other while still giving both surfaces the identical flow, storage operation, and commit semantics required by the Profiles section above.

Two related operations must stay genuinely shared, not just similarly implemented: `src/calibration-controller.js`'s `commitSaveAsNewProfile()` (pre-monitoring "Save as New Profile") and the Stop-time "save this for next time?" prompt (for a temporary profile the user started monitoring without saving) both route through the same `promoteTemporaryProfile()` operation in `src/profiles.js`, not two independent implementations. The Stop-time prompt does not need the calibration controller to still be alive — the controller's own attempt is long since committed and reset to idle by the time monitoring stops — so this promotion logic lives in `profiles.js`, callable on its own.

## Calibration Controller Instance Rule

Exactly one calibration-controller instance should hold the microphone per browser tab at a time — enforced by convention in how the controller is wired up, not by the controller itself, which has no cross-instance awareness.

This is sufficient for the Companion and the Speaking Profile page specifically: a Document Picture-in-Picture window shares its opener's JS realm (see `src/mezzo-session.js`'s existing `pipWindow`/`pipDocument` handling — direct synchronous references, no `postMessage` anywhere, because none is needed), so there is no genuine second window for a second instance to exist in. A single shared instance (or an equivalent one-active-flag rule) for that pair requires no new cross-window primitive.

**Ownership, not window state, decides which surface renders a given controller state change.** Both `src/mezzo-session.js` (the Companion) and `try-it.js` (the Speaking Profile page) register their own `calibrationController.subscribe()` listener on this exact same shared instance, for the whole tab's lifetime — neither ever unsubscribes. `src/calibration-controller.js` exports `CALIBRATION_OWNERS` (`MAIN_PAGE` / `COMPANION`); whichever surface calls `startSessionCalibration(owner)`/`startRecalibration(id, owner)` passes its own constant, and each listener checks `calibrationController.getOwner()` before acting, ignoring state changes that belong to the other surface. `retry()` doesn't need the owner passed again — it survives a failed→retry cycle on its own, cleared only by `reset()` (every commit, cancel, and close). This is deliberately explicit rather than inferred from `pipWindow`/session state: today it happens to be true that try-it.js can only start a run while the Companion is closed, and mezzo-session.js's own rendering is a no-op whenever `pipWindow` is null, but relying on that correlation would make the listener silently fragile to a future change on either side. Ownership is a routing signal only — it never gates or duplicates the controller's own measurement state.

**Cross-tab coordination is now built** (`src/calibration-lock.js`) — see "Cross-Tab Calibration Lock," below.

---

## Cross-Tab Calibration Lock

Two separate browser TABS each running their own Mezzo session is a different boundary than the Companion/Speaking-Profile-page pair above — nothing about sharing one JS realm helps here, since two tabs are two entirely separate realms. `src/calibration-lock.js`'s `createCalibrationLock()` closes this gap: a `localStorage`-based lease (`mezzoCalibrationLock`, holding only `{tabId, acquiredAt}` — never audio data or calibration samples), one instance per tab, created inside `createMezzoSession()` alongside `calibrationController` and shared the same way (exposed as `session.calibrationLock`, not a second instance).

localStorage over `BroadcastChannel`: the actual requirement is a synchronous check at the moment a user clicks Calibrate/Recalibrate ("is anyone else already doing this"), not a live, reactive push feed — localStorage already gives that synchronously, with no channel lifecycle to manage.

- **Checked, not enforced by the controller**: `beginCalibrationFlow()` on both surfaces calls `calibrationLock.acquire()` *before* touching `calibrationController` or the microphone at all. A rejection shows the existing Calibration Failed screen with `CROSS_TAB_LOCKED` → "Calibration is already open in another Mezzo tab." — no new screen, no mic interaction, nothing to release.
- **Released centrally, not scattered**: `createMezzoSession()` registers one extra `calibrationController.subscribe()` listener (ungated by ownership) that calls `calibrationLock.release()` whenever status reaches `idle` (every commit, cancel, and close route through `reset()`, which lands there) or `failed` (the mic is already free by then). A tab closing outright already calls `calibrationController.cancel()` from its `pagehide` handler, which drives the same `idle` transition — so pagehide needs no separate release call.
- **Held through the whole decision window, not just the mic-holding window**: the lease stays held from `acquire()` through the Calibrated checkpoint (deciding whether to save/start monitoring) — not just while `runCapture()` holds the mic — since the real risk it guards against is broader than the mic alone (two tabs racing `src/profiles.js`'s read-modify-write storage calls).
- **Fails open, always**: no usable `localStorage` (locked-down privacy modes, or a non-browser test environment) degrades to an always-allow no-op rather than throwing — never a new point of failure worse than not having this module at all.
- **Stale-owner recovery**: an unrefreshed lock older than `STALE_AFTER_MS` (15s) is treated as abandoned and can be reclaimed; a live tab heartbeats its own lock every 5s so a legitimately long pause on the Calibrated screen never expires out from under it.
- **Never blocks ordinary saved-profile monitoring**: the lock is only ever checked in `beginCalibrationFlow()` — selecting a saved profile and starting monitoring (`chooseSavedProfile()`, the Companion's own Ready-screen Start Monitoring) never touches it, in any tab.

---

# Product Decision Principles

**Awareness before instruction.** Mezzo describes what's happening — it doesn't judge, correct, or score.

Use: Quiet, Within Range, Approaching End of Range, Outside Range. Never: Too Loud, Warning, Alert, Incorrect, Fix Your Volume, or "Approaching Range" (superseded by "Approaching End of Range"). Full state descriptions: `docs/product-experience.md`'s "Monitoring States."

**Preserve calm.** Never introduce flashing, blinking, urgency without reason, aggressive notification patterns, punitive language, or gamification. Attention increases gradually and continuously, never through abrupt interruption.

**Keep the product peripheral.** The Companion is ambient, not a control panel — don't add controls or exposed settings without strong justification. Prefer progressive disclosure over surfacing every option at once.

---

# Engineering Rules

* Inspect the existing codebase before making large changes.
* Reuse and extend existing systems before rewriting stable ones; prefer a reusable component over a one-off implementation.
* Preserve established behavior unless intentionally changing the experience.
* Keep product logic, the monitoring engine, UI, visualization, and browser integration separated — business logic independent of rendering; the visualization communicates state, it does not compute it.
* Avoid duplicated business logic and duplicated state — one source of truth per concern, referenced rather than copied.
* Favor explicitness over cleverness. Document architectural decisions.
* If implementation appears to conflict with product intent: stop, and clarify the intended experience before changing architecture.

---

# Engineering Notes

Implementation findings and known limitations that don't belong in the product-behavior docs. Keep this section short — promote anything load-bearing into its proper section above once it's settled, rather than letting this become a second home for architecture rules.

* **Mezzo Companion title bar (Document Picture-in-Picture).** `src/mezzo-session.js` sets `pipDocument.title = 'Mezzo Companion'` right after the PiP window opens. Confirmed by source + live testing: this is a genuinely separate `document.title`, isolated from the main tab's own title. NOT confirmed: what the real, native OS titlebar chrome actually renders — the Document Picture-in-Picture spec says the user agent "may display the origin of the website in a titlebar," as a security requirement (the floating window has no address bar), which several implementation write-ups corroborate as Chrome's actual behavior. This assignment may therefore have little to no effect on the visible titlebar text specifically, even though it demonstrably works as a DOM property (and still has independent value for accessibility trees, OS task-switcher entries, and browser history). Left as a normalized-casing, not-otherwise-changed line pending an actual sighted check on a real desktop Chrome window, which nothing in this environment can perform.
* **Companion close-handler variable mismatch (found and fixed during Step 5 integration, recorded here for durability).** `handlePipClose()` (the native-✕ / close-triggered teardown in `src/mezzo-session.js`) reset a set of DOM-ref variable names left over from an earlier Ready-screen implementation, after that screen's actual refs had been renamed in the same rewrite — under ES module strict mode, assigning to an undeclared variable throws `ReferenceError`, so every native Companion close would have thrown instead of cleaning up. Caught before shipping by cross-referencing every `= null;` reset in that function against the file's actual `let`/`const` declarations; fixed by resetting the current variable set. No test guards this specific class of mismatch today (it's a static reference-name error a type checker would catch, not a runtime-behavior test) — worth remembering as a reason to re-check `handlePipClose()`'s reset list specifically whenever Companion DOM refs are renamed.
* **`transitionToState()`'s rapid-call race (found and fixed in Step 7).** try-it.js's opacity-fade screen switcher used to derive "the current screen" by scanning for whichever element lacked the `hidden` class — correct only when calls are spaced further apart than the fade itself. Starting a session calibration whose microphone permission is already blocked can resolve within microtasks of the click that started it (real Chrome does this too, not just this project's Node/linkedom test environment), which used to arrive well before the *first* transition's own fade-out timeout had run — so a second, near-immediate `transitionToState()` call still saw the outgoing screen as "current," started an independent second fade-out of the same element, and both fades' completion callbacks ended up unhiding two different destination screens at once. Fixed by tracking the actually-visible element and the most-recently-requested target as explicit state, with a pending fade redirected to a new target rather than duplicated. Found via the new linkedom DOM test suite (`src/try-it.dom.test.js`), not by inspection — this exact race would not have surfaced from calibration-controller.js's own tests (mocked audio, no real DOM) or from Playwright's fake-media-device runs (acquire always "succeeds" there, so the failure path this race depends on never fires).
* **Validation status.** The calibration/profile model rebuilt across Steps 5–7 (shared controller, canonical profile shapes, cross-tab lock, ownership routing) is implementation-correct per its automated suite (236 `node --test` cases) and repeated real-browser smoke runs (Chromium, fake microphone). It has not been used or validated by a real person, on real hardware, across the range of microphones/rooms/accents the product actually needs to work for. Automated and smoke tests establish that the code does what it's designed to do — not that the calibration experience itself feels right. See the Step 7 report's recommended validation plan before treating this as done in that second sense.

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
* **`docs/ux/speaking-profile-flow.md`** — detailed UX reference for the Speaking Profile page's screens and copy.
* **`docs/design-principles.md`** — reusable visual, interaction, motion, and copy principles that extend beyond a single feature. *(proposed — not yet created)*
* **`docs/natural-systems.md`** — the philosophy behind breathing, propagation, contour behavior, organic motion, peripheral awareness. *(proposed — not yet created)*
* **PRDs** — individual feature requirements: problem, goals, scope, constraints, acceptance criteria, open questions. Never redefine the product.
* **`docs/discoveries/`** — browser limitations, implementation discoveries, research, experiments, unresolved questions, and tracked technical debt. Historical record, not canonical. *(proposed — not yet created)*
* **Implementation notes** — temporary constraints, migration plans, technical debt. Never authoritative for product decisions.
