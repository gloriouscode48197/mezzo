/**
 * Mezzo — Session Window Controller
 *
 * try-it.js is Mezzo: onboarding (mic permission, profile choice,
 * calibration) *and* the session-owning page once a profile is chosen —
 * there is no second window in between. The Speaking Profile screen's
 * primary CTA ("Start Monitoring" / "Set Up Profile") is the sole trigger for
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
 *   a:                Mic permission not granted → show enable mic prompt
 *   profile-select:   Choose a Speaking Profile — Everyday Conversation, Create a Speaking
 *                     Profile, or a saved profile (guided-choice vs profile-library layout).
 *                     Its primary CTA is the only way to start monitoring (opening the
 *                     Companion directly into Monitoring) or begin custom profile
 *                     creation — see startMonitoringForProfile(). Also where Mezzo lands
 *                     after the Companion closes, for any reason.
 *   b:                Calibration (creates a custom profile) — landing + listening. On
 *                     finishing, always opens the save dialog (see below) as an overlay on
 *                     top of the still-visible listening screen — there is no session-only
 *                     "use once without saving" path, and no profile is selected yet.
 *
 * Save dialog (#save-dialog-overlay): a modal overlay, not a state — opened by
 * finishCalibration() on top of "b", never a separate full-page view. Two steps toggled
 * in place, never a second modal:
 *   prompt: "Save this profile?" — Save goes to the "name" step; Try Again discards this
 *           take and restarts calibration capture directly; Discard abandons the
 *           calibration result entirely and returns to profile-select. No temporary
 *           profile is ever created by any of these.
 *   name:   Name the just-calibrated profile before saving it. Back returns to "prompt"
 *           without losing the result. On submit, closes the dialog and returns to
 *           profile-select (now showing the profile library, the new profile
 *           auto-selected) with a confirmation toast — does not open the Companion
 *           automatically.
 *   session-status:   Companion-capable browsers only — the status/recovery view for the
 *                     two sessionState values reachable while the Companion is open
 *                     (companionReady / monitoringActive). Reached the moment Start
 *                     Monitoring is clicked, and shown for as long as the Companion stays
 *                     open. When the Companion closes (companionClosed), Mezzo navigates
 *                     back to profile-select instead of showing status copy here.
 *   fallback-monitor: The no-Companion-support fallback's own live monitoring view (dark,
 *                     in-page circle) — the one case where monitoring itself is shown here.
 *   return-to-pip:    Reached only via ?entry=create-profile (opened from the Companion's
 *                     "+ Create New Profile...", which closes the Companion first) — hands
 *                     the new profile back to the original tab via BroadcastChannel, instead
 *                     of becoming a session owner itself.
 *
 * Profile storage lives in src/profiles.js — see that file for the three storage layers
 * (saved-profile library, this-tab selection, cross-tab last-used).
 */

import { AudioProcessor } from './src/audio.js?v=2';
import { MezzoEngine } from './src/engine.js?v=5';
import { pageEnter } from './src/page-transition.js';
import { trackAppOpened, trackCalibrationCompleted } from './src/analytics.js';
import { createMezzoSession } from './src/mezzo-session.js';
import {
  RECOMMENDED_PROFILE,
  getSavedProfiles,
  saveSavedProfiles,
  getSelectedProfile,
  setSelectedProfile,
  resolveActiveProfile,
} from './src/profiles.js';

// =============================================================================
// Constants
// =============================================================================

const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;
const COUNTDOWN_SECONDS = 6;

// Maps live RMS to the calibration ring canvas's 0–1 "energy" scale (see the
// inline visualization script in try-it.html). There's no baseline yet
// during calibration, so this uses a fixed dB reference range rather than
// engine.js's zone classification: silence sits near 0, a normal/moderate
// speaking level lands around the middle, loud speech approaches 1.
const ENERGY_DB_MIN = -50;
const ENERGY_DB_MAX = -10;
function rmsToEnergy(rms) {
  const db = 20 * Math.log10(rms + 1e-10);
  return Math.min(1, Math.max(0, (db - ENERGY_DB_MIN) / (ENERGY_DB_MAX - ENERGY_DB_MIN)));
}

// Set when opened from the Companion's "+ Create New Profile..." — a genuinely new tab
// (Document PiP doesn't survive its opener navigating, so this can never be the same tab
// that owns an open Companion). Skips straight to calibration and, on completion, hands
// the profile back via BroadcastChannel instead of ever becoming a session owner itself.
const isCreateProfileEntry = new URLSearchParams(window.location.search).get('entry') === 'create-profile';
const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';
const profileSyncChannel = new BroadcastChannel('mezzo-profile-sync');

// =============================================================================
// Instances
// =============================================================================

// Calibration-only — separate from the real session's own audio/engine
// instances owned by src/mezzo-session.js. Released as soon as calibration
// finishes; never touches the mic again after that.
const audio = new AudioProcessor();
const engine = new MezzoEngine();

const session = createMezzoSession({
  baseUrl: new URL('.', window.location.href).href,
  onSessionStateChange: handleSessionStateChange,
  onFallbackHeadingChange: (text) => { if (fallbackHeadingEl) fallbackHeadingEl.textContent = text; },
  onFallbackMonitoringStop: () => renderProfileSelect(),
  onProfileSynced: () => { if (!stateProfileSelect.classList.contains('hidden')) renderProfileSelect(); },
});
const pipSupported = session.isPipSupported();

// The ?entry=create-profile tab never becomes a session owner — no listeners,
// no beforeunload/pagehide teardown responsibility for it.
if (!isCreateProfileEntry) session.init(null);

// =============================================================================
// DOM References
// =============================================================================

const stateA = document.getElementById('state-a');
const stateProfileSelect = document.getElementById('state-profile-select');
const stateB = document.getElementById('state-b');
const stateSessionStatus = document.getElementById('state-session-status');
const stateFallbackMonitor = document.getElementById('state-fallback-monitor');
const stateReturnToPip = document.getElementById('state-return-to-pip');

const btnEnableMic = document.getElementById('btn-enable-mic');
const profileGuided = document.getElementById('profile-guided');
const profileLibrary = document.getElementById('profile-library');
const radioRecommendedGuided = document.getElementById('profile-radio-recommended');
const radioCustomGuided = document.getElementById('profile-radio-custom');
const radioRecommendedLibrary = document.getElementById('profile-radio-recommended-lib');
const savedProfilesList = document.getElementById('saved-profiles-list');
const btnCreateNewProfile = document.getElementById('btn-create-new-profile');
const profileSlotsRemaining = document.getElementById('profile-slots-remaining');
const profileLimitMessage = document.getElementById('profile-limit-message');
const btnProfilePrimary = document.getElementById('btn-profile-primary');
const deleteDialogOverlay = document.getElementById('delete-dialog-overlay');
const deleteDialogName = document.getElementById('delete-dialog-name');
const btnDeleteConfirm = document.getElementById('btn-delete-confirm');
const btnDeleteCancel = document.getElementById('btn-delete-cancel');
const btnCalibrationBack = document.getElementById('btn-calibration-back');
const btnStartCalibration = document.getElementById('btn-start-calibration');

// Save-profile modal — one overlay, two steps, never a second modal (see
// the HTML comment above #save-dialog-overlay).
const saveDialogOverlay = document.getElementById('save-dialog-overlay');
const saveStepPrompt = document.getElementById('save-step-prompt');
const saveStepName = document.getElementById('save-step-name');
const btnSaveProfile = document.getElementById('btn-save-profile');
const btnTryAgain = document.getElementById('btn-try-again');
const btnDiscardCalibration = document.getElementById('btn-discard-calibration');
const nameForm = document.getElementById('name-form');
const profileNameInput = document.getElementById('profile-name-input');
const btnNameBack = document.getElementById('btn-name-back');

const deniedHelp = document.getElementById('denied-help');
const toastEl = document.getElementById('toast');

const listeningHeading = document.getElementById('listening-heading');
const calRingCanvas = document.getElementById('cal-ring-canvas');

// Session status view — the status/recovery surface for companionReady/monitoringActive.
const sessionStatusHeading = document.getElementById('session-status-heading');
const sessionStatusLabel = document.getElementById('session-status-label');
const sessionStatusText = document.getElementById('session-status-text');
const btnEndSession = document.getElementById('btn-end-session');

// No-Companion-support fallback's own live monitoring view.
const fallbackHeadingEl = document.getElementById('fallback-mon-heading');
const fallbackCircleContainer = document.getElementById('fallback-circle-container');
const btnFallbackStop = document.getElementById('btn-fallback-stop');

const allStates = {
  a: stateA,
  profileSelect: stateProfileSelect,
  b: stateB,
  sessionStatus: stateSessionStatus,
  fallbackMonitor: stateFallbackMonitor,
  returnToPip: stateReturnToPip,
};

// =============================================================================
// Calibration State
// =============================================================================

let rmsBuffer = [];
let countdownInterval = null;

// The profile just calibrated this session, pending a save/discard decision.
let pendingCalibratedProfile = null;

// =============================================================================
// View Transitions (opacity-only fade, no translateY)
// =============================================================================

function transitionToState(name) {
  const entries = Object.entries(allStates);
  const currentEntry = entries.find(([, el]) => !el.classList.contains('hidden'));
  const nextEl = allStates[name];

  if (!nextEl) return;

  // If no current state visible (initial load), just show the target
  if (!currentEntry || currentEntry[1] === nextEl) {
    entries.forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    return;
  }

  const currentEl = currentEntry[1];

  // Fade out current
  currentEl.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  currentEl.style.opacity = '0';

  setTimeout(() => {
    currentEl.classList.add('hidden');
    currentEl.style.transition = '';
    currentEl.style.opacity = '';

    // Fade in next
    nextEl.style.opacity = '0';
    nextEl.classList.remove('hidden');

    requestAnimationFrame(() => {
      nextEl.style.transition = `opacity ${FADE_IN_MS}ms ease`;
      requestAnimationFrame(() => {
        nextEl.style.opacity = '';

        setTimeout(() => {
          nextEl.style.transition = '';
        }, FADE_IN_MS + 50);
      });
    });
  }, FADE_OUT_MS);
}

// =============================================================================
// Profile Selection Screen
// =============================================================================

function renderProfileSelect() {
  const saved = getSavedProfiles();

  // Data-driven layout: no saved custom profiles → guided choice;
  // one or more → profile library. See docs/ux/speaking-profile-flow.md.
  const isLibrary = saved.length > 0;
  profileGuided.classList.toggle('hidden', isLibrary);
  profileLibrary.classList.toggle('hidden', !isLibrary);

  // Radios are selection-only here — see chooseRecommended()/chooseSavedProfile()/
  // goToCalibrationLanding(), which now only run from the primary CTA
  // (handleProfilePrimaryClick) or the always-immediate Create New action.
  savedProfilesList.innerHTML = '';
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
      <button type="button" class="btn-delete" aria-label="Delete profile"></button>
    `;
    row.querySelector('.profile-row-name').textContent = profile.name;
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

  // Five-profile limit — the create link + slots-remaining count is replaced
  // by a plain status message at 5/5, never a disabled link.
  const atLimit = saved.length >= 5;
  btnCreateNewProfile.classList.toggle('hidden', atLimit);
  profileSlotsRemaining.classList.toggle('hidden', atLimit);
  profileSlotsRemaining.textContent = `(${5 - saved.length} slots remaining)`;
  profileLimitMessage.classList.toggle('hidden', !atLimit);

  // Everyday Conversation is selected by default whenever no valid selected
  // profile exists — e.g. no selection yet, or a stored savedProfileId that
  // no longer matches a saved profile.
  const current = getSelectedProfile();
  const currentSavedRadio = current?.savedProfileId
    ? savedProfilesList.querySelector(`#profile-radio-saved-${current.savedProfileId}`)
    : null;
  if (currentSavedRadio) {
    currentSavedRadio.checked = true;
  } else {
    radioRecommendedLibrary.checked = true;
  }
  radioRecommendedGuided.checked = true;
  radioCustomGuided.checked = false;

  updatePrimaryButtonLabel();
  transitionToState('profileSelect');
}

/** Guided state only — the CTA reflects the selected path; library state's CTA never changes. */
function updatePrimaryButtonLabel() {
  const inGuided = !profileGuided.classList.contains('hidden');
  btnProfilePrimary.textContent = inGuided && radioCustomGuided.checked ? 'Set Up Profile' : 'Start Monitoring';
}

/** Primary CTA — acts on whichever radio is currently selected. Rows themselves only select. */
function handleProfilePrimaryClick() {
  if (!profileGuided.classList.contains('hidden')) {
    if (radioCustomGuided.checked) {
      goToCalibrationLanding();
    } else {
      chooseRecommended();
    }
    return;
  }

  if (radioRecommendedLibrary.checked) {
    chooseRecommended();
    return;
  }
  const checkedSavedRadio = savedProfilesList.querySelector('.radio-input:checked');
  const savedId = checkedSavedRadio?.id.replace('profile-radio-saved-', '');
  const profile = savedId ? getSavedProfiles().find((p) => p.id === savedId) : null;
  profile ? chooseSavedProfile(profile) : chooseRecommended();
}

function chooseRecommended() {
  setSelectedProfile(RECOMMENDED_PROFILE);
  startMonitoringForProfile(RECOMMENDED_PROFILE);
}

/** "Create a speaking profile" / "Create New Speaking Profile" — go to calibration's landing view (not straight into capture). */
function goToCalibrationLanding() {
  transitionToState('b');
}

/** Back, from calibration's landing view only (not offered once listening starts) — returns to Choose a Speaking Profile without acquiring the mic. */
function handleCalibrationBack() {
  renderProfileSelect();
}

function chooseSavedProfile(profile) {
  const selected = {
    name: profile.name,
    speakingDb: profile.speakingDb,
    savedProfileId: profile.id,
  };
  setSelectedProfile(selected);
  startMonitoringForProfile(selected);
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

function handleDeleteConfirm() {
  if (!pendingDeleteProfileId) return;
  const deletedId = pendingDeleteProfileId;
  const remaining = getSavedProfiles().filter((p) => p.id !== deletedId);
  saveSavedProfiles(remaining);

  // Keep a valid profile selected — if the deleted profile was the current
  // selection, fall back to Everyday Conversation automatically.
  const current = getSelectedProfile();
  if (current?.savedProfileId === deletedId) {
    setSelectedProfile(RECOMMENDED_PROFILE);
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
// primary CTA is the only route in, with no "You're All Set" screen and no
// separate Companion Ready confirmation for this first session: opening the
// Companion and starting monitoring happen as one action. Called from a real
// click (a genuine user gesture, which is what Document PiP requires) in
// every caller.
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
// Calibration (creates a custom profile)
// =============================================================================

function resetCalibrationView() {
  stateB.classList.remove('state-listening');
  listeningHeading.textContent = `Listening...${COUNTDOWN_SECONDS}s`;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  setCalRingEnergy(0);
}

async function beginCalibrationCapture() {
  rmsBuffer = [];

  try {
    await audio.acquire();
  } catch (error) {
    console.error('[TryIt] Mic acquisition failed:', error.message);
    resetCalibrationView();
    transitionToState('a');
    return;
  }

  // Start ring animation
  setCalRingEnergy(0);

  // Collect RMS samples, and drive the ring canvas from the live level so it
  // reacts organically to the user's voice while they calibrate.
  audio.onLevelChange = ({ rms }) => {
    rmsBuffer.push(rms);
    setCalRingEnergy(rmsToEnergy(rms));
  };

  audio.startMonitoring();

  // Start countdown
  let remaining = COUNTDOWN_SECONDS;
  listeningHeading.textContent = `Listening...${remaining}s`;

  countdownInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      listeningHeading.textContent = `Listening...${remaining}s`;
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
      finishCalibration();
    }
  }, 1000);
}

async function startCalibration() {
  stateB.classList.add('state-listening');
  await beginCalibrationCapture();
}

function finishCalibration() {
  // Stop audio
  audio.stopMonitoring();
  audio.release();

  // Stop ring animation
  setCalRingEnergy(0);

  // Calibrate engine with collected RMS samples
  try {
    engine.calibrate(rmsBuffer);
  } catch (error) {
    console.error('[TryIt] Calibration failed:', error.message);
    resetCalibrationView();
    return;
  }

  const { baselineRMS } = engine.getCalibrationValues();
  const speakingDb = 20 * Math.log10(baselineRMS + 1e-10);

  // Held only transiently, long enough to be named+saved (handleSaveProfileClick
  // → handleNameFormSubmit), retried (handleTryAgain), or abandoned
  // (handleDiscardCalibration) — never persisted as the selected profile
  // before the user confirms saving. There is no temporary or session-only
  // profile state; calibration always ends in either a saved Custom Profile
  // or nothing at all.
  pendingCalibratedProfile = { speakingDb, calibratedTs: Date.now() };

  trackCalibrationCompleted();

  // Deliberately does NOT call resetCalibrationView() here — the save dialog
  // is an overlay on top of the (now-frozen) listening screen, not a
  // navigation away from it, so the ring/heading stay as they were until the
  // user actually leaves calibration (Discard) or finishes saving.
  openSaveDialog();
}

// =============================================================================
// Save Dialog — a single modal overlay with two steps ("prompt" and "name"),
// never a second modal. Opened by finishCalibration(); the listening screen
// underneath stays visible (frozen) for as long as it's open.
// =============================================================================

function showSaveDialogStep(step) {
  saveStepPrompt.classList.toggle('hidden', step !== 'prompt');
  saveStepName.classList.toggle('hidden', step !== 'name');
}

function openSaveDialog() {
  showSaveDialogStep('prompt');
  saveDialogOverlay.classList.remove('hidden');
}

function closeSaveDialog() {
  saveDialogOverlay.classList.add('hidden');
}

function handleSaveProfileClick() {
  profileNameInput.value = '';
  showSaveDialogStep('name');
  requestAnimationFrame(() => profileNameInput.focus());
}

/** Back — from the name step, return to the save-prompt step without losing the calibration result. */
function handleNameBack() {
  showSaveDialogStep('prompt');
}

/** Try Again — discard this take and restart calibration capture directly (no separate landing screen), reusing the mic permission granted earlier in state "a". */
async function handleTryAgain() {
  pendingCalibratedProfile = null;
  closeSaveDialog();
  await startCalibration();
}

/** Discard — abandon the unsaved calibration result entirely and return to Choose a Speaking Profile. No temporary profile is ever created. */
function handleDiscardCalibration() {
  pendingCalibratedProfile = null;
  resetCalibrationView();
  closeSaveDialog();
  // isCreateProfileEntry's tab never shows Choose a Speaking Profile (see
  // goToInitialScreen) — there's nothing to return to but calibration itself.
  if (isCreateProfileEntry) {
    transitionToState('b');
  } else {
    renderProfileSelect();
  }
}

/** Names and persists the new profile, then returns to Speaking Profile (now showing the profile library, this profile auto-selected) with a confirmation toast — it does not open the Companion automatically. */
function handleNameFormSubmit(event) {
  event.preventDefault();
  const name = profileNameInput.value.trim();
  if (!name || !pendingCalibratedProfile) return;

  const saved = getSavedProfiles();
  const id = crypto.randomUUID();
  const newProfile = { id, name, speakingDb: pendingCalibratedProfile.speakingDb, calibratedTs: pendingCalibratedProfile.calibratedTs };
  saved.push(newProfile);
  saveSavedProfiles(saved);

  const selected = { name, speakingDb: newProfile.speakingDb, savedProfileId: id };
  setSelectedProfile(selected);
  pendingCalibratedProfile = null;

  resetCalibrationView();
  closeSaveDialog();

  if (isCreateProfileEntry) {
    returnToPip(selected);
  } else {
    renderProfileSelect();
    showToast('Speaking profile saved.');
  }
}

// =============================================================================
// Session Status View (companionReady / monitoringActive) + Companion-closed
// routing back to the profile library
// =============================================================================

// No "bring to front" / "show" control anywhere — the Mezzo Companion is a
// Document PiP window and already stays above other windows on its own, so
// a focus/raise action would be misleading. This page reports status only,
// with no primary action of its own — the only action here is "End Session"
// (a full teardown). Mezzo never offers a softer "stop but keep everything
// open" action; that's what the Companion's own Stop button is for. There is
// deliberately no "companionClosed" entry — see handleSessionStateChange().
const SESSION_VIEW_COPY = {
  [session.SESSION_STATES.COMPANION_READY]: {
    heading: 'Mezzo Companion is open',
    statusLabel: 'Ready',
    body: "Start monitoring from the Mezzo Companion when you're ready.",
  },
  [session.SESSION_STATES.MONITORING_ACTIVE]: {
    heading: 'Monitoring is active',
    statusLabel: '',
    body: 'The Mezzo Companion will stay visible above your other windows.',
  },
};

function renderSessionStatusView(state) {
  const copy = SESSION_VIEW_COPY[state];
  if (!copy) return;
  if (sessionStatusHeading) sessionStatusHeading.textContent = copy.heading;
  if (sessionStatusLabel) {
    sessionStatusLabel.textContent = copy.statusLabel || '';
    sessionStatusLabel.classList.toggle('hidden', !copy.statusLabel);
  }
  if (sessionStatusText) sessionStatusText.textContent = copy.body;
}

/**
 * Whenever the Companion closes — native ✕, "Create New Profile...", or End
 * Session — Mezzo returns to the profile library with
 * the current profile still selected and "Start Monitoring" as the primary
 * CTA, rather than showing a "Companion is closed" status screen. This is
 * the single place that routing happens, so every close path (including
 * ones this page didn't itself initiate) converges on the same behavior.
 */
function handleSessionStateChange(state) {
  if (state === session.SESSION_STATES.COMPANION_CLOSED) {
    renderProfileSelect();
    return;
  }
  renderSessionStatusView(state);
}

// =============================================================================
// Return to PiP (only reached via ?entry=create-profile)
// =============================================================================

/**
 * Hand the freshly-created profile back to whichever tab owns the open
 * Companion, via BroadcastChannel — this tab never navigates that one
 * directly (Document PiP doesn't survive its opener navigating away), so
 * cross-tab messaging is the only way to close the loop.
 */
function returnToPip(profile) {
  profileSyncChannel.postMessage({ type: 'PROFILE_READY', profile });
  transitionToState('returnToPip');
}

// =============================================================================
// Initial Screen Routing
// =============================================================================

/**
 * After mic permission is confirmed granted, decide where to land:
 *   - ?entry=create-profile (opened from the Companion) → straight to calibration,
 *     skipping Choose a Profile entirely — the user already made that choice
 *     by clicking "+ Create New Profile..." there.
 *   - otherwise → Choose a Speaking Profile, which pre-selects a resolvable
 *     profile (this tab's own selection, or the cross-tab last-used profile)
 *     via renderProfileSelect()'s own fallback logic. Opening the Companion
 *     always needs a fresh click here regardless — Document PiP requires a
 *     genuine user gesture on this document, which a page load never has.
 */
function goToInitialScreen() {
  if (isCreateProfileEntry) {
    goToCalibrationLanding();
    return;
  }
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
radioRecommendedGuided?.addEventListener('change', updatePrimaryButtonLabel);
radioCustomGuided?.addEventListener('change', updatePrimaryButtonLabel);
btnCreateNewProfile?.addEventListener('click', goToCalibrationLanding);
btnProfilePrimary?.addEventListener('click', handleProfilePrimaryClick);
btnCalibrationBack?.addEventListener('click', handleCalibrationBack);
// This tab never shows Choose a Speaking Profile (see goToInitialScreen), so
// calibration's Back link — which would otherwise land there — has nowhere
// sensible to go and is hidden instead.
if (isCreateProfileEntry) btnCalibrationBack?.classList.add('hidden');
btnStartCalibration?.addEventListener('click', startCalibration);
btnSaveProfile?.addEventListener('click', handleSaveProfileClick);
btnTryAgain?.addEventListener('click', handleTryAgain);
btnDiscardCalibration?.addEventListener('click', handleDiscardCalibration);
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

// Always a full teardown, in every session state — Mezzo doesn't offer a
// softer "stop but keep everything open" action; that lives only inside
// the Companion itself (its own Stop button). endSession() sets sessionState
// to companionClosed, which handleSessionStateChange() already routes back
// to the profile library — no need to also call renderProfileSelect() here.
btnEndSession?.addEventListener('click', () => session.endSession());

btnFallbackStop?.addEventListener('click', () => session.stopMonitoring());

// Clean up calibration's own mic instance on unload — independent of
// src/mezzo-session.js's own beforeunload/pagehide teardown.
window.addEventListener('beforeunload', () => {
  audio.release();
});

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
