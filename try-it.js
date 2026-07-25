/**
 * Mezzo — Session Window Controller
 *
 * try-it.js is Mezzo: onboarding (mic permission, profile choice,
 * calibration) *and* the session-owning page once a profile is chosen —
 * there is no second window in between. The Speaking Profile screen's
 * primary CTA ("Start Monitoring" / "Calibrate") is the sole trigger for
 * opening the Mezzo Companion — there is no separate "You're All Set"
 * confirmation screen, and no second profile-selection or Start Monitoring
 * step inside the Companion for this first session. Mezzo chooses the
 * profile and starts monitoring in one action; the Companion opens directly
 * into Monitoring. startMonitoringForProfile() calls straight into
 * src/mezzo-session.js's startMonitoring(), which requests the Document
 * Picture-in-Picture Mezzo Companion from that same click (a real gesture on
 * this document, which is what Document PiP requires). This page then
 * transitions into a status/recovery view driven by `sessionState` for as
 * long as the Companion stays open — through any number of Stop/Start-again
 * cycles inside it — and returns to this same profile-select screen once
 * the Companion closes (see handleSessionStateChange()).
 *
 * States, one visible at a time:
 *   a:                  Mic permission not granted → show enable mic prompt
 *   profileSelect:      Choose a Speaking Profile — see
 *                       docs/ux/speaking-profile-flow.md's "No Saved
 *                       Profiles" / "Saved Profiles" states. Its primary CTA
 *                       is the only way to start monitoring (opening the
 *                       Companion directly into Monitoring) or begin a fresh
 *                       calibration — see handleProfilePrimaryClick(). Also
 *                       where Mezzo lands after the Companion closes for any
 *                       ordinary reason (native ✕, End Session) — see
 *                       handleSessionStateChange().
 *   calibrating:         Session or recalibrate capture, driven by the same
 *                        shared calibration controller the Mezzo Companion
 *                        uses (session.calibrationController — see
 *                        src/mezzo-session.js's export comment and
 *                        CLAUDE.md's "Calibration Controller Instance
 *                        Rule"). Reached from profile-select's "Calibrate"/
 *                        "Calibrate for this session" action, or a saved
 *                        profile row's own Recalibrate action.
 *   calibrationFailed:   Calm, specific failure copy mapped from the
 *                        controller's stable failure code (shared mapping —
 *                        src/mezzo-session.js's calibrationFailureMessage).
 *                        Try Again retries the same mode/target; Back cancels
 *                        and returns to profile-select.
 *   calibrated:          Mode-aware decision screen (one state, two steps
 *                        toggled in place: checkpoint / naming) — session
 *                        mode offers Start Monitoring / Save as New Profile;
 *                        recalibrate mode offers Update {name} & Start
 *                        Monitoring / Update {name}. Nothing is persisted by
 *                        rendering this screen — only the explicit commit
 *                        actions write anything.
 *   sessionStatus:       Companion-capable browsers only — the status/recovery
 *                        view for the two sessionState values reachable while
 *                        the Companion is open (companionReady /
 *                        monitoringActive). Reached the moment Start
 *                        Monitoring is clicked, and shown for as long as the
 *                        Companion stays open. When the Companion closes
 *                        (companionClosed), Mezzo navigates back to
 *                        profile-select instead of showing status copy here.
 *   fallbackMonitor:     The no-Companion-support fallback's own live
 *                        monitoring view (dark, in-page circle) — the one
 *                        case where monitoring itself is shown here.
 *
 * Profile storage lives in src/profiles.js — see that file for the three storage layers
 * (saved-profile library, this-tab selection, cross-tab last-used).
 */

import { pageEnter } from './src/page-transition.js';
import { trackAppOpened, trackCalibrationCompleted } from './src/analytics.js';
import { createMezzoSession, calibrationFailureMessage } from './src/mezzo-session.js';
import { CALIBRATION_OWNERS } from './src/calibration-controller.js';
import {
  getSavedProfiles,
  saveSavedProfiles,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  clearLastUsedProfile,
  resolveActiveProfile,
  MAX_SAVED_PROFILES,
} from './src/profiles.js';

// =============================================================================
// Constants
// =============================================================================

const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;

// Maps live RMS to the calibration ring canvas's 0–1 "energy" scale (see the
// inline visualization script in try-it.html). There's no baseline yet
// during calibration, so this uses a fixed dB reference range rather than
// engine.js's zone classification: silence sits near 0, a normal/moderate
// speaking level lands around the middle, loud speech approaches 1. Same
// mapping src/mezzo-session.js's own Calibrating meter uses.
const ENERGY_DB_MIN = -50;
const ENERGY_DB_MAX = -10;
function rmsToEnergy(rms) {
  const db = 20 * Math.log10(rms + 1e-10);
  return Math.min(1, Math.max(0, (db - ENERGY_DB_MIN) / (ENERGY_DB_MAX - ENERGY_DB_MIN)));
}

const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

// =============================================================================
// Session
// =============================================================================

const session = createMezzoSession({
  baseUrl: new URL('.', window.location.href).href,
  onSessionStateChange: handleSessionStateChange,
  onFallbackHeadingChange: (text) => { if (fallbackHeadingEl) fallbackHeadingEl.textContent = text; },
  onFallbackMonitoringStop: () => renderProfileSelect(),
});
const pipSupported = session.isPipSupported();

// The one calibration-controller instance for this tab — created inside
// createMezzoSession(), also driven by the Companion's own Ready screen once
// it's open. Calibration and monitoring are always sequential, never
// concurrent, within a tab, so this page reusing the same instance (rather
// than creating a second one) is what actually satisfies "one instance holds
// the mic per tab" — see CLAUDE.md's "Calibration Controller Instance Rule".
const calibrationController = session.calibrationController;

// The one cross-tab calibration lease for this tab (src/calibration-lock.js)
// — also created inside createMezzoSession() and shared here rather than a
// second instance, same reasoning as calibrationController above: one tab,
// one tabId. Checked in beginCalibrationFlow() below before a calibration
// attempt starts; released centrally by mezzo-session.js's own
// calibrationController.subscribe() wiring, not scattered across this
// file's own cancel/commit paths.
const calibrationLock = session.calibrationLock;

// Generic reactions — 'failed' and 'calibrated' always mean the same screen
// transition regardless of how the run got there. 'calibrating' is already
// shown synchronously by whatever called startSessionCalibration()/
// startRecalibration()/retry() below; 'idle' can mean several different next
// screens depending on context, so it isn't handled generically.
//
// Gated on calibrationController.getOwner() === MAIN_PAGE: src/mezzo-
// session.js registers its own subscriber on this exact same shared
// instance (see CLAUDE.md's "Calibration Controller Instance Rule") for
// calibration runs the Companion's own Ready screen starts (post-open), and
// that subscriber stays registered for the tab's whole lifetime. Without
// this guard, a Companion-driven recalibration would also reach this page's
// listener and try to switch the (currently hidden, showing "sessionStatus")
// main page to a Calibrating Failed/Calibrated screen underneath the still-
// open Companion — a real conflation of Companion state and this page's own
// screen state. getOwner() is the authoritative signal for this, not an
// inference from session/window state elsewhere (e.g. "is the Companion
// closed") — the two are correlated today but coupling this listener to
// that correlation would make it silently fragile to future changes on
// either side. Every real start call site below passes
// CALIBRATION_OWNERS.MAIN_PAGE explicitly; retry() doesn't need to re-pass
// it — ownership survives a failed→retry cycle on its own (see
// calibration-controller.js).
calibrationController.subscribe((state) => {
  if (calibrationController.getOwner() !== CALIBRATION_OWNERS.MAIN_PAGE) return;
  if (state.status === 'failed') {
    showFailedScreen(state.failure);
  } else if (state.status === 'calibrated') {
    trackCalibrationCompleted();
    showCalibratedScreen(state);
  }
});

session.init(null);

// =============================================================================
// DOM References
// =============================================================================

const stateA = document.getElementById('state-a');
const stateProfileSelect = document.getElementById('state-profile-select');
const stateCalibrating = document.getElementById('state-calibrating');
const stateCalibrationFailed = document.getElementById('state-calibration-failed');
const stateCalibrated = document.getElementById('state-calibrated');
const stateSessionStatus = document.getElementById('state-session-status');
const stateFallbackMonitor = document.getElementById('state-fallback-monitor');

const btnEnableMic = document.getElementById('btn-enable-mic');

const savedProfilesHeadingRow = document.getElementById('saved-profiles-heading-row');
const savedProfilesCount = document.getElementById('saved-profiles-count');
const profileLibrary = document.getElementById('profile-library');
const savedProfilesList = document.getElementById('saved-profiles-list');
const btnCalibrateSession = document.getElementById('btn-calibrate-session');
const btnProfilePrimary = document.getElementById('btn-profile-primary');

const deleteDialogOverlay = document.getElementById('delete-dialog-overlay');
const deleteDialogName = document.getElementById('delete-dialog-name');
const btnDeleteConfirm = document.getElementById('btn-delete-confirm');
const btnDeleteCancel = document.getElementById('btn-delete-cancel');

const calibratingSubheading = document.getElementById('calibrating-subheading');
const btnCalibratingCancel = document.getElementById('btn-calibrating-cancel');
const calRingCanvas = document.getElementById('cal-ring-canvas');

const calibrationFailedMessage = document.getElementById('calibration-failed-message');
const btnFailedTryAgain = document.getElementById('btn-failed-try-again');
const btnFailedBack = document.getElementById('btn-failed-back');

const calibratedStepCheckpoint = document.getElementById('calibrated-step-checkpoint');
const calibratedHeading = document.getElementById('calibrated-heading');
const calibratedError = document.getElementById('calibrated-error');
const btnCalibratedPrimary = document.getElementById('btn-calibrated-primary');
const btnCalibratedSecondary = document.getElementById('btn-calibrated-secondary');
const btnCalibratedBack = document.getElementById('btn-calibrated-back');
const calibratedStepName = document.getElementById('calibrated-step-name');
const nameForm = document.getElementById('name-form');
const profileNameInput = document.getElementById('profile-name-input');
const btnNameBack = document.getElementById('btn-name-back');

const deniedHelp = document.getElementById('denied-help');
const toastEl = document.getElementById('toast');

// Session status view — the status/recovery surface for companionReady/monitoringActive.
// Close Companion is a page-side recovery action, not a revived End
// Session control — see the file-header state comment for "session-status"
// in try-it.html and CLAUDE.md's Non-Negotiable Decisions.
const sessionStatusDot = document.getElementById('session-status-dot');
const sessionStatusPillText = document.getElementById('session-status-pill-text');
const btnCloseCompanion = document.getElementById('btn-close-companion');

// No-Companion-support fallback's own live monitoring view.
const fallbackHeadingEl = document.getElementById('fallback-mon-heading');
const fallbackCircleContainer = document.getElementById('fallback-circle-container');
const btnFallbackStop = document.getElementById('btn-fallback-stop');

const allStates = {
  a: stateA,
  profileSelect: stateProfileSelect,
  calibrating: stateCalibrating,
  calibrationFailed: stateCalibrationFailed,
  calibrated: stateCalibrated,
  sessionStatus: stateSessionStatus,
  fallbackMonitor: stateFallbackMonitor,
};

// =============================================================================
// View Transitions (opacity-only fade, no translateY)
// =============================================================================

// visibleEl tracks the element ACTUALLY on screen right now (only updated
// once a fade-out has genuinely finished and the swap has genuinely
// happened) — deliberately not derived by scanning classList each call,
// which is what the previous version of this function did and got wrong
// under rapid back-to-back calls. Session calibration's own mic-permission
// rejection can resolve within a few microtasks of the Calibrate click that
// started it (this environment, and some real browsers, don't need real
// async delay to determine access is already blocked) — well before the
// first transition's own FADE_OUT_MS timeout had fired. Scanning classList
// at that point still found the ORIGINAL screen as "current" (nothing had
// been hidden yet), so the second call redundantly started fading THAT
// same element out a second time via its own independent timeout — and
// when both timeouts eventually fired, each hid the (already-hidden)
// original element and unhid its OWN target, leaving two different targets
// unhidden at once (whichever the caller checked for first "won").
//
// pendingTarget is what actually fixes the rapid-call case: while a
// fade-out is already in flight, a new call doesn't start a second,
// independent fade — it just updates pendingTarget, and the ALREADY-
// scheduled timeout below reads that fresh value when it fires. The
// outgoing element is only ever captured, faded, and hidden once per
// fade-out, however many times the destination gets redirected mid-flight.
let visibleEl = null;
let pendingTarget = null;
let pendingTransitionTimeout = null;

function transitionToState(name) {
  const nextEl = allStates[name];
  if (!nextEl) return;

  // Nothing shown yet (initial load) — render directly, no fade.
  if (!visibleEl) {
    Object.entries(allStates).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    visibleEl = nextEl;
    return;
  }

  // Already showing the target, and no fade in flight that could carry it
  // somewhere else — genuinely nothing to do.
  if (visibleEl === nextEl && pendingTransitionTimeout === null) return;

  pendingTarget = name;

  if (pendingTransitionTimeout !== null) {
    // A fade-out is already in flight — redirect where it lands instead of
    // starting a second, independent one on the same outgoing element.
    return;
  }

  const outgoingEl = visibleEl;
  outgoingEl.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  outgoingEl.style.opacity = '0';

  pendingTransitionTimeout = setTimeout(() => {
    pendingTransitionTimeout = null;
    outgoingEl.classList.add('hidden');
    outgoingEl.style.transition = '';
    outgoingEl.style.opacity = '';

    // Read fresh — pendingTarget may have been redirected one or more
    // times since this timeout was originally scheduled.
    const targetEl = allStates[pendingTarget];
    visibleEl = targetEl;

    targetEl.style.opacity = '0';
    targetEl.classList.remove('hidden');

    requestAnimationFrame(() => {
      targetEl.style.transition = `opacity ${FADE_IN_MS}ms ease`;
      requestAnimationFrame(() => {
        targetEl.style.opacity = '';

        setTimeout(() => {
          targetEl.style.transition = '';
        }, FADE_IN_MS + 50);
      });
    });
  }, FADE_OUT_MS);
}

// =============================================================================
// Profile Selection Screen
// =============================================================================

// This tab's current radio selection among saved profiles — distinct from
// getSelectedProfile()/setSelectedProfile() (cross-screen session state):
// selecting a row here only changes which profile Start Monitoring would act
// on next, matching docs/ux/speaking-profile-flow.md's "Selecting a saved
// profile... Does not navigate... Does not begin monitoring."
let selectedSavedProfileId = null;

function renderProfileSelect() {
  const saved = getSavedProfiles();

  // No saved profiles → the single "Calibrate" path in, per
  // docs/ux/speaking-profile-flow.md's "No Saved Profiles" state: no guided
  // choice, no separate "Calibrate for this session" link, nothing to select.
  const hasSaved = saved.length > 0;
  savedProfilesHeadingRow.classList.toggle('hidden', !hasSaved);
  profileLibrary.classList.toggle('hidden', !hasSaved);
  savedProfilesCount.textContent = `${saved.length} / ${MAX_SAVED_PROFILES}`;

  savedProfilesList.innerHTML = '';

  // Prefer the current selection if it's still valid (a resolved cross-tab
  // last-used profile, or whatever the user already picked this visit) —
  // only fall back to the first saved profile when there's genuinely
  // nothing else to go on, so a returning user's own profile stays
  // pre-selected rather than always jumping to the top of the list.
  if (!saved.some((p) => p.id === selectedSavedProfileId)) {
    const resolvedId = getSelectedProfile()?.id;
    selectedSavedProfileId = saved.some((p) => p.id === resolvedId) ? resolvedId : (saved[0]?.id ?? null);
  }

  for (const profile of saved) {
    const radioId = `profile-radio-saved-${profile.id}`;
    const row = document.createElement('div');
    row.className = 'profile-row profile-row-saved';
    row.innerHTML = `
      <label class="profile-row-radio-label" for="${radioId}">
        <input type="radio" name="profile-library-choice" id="${radioId}" class="radio-input">
        <span class="radio-visual" aria-hidden="true"></span>
        <span class="profile-row-name profile-row-name--sm"></span>
      </label>
      <button type="button" class="profile-row-recalibrate">Recalibrate</button>
      <button type="button" class="btn-delete" aria-label="Delete profile"></button>
    `;
    row.querySelector('.profile-row-name').textContent = profile.name;

    const radio = row.querySelector('.radio-input');
    radio.checked = profile.id === selectedSavedProfileId;
    radio.addEventListener('change', () => {
      selectedSavedProfileId = profile.id;
    });

    const recalBtn = row.querySelector('.profile-row-recalibrate');
    recalBtn.setAttribute('aria-label', `Recalibrate ${profile.name}`);
    recalBtn.addEventListener('click', () => beginCalibrationFlow('recalibrate', profile.id));

    const deleteBtn = row.querySelector('.btn-delete');
    deleteBtn.setAttribute('aria-label', `Delete ${profile.name} profile`);
    deleteBtn.innerHTML = '<svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true"><path d="M1 3.5h11M4.5 3.5V2h4v1.5M5.5 6.5v4M7.5 6.5v4M2 3.5l.8 8.5h7.4l.8-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      handleDeleteClick(profile, deleteBtn);
    });

    savedProfilesList.appendChild(row);
  }

  btnProfilePrimary.textContent = hasSaved ? 'Start Monitoring' : 'Calibrate';
  btnProfilePrimary.disabled = hasSaved && !selectedSavedProfileId;

  transitionToState('profileSelect');
}

/** Primary CTA — "Calibrate" with zero saved profiles (begins session
 *  calibration directly); "Start Monitoring" with one or more (acts on
 *  whichever row is currently selected). Rows themselves only select. */
function handleProfilePrimaryClick() {
  const saved = getSavedProfiles();
  if (saved.length === 0) {
    beginCalibrationFlow('session', null);
    return;
  }
  const profile = saved.find((p) => p.id === selectedSavedProfileId);
  if (!profile) return; // primary is disabled in this case; defensive
  chooseSavedProfile(profile);
}

/** Uses the persisted saved-profile object directly — {id, name, speakingDb,
 *  spreadDb, calibratedTs} — the one canonical shape for a saved-profile
 *  monitoring session. No wrapper object; see CLAUDE.md's Profile Model. */
function chooseSavedProfile(profile) {
  setSelectedProfile(profile);
  startMonitoringForProfile(profile);
}

// =============================================================================
// Delete Profile
// =============================================================================

// Set while the confirmation dialog is open; cleared on Cancel or Delete.
let pendingDeleteProfileId = null;
let pendingDeleteTriggerBtn = null;

function handleDeleteClick(profile, triggerBtn) {
  pendingDeleteProfileId = profile.id;
  pendingDeleteTriggerBtn = triggerBtn;
  deleteDialogName.textContent = profile.name;
  deleteDialogOverlay.classList.remove('hidden');
  btnDeleteCancel.focus();
}

function closeDeleteDialog() {
  deleteDialogOverlay.classList.add('hidden');
  pendingDeleteTriggerBtn?.focus();
  pendingDeleteProfileId = null;
  pendingDeleteTriggerBtn = null;
}

function handleDeleteCancel() {
  closeDeleteDialog();
}

/** docs/ux/speaking-profile-flow.md's "Deleting the Selected Profile": if the
 *  deleted profile was selected, select another remaining one automatically;
 *  if none remain, the page returns to the No Saved Profiles state on its
 *  own (renderProfileSelect() is fully data-driven off getSavedProfiles()). */
function handleDeleteConfirm() {
  if (!pendingDeleteProfileId) return;
  const deletedId = pendingDeleteProfileId;
  const remaining = getSavedProfiles().filter((p) => p.id !== deletedId);
  saveSavedProfiles(remaining);

  if (selectedSavedProfileId === deletedId) {
    selectedSavedProfileId = remaining[0]?.id ?? null;
  }
  const current = getSelectedProfile();
  if (current?.id === deletedId) {
    setSelectedProfile(null);
  }
  // No stored reference should ever point at a missing profile — see
  // CLAUDE.md's Profile Model. mezzoLastUsedProfile is cross-tab/cross-
  // session (localStorage), so it can just as easily point at a profile
  // deleted from a *different* tab as this one.
  if (getLastUsedProfile()?.id === deletedId) {
    clearLastUsedProfile();
  }

  deleteDialogOverlay.classList.add('hidden');
  pendingDeleteProfileId = null;
  pendingDeleteTriggerBtn = null;
  // The deleted row no longer exists once the list rebuilds, so — unlike
  // Cancel — there's no original control to return focus to. The primary
  // CTA is the one stable landing spot regardless of which layout results.
  renderProfileSelect();
  btnProfilePrimary.focus();
}

// =============================================================================
// Start monitoring with the given profile — the Speaking Profile page's
// primary CTA (or a Calibrated screen's own commit action) is the only route
// in, with no "You're All Set" screen and no separate Companion Ready
// confirmation for this first session: opening the Companion and starting
// monitoring happen as one action. Called from a real click (a genuine user
// gesture, which is what Document PiP requires) in every caller.
// =============================================================================

async function startMonitoringForProfile(profile) {
  if (pipSupported) {
    transitionToState('sessionStatus');
    await session.startMonitoring(profile);
  } else {
    session.setActiveProfile(profile);
    const ok = await session.startFallbackMonitoring(fallbackCircleContainer);
    if (ok) transitionToState('fallbackMonitor');
  }
}

// =============================================================================
// Toast (transient confirmation — e.g. after saving a custom profile)
// =============================================================================

let toastTimeout = null;

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('toast-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('toast-visible'), 3200);
}

// =============================================================================
// Calibration Ring Canvas
// =============================================================================

function setCalRingEnergy(value) {
  if (calRingCanvas) calRingCanvas.dataset.energy = String(value);
}

// =============================================================================
// Mic Permission Request
// =============================================================================

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    // Permission granted — stop the stream (we just needed the prompt)
    stream.getTracks().forEach(track => track.stop());

    goToInitialScreen();
  } catch (error) {
    console.warn('[TryIt] Microphone access denied:', error.message);

    // Show denial help text
    if (deniedHelp) deniedHelp.classList.remove('hidden');
  }
}

// =============================================================================
// Calibrating / Calibration Failed / Calibrated — driven entirely by the
// shared calibration controller (session.calibrationController, the same
// instance the Mezzo Companion uses — see its export comment in
// src/mezzo-session.js). This module owns none of the calibration business
// logic or storage writes itself; it only renders the controller's state and
// calls its methods, mirroring src/mezzo-session.js's own screen builders.
// =============================================================================

let unsubscribeCalibrationLevel = null;

// Set only when the most recent Calibration Failed screen was shown because
// calibrationLock.acquire() was rejected (another tab holds it), not because
// the controller itself failed — see beginCalibrationFlow() and
// handleFailedTryAgain() below. In that one case, no controller run ever
// started, so "Try Again" must re-attempt the lock via beginCalibrationFlow()
// itself rather than calling calibrationController.retry(), which would
// throw (there is nothing to retry — status is still 'idle').
let pendingLockedAttempt = null;

/**
 * Starts a calibration run (session or recalibrate) and shows the
 * Calibrating screen. Synchronous startXxx() misuse errors (an unknown
 * recalibration target, or calling this while already calibrating) are
 * caught here and fall back to profile-select — actual calibration failures
 * (silence, unstable environment, mic permission) are not exceptions, they
 * arrive asynchronously via the controller's own state and are handled by
 * the subscribe() listener set up above.
 */
function beginCalibrationFlow(mode, targetProfileId) {
  // Checked first, before any Calibrating-screen transition or mic/
  // controller involvement — a rejection here means a different tab
  // genuinely holds the cross-tab lease right now (see
  // src/calibration-lock.js), so this attempt goes straight to the
  // Calibration Failed screen instead of ever showing Calibrating.
  if (!calibrationLock.acquire()) {
    pendingLockedAttempt = { mode, targetProfileId };
    showFailedScreen({ code: 'CROSS_TAB_LOCKED' });
    return;
  }
  pendingLockedAttempt = null;

  const targetName = targetProfileId
    ? getSavedProfiles().find((p) => p.id === targetProfileId)?.name ?? null
    : null;

  if (calibratingSubheading) {
    calibratingSubheading.textContent = mode === 'recalibrate' && targetName ? `Recalibrating ${targetName}` : '';
  }
  setCalRingEnergy(0);
  transitionToState('calibrating');
  unsubscribeCalibrationLevel = calibrationController.subscribeToLevel((rms) => setCalRingEnergy(rmsToEnergy(rms)));

  try {
    if (mode === 'recalibrate') {
      calibrationController.startRecalibration(targetProfileId, CALIBRATION_OWNERS.MAIN_PAGE);
    } else {
      calibrationController.startSessionCalibration(CALIBRATION_OWNERS.MAIN_PAGE);
    }
  } catch (err) {
    console.error('[TryIt] Could not start calibration:', err.message);
    calibrationLock.release(); // acquired above, but the controller never actually started
    stopCalibrationLevelSubscription();
    renderProfileSelect();
  }
}

function stopCalibrationLevelSubscription() {
  if (unsubscribeCalibrationLevel) {
    unsubscribeCalibrationLevel();
    unsubscribeCalibrationLevel = null;
  }
  setCalRingEnergy(0);
}

function handleCalibratingCancel() {
  calibrationController.cancel();
  stopCalibrationLevelSubscription();
  renderProfileSelect();
}

function showFailedScreen(failure) {
  stopCalibrationLevelSubscription();
  if (calibrationFailedMessage) calibrationFailedMessage.textContent = calibrationFailureMessage(failure);
  transitionToState('calibrationFailed');
}

/** Try Again — retry() re-enters the same mode and, in recalibrate mode,
 *  the same target, so this alone is what keeps session mode session and
 *  recalibration targeted at the same saved profile across a retry. When the
 *  Calibration Failed screen is showing because of a cross-tab lock
 *  rejection (pendingLockedAttempt set), no controller run ever started, so
 *  this re-attempts via beginCalibrationFlow() — re-checking the lock fresh —
 *  instead of calling retry(), which would throw from an idle controller. */
function handleFailedTryAgain() {
  if (pendingLockedAttempt) {
    const { mode, targetProfileId } = pendingLockedAttempt;
    beginCalibrationFlow(mode, targetProfileId);
    return;
  }
  setCalRingEnergy(0);
  transitionToState('calibrating');
  unsubscribeCalibrationLevel = calibrationController.subscribeToLevel((rms) => setCalRingEnergy(rmsToEnergy(rms)));
  try {
    calibrationController.retry();
  } catch (err) {
    console.error('[TryIt] Could not retry calibration:', err.message);
    calibrationController.cancel();
    stopCalibrationLevelSubscription();
    renderProfileSelect();
  }
}

function handleFailedBack() {
  calibrationController.cancel();
  renderProfileSelect();
}

function showCalibratedStep(step) {
  calibratedStepCheckpoint?.classList.toggle('hidden', step !== 'checkpoint');
  calibratedStepName?.classList.toggle('hidden', step !== 'name');
}

/**
 * Renders the mode-aware Calibrated checkpoint. Nothing is persisted merely
 * by this rendering — every field here is read-only display text; the only
 * paths that ever write to storage are the explicit commit handlers below
 * (handleCalibratedPrimary/Secondary/NameSubmit).
 */
function showCalibratedScreen(state) {
  stopCalibrationLevelSubscription();
  const { mode } = state;
  if (calibratedError) { calibratedError.classList.add('hidden'); calibratedError.textContent = ''; }
  showCalibratedStep('checkpoint');

  if (mode === 'recalibrate') {
    const name = calibrationController.getTargetSnapshot()?.name ?? 'this profile';
    if (calibratedHeading) calibratedHeading.textContent = `New calibration ready for ${name}.`;
    if (btnCalibratedPrimary) btnCalibratedPrimary.textContent = `Update ${name} & Start Monitoring`;
    if (btnCalibratedSecondary) btnCalibratedSecondary.textContent = `Update ${name}`;
  } else {
    if (calibratedHeading) calibratedHeading.textContent = 'Your speaking range is ready.';
    if (btnCalibratedPrimary) btnCalibratedPrimary.textContent = 'Start Monitoring';
    if (btnCalibratedSecondary) btnCalibratedSecondary.textContent = 'Save as New Profile';
  }

  transitionToState('calibrated');
}

function showCalibratedCommitError() {
  const err = calibrationController.getState().commitError;
  if (calibratedError) {
    calibratedError.textContent = err?.message || 'Something went wrong — please try again.';
    calibratedError.classList.remove('hidden');
  }
  // Stays on the checkpoint step with mode-aware buttons and the result
  // untouched — the controller's own state already guarantees the result
  // survives a failed commit; nothing further to do here.
}

/** "Start Monitoring" (session) / "Update {name} & Start Monitoring"
 *  (recalibrate) — the one commit path that also opens the Companion,
 *  immediately after committing. */
async function handleCalibratedPrimary() {
  const { mode } = calibrationController.getState();
  let profile;
  if (mode === 'recalibrate') {
    const updated = calibrationController.commitUpdateProfileAndStartMonitoring();
    if (!updated) { showCalibratedCommitError(); return; }
    profile = updated; // already the canonical direct saved-profile shape (id, name, speakingDb, spreadDb, calibratedTs)
  } else {
    profile = calibrationController.commitStartMonitoring();
  }
  setSelectedProfile(profile);
  await startMonitoringForProfile(profile);
}

/** "Save as New Profile" (session, opens the naming step) / "Update
 *  {name}" (recalibrate, commits immediately — no naming needed, the
 *  identity already exists). */
function handleCalibratedSecondary() {
  const { mode } = calibrationController.getState();
  if (mode === 'recalibrate') {
    const updated = calibrationController.commitUpdateProfile();
    if (!updated) { showCalibratedCommitError(); return; }
    setSelectedProfile(updated); // canonical direct saved-profile shape
    selectedSavedProfileId = updated.id;
    renderProfileSelect();
    showToast(`${updated.name} updated.`);
    return;
  }
  if (profileNameInput) profileNameInput.value = '';
  showCalibratedStep('name');
  requestAnimationFrame(() => profileNameInput?.focus());
}

function handleCalibratedBack() {
  calibrationController.cancel();
  renderProfileSelect();
}

/** Names and persists the new profile, then returns to Choose a Speaking
 *  Profile (now showing the profile library, this profile selected) with a
 *  confirmation toast — it does not open the Companion automatically. */
function handleNameFormSubmit(event) {
  event.preventDefault();
  const name = profileNameInput?.value.trim();
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
  setSelectedProfile(saved); // canonical direct saved-profile shape
  selectedSavedProfileId = saved.id;
  renderProfileSelect();
  showToast('Speaking profile saved.');
}

function handleNameBack() {
  showCalibratedStep('checkpoint');
}

// =============================================================================
// Session Status View (companionReady / monitoringActive) + Companion-closed
// routing back to the profile library
// =============================================================================

// No "bring to front" / "show" control anywhere — the Mezzo Companion is a
// Document PiP window and already stays above other windows on its own, so
// a focus/raise action would be misleading. This page reports status only,
// with no action of its own at all — there is no End Session control here;
// closing this page (which the footer copy says explicitly) or the
// Companion's own native ✕ are the only ways to end things. Mezzo never
// offers a softer "stop but keep everything open" action; that's what the
// Companion's own Stop button is for.
const SESSION_VIEW_COPY = {
  [session.SESSION_STATES.COMPANION_READY]: { active: false },
  [session.SESSION_STATES.MONITORING_ACTIVE]: { active: true },
};

function renderSessionStatusView(state) {
  const copy = SESSION_VIEW_COPY[state];
  if (!copy) return;
  if (sessionStatusDot) sessionStatusDot.classList.toggle('session-status-dot-inactive', !copy.active);
  if (sessionStatusPillText) {
    sessionStatusPillText.textContent = copy.active ? 'Monitoring is active.' : 'Monitoring is inactive.';
  }
}

/**
 * Whenever the Companion closes — native ✕ or End Session — Mezzo returns to
 * the profile library, rather than showing a "Companion is closed" status
 * screen. This is the single place that routing happens, so every close path
 * (including ones this page didn't itself initiate) converges on the same
 * behavior.
 *
 * selectedSavedProfileId is reset to null first, forcing renderProfileSelect()
 * to re-resolve the radio selection from getSelectedProfile() rather than
 * trusting whatever it was locally before the Companion opened — the
 * Companion's own Ready screen (row selection, Stop-time Save Prompt) can
 * change sessionStorage's selection mid-session, on the exact same
 * cross-tab-shared storage, without this page's own module-scoped variable
 * ever finding out. Without this reset, returning here could silently show
 * a stale selection that no longer matches what was actually last active.
 */
function handleSessionStateChange(state) {
  if (state === session.SESSION_STATES.COMPANION_CLOSED) {
    selectedSavedProfileId = null;
    renderProfileSelect();
    return;
  }
  renderSessionStatusView(state);
}

// =============================================================================
// Initial Screen Routing
// =============================================================================

/**
 * After mic permission is confirmed granted, land on Choose a Speaking
 * Profile, which pre-selects a resolvable profile (this tab's own selection,
 * or the cross-tab last-used profile) via renderProfileSelect()'s own
 * fallback logic. Opening the Companion always needs a fresh click here
 * regardless — Document PiP requires a genuine user gesture on this
 * document, which a page load never has.
 */
function goToInitialScreen() {
  resolveActiveProfile(); // syncs this tab's selection from the cross-tab last-used profile, if any
  renderProfileSelect();
}

async function detectInitialState() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });

    if (result.state === 'granted') {
      goToInitialScreen();
    } else {
      // 'prompt' or 'denied' — show State A
      transitionToState('a');

      if (result.state === 'denied' && deniedHelp) {
        deniedHelp.classList.remove('hidden');
      }
    }
  } catch {
    // permissions.query not supported — default to State A
    transitionToState('a');
  }
}

// =============================================================================
// Event Binding
// =============================================================================

btnEnableMic?.addEventListener('click', requestMicPermission);
btnCalibrateSession?.addEventListener('click', () => beginCalibrationFlow('session', null));
btnProfilePrimary?.addEventListener('click', handleProfilePrimaryClick);

btnCalibratingCancel?.addEventListener('click', handleCalibratingCancel);
btnFailedTryAgain?.addEventListener('click', handleFailedTryAgain);
btnFailedBack?.addEventListener('click', handleFailedBack);
btnCalibratedPrimary?.addEventListener('click', handleCalibratedPrimary);
btnCalibratedSecondary?.addEventListener('click', handleCalibratedSecondary);
btnCalibratedBack?.addEventListener('click', handleCalibratedBack);
btnNameBack?.addEventListener('click', handleNameBack);
nameForm?.addEventListener('submit', handleNameFormSubmit);

btnDeleteCancel?.addEventListener('click', handleDeleteCancel);
btnDeleteConfirm?.addEventListener('click', handleDeleteConfirm);
// Clicking the dimmed backdrop (not the dialog card itself) cancels, same as Cancel.
deleteDialogOverlay?.addEventListener('click', (event) => {
  if (event.target === deleteDialogOverlay) handleDeleteCancel();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !deleteDialogOverlay.classList.contains('hidden')) handleDeleteCancel();
});

btnFallbackStop?.addEventListener('click', () => session.stopMonitoring());
// Same effect as the Companion's own native ✕ (session.endSession() closes
// the pipWindow and stops monitoring) — a page-side recovery path for when
// the floating window itself isn't reachable, not a second "end session"
// decision. See the DOM-ref comment above and CLAUDE.md.
btnCloseCompanion?.addEventListener('click', () => session.endSession());

// =============================================================================
// Init
// =============================================================================

pageEnter();

if (isDemo) {
  transitionToState('fallbackMonitor');
  session.startDemo(fallbackCircleContainer);
} else {
  detectInitialState();
}

trackAppOpened(getSelectedProfile() !== null);
