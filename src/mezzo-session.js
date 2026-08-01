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
 * The Companion renders as four genuinely separate screens — Welcome,
 * Ready, Calibrating, and Monitoring — never a shared layout with elements
 * toggled (Calibration Failed and the Calibrated checkpoint are two more,
 * reached only from Calibrating). Welcome, Ready, and Calibrating share one
 * fixed size (320×354) and are always Expanded — there is no Compact
 * variant for any of them. Monitoring is the only screen with two layouts:
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
 * Pure copy for the save prompt's naming step, given a
 * resolveSavePromptAction() (src/profiles.js) resolution — the single place
 * this step's terminology-sensitive text lives, so it's unit-testable
 * directly (see src/mezzo-session.test.js) without a Document PiP-capable
 * browser, and so renderSavePromptNameState() below only renders it rather
 * than composing strings inline.
 *
 * Terminology (see CLAUDE.md): "calibration" names the measurement being
 * applied; "profile" is always the saved, selectable object it's applied
 * to — never the reverse. A calibration is never "chosen," "saved," or
 * referred to as if it were itself the persistent thing.
 */
export function savePromptNameCopy(resolution) {
  switch (resolution?.kind) {
    case SAVE_PROMPT_ACTIONS.UPDATE:
      return {
        helperText: `This calibration will update your existing "${resolution.profile.name}" profile.`,
        buttonLabel: `Update ${resolution.profile.name}`,
        disabled: false,
      };
    case SAVE_PROMPT_ACTIONS.BLOCKED:
      return {
        helperText: "You've reached the limit of five saved profiles. Delete a profile to save a new one.",
        buttonLabel: 'Save Profile',
        disabled: true,
      };
    case SAVE_PROMPT_ACTIONS.CREATE:
      return {
        helperText: 'This calibration will be saved as a new profile.',
        buttonLabel: 'Save Profile',
        disabled: false,
      };
    default: // INVALID — nothing typed yet
      return { helperText: '', buttonLabel: 'Save Profile', disabled: true };
  }
}

/**
 * Pure copy for the Calibrated checkpoint (reached right after a capture
 * completes, before Stop — see showCalibratedScreen() below, which only
 * renders whichever of these two modes applies). Mode-aware:
 *
 * - `recalibrate`: a specific saved profile (`targetName`) was the target
 *   from the start — "This calibration" (the measurement) is ready to
 *   update that named, saved profile. Never phrased as if the calibration
 *   itself were the saved object (see CLAUDE.md's terminology rule) — the
 *   Stop-time save prompt's savePromptNameCopy() above uses the identical
 *   "This calibration will/is..." framing for the same reason.
 * - `session`: no target profile exists yet — the create-vs-update
 *   decision hasn't been made, and won't be until the Stop-time save
 *   prompt resolves it by name — so this heading describes only the
 *   measurement itself ("speaking range"), naming no profile at all.
 */
export function calibratedCheckpointCopy({ mode, targetName }) {
  if (mode === 'recalibrate') {
    const name = targetName ?? 'this profile';
    return {
      heading: `This calibration is ready to update ${name}.`,
      primaryLabel: `Update ${name} & Start Monitoring`,
      secondaryLabel: `Update ${name}`,
    };
  }
  return {
    heading: 'Your speaking range is ready.',
    primaryLabel: 'Start Monitoring',
    secondaryLabel: 'Save as New Profile',
  };
}

// The one and only signal for "this profile is a runtime-only calibration
// that hasn't been saved" — never inferred from name, a missing id,
// calibratedTs recency, or which screen produced it. See CLAUDE.md's
// Profiles section and src/profiles.js's file header for the same rule
// applied to storage.
export function isTemporaryProfile(profile) {
  return profile?.temporary === true;
}

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

// Baseline height — shared by Welcome and Calibrating (their content is
// fixed, never profile-count-dependent) and the floor Ready itself starts
// from at zero saved profiles. See computeReadyContentHeight() below for
// how Ready's own height grows past this baseline.
export const MEZZO_COMPANION_READY_BASE_HEIGHT = 344;

const MEZZO_COMPANION_READY_SIZE = { width: MEZZO_COMPANION_READY_WIDTH, height: MEZZO_COMPANION_READY_BASE_HEIGHT };

/**
 * Deterministic Ready-screen height, derived from the actual rendered
 * layout below (.pip-screen-ready/.pip-ready-* rules) rather than a flat
 * guess — grows with the saved-profile count so the window is never too
 * short to show Start Monitoring/Recalibrate without scrolling, and is
 * never hardcoded around any particular profile count.
 *
 * Every term below is read directly off the CSS the Ready screen is
 * actually built with:
 *   36  - .pip-screen-ready's own top+bottom padding (18px each), unchanged
 *   26  - .pip-ready-heading, one line
 *   30  - 3x the screen's own 10px gap — heading/list/calibrate-row/actions
 *         are always exactly 4 direct children, present or not
 *   40  - .pip-calibrate-session-row, always present regardless of profile
 *         count (never conditionally hidden — see renderReadyScreen())
 *   88  - .pip-ready-actions: Start Monitoring (40) + its 8px gap +
 *         Recalibrate (40) — Recalibrate is always rendered too, just
 *         disabled with no selection (see updateReadyActionsState())
 *   24  - safety buffer for Recalibrate wrapping to a second line on a long
 *         profile name (its label is never truncated — see its own CSS
 *         comment). Applied as a flat buffer rather than measuring text
 *         width, since that's far less fragile than predicting text wrap
 *         from script.
 *  100  - requested breathing room: ~50px visible above the heading, ~50px
 *         below the last button. .pip-screen-ready uses
 *         justify-content:center specifically so unused height shows up as
 *         space at both ends instead of only pushing the bottom down — see
 *         that rule below. No change to the screen's own padding/gap
 *         values, only how leftover space distributes.
 * Plus, only when profileCount > 0:
 *  N*40, capped at 122 - .pip-ready-list: one row per saved profile at a
 *         fixed 40px each (.pip-ready-row's min-height; row text never
 *         wraps, see its white-space:nowrap), capped at the list's own
 *         122px max-height. Deliberately not grown past that cap — internal
 *         scrolling within the list is the existing, intended overflow
 *         behavior for 4+ profiles, not an ever-taller window.
 */
export function computeReadyContentHeight(profileCount) {
  const listHeight = profileCount > 0 ? Math.min(profileCount * 40, 122) : 0;
  return MEZZO_COMPANION_READY_BASE_HEIGHT + listHeight;
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
      showCalibratedScreen(state);
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

  // Welcome-screen DOM refs — reached exactly once, the first time the
  // Companion ever opens with zero saved profiles (see showWelcomeScreen()/
  // enterPipReadyMode()).
  let welcomeScreenEl = null;

  // Ready-screen DOM refs, (re)assigned each time startMonitoring() builds the
  // document. Option B: rows are selection-only (a native radiogroup, inside
  // its own bounded-scroll region — see the CSS below); Recalibrate is a
  // single action below the list, its label kept in sync with the current
  // selection. Delete lives per-row (see renderReadyScreen()) — profile
  // management moved here from the old Speaking Profile page's own list.
  let readyScreenEl = null;
  let readyListEl = null; // the scrollable radiogroup container itself
  let readyStartBtn = null;
  let readyRecalibrateBtn = null;

  // Delete-profile confirmation — a modal overlay on top of Ready, same
  // "centered card over the current screen" pattern as the Save Prompt
  // below (see .pip-modal-backdrop/.pip-modal-card). Moved here from the
  // old Speaking Profile page's own #delete-dialog-overlay.
  let deleteDialogBackdropEl = null;
  let deleteDialogNameEl = null;
  let btnDeleteConfirmEl = null;
  let pendingDeleteProfileId = null;
  let pendingDeleteTriggerBtn = null;

  // Monitoring-screen DOM refs
  let monitoringScreenEl = null;
  let pipStatusHeadingEl = null;
  let monitoringProfileNameEl = null;
  let pipCircleWrapperEl = null;

  // Calibrating-screen DOM refs
  let calibratingScreenEl = null;
  let calibratingSubheadingEl = null; // mode-aware "Recalibrating {name}" line — session mode leaves it empty
  let calibratingMeterFillEl = null;

  // Calibration Failed-screen DOM refs
  let failedScreenEl = null;
  let failedMessageEl = null;

  // Calibrated-checkpoint DOM refs — one screen, two internal steps
  // (checkpoint / naming), the same "single modal, steps toggled in place"
  // pattern this module's own Save Prompt below also uses, not two
  // separate screens.
  let calibratedScreenEl = null;
  let calibratedCheckpointStepEl = null;
  let calibratedCheckpointHeadingEl = null;
  let calibratedNameStepEl = null;
  let calibratedPrimaryBtn = null;
  let calibratedSecondaryBtn = null;
  let calibratedErrorEl = null;
  let calibratedNameInput = null;
  let calibratedNameForm = null;

  // Save Prompt — a modal overlay on top of Ready (Stop-time, temporary
  // profile only), not a full screen — mirrors the Calibrated checkpoint's
  // own two-step (prompt / naming) pattern.
  let savePromptBackdropEl = null;
  let savePromptStepEl = null;
  let savePromptNameStepEl = null;
  let savePromptNameHelperEl = null;
  let savePromptNameInput = null;
  let savePromptNameForm = null;
  let savePromptSubmitBtn = null;
  // Reentrancy guard for handleSavePromptNameSubmit() — the commit itself
  // is fully synchronous (no await), so nothing can genuinely interleave
  // mid-handler, but this still stops a rapid double Enter/click from
  // re-entering the handler a second time before the first call's own
  // closeSavePrompt() has cleared pendingTemporaryProfile.
  let savePromptSubmitting = false;

  // The profile a save-prompt/calibrated-naming step would persist under —
  // held only as long as that one step is on screen, not part of any
  // longer-lived state.
  let pendingTemporaryProfile = null;

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

    // Captured before teardown/enterPipReadyMode() can touch activeProfile —
    // isTemporaryProfile() depends only on the explicit `temporary: true`
    // marker (never inferred from name, a missing id, calibratedTs recency,
    // or how the session started), so this check is unambiguous regardless
    // of which path led here.
    const wasTemporary = isTemporaryProfile(activeProfile);
    const stoppedProfile = activeProfile;

    teardownMonitoringEngine();

    // The Companion stays open — Document PiP does not survive its opener
    // navigating away, so doing so would silently kill the window.
    if (wasTemporary) {
      // showReadyScreen(), not enterPipReadyMode(): the raw renderer,
      // deliberately skipping the "zero saved profiles -> Welcome" redirect
      // — that redirect would otherwise fire here (this may be the user's
      // very first session, with nothing saved yet) and show Welcome
      // underneath the Save Prompt about to open, instead of Ready.
      showReadyScreen();
      openSavePrompt(stoppedProfile);
    } else {
      enterPipReadyMode();
    }
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
      // on Welcome or Ready first, never straight into Monitoring, so
      // requesting the window at the size it'll actually need avoids a
      // visible resize flash immediately after opening. Computed from the
      // real saved-profile count up front (not just the flat baseline) so
      // even the very first paint is already correctly sized for Ready —
      // Welcome (zero profiles) has fixed content and keeps the baseline.
      const initialProfileCount = getSavedProfiles().length;
      const initialSize = initialProfileCount > 0
        ? { width: MEZZO_COMPANION_READY_WIDTH, height: computeReadyContentHeight(initialProfileCount) }
        : MEZZO_COMPANION_READY_SIZE;
      pipWindow = await documentPictureInPicture.requestWindow(initialSize);
      // Belt-and-suspenders, not a poll/loop: requestWindow()'s size argument
      // isn't guaranteed to be honored by every browser (the same caveat
      // resizeCompanionTo() below already carries) — a returning user's
      // previously-honored manual resize is the documented case this
      // guards against. One corrective call right after open, never
      // repeated/watched afterward.
      resizeCompanionTo(initialSize);
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
         Companion — Start Monitoring, Recalibrate {profile}, Save as New
         Profile, Save Profile, Save, and Discard all use one of the two
         classes below. One rule, not a duplicated max-width on each of
         them: at the default Companion width these buttons already sit
         well under 320px, so this only matters once a user manually
         resizes the window wider — see MEZZO_COMPANION_READY_WIDTH's own
         comment above for how 320 (button) + 30 + 30 (this centering
         slack, on top of each screen's own unchanged side padding) adds up.
         Compact controls, profile rows, radio options, and the native
         window-close control are untouched — they don't use this pattern. */
      .pip-ready-start-btn,
      .pip-ready-recalibrate-btn,
      .pip-calibrated-primary-btn,
      .pip-calibrated-secondary-btn {
        max-width: 320px;
        margin-inline: auto;
      }

      /* ── Welcome — reached exactly once, before any saved profile exists.
         Shares the Ready/Calibrating fixed size; a taller stack of text
         than any other screen (heading, two body paragraphs, a privacy
         line, then two actions), so its own type scale runs a step smaller
         than Calibrating's single-heading treatment to fit comfortably. ── */
      .pip-screen-welcome {
        justify-content: center;
        padding: 28px 24px;
        box-sizing: border-box;
        gap: 12px;
        text-align: center;
      }
      .pip-welcome-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 17px;
        color: rgba(222, 210, 194, 0.92);
        margin: 0;
      }
      .pip-welcome-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.80);
        margin: 0;
        max-width: 250px;
      }
      .pip-welcome-privacy {
        font-family: var(--font-body);
        font-size: 10.5px;
        line-height: 1.4;
        color: rgba(172, 158, 136, 0.70);
        margin: 2px 0 4px;
        max-width: 240px;
      }

      /* ── Ready screen — Option B (see design/prototypes/companion-ready-
         recalibrate-comparison.html for the measured comparison this
         layout was chosen from). No visualization, always Expanded. No
         in-page title bar — the real Document Picture-in-Picture window
         chrome is the only title bar. Rows are selection-only, inside their
         own bounded, internally-scrollable region — the Companion card
         itself never scrolls (.pip-screen keeps overflow:hidden) — with
         Calibrate for this session, Start Monitoring, and the single
         dynamic Recalibrate action always visible below it, outside the
         scroll region. There is no footer — the native Picture-in-Picture
         window close control is the only way to close the Companion. ── */
      /* justify-content:center, not flex-start — matches the convention
         .pip-screen-welcome/.pip-screen-calibrating already use. The
         window height requested for this screen (see
         computeReadyContentHeight()) intentionally includes ~50px of
         breathing room above and below the tightly-packed content;
         centering is what turns that into visible space at both ends
         rather than only pushing empty space below the last button.
         Content padding/gaps themselves are unchanged. */
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
        flex-shrink: 0;
      }

      /* Bounded, internally-scrollable — the one region in this screen
         allowed to scroll (no nested scrolling: nothing scrollable is
         nested inside it, and it is not itself nested inside another
         scrollable ancestor). max-height, not flex:1, so a single short
         list sizes to its own content instead of stretching to fill unused
         space; sized so 1-3 typical rows show with no scrollbar and 5 rows
         scroll within the fixed 354px Companion height without pushing the
         actions below off screen. */
      .pip-ready-list {
        width: 100%;
        max-height: 122px;
        overflow-y: auto;
        overflow-x: hidden;
        flex-shrink: 0;
        box-sizing: border-box;
      }

      .pip-ready-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 6px;
        border-radius: 8px;
        min-height: 40px;
        box-sizing: border-box;
      }
      .pip-ready-row:hover { background: rgba(255, 255, 255, 0.04); }

      /* Native radio input — real keyboard/screen-reader semantics for
         free, rather than a button visually styled to look like one (the
         previous dropdown's own rows carried no role/aria-checked at all). */
      .pip-ready-row-radio {
        width: 16px;
        height: 16px;
        accent-color: var(--hanko-fill);
        flex-shrink: 0;
        cursor: pointer;
      }

      /* Truncates visually with an ellipsis; the full name stays in the DOM
         (assistive tech always gets it in full — CSS truncation doesn't
         change computed accessible names) and is repeated in a native
         title="" tooltip for sighted pointer users, matching the maxlength
         convention already used for naming (see .pip-name-input below). */
      .pip-ready-row-name {
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

      /* Delete — profile management moved here from the old Speaking
         Profile page's own list. Secondary by default (dim, icon-only),
         strengthens on row hover/focus, same restrained treatment as the
         Monitoring control bar's own icon buttons. */
      .pip-ready-row-delete {
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
      .pip-ready-row:hover .pip-ready-row-delete,
      .pip-ready-row-delete:focus-visible {
        opacity: 1;
      }
      .pip-ready-row-delete:hover,
      .pip-ready-row-delete:focus-visible {
        color: rgba(222, 210, 194, 0.92);
        background: rgba(255, 255, 255, 0.06);
      }

      /* ── Delete-profile confirmation — reuses .pip-modal-backdrop/
         .pip-modal-card (see below); its own content styling only. ── */
      .pip-delete-dialog-title {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        line-height: 1.4;
        color: rgba(222, 210, 194, 0.92);
        text-align: center;
        margin: 0 0 8px;
      }
      .pip-delete-dialog-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.75);
        text-align: center;
        margin: 0 0 18px;
      }
      .pip-delete-dialog-actions { display: flex; gap: 10px; width: 100%; }
      .pip-delete-dialog-actions .pip-calibrated-secondary-btn,
      .pip-delete-dialog-actions .pip-delete-confirm-btn { flex: 1; }
      .pip-delete-confirm-btn {
        background: rgba(210, 155, 75, 0.16);
        border: 1px solid rgba(210, 155, 75, 0.35);
        border-radius: 50px;
        padding: 10px 14px;
        font-family: var(--font-body);
        font-size: 12.5px;
        color: rgba(230, 195, 140, 0.95);
        cursor: pointer;
      }
      .pip-delete-confirm-btn:hover { background: rgba(210, 155, 75, 0.26); }

      .pip-calibrate-session-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
        padding: 8px 6px;
        border-radius: 8px;
        background: none;
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-family: var(--font-body);
        font-size: 12.5px;
        color: rgba(172, 158, 136, 0.85);
        cursor: pointer;
        text-align: left;
        flex-shrink: 0;
        min-height: 40px;
      }
      .pip-calibrate-session-row:hover { color: rgba(222, 210, 194, 0.95); }
      .pip-calibrate-session-plus {
        width: 18px;
        height: 18px;
        border: 1.5px dashed rgba(172, 158, 136, 0.55);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        flex-shrink: 0;
        color: rgba(172, 158, 136, 0.75);
      }

      .pip-ready-actions {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
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
      }
      .pip-ready-start-btn:hover { opacity: 0.88; }

      /* The single dynamic Recalibrate action — its full text (including
         the selected profile's name) is both the visible label and the
         full accessible name; never truncated, never icon-only. */
      .pip-ready-recalibrate-btn {
        width: 100%;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 50px;
        padding: 10px 14px;
        font-family: var(--font-body);
        font-size: 12.5px;
        color: rgba(222, 210, 194, 0.85);
        cursor: pointer;
        transition: background 0.15s ease;
        box-sizing: border-box;
        min-height: 40px;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .pip-ready-recalibrate-btn:hover { background: rgba(255, 255, 255, 0.12); }

      /* ── Calibrating — a live meter, automatic completion after the
         configured capture duration, and a single visible Cancel action;
         no manual "I'm done" control. Fixed at the Ready size (320×354) —
         it does not get its own dedicated dimension. ── */
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
      .pip-calibrating-meter-track {
        width: 100%;
        max-width: 220px;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
      }
      .pip-calibrating-meter-fill {
        height: 100%;
        width: 0%;
        background: var(--hanko-fill);
        border-radius: 3px;
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
         to Ready. ── */
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

      /* ── Calibrated checkpoint — one screen, two steps toggled in place
         (checkpoint / naming), the same pattern this module's own Save
         Prompt below also uses, not a second modal or a separate
         screen. Mode-aware actions built in JS — session mode offers Start
         Monitoring / Save as New Profile; recalibrate mode offers
         Update {name} & Start Monitoring / Update {name}. Reused as-is for
         the Save Prompt's own two steps (see .pip-modal-card below). ── */
      .pip-screen-calibrated {
        justify-content: center;
        padding: 26px 24px;
        box-sizing: border-box;
        gap: 14px;
      }
      .pip-calibrated-step { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .pip-calibrated-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        line-height: 1.5;
        color: rgba(222, 210, 194, 0.85);
        text-align: center;
        margin: 0;
        max-width: 250px;
      }
      .pip-calibrated-error {
        font-family: var(--font-body);
        font-size: 11.5px;
        color: rgba(210, 155, 75, 0.90);
        text-align: center;
        margin: 0;
        max-width: 240px;
      }
      .pip-calibrated-actions { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 230px; }
      .pip-calibrated-primary-btn {
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
      .pip-calibrated-primary-btn:hover { opacity: 0.88; }
      .pip-calibrated-secondary-btn {
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
      .pip-calibrated-secondary-btn:hover { background: rgba(255, 255, 255, 0.12); }

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

      /* Live save-prompt helper text — deliberately calmer than
         .pip-calibrated-error's amber "something went wrong" tone (a name
         matching an existing profile is an expected, natural outcome here,
         not a validation failure). Empty when nothing useful to say yet
         (no name typed), so it never visibly pops in/out with a layout
         shift — reserves its own line height instead. */
      .pip-name-helper {
        min-height: 15px;
        font-family: var(--font-body);
        font-size: 11.5px;
        line-height: 1.4;
        color: rgba(222, 210, 194, 0.65);
        text-align: center;
        margin: 0;
        max-width: 240px;
      }

      /* ── Generic centered modal overlay — reused by the Save Prompt
         (Stop-time, temporary profile only). Same "centered card, dimmed
         backdrop" pattern the old profile dropdown established; the
         backdrop is a child of whichever screen is currently visible
         underneath it (.pip-screen is already position:relative), covering
         that screen's own bounds. Clicking the dimmed backdrop itself (not
         the card) closes it exactly like Escape does, same as any other
         modal dismissal. */
      .pip-modal-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 14px;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }
      .pip-modal-card {
        width: 100%;
        background: #3c3b3f;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.72);
        padding: 22px 20px;
        box-sizing: border-box;
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

    // ── Welcome — reached exactly once, the first time the Companion opens
    //    with zero saved profiles (see enterPipReadyMode()). A deliberate
    //    first moment, not an instant redirect into Calibrating: explains
    //    what's about to happen and that microphone access is requested
    //    next, before it actually is. Not now closes the Companion outright
    //    (same as endSession()) — it must never request microphone
    //    permission or create a profile/temporary calibration. Reuses
    //    Ready's fixed size; no Compact variant. ──
    const welcomeScreen = pipDoc.createElement('div');
    welcomeScreen.className = 'pip-screen pip-screen-welcome hidden';

    const welcomeHeading = pipDoc.createElement('h1');
    welcomeHeading.className = 'pip-welcome-heading';
    welcomeHeading.textContent = 'Welcome to Mezzo';
    welcomeScreen.appendChild(welcomeHeading);

    const welcomeBody1 = pipDoc.createElement('p');
    welcomeBody1.className = 'pip-welcome-body';
    welcomeBody1.textContent = 'Mezzo gives you quiet visual feedback when your speaking volume rises, so you can adjust without interrupting the moment.';
    welcomeScreen.appendChild(welcomeBody1);

    const welcomeBody2 = pipDoc.createElement('p');
    welcomeBody2.className = 'pip-welcome-body';
    welcomeBody2.textContent = 'To get started, speak normally for a few seconds so Mezzo can learn your comfortable range.';
    welcomeScreen.appendChild(welcomeBody2);

    const welcomePrivacy = pipDoc.createElement('p');
    welcomePrivacy.className = 'pip-welcome-privacy';
    welcomePrivacy.textContent = 'Your audio stays on this device. Nothing is recorded or transcribed.';
    welcomeScreen.appendChild(welcomePrivacy);

    const welcomeActions = pipDoc.createElement('div');
    welcomeActions.className = 'pip-calibrated-actions';
    const welcomePrimaryBtn = pipDoc.createElement('button');
    welcomePrimaryBtn.type = 'button';
    welcomePrimaryBtn.className = 'pip-calibrated-primary-btn';
    welcomePrimaryBtn.textContent = 'Calibrate my voice';
    welcomePrimaryBtn.addEventListener('click', handleWelcomeCalibrateClick);
    welcomeActions.appendChild(welcomePrimaryBtn);
    welcomeScreen.appendChild(welcomeActions);

    const welcomeNotNowBtn = pipDoc.createElement('button');
    welcomeNotNowBtn.type = 'button';
    welcomeNotNowBtn.className = 'pip-text-btn';
    welcomeNotNowBtn.textContent = 'Not now';
    welcomeNotNowBtn.addEventListener('click', handleWelcomeNotNowClick);
    welcomeScreen.appendChild(welcomeNotNowBtn);

    layout.appendChild(welcomeScreen);
    welcomeScreenEl = welcomeScreen;

    // ── Ready screen — Option B. A compact heading, a bounded/scrollable
    //    radiogroup of saved profiles, Calibrate for this session, then the
    //    always-visible actions (Start Monitoring, Recalibrate {name}).
    //    Populated by renderReadyScreen() below, not here — this only
    //    builds the empty skeleton once; content is (re)rendered every time
    //    the screen is (re)shown, since saved profiles can change between
    //    visits (a new one saved, one deleted, one recalibrated). ──
    const readyScreen = pipDoc.createElement('div');
    readyScreen.className = 'pip-screen pip-screen-ready';
    // No in-page title bar here either — the real Document PiP window
    // chrome is the only title bar now, in every state (see pipDoc.title
    // in startMonitoring()).

    const readyHeading = pipDoc.createElement('h1');
    readyHeading.className = 'pip-ready-heading';
    readyHeading.textContent = 'Ready for the next conversation.';
    readyScreen.appendChild(readyHeading);

    const readyList = pipDoc.createElement('div');
    readyList.className = 'pip-ready-list';
    readyList.setAttribute('role', 'radiogroup');
    readyList.setAttribute('aria-label', 'Saved Profiles');
    readyScreen.appendChild(readyList);
    readyListEl = readyList;

    const calibrateSessionRow = pipDoc.createElement('button');
    calibrateSessionRow.type = 'button';
    calibrateSessionRow.className = 'pip-calibrate-session-row';
    const calibrateSessionPlus = pipDoc.createElement('span');
    calibrateSessionPlus.className = 'pip-calibrate-session-plus';
    calibrateSessionPlus.setAttribute('aria-hidden', 'true');
    calibrateSessionPlus.textContent = '+';
    const calibrateSessionLabel = pipDoc.createElement('span');
    calibrateSessionLabel.textContent = 'Calibrate for this session';
    calibrateSessionRow.appendChild(calibrateSessionPlus);
    calibrateSessionRow.appendChild(calibrateSessionLabel);
    calibrateSessionRow.addEventListener('click', handleCalibrateForSessionClick);
    readyScreen.appendChild(calibrateSessionRow);

    const readyActions = pipDoc.createElement('div');
    readyActions.className = 'pip-ready-actions';

    const pipStartBtn = pipDoc.createElement('button');
    pipStartBtn.type = 'button';
    pipStartBtn.className = 'pip-ready-start-btn';
    pipStartBtn.textContent = 'Start Monitoring';
    pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
    readyActions.appendChild(pipStartBtn);
    readyStartBtn = pipStartBtn;

    const recalibrateBtn = pipDoc.createElement('button');
    recalibrateBtn.type = 'button';
    recalibrateBtn.className = 'pip-ready-recalibrate-btn';
    recalibrateBtn.addEventListener('click', handleReadyRecalibrateClick);
    readyActions.appendChild(recalibrateBtn);
    readyRecalibrateBtn = recalibrateBtn;

    readyScreen.appendChild(readyActions);

    // Save Prompt — a modal overlay on top of this Ready screen (Stop-time,
    // temporary profile only — see stopMonitoring()). Built once here,
    // populated by openSavePrompt().
    const savePromptBackdrop = pipDoc.createElement('div');
    savePromptBackdrop.className = 'pip-modal-backdrop hidden';
    savePromptBackdrop.addEventListener('click', (event) => {
      if (event.target === savePromptBackdrop) handleSavePromptDiscard();
    });
    const savePromptCard = pipDoc.createElement('div');
    savePromptCard.className = 'pip-modal-card';
    savePromptBackdrop.appendChild(savePromptCard);
    readyScreen.appendChild(savePromptBackdrop);
    savePromptBackdropEl = savePromptBackdrop;
    buildSavePromptSteps(pipDoc, savePromptCard);

    // Delete-profile confirmation — another modal overlay on top of Ready,
    // same pattern as the Save Prompt above. Moved here from the old
    // Speaking Profile page's own #delete-dialog-overlay — see
    // handleDeleteClick()/handleDeleteConfirm() below.
    const deleteDialogBackdrop = pipDoc.createElement('div');
    deleteDialogBackdrop.className = 'pip-modal-backdrop hidden';
    deleteDialogBackdrop.addEventListener('click', (event) => {
      if (event.target === deleteDialogBackdrop) handleDeleteCancel();
    });
    const deleteDialogCard = pipDoc.createElement('div');
    deleteDialogCard.className = 'pip-modal-card';

    const deleteDialogTitle = pipDoc.createElement('p');
    deleteDialogTitle.className = 'pip-delete-dialog-title';
    const deleteDialogNameSpan = pipDoc.createElement('span');
    deleteDialogTitle.append('Delete "');
    deleteDialogTitle.append(deleteDialogNameSpan);
    deleteDialogTitle.append('"?');
    deleteDialogCard.appendChild(deleteDialogTitle);
    deleteDialogNameEl = deleteDialogNameSpan;

    const deleteDialogBody = pipDoc.createElement('p');
    deleteDialogBody.className = 'pip-delete-dialog-body';
    deleteDialogBody.textContent = 'This profile will be permanently deleted.';
    deleteDialogCard.appendChild(deleteDialogBody);

    const deleteDialogActions = pipDoc.createElement('div');
    deleteDialogActions.className = 'pip-delete-dialog-actions';

    const deleteDialogCancelBtn = pipDoc.createElement('button');
    deleteDialogCancelBtn.type = 'button';
    deleteDialogCancelBtn.className = 'pip-calibrated-secondary-btn';
    deleteDialogCancelBtn.textContent = 'Cancel';
    deleteDialogCancelBtn.addEventListener('click', handleDeleteCancel);
    deleteDialogActions.appendChild(deleteDialogCancelBtn);

    const deleteDialogConfirmBtn = pipDoc.createElement('button');
    deleteDialogConfirmBtn.type = 'button';
    deleteDialogConfirmBtn.className = 'pip-delete-confirm-btn';
    deleteDialogConfirmBtn.textContent = 'Delete';
    deleteDialogConfirmBtn.addEventListener('click', handleDeleteConfirm);
    deleteDialogActions.appendChild(deleteDialogConfirmBtn);
    btnDeleteConfirmEl = deleteDialogConfirmBtn;

    deleteDialogCard.appendChild(deleteDialogActions);
    deleteDialogBackdrop.appendChild(deleteDialogCard);
    readyScreen.appendChild(deleteDialogBackdrop);
    deleteDialogBackdropEl = deleteDialogBackdrop;

    layout.appendChild(readyScreen);
    readyScreenEl = readyScreen;

    // ── Calibrating ── (see "Calibration" in docs/product-experience.md)
    const calibratingScreen = pipDoc.createElement('div');
    calibratingScreen.className = 'pip-screen pip-screen-calibrating hidden';

    const calibratingSubheading = pipDoc.createElement('div');
    calibratingSubheading.className = 'pip-calibrating-subheading';
    calibratingSubheading.setAttribute('aria-live', 'polite');
    calibratingScreen.appendChild(calibratingSubheading);
    calibratingSubheadingEl = calibratingSubheading;

    const calibratingHeading = pipDoc.createElement('p');
    calibratingHeading.className = 'pip-calibrating-heading';
    calibratingHeading.textContent = "Let's learn your natural speaking volume. Speak as if you're talking with a colleague in a video meeting.";
    calibratingScreen.appendChild(calibratingHeading);

    const meterTrack = pipDoc.createElement('div');
    meterTrack.className = 'pip-calibrating-meter-track';
    meterTrack.setAttribute('aria-hidden', 'true'); // decorative — progress/completion is conveyed via text, not this bar
    const meterFill = pipDoc.createElement('div');
    meterFill.className = 'pip-calibrating-meter-fill';
    meterTrack.appendChild(meterFill);
    calibratingScreen.appendChild(meterTrack);
    calibratingMeterFillEl = meterFill;

    const calibratingCancelBtn = pipDoc.createElement('button');
    calibratingCancelBtn.type = 'button';
    calibratingCancelBtn.className = 'pip-text-btn';
    calibratingCancelBtn.textContent = 'Cancel';
    calibratingCancelBtn.addEventListener('click', handleCalibratingCancel);
    calibratingScreen.appendChild(calibratingCancelBtn);

    layout.appendChild(calibratingScreen);
    calibratingScreenEl = calibratingScreen;

    // ── Calibration Failed ──
    const failedScreen = pipDoc.createElement('div');
    failedScreen.className = 'pip-screen pip-screen-failed hidden';

    const failedMessage = pipDoc.createElement('p');
    failedMessage.className = 'pip-failed-message';
    failedMessage.setAttribute('aria-live', 'assertive');
    failedScreen.appendChild(failedMessage);
    failedMessageEl = failedMessage;

    const failedActions = pipDoc.createElement('div');
    failedActions.className = 'pip-failed-actions';
    const failedTryAgainBtn = pipDoc.createElement('button');
    failedTryAgainBtn.type = 'button';
    failedTryAgainBtn.className = 'pip-calibrated-primary-btn';
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

    // ── Calibrated checkpoint — checkpoint step + naming step, one screen ──
    const calibratedScreen = pipDoc.createElement('div');
    calibratedScreen.className = 'pip-screen pip-screen-calibrated hidden';
    buildCalibratedCheckpointStep(pipDoc, calibratedScreen);
    buildCalibratedNameStep(pipDoc, calibratedScreen);
    layout.appendChild(calibratedScreen);
    calibratedScreenEl = calibratedScreen;

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
    // showOnlyScreen(), not a hardcoded "hide Ready, show Monitoring" pair
    // — resumeMonitoringFromPipReady() (which calls this) is reached from
    // both the Ready screen's own Start Monitoring AND the Calibrated
    // checkpoint's Start Monitoring / Update {name} & Start Monitoring.
    // Hardcoding only readyScreenEl left calibratedScreenEl un-hidden in
    // that second case — both screens un-hidden at once inside the fixed-
    // size, overflow:hidden Companion window pushes Monitoring out of the
    // visible area, reading as "stuck on the calibrated checkpoint screen,
    // visualization not visible" (found via a real production report).
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
  // Ready screen (Option B) — selection-only rows, Calibrate for this
  // session, and the always-visible actions below the list.
  // ===========================================================================

  /** Hides every top-level screen except the given one, and tears down the
   *  Calibrating screen's live-meter subscription whenever navigating away
   *  from it — the one chokepoint every screen transition passes through,
   *  so that cleanup can't be missed by a handler that forgets to do it. */
  function showOnlyScreen(screenEl) {
    [welcomeScreenEl, readyScreenEl, calibratingScreenEl, failedScreenEl, calibratedScreenEl, monitoringScreenEl].forEach((el) => {
      if (el) el.classList.toggle('hidden', el !== screenEl);
    });
    if (screenEl !== calibratingScreenEl && unsubscribeCalibrationLevel) {
      unsubscribeCalibrationLevel();
      unsubscribeCalibrationLevel = null;
    }
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

  /** "Calibrate my voice" — begins session-mode calibration directly; this
   *  is also the first moment microphone permission is ever requested (see
   *  beginCalibrationFlow() -> calibrationController.startSessionCalibration()
   *  -> audio.acquire()). Never reached automatically. */
  function handleWelcomeCalibrateClick() {
    beginCalibrationFlow('session', null);
  }

  /** "Not now" — closes the Companion outright, exactly like endSession()
   *  (native ✕ / Close Companion). Must never touch the microphone or
   *  create a profile/temporary calibration — calibrationController is still
   *  idle at this point (nothing was ever started), so endSession()'s own
   *  calibrationController.cancel() is a pure no-op here, not a real cancel. */
  function handleWelcomeNotNowClick() {
    endSession();
  }

  /** Raw Ready renderer — always shows Ready, never auto-redirects, even if
   *  the saved-profile library happens to be empty (that "list is empty"
   *  case is a normal, valid Ready presentation: just Calibrate for this
   *  session, no rows). Used by every path that must not risk re-triggering
   *  the Welcome redirect below — Cancel/Back from Calibrating, Calibration
   *  Failed, and the Calibrated checkpoint, and Discard from the Save
   *  Prompt. See enterPipReadyMode() for the "smart" entry point. */
  function showReadyScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    // Re-read fresh, same as renderReadyScreen() below — the saved-profile
    // count may have changed since the last time Ready was shown (a
    // profile deleted, or saved for the first time), so the requested
    // height always matches what's actually about to render, never a
    // stale count from an earlier entry.
    resizeCompanionTo({ width: MEZZO_COMPANION_READY_WIDTH, height: computeReadyContentHeight(getSavedProfiles().length) });
    activeCircle = null;
    showOnlyScreen(readyScreenEl);
    renderReadyScreen();
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  /** Smart Ready entry point — used by every real "we no longer have an
   *  active session, show the next screen" moment: startMonitoring()'s
   *  first (and every) open, and Stop. Zero saved profiles shows Welcome —
   *  a deliberate first moment, never an instant auto-calibrate redirect —
   *  per the product model: there is no built-in, uncalibrated default
   *  profile, so a user with zero saved profiles has exactly one path in,
   *  but they choose to take it. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    if (getSavedProfiles().length === 0) {
      showWelcomeScreen();
      return;
    }
    showReadyScreen();
  }

  /** (Re)builds the profile radiogroup from current storage — saved
   *  profiles can change between visits (one saved, deleted, or
   *  recalibrated elsewhere), so this always reads fresh rather than
   *  diffing. There is no built-in default profile to include here — every
   *  row is a real saved profile (see CLAUDE.md's Profiles section). */
  function renderReadyScreen() {
    if (!readyListEl || !pipDocument) return;
    readyListEl.innerHTML = '';

    const saved = getSavedProfiles();
    if (!saved.some((p) => p.id === activeProfile?.id)) {
      activeProfile = saved[0] ?? null;
    }

    saved.forEach((profile) => {
      const row = pipDocument.createElement('div');
      row.className = 'pip-ready-row';

      const radio = pipDocument.createElement('input');
      radio.type = 'radio';
      radio.name = 'ready-profile';
      radio.className = 'pip-ready-row-radio';
      radio.id = `ready-profile-${profile.id}`;
      radio.checked = profile.id === activeProfile?.id;
      radio.addEventListener('change', () => handleReadyRowChange(profile));
      row.appendChild(radio);

      // Truncates visually (see .pip-ready-row-name); the full name is
      // still the label's real text content, so assistive tech always gets
      // it in full regardless of visual truncation, and title="" repeats it
      // as a native tooltip for sighted pointer users.
      const label = pipDocument.createElement('label');
      label.className = 'pip-ready-row-name';
      label.setAttribute('for', radio.id);
      label.textContent = profile.name;
      label.title = profile.name;
      row.appendChild(label);

      // Delete — moved here from the old Speaking Profile page's own list;
      // acts directly on this row regardless of the radio selection, same
      // as Recalibrate. See docs/ux/speaking-profile-flow.md's retired
      // "Deleting Profiles" section for the confirmation copy this mirrors.
      const deleteBtn = pipDocument.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'pip-ready-row-delete';
      deleteBtn.setAttribute('aria-label', `Delete ${profile.name} profile`);
      deleteBtn.innerHTML = '<svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true"><path d="M1 3.5h11M4.5 3.5V2h4v1.5M5.5 6.5v4M7.5 6.5v4M2 3.5l.8 8.5h7.4l.8-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        handleDeleteClick(profile, deleteBtn);
      });
      row.appendChild(deleteBtn);

      readyListEl.appendChild(row);
    });

    updateReadyActionsState();
  }

  function openDeleteDialog(profile, triggerBtn) {
    pendingDeleteProfileId = profile.id;
    pendingDeleteTriggerBtn = triggerBtn;
    if (deleteDialogNameEl) deleteDialogNameEl.textContent = profile.name;
    deleteDialogBackdropEl?.classList.remove('hidden');
    btnDeleteConfirmEl?.focus();
  }

  function closeDeleteDialog() {
    deleteDialogBackdropEl?.classList.add('hidden');
    pendingDeleteTriggerBtn?.focus();
    pendingDeleteProfileId = null;
    pendingDeleteTriggerBtn = null;
  }

  function handleDeleteClick(profile, triggerBtn) {
    openDeleteDialog(profile, triggerBtn);
  }

  function handleDeleteCancel() {
    closeDeleteDialog();
  }

  /** Confirm — removes the profile from storage, repairs any stored
   *  reference that pointed at it (this tab's selection, the cross-tab
   *  last-used profile — see CLAUDE.md's Profile Model: no stored reference
   *  should ever point at a missing profile), and re-renders. Deleting the
   *  final saved profile returns to Welcome, exactly like a genuinely new
   *  user — see docs/ux/speaking-profile-flow.md's retired "Deleting the
   *  Final Profile" section. */
  function handleDeleteConfirm() {
    if (!pendingDeleteProfileId) return;
    const deletedId = pendingDeleteProfileId;
    const remaining = getSavedProfiles().filter((p) => p.id !== deletedId);
    saveSavedProfiles(remaining);

    if (getSelectedProfile()?.id === deletedId) setSelectedProfile(null);
    if (getLastUsedProfile()?.id === deletedId) clearLastUsedProfile();
    if (activeProfile?.id === deletedId) activeProfile = null;

    deleteDialogBackdropEl?.classList.add('hidden');
    pendingDeleteProfileId = null;
    pendingDeleteTriggerBtn = null;

    enterPipReadyMode(); // re-resolves fresh: Welcome if that was the last one, Ready (re-rendered) otherwise
  }

  // Profile selection only ever happens while Ready — monitoring locks it —
  // so this always switches immediately, no confirmation needed.
  function handleReadyRowChange(profile) {
    activeProfile = profile;
    setSelectedProfile(profile);
    updateReadyActionsState();
  }

  /** Keeps Start Monitoring and the dynamic Recalibrate label in sync with
   *  the current selection — including the edge case where nothing is
   *  selected at all (an empty library reached via showReadyScreen()'s raw
   *  path, e.g. Cancel before ever saving a first profile). */
  function updateReadyActionsState() {
    const hasSelection = !!activeProfile?.id;
    if (readyStartBtn) readyStartBtn.disabled = !hasSelection;
    if (readyRecalibrateBtn) {
      readyRecalibrateBtn.disabled = !hasSelection;
      const label = hasSelection ? `Recalibrate ${activeProfile.name}` : 'Recalibrate';
      readyRecalibrateBtn.textContent = label;
      readyRecalibrateBtn.setAttribute('aria-label', label);
    }
  }

  function handleReadyRecalibrateClick() {
    if (!activeProfile?.id) return; // disabled in this state; defensive
    beginCalibrationFlow('recalibrate', activeProfile.id);
  }

  function handleCalibrateForSessionClick() {
    beginCalibrationFlow('session', null);
  }

  // ===========================================================================
  // Calibrating / Calibration Failed / Calibrated checkpoint — driven by the
  // shared calibration controller (src/calibration-controller.js). This
  // module owns none of the calibration business logic or storage writes
  // itself — it only renders the controller's state and calls its methods.
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
    if (calibratingMeterFillEl) calibratingMeterFillEl.style.width = '0%';
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

  function handleCalibrationLevelSample(rms) {
    if (!calibratingMeterFillEl) return;
    const db = 20 * Math.log10(rms + 1e-10);
    const energy = Math.min(1, Math.max(0, (db - CALIBRATION_METER_DB_MIN) / (CALIBRATION_METER_DB_MAX - CALIBRATION_METER_DB_MIN)));
    calibratingMeterFillEl.style.width = `${Math.round(energy * 100)}%`;
  }

  function handleCalibratingCancel() {
    calibrationController.cancel();
    showReadyScreen();
  }

  function showFailedScreen(failure) {
    if (failedMessageEl) failedMessageEl.textContent = calibrationFailureMessage(failure);
    showOnlyScreen(failedScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_NEEDS_ATTENTION);
  }

  /** Try Again — retry() re-enters the same mode and, in recalibrate mode,
   *  the same target, so this alone is what keeps session mode session and
   *  recalibration targeted at the same saved profile across a retry. When
   *  the Failed screen is showing because of a cross-tab lock rejection
   *  (pendingLockedAttempt set), no controller run ever started, so this
   *  re-attempts via beginCalibrationFlow() — re-checking the lock fresh —
   *  instead of calling retry(), which would throw from an idle controller. */
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

  function handleFailedBack() {
    calibrationController.cancel();
    showReadyScreen();
  }

  function showCalibratedStep(step) {
    calibratedCheckpointStepEl?.classList.toggle('hidden', step !== 'checkpoint');
    calibratedNameStepEl?.classList.toggle('hidden', step !== 'name');
  }

  /**
   * Renders the mode-aware Calibrated checkpoint. Nothing is persisted
   * merely by this rendering — every field here is read-only display text;
   * the only paths that ever write to storage are the explicit commit
   * handlers below (handleCalibratedPrimary/Secondary/NameSubmit).
   */
  function showCalibratedScreen(state) {
    const { mode } = state;
    if (calibratedErrorEl) { calibratedErrorEl.classList.add('hidden'); calibratedErrorEl.textContent = ''; }
    showCalibratedStep('checkpoint');

    const targetName = mode === 'recalibrate' ? calibrationController.getTargetSnapshot()?.name : undefined;
    const copy = calibratedCheckpointCopy({ mode, targetName });
    if (calibratedCheckpointHeadingEl) calibratedCheckpointHeadingEl.textContent = copy.heading;
    if (calibratedPrimaryBtn) calibratedPrimaryBtn.textContent = copy.primaryLabel;
    if (calibratedSecondaryBtn) calibratedSecondaryBtn.textContent = copy.secondaryLabel;

    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(calibratedScreenEl);
    // Maps to the Dock's "Ready" status, not a status of its own — see
    // CLAUDE.md's Dock status mapping ("Calibrated checkpoint → Ready").
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  function showCalibratedCommitError() {
    const err = calibrationController.getState().commitError;
    if (calibratedErrorEl) {
      calibratedErrorEl.textContent = err?.message || 'Something went wrong — please try again.';
      calibratedErrorEl.classList.remove('hidden');
    }
    // Stays on the checkpoint step with mode-aware buttons and the result
    // untouched — the controller's own state already guarantees the result
    // survives a failed commit; nothing further to do here.
  }

  /** "Start Monitoring" (session) / "Update {name} & Start Monitoring"
   *  (recalibrate) — the one commit path that also transitions into
   *  Monitoring, immediately after committing. */
  async function handleCalibratedPrimary() {
    const { mode } = calibrationController.getState();
    if (mode === 'recalibrate') {
      const updated = calibrationController.commitUpdateProfileAndStartMonitoring();
      if (!updated) { showCalibratedCommitError(); return; }
      activeProfile = updated;
    } else {
      activeProfile = calibrationController.commitStartMonitoring();
    }
    await resumeMonitoringFromPipReady();
  }

  /** "Save as New Profile" (session, opens the naming step) / "Update
   *  {name}" (recalibrate, commits immediately — no naming needed, the
   *  identity already exists). */
  function handleCalibratedSecondary() {
    const { mode } = calibrationController.getState();
    if (mode === 'recalibrate') {
      const updated = calibrationController.commitUpdateProfile();
      if (!updated) { showCalibratedCommitError(); return; }
      activeProfile = updated;
      showReadyScreen();
      return;
    }
    if (calibratedNameInput) calibratedNameInput.value = '';
    showCalibratedStep('name');
    requestAnimationFrame(() => calibratedNameInput?.focus());
  }

  function handleCalibratedBack() {
    calibrationController.cancel();
    showReadyScreen();
  }

  /** Existing naming conventions: trim, require non-empty, maxlength=40 on
   *  the input itself (see buildCalibratedNameStep) — same as this
   *  module's own handleSavePromptNameSubmit() below. */
  function handleCalibratedNameSubmit(event) {
    event.preventDefault();
    const name = calibratedNameInput?.value.trim();
    if (!name) return;

    const saved = calibrationController.commitSaveAsNewProfile(name);
    if (!saved) {
      // 5-profile limit — remain recoverable: back to the checkpoint step,
      // where Start Monitoring is still available with the intact result,
      // rather than stranding the user on this now-abandoned naming step.
      showCalibratedStep('checkpoint');
      showCalibratedCommitError();
      return;
    }
    activeProfile = saved;
    showReadyScreen();
  }

  function buildCalibratedCheckpointStep(doc, container) {
    const step = doc.createElement('div');
    step.className = 'pip-calibrated-step';

    const heading = doc.createElement('p');
    heading.className = 'pip-calibrated-heading';
    step.appendChild(heading);
    calibratedCheckpointHeadingEl = heading;

    const error = doc.createElement('p');
    error.className = 'pip-calibrated-error hidden';
    error.setAttribute('aria-live', 'polite');
    step.appendChild(error);
    calibratedErrorEl = error;

    const actions = doc.createElement('div');
    actions.className = 'pip-calibrated-actions';

    const primaryBtn = doc.createElement('button');
    primaryBtn.type = 'button';
    primaryBtn.className = 'pip-calibrated-primary-btn';
    primaryBtn.addEventListener('click', handleCalibratedPrimary);
    actions.appendChild(primaryBtn);
    calibratedPrimaryBtn = primaryBtn;

    const secondaryBtn = doc.createElement('button');
    secondaryBtn.type = 'button';
    secondaryBtn.className = 'pip-calibrated-secondary-btn';
    secondaryBtn.addEventListener('click', handleCalibratedSecondary);
    actions.appendChild(secondaryBtn);
    calibratedSecondaryBtn = secondaryBtn;

    step.appendChild(actions);

    const backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'pip-text-btn';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', handleCalibratedBack);
    step.appendChild(backBtn);

    container.appendChild(step);
    calibratedCheckpointStepEl = step;
  }

  function buildCalibratedNameStep(doc, container) {
    const step = doc.createElement('div');
    step.className = 'pip-calibrated-step hidden';

    const heading = doc.createElement('p');
    heading.className = 'pip-calibrated-heading';
    heading.textContent = 'Name this profile';
    step.appendChild(heading);

    const form = doc.createElement('form');
    form.style.cssText = 'width:100%;max-width:230px;display:flex;flex-direction:column;gap:10px;';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'pip-name-input';
    input.maxLength = 40;
    input.placeholder = 'e.g. Kitchen';
    input.setAttribute('aria-label', 'Profile name');
    form.appendChild(input);
    calibratedNameInput = input;

    const submitBtn = doc.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'pip-calibrated-primary-btn';
    submitBtn.textContent = 'Save';
    form.appendChild(submitBtn);
    form.addEventListener('submit', handleCalibratedNameSubmit);
    step.appendChild(form);
    calibratedNameForm = form;

    const backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'pip-text-btn';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => showCalibratedStep('checkpoint'));
    step.appendChild(backBtn);

    container.appendChild(step);
    calibratedNameStepEl = step;
  }

  // ===========================================================================
  // Save Prompt — Stop-time modal, temporary profiles only. Shares the
  // "checkpoint/naming, two steps toggled in place" pattern with the
  // Calibrated screen above. The naming
  // step's outcome — create a new profile, or explicitly update an existing
  // one — is entirely decided by profiles.js's resolveSavePromptAction(),
  // never re-implemented here: renderSavePromptNameState() below only
  // renders whatever that function resolves to (live, on every keystroke),
  // and handleSavePromptNameSubmit() only commits it (via
  // commitSavePromptName(), which itself re-resolves fresh rather than
  // trusting the last render). This UI never matches names or checks the
  // profile limit on its own.
  // ===========================================================================

  function showSavePromptStep(step) {
    savePromptStepEl?.classList.toggle('hidden', step !== 'prompt');
    savePromptNameStepEl?.classList.toggle('hidden', step !== 'name');
  }

  function openSavePrompt(temporaryProfile) {
    pendingTemporaryProfile = temporaryProfile;
    showSavePromptStep('prompt');
    savePromptBackdropEl?.classList.remove('hidden');
  }

  function closeSavePrompt() {
    savePromptBackdropEl?.classList.add('hidden');
    pendingTemporaryProfile = null;
  }

  /**
   * Renders the naming step purely from resolveSavePromptAction(name)'s
   * current outcome — the one place the name step's helper text, primary
   * button label, and enabled/disabled state are decided. Called on every
   * keystroke (live preview) and once when the step first opens (so an
   * empty input immediately shows the disabled, un-typed state rather than
   * a stale "Save Profile" left over from a previous open).
   */
  function renderSavePromptNameState() {
    if (!savePromptNameInput) return;
    const resolution = resolveSavePromptAction(savePromptNameInput.value);
    const copy = savePromptNameCopy(resolution);

    if (savePromptSubmitBtn) {
      savePromptSubmitBtn.disabled = copy.disabled;
      savePromptSubmitBtn.textContent = copy.buttonLabel;
    }
    if (savePromptNameHelperEl) savePromptNameHelperEl.textContent = copy.helperText;
  }

  function handleSavePromptSaveClick() {
    if (savePromptNameInput) savePromptNameInput.value = '';
    showSavePromptStep('name');
    renderSavePromptNameState();
    requestAnimationFrame(() => savePromptNameInput?.focus());
  }

  /** Discard — drops the temporary calibration entirely; nothing was ever
   *  written to storage for it (setLastUsedProfile() already refuses a
   *  temporary profile on its own — see src/profiles.js), so there is
   *  nothing to undo, only the in-memory reference to forget. Never
   *  modifies a saved profile, regardless of what's typed in the (now
   *  discarded) name field. */
  function handleSavePromptDiscard() {
    closeSavePrompt();
    activeProfile = null;
    renderReadyScreen();
  }

  /**
   * Commits the naming step — creates a new profile for a unique name, or
   * explicitly updates the matching existing profile for a name that
   * already exists (see commitSavePromptName() in profiles.js, which
   * re-resolves the outcome fresh rather than trusting whatever
   * renderSavePromptNameState() last rendered, guarding against the
   * library having changed — e.g. in another tab — while this prompt sat
   * open). savePromptSubmitting guards against a double Enter/click
   * re-entering this handler before pendingTemporaryProfile is cleared.
   */
  function handleSavePromptNameSubmit(event) {
    event.preventDefault();
    if (savePromptSubmitting) return;
    const name = savePromptNameInput?.value ?? '';
    if (!name.trim() || !pendingTemporaryProfile) return;

    savePromptSubmitting = true;
    try {
      const { action, profile, error } = commitSavePromptName(pendingTemporaryProfile, name);

      if (!profile) {
        // Blocked (limit reached) or, vanishingly rarely, a same-instant
        // deletion race — either way, re-render the live state so the UI
        // self-corrects to match reality (e.g. the button re-disables)
        // instead of silently doing nothing.
        renderSavePromptNameState();
        if (savePromptNameHelperEl && error?.message) savePromptNameHelperEl.textContent = error.message;
        return;
      }

      setSelectedProfile(profile);
      setLastUsedProfile(profile);
      activeProfile = profile;
      closeSavePrompt();
      renderReadyScreen();
    } finally {
      savePromptSubmitting = false;
    }
  }

  function buildSavePromptSteps(doc, container) {
    const promptStep = doc.createElement('div');
    promptStep.className = 'pip-calibrated-step';

    const promptHeading = doc.createElement('p');
    promptHeading.className = 'pip-calibrated-heading';
    // Frames the decision as saving a speaking profile (the persistent,
    // selectable object), not saving "a calibration" as if the raw
    // measurement itself were the thing being kept — see CLAUDE.md's
    // terminology rule.
    promptHeading.textContent = 'Save this as a speaking profile?';
    promptStep.appendChild(promptHeading);

    const promptActions = doc.createElement('div');
    promptActions.className = 'pip-calibrated-actions';

    const saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'pip-calibrated-primary-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', handleSavePromptSaveClick);
    promptActions.appendChild(saveBtn);

    const discardBtn = doc.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'pip-calibrated-secondary-btn';
    discardBtn.textContent = 'Discard';
    discardBtn.addEventListener('click', handleSavePromptDiscard);
    promptActions.appendChild(discardBtn);

    promptStep.appendChild(promptActions);
    container.appendChild(promptStep);
    savePromptStepEl = promptStep;

    const nameStep = doc.createElement('div');
    nameStep.className = 'pip-calibrated-step hidden';

    const nameHeading = doc.createElement('p');
    nameHeading.className = 'pip-calibrated-heading';
    nameHeading.textContent = 'Name this profile';
    nameStep.appendChild(nameHeading);

    const form = doc.createElement('form');
    form.style.cssText = 'width:100%;max-width:230px;display:flex;flex-direction:column;gap:10px;';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'pip-name-input';
    input.maxLength = 40;
    input.placeholder = 'e.g. Kitchen';
    input.setAttribute('aria-label', 'Profile name');
    input.addEventListener('input', renderSavePromptNameState);
    form.appendChild(input);
    savePromptNameInput = input;

    // Live, non-error helper text — reflects whichever of
    // resolveSavePromptAction()'s four outcomes the current input matches
    // (nothing yet / new profile / update an existing one / limit reached).
    // Deliberately not `.pip-calibrated-error`'s amber tone: a name that
    // matches an existing profile is an expected, natural outcome of this
    // flow, not a validation failure.
    const nameHelper = doc.createElement('p');
    nameHelper.className = 'pip-name-helper';
    nameHelper.setAttribute('aria-live', 'polite');
    form.appendChild(nameHelper);
    savePromptNameHelperEl = nameHelper;

    const submitBtn = doc.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'pip-calibrated-primary-btn';
    submitBtn.textContent = 'Save Profile';
    form.appendChild(submitBtn);
    form.addEventListener('submit', handleSavePromptNameSubmit);
    nameStep.appendChild(form);
    savePromptNameForm = form;
    savePromptSubmitBtn = submitBtn;

    const backBtn = doc.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'pip-text-btn';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => showSavePromptStep('prompt'));
    nameStep.appendChild(backBtn);

    container.appendChild(nameStep);
    savePromptNameStepEl = nameStep;
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

    if (pipCircle) {
      pipCircle.destroy();
      pipCircle = null;
    }
    pipWindow = null;
    pipDocument = null;
    welcomeScreenEl = null;
    readyScreenEl = null;
    readyListEl = null;
    readyStartBtn = null;
    readyRecalibrateBtn = null;
    deleteDialogBackdropEl = null;
    deleteDialogNameEl = null;
    btnDeleteConfirmEl = null;
    pendingDeleteProfileId = null;
    pendingDeleteTriggerBtn = null;
    monitoringScreenEl = null;
    pipStatusHeadingEl = null;
    monitoringProfileNameEl = null;
    pipCircleWrapperEl = null;
    calibratingScreenEl = null;
    calibratingSubheadingEl = null;
    calibratingMeterFillEl = null;
    failedScreenEl = null;
    failedMessageEl = null;
    calibratedScreenEl = null;
    calibratedCheckpointStepEl = null;
    calibratedCheckpointHeadingEl = null;
    calibratedNameStepEl = null;
    calibratedPrimaryBtn = null;
    calibratedSecondaryBtn = null;
    calibratedErrorEl = null;
    calibratedNameInput = null;
    calibratedNameForm = null;
    savePromptBackdropEl = null;
    savePromptStepEl = null;
    savePromptNameStepEl = null;
    savePromptNameHelperEl = null;
    savePromptNameInput = null;
    savePromptNameForm = null;
    savePromptSubmitBtn = null;
    savePromptSubmitting = false;
    pendingTemporaryProfile = null;
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
