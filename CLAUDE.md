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

* **Mezzo is now Picture-in-Picture–first.** The Mezzo Companion is the sole operational surface. Users still understand only two product concepts — **Mezzo** and **Mezzo Companion** — but Mezzo (the browser page) is no longer where anything happens; it introduces the product and launches the Companion, nothing else. This supersedes every "both surfaces" framing that predates it — see Product Architecture below for what changed concretely.
* There is no universal, fixed baseline. Useful monitoring requires calibration, because microphone gain, distance, environment, and speaking level all differ across users and devices.
* Every new monitoring session requires calibration unless the user explicitly starts with an existing saved profile as-is. Calibration is one of the two ordinary ways a session begins, not a rare first-run step.
* A **saved profile** is a persistent, reusable identity — an id, a name, and a fixed position in the library (e.g. "Kitchen," "Home Office," "Coffee Shop"). A **calibration** is just the current measurement attached to that identity. A **temporary calibration** exists only for the current session unless the user explicitly saves it.
* **Recalibrate**, from the Companion's Ready screen, is the primary, deliberate way to update a saved profile's calibration in place — same id, same name, same library position. It never creates a duplicate ("Kitchen 2"), never requires renaming, and never requires deleting the profile it replaces. **Calibrate for this session** starts out temporary and stays that way unless the user explicitly saves it at the post-session save prompt: a unique name creates a brand-new profile; a name that matches an existing saved profile's name (trimmed, case-insensitive — stored display casing is never changed) instead explicitly updates that profile's calibration in place, behaviorally identical to Recalibrate — an equivalent path reached by typing a matching name, not a second, looser way to overwrite something by accident. This is never silent: the save prompt's helper text and primary button both change to say so ("This calibration will update your existing '{name}' profile" / "Update {name}") before the user commits to it. There is still no path from a one-off session calibration to *silently* replacing an existing profile — only to explicitly, visibly doing so, by name.
* **Only the Mezzo Companion initiates calibration and recalibration, selects profiles, deletes profiles, and enforces the 5-profile limit.** Mezzo (the browser page) has no calibration UI, no profile UI, and does not request microphone permission. Its one job is introducing the product and launching the Companion. This retires the earlier "both surfaces can calibrate" model — there is exactly one operational surface now, not two kept in sync.
* The Companion handles live monitoring, Stop, its own Welcome/Ready states, calibration, recalibration, profile deletion, the 5-profile limit, and every Start Monitoring — first session and every one after.
* **Every Companion open goes through Welcome or Ready — never straight to Monitoring.** With zero saved profiles: Welcome (a distinct first-time screen, not an instant auto-calibrate redirect). With one or more: Ready, exactly like every subsequent open already worked. There is no more special-cased "first session skips the checkpoint because Mezzo already chose a profile" path — Mezzo never chooses a profile now, so the Companion always needs its own checkpoint.
* Closing the Companion stops monitoring and returns Mezzo to Home (the introductory page). There is no profile-selection screen to return to anymore.
* There is no "Re-open Companion" flow, and there is exactly one action that opens the Companion: **Open Mezzo Companion**, from Home. It does not itself choose a profile or start monitoring — the Companion decides Welcome vs. Ready and takes it from there.
* `index.html`/`landing.js` (via the shared `src/home-dock.js` controller) plus `src/mezzo-session.js` are the single source of truth for the monitoring session. The same page — the public homepage — is Home before a Companion exists, and takes on the Dock role once one does — one file group, not two. `try-it.html` is retired to a static redirect to `index.html`, kept only for old bookmarks, cached service-worker entries, and the browser extension's existing entry URL; it has no script or logic of its own. See Product Architecture.
* Session state, Companion state, monitoring state, and layout mode are four separate concerns and must never be conflated or inferred from one another.
* There is no Close Companion button anywhere in the Companion — the native Picture-in-Picture window-close control is the only way to close it directly.
* The Dock has one dedicated control: **Close Companion** — a recovery action for closing the floating window when its native ✕ isn't reachable (e.g. it's behind other windows). It has the exact same effect as the Companion's own native window-close control: stops monitoring, closes the Companion, and returns Mezzo to Home. This is the one deliberate exception to "the Dock has no operational controls" — it is a lifecycle/recovery action, not a duplicate of anything the Companion itself does, and it isn't framed as a second way to decide the user is done. The Dock must never expose calibration, profile, monitoring, Stop, or Save controls. A monitoring session otherwise ends by closing the Dock (which closes the Companion too) or by closing the Companion natively.
* **Document Picture-in-Picture support is required to use Mezzo.** Browsers without it show a clear unsupported-browser message, not a parallel in-page calibration/monitoring implementation. This retires the old no-Companion-support fallback (full in-page calibration + monitoring) — maintaining two operational implementations directly contradicts having one operational surface.
* Speaking profiles are local-only: stored in the browser, no account required, never uploaded or synced to any server, as part of the profile experience. This describes profile data specifically — it is not a claim that Mezzo makes zero network requests. Anonymous, audio-free product-usage analytics exist separately (see Privacy Principles) and never carry profile content, audio, or volume data.
* Privacy is primarily demonstrated through architecture. Surface it in user-facing copy where it materially affects trust, but do not repeat privacy messaging indiscriminately across every screen.
* Compact mode is an intentional peripheral-awareness mode, not a responsive fallback for small windows.
* The Companion has three fixed pixel sizes, not a single default: Ready 320×354, Monitoring Expanded 290×420, Compact 220×220. Calibrating and **Welcome** both reuse the Ready size (320×354) rather than defining new ones. Ready and Monitoring Expanded are visually related (both "the Expanded family") but are not the same size — do not merge them back into one constant.
* The Dock's embedded Companion preview is static illustrative imagery, not live session UI — see "Dock" below.

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
* Open Mezzo Companion
* Calibrate for this session
* Recalibrate
* Start Monitoring
* Save as New Profile
* Save Profile
* Stop
* Close Companion

The recalibrate-mode commit actions are not fixed strings — they interpolate the target profile's name, following the same pattern as the existing delete-confirmation copy ("Delete 'Coffee Shop'?"): **Update {profile name}** and **Update {profile name} & Start Monitoring**. Never label the recalibrate-mode primary action "Start Monitoring" alone — it also writes to the saved profile, and the label must say so.

**Save Profile** is the Stop-time save prompt's naming-step primary action for a name that doesn't match any existing saved profile — distinct from **Save as New Profile** (the pre-monitoring Calibrated checkpoint's action, which always creates and is never dynamic). When the typed name matches an existing profile instead, the save prompt's primary action becomes the same interpolated **Update {profile name}** pattern the recalibrate-mode commit actions use above — reflecting that it does the same thing (updates that profile's calibration in place), reached a different way.

Terminology rules:

* **Mezzo** is the whole product — never use it to mean only the floating window. It is also, specifically, the name of the introductory page users land on before the Companion opens — that page has no separate public name of its own (see **Home** below).
* **Mezzo Companion** is the user-facing name for the floating always-on-top window. Use it on first mention in user-facing explanatory copy; **Companion** is acceptable afterward. Internal documentation may generally say **Companion** once the term is established.
* **Home** is internal-only shorthand for what Mezzo (the browser page) shows before a Companion exists: an introduction to the product and a single **Open Mezzo Companion** action. Not a user-facing name — users still only ever hear "Mezzo" and "Mezzo Companion" (see the Non-Negotiable Decisions entry above). Home has no calibration UI, no profile UI, and never requests microphone permission.
* **Dock** is internal-only terminology (retired name: **Anchor page**) for what the same browser page becomes once the Companion is open: a minimal status surface with exactly one control, Close Companion — never surfaced in UI copy (see Internal-only terms below).
* **Speaking Profile page** is retired terminology — profile selection, calibration, and recalibration are Companion-only now; there is no separate page-level implementation of any of it. See `docs/ux/speaking-profile-flow.md`'s own retirement note.
* **Monitoring session** (or just **Session**) refers only to a period when monitoring is active — not the Dock, the browser tab lifecycle, the Companion window's lifecycle, or the overall time Mezzo stays open during the day.

Two rules that directly affect what gets built:

* **Open Mezzo Companion**, from Home, is the only action that opens the Companion — and the only thing it does. It never chooses a profile and never starts monitoring by itself. The Companion, once open, decides Welcome (zero saved profiles) vs. Ready (one or more), and **Start Monitoring** — reachable only from the Companion's own Ready screen — is what actually begins a session, first one and every one after alike. There is no "Open Companion"/"Re-open Companion" action distinct from this, and no page-side Start Monitoring anymore.
* **Calibrate for this session** and **Recalibrate** are Companion-only controls now — there is no second, page-level implementation to keep in sync with. This retains the earlier unification (both replaced the old split "Create New Speaking Profile" (Mezzo) / "Create New Profile…" (Companion)) while retiring the "both surfaces" framing that unification was originally built for.

Never introduce alternate names for the Companion in code or UI: no Companion Window, Floating Companion, Control Room, Control Page, "Bring Companion to Front," or "Pop Out."

Internal-only terms — never surface to users: Marketing Site, Onboarding, Home, Dock, Document Picture-in-Picture. **Marketing Site**, **Onboarding**, and **Home** now all describe the same single page (`index.html`) at different moments — introducing the product and, via its one CTA, handing off directly to the Companion — not three separate implementations to keep in sync; use whichever of the three reads most naturally in context.

Avoid outdated terms that no longer describe the implementation: "Session Window" (retired), "Open Companion" (never existed as a real action), "Everyday Conversation" (retired — see Profiles below; every session now starts from an actual calibration), "Create New Speaking Profile" and "Create New Profile…" (retired — both replaced by the unified "Calibrate for this session," see above), "Anchor page" (retired — see **Dock** above), "Speaking Profile page" (retired — profile selection/calibration/recalibration are Companion-only now), "Try Mezzo" (retired — was both a global-nav item and the homepage's own hero CTA; the nav item was removed outright, and the CTA now reads **Open Mezzo Companion** and opens the Companion directly rather than navigating to a second page — see Product Architecture), and coaching-oriented language generally (see Product Decision Principles). These may appear when describing history, but not as current-state terminology.

`Open Mezzo` (distinct from `Open Mezzo Companion`) remains a separate, pre-existing term describing a *returning-user journey step* (e.g. the browser extension's meeting-detection prompt) rather than a button — it is not retired by this change, but its exact behavior under the PiP-first model (does it land on Home, or open the Companion directly?) has not been revisited here and is out of scope for this pass.

Full terminology usage in context lives in `docs/product-experience.md`.

---

# Product Architecture

Two named experiences, from the user's perspective. Full description: `docs/product-experience.md`'s "Product Mental Model."

## Mezzo

Implemented as `index.html`/`landing.js` — the public homepage doubles as Home and the Dock, the same two-state model a separate `try-it.html` page used to own on its own. `landing.js` owns only what's specific to this page's own marketing presentation (scroll-triggered reveals, the initial page fade-in); the actual Home ↔ Dock state machine — session creation, direct Companion launch, Dock status mapping — lives in the shared, reusable `src/home-dock.js`, which also owns `src/mezzo-session.js`'s session logic:

* **Home** (before a Companion exists): the homepage itself — hero, "how it works," philosophy — introduces the product and requests nothing, decides nothing beyond what to show. Its only interactive element that touches the session is **Open Mezzo Companion**, the hero's primary CTA. No mic-permission prompt, no profile UI, no calibration UI — all of that moved into the Companion. Clicking it opens the Companion directly; it never navigates anywhere first.
* **Dock** (once a Companion exists): the same page, with its marketing content hidden and a minimal status surface shown instead — see Non-Negotiable Decisions for its one control (Close Companion) and what it must never expose.

`src/mezzo-session.js` still owns microphone access, monitoring engine, audio processing, active profile, calibration state, session lifecycle, and the Document Picture-in-Picture integration — Home and the Dock never touch any of that directly; Home's only call into it (via `src/home-dock.js`) is the one that opens the Companion.

`try-it.html` is retired to a static redirect to `index.html` (see `monitoring.html` for the same pattern, itself also now redirecting straight to `index.html` rather than chaining through `try-it.html`) — kept only so old bookmarks, cached service-worker entries, and the browser extension's existing entry URL keep working. It has no script, no state, and no logic of its own; `try-it.js`/`try-it.css` no longer exist. There is exactly one Home/Dock implementation now, not a page-level one plus a homepage-level one.

## Mezzo Companion

Implemented via the Document Picture-in-Picture API, built by `src/mezzo-session.js`.

Owns: live visualization, monitoring awareness, peripheral feedback, calibration, recalibration, profile selection, profile deletion, the 5-profile limit, Start Monitoring — first session and every one after — Stop, its own window state, and its own layout mode. Never contains an End Session action — that stays Mezzo's responsibility (Home/Dock, via the page closing or Close Companion). Never contains a Close Companion action — the native window-close control is the only way to close it.

**States** — Welcome, Ready, Calibrating, and Monitoring — must never be built as one screen with elements toggled; each is a distinct experience with a distinct purpose. **Welcome** is new: a first-time-only screen (zero saved profiles), reached only once, before the first calibration ever begins — not an instant auto-redirect into Calibrating. Full behavior: `docs/product-experience.md`'s "Companion States."

**Fixed sizes**, one per state — see the Non-Negotiable Decisions entry above for exact pixels. Ready is always this size; Welcome and Calibrating reuse it too; Monitoring is meaningfully different only in its Expanded/Compact **layout mode**. Full behavior: `docs/product-experience.md`'s "Compact Companion."

## Profiles

* A saved profile is a persistent, reusable identity for an environment or situation (e.g. "Kitchen," "Home Office") — not a single-use calibration. Its calibration can be refreshed via Recalibrate without changing its id, name, or library position.
* The Companion runs calibration, runs recalibration, saves a temporary calibration as a new profile, deletes profiles, and enforces the 5-profile limit — all Companion-only now. There is no second, page-level implementation of any of this to keep in sync.
* A temporary, session-only calibration lives only in session state until explicitly saved as a new profile. If never saved, it is discarded when the session ends — it is never silently promoted to a saved profile, and it never overwrites one.
* Renaming a saved profile does not exist as a feature yet. If it's ever built, it belongs in the Companion's Ready screen alongside delete — not deferred to a page-level profile-management surface, since none exists.

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

`index.html`/`landing.js` (via `src/home-dock.js`) plus `src/mezzo-session.js` own the monitoring session: microphone access, monitoring engine, active profile, calibration, monitoring lifecycle, session recovery, cleanup.

The Companion presents monitoring information. It never independently owns monitoring state.

Four concerns are related but distinct and must never be conflated or inferred from one another:

* **Session state** — whether a monitoring session exists at all, including whether one is currently being prepared via calibration (and if so, in which mode — a fresh session-only calibration, or a recalibration of a specific saved profile). Owned by `src/home-dock.js`/`src/mezzo-session.js`.
* **Companion state** — whether the Companion window is open or closed.
* **Monitoring state** — whether monitoring is active or inactive.
* **Layout mode** — Expanded or Compact, meaningful only while the Companion is open.

Layout mode must never be inferred from window dimensions. Monitoring state must never be inferred from whether the Companion window merely exists.

The Dock's embedded Companion preview (see `docs/product-experience.md`'s "Dock Experience") is a fixed illustration, not a fifth piece of state — it never reads session state, zone, or profile, and must not be wired up to do so.

Calibration and recalibration are Companion-only now — `landing.js`/`src/home-dock.js` (Home/Dock) has no calibration UI and does not touch `calibrationController`/`calibrationLock` at all. The calibration logic itself still lives in one place, a shared calibration controller (capture lifecycle, sample collection, validation, result creation, cancellation, and commit commands) inside `src/mezzo-session.js` — "shared" now describes reuse of the same well-tested module across the Companion's own screens (Welcome/Ready initiate it, Calibrating/Calibration Failed/Calibrated render its state), not sharing across two surfaces.

Two related operations must stay genuinely shared, not just similarly implemented: `src/calibration-controller.js`'s `commitSaveAsNewProfile()` (pre-monitoring "Save as New Profile," which always creates — see "Calibration" in `docs/product-experience.md`) and the create case of the Stop-time "save this for next time?" prompt both route through the same `promoteTemporaryProfile()` operation in `src/profiles.js`, not two independent implementations. The Stop-time prompt does not need the calibration controller to still be alive — the controller's own attempt is long since committed and reset to idle by the time monitoring stops — so this promotion logic lives in `profiles.js`, callable on its own.

The Stop-time prompt's naming step can also explicitly *update* an existing profile now, when the typed name matches one — see the Non-Negotiable Decisions entry above. `src/profiles.js`'s `resolveSavePromptAction(name, { savedProfiles, maxProfiles })` is the single helper that decides which of create/update/blocked/invalid applies, given a name; `commitSavePromptName()` re-resolves it fresh and then calls `promoteTemporaryProfile()` (create) or the existing `updateSavedProfile()` (update, the exact same function Recalibrate's own commit path calls) — never a duplicate persistence path of its own. `src/mezzo-session.js`'s save-prompt UI (`renderSavePromptNameState()`) only renders whichever outcome that resolver returns — on every keystroke, and again at submit time — it never matches names or checks the profile limit itself.

## Calibration Controller Instance Rule

Exactly one calibration-controller instance should hold the microphone per browser tab at a time — enforced by convention in how the controller is wired up, not by the controller itself, which has no cross-instance awareness. With Home/Dock (`src/home-dock.js`) never touching the controller at all, this instance now effectively belongs to the Companion alone within a tab — the rule is simpler to satisfy than it used to be, not harder.

**Ownership tracking (the old `CALIBRATION_OWNERS.MAIN_PAGE`/`.COMPANION` mechanism) predated this model and has been removed** from `src/calibration-controller.js` — `startSessionCalibration()`/`startRecalibration()` take no owner argument, there is no `getOwner()`, and `src/mezzo-session.js` is the controller's one, ungated `subscribe()` listener. Do not reintroduce an ownership/routing signal here; a single surface driving the controller has no second listener to disambiguate against.

**Cross-tab coordination is still fully relevant** (`src/calibration-lock.js`) — two separate browser TABS, each with its own Companion, is unaffected by any of the above. See "Cross-Tab Calibration Lock," below.

---

## Cross-Tab Calibration Lock

Two separate browser TABS each running their own Mezzo session — each with its own Companion — is a different boundary than the single-tab Instance Rule above; nothing about sharing one JS realm helps here, since two tabs are two entirely separate realms. `src/calibration-lock.js`'s `createCalibrationLock()` closes this gap: a `localStorage`-based lease (`mezzoCalibrationLock`, holding only `{tabId, acquiredAt}` — never audio data or calibration samples), one instance per tab, created inside `createMezzoSession()` alongside `calibrationController` — both now purely internal to `src/mezzo-session.js`, not exposed on the session's public API, since Home/Dock (`src/home-dock.js`) has no calibration UI left to share them with.

localStorage over `BroadcastChannel`: the actual requirement is a synchronous check at the moment a user clicks Calibrate/Recalibrate ("is anyone else already doing this"), not a live, reactive push feed — localStorage already gives that synchronously, with no channel lifecycle to manage.

- **Checked, not enforced by the controller**: `beginCalibrationFlow()` (Companion-only now) calls `calibrationLock.acquire()` *before* touching `calibrationController` or the microphone at all. A rejection shows the existing Calibration Failed screen with `CROSS_TAB_LOCKED` → "Calibration is already open in another Mezzo tab." — no new screen, no mic interaction, nothing to release.
- **Released centrally, not scattered**: `createMezzoSession()` registers one extra `calibrationController.subscribe()` listener that calls `calibrationLock.release()` whenever status reaches `idle` (every commit, cancel, and close route through `reset()`, which lands there) or `failed` (the mic is already free by then). A tab closing outright already calls `calibrationController.cancel()` from its `pagehide` handler, which drives the same `idle` transition — so pagehide needs no separate release call.
- **Held through the whole decision window, not just the mic-holding window**: the lease stays held from `acquire()` through the Calibrated checkpoint (deciding whether to save/start monitoring) — not just while `runCapture()` holds the mic — since the real risk it guards against is broader than the mic alone (two tabs racing `src/profiles.js`'s read-modify-write storage calls).
- **Fails open, always**: no usable `localStorage` (locked-down privacy modes, or a non-browser test environment) degrades to an always-allow no-op rather than throwing — never a new point of failure worse than not having this module at all.
- **Stale-owner recovery**: an unrefreshed lock older than `STALE_AFTER_MS` (15s) is treated as abandoned and can be reclaimed; a live tab heartbeats its own lock every 5s so a legitimately long pause on the Calibrated screen never expires out from under it.
- **Never blocks ordinary saved-profile monitoring**: the lock is only ever checked in `beginCalibrationFlow()` — selecting a saved profile and starting monitoring (the Companion's own Ready-screen Start Monitoring) never touches it, in any tab.

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

**Running tests.** `npm test` runs the fast Node unit test suite (`node --test src/*.test.js`) — pure-logic tests, no browser. `npm run test:pip` runs the Chromium Document Picture-in-Picture regression tests (Playwright, `tests/`) — these use fake media (`--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream`) and cover the real Companion screens the unit suite can't reach. Run `npm run test:pip` after any change to Companion screen flow (transitions between Welcome/Ready/Calibrating/Calibrated/Monitoring), not just `npm test`.

---

# Engineering Notes

Implementation findings and known limitations that don't belong in the product-behavior docs. Keep this section short — promote anything load-bearing into its proper section above once it's settled, rather than letting this become a second home for architecture rules.

* **PiP-first model change (2026-07-25), implemented.** Mezzo moved from "two surfaces sharing one calibration flow" (Steps 5–7) to "the Companion is the only operational surface" — see the Non-Negotiable Decisions entries above. This retired all of Steps 5–7's page-side work (`try-it.js`'s profile-select/Calibrating/Calibration-Failed/Calibrated screens, its own `calibrationController`/`calibrationLock` usage, the no-PiP-support fallback, `?demo=true`) in favor of a two-state Home/Dock page — the calibration-controller/cross-tab-lock architecture itself was unaffected and carried over as-is, minus the now-removed `CALIBRATION_OWNERS` ownership routing (no longer needed with a single calling surface). `src/try-it.dom.test.js` was rewritten from scratch for the new two-state model (Home, unsupported-browser, Dock) rather than patched; the Companion's own internal screens (Welcome/Ready/Calibrating/Calibrated, profile delete, the five-profile limit) need a real Document Picture-in-Picture window and are covered by Playwright smoke tests instead, same division of labor Steps 5–7 already established.
* **Mezzo Companion title bar (Document Picture-in-Picture).** `src/mezzo-session.js` sets `pipDocument.title = 'Mezzo Companion'` right after the PiP window opens. Confirmed by source + live testing: this is a genuinely separate `document.title`, isolated from the main tab's own title. NOT confirmed: what the real, native OS titlebar chrome actually renders — the Document Picture-in-Picture spec says the user agent "may display the origin of the website in a titlebar," as a security requirement (the floating window has no address bar), which several implementation write-ups corroborate as Chrome's actual behavior. This assignment may therefore have little to no effect on the visible titlebar text specifically, even though it demonstrably works as a DOM property (and still has independent value for accessibility trees, OS task-switcher entries, and browser history). Left as a normalized-casing, not-otherwise-changed line pending an actual sighted check on a real desktop Chrome window, which nothing in this environment can perform.
* **Companion close-handler variable mismatch (found and fixed during Step 5 integration, recorded here for durability).** `handlePipClose()` (the native-✕ / close-triggered teardown in `src/mezzo-session.js`) reset a set of DOM-ref variable names left over from an earlier Ready-screen implementation, after that screen's actual refs had been renamed in the same rewrite — under ES module strict mode, assigning to an undeclared variable throws `ReferenceError`, so every native Companion close would have thrown instead of cleaning up. Caught before shipping by cross-referencing every `= null;` reset in that function against the file's actual `let`/`const` declarations; fixed by resetting the current variable set. No test guards this specific class of mismatch today (it's a static reference-name error a type checker would catch, not a runtime-behavior test) — worth remembering as a reason to re-check `handlePipClose()`'s reset list specifically whenever Companion DOM refs are renamed.
* **`transitionToState()`'s rapid-call race (found and fixed in Step 7; the function now lives in `src/home-dock.js`, moved there from try-it.js during the index.html consolidation below).** The opacity-fade screen switcher used to derive "the current screen" by scanning for whichever element lacked the `hidden` class — correct only when calls are spaced further apart than the fade itself. Starting a session calibration whose microphone permission is already blocked can resolve within microtasks of the click that started it (real Chrome does this too, not just this project's Node/linkedom test environment), which used to arrive well before the *first* transition's own fade-out timeout had run — so a second, near-immediate `transitionToState()` call still saw the outgoing screen as "current," started an independent second fade-out of the same element, and both fades' completion callbacks ended up unhiding two different destination screens at once. Fixed by tracking the actually-visible element and the most-recently-requested target as explicit state, with a pending fade redirected to a new target rather than duplicated. Found via the linkedom DOM test suite (originally `src/try-it.dom.test.js`, now `src/index.dom.test.js`), not by inspection — this exact race would not have surfaced from calibration-controller.js's own tests (mocked audio, no real DOM) or from Playwright's fake-media-device runs (acquire always "succeeds" there, so the failure path this race depends on never fires).
* **index.html consolidation (2026-07-27), implemented.** The homepage (`index.html`/`landing.js`) and the old separate Home/Dock page (`try-it.html`/`try-it.js`) were two independent launcher implementations reaching the same Companion two different ways — the homepage's own "Try Mezzo" CTA navigated to try-it.html, which then offered its own separate "Open Mezzo Companion" action. Consolidated into one: the Home/Dock state machine (session creation, direct Companion launch, Dock status mapping, `transitionToState()`) moved out of try-it.js into a new shared module, `src/home-dock.js`, which `landing.js` now calls directly. `index.html` gained the Dock and unsupported-browser states (styles ported from the retired `try-it.css` into `landing.css`); its hero CTA changed from "Try Mezzo" (a link to try-it.html) to "Open Mezzo Companion" (a button that opens the Companion directly, no navigation). `try-it.html` is now a static redirect to `index.html` (`try-it.js`/`try-it.css` deleted outright), kept only for the browser extension's existing entry URL and old bookmarks/cached service-worker entries; `monitoring.html` was updated to redirect straight to `index.html` too, rather than chaining through try-it.html. "Try Mezzo" is fully retired — it no longer appears anywhere in production UI, nav or CTA. The browser extension (`extension/background.js`) still points at `try-it.html` and was deliberately left unchanged (works fine through the redirect; updating it to skip the extra hop was flagged, not made, since it's a separate deployable this pass didn't touch).
* **Validation status.** The calibration/profile model rebuilt across Steps 5–7 and carried into the PiP-first Home/Dock model (shared controller, canonical profile shapes, cross-tab lock) is implementation-correct per its automated suite (212 `node --test` cases as of the PiP-first pass) and repeated real-browser smoke runs (Chromium, fake microphone). It has not been used or validated by a real person, on real hardware, across the range of microphones/rooms/accents the product actually needs to work for. Automated and smoke tests establish that the code does what it's designed to do — not that the calibration experience itself feels right. See the Step 7 report's recommended validation plan before treating this as done in that second sense.

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
* **`docs/ux/speaking-profile-flow.md`** — **retired**: it documented the Speaking Profile page's screens and copy, a page-level implementation that no longer exists now that profile selection/calibration/recalibration are Companion-only. Kept as a historical record of that design, not current-state terminology or behavior; its still-relevant profile-library rules (delete confirmation copy, 5-profile-limit copy) now live in `docs/product-experience.md`'s Companion States → Ready section instead.
* **`docs/design-principles.md`** — reusable visual, interaction, motion, and copy principles that extend beyond a single feature. *(proposed — not yet created)*
* **`docs/natural-systems.md`** — the philosophy behind breathing, propagation, contour behavior, organic motion, peripheral awareness. *(proposed — not yet created)*
* **PRDs** — individual feature requirements: problem, goals, scope, constraints, acceptance criteria, open questions. Never redefine the product.
* **`docs/discoveries/`** — browser limitations, implementation discoveries, research, experiments, unresolved questions, and tracked technical debt. Historical record, not canonical. *(proposed — not yet created)*
* **Implementation notes** — temporary constraints, migration plans, technical debt. Never authoritative for product decisions.
