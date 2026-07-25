/**
 * Mezzo — Session Ownership Module
 *
 * Owns everything about a monitoring session: the audio/engine pipeline,
 * the Mezzo Companion (Document Picture-in-Picture) lifecycle, the
 * explicit `sessionState` (src/session-state.js — companionClosed /
 * companionReady / monitoringActive), an explicit `layoutMode` for the
 * Companion's own two supported presentations (Expanded / Compact — kept
 * as a fully separate piece of state, never inferred from window
 * dimensions), and the no-Companion-support fallback's own start/stop.
 *
 * The Companion renders as two genuinely separate screens — Ready and
 * Monitoring — never a shared layout with elements toggled. Ready has no
 * visualization at all and is always Expanded; there is no Compact Ready
 * variant. Monitoring is the only screen with two layouts:
 *   - Expanded (MEZZO_COMPANION_EXPANDED_SIZE, 290×420): the live
 *     awareness-state label (Quiet / Within Range / Approaching End of
 *     Range / Outside Range — the most prominent text in the header),
 *     locked profile metadata, the visualization, and a restrained bottom
 *     control bar (Stop, Compact) — never a large full-width Stop
 *     Monitoring button. No in-page title bar — the real Document
 *     Picture-in-Picture window chrome is the only title bar (see
 *     `pipDoc.title` below); Ready uses the same real window chrome too,
 *     with no in-page title bar of its own.
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
 * Profile selection happens in Mezzo (for the first session) or on the
 * Companion's own Ready screen (for subsequent same-day sessions) — never
 * both for the same session. startMonitoring(profile) opens the Companion
 * and starts monitoring in one action, with no Ready confirmation step and
 * no second "Start Monitoring" click — Mezzo already chose the profile.
 * Once monitoring starts the profile is locked and shown as plain
 * informational text (Expanded only), so there is no mid-monitoring
 * profile-switch flow to reconcile. Stopping returns the (still-open)
 * Companion to Ready, where the profile selector unlocks again for
 * starting again, switching profiles, or creating a new one.
 *
 * Extracted out of what used to be monitoring.js's page controller so that
 * try-it.js (now the single Mezzo session-owning page) can drive its own
 * status view off this module's public surface without duplicating the
 * engine/audio/PiP internals — "one source of truth," not a second copy.
 *
 * Public surface is deliberately small: for the Companion-supported path,
 * try-it.js never calls anything for Start/Stop Monitoring, or for
 * Expanded/Compact layout, directly — those controls live *inside* the
 * Companion's own document and are wired here. try-it.js only needs: init,
 * startMonitoring, stopMonitoring (for its own "End Session" click),
 * endSession, setActiveProfile, subscribe/getSessionState,
 * calibrationController (shared with the Speaking Profile page's own
 * pre-Companion calibration screens — see its export comment below), and
 * (fallback path only) startFallbackMonitoring/startDemo. There is
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
import { createCalibrationController, CALIBRATION_OWNERS } from './calibration-controller.js';
import { createCalibrationLock } from './calibration-lock.js';
import { trackMonitoringStarted, trackMonitoringSession } from './analytics.js';
import { markClassification, markPipUpdate } from './_timing-debug.js';
import { SESSION_STATES, createSessionState } from './session-state.js';
import {
  getSavedProfiles,
  setSelectedProfile,
  setLastUsedProfile,
  promoteTemporaryProfile,
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
const MEZZO_COMPANION_READY_SIZE = { width: 320, height: 354 };
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

// Calibrating screen's live meter — same dB-to-0..1 mapping try-it.js's own
// calibration ring already uses (ENERGY_DB_MIN/MAX there), duplicated here
// rather than imported since try-it.js is a page script, not a module this
// file can import from.
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
  onSessionStateChange,          // (state) => void — drives the host's 3-state status view.
  onFallbackHeadingChange,       // (text) => void — fallback/demo path's own zone-label heading
  onFallbackMonitoringStop,      // () => void — fallback path: host switches back to its own Ready view
} = {}) {
  const pipSupported = 'documentPictureInPicture' in window;
  const sessionState = createSessionState();

  const audio = new AudioProcessor();
  const engine = new MezzoEngine();
  // One instance for this tab's whole session — shared by the Companion's
  // own Calibrating/Calibrated/Calibration-Failed screens (this module,
  // reachable from the Companion's Ready screen) and, via the `calibrationController`
  // export below, the Speaking Profile page's own pre-Companion calibration
  // entry points (try-it.js). Reuses this module's own `audio` (AudioProcessor) rather than a second,
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
  // per tab, exposed alongside calibrationController below for try-it.js to
  // share — see calibration-lock.js's own header for why this is a
  // localStorage lease, not a second controller, and why it's kept
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
  // Gated on calibrationController.getOwner() === COMPANION: try-it.js
  // registers its own subscriber on this exact same shared instance (see
  // CLAUDE.md's "Calibration Controller Instance Rule") for calibration runs
  // it starts itself, pre-Companion. Without this guard, a main-page-driven
  // calibration would also reach this listener and try to render Companion
  // screens — today that happens to be a safe no-op whenever pipWindow is
  // null (every DOM ref below is null, resizeCompanionTo()/showOnlyScreen()
  // both short-circuit), but that safety is an accident of pipWindow's
  // current lifecycle, not a guarantee — inferring "who owns this run" from
  // window/session state elsewhere would silently couple two independently-
  // evolving systems' invariants together. getOwner() makes the actual rule
  // explicit instead: only render here when this surface is the one that
  // started the run. Every real start call site below passes
  // CALIBRATION_OWNERS.COMPANION explicitly (beginCalibrationFlow); retry()
  // doesn't need to re-pass it — ownership survives a failed→retry cycle on
  // its own (see calibration-controller.js).
  calibrationController.subscribe((state) => {
    if (calibrationController.getOwner() !== CALIBRATION_OWNERS.COMPANION) return;
    if (state.status === 'failed') {
      showFailedScreen(state.failure);
    } else if (state.status === 'calibrated') {
      showCalibratedScreen(state);
    }
  });

  let mainCircle = null;
  let pipCircle = null;
  let activeCircle = null;
  let pipWindow = null;
  let pipDocument = null;
  let baselineRMS = 0;
  let activeProfile = null;
  let isMonitoringActive = false;
  let isPageUnloading = false;
  let demoInterval = null;

  // Explicit, Companion-internal — never inferred from pipWindow's actual
  // dimensions. Only meaningful while sessionState is monitoringActive;
  // Ready is unconditionally Expanded regardless of this value.
  let layoutMode = LAYOUT_MODES.EXPANDED;

  // Ready-screen DOM refs, (re)assigned each time startMonitoring() builds the
  // document. Option B: rows are selection-only (a native radiogroup, inside
  // its own bounded-scroll region — see the CSS below); Recalibrate is a
  // single action below the list, its label kept in sync with the current
  // selection.
  let readyScreenEl = null;
  let readyListEl = null; // the scrollable radiogroup container itself
  let readyStartBtn = null;
  let readyRecalibrateBtn = null;

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
  // (checkpoint / naming), same "single modal, steps toggled in place"
  // pattern try-it.js's own save dialog already established, not two
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
  let savePromptErrorEl = null;
  let savePromptNameInput = null;
  let savePromptNameForm = null;

  // The profile a save-prompt/calibrated-naming step would persist under —
  // held only as long as that one step is on screen, not part of any
  // longer-lived state.
  let pendingTemporaryProfile = null;

  let unsubscribeCalibrationLevel = null; // Calibrating screen's live-meter subscription — torn down whenever that screen isn't active

  let currentZone = 0;
  let isSustained = false;
  let sustainedTimer = null;

  let monitoringStartTime = null;
  let sessionUsedPip = false;
  let sessionAlertTriggered = false;

  function clearSustained() {
    if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
    isSustained = false;
  }

  function updateHeading(zone) {
    const text = zoneLabel(zone);
    onFallbackHeadingChange?.(text);
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
    // (src/profiles.js) — no branch needed here to keep that guarantee.
    setSelectedProfile(profile);
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
        usedPip: sessionUsedPip,
        alertTriggered: sessionAlertTriggered,
      });
      monitoringStartTime = null;
    }

    isMonitoringActive = false;
    engine.stopMonitoring();
    if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
    audio.stopMonitoring();
    audio.release();

    clearSustained();
    currentZone = 0;

    if (mainCircle) {
      mainCircle.destroy();
      mainCircle = null;
    }
  }

  function stopMonitoring() {
    // Captured before teardown/enterPipReadyMode() can touch activeProfile —
    // isTemporaryProfile() depends only on the explicit `temporary: true`
    // marker (never inferred from name, a missing id, calibratedTs recency,
    // or how the session started), so this check is unambiguous regardless
    // of which path led here.
    const wasTemporary = isTemporaryProfile(activeProfile);
    const stoppedProfile = activeProfile;

    teardownMonitoringEngine();

    if (pipWindow) {
      // The Companion stays open — Document PiP does not survive its opener
      // navigating away, so doing so would silently kill the window.
      if (wasTemporary) {
        // showReadyScreen(), not enterPipReadyMode(): the raw renderer,
        // deliberately skipping the "zero saved profiles -> auto-calibrate"
        // redirect — that redirect would otherwise fire here (this may be
        // the user's very first session, with nothing saved yet) and show
        // Calibrating underneath the Save Prompt about to open, instead of
        // Ready.
        showReadyScreen();
        sessionState.set(SESSION_STATES.COMPANION_READY);
        openSavePrompt(stoppedProfile);
      } else {
        enterPipReadyMode();
        sessionState.set(SESSION_STATES.COMPANION_READY);
      }
      return;
    }

    // No-Companion-support fallback path.
    activeCircle = null;
    if (!isPageUnloading) onFallbackMonitoringStop?.();
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
   * Opens the Mezzo Companion and starts monitoring immediately with the
   * given profile — Mezzo (not the Companion) already chose the profile for
   * this first session, so there is no Ready confirmation step here and no
   * second "Start Monitoring" click. Falls back to the Ready screen only if
   * mic acquisition fails, so the user isn't left with a broken window.
   * Call directly from a real click (this is what satisfies Document PiP's
   * fresh-user-gesture requirement now that the caller is try-it.html's own
   * page, not a separate window relaying the gesture).
   * @returns {Promise<boolean>} whether the Companion actually opened
   */
  async function startMonitoring(profile) {
    if (!pipSupported) {
      console.warn('[Session] Document PiP API not supported');
      return false;
    }

    try {
      pipWindow = await documentPictureInPicture.requestWindow(MEZZO_COMPANION_EXPANDED_SIZE); // first open always goes straight to Monitoring
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
      .pip-screen-ready {
        justify-content: flex-start;
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
         (checkpoint / naming), the same pattern try-it.js's own save
         dialog already established, not a second modal or a separate
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
      .pip-status-heading[data-zone="1"] { color: rgba(222, 210, 194, 0.58); }
      .pip-status-heading[data-zone="2"] { color: rgba(210, 155, 75, 0.85); }
      .pip-status-heading[data-zone="3"] { color: rgba(248, 130, 65, 0.80); }
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

    if (mainCircle) {
      mainCircle.destroy();
      mainCircle = null;
    }

    pipWindow.addEventListener('pagehide', handlePipClose);

    // Go straight to Monitoring — Mezzo already chose this profile, so there
    // is no Ready confirmation step on first open. If mic acquisition fails,
    // fall back to Ready so the user can retry Start Monitoring from inside
    // the Companion instead of being left with a broken window. Subsequent
    // same-day sessions reuse this same open window via enterPipReadyMode()
    // (on Stop) and resumeMonitoringFromPipReady() (on its own Start
    // Monitoring button) instead of this path.
    activeProfile = profile;
    const started = await resumeMonitoringFromPipReady();
    if (!started) {
      enterPipReadyMode();
      sessionState.set(SESSION_STATES.COMPANION_READY);
    }

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
    if (readyScreenEl) readyScreenEl.classList.add('hidden');
    if (monitoringScreenEl) monitoringScreenEl.classList.remove('hidden');
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
    sessionUsedPip = true;

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
    [readyScreenEl, calibratingScreenEl, failedScreenEl, calibratedScreenEl, monitoringScreenEl].forEach((el) => {
      if (el) el.classList.toggle('hidden', el !== screenEl);
    });
    if (screenEl !== calibratingScreenEl && unsubscribeCalibrationLevel) {
      unsubscribeCalibrationLevel();
      unsubscribeCalibrationLevel = null;
    }
  }

  /** Raw Ready renderer — always shows Ready, never auto-redirects, even if
   *  the saved-profile library happens to be empty (that "list is empty"
   *  case is a normal, valid Ready presentation: just Calibrate for this
   *  session, no rows). Used by every path that must not risk re-triggering
   *  the auto-calibrate redirect below — Cancel/Back from Calibrating,
   *  Calibration Failed, and the Calibrated checkpoint, and Discard from the
   *  Save Prompt. See enterPipReadyMode() for the "smart" entry point. */
  function showReadyScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(readyScreenEl);
    renderReadyScreen();
  }

  /** Smart Ready entry point — used by the two real "we no longer have an
   *  active session, show Ready" moments (Stop, and startMonitoring()'s
   *  mic-acquisition-failure fallback). Skips straight into a session
   *  calibration instead of rendering a profile list with nothing in it,
   *  per the product model: there is no built-in, uncalibrated default
   *  profile, so a user with zero saved profiles has exactly one path in. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    if (getSavedProfiles().length === 0) {
      beginCalibrationFlow('session', null);
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

      readyListEl.appendChild(row);
    });

    updateReadyActionsState();
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

    try {
      if (mode === 'recalibrate') {
        calibrationController.startRecalibration(targetProfileId, CALIBRATION_OWNERS.COMPANION);
      } else {
        calibrationController.startSessionCalibration(CALIBRATION_OWNERS.COMPANION);
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

    if (mode === 'recalibrate') {
      const name = calibrationController.getTargetSnapshot()?.name ?? 'this profile';
      if (calibratedCheckpointHeadingEl) calibratedCheckpointHeadingEl.textContent = `New calibration ready for ${name}.`;
      if (calibratedPrimaryBtn) calibratedPrimaryBtn.textContent = `Update ${name} & Start Monitoring`;
      if (calibratedSecondaryBtn) calibratedSecondaryBtn.textContent = `Update ${name}`;
    } else {
      if (calibratedCheckpointHeadingEl) calibratedCheckpointHeadingEl.textContent = 'Your speaking range is ready.';
      if (calibratedPrimaryBtn) calibratedPrimaryBtn.textContent = 'Start Monitoring';
      if (calibratedSecondaryBtn) calibratedSecondaryBtn.textContent = 'Save as New Profile';
    }

    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(calibratedScreenEl);
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
   *  the input itself (see buildCalibratedNameStep) — same as try-it.js's
   *  own handleNameFormSubmit(). */
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
  // Calibrated screen above and try-it.js's own save dialog, and shares the
  // actual promotion operation (profiles.js's promoteTemporaryProfile())
  // with the Calibrated screen's own "Save as New Profile" — the two paths
  // must never implement slightly different storage semantics.
  // ===========================================================================

  function showSavePromptStep(step) {
    savePromptStepEl?.classList.toggle('hidden', step !== 'prompt');
    savePromptNameStepEl?.classList.toggle('hidden', step !== 'name');
  }

  function openSavePrompt(temporaryProfile) {
    pendingTemporaryProfile = temporaryProfile;
    if (savePromptErrorEl) { savePromptErrorEl.classList.add('hidden'); savePromptErrorEl.textContent = ''; }
    showSavePromptStep('prompt');
    savePromptBackdropEl?.classList.remove('hidden');
  }

  function closeSavePrompt() {
    savePromptBackdropEl?.classList.add('hidden');
    pendingTemporaryProfile = null;
  }

  function handleSavePromptSaveClick() {
    if (savePromptNameInput) savePromptNameInput.value = '';
    showSavePromptStep('name');
    requestAnimationFrame(() => savePromptNameInput?.focus());
  }

  /** Discard — drops the temporary calibration entirely; nothing was ever
   *  written to storage for it (setLastUsedProfile() already refuses a
   *  temporary profile on its own — see src/profiles.js), so there is
   *  nothing to undo, only the in-memory reference to forget. */
  function handleSavePromptDiscard() {
    closeSavePrompt();
    activeProfile = null;
    renderReadyScreen();
  }

  function handleSavePromptNameSubmit(event) {
    event.preventDefault();
    const name = savePromptNameInput?.value.trim();
    if (!name || !pendingTemporaryProfile) return;

    const { profile, error } = promoteTemporaryProfile(pendingTemporaryProfile, name);
    if (!profile) {
      // 5-profile limit — stays recoverable: back to the prompt step with
      // the temporary calibration still intact (pendingTemporaryProfile is
      // untouched), so the user can free a slot elsewhere and retry, or
      // Discard.
      showSavePromptStep('prompt');
      if (savePromptErrorEl) {
        savePromptErrorEl.textContent = error?.message || 'Something went wrong — please try again.';
        savePromptErrorEl.classList.remove('hidden');
      }
      return;
    }

    setSelectedProfile(profile);
    setLastUsedProfile(profile);
    activeProfile = profile;
    closeSavePrompt();
    renderReadyScreen();
  }

  function buildSavePromptSteps(doc, container) {
    const promptStep = doc.createElement('div');
    promptStep.className = 'pip-calibrated-step';

    const promptHeading = doc.createElement('p');
    promptHeading.className = 'pip-calibrated-heading';
    promptHeading.textContent = 'Save this speaking range for next time?';
    promptStep.appendChild(promptHeading);

    const promptError = doc.createElement('p');
    promptError.className = 'pip-calibrated-error hidden';
    promptError.setAttribute('aria-live', 'polite');
    promptStep.appendChild(promptError);
    savePromptErrorEl = promptError;

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
    form.appendChild(input);
    savePromptNameInput = input;

    const submitBtn = doc.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'pip-calibrated-primary-btn';
    submitBtn.textContent = 'Save';
    form.appendChild(submitBtn);
    form.addEventListener('submit', handleSavePromptNameSubmit);
    nameStep.appendChild(form);
    savePromptNameForm = form;

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
    readyScreenEl = null;
    readyListEl = null;
    readyStartBtn = null;
    readyRecalibrateBtn = null;
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
    savePromptErrorEl = null;
    savePromptNameInput = null;
    savePromptNameForm = null;
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
    // state, so Mezzo (try-it.html) returns to the profile library instead
    // of a full endSession() teardown — see try-it.js's
    // handleSessionStateChange().
    if (wasActive) {
      teardownMonitoringEngine();
      activeCircle = null;
    }

    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  // =============================================================================
  // No-Companion-support fallback + demo mode
  // =============================================================================

  /** @returns {Promise<boolean>} whether monitoring actually started */
  async function startFallbackMonitoring(container) {
    if (!activeProfile) return false;
    const ok = await beginMonitoringSession(activeProfile);
    if (!ok) return false;

    mainCircle = new MezzoWaveVisualizer(container);
    activeCircle = mainCircle;
    sessionUsedPip = false;
    return true;
  }

  function startDemo(container) {
    baselineRMS = 0.05;
    const samples = new Array(100).fill(baselineRMS);
    engine.calibrate(samples);
    engine.startMonitoring();
    engine.graceRemainingMs = 0; // skip grace period so zone changes trigger immediately

    mainCircle = new MezzoWaveVisualizer(container);
    activeCircle = mainCircle;

    const CYCLE_MS = 12000;
    const INTERVAL_MS = 50;
    const baseline = baselineRMS;

    demoInterval = setInterval(() => {
      const t = Date.now() % CYCLE_MS;
      let targetRMS;

      if (t < 2000) {
        targetRMS = baseline * 0.1; // 0-2s: silence — Quiet
      } else if (t < 4000) {
        targetRMS = baseline * 1.0; // 2-4s: Within Range
      } else if (t < 6000) {
        targetRMS = baseline * 1.5; // 4-6s: Approaching End of Range
      } else if (t < 10000) {
        targetRMS = baseline * 2.3; // 6-10s: Outside Range
      } else {
        targetRMS = baseline * 0.1; // 10-12s: back to silence
      }

      onAudioFrame({ rms: targetRMS });
    }, INTERVAL_MS);
  }

  // =============================================================================
  // Public interface
  // =============================================================================

  function init(resolvedProfile) {
    activeProfile = resolvedProfile;

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
    getActiveProfile: () => activeProfile,
    setActiveProfile: (profile) => { activeProfile = profile; },
    isPipSupported: () => pipSupported,

    // Exposed so the Speaking Profile page can drive its own pre-Companion
    // Calibrating/Calibration Failed/Calibrated screens through this exact
    // same instance — see calibration-controller.js's INSTANCE RULE and
    // CLAUDE.md's "Calibration Controller Instance Rule": calibration and
    // monitoring are always sequential, never concurrent, within one tab,
    // so one shared instance (rather than a second, competing one) is what
    // actually satisfies "one instance holding the mic per tab," not just a
    // convention two separate instances happen to honor.
    calibrationController,
    calibrationLock,

    init,
    startMonitoring,
    stopMonitoring,
    endSession,

    startFallbackMonitoring,
    startDemo,
  };
}
