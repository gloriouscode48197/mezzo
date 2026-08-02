/**
 * Mezzo — Session Ownership Module (PiP-First)
 *
 * Owns everything about a monitoring session: the audio/engine pipeline,
 * the Mezzo Companion (Document Picture-in-Picture) lifecycle, the
 * explicit `sessionState` (src/session-state.js), and an explicit
 * `layoutMode` for the Companion's own two supported presentations
 * (Expanded / Compact — kept as a fully separate piece of state, never
 * inferred from window dimensions).
 *
 * The Mezzo Companion is the sole operational surface (see CLAUDE.md's
 * Non-Negotiable Decisions). Home (index.html/landing.js, via
 * src/home-dock.js, before a Companion exists) has exactly one job: call
 * startMonitoring() to open the Companion. It
 * does not choose a profile, does not request microphone permission, and
 * does not decide Welcome vs. Ready — the Companion decides all of that
 * for itself, every time it opens, from src/profiles.js's own storage:
 * zero saved profiles → Welcome, one or more → Ready. There is no more
 * "Home already chose a profile, skip straight to Monitoring" path —
 * every open goes through Welcome or Ready, first session of the day
 * included. Document Picture-in-Picture support is required to use Mezzo
 * at all now; there is no no-Companion-support fallback.
 *
 * The Companion renders as a set of genuinely separate screens — never a
 * shared layout with elements toggled: Welcome/01, C1 (calibration intro),
 * Calibrating/C2, Calibration Failed, C0 (microphone blocked), Ready, the
 * full-screen decision states M1 (replace/keep-as-unsaved), M2/M2a
 * (name/replace a new profile), M3 (five-profile limit), 06b (delete
 * confirmation), and Monitoring. See
 * docs/prd/ready-screen-speaking-profiles-mvp.md for the full state model.
 * Every screen except Monitoring shares one fixed size
 * (MEZZO_COMPANION_READY_WIDTH × MEZZO_COMPANION_READY_BASE_HEIGHT) and is
 * always Expanded — there is no Compact variant for any of them. Monitoring
 * is the only screen with two layouts:
 *   - Expanded (MEZZO_COMPANION_EXPANDED_SIZE, 290×420): the live
 *     awareness-state label (Quiet / Within Range / Approaching End of
 *     Range / Outside Range — the most prominent text in the header),
 *     locked profile metadata, the visualization, and a restrained bottom
 *     control bar (Stop, Compact) — never a large full-width Stop
 *     Monitoring button. No in-page title bar — the real Document
 *     Picture-in-Picture window chrome is the only title bar (see
 *     `pipDoc.title` below); every other state uses the same real window
 *     chrome too, with no in-page title bar of its own.
 *   - Compact (MEZZO_COMPANION_COMPACT_SIZE, 220×220): peripheral awareness,
 *     but with the same Stop reachable as Expanded — not session management
 *     beyond that. The visualization (centered, dominant), a Stop control
 *     (bottom-left corner overlay), and an Expand control (bottom-right
 *     corner overlay) are the ONLY persistent content — no wordmark, no
 *     visible status text, no profile metadata. Both corner controls are
 *     icon-only (aria-label carries their accessible name, same as
 *     Expand already did). The awareness-state element stays in the DOM
 *     (visually hidden, still aria-live) so assistive tech keeps hearing
 *     state changes; there is no visible equivalent. Stop in Compact calls
 *     the exact same stopMonitoring() Expanded's Stop does — it returns to
 *     Ready, it does not close the Companion. The native window-close
 *     control remains a separate, always-available way to close the
 *     Companion outright from any state — see handlePipClose, which
 *     already treats any Companion close (native ✕ or programmatic) as
 *     "stop monitoring, keep Mezzo open, layout resets to Expanded for the
 *     next open" rather than a full endSession() teardown.
 *
 * Profile selection, deletion, the 5-profile limit, calibration, and
 * recalibration all happen on the Companion's own Ready screen now — Home
 * never touches any of it. Once monitoring starts the profile is locked
 * and shown as plain informational text (Expanded only), so there is no
 * mid-monitoring profile-switch flow to reconcile. Stopping returns the
 * (still-open) Companion to Ready, where the profile selector unlocks
 * again for starting again, switching profiles, deleting one, or
 * calibrating a new one.
 *
 * Extracted out of what used to be monitoring.js's page controller so that
 * Home/Dock (src/home-dock.js, called from landing.js) can drive its own
 * minimal status view off this module's public surface without duplicating
 * the engine/audio/PiP internals — "one source of truth," not a second copy.
 *
 * Public surface is deliberately small: src/home-dock.js never calls
 * anything for Start/Stop Monitoring, profile selection, calibration, or
 * Expanded/Compact layout, directly — those controls live *inside* the
 * Companion's own document and are wired here. src/home-dock.js only needs: init,
 * startMonitoring (no arguments — the Companion resolves its own profile
 * and entry screen), stopMonitoring (fallback safety net, effectively
 * unreachable from Home now that Home has no Stop control), endSession
 * (Close Companion), subscribe/getSessionState (the Dock's status
 * mapping), and isPipSupported (the unsupported-browser check). There is
 * deliberately no "bring to front"/"focus" export — the Companion is a
 * Document PiP window and already stays above other windows on its own, so
 * a focus/raise action would be misleading. There is also no "Close
 * Companion" control anywhere in the Companion itself — the native
 * Picture-in-Picture window close control is the only way a user closes it
 * directly. Mezzo never closes the Companion on the user's behalf except
 * via endSession() (a full session teardown). Layout mode is likewise
 * entirely internal — nothing outside the Companion needs to know or care
 * whether it's Expanded or Compact.
 */

import { AudioProcessor } from './audio.js?v=2';
import { MezzoEngine } from './engine.js?v=5';
import { MezzoWaveVisualizer } from './wave-visualizer.js';
import { createCalibrationController } from './calibration-controller.js';
import { createCalibrationLock } from './calibration-lock.js';
import { trackMonitoringStarted, trackMonitoringSession, trackCalibrationCompleted } from './analytics.js';
import { markClassification, markPipUpdate } from './_timing-debug.js';
import { SESSION_STATES, createSessionState } from './session-state.js';
import {
  getSavedProfiles,
  saveSavedProfiles,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  setLastUsedProfile,
  clearLastUsedProfile,
  resolveActiveProfile,
  resolveSavePromptAction,
  commitSavePromptName,
  SAVE_PROMPT_ACTIONS,
  MAX_SAVED_PROFILES,
  getHasStartedMonitoring,
  setHasStartedMonitoring,
} from './profiles.js';

// Calibration failure codes (src/calibration-controller.js) mapped to calm,
// specific UI copy — never the raw engine.js error message, which is meant
// for logs/tests, not users. Both engine.js's baseline-floor and voiced-
// ratio rejections currently share one INSUFFICIENT_VOICE code (see
// calibration-controller.js's mapCalibrationError) and so share one message
// here too — distinguishing them further would require engine.js's own
// messages to diverge first.
//
// CROSS_TAB_LOCKED is not one of calibration-controller.js's own codes — it
// never reaches the controller at all. src/calibration-lock.js's acquire()
// is checked before a calibration attempt starts (see beginCalibrationFlow()
// on both surfaces); a rejection there is reported through this exact same
// Calibration Failed screen and copy map for a calm, consistent experience,
// without ever touching the controller, the mic, or generating a real
// calibration failure of its own.
export const CALIBRATION_FAILURE_COPY = {
  SILENCE: "Didn't catch enough clear speech — let's try again.",
  INSUFFICIENT_VOICE: "Didn't catch enough clear speech — let's try again.",
  UNSTABLE_ENVIRONMENT: 'Try somewhere a little quieter.',
  MIC_PERMISSION_DENIED: 'Mezzo needs microphone access to calibrate. Check your browser\'s microphone permission for this site, then try again.',
  NO_SAMPLES: "Didn't catch enough clear speech — let's try again.",
  CROSS_TAB_LOCKED: 'Calibration is already open in another Mezzo tab.',
  UNKNOWN: "Something went wrong — let's try again.",
};

// Exported (along with isTemporaryProfile/profileMetaText below) purely so
// these pure, DOM-free helpers can be unit tested directly — see
// src/mezzo-session.test.js — without needing a Document PiP-capable
// browser environment, which this module otherwise requires end to end.
export function calibrationFailureMessage(failure) {
  return CALIBRATION_FAILURE_COPY[failure?.code] || CALIBRATION_FAILURE_COPY.UNKNOWN;
}

/**
 * Pure copy for M2/M2a (see docs/prd/ready-screen-speaking-profiles-mvp.md)
 * — the Ready-screen "Save profile" naming state, given a
 * resolveSavePromptAction() (src/profiles.js) resolution. The single place
 * this state's terminology-sensitive text lives, so it's unit-testable
 * directly (see src/mezzo-session.test.js) without a Document PiP-capable
 * browser, and so renderM2State() below only renders it rather than
 * composing strings inline.
 *
 * BLOCKED is not normally reachable here — handleSaveProfileClick() routes
 * straight to M3 at the five-profile cap, never opening M2 in the first
 * place (see the PRD: "below cap → M2; at cap → M3, never M2 directly").
 * It's still handled defensively (disabled, generic copy) in case the
 * library reaches the cap in the brief window M2 is open.
 */
export function saveProfileNameCopy(resolution) {
  switch (resolution?.kind) {
    case SAVE_PROMPT_ACTIONS.UPDATE:
      return {
        warningText: `A profile named "${resolution.profile.name}" already exists.`,
        buttonLabel: 'Replace',
        disabled: false,
      };
    case SAVE_PROMPT_ACTIONS.BLOCKED:
      return {
        warningText: 'Delete a saved profile before saving this one.',
        buttonLabel: 'Save',
        disabled: true,
      };
    case SAVE_PROMPT_ACTIONS.CREATE:
      return { warningText: '', buttonLabel: 'Save', disabled: false };
    default: // INVALID — nothing typed yet
      return { warningText: '', buttonLabel: 'Save', disabled: true };
  }
}

/**
 * Pure copy for M1 (see docs/prd/ready-screen-speaking-profiles-mvp.md) —
 * reached only from a saved-profile recalibration's completion (never
 * session mode, which lands directly on Ready with the freshly-calibrated
 * unsaved profile selected instead — see handleCalibrationCompleted()
 * below). `targetName` is the recalibrated saved profile's own name.
 */
export function replaceProfileCopy(targetName) {
  const body = 'Replace the saved calibration with the one you just created?';
  if (!targetName) {
    return { heading: 'Replace this saved profile?', body };
  }
  return { heading: `Replace existing "${targetName}" profile?`, body };
}

// The one and only signal for "this profile is a runtime-only calibration
// that hasn't been saved" — never inferred from name, a missing id,
// calibratedTs recency, or which screen produced it. See CLAUDE.md's
// Profiles section and src/profiles.js's file header for the same rule
// applied to storage.
export function isTemporaryProfile(profile) {
  return profile?.temporary === true;
}

// Small decorative glyphs, shared across the DOM-construction functions
// below — module-level so they're not rebuilt on every Companion open.
// aria-hidden in every use site; the button/control's own text or
// aria-label is always the real accessible name.
const MIC_ICON_SVG = '<svg class="pip-intro-btn-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="4" y="1" width="4" height="6" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 6.5a3.5 3.5 0 0 0 7 0M6 10v1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const CHEVRON_ICON_SVG = '<span class="pip-ready-selector-chevron" aria-hidden="true"><svg viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const TRASH_ICON_SVG = '<svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true"><path d="M1 3.5h11M4.5 3.5V2h4v1.5M5.5 6.5v4M7.5 6.5v4M2 3.5l.8 8.5h7.4l.8-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CLOSE_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
// Schematic, not photorealistic — enough to point at "the icon in your
// browser's address bar" without claiming to be a literal screenshot of
// any specific browser.
const C0_ILLUSTRATION_SVG = '<svg viewBox="0 0 200 60" fill="none" aria-hidden="true"><rect x="1" y="1" width="198" height="34" rx="8" stroke="rgba(172,158,136,0.4)" stroke-width="1.5"/><circle cx="20" cy="18" r="6" stroke="rgba(210,155,75,0.9)" stroke-width="1.5"/><path d="M17 15l6 6M23 15l-6 6" stroke="rgba(210,155,75,0.9)" stroke-width="1.5" stroke-linecap="round"/><rect x="34" y="13" width="140" height="10" rx="5" fill="rgba(172,158,136,0.15)"/><path d="M60 50l-14 -14M46 50l14 -14" stroke="rgba(210,155,75,0.7)" stroke-width="1.5" stroke-linecap="round"/></svg>';

// Mirrors calibration-controller.js's own DEFAULT_CAPTURE_DURATION_MS
// (6000ms), which isn't exported — kept in sync here for the countdown
// display only. The controller's own capture timer is the actual source of
// truth for when capture ends; this constant only decides what the
// countdown text counts down from.
const CALIBRATION_COUNTDOWN_SECONDS = 6;

// Shared full-screen-decision affirmative-action timing (see the PRD's
// "Processing and Toast Feedback" requirements) and toast auto-dismiss
// timing. No existing precedent for either in this codebase, so both use
// the PRD's own suggested values directly.
const DECISION_PROCESSING_MS = 1000;
const TOAST_VISIBLE_MS = 2000;

// One product-oriented configuration source for every fixed Companion size —
// named for what they are, not for the underlying Picture-in-Picture API.
// Avoid introducing further bespoke sizes; intermediate sizes (from a user
// manually resizing) are handled by responsive CSS, not new constants.
// Ready is its own fixed size, distinct from Monitoring's Expanded size —
// the two used to share one constant, but the Ready and Monitoring cards
// have different target dimensions.
//
// Width — wide enough that a max-width:320px action button (see
// .pip-ready-start-btn etc. below) sits with ~30px clear on each side:
// .pip-screen-ready's own existing 20px side padding is unchanged, so once
// a button hits its 320px cap inside a wider column, centering (margin-
// inline:auto) splits the remaining slack evenly — 320 (button) + 2x20
// (existing padding) + 2x10 (that centering slack) = 380. No internal
// padding/spacing value on the screen itself changed to get here.
export const MEZZO_COMPANION_READY_WIDTH = 380;

// Baseline height — shared by every pre-monitoring screen (Welcome,
// Calibrating, and every full-screen decision state, alongside Ready
// itself). See computeReadyContentHeight() below for the term-by-term
// derivation.
//
// Ready-screen PRD note (docs/prd/ready-screen-speaking-profiles-mvp.md):
// this height is no longer profile-count-dependent, unlike the pre-PRD
// formula it replaces. The old Ready screen rendered every saved profile as
// an always-visible inline row, so the window had to grow with the library.
// The approved selector instead shows one collapsed summary row + an
// overlay dropdown that expands *within* the existing card bounds (own
// internal scroll, same pattern the old delete-confirmation modal and the
// dropdown's own row list both already use) — the collapsed layout's height
// is therefore fixed regardless of how many profiles exist. See
// computeReadyContentHeight() below.
export const MEZZO_COMPANION_READY_BASE_HEIGHT = 364;

const MEZZO_COMPANION_READY_SIZE = { width: MEZZO_COMPANION_READY_WIDTH, height: MEZZO_COMPANION_READY_BASE_HEIGHT };

/**
 * Deterministic Ready-screen height, derived from the actual rendered
 * layout below (.pip-screen-ready/.pip-ready-* rules) rather than a flat
 * guess. No longer a function of saved-profile count (see the PRD note on
 * MEZZO_COMPANION_READY_BASE_HEIGHT above) — kept as an exported function,
 * not inlined to a bare constant, so every call site still reads as "the
 * Ready screen's own computed height" rather than a magic number, and so a
 * future change that genuinely does need to vary this again has one place
 * to do it.
 *
 * Every term below is read directly off the CSS the Ready screen is
 * actually built with (six direct children, five 10px gaps between them):
 *   36  - .pip-screen-ready's own top+bottom padding (18px each), unchanged
 *   26  - .pip-ready-heading, one line
 *   12  - .pip-ready-profile-label ("Speaking profile")
 *   40  - .pip-ready-selector-wrap (min-height, one line + chevron — the
 *         wrap, not the trigger button directly, is the actual flex child
 *         here: it holds the trigger's own real height, since the
 *         overlay panel inside it is absolutely positioned and
 *         contributes nothing to it — see .pip-ready-selector-wrap's own
 *         comment below for why the panel anchors to the wrap rather than
 *         a fixed pixel offset from the screen)
 *   28  - .pip-ready-contextual-actions (min-height — one row of small
 *         text-link actions, never the old full-width pill buttons; see
 *         the PRD's Button and Action System)
 *   40  - .pip-ready-start-btn (min-height, unchanged from the pre-PRD
 *         Start Monitoring button)
 *   32  - .pip-ready-disclaimer (min-height — two lines at its own
 *         max-width:260px)
 *   50  - 5 x the screen's own 10px gap (six children)
 *  100  - requested breathing room: ~50px visible above the heading, ~50px
 *         below the disclaimer. .pip-screen-ready uses
 *         justify-content:center specifically so unused height shows up as
 *         space at both ends instead of only pushing the bottom down — see
 *         that rule below. No change to the screen's own padding/gap
 *         values, only how leftover space distributes.
 * Every min-height referenced above is set explicitly in the CSS below —
 * not left to intrinsic content sizing — specifically so this comment and
 * the actual rendered layout can never quietly drift apart.
 */
export function computeReadyContentHeight() {
  return MEZZO_COMPANION_READY_BASE_HEIGHT;
}
const MEZZO_COMPANION_EXPANDED_SIZE = { width: 290, height: 420 };
// 220×220 — the intentional Compact footprint: a small, square window built
// for peripheral awareness, not a shrunk-down Expanded window (was
// 220×260 — matched against the approved design direction and updated).
// No title bar (the real Document PiP window chrome covers that) and no
// wordmark/status text/profile metadata; only the visualization and the
// Stop/Expand corner-overlay controls remain.
const MEZZO_COMPANION_COMPACT_SIZE = { width: 220, height: 220 };

const LAYOUT_MODES = Object.freeze({ EXPANDED: 'expanded', COMPACT: 'compact' });

const OUTSIDE_ZONE = 3; // "Outside Range" — there's no higher volume tier
const SUSTAINED_DRIFT_MS = 1000; // continuous time outside range before drift escalates

// Calibrating screen's live meter dB-to-0..1 mapping. (Predates the
// PiP-first model: a page-level calibration ring on the old dual-surface
// try-it.js once used the same ENERGY_DB_MIN/MAX naming — that page-level
// screen is long retired, calibration is Companion-only now, but the
// mapping itself is unchanged.)
const CALIBRATION_METER_DB_MIN = -50;
const CALIBRATION_METER_DB_MAX = -10;

function zoneLabel(zone) {
  if (zone === 0) return 'Quiet';
  if (zone === 1) return 'Within Range';
  if (zone === 2) return 'Approaching End of Range';
  return 'Outside Range'; // zone === OUTSIDE_ZONE
}

// The Monitoring screen's read-only profile line, e.g. "Profile: Coffee Shop
// (Custom)" or "Profile: Current speaking range (Unsaved)" for a temporary
// calibration — checked first and only via isTemporaryProfile(), never
// inferred from name/id shape. A profile counts as "Custom" if and only if
// it carries `id` — the one canonical shape every production caller now
// produces for a saved-profile monitoring session (the persisted saved-
// profile object itself: {id, name, speakingDb, spreadDb, calibratedTs} —
// see src/profiles.js's addSavedProfile()/updateSavedProfile()). The older
// `savedProfileId`-wrapper shape (no `id`) that try-it.js used to construct
// for this purpose is gone — Step 7 normalized every production call site
// onto the direct saved-profile object instead of wrapping it, so there is
// nothing left to check `savedProfileId` for here. `savedProfileId: null`
// still appears, but only as part of the *temporary* shape (alongside
// `temporary: true`), which isTemporaryProfile() already catches above.
export function profileMetaText(profile) {
  // A neutral fallback — there is no built-in default profile to fall back
  // to a label for. Every real profile shape reaching this function
  // (temporary, or saved via `id`) already carries a real `name`; this
  // branch is only reached with `profile` itself missing entirely (e.g.
  // before init() resolves an active profile), never with a real, named
  // profile lacking one.
  const name = profile?.name || 'Unknown Profile';
  if (isTemporaryProfile(profile)) return `Profile: ${name} (Unsaved)`;
  return profile?.id ? `Profile: ${name} (Custom)` : `Profile: ${name}`;
}

export function createMezzoSession({
  baseUrl,
  onSessionStateChange,          // (state) => void — drives the Dock's status mapping.
} = {}) {
  const pipSupported = 'documentPictureInPicture' in window;
  const sessionState = createSessionState();

  const audio = new AudioProcessor();
  const engine = new MezzoEngine();
  // One instance for this tab's whole session — used exclusively by this
  // module's own Welcome/Calibrating/Calibrated/Calibration-Failed screens
  // now (Home has no calibration UI of its own to share it with — see
  // CLAUDE.md's Engineering Notes on the retired dual-surface model).
  // Reuses this module's own `audio` (AudioProcessor) rather than a second,
  // redundant mic pipeline — calibration and monitoring are always
  // sequential, never concurrent, so one shared instance is safe: by the
  // time any commit method resolves, the controller has already fully
  // released its own hold on the mic (see calibration-controller.js's
  // micHeld-gated teardown), well before beginMonitoringSession() below
  // ever re-acquires it. See CLAUDE.md's "Calibration Controller Instance
  // Rule" — this single instance is what satisfies it for this tab.
  const calibrationController = createCalibrationController({ audio });

  // Cross-tab lease (src/calibration-lock.js) — a DIFFERENT browser tab
  // running its own Mezzo session can't hold the microphone or race this
  // tab's profile-storage writes during a calibration attempt. One instance
  // per tab, used only internally now that Home has no calibration UI of its
  // own to share it with — see calibration-lock.js's own header for why this
  // is a localStorage lease, not a second controller, and why it's kept
  // structurally separate from calibration measurement logic entirely.
  const calibrationLock = createCalibrationLock();

  // Release is centralized here, not scattered across every cancel/commit/
  // failure call site on both surfaces: 'idle' covers every commit, cancel,
  // and close (reset() always lands there, including the pagehide handler's
  // own calibrationController.cancel() call below) — 'failed' releases too,
  // since the mic is already free by the time FAILED is reached (see
  // calibration-controller.js's runCapture()); nothing is left to protect
  // through the Failed screen's "try again or back" decision. Deliberately
  // NOT gated by getOwner() — release must happen regardless of which
  // surface owned the run.
  calibrationController.subscribe((state) => {
    if (state.status === 'idle' || state.status === 'failed') {
      calibrationLock.release();
    }
  });

  // Generic reactions to controller state — 'failed' and 'calibrated'
  // always mean the same screen transition regardless of how the run got
  // there, so they're handled centrally here. 'calibrating' and 'idle'
  // are deliberately NOT handled generically: 'calibrating' is already
  // shown synchronously by whatever called startSessionCalibration()/
  // startRecalibration()/retry(), and 'idle' can mean several different
  // next screens depending on context (Ready, or navigating elsewhere
  // entirely) that a single generic handler couldn't infer safely.
  //
  // Ungated: this module is the calibration controller's one and only
  // subscriber for rendering purposes now — Home (landing.js/src/home-dock.js)
  // never starts a calibration run and has no screens of its own to render, so there is no
  // second surface's state changes to filter out here anymore. (The earlier
  // dual-surface model's CALIBRATION_OWNERS-gated version of this listener
  // is retired along with that model — see CLAUDE.md's Engineering Notes.)
  calibrationController.subscribe((state) => {
    if (state.status === 'failed') {
      showFailedScreen(state.failure);
    } else if (state.status === 'calibrated') {
      trackCalibrationCompleted();
      handleCalibrationCompleted(state);
    }
  });

  let pipCircle = null;
  let activeCircle = null;
  let pipWindow = null;
  let pipDocument = null;
  let baselineRMS = 0;
  let activeProfile = null;
  let isMonitoringActive = false;
  let isPageUnloading = false;

  // Explicit, Companion-internal — never inferred from pipWindow's actual
  // dimensions. Only meaningful while sessionState is monitoringActive;
  // every other state is unconditionally Expanded regardless of this value.
  let layoutMode = LAYOUT_MODES.EXPANDED;

  // Welcome/01-screen DOM ref — reached exactly once, the first time the
  // Companion ever opens with zero saved profiles (see showWelcomeScreen()).
  let welcomeScreenEl = null;

  // C1 — calibration-introduction interstitial, shown before every
  // session-mode calibration: Welcome's own primary action
  // (handleWelcomeCalibrateClick()) and Ready's Create new profile
  // (handleCreateNewProfileClick()) both route through it. Recalibrate
  // (saved or unsaved profile) is the one calibration entry that skips it,
  // going straight to Calibrating instead — see beginCalibrationFlow()'s own
  // callers below for the resolved rule (this PRD's own §19 flagged the
  // recalibrate case as an open item; "Create new profile" was not — see
  // docs/prd/ready-screen-speaking-profiles-mvp.md's §12 State Transitions).
  let c1ScreenEl = null;
  let c1BackBtn = null;

  // Which screen opened C1 — 'welcome' or 'ready' — tracked explicitly
  // (never inferred from saved-profile count or any other mutable state,
  // both of which can legitimately be ambiguous: a zero-saved-profile
  // Companion can still reach C1 via Create new profile if an unsaved
  // profile is already selected on Ready). Read only by handleC1BackClick()
  // below to decide where Back returns to.
  let c1EntrySource = null;

  // C0 — dedicated microphone-blocked screen, reached instead of the
  // generic Calibration Failed screen specifically for
  // MIC_PERMISSION_DENIED (see showFailedScreen()).
  let c0ScreenEl = null;

  // Ready-screen DOM refs, (re)assigned each time startMonitoring() builds
  // the document. The approved selector model (see
  // docs/prd/ready-screen-speaking-profiles-mvp.md): a collapsed trigger
  // that expands into an overlay panel — own internal scroll, absolutely
  // positioned within the card's own bounds, never resizes the window (see
  // MEZZO_COMPANION_READY_BASE_HEIGHT's own comment) — with grouped
  // Unsaved/Saved rows, followed by contextual text-link actions and Start
  // monitoring, both rendered fresh on every selection change.
  let readyScreenEl = null;
  let readyHeadingEl = null;
  let readySelectorTriggerEl = null;
  let readySelectorTriggerNameEl = null;
  let readySelectorPanelEl = null;
  let readyContextualActionsEl = null;
  let readyStartBtn = null;
  let readyDisclaimerEl = null;
  let selectorExpanded = false;

  // Full-screen decision states — M1 (replace/keep-as-unsaved), M2/M2a
  // (name/replace a new profile), M3 (five-profile limit), and 06b (delete
  // confirmation). Each is a genuinely separate screen (see CLAUDE.md:
  // never one screen with elements toggled), built from the shared
  // .pip-screen-decision visual vocabulary.
  let m1ScreenEl = null;
  let m1HeadingEl = null;
  let m1ReplaceBtn = null;
  let m1KeepBtn = null;

  let m2ScreenEl = null;
  let m2WarningEl = null;
  let m2NameInput = null;
  let m2SubmitBtn = null;

  let m3ScreenEl = null;
  let m3CloseBtn = null;

  let deleteScreenEl = null; // 06b
  let deleteHeadingEl = null; // full "Delete "{name}"?" text set live in openDeleteScreen()
  let deleteConfirmBtn = null;
  let deleteCancelBtn = null;

  // Toast — a save/replace confirmation, floated above whichever screen is
  // visible (a sibling of every .pip-screen, not owned by any one of them).
  let toastEl = null;
  let toastCardEl = null;
  let toastHideTimer = null;

  let pendingDeleteProfileId = null;

  // Monitoring-screen DOM refs
  let monitoringScreenEl = null;
  let pipStatusHeadingEl = null;
  let monitoringProfileNameEl = null;
  let pipCircleWrapperEl = null;

  // Calibrating-screen (C2) DOM refs
  let calibratingScreenEl = null;
  let calibratingSubheadingEl = null; // mode-aware "Recalibrating {name}" line — session mode leaves it empty
  let calibratingStatusEl = null; // live "Listening… {n}s" countdown text
  let calibratingBarFillEl = null;
  let calibratingCountdownTimer = null;

  // Calibration Failed-screen DOM refs
  let failedScreenEl = null;
  let failedMessageEl = null;

  // The unsaved (temporary) profile for this Companion-open lifetime — held
  // purely in memory, never sessionStorage: Document PiP shares the opener
  // tab's storage, so anything written there would incorrectly survive a
  // native Companion close (see CLAUDE.md's canonical temporary-profile
  // shape). At most one exists at a time — a fresh calibration (whether
  // reached via Recalibrate of the unsaved profile itself, or Create new
  // profile from a saved-profile selection) always replaces whichever one
  // existed before, never adds a second.
  let unsavedProfile = null;

  // Whichever contextual-action/row button opened the currently-visible
  // full-screen decision state, if any — restored focus on returning to
  // Ready, so keyboard/screen-reader users land back where they started
  // rather than at the top of the screen.
  let decisionTriggerEl = null;

  // Reentrancy guard shared by every decision-state affirmative action
  // (M1/M2/M2a/06b) — the brief processing state each renders is what makes
  // a rapid double Enter/click visible in the first place, so one shared
  // flag is enough: only one decision screen is ever visible at a time.
  let decisionCommitInFlight = false;

  let unsubscribeCalibrationLevel = null; // Calibrating screen's live-meter subscription — torn down whenever that screen isn't active

  let currentZone = 0;
  let isSustained = false;
  let sustainedTimer = null;

  let monitoringStartTime = null;
  let sessionAlertTriggered = false;

  function clearSustained() {
    if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
    isSustained = false;
  }

  function updateHeading(zone) {
    const text = zoneLabel(zone);
    if (pipStatusHeadingEl && sessionState.get() === SESSION_STATES.MONITORING_ACTIVE) {
      pipStatusHeadingEl.textContent = text;
      // Presentational only — drives the status label's per-zone color (see
      // the .pip-status-heading[data-zone] CSS). Doesn't change what zone is
      // computed or when the label updates, both still decided above.
      pipStatusHeadingEl.dataset.zone = String(zone);
    }
  }

  function onAudioFrame({ rms }) {
    // Explicit real timestamp, not engine.js's own performance.now() default —
    // keeps the caller in control of the clock the Outside-of-Range entry
    // dwell (see OUTSIDE_ENTRY_DWELL_MS in engine.js) measures against.
    engine.processFrame(rms, performance.now());
    markClassification(); // TEMPORARY — see docs/monitoring-runtime-investigation.md

    const zone = engine.getZone();

    if (zone !== currentZone) {
      const wasOutside = currentZone === OUTSIDE_ZONE;
      const nowOutside = zone === OUTSIDE_ZONE;

      updateHeading(zone);
      currentZone = zone;

      if (nowOutside && !wasOutside) {
        sustainedTimer = setTimeout(() => {
          sustainedTimer = null;
          isSustained = true;
          sessionAlertTriggered = true;
        }, SUSTAINED_DRIFT_MS);
      } else if (!nowOutside && wasOutside) {
        clearSustained();
      }
    }

    if (activeCircle) {
      activeCircle.update(currentZone, isSustained);
      markPipUpdate(pipWindow); // TEMPORARY — see docs/monitoring-runtime-investigation.md
    }

    const diff = rms - baselineRMS;
    console.log(`[Session] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  zone=${currentZone}  sustained=${isSustained}  ${zoneLabel(currentZone)}`);
  }

  /** @returns {Promise<boolean>} false if mic acquisition failed */
  async function beginMonitoringSession(profile) {
    activeProfile = profile;
    // setLastUsedProfile() silently refuses a temporary profile on its own
    // (src/profiles.js) — but setSelectedProfile() has no such guard (it
    // stores whatever it's given), so it needs the check here: without this,
    // starting monitoring from a never-saved session-mode calibration would
    // overwrite this tab's real remembered selection (sessionStorage) with a
    // temporary profile object. That stale entry would then outlive the
    // temporary profile itself — discarded on Stop/close everywhere else,
    // but still sitting in storage — and resolveActiveProfile() would hand
    // it back as this tab's "own session choice" on the next Companion open,
    // silently masking whatever real saved profile the user had selected
    // before. Only a genuine saved profile should ever become this tab's
    // remembered selection.
    if (!isTemporaryProfile(profile)) setSelectedProfile(profile);
    setLastUsedProfile(profile);

    baselineRMS = Math.pow(10, profile.speakingDb / 20);
    // loadCalibration(), not calibrate() against a synthetic sample array —
    // this profile's calibration was already validated once when it was
    // first calibrated (or last recalibrated); re-deriving it from a fake
    // uniform-fill array would silently discard its real spreadDb (a
    // uniform array always measures spread as ~0) — see engine.js's own
    // loadCalibration() doc comment.
    engine.loadCalibration({ baselineRMS, spreadDb: profile.spreadDb });
    engine.startMonitoring();

    currentZone = 0;
    clearSustained();
    updateHeading(0);

    try {
      await audio.acquire();
    } catch (err) {
      console.error('[Session] Mic acquisition failed:', err.message);
      return false;
    }

    audio.onLevelChange = onAudioFrame;
    audio.startMonitoring();

    isMonitoringActive = true;
    monitoringStartTime = Date.now();
    sessionAlertTriggered = false;
    trackMonitoringStarted();
    // One-way — see the Ready-screen PRD's first-conversation rule
    // (§2 in the implementation spec): only ever set here, the one place
    // monitoring actually, successfully begins. Never set on calibrate,
    // save, replace, select, or a decision-state opening.
    setHasStartedMonitoring();
    return true;
  }

  /** Stops audio/engine/analytics — the shared "actual stop" work behind both
   *  a normal Stop Monitoring click and the Companion closing mid-session. */
  function teardownMonitoringEngine() {
    if (monitoringStartTime) {
      const durationSeconds = Math.round((Date.now() - monitoringStartTime) / 1000);
      trackMonitoringSession({
        durationSeconds,
        usedPip: true, // always true now — there is no no-Companion-support fallback path anymore
        alertTriggered: sessionAlertTriggered,
      });
      monitoringStartTime = null;
    }

    isMonitoringActive = false;
    engine.stopMonitoring();
    audio.stopMonitoring();
    audio.release();

    clearSustained();
    currentZone = 0;
  }

  function stopMonitoring() {
    if (!pipWindow) return; // defensive — Stop only ever exists inside the Companion now

    teardownMonitoringEngine();

    // The Companion stays open — Document PiP does not survive its opener
    // navigating away, so doing so would silently kill the window. Always
    // returns straight to Ready: a temporary profile simply stays selected
    // and usable (see the PRD's Unsaved-Profile Ready States) rather than
    // forcing a save decision before the user can do anything else —
    // showReadyScreen(), not enterPipReadyMode(), since activeProfile (still
    // set, whether temporary or saved) means this is never genuinely the
    // zero-saved-profiles Welcome case.
    showReadyScreen();
  }

  /**
   * Best-effort resizes the actual window to a given fixed size. Resizing an
   * already-open Document PiP window isn't guaranteed by every browser — if
   * it's unsupported or blocked, the layout still renders correctly at
   * whatever size the window actually is; explicit state, not window
   * dimensions, decides which content shows.
   */
  function resizeCompanionTo(size) {
    if (!pipWindow) return;
    try {
      pipWindow.resizeTo(size.width, size.height);
    } catch (err) {
      console.warn('[Session] Could not resize the Mezzo Companion:', err.message);
    }
  }

  /**
   * Applies an explicit Monitoring layout mode: updates the state variable,
   * flips the data-layout attribute that the Compact/Expanded CSS keys off
   * (the intentional, state-driven presentation), and resizes to that
   * layout's fixed size. Ready has its own fixed size and resize path (see
   * enterPipReadyMode) — this is Monitoring-only.
   */
  function applyLayoutMode(mode) {
    layoutMode = mode;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', mode);
    resizeCompanionTo(mode === LAYOUT_MODES.COMPACT ? MEZZO_COMPANION_COMPACT_SIZE : MEZZO_COMPANION_EXPANDED_SIZE);
  }

  function enterExpandedLayout() {
    applyLayoutMode(LAYOUT_MODES.EXPANDED);
  }

  function enterCompactLayout() {
    // Compact is only ever offered while monitoring — Ready has no Compact
    // variant, so this is a no-op otherwise.
    if (sessionState.get() !== SESSION_STATES.MONITORING_ACTIVE) return;
    applyLayoutMode(LAYOUT_MODES.COMPACT);
  }

  /**
   * Opens the Mezzo Companion — Home's one and only action, with no
   * arguments: Home never chooses a profile, never requests microphone
   * permission, and never decides what screen the Companion opens to. Once
   * the window and its document exist, the Companion resolves its own
   * entry state from src/profiles.js's storage (see enterPipReadyMode()
   * near the bottom of this function) — Welcome for zero saved profiles,
   * Ready for one or more — never straight into Monitoring. Call directly
   * from a real click (this is what satisfies Document PiP's
   * fresh-user-gesture requirement now that the caller is index.html's own
   * page, not a separate window relaying the gesture).
   * @returns {Promise<boolean>} whether the Companion actually opened
   */
  async function startMonitoring() {
    if (!pipSupported) {
      console.warn('[Session] Document PiP API not supported');
      return false;
    }

    try {
      // Ready's size, not Monitoring's Expanded size — every open now lands
      // on a pre-monitoring screen first, never straight into Monitoring,
      // so requesting the window at the size it'll actually need avoids a
      // visible resize flash immediately after opening. Every pre-
      // monitoring screen (Welcome/01, Ready, Calibrating, and every
      // full-screen decision state) now shares this one fixed size — see
      // MEZZO_COMPANION_READY_BASE_HEIGHT's own comment for why Ready's
      // height stopped depending on saved-profile count.
      pipWindow = await documentPictureInPicture.requestWindow(MEZZO_COMPANION_READY_SIZE);
      // Belt-and-suspenders, not a poll/loop: requestWindow()'s size argument
      // isn't guaranteed to be honored by every browser (the same caveat
      // resizeCompanionTo() below already carries) — a returning user's
      // previously-honored manual resize is the documented case this
      // guards against. One corrective call right after open, never
      // repeated/watched afterward.
      resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    } catch (err) {
      console.error('[Session] Failed to open the Mezzo Companion:', err.message);
      return false;
    }

    const pipDoc = pipWindow.document;
    pipDocument = pipDoc;

    // The real Document Picture-in-Picture window chrome is the Companion's
    // only title bar now (see the Monitoring screen build below, which no
    // longer constructs an in-page one). "Mezzo Companion" matches CLAUDE.md's
    // canonical terminology exactly (was "MEZZO COMPANION" — normalized,
    // not a behavior change).
    //
    // PiP TITLE INVESTIGATION (Step 7) — what this line actually controls,
    // and what it doesn't:
    //  - Confirmed via source + live testing: this sets pipDocument.title on
    //    a genuinely separate Document object (the PiP window shares the
    //    opener's JS realm but not its `document`) — reading it back returns
    //    exactly what was assigned, and changing it never touches the main
    //    tab's own document.title. Isolation is real, not assumed.
    //  - Confirmed via the Document Picture-in-Picture spec (wicg.github.io/
    //    document-picture-in-picture): "It is required that the user agent
    //    makes it clear to the user which origin is controlling the
    //    DocumentPictureInPicture window at all times... the user agent may
    //    display the origin of the website in a titlebar on the window."
    //    This is a security requirement, not an implementation detail — the
    //    floating window has no address bar, so the titlebar is the
    //    substitute origin indicator.
    //  - NOT verified in this environment: what the real, native OS title
    //    bar chrome actually renders in Chrome today — whether it's this
    //    document.title, the origin, or both. Automated testing (Playwright)
    //    can only inspect the DOM property; it cannot capture native window
    //    chrome pixels, and this sandbox has no way to eyeball a real
    //    desktop Chrome window. Community documentation corroborates the
    //    spec's origin-titlebar reading (see the Step 7 report), which
    //    suggests this assignment may have little-to-no effect on the
    //    visible titlebar text specifically, even though it demonstrably
    //    works as a DOM property.
    // Kept, not removed: document.title still has real, independent value
    // for accessibility trees, OS task-switcher/taskbar entries, and
    // browser history, regardless of what the titlebar glyphs show — see
    // docs/product-experience.md's engineering notes for the full writeup.
    // Only the casing changed here; no behavior was added or removed since
    // the evidence doesn't clearly support that being effective, per this
    // investigation's own findings.
    pipDoc.title = 'Mezzo Companion';

    const fontLink = pipDoc.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400&family=Sora:wght@300;400;500&display=swap';
    pipDoc.head.appendChild(fontLink);

    const link = pipDoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = baseUrl + 'design-tokens/mezzo-tokens.css';
    const cssReady = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    pipDoc.head.appendChild(link);
    await cssReady;

    const style = pipDoc.createElement('style');
    style.textContent = `
      .hidden { display: none !important; }

      body {
        margin: 0;
        width: 100%;
        height: 100vh;
        background: var(--surface);
        overflow: hidden;
      }
      .pip-layout {
        width: 100%;
        height: 100%;
        position: relative;
      }
      /* Shared "card" treatment — every screen renders as a rounded,
         shadowed card filling the real (fixed-size) Picture-in-Picture
         window, matching the reference's own per-state card mockups.
         position:relative so the Ready screen's profile-dropdown backdrop
         (a child of .pip-screen-ready) can use inset:0 against this card's
         own bounds, not the whole document. overflow:hidden keeps the
         backdrop's corners and everything else clipped to the radius. */
      .pip-screen {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        overflow: hidden;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        box-shadow: 0 24px 56px rgba(0, 0, 0, 0.55), inset 0 0 40px rgba(0, 0, 0, 0.16);
        background: #3c3b3f;
      }
      .pip-status-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        color: var(--text-subdued);
        letter-spacing: 0.04em;
      }
      .btn-wide {
        padding: 16px 64px;
        min-width: 240px;
      }

      /* Shared cap for every full-width, single-column pill action in the
         Companion — Start monitoring and every full-screen decision
         state's primary/secondary action share this one rule (Recalibrate/
         Create new profile/Save profile are text links now, not pills —
         see .pip-ready-contextual-actions, which reuses .pip-text-btn
         directly rather than a dedicated class of its own — so they never
         need this cap). At the default Companion width these buttons
         already sit well under 320px, so this only matters once a user
         manually resizes the window wider — see MEZZO_COMPANION_READY_WIDTH's
         own comment above for how 320 (button) + 30 + 30 (this centering
         slack, on top of each screen's own unchanged side padding) adds up.
         Compact controls, selector rows, and the native window-close
         control are untouched — they don't use this pattern. */
      .pip-ready-start-btn,
      .pip-decision-primary-btn,
      .pip-decision-secondary-btn {
        max-width: 320px;
        margin-inline: auto;
      }

      /* ── Shared intro-text vocabulary — heading + body, used by both
         Welcome/01 and C1 (their content shape is identical: a short
         heading, one explanatory paragraph, one primary action). ── */
      .pip-intro-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 17px;
        color: rgba(222, 210, 194, 0.92);
        margin: 0;
      }
      .pip-intro-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.80);
        margin: 0;
        max-width: 250px;
      }
      .pip-intro-disclaimer {
        font-family: var(--font-body);
        font-size: 10.5px;
        line-height: 1.4;
        color: rgba(172, 158, 136, 0.70);
        margin: 2px 0 4px;
        max-width: 240px;
      }
      /* Mic glyph inside the Welcome/01 primary action — decorative only
         (the button's own text is the full accessible name), aria-hidden
         in the DOM below. */
      .pip-intro-btn-icon { width: 13px; height: 13px; flex-shrink: 0; }

      /* ── Welcome/01, C1, C0 — all reached before any usable speaking
         profile exists, all share Ready's fixed size (see
         MEZZO_COMPANION_READY_BASE_HEIGHT). Centered, generous padding —
         the same treatment across all three keeps the first-time
         experience visually continuous rather than three unrelated
         layouts. ── */
      .pip-screen-welcome,
      .pip-screen-c1,
      .pip-screen-c0 {
        justify-content: center;
        padding: 28px 24px;
        box-sizing: border-box;
        gap: 12px;
        text-align: center;
      }

      /* Primary action shares the pill treatment .pip-ready-start-btn
         below defines — reused verbatim as .pip-intro-primary-btn so
         Welcome/01, C1, and Start monitoring all read as the same kind of
         affirmative action. Icon + label sit inline. */
      .pip-intro-primary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        background: var(--hanko-fill);
        border: none;
        border-radius: 50px;
        padding: 12px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: var(--weight-medium);
        color: rgba(255, 255, 255, 0.92);
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: opacity 0.15s ease;
        box-sizing: border-box;
        min-height: 40px;
        max-width: 320px;
        margin-inline: auto;
      }
      .pip-intro-primary-btn:hover { opacity: 0.88; }

      /* C0's address-bar illustration — schematic, not photorealistic:
         enough to point at "the icon in your address bar" without
         claiming to be a literal screenshot of any specific browser. */
      .pip-c0-illustration {
        width: 100%;
        max-width: 220px;
        margin: 4px 0;
      }

      /* ── Ready screen — the approved selector model (see
         docs/prd/ready-screen-speaking-profiles-mvp.md). One stable
         layout: heading, "Speaking profile" label, a collapsed selector
         trigger that expands into an overlay panel (own internal scroll,
         never resizes the window — see MEZZO_COMPANION_READY_BASE_HEIGHT's
         own comment), contextual actions, Start monitoring, and the
         privacy disclaimer, always in that order. justify-content:center
         so the ~50px breathing room the height formula reserves shows up
         at both ends, not just pushed below the last element. ── */
      .pip-screen-ready {
        justify-content: center;
        padding: 18px 20px 18px;
        box-sizing: border-box;
        gap: 10px;
      }

      .pip-ready-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 16px;
        line-height: 1.4;
        letter-spacing: 0.01em;
        color: rgba(222, 210, 194, 0.85);
        text-align: center;
        margin: 2px 0 0;
        min-height: 26px;
        flex-shrink: 0;
      }

      .pip-ready-profile-label {
        font-family: var(--font-body);
        font-size: 10px;
        font-weight: var(--weight-medium);
        letter-spacing: 0.10em;
        text-transform: uppercase;
        color: rgba(172, 158, 136, 0.65);
        min-height: 12px;
        flex-shrink: 0;
      }

      /* Collapsed summary row — shows the selected profile, opens the
         panel below on click. A real <button>, not a native <select>: the
         panel's own grouped/sectioned layout (Unsaved vs. Saved profiles,
         inline delete/discard) has no equivalent in a native select. */
      .pip-ready-selector-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-height: 40px;
        box-sizing: border-box;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.10);
        font-family: var(--font-body);
        font-size: 13px;
        color: rgba(222, 210, 194, 0.92);
        cursor: pointer;
        flex-shrink: 0;
        text-align: left;
      }
      .pip-ready-selector-trigger:hover { background: rgba(255, 255, 255, 0.09); }
      .pip-ready-selector-trigger-name {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pip-ready-selector-chevron {
        flex-shrink: 0;
        width: 10px;
        height: 10px;
        color: rgba(172, 158, 136, 0.80);
        transition: transform 0.15s ease;
      }
      .pip-ready-selector-trigger[aria-expanded="true"] .pip-ready-selector-chevron {
        transform: rotate(180deg);
      }

      /* Trigger + panel share this positioning context, not .pip-screen-ready
         itself — anchoring the panel to calc(100% + 8px) of the WRAP's own
         height (which always equals the trigger's real rendered height,
         since the panel itself is absolute and doesn't contribute to it)
         means the panel always sits just below the trigger regardless of
         how tall the heading/label above it actually render — a fixed
         pixel offset from the screen's own top would silently break if
         either ever wrapped to a second line. */
      .pip-ready-selector-wrap {
        position: relative;
        width: 100%;
        flex-shrink: 0;
      }

      /* Expanded panel — absolutely positioned over the card's own bounds
         (.pip-screen is already position:relative, overflow:hidden clips
         this to the 14px radius), so it never affects window height. Its
         own row list is the one thing inside it allowed to scroll. */
      .pip-ready-selector-panel {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 8px);
        z-index: 30;
        background: #3c3b3f;
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
        max-height: 260px;
        overflow-y: auto;
        overflow-x: hidden;
        box-sizing: border-box;
        padding: 6px 0;
      }
      .pip-ready-selector-group-label {
        font-family: var(--font-body);
        font-size: 9px;
        font-weight: var(--weight-medium);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(172, 158, 136, 0.60);
        padding: 8px 14px 4px;
      }
      .pip-ready-selector-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.08);
        margin: 6px 10px;
      }
      .pip-ready-selector-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        min-height: 40px;
        box-sizing: border-box;
      }
      .pip-ready-selector-row:hover { background: rgba(255, 255, 255, 0.04); }
      .pip-ready-selector-row-radio {
        width: 16px;
        height: 16px;
        accent-color: var(--hanko-fill);
        flex-shrink: 0;
        cursor: pointer;
      }
      .pip-ready-selector-row-name {
        flex: 1;
        min-width: 0;
        font-family: var(--font-body);
        font-size: 13px;
        color: rgba(222, 210, 194, 0.92);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pip-ready-selector-row-note {
        font-family: var(--font-body);
        font-size: 10px;
        color: rgba(172, 158, 136, 0.60);
        padding: 0 14px 6px 40px;
        margin: -6px 0 0;
      }
      /* Delete (saved rows) / discard (the unsaved row) — same restrained
         icon-button treatment either way, distinguished only by which icon
         and aria-label the row supplies. */
      .pip-ready-selector-row-action {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        background: none;
        border: none;
        border-radius: 6px;
        padding: 0;
        color: rgba(172, 158, 136, 0.55);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease, color 0.12s ease, background 0.12s ease;
      }
      .pip-ready-selector-row:hover .pip-ready-selector-row-action,
      .pip-ready-selector-row-action:focus-visible {
        opacity: 1;
      }
      .pip-ready-selector-row-action:hover,
      .pip-ready-selector-row-action:focus-visible {
        color: rgba(222, 210, 194, 0.92);
        background: rgba(255, 255, 255, 0.06);
      }

      /* Contextual actions — text links per the PRD's Button and Action
         System, not full-width pills: uppercase, medium-dark gray, no
         button chrome. Reuses .pip-text-btn's own treatment (already this
         exact pattern, used by Cancel/Back elsewhere) rather than a
         second, near-identical rule. */
      .pip-ready-contextual-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 4px 14px;
        width: 100%;
        min-height: 28px;
        flex-shrink: 0;
      }

      .pip-ready-start-btn {
        width: 100%;
        background: var(--hanko-fill);
        border: none;
        border-radius: 50px;
        padding: 12px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: var(--weight-medium);
        color: rgba(255, 255, 255, 0.92);
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: opacity 0.15s ease;
        box-sizing: border-box;
        min-height: 40px;
        flex-shrink: 0;
      }
      .pip-ready-start-btn:hover { opacity: 0.88; }
      .pip-ready-start-btn:disabled { opacity: 0.5; cursor: default; }

      .pip-ready-disclaimer {
        font-family: var(--font-body);
        font-size: 11px;
        line-height: 1.4;
        color: rgba(172, 158, 136, 0.65);
        text-align: center;
        margin: 0;
        max-width: 260px;
        min-height: 32px;
        flex-shrink: 0;
      }

      /* ── Calibrating (C2) — a live, proportional volume bar and a
         ticking countdown, automatic completion after the configured
         capture duration, and a single visible Cancel action; no manual
         "I'm done" control. Shares the Ready/Welcome/C1/C0 fixed size. ── */
      .pip-screen-calibrating {
        justify-content: center;
        padding: 32px 24px;
        box-sizing: border-box;
        gap: 16px;
      }
      .pip-calibrating-subheading {
        font-family: var(--font-body);
        font-size: 10px;
        letter-spacing: 0.10em;
        text-transform: uppercase;
        color: rgba(172, 158, 136, 0.70);
        text-align: center;
        min-height: 12px;
      }
      .pip-calibrating-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.85);
        text-align: center;
        margin: 0;
        max-width: 250px;
      }
      /* "Listening… 6s" — a live countdown, not a static label; see
         handleCalibrationLevelSample()/the capture-start timer below. */
      .pip-calibrating-status {
        font-family: var(--font-body);
        font-size: 11px;
        color: rgba(210, 155, 75, 0.90);
        text-align: center;
      }
      .pip-calibrating-bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        max-width: 240px;
      }
      /* The PRD's "scale sized to a realistic vocal range" — flanking
         labels rather than tick marks, calmer and legible at this size. */
      .pip-calibrating-bar-scale-label {
        font-family: var(--font-body);
        font-size: 9px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(172, 158, 136, 0.55);
        flex-shrink: 0;
      }
      .pip-calibrating-bar-track {
        flex: 1;
        height: 10px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      .pip-calibrating-bar-fill {
        height: 100%;
        width: 0%;
        background: var(--hanko-fill);
        border-radius: 5px;
        transition: width 0.08s linear;
      }
      .pip-text-btn {
        background: none;
        border: none;
        font-family: var(--font-body);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 8px 14px;
        margin-top: 4px;
        border-radius: 6px;
      }
      .pip-text-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--text-default); }

      /* ── Calibration Failed — calm, specific copy mapped from a stable
         controller failure code (never the raw engine.js message). Try
         Again calls retry() (same mode/target); Back cancels and returns
         to Ready. Microphone-permission denial routes to the dedicated C0
         screen instead — see showFailedScreen() below — so this screen
         only ever renders the other failure codes now. ── */
      .pip-screen-failed {
        justify-content: center;
        padding: 32px 28px;
        box-sizing: border-box;
        gap: 20px;
        text-align: center;
      }
      .pip-failed-message {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.85);
        margin: 0;
        max-width: 250px;
      }

      /* ── Shared full-screen decision vocabulary — M1, M2/M2a, M3, and
         06b (delete confirmation) all share this one visual pattern:
         heading, optional body/warning text, then one or two actions.
         Full-screen per the PRD (never a modal/overlay — see 06b's own
         "do not use a floating dialog" requirement), so each of the four
         gets its own top-level screen element built from this same
         vocabulary rather than four near-duplicate rule sets. ── */
      .pip-screen-decision {
        justify-content: center;
        padding: 28px 24px;
        box-sizing: border-box;
        gap: 14px;
        text-align: center;
      }
      .pip-decision-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.85);
        text-align: center;
        margin: 0;
        max-width: 260px;
      }
      .pip-decision-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.75);
        text-align: center;
        margin: 0;
        max-width: 250px;
      }
      /* M2a's "already exists" warning — calmer than an error tone (a
         name collision is an expected, natural outcome here, not a
         mistake), reused as the associated message for .pip-name-input
         below (see aria-describedby in the DOM). */
      .pip-decision-warning {
        font-family: var(--font-body);
        font-size: 11.5px;
        line-height: 1.4;
        color: rgba(210, 155, 75, 0.90);
        text-align: center;
        margin: 0;
        max-width: 240px;
      }
      .pip-decision-actions { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 230px; }
      .pip-decision-primary-btn {
        width: 100%;
        background: var(--hanko-fill);
        border: none;
        border-radius: 50px;
        padding: 12px;
        font-family: var(--font-body);
        font-size: 12.5px;
        font-weight: var(--weight-medium);
        color: rgba(255, 255, 255, 0.92);
        cursor: pointer;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .pip-decision-primary-btn:hover { opacity: 0.88; }
      .pip-decision-primary-btn:disabled { opacity: 0.5; cursor: default; }
      .pip-decision-secondary-btn {
        width: 100%;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 50px;
        padding: 10px 14px;
        font-family: var(--font-body);
        font-size: 12.5px;
        color: rgba(222, 210, 194, 0.85);
        cursor: pointer;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .pip-decision-secondary-btn:hover { background: rgba(255, 255, 255, 0.12); }

      /* M3 — close icon only, no other action (see the PRD: "no
         management controls appear inside M3"). Reuses the same icon-
         button treatment the selector's own row actions use. */
      .pip-decision-close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 50%;
        color: rgba(222, 210, 194, 0.85);
        cursor: pointer;
      }
      .pip-decision-close-btn:hover { background: rgba(255, 255, 255, 0.12); }

      .pip-name-input {
        width: 100%;
        box-sizing: border-box;
        padding: 11px 14px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.14);
        font-family: var(--font-body);
        font-size: 13px;
        color: rgba(222, 210, 194, 0.95);
      }
      .pip-name-input:focus-visible { outline: 2px solid var(--border-outline); outline-offset: 1px; }

      /* ── Toast — transient save/replace confirmation. A child of
         .pip-layout (sibling to every .pip-screen), not any one screen, so
         it can float above whichever screen is visible without being
         duplicated per screen. Fixed at the card's own bottom edge; never
         shifts surrounding layout (position:absolute, taken out of flow)
         and never intercepts pointer/keyboard input (pointer-events:none —
         it has no interactive content of its own). */
      .pip-toast {
        position: absolute;
        left: 20px;
        right: 20px;
        bottom: 18px;
        z-index: 40;
        display: flex;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .pip-toast.pip-toast-visible { opacity: 1; transform: translateY(0); }
      .pip-toast-card {
        max-width: 100%;
        background: rgba(20, 19, 21, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 50px;
        padding: 9px 18px;
        font-family: var(--font-body);
        font-size: 12px;
        color: rgba(222, 210, 194, 0.95);
        text-align: center;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      }

      /* ── Monitoring screen — the shared title bar at top, circle fills
         the middle and stays the visual hero, restrained bottom control
         bar. The only screen that ever shows the visualization or the
         live zone label, and the only screen with two layouts (Expanded /
         Compact), driven by [data-layout] on <body> — an explicit state,
         never inferred from window size. ── */
      .pip-screen-monitoring {
        justify-content: flex-start;
        position: relative;
      }
      .pip-monitoring-header {
        display: none;
        flex-direction: column;
        flex-shrink: 0;
        width: 100%;
        box-sizing: border-box;
      }
      .pip-monitoring-status-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 24px 0;
      }
      /* The awareness state (Quiet / Within Range / Approaching End of
         Range / Outside Range) is the most prominent text in the header.
         Shared by Expanded and Compact — Compact repositions rather than
         duplicates this element. Color is keyed off data-zone, a purely
         presentational attribute updateHeading() sets alongside the
         existing textContent assignment — the zone-classification and
         label-text logic themselves are untouched. */
      .pip-status-heading {
        font-family: var(--font-body);
        font-size: 11px;
        font-weight: var(--weight-medium);
        color: var(--text-primary);
      }
      .pip-status-heading[data-zone="0"],
      .pip-status-heading[data-zone="1"] { color: var(--zone-quiet-color); }
      .pip-status-heading[data-zone="2"] { color: var(--zone-approaching-color); }
      .pip-status-heading[data-zone="3"] { color: var(--zone-outside-color); }
      .pip-profile-info {
        font-family: var(--font-body);
        font-size: 9px;
        font-weight: var(--weight-light);
        color: rgba(222, 210, 194, 0.58);
        letter-spacing: 0.06em;
      }
      .pip-circle-wrapper {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      /* Bottom control bar — shared by Expanded and Compact. Restrained
         icon+text buttons, never a large full-width primary button; the
         visualization stays the focal point, controls stay discoverable
         but visually secondary. No divider above it — the gap alone reads
         as a separate row without adding extra visual weight. Compact
         repositions individual buttons as corner overlays rather than
         using this as a bar — see below. */
      .pip-monitoring-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px 16px;
        width: 100%;
        box-sizing: border-box;
      }
      .pip-control-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        background: none;
        border: none;
        border-radius: 6px;
        padding: 6px 8px;
        margin: -6px -8px;
        font-family: var(--font-body);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subdued);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .pip-control-btn:hover { background: var(--surface-card); color: var(--text-default); }
      /* Stop/Compact get their own literal typography/color spec rather than
         the shared .pip-control-btn defaults above — Expand (Compact-layout
         only) is intentionally left on the shared defaults, out of scope
         here. Padding grows well past the shared default's hit-area padding,
         so the negative margin grows to match, keeping the same resting
         (non-hover) visual position instead of pushing the row wider. */
      .pip-control-btn-stop,
      .pip-control-btn-compact {
        font-family: var(--font-body);
        font-size: 10px;
        font-weight: var(--weight-medium);
        letter-spacing: 0.10em;
        color: rgba(172, 158, 136, 0.75);
        padding: 10px 16px;
        margin: -10px -16px;
        border-radius: 6px;
      }
      /* Background-only affordance — text/icon color (currentColor-driven
         for the icons) deliberately stays pinned to each button's own
         resting color on hover, no orange accent. Just omitting color
         here does NOT mean "unchanged" — the shared .pip-control-btn:hover
         above still sets it (equal specificity, cascade is per-property,
         not per-rule), so color is re-declared explicitly, matching each
         button's own resting value, to actually cancel that out (caught
         live: hover was still recoloring text/icons even after removing
         the orange color value, because that same fallback rule filled
         the gap). Applies to every control button across both Monitoring
         layouts: Stop/Compact here, Expand below (Compact's own control). */
      .pip-control-btn-stop:hover,
      .pip-control-btn-compact:hover {
        color: rgba(172, 158, 136, 0.75);
        background: rgba(0, 0, 0, 0.36);
        border-radius: 6px;
      }
      .pip-control-btn-expand:hover {
        color: var(--text-subdued);
        background: rgba(0, 0, 0, 0.36);
        border-radius: 6px;
      }
      .pip-control-icon-stop {
        width: 7px;
        height: 7px;
        background: currentColor;
        border-radius: 1px;
        flex-shrink: 0;
      }
      .pip-control-icon-compact {
        width: 14px;
        height: 12px;
        border: 1.5px solid currentColor;
        border-radius: 2px;
        position: relative;
        flex-shrink: 0;
      }
      .pip-control-icon-compact::after {
        content: '';
        position: absolute;
        right: 1.5px;
        top: 3.5px;
        width: 5.5px;
        height: 5px;
        background: currentColor;
        border-radius: 1px;
      }
      .pip-control-icon-expand { width: 14px; height: 14px; flex-shrink: 0; }
      /* Expand only ever appears in Compact — see the [data-layout] rules
         below, which are what actually reveal it. */
      .pip-control-btn-expand { display: none; }

      /* A responsive fallback for the window being manually resized too
         small to fit the header reasonably, not for the fixed default size
         itself — min-width was 300px when MEZZO_COMPANION_EXPANDED_SIZE
         defaulted to 380px (80px of shrink headroom); left unchanged after
         that default became 290px, it would have hidden the header outright
         at the new default and taken the status label/profile text with it
         (caught live, screenshotting the new default size). Lowered to keep
         similar headroom below the new default instead. */
      @media (min-width: 260px) and (min-height: 350px) {
        .pip-monitoring-header { display: flex; }
      }

      /* ── Compact layout — explicit state ([data-layout="compact"]), not
         a media query. Peripheral awareness, but Stop stays reachable: the
         visualization (centered, dominant), Stop (bottom-left corner), and
         Expand (bottom-right corner) are the only persistent content — no
         in-page title bar either (the real Document PiP window chrome
         covers that, same as Expanded), and no status text or profile
         metadata competing for the small space. Stop here is the exact
         same button/handler as Expanded's Stop, just repositioned and
         icon-only — it stops monitoring and returns to Ready, it does not
         close the Companion. The native window-close control remains a
         separate, always-available way to close the Companion outright
         (see handlePipClose). The awareness state stays in the DOM and
         keeps announcing via aria-live for assistive tech; it's just
         visually hidden, not removed, since there's no visible text status
         in Compact. ── */
      /* Compact's card is smaller-radius, single-layer shadow (no inset
         glow) — its own distinct treatment, not just a scaled-down Ready/
         Monitoring card. */
      body[data-layout="compact"] .pip-screen-monitoring {
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.52);
      }
      body[data-layout="compact"] .pip-monitoring-header {
        display: block;
      }
      /* Collapses the block's own padding rather than hiding it outright —
         .pip-status-heading (inside it) needs display other than none to
         keep announcing via aria-live; see below. */
      body[data-layout="compact"] .pip-monitoring-status-block {
        padding: 0;
      }
      body[data-layout="compact"] .pip-profile-info {
        display: none;
      }
      /* Visually hidden, not display:none — screen readers still need
         this element's aria-live announcements even though Compact shows
         no visible status text. */
      body[data-layout="compact"] .pip-status-heading {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      body[data-layout="compact"] .pip-monitoring-controls {
        position: static;
        padding: 0;
      }
      /* Compact-toggle hidden — already in Compact, nothing to switch to. */
      body[data-layout="compact"] .pip-control-btn-compact {
        display: none;
      }
      /* Stop — bottom-left corner overlay, icon-only (its text label is
         hidden below; aria-label already carries the accessible name, same
         as Expand). Same stopMonitoring() click handler as Expanded's Stop
         — this is that exact button repositioned, not a second one — so it
         returns to Ready, it does not close the Companion. */
      body[data-layout="compact"] .pip-control-btn-stop {
        display: flex;
        position: absolute;
        bottom: 8px;
        left: 8px;
        margin: 0;
        padding: 12px;
        border-radius: 6px;
        z-index: 2;
        color: rgba(172, 158, 136, 0.82);
      }
      body[data-layout="compact"] .pip-control-btn-stop span:not(.pip-control-icon-stop) {
        display: none;
      }
      body[data-layout="compact"] .pip-control-icon-stop {
        width: 12px;
        height: 12px;
      }
      body[data-layout="compact"] .pip-control-btn-expand {
        display: flex;
        position: absolute;
        bottom: 8px;
        right: 8px;
        margin: 0;
        padding: 12px;
        border-radius: 6px;
        z-index: 2;
        color: rgba(172, 158, 136, 0.82);
      }
      /* Hover stays background-only here too, same as Expanded — see the
         approved correction above (.pip-control-btn-stop:hover etc.):
         icon color is deliberately pinned to Compact's own default (0.82,
         not Monitoring's 0.75) rather than left to fall through to any
         other rule, so it visibly does NOT change on hover. Scoped with
         [data-layout="compact"] so it doesn't affect Monitoring's own
         hover color. */
      body[data-layout="compact"] .pip-control-btn-stop:hover,
      body[data-layout="compact"] .pip-control-btn-expand:hover {
        color: rgba(172, 158, 136, 0.82);
        background: rgba(0, 0, 0, 0.36);
        border-radius: 6px;
      }
    `;
    pipDoc.head.appendChild(style);

    pipDoc.body.setAttribute('data-surface', 'dark');
    pipDoc.body.setAttribute('data-layout', layoutMode);

    const layout = pipDoc.createElement('div');
    layout.className = 'pip-layout';

    // ── Welcome/01 — reached exactly once, the first time the Companion
    //    opens with zero saved profiles (see enterPipReadyMode()). A
    //    deliberate first moment, not an instant redirect into Calibrating.
    //    Its own primary action goes to C1 (the calibration-introduction
    //    interstitial) — microphone access isn't requested until C1's own
    //    primary action actually starts a calibration. No secondary dismiss
    //    action here (see the PRD's State 01 — it lists none) — closing the
    //    Companion remains available through the native window control
    //    regardless of screen. Reuses Ready's fixed size; no Compact
    //    variant. Copy matches docs/prd/ready-screen-speaking-profiles-mvp.md
    //    and design/prototypes/ready-screen-states.html exactly. ──
    const welcomeScreen = pipDoc.createElement('div');
    welcomeScreen.className = 'pip-screen pip-screen-welcome hidden';

    const welcomeHeading = pipDoc.createElement('h1');
    welcomeHeading.className = 'pip-intro-heading';
    welcomeHeading.textContent = 'Welcome';
    welcomeScreen.appendChild(welcomeHeading);

    const welcomeBody = pipDoc.createElement('p');
    welcomeBody.className = 'pip-intro-body';
    welcomeBody.textContent = "Mezzo listens in the background and gently lets you know if you're talking louder than you'd like. We'll start with a quick voice calibration.";
    welcomeScreen.appendChild(welcomeBody);

    const welcomeDisclaimer = pipDoc.createElement('p');
    welcomeDisclaimer.className = 'pip-intro-disclaimer';
    welcomeDisclaimer.textContent = "Mezzo doesn't record audio or transcribe speech.";
    welcomeScreen.appendChild(welcomeDisclaimer);

    const welcomePrimaryBtn = pipDoc.createElement('button');
    welcomePrimaryBtn.type = 'button';
    welcomePrimaryBtn.className = 'pip-intro-primary-btn';
    welcomePrimaryBtn.innerHTML = `${MIC_ICON_SVG}<span>Create speaking profile</span>`;
    welcomePrimaryBtn.addEventListener('click', handleWelcomeCalibrateClick);
    welcomeScreen.appendChild(welcomePrimaryBtn);

    layout.appendChild(welcomeScreen);
    welcomeScreenEl = welcomeScreen;

    // ── C1 — calibration-introduction interstitial, shown before every
    //    session-mode calibration (see the module doc comment on c1ScreenEl
    //    above for the resolved routing rule). Copy matches
    //    docs/prd/ready-screen-speaking-profiles-mvp.md and
    //    design/prototypes/ready-screen-states.html exactly. ──
    const c1Screen = pipDoc.createElement('div');
    c1Screen.className = 'pip-screen pip-screen-c1 hidden';

    const c1Heading = pipDoc.createElement('h1');
    c1Heading.className = 'pip-intro-heading';
    c1Heading.textContent = 'Create speaking profile';
    c1Screen.appendChild(c1Heading);

    const c1Body = pipDoc.createElement('p');
    c1Body.className = 'pip-intro-body';
    c1Body.textContent = "Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain.";
    c1Screen.appendChild(c1Body);

    const c1PrimaryBtn = pipDoc.createElement('button');
    c1PrimaryBtn.type = 'button';
    c1PrimaryBtn.className = 'pip-intro-primary-btn';
    c1PrimaryBtn.innerHTML = `${MIC_ICON_SVG}<span>I'm ready</span>`;
    c1PrimaryBtn.addEventListener('click', handleC1StartClick);
    c1Screen.appendChild(c1PrimaryBtn);

    // Low-emphasis text link, beneath the primary action — reuses
    // .pip-text-btn, the same established treatment Cancel/Back already use
    // on every other screen (Calibrating, Calibration Failed, C0).
    const c1BackButton = pipDoc.createElement('button');
    c1BackButton.type = 'button';
    c1BackButton.className = 'pip-text-btn';
    c1BackButton.textContent = 'Back';
    c1BackButton.addEventListener('click', handleC1BackClick);
    c1Screen.appendChild(c1BackButton);
    c1BackBtn = c1BackButton;

    layout.appendChild(c1Screen);
    c1ScreenEl = c1Screen;

    // ── C0 — dedicated microphone-blocked screen, reached instead of the
    //    generic Calibration Failed screen specifically for
    //    MIC_PERMISSION_DENIED (see showFailedScreen()). Reuses Failed's own
    //    Try Again/Back handlers — the underlying recovery is identical,
    //    only the explanatory copy/illustration differs. Heading/body match
    //    the PRD/design artifact exactly, with one deliberate change: "then
    //    try again" rather than the PRD's "then reload this page" — this
    //    screen's own in-app Try again action (see below) makes a manual
    //    page reload unnecessary; the PRD's own wording assumed no such
    //    action existed. ──
    const c0Screen = pipDoc.createElement('div');
    c0Screen.className = 'pip-screen pip-screen-c0 hidden';

    const c0Heading = pipDoc.createElement('h1');
    c0Heading.className = 'pip-intro-heading';
    c0Heading.textContent = 'Your browser has blocked microphone access.';
    c0Screen.appendChild(c0Heading);

    const c0Illustration = pipDoc.createElement('div');
    c0Illustration.className = 'pip-c0-illustration';
    c0Illustration.innerHTML = C0_ILLUSTRATION_SVG;
    c0Screen.appendChild(c0Illustration);

    const c0Body = pipDoc.createElement('p');
    c0Body.className = 'pip-intro-body';
    c0Body.textContent = 'Click the icon in your address bar and change the microphone setting to "Allow," then try again.';
    c0Screen.appendChild(c0Body);

    const c0PrimaryBtn = pipDoc.createElement('button');
    c0PrimaryBtn.type = 'button';
    c0PrimaryBtn.className = 'pip-intro-primary-btn';
    c0PrimaryBtn.textContent = 'Try again';
    c0PrimaryBtn.addEventListener('click', handleFailedTryAgain);
    c0Screen.appendChild(c0PrimaryBtn);

    const c0BackBtn = pipDoc.createElement('button');
    c0BackBtn.type = 'button';
    c0BackBtn.className = 'pip-text-btn';
    c0BackBtn.textContent = 'Back';
    c0BackBtn.addEventListener('click', handleFailedBack);
    c0Screen.appendChild(c0BackBtn);

    layout.appendChild(c0Screen);
    c0ScreenEl = c0Screen;

    // ── Ready screen — the approved selector model (see
    //    docs/prd/ready-screen-speaking-profiles-mvp.md). Heading, the
    //    "Speaking profile" label, a collapsed selector trigger that
    //    expands into an overlay panel, contextual actions, Start
    //    monitoring, and the privacy disclaimer — always in that order, a
    //    profile change never restructures the screen. Populated by
    //    renderReadyScreen()/renderSelectorPanel() below, not here — this
    //    only builds the empty skeleton once; content is (re)rendered every
    //    time the screen is (re)shown or the selection changes. ──
    const readyScreen = pipDoc.createElement('div');
    readyScreen.className = 'pip-screen pip-screen-ready';
    // No in-page title bar here either — the real Document PiP window
    // chrome is the only title bar now, in every state (see pipDoc.title
    // in startMonitoring()).

    const readyHeading = pipDoc.createElement('h1');
    readyHeading.className = 'pip-ready-heading';
    readyScreen.appendChild(readyHeading);
    readyHeadingEl = readyHeading;

    const readyLabel = pipDoc.createElement('div');
    readyLabel.className = 'pip-ready-profile-label';
    readyLabel.textContent = 'Speaking profile';
    readyScreen.appendChild(readyLabel);

    // Trigger and panel share one position:relative wrapper (see
    // .pip-ready-selector-wrap's own comment above) — not the whole Ready
    // screen — so the panel always anchors just below the trigger's real
    // rendered position, regardless of how tall the heading/label above it
    // happen to render.
    const selectorWrap = pipDoc.createElement('div');
    selectorWrap.className = 'pip-ready-selector-wrap';
    readyScreen.appendChild(selectorWrap);

    const selectorTrigger = pipDoc.createElement('button');
    selectorTrigger.type = 'button';
    selectorTrigger.className = 'pip-ready-selector-trigger';
    selectorTrigger.setAttribute('aria-haspopup', 'listbox');
    selectorTrigger.setAttribute('aria-expanded', 'false');
    const selectorTriggerName = pipDoc.createElement('span');
    selectorTriggerName.className = 'pip-ready-selector-trigger-name';
    selectorTrigger.appendChild(selectorTriggerName);
    selectorTrigger.insertAdjacentHTML('beforeend', CHEVRON_ICON_SVG);
    selectorTrigger.addEventListener('click', handleSelectorTriggerClick);
    selectorWrap.appendChild(selectorTrigger);
    readySelectorTriggerEl = selectorTrigger;
    readySelectorTriggerNameEl = selectorTriggerName;

    const selectorPanel = pipDoc.createElement('div');
    selectorPanel.className = 'pip-ready-selector-panel hidden';
    selectorPanel.setAttribute('role', 'listbox');
    selectorPanel.setAttribute('aria-label', 'Speaking profiles');
    selectorWrap.appendChild(selectorPanel);
    readySelectorPanelEl = selectorPanel;

    const contextualActions = pipDoc.createElement('div');
    contextualActions.className = 'pip-ready-contextual-actions';
    readyScreen.appendChild(contextualActions);
    readyContextualActionsEl = contextualActions;

    const pipStartBtn = pipDoc.createElement('button');
    pipStartBtn.type = 'button';
    pipStartBtn.className = 'pip-ready-start-btn';
    pipStartBtn.textContent = 'Start monitoring';
    pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
    readyScreen.appendChild(pipStartBtn);
    readyStartBtn = pipStartBtn;

    const readyDisclaimer = pipDoc.createElement('p');
    readyDisclaimer.className = 'pip-ready-disclaimer';
    readyDisclaimer.textContent = "Mezzo doesn't record audio or transcribe speech.";
    readyScreen.appendChild(readyDisclaimer);
    readyDisclaimerEl = readyDisclaimer;

    layout.appendChild(readyScreen);
    readyScreenEl = readyScreen;

    // ── Calibrating (C2) ── (see "Calibration" in docs/product-experience.md)
    const calibratingScreen = pipDoc.createElement('div');
    calibratingScreen.className = 'pip-screen pip-screen-calibrating hidden';

    const calibratingSubheading = pipDoc.createElement('div');
    calibratingSubheading.className = 'pip-calibrating-subheading';
    calibratingSubheading.setAttribute('aria-live', 'polite');
    calibratingScreen.appendChild(calibratingSubheading);
    calibratingSubheadingEl = calibratingSubheading;

    const calibratingHeading = pipDoc.createElement('p');
    calibratingHeading.className = 'pip-calibrating-heading';
    calibratingHeading.textContent = 'Keep speaking at the level you want to maintain';
    calibratingScreen.appendChild(calibratingHeading);

    // Live, non-disruptive countdown — text, not just the bar below, so
    // progress/completion is conveyed to assistive tech too (see the PRD's
    // accessibility requirements: "non-disruptive countdown announcements").
    const calibratingStatus = pipDoc.createElement('div');
    calibratingStatus.className = 'pip-calibrating-status';
    calibratingStatus.setAttribute('aria-live', 'polite');
    calibratingScreen.appendChild(calibratingStatus);
    calibratingStatusEl = calibratingStatus;

    const barRow = pipDoc.createElement('div');
    barRow.className = 'pip-calibrating-bar-row';
    const scaleLow = pipDoc.createElement('span');
    scaleLow.className = 'pip-calibrating-bar-scale-label';
    scaleLow.textContent = 'Quiet';
    scaleLow.setAttribute('aria-hidden', 'true');
    barRow.appendChild(scaleLow);
    const barTrack = pipDoc.createElement('div');
    barTrack.className = 'pip-calibrating-bar-track';
    barTrack.setAttribute('aria-hidden', 'true'); // decorative — progress/completion is conveyed via calibratingStatusEl's text, not this bar
    const barFill = pipDoc.createElement('div');
    barFill.className = 'pip-calibrating-bar-fill';
    barTrack.appendChild(barFill);
    barRow.appendChild(barTrack);
    const scaleHigh = pipDoc.createElement('span');
    scaleHigh.className = 'pip-calibrating-bar-scale-label';
    scaleHigh.textContent = 'Loud';
    scaleHigh.setAttribute('aria-hidden', 'true');
    barRow.appendChild(scaleHigh);
    calibratingScreen.appendChild(barRow);
    calibratingBarFillEl = barFill;

    const calibratingCancelBtn = pipDoc.createElement('button');
    calibratingCancelBtn.type = 'button';
    calibratingCancelBtn.className = 'pip-text-btn';
    calibratingCancelBtn.textContent = 'Cancel';
    calibratingCancelBtn.addEventListener('click', handleCalibratingCancel);
    calibratingScreen.appendChild(calibratingCancelBtn);

    layout.appendChild(calibratingScreen);
    calibratingScreenEl = calibratingScreen;

    // ── Calibration Failed — every failure code except MIC_PERMISSION_DENIED
    //    (which routes to the dedicated C0 screen above instead). ──
    const failedScreen = pipDoc.createElement('div');
    failedScreen.className = 'pip-screen pip-screen-failed hidden';

    const failedMessage = pipDoc.createElement('p');
    failedMessage.className = 'pip-failed-message';
    failedMessage.setAttribute('aria-live', 'assertive');
    failedScreen.appendChild(failedMessage);
    failedMessageEl = failedMessage;

    const failedActions = pipDoc.createElement('div');
    failedActions.className = 'pip-decision-actions';
    const failedTryAgainBtn = pipDoc.createElement('button');
    failedTryAgainBtn.type = 'button';
    failedTryAgainBtn.className = 'pip-decision-primary-btn';
    failedTryAgainBtn.textContent = 'Try Again';
    failedTryAgainBtn.addEventListener('click', handleFailedTryAgain);
    failedActions.appendChild(failedTryAgainBtn);
    failedScreen.appendChild(failedActions);

    const failedBackBtn = pipDoc.createElement('button');
    failedBackBtn.type = 'button';
    failedBackBtn.className = 'pip-text-btn';
    failedBackBtn.textContent = 'Back';
    failedBackBtn.addEventListener('click', handleFailedBack);
    failedScreen.appendChild(failedBackBtn);

    layout.appendChild(failedScreen);
    failedScreenEl = failedScreen;

    // ── M1 — reached only from a saved-profile recalibration's completion
    //    (see handleCalibrationCompleted()). Keep as unsaved first, Replace
    //    second — matches the PRD's own listed action order; Replace is
    //    still the visually primary (filled) action, since it's the more
    //    consequential, "write to the saved profile" outcome. ──
    const m1Screen = pipDoc.createElement('div');
    m1Screen.className = 'pip-screen pip-screen-decision hidden';

    const m1Heading = pipDoc.createElement('p');
    m1Heading.className = 'pip-decision-heading';
    m1Screen.appendChild(m1Heading);
    m1HeadingEl = m1Heading;

    const m1Body = pipDoc.createElement('p');
    m1Body.className = 'pip-decision-body';
    m1Body.textContent = 'Replace the saved calibration with the one you just created?';
    m1Screen.appendChild(m1Body);

    const m1Actions = pipDoc.createElement('div');
    m1Actions.className = 'pip-decision-actions';

    const m1Keep = pipDoc.createElement('button');
    m1Keep.type = 'button';
    m1Keep.className = 'pip-decision-secondary-btn';
    m1Keep.textContent = 'Keep as unsaved';
    m1Keep.addEventListener('click', handleM1KeepAsUnsaved);
    m1Actions.appendChild(m1Keep);
    m1KeepBtn = m1Keep;

    const m1Replace = pipDoc.createElement('button');
    m1Replace.type = 'button';
    m1Replace.className = 'pip-decision-primary-btn';
    m1Replace.textContent = 'Replace';
    m1Replace.addEventListener('click', handleM1Replace);
    m1Actions.appendChild(m1Replace);
    m1ReplaceBtn = m1Replace;

    m1Screen.appendChild(m1Actions);
    layout.appendChild(m1Screen);
    m1ScreenEl = m1Screen;

    // ── M2/M2a — naming a new profile (below the five-profile cap; at cap,
    //    handleSaveProfileClick() routes to M3 instead, never opening this
    //    screen — see the PRD). M2a is this exact same screen with a
    //    warning shown and the submit button's label swapped to "Replace"
    //    (see renderM2State()), not a second screen. ──
    const m2Screen = pipDoc.createElement('div');
    m2Screen.className = 'pip-screen pip-screen-decision hidden';

    const m2Heading = pipDoc.createElement('p');
    m2Heading.className = 'pip-decision-heading';
    m2Heading.textContent = 'Name this profile';
    m2Screen.appendChild(m2Heading);

    const m2Form = pipDoc.createElement('form');
    m2Form.style.cssText = 'width:100%;max-width:230px;display:flex;flex-direction:column;gap:10px;';

    const m2Input = pipDoc.createElement('input');
    m2Input.type = 'text';
    m2Input.className = 'pip-name-input';
    m2Input.maxLength = 40;
    m2Input.placeholder = 'e.g. Coffee Shop';
    m2Input.setAttribute('aria-label', 'Profile name');
    m2Input.addEventListener('input', renderM2State);
    m2Form.appendChild(m2Input);
    m2NameInput = m2Input;

    // Live, non-error-toned warning — an existing-name match is an
    // expected, natural outcome of this flow (see saveProfileNameCopy()),
    // not a validation failure.
    const m2Warning = pipDoc.createElement('p');
    m2Warning.className = 'pip-decision-warning hidden';
    m2Warning.id = 'm2-name-warning';
    m2Warning.setAttribute('aria-live', 'polite');
    m2Form.appendChild(m2Warning);
    m2WarningEl = m2Warning;

    const m2Actions = pipDoc.createElement('div');
    m2Actions.className = 'pip-decision-actions';

    const m2Cancel = pipDoc.createElement('button');
    m2Cancel.type = 'button';
    m2Cancel.className = 'pip-decision-secondary-btn';
    m2Cancel.textContent = 'Cancel';
    m2Cancel.addEventListener('click', handleM2Cancel);
    m2Actions.appendChild(m2Cancel);

    const m2Submit = pipDoc.createElement('button');
    m2Submit.type = 'submit';
    m2Submit.className = 'pip-decision-primary-btn';
    m2Submit.textContent = 'Save';
    m2Actions.appendChild(m2Submit);
    m2SubmitBtn = m2Submit;

    m2Form.appendChild(m2Actions);
    m2Form.addEventListener('submit', handleM2Submit);
    m2Screen.appendChild(m2Form);
    layout.appendChild(m2Screen);
    m2ScreenEl = m2Screen;

    // ── M3 — the five-profile limit. Close-icon-only: no delete/replacement
    //    management inside this screen (see the PRD). ──
    const m3Screen = pipDoc.createElement('div');
    m3Screen.className = 'pip-screen pip-screen-decision hidden';

    const m3Heading = pipDoc.createElement('p');
    m3Heading.className = 'pip-decision-heading';
    m3Heading.textContent = '5 of 5 profiles saved';
    m3Screen.appendChild(m3Heading);

    const m3Body = pipDoc.createElement('p');
    m3Body.className = 'pip-decision-body';
    m3Body.textContent = 'Delete a saved profile before saving this one.';
    m3Screen.appendChild(m3Body);

    const m3Close = pipDoc.createElement('button');
    m3Close.type = 'button';
    m3Close.className = 'pip-decision-close-btn';
    m3Close.setAttribute('aria-label', 'Close');
    m3Close.innerHTML = CLOSE_ICON_SVG;
    m3Close.addEventListener('click', handleM3Close);
    m3Screen.appendChild(m3Close);
    layout.appendChild(m3Screen);
    m3ScreenEl = m3Screen;
    m3CloseBtn = m3Close;

    // ── 06b — saved-profile delete confirmation. A dedicated full-screen
    //    state (never an in-dropdown or browser-native confirmation — see
    //    the PRD), reached from the selector panel's own per-row delete
    //    control (see openDeleteScreen()). ──
    const deleteScreen = pipDoc.createElement('div');
    deleteScreen.className = 'pip-screen pip-screen-decision hidden';

    const deleteHeading = pipDoc.createElement('p');
    deleteHeading.className = 'pip-decision-heading';
    deleteScreen.appendChild(deleteHeading);
    deleteHeadingEl = deleteHeading;

    const deleteBody = pipDoc.createElement('p');
    deleteBody.className = 'pip-decision-body';
    deleteBody.textContent = "This permanently removes the saved speaking profile. This can't be undone.";
    deleteScreen.appendChild(deleteBody);

    const deleteActions = pipDoc.createElement('div');
    deleteActions.className = 'pip-decision-actions';

    const deleteCancel = pipDoc.createElement('button');
    deleteCancel.type = 'button';
    deleteCancel.className = 'pip-decision-secondary-btn';
    deleteCancel.textContent = 'Cancel';
    deleteCancel.addEventListener('click', handleDeleteCancel);
    deleteActions.appendChild(deleteCancel);
    deleteCancelBtn = deleteCancel;

    const deleteConfirmBtnEl = pipDoc.createElement('button');
    deleteConfirmBtnEl.type = 'button';
    deleteConfirmBtnEl.className = 'pip-decision-primary-btn';
    deleteConfirmBtnEl.textContent = 'Delete';
    deleteConfirmBtnEl.addEventListener('click', handleDeleteConfirm);
    deleteActions.appendChild(deleteConfirmBtnEl);
    deleteConfirmBtn = deleteConfirmBtnEl;

    deleteScreen.appendChild(deleteActions);
    layout.appendChild(deleteScreen);
    deleteScreenEl = deleteScreen;

    // ── Toast — a save/replace confirmation, floated above whichever screen
    //    is visible (a sibling of every .pip-screen, not owned by any one of
    //    them — see showToast()). ──
    const toast = pipDoc.createElement('div');
    toast.className = 'pip-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const toastCard = pipDoc.createElement('div');
    toastCard.className = 'pip-toast-card';
    toast.appendChild(toastCard);
    layout.appendChild(toast);
    toastEl = toast;
    toastCardEl = toastCard;

    // ── Monitoring screen (Expanded + Compact share this one DOM tree —
    //    see the [data-layout] CSS above for what each hides/shows) ──
    const monitoringScreen = pipDoc.createElement('div');
    monitoringScreen.className = 'pip-screen pip-screen-monitoring hidden';

    const monitoringHeader = pipDoc.createElement('div');
    monitoringHeader.className = 'pip-monitoring-header';
    // No in-page title bar here (see startMonitoring()'s pipDoc.title) —
    // the real Document PiP window chrome is the only title bar for every
    // Companion state now, Ready included.

    const statusBlock = pipDoc.createElement('div');
    statusBlock.className = 'pip-monitoring-status-block';

    // aria-live so assistive tech hears state changes without the
    // interruption a stronger "assertive" politeness would cause. Shared
    // by Expanded and Compact — Compact visually hides the surrounding
    // status block but keeps this element announcing (see the
    // [data-layout="compact"] CSS).
    const statusHeading = pipDoc.createElement('span');
    statusHeading.className = 'pip-status-heading';
    statusHeading.textContent = zoneLabel(currentZone);
    statusHeading.dataset.zone = String(currentZone);
    statusHeading.setAttribute('aria-live', 'polite');
    statusBlock.appendChild(statusHeading);
    pipStatusHeadingEl = statusHeading;

    const profileInfo = pipDoc.createElement('span');
    profileInfo.className = 'pip-profile-info';
    profileInfo.textContent = profileMetaText(activeProfile);
    statusBlock.appendChild(profileInfo);
    monitoringProfileNameEl = profileInfo;

    monitoringHeader.appendChild(statusBlock);
    monitoringScreen.appendChild(monitoringHeader);

    const circleWrapper = pipDoc.createElement('div');
    circleWrapper.className = 'pip-circle-wrapper';
    monitoringScreen.appendChild(circleWrapper);
    pipCircleWrapperEl = circleWrapper;

    // Control bar — shared by Expanded and Compact. Expanded lays these out
    // as a normal-flow bottom bar (Stop, Compact); Compact repositions Stop
    // as a bottom-left corner overlay (icon-only there), hides the
    // Compact-toggle entirely (already in Compact — nothing to toggle to),
    // and reveals a dedicated Expand control (bottom-right corner) — see
    // the [data-layout="compact"] CSS.
    const controls = pipDoc.createElement('div');
    controls.className = 'pip-monitoring-controls';

    const pipStopBtn = pipDoc.createElement('button');
    pipStopBtn.type = 'button';
    pipStopBtn.className = 'pip-control-btn pip-control-btn-stop';
    pipStopBtn.setAttribute('aria-label', 'Stop Monitoring');
    const stopIcon = pipDoc.createElement('span');
    stopIcon.className = 'pip-control-icon-stop';
    stopIcon.setAttribute('aria-hidden', 'true');
    const stopLabel = pipDoc.createElement('span');
    stopLabel.textContent = 'Stop';
    pipStopBtn.appendChild(stopIcon);
    pipStopBtn.appendChild(stopLabel);
    pipStopBtn.addEventListener('click', stopMonitoring);
    controls.appendChild(pipStopBtn);

    const compactBtn = pipDoc.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'pip-control-btn pip-control-btn-compact';
    const compactIcon = pipDoc.createElement('span');
    compactIcon.className = 'pip-control-icon-compact';
    compactIcon.setAttribute('aria-hidden', 'true');
    const compactLabel = pipDoc.createElement('span');
    compactLabel.textContent = 'Compact';
    compactBtn.appendChild(compactIcon);
    compactBtn.appendChild(compactLabel);
    compactBtn.addEventListener('click', enterCompactLayout);
    controls.appendChild(compactBtn);

    // Compact-only — a familiar expand-window icon in the bottom-right
    // corner, restoring Expanded without stopping monitoring.
    const expandBtn = pipDoc.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'pip-control-btn pip-control-btn-expand';
    expandBtn.setAttribute('aria-label', 'Expand Companion');
    expandBtn.innerHTML =
      '<svg class="pip-control-icon-expand" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<path d="M7.5 1.5H10.5V4.5M4.5 10.5H1.5V7.5M10.5 1.5L6.5 5.5M1.5 10.5L5.5 6.5" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    expandBtn.addEventListener('click', enterExpandedLayout);
    controls.appendChild(expandBtn);

    monitoringScreen.appendChild(controls);

    layout.appendChild(monitoringScreen);
    monitoringScreenEl = monitoringScreen;

    pipDoc.body.appendChild(layout);

    pipWindow.addEventListener('pagehide', handlePipClose);

    // Resolve the active profile from storage — this tab's own selection if
    // any, else whichever saved profile was last used anywhere (see
    // src/profiles.js's resolveActiveProfile()) — rather than requiring the
    // caller to have already chosen one. Home doesn't choose profiles
    // anymore, so this is the only place that resolution now happens.
    // enterPipReadyMode() then decides Welcome vs. Ready from the saved-
    // profile count itself; every open lands there, never straight into
    // Monitoring.
    activeProfile = resolveActiveProfile();
    enterPipReadyMode();

    return true;
  }

  /** Full teardown: stop monitoring, release the mic, close the Companion. */
  function endSession() {
    calibrationController.cancel(); // safe from any status, including idle — covers ending mid-calibration
    if (isMonitoringActive) teardownMonitoringEngine();
    activeCircle = null;
    if (pipWindow) {
      try { pipWindow.close(); } catch { /* ignore */ }
    }
    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  function enterPipMonitoringMode() {
    if (!pipWindow) return;
    if (monitoringProfileNameEl) {
      monitoringProfileNameEl.textContent = profileMetaText(activeProfile);
    }
    // showOnlyScreen(), not a hardcoded "hide Ready, show Monitoring" pair —
    // a historical fix (see CLAUDE.md's Engineering Notes) that stays
    // correct here as more screens were added: it always hides every other
    // top-level screen, not just whichever one happened to be visible
    // before Start monitoring was clicked.
    showOnlyScreen(monitoringScreenEl);
    updateHeading(currentZone);
  }

  /**
   * Starts monitoring in an already-open Companion window, using whichever
   * profile is currently active. Shared by the Companion's own Ready-screen
   * "Start Monitoring" button (subsequent same-day sessions) and
   * startMonitoring()'s first-open path (see below).
   * @returns {Promise<boolean>} whether monitoring actually started
   */
  async function resumeMonitoringFromPipReady() {
    const profile = activeProfile;
    if (!profile) return false; // shouldn't happen — Ready mode always has an active profile

    const ok = await beginMonitoringSession(profile);
    if (!ok) return false; // stay in Ready mode; nothing else to clean up

    if (!pipCircle && pipCircleWrapperEl) {
      pipCircle = new MezzoWaveVisualizer(pipCircleWrapperEl);
    }
    activeCircle = pipCircle;

    // Starting monitoring always begins Expanded — never auto-switches to
    // Compact, even if a previous monitoring session earlier in this same
    // Companion-open lifetime had been left in Compact.
    enterExpandedLayout();
    enterPipMonitoringMode();
    sessionState.set(SESSION_STATES.MONITORING_ACTIVE);
    return true;
  }

  // ===========================================================================
  // Ready screen — the approved selector model. Grouped Unsaved/Saved rows
  // in an overlay panel, contextual text-link actions, and Start monitoring,
  // all re-rendered on every show and every selection change.
  // ===========================================================================

  /** Hides every top-level screen except the given one, and tears down the
   *  Calibrating screen's live-meter subscription and countdown timer
   *  whenever navigating away from it — the one chokepoint every screen
   *  transition passes through, so that cleanup can't be missed by a
   *  handler that forgets to do it. */
  function showOnlyScreen(screenEl) {
    [
      welcomeScreenEl, c1ScreenEl, c0ScreenEl, readyScreenEl, calibratingScreenEl,
      failedScreenEl, m1ScreenEl, m2ScreenEl, m3ScreenEl, deleteScreenEl, monitoringScreenEl,
    ].forEach((el) => {
      if (el) el.classList.toggle('hidden', el !== screenEl);
    });
    if (screenEl !== calibratingScreenEl) {
      if (unsubscribeCalibrationLevel) { unsubscribeCalibrationLevel(); unsubscribeCalibrationLevel = null; }
      stopCalibratingCountdown();
    }
    if (screenEl !== readyScreenEl) closeSelectorPanel();
  }

  /** Reached exactly once per Companion lifetime — the very first open with
   *  zero saved profiles (see enterPipReadyMode()). Maps to the Dock's
   *  "Ready" status, same as the real Ready screen — the Dock doesn't
   *  distinguish Welcome from Ready (see CLAUDE.md's Dock status mapping). */
  function showWelcomeScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(welcomeScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  /** "Create speaking profile" — navigates to C1, the calibration-
   *  introduction interstitial. Microphone permission isn't requested until
   *  C1's own primary action actually starts a calibration (see
   *  handleC1StartClick() -> beginCalibrationFlow() ->
   *  calibrationController.startSessionCalibration() -> audio.acquire()).
   *  Never reached automatically. */
  function handleWelcomeCalibrateClick() {
    showC1Screen('welcome');
  }

  /** @param {'welcome'|'ready'} source - recorded in c1EntrySource so
   *  handleC1BackClick() below knows where to return to. Explicit, not
   *  inferred from saved-profile count or any other mutable state — both
   *  Welcome and Ready can reach C1 while, say, zero saved profiles exist
   *  (Ready can too, if an unsaved profile is already selected there). */
  function showC1Screen(source) {
    if (!pipWindow) return;
    c1EntrySource = source;
    activeCircle = null; // defensive, matching every other screen-show function — never actually non-null here, since C1 is only ever reached before monitoring starts
    showOnlyScreen(c1ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  function handleC1StartClick() {
    beginCalibrationFlow('session', null);
  }

  /** Back — pure navigation, never starts calibration and never touches
   *  activeProfile/unsavedProfile/saved-profile storage/the
   *  first-monitoring flag: C1 itself doesn't mutate any of that (only
   *  beginCalibrationFlow(), never called here, does), so simply not
   *  calling it is what preserves everything. Returns to wherever C1 was
   *  actually opened from (see c1EntrySource) — Welcome, or the same Ready
   *  state (selection and any existing unsaved profile untouched). */
  function handleC1BackClick() {
    if (c1EntrySource === 'welcome') {
      showWelcomeScreen();
    } else {
      showReadyScreen();
    }
    c1EntrySource = null;
  }

  /** Dedicated microphone-blocked screen — reused Try Again/Back handlers
   *  are identical to the generic Failed screen's (see handleFailedTryAgain/
   *  handleFailedBack below); only the explanatory copy/illustration
   *  differs, so no separate C0 handlers exist. */
  function showC0Screen() {
    activeCircle = null; // defensive, matching every other screen-show function — never actually non-null here, since C0 is only ever reached before monitoring starts
    showOnlyScreen(c0ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_NEEDS_ATTENTION);
  }

  /** Raw Ready renderer — always shows Ready, never auto-redirects, even if
   *  the saved-profile library happens to be empty (a normal, valid Ready
   *  presentation as long as an unsaved profile exists). Used by every path
   *  that must not risk re-triggering the Welcome redirect below —
   *  Cancel/Back from Calibrating, Calibration Failed, and every decision
   *  state, and Stop. See enterPipReadyMode() for the "smart" entry point. */
  function showReadyScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(readyScreenEl);
    renderReadyScreen();
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  /** Smart Ready entry point — used by every real "we no longer have an
   *  active session, show the next screen" moment: startMonitoring()'s
   *  first (and every) open. Zero saved profiles AND no unsaved profile
   *  shows Welcome — a deliberate first moment, never an instant
   *  auto-calibrate redirect — per the product model: there is no built-in,
   *  uncalibrated default profile, so a user with nothing usable yet has
   *  exactly one path in, but they choose to take it. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    if (getSavedProfiles().length === 0 && !unsavedProfile) {
      showWelcomeScreen();
      return;
    }
    showReadyScreen();
  }

  /** Two saved-vs-temporary profiles are "the same" for selection/radio
   *  purposes only if both are temporary (there is only ever one unsaved
   *  profile slot at a time — see unsavedProfile's own doc comment) or both
   *  are the same saved id. Never compares by reference alone: activeProfile
   *  and a freshly-read getSavedProfiles() entry describing the same saved
   *  profile are different object instances. */
  function isSameProfile(a, b) {
    if (!a || !b) return a === b;
    if (isTemporaryProfile(a) || isTemporaryProfile(b)) return isTemporaryProfile(a) && isTemporaryProfile(b);
    return a.id === b.id;
  }

  /** Re-renders the heading, selector trigger, and contextual actions from
   *  current state — saved profiles can change between visits (one saved,
   *  deleted, or recalibrated elsewhere), so this always reads fresh rather
   *  than diffing. */
  function renderReadyScreen() {
    if (!readyScreenEl || !pipDocument) return;

    // First-conversation heading — a one-way, persisted flag; see
    // setHasStartedMonitoring()'s own call site (beginMonitoringSession())
    // for the only place it's ever set.
    if (readyHeadingEl) {
      readyHeadingEl.textContent = getHasStartedMonitoring()
        ? 'Ready for your next conversation.'
        : 'Ready for your first conversation.';
    }

    // Re-resolve the active selection fresh — a saved profile may have been
    // deleted elsewhere, or this may be the first render after a
    // calibration just produced a new unsaved profile.
    const saved = getSavedProfiles();
    const stillValid = (isTemporaryProfile(activeProfile) && unsavedProfile) || saved.some((p) => p.id === activeProfile?.id);
    if (!stillValid) {
      activeProfile = unsavedProfile ?? saved[0] ?? null;
    }

    renderSelectorTrigger();
    renderContextualActions();
    if (readyStartBtn) readyStartBtn.disabled = !activeProfile;
  }

  function renderSelectorTrigger() {
    if (!readySelectorTriggerNameEl) return;
    readySelectorTriggerNameEl.textContent = activeProfile
      ? (isTemporaryProfile(activeProfile) ? 'Unsaved profile' : activeProfile.name)
      : 'Select a speaking profile';
  }

  /** Contextual actions directly beneath the selector — never the old
   *  always-visible pills; text links whose set depends only on whether the
   *  current selection is the unsaved profile (§5) or a saved one (§6). A
   *  profile change re-renders this in place; the surrounding screen layout
   *  never restructures. */
  function renderContextualActions() {
    if (!readyContextualActionsEl || !pipDocument) return;
    readyContextualActionsEl.innerHTML = '';
    if (!activeProfile) return;

    if (isTemporaryProfile(activeProfile)) {
      readyContextualActionsEl.appendChild(buildActionLink('Recalibrate', handleUnsavedRecalibrateClick));
      readyContextualActionsEl.appendChild(buildActionLink('Save profile', handleSaveProfileClick));
    } else {
      readyContextualActionsEl.appendChild(buildActionLink('Recalibrate', handleSavedRecalibrateClick));
      const atCap = getSavedProfiles().length >= MAX_SAVED_PROFILES;
      if (!atCap) {
        readyContextualActionsEl.appendChild(buildActionLink('Create new profile', handleCreateNewProfileClick));
      }
    }
  }

  function buildActionLink(text, onClick) {
    const btn = pipDocument.createElement('button');
    btn.type = 'button';
    btn.className = 'pip-text-btn';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Selector — collapsed trigger + overlay panel (grouped Unsaved/Saved rows)
  // ---------------------------------------------------------------------------

  function handleSelectorTriggerClick() {
    if (selectorExpanded) closeSelectorPanel();
    else openSelectorPanel();
  }

  function openSelectorPanel() {
    if (!readySelectorPanelEl || !readySelectorTriggerEl || !pipDocument) return;
    renderSelectorPanel();
    readySelectorPanelEl.classList.remove('hidden');
    readySelectorTriggerEl.setAttribute('aria-expanded', 'true');
    selectorExpanded = true;
    pipDocument.addEventListener('click', handleSelectorOutsideClick, true);
    pipDocument.addEventListener('keydown', handleSelectorKeydown, true);
  }

  function closeSelectorPanel() {
    selectorExpanded = false;
    readySelectorPanelEl?.classList.add('hidden');
    readySelectorTriggerEl?.setAttribute('aria-expanded', 'false');
    pipDocument?.removeEventListener('click', handleSelectorOutsideClick, true);
    pipDocument?.removeEventListener('keydown', handleSelectorKeydown, true);
  }

  function handleSelectorOutsideClick(event) {
    if (!readySelectorPanelEl || !readySelectorTriggerEl) return;
    if (readySelectorPanelEl.contains(event.target) || readySelectorTriggerEl.contains(event.target)) return;
    closeSelectorPanel();
  }

  function handleSelectorKeydown(event) {
    if (event.key === 'Escape') {
      closeSelectorPanel();
      readySelectorTriggerEl?.focus();
    }
  }

  /** Rebuilds the panel's rows from current storage — Unsaved first (if one
   *  exists), a divider, then Saved profiles — grouped with programmatic
   *  labels for assistive tech (see the PRD's accessibility requirements),
   *  not just a visual heading. */
  function renderSelectorPanel() {
    if (!readySelectorPanelEl || !pipDocument) return;
    readySelectorPanelEl.innerHTML = '';
    const saved = getSavedProfiles();

    if (unsavedProfile) {
      const unsavedLabel = pipDocument.createElement('div');
      unsavedLabel.className = 'pip-ready-selector-group-label';
      unsavedLabel.textContent = 'Unsaved';
      readySelectorPanelEl.appendChild(unsavedLabel);

      readySelectorPanelEl.appendChild(buildSelectorRow(unsavedProfile, {
        label: 'Unsaved profile',
        actionLabel: 'Discard unsaved profile',
        onAction: () => handleDiscardUnsaved(),
      }));

      const note = pipDocument.createElement('div');
      note.className = 'pip-ready-selector-row-note';
      note.textContent = 'Disappears when you close Mezzo';
      readySelectorPanelEl.appendChild(note);

      if (saved.length > 0) {
        const divider = pipDocument.createElement('div');
        divider.className = 'pip-ready-selector-divider';
        readySelectorPanelEl.appendChild(divider);
      }
    }

    if (saved.length > 0) {
      const savedLabel = pipDocument.createElement('div');
      savedLabel.className = 'pip-ready-selector-group-label';
      savedLabel.textContent = 'Saved profiles';
      readySelectorPanelEl.appendChild(savedLabel);

      saved.forEach((profile) => {
        readySelectorPanelEl.appendChild(buildSelectorRow(profile, {
          label: profile.name,
          actionLabel: `Delete ${profile.name} profile`,
          onAction: (triggerBtn) => openDeleteScreen(profile, triggerBtn),
        }));
      });
    }
  }

  function buildSelectorRow(profile, { label, actionLabel, onAction }) {
    const row = pipDocument.createElement('div');
    row.className = 'pip-ready-selector-row';

    const radio = pipDocument.createElement('input');
    radio.type = 'radio';
    radio.name = 'ready-selector-profile';
    radio.className = 'pip-ready-selector-row-radio';
    const rowId = `ready-selector-${profile.id ?? 'unsaved'}`;
    radio.id = rowId;
    radio.checked = isSameProfile(profile, activeProfile);
    radio.addEventListener('change', () => handleSelectorRowChange(profile));
    row.appendChild(radio);

    const rowLabel = pipDocument.createElement('label');
    rowLabel.className = 'pip-ready-selector-row-name';
    rowLabel.setAttribute('for', rowId);
    rowLabel.textContent = label;
    rowLabel.title = label;
    row.appendChild(rowLabel);

    const actionBtn = pipDocument.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'pip-ready-selector-row-action';
    actionBtn.setAttribute('aria-label', actionLabel);
    actionBtn.innerHTML = TRASH_ICON_SVG;
    actionBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      onAction(actionBtn);
    });
    row.appendChild(actionBtn);

    return row;
  }

  /** Selecting a row updates selection, closes the selector, and updates
   *  contextual actions — it never starts monitoring and never deletes or
   *  discards anything else. */
  function handleSelectorRowChange(profile) {
    activeProfile = profile;
    if (!isTemporaryProfile(profile)) setSelectedProfile(profile);
    closeSelectorPanel();
    renderSelectorTrigger();
    renderContextualActions();
    if (readyStartBtn) readyStartBtn.disabled = !activeProfile;
  }

  // ---------------------------------------------------------------------------
  // Fallback selection — shared by Discard (§10) and Delete (§11)
  // ---------------------------------------------------------------------------

  /** "Most-recently-used" among `savedProfiles`: this tab's own last-used
   *  signal first (see src/profiles.js's getLastUsedProfile()), then this
   *  tab's own current selection if it's a saved profile still in the list,
   *  then simply the first remaining profile. */
  function pickFallbackSavedProfile(savedProfiles) {
    if (savedProfiles.length === 0) return null;
    const lastUsed = getLastUsedProfile();
    if (lastUsed && savedProfiles.some((p) => p.id === lastUsed.id)) return lastUsed;
    const selected = getSelectedProfile();
    if (selected && !isTemporaryProfile(selected) && savedProfiles.some((p) => p.id === selected.id)) return selected;
    return savedProfiles[0];
  }

  /** Delete's own fallback order (§11): unsaved profile first if one
   *  exists, then the most-recently-used remaining saved profile, then null
   *  (caller routes to Welcome). */
  function pickFallbackProfile(remainingSaved) {
    if (unsavedProfile) return unsavedProfile;
    return pickFallbackSavedProfile(remainingSaved);
  }

  /** Discard — no confirmation (§10). Drops the unsaved profile entirely;
   *  nothing was ever written to storage for it, so there is nothing to
   *  undo, only the in-memory reference to forget. */
  function handleDiscardUnsaved() {
    unsavedProfile = null;
    const saved = getSavedProfiles();
    const fallback = pickFallbackSavedProfile(saved);
    activeProfile = fallback;
    closeSelectorPanel();
    if (fallback) {
      if (!isTemporaryProfile(fallback)) setSelectedProfile(fallback);
      showReadyScreen();
    } else {
      showWelcomeScreen();
    }
  }

  // ---------------------------------------------------------------------------
  // 06b — saved-profile delete confirmation (full-screen, never a modal)
  // ---------------------------------------------------------------------------

  function openDeleteScreen(profile, triggerBtn) {
    if (!pipWindow) return;
    pendingDeleteProfileId = profile.id;
    decisionTriggerEl = triggerBtn ?? null;
    if (deleteHeadingEl) deleteHeadingEl.textContent = `Delete "${profile.name}"?`;
    closeSelectorPanel();
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(deleteScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => deleteCancelBtn?.focus());
  }

  function handleDeleteCancel() {
    pendingDeleteProfileId = null;
    showReadyScreen();
    restoreDecisionFocus();
  }

  /** Confirm — removes the profile from storage, repairs any stored
   *  reference that pointed at it (this tab's selection, the cross-tab
   *  last-used profile — see CLAUDE.md's Profile Model: no stored reference
   *  should ever point at a missing profile), and falls back per §11: the
   *  unsaved profile if one exists, else the most-recently-used remaining
   *  saved profile, else Welcome. */
  function handleDeleteConfirm() {
    if (!pendingDeleteProfileId) return;
    const deletedId = pendingDeleteProfileId;
    runDecisionCommit(deleteConfirmBtn, 'Deleting…', () => {
      const remaining = getSavedProfiles().filter((p) => p.id !== deletedId);
      saveSavedProfiles(remaining);

      if (getSelectedProfile()?.id === deletedId) setSelectedProfile(null);
      if (getLastUsedProfile()?.id === deletedId) clearLastUsedProfile();

      pendingDeleteProfileId = null;

      if (activeProfile?.id === deletedId) {
        activeProfile = pickFallbackProfile(remaining);
      }

      if (!activeProfile) {
        enterPipReadyMode(); // re-resolves fresh: Welcome if nothing usable is left
      } else {
        showReadyScreen();
      }
      restoreDecisionFocus();
    });
  }

  // ---------------------------------------------------------------------------
  // Contextual-action click handlers
  // ---------------------------------------------------------------------------

  function handleSavedRecalibrateClick() {
    if (!activeProfile?.id) return; // defensive — only reachable with a saved profile selected
    beginCalibrationFlow('recalibrate', activeProfile.id);
  }

  /** Recalibrating the unsaved profile itself is just another session-mode
   *  calibration — handleCalibrationCompleted() below always replaces
   *  unsavedProfile wholesale on completion, satisfying "at most one unsaved
   *  profile at a time" without this needing to special-case anything. */
  function handleUnsavedRecalibrateClick() {
    beginCalibrationFlow('session', null);
  }

  /** Create new profile — routes through C1 first, same as Welcome's own
   *  first-time entry (see the PRD's §12 State Transitions: "02 → C1 → C2 →
   *  04"). Unlike Recalibrate, this is creating a brand-new profile from
   *  scratch, so it keeps the instructional interstitial rather than
   *  skipping straight to Calibrating. */
  function handleCreateNewProfileClick() {
    showC1Screen('ready');
  }

  /** Save profile — below cap opens M2; at cap goes straight to M3, never
   *  opening M2 at all (§5/§9). */
  function handleSaveProfileClick(event) {
    if (!unsavedProfile) return;
    const atCap = getSavedProfiles().length >= MAX_SAVED_PROFILES;
    const triggerBtn = event?.currentTarget ?? null;
    if (atCap) showM3Screen(triggerBtn);
    else showM2Screen(triggerBtn);
  }

  // ===========================================================================
  // Calibrating (C2) / Calibration Failed / C0 — driven by the shared
  // calibration controller (src/calibration-controller.js). This module owns
  // none of the calibration business logic or storage writes itself — it
  // only renders the controller's state and calls its methods.
  // ===========================================================================

  // Set only when the most recent Failed screen was shown because
  // calibrationLock.acquire() was rejected (another tab holds it), not
  // because the controller itself failed — see beginCalibrationFlow() and
  // handleFailedTryAgain() below. In that one case, no controller run ever
  // started (mode/targetProfileId were never handed to the controller), so
  // "Try Again" must re-attempt the lock via beginCalibrationFlow() itself
  // rather than calling calibrationController.retry(), which would throw
  // (there is nothing to retry — status is still 'idle').
  let pendingLockedAttempt = null;

  /**
   * Starts a calibration run (session or recalibrate) and shows the
   * Calibrating screen. Synchronous startXxx() misuse errors (an unknown
   * recalibration target, or calling this while already calibrating) are
   * caught here and fall back to Ready — actual calibration failures
   * (silence, unstable environment, mic permission) are not exceptions,
   * they arrive asynchronously via the controller's own state and are
   * handled by the subscribe() listener set up right after this module
   * creates calibrationController.
   */
  function beginCalibrationFlow(mode, targetProfileId) {
    if (!pipWindow) return;

    // Checked first, before any Calibrating-screen setup or mic/controller
    // involvement — a rejection here means a different tab genuinely holds
    // the cross-tab lease right now (see src/calibration-lock.js), so this
    // attempt goes straight to the Failed screen instead of ever flashing
    // Calibrating.
    if (!calibrationLock.acquire()) {
      pendingLockedAttempt = { mode, targetProfileId };
      showFailedScreen({ code: 'CROSS_TAB_LOCKED' });
      return;
    }
    pendingLockedAttempt = null;

    const targetName = targetProfileId
      ? getSavedProfiles().find((p) => p.id === targetProfileId)?.name ?? null
      : null;

    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE); // Calibrating shares Ready's fixed size — see CLAUDE.md's Companion sizes
    activeCircle = null;

    if (calibratingSubheadingEl) {
      calibratingSubheadingEl.textContent = mode === 'recalibrate' && targetName ? `Recalibrating ${targetName}` : '';
    }
    if (calibratingBarFillEl) calibratingBarFillEl.style.width = '0%';
    startCalibratingCountdown();
    showOnlyScreen(calibratingScreenEl);
    unsubscribeCalibrationLevel = calibrationController.subscribeToLevel(handleCalibrationLevelSample);
    sessionState.set(SESSION_STATES.COMPANION_CALIBRATING);

    try {
      if (mode === 'recalibrate') {
        calibrationController.startRecalibration(targetProfileId);
      } else {
        calibrationController.startSessionCalibration();
      }
    } catch (err) {
      console.error('[Session] Could not start calibration:', err.message);
      calibrationLock.release(); // acquired above, but the controller never actually started
      showReadyScreen();
    }
  }

  /** Live "Listening… {n}s" countdown — text, not just the bar, so
   *  progress/completion is conveyed to assistive tech too. Purely a
   *  presentational countdown; the controller's own capture timer (see
   *  calibration-controller.js's DEFAULT_CAPTURE_DURATION_MS) is the actual
   *  source of truth for when capture ends. */
  function startCalibratingCountdown() {
    stopCalibratingCountdown();
    let remaining = CALIBRATION_COUNTDOWN_SECONDS;
    if (calibratingStatusEl) calibratingStatusEl.textContent = `Listening… ${remaining}s`;
    calibratingCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (calibratingStatusEl) calibratingStatusEl.textContent = remaining > 0 ? `Listening… ${remaining}s` : 'Almost done…';
      if (remaining <= 0) stopCalibratingCountdown();
    }, 1000);
  }

  function stopCalibratingCountdown() {
    if (calibratingCountdownTimer) { clearInterval(calibratingCountdownTimer); calibratingCountdownTimer = null; }
  }

  function handleCalibrationLevelSample(rms) {
    if (!calibratingBarFillEl) return;
    const db = 20 * Math.log10(rms + 1e-10);
    const energy = Math.min(1, Math.max(0, (db - CALIBRATION_METER_DB_MIN) / (CALIBRATION_METER_DB_MAX - CALIBRATION_METER_DB_MIN)));
    calibratingBarFillEl.style.width = `${Math.round(energy * 100)}%`;
  }

  function handleCalibratingCancel() {
    calibrationController.cancel();
    showReadyScreen();
  }

  /** MIC_PERMISSION_DENIED routes to the dedicated C0 screen instead of the
   *  generic Failed screen — every other failure code renders here. */
  function showFailedScreen(failure) {
    if (failure?.code === 'MIC_PERMISSION_DENIED') {
      showC0Screen();
      return;
    }
    if (failedMessageEl) failedMessageEl.textContent = calibrationFailureMessage(failure);
    showOnlyScreen(failedScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_NEEDS_ATTENTION);
  }

  /** Try Again — retry() re-enters the same mode and, in recalibrate mode,
   *  the same target, so this alone is what keeps session mode session and
   *  recalibration targeted at the same saved profile across a retry. When
   *  the Failed/C0 screen is showing because of a cross-tab lock rejection
   *  (pendingLockedAttempt set), no controller run ever started, so this
   *  re-attempts via beginCalibrationFlow() — re-checking the lock fresh —
   *  instead of calling retry(), which would throw from an idle controller.
   *  Shared by both the generic Failed screen and C0 — see their DOM
   *  construction above. */
  function handleFailedTryAgain() {
    if (pendingLockedAttempt) {
      const { mode, targetProfileId } = pendingLockedAttempt;
      beginCalibrationFlow(mode, targetProfileId);
      return;
    }
    try {
      calibrationController.retry();
    } catch (err) {
      console.error('[Session] Could not retry calibration:', err.message);
      calibrationController.cancel();
      showReadyScreen();
    }
  }

  /** Shared by both the generic Failed screen and C0. */
  function handleFailedBack() {
    calibrationController.cancel();
    showReadyScreen();
  }

  // ===========================================================================
  // Calibration completion — session mode lands directly on Ready with the
  // freshly-calibrated unsaved profile selected (see §5's Unsaved-Profile
  // Ready States); recalibrate mode shows M1 (§7), since it targets an
  // existing saved profile whose calibration the user must explicitly choose
  // to replace or keep separate. Nothing is persisted merely by reaching
  // this handler — the saved profile a recalibration targeted stays
  // untouched until M1's own commit handlers below.
  // ===========================================================================

  function handleCalibrationCompleted(state) {
    if (state.mode === 'recalibrate') {
      showM1Screen();
      return;
    }
    // commitStartMonitoring() only produces the temporary-profile object and
    // resets the controller to idle here — it does not itself start
    // monitoring (see its own doc comment in calibration-controller.js);
    // reused rather than duplicating that object construction.
    const temp = calibrationController.commitStartMonitoring();
    unsavedProfile = temp;
    activeProfile = temp;
    showReadyScreen();
  }

  // ===========================================================================
  // M1 — reached only from a saved-profile recalibration's completion.
  // ===========================================================================

  function showM1Screen() {
    if (!pipWindow) return;
    // M1 is never reached from a synchronous click on Ready — a real ~6s
    // calibration capture sits in between — so there is no real "the button
    // that opened this" to capture; decisionTriggerEl is left unset here,
    // and restoreDecisionFocus() below falls back to the selector trigger.
    const targetName = calibrationController.getTargetSnapshot()?.name;
    const copy = replaceProfileCopy(targetName);
    if (m1HeadingEl) m1HeadingEl.textContent = copy.heading;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(m1ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => m1ReplaceBtn?.focus());
  }

  /** Replace — writes the recalibration to the targeted saved profile,
   *  preserving its id/name/library position (the same updateSavedProfile()
   *  Recalibrate's own commit path always used). Falls back safely to Ready
   *  if the target was deleted elsewhere mid-calibration (commitError). */
  function handleM1Replace() {
    runDecisionCommit(m1ReplaceBtn, 'Replacing…', () => {
      const updated = calibrationController.commitUpdateProfile();
      if (updated) {
        activeProfile = updated;
        setSelectedProfile(updated);
      }
      showReadyScreen();
      restoreDecisionFocus();
    });
  }

  /** Keep as unsaved — the saved profile this attempt targeted is left
   *  completely untouched; the new calibration becomes a fresh unsaved
   *  profile instead (see commitKeepAsUnsaved() in calibration-controller.js). */
  function handleM1KeepAsUnsaved() {
    runDecisionCommit(m1KeepBtn, 'Keeping…', () => {
      const temp = calibrationController.commitKeepAsUnsaved();
      unsavedProfile = temp;
      activeProfile = temp;
      showReadyScreen();
      restoreDecisionFocus();
    });
  }

  // ===========================================================================
  // M2/M2a — naming (or explicitly replacing) a new saved profile from the
  // current unsaved profile.
  // ===========================================================================

  function showM2Screen(triggerBtn) {
    if (!pipWindow || !unsavedProfile) return;
    decisionTriggerEl = triggerBtn ?? null;
    if (m2NameInput) m2NameInput.value = '';
    renderM2State();
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(m2ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => m2NameInput?.focus());
  }

  /** Renders purely from resolveSavePromptAction(name)'s current outcome —
   *  the one place M2/M2a's warning text and button label/enabled state are
   *  decided (see saveProfileNameCopy()). Called on every keystroke (live
   *  preview) and once when the screen first opens. */
  function renderM2State() {
    if (!m2NameInput) return;
    const resolution = resolveSavePromptAction(m2NameInput.value);
    const copy = saveProfileNameCopy(resolution);

    if (m2SubmitBtn) {
      m2SubmitBtn.disabled = copy.disabled;
      m2SubmitBtn.textContent = copy.buttonLabel;
    }
    if (m2WarningEl) {
      m2WarningEl.textContent = copy.warningText;
      m2WarningEl.classList.toggle('hidden', !copy.warningText);
    }
    m2NameInput.setAttribute('aria-describedby', copy.warningText ? 'm2-name-warning' : '');
  }

  function handleM2Cancel() {
    showReadyScreen();
    restoreDecisionFocus();
  }

  /** Commits the naming step — creates a new profile for a unique name, or
   *  explicitly replaces the matching existing profile's calibration for a
   *  name that already exists (see commitSavePromptName() in profiles.js,
   *  which re-resolves the outcome fresh rather than trusting whatever
   *  renderM2State() last rendered). decisionCommitInFlight guards against a
   *  double Enter/click re-entering this handler mid-processing. */
  function handleM2Submit(event) {
    event.preventDefault();
    if (decisionCommitInFlight) return;
    const name = m2NameInput?.value ?? '';
    if (!name.trim() || !unsavedProfile) return;

    const isUpdate = resolveSavePromptAction(name).kind === SAVE_PROMPT_ACTIONS.UPDATE;
    runDecisionCommit(m2SubmitBtn, isUpdate ? 'Replacing…' : 'Saving…', () => {
      const { profile, error } = commitSavePromptName(unsavedProfile, name);

      if (!profile) {
        // Blocked (limit reached) or, vanishingly rarely, a same-instant
        // deletion race — either way, re-render the live state so the UI
        // self-corrects to match reality instead of silently doing nothing.
        renderM2State();
        if (m2WarningEl && error?.message) { m2WarningEl.textContent = error.message; m2WarningEl.classList.remove('hidden'); }
        return;
      }

      setSelectedProfile(profile);
      setLastUsedProfile(profile);
      activeProfile = profile;
      unsavedProfile = null;
      showReadyScreen();
      showToast(isUpdate ? `Profile "${profile.name}" replaced` : `Profile "${profile.name}" saved`);
      restoreDecisionFocus();
    });
  }

  // ===========================================================================
  // M3 — the five-profile limit.
  // ===========================================================================

  function showM3Screen(triggerBtn) {
    if (!pipWindow) return;
    decisionTriggerEl = triggerBtn ?? null;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(m3ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => m3CloseBtn?.focus());
  }

  function handleM3Close() {
    showReadyScreen();
    restoreDecisionFocus();
  }

  // ===========================================================================
  // Shared decision-state processing/focus/toast helpers
  // ===========================================================================

  /** Brief processing state (§12) on a decision screen's affirmative
   *  button: disables it, swaps its label, then runs the actual commit
   *  after a short delay. decisionCommitInFlight is the shared reentrancy
   *  guard — only one decision screen is ever visible at a time, so one
   *  flag is enough. Deliberately does not restore the button's own label
   *  afterward — every commitFn either navigates away (making the old label
   *  moot) or, on a failure it wants to stay on-screen for, calls its own
   *  render function to set the correct label itself. */
  function runDecisionCommit(button, processingLabel, commitFn) {
    if (decisionCommitInFlight) return;
    decisionCommitInFlight = true;
    if (button) { button.disabled = true; button.textContent = processingLabel; }
    setTimeout(() => {
      decisionCommitInFlight = false;
      // The Companion (and everything module-level state a commitFn reads —
      // unsavedProfile, activeProfile, every DOM ref) may have been closed
      // and torn down by handlePipClose() during this delay — this module
      // runs in the opener tab's own JS realm, so this pending timer is not
      // cancelled just because the PiP window closed. Bail out rather than
      // running a commitFn against already-nulled state (e.g.
      // commitSavePromptName() throwing on a null unsavedProfile) — there is
      // no Companion left to show the result in anyway.
      if (!pipWindow) return;
      commitFn();
    }, DECISION_PROCESSING_MS);
  }

  /** Restores focus to whichever contextual-action/row button opened the
   *  decision state that just closed (§14's focus-restoration requirement) —
   *  a no-op if that element is no longer in the DOM (e.g. the row it
   *  belonged to was just rebuilt). */
  /**
   * The captured trigger isn't always still a valid focus target by the
   * time this runs: M2/M3 are opened from a contextual-action button that
   * renderContextualActions() unconditionally rebuilds (innerHTML = '') on
   * every showReadyScreen() — already called, just before this, by every
   * caller — so that exact DOM node no longer exists. 06b's trigger (a row
   * inside the selector panel) does still exist, but closeSelectorPanel()
   * left its whole panel display:none, so it's unfocusable even though it's
   * still attached. Falls back to the selector trigger — always present,
   * never rebuilt, and a logical landing spot regardless of which decision
   * state just closed — whenever the original isn't a real, visible target.
   */
  function restoreDecisionFocus() {
    const isFocusable = decisionTriggerEl?.isConnected && decisionTriggerEl.offsetParent !== null;
    const target = isFocusable ? decisionTriggerEl : readySelectorTriggerEl;
    target?.focus?.();
    decisionTriggerEl = null;
  }

  /** Save/replace confirmation toast (§12) — never shifts layout
   *  (position:absolute, out of flow) and never steals focus (no focus()
   *  call here); a polite aria-live region announces it instead. */
  function showToast(message) {
    if (!toastEl || !toastCardEl) return;
    toastCardEl.textContent = message;
    toastEl.classList.add('pip-toast-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      toastEl?.classList.remove('pip-toast-visible');
      toastHideTimer = null;
    }, TOAST_VISIBLE_MS);
  }

  function handlePipClose() {
    const wasActive = isMonitoringActive; // capture before teardownMonitoringEngine clears it
    const wasTemporary = isTemporaryProfile(activeProfile);

    // Covers every state the Companion could have been in when it closed —
    // idle/Ready (a harmless no-op), mid-Calibrating (stops capture,
    // releases the mic, discards whatever partial samples existed), or
    // Calibrated-but-uncommitted (discards the uncommitted result — nothing
    // was ever written to storage for it). close(), not cancel(): this is
    // specifically the native-window-close trigger, not a user clicking a
    // Cancel/Back button — same underlying cleanup, distinct call site for
    // what it's worth in logs.
    calibrationController.close();
    // Defensive symmetry with every other exit from the selector, even
    // though the PiP document (and its listeners) is about to be discarded
    // with the window regardless — see closeSelectorPanel()'s own
    // unconditional removeEventListener calls, safe as a no-op either way.
    closeSelectorPanel();

    if (pipCircle) {
      pipCircle.destroy();
      pipCircle = null;
    }
    pipWindow = null;
    pipDocument = null;
    welcomeScreenEl = null;
    c1ScreenEl = null;
    c1BackBtn = null;
    c1EntrySource = null;
    c0ScreenEl = null;
    readyScreenEl = null;
    readyHeadingEl = null;
    readySelectorTriggerEl = null;
    readySelectorTriggerNameEl = null;
    readySelectorPanelEl = null;
    readyContextualActionsEl = null;
    readyStartBtn = null;
    readyDisclaimerEl = null;
    selectorExpanded = false;
    m1ScreenEl = null;
    m1HeadingEl = null;
    m1ReplaceBtn = null;
    m1KeepBtn = null;
    m2ScreenEl = null;
    m2WarningEl = null;
    m2NameInput = null;
    m2SubmitBtn = null;
    m3ScreenEl = null;
    m3CloseBtn = null;
    deleteScreenEl = null;
    deleteHeadingEl = null;
    deleteConfirmBtn = null;
    deleteCancelBtn = null;
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
    toastEl = null;
    toastCardEl = null;
    pendingDeleteProfileId = null;
    monitoringScreenEl = null;
    pipStatusHeadingEl = null;
    monitoringProfileNameEl = null;
    pipCircleWrapperEl = null;
    calibratingScreenEl = null;
    calibratingSubheadingEl = null;
    calibratingStatusEl = null;
    calibratingBarFillEl = null;
    stopCalibratingCountdown();
    failedScreenEl = null;
    failedMessageEl = null;
    pendingLockedAttempt = null;
    decisionTriggerEl = null;
    decisionCommitInFlight = false;
    // In-memory only, by design (see unsavedProfile's own doc comment) — a
    // native Companion close is exactly the boundary it must not survive.
    unsavedProfile = null;
    if (unsubscribeCalibrationLevel) { unsubscribeCalibrationLevel(); unsubscribeCalibrationLevel = null; }
    layoutMode = LAYOUT_MODES.EXPANDED; // a fresh open always starts Expanded

    // A temporary profile was never written anywhere — closing natively
    // while monitoring with one (or holding one uncommitted) simply means
    // there is nothing left to discard beyond this in-memory reference.
    if (wasTemporary) activeProfile = null;

    if (isPageUnloading) return; // this page's own pagehide is already tearing everything down

    // This fires for every way the Companion actually goes away — the
    // native ✕ (the only way to close it directly, in any state) and
    // endSession()'s programmatic pipWindow.close() — since Document PiP's
    // own pagehide is what's wired to this handler, not either call site
    // individually. By the time this runs after endSession(), monitoring
    // has already been torn down there and sessionState has already been
    // eagerly set to COMPANION_CLOSED, so wasActive is already false and
    // the sessionState.set() below is a harmless no-op for that path
    // (createSessionState() guards against re-firing on an unchanged
    // value). What matters is the native-✕ case: monitoring can never
    // continue without the Companion open, so if it was still active
    // reaching here, tear it down now — not "silently keep running" — and
    // reflect the closed Companion (not a full endSession) in session
    // state, so Mezzo (index.html) returns to Home instead of a full
    // endSession() teardown — see src/home-dock.js's handleSessionStateChange().
    if (wasActive) {
      teardownMonitoringEngine();
      activeCircle = null;
    }

    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  // =============================================================================
  // Public interface
  // =============================================================================

  function init() {
    // This page is the runtime owner of the session — closing it stops
    // monitoring and the Companion (see the pagehide handler below).
    // beforeunload asks for confirmation only: Chrome hasn't allowed custom
    // dialog text/buttons since Chrome 51, so the closest supported
    // approximation of "Close Mezzo? ... [Cancel] [Close and Stop]" is the
    // browser's own generic "Leave site?" prompt. Actual teardown must NOT
    // happen here (the user might cancel) — it's deferred to pagehide.
    window.addEventListener('beforeunload', (event) => {
      if (!isMonitoringActive) return;
      event.preventDefault();
      event.returnValue = '';
    });

    window.addEventListener('pagehide', () => {
      isPageUnloading = true;
      clearSustained();
      calibrationController.cancel(); // safe from any status — covers the page closing mid-calibration
      if (pipWindow) {
        try { pipWindow.close(); } catch { /* ignore */ }
      }
      engine.stopMonitoring();
      audio.release();
    });
  }

  sessionState.subscribe((state) => onSessionStateChange?.(state));

  return {
    SESSION_STATES,
    getSessionState: sessionState.get,
    subscribe: sessionState.subscribe,
    isPipSupported: () => pipSupported,

    init,
    startMonitoring,
    stopMonitoring,
    endSession,
  };
}
