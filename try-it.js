/**
 * Mezzo — Session Window Controller
 *
 * try-it.js is Mezzo: onboarding (mic permission, profile choice,
 * calibration) *and* the session-owning page once a profile is chosen —
 * there is no second window in between. "Open Companion" opens the
 * Document Picture-in-Picture Mezzo Companion directly from that click
 * (a real gesture on this document, which is what Document PiP requires),
 * and this page transitions into a status/recovery view driven by
 * src/mezzo-session.js's `sessionState` for as long as the Companion stays
 * open — through any number of Start/Stop Monitoring cycles inside it.
 *
 * States, one visible at a time:
 *   a:                Mic permission not granted → show enable mic prompt
 *   profile-select:   Choose a Profile — Recommended, Create Custom Profile, or a saved profile
 *   b:                Calibration (creates a custom profile) — landing + listening
 *   save-prompt:      "Save this profile?" — Not Now / Save Profile
 *   name:             Name a profile before saving it
 *   ready:            Profile chosen — "You're All Set", pre-session screen. Its primary
 *                     button is "Open Companion" (Companion-capable browsers) or
 *                     "Start Monitoring" (the no-Companion-support fallback) — decided once,
 *                     never both.
 *   session-status:   Companion-capable browsers only — the 3-state status/recovery view
 *                     (companionReady / monitoringActive / companionClosed), reached after
 *                     "Open Companion" and shown for as long as a session exists.
 *   fallback-monitor: The no-Companion-support fallback's own live monitoring view (dark,
 *                     in-page circle) — the one case where monitoring itself is shown here.
 *   return-to-pip:    Reached only via ?entry=create-profile (opened from the Companion's
 *                     "+ Create New Profile...") — hands the new profile back to whichever
 *                     tab owns the open Companion via BroadcastChannel, instead of becoming
 *                     a session owner itself.
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
  onSessionStateChange: renderSessionStatusView,
  onFallbackHeadingChange: (text) => { if (fallbackHeadingEl) fallbackHeadingEl.textContent = text; },
  onFallbackMonitoringStop: () => transitionToState('ready'),
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
const stateSavePrompt = document.getElementById('state-save-prompt');
const stateName = document.getElementById('state-name');
const stateReady = document.getElementById('state-ready');
const stateSessionStatus = document.getElementById('state-session-status');
const stateFallbackMonitor = document.getElementById('state-fallback-monitor');
const stateReturnToPip = document.getElementById('state-return-to-pip');

const btnEnableMic = document.getElementById('btn-enable-mic');
const btnChooseRecommended = document.getElementById('btn-choose-recommended');
const btnCreateCustom = document.getElementById('btn-create-custom');
const savedProfilesBlock = document.getElementById('saved-profiles-block');
const savedProfilesList = document.getElementById('saved-profiles-list');
const btnStartCalibration = document.getElementById('btn-start-calibration');
const btnSaveNotNow = document.getElementById('btn-save-not-now');
const btnSaveProfile = document.getElementById('btn-save-profile');
const nameForm = document.getElementById('name-form');
const profileNameInput = document.getElementById('profile-name-input');
const currentProfileName = document.getElementById('current-profile-name');
const btnStartMonitoring = document.getElementById('btn-start-monitoring');
const btnChangeProfile = document.getElementById('btn-change-profile');
const deniedHelp = document.getElementById('denied-help');
const readyUnsupportedNote = document.getElementById('ready-unsupported-note');

const listeningHeading = document.getElementById('listening-heading');
const calRingCanvas = document.getElementById('cal-ring-canvas');

// Session status view — the 3-state status/recovery surface.
const sessionStatusHeading = document.getElementById('session-status-heading');
const sessionStatusLabel = document.getElementById('session-status-label');
const sessionStatusText = document.getElementById('session-status-text');
const btnReopenCompanion = document.getElementById('btn-reopen-companion');
const btnEndSession = document.getElementById('btn-end-session');

// No-Companion-support fallback's own live monitoring view.
const fallbackHeadingEl = document.getElementById('fallback-mon-heading');
const fallbackCircleContainer = document.getElementById('fallback-circle-container');
const btnFallbackStop = document.getElementById('btn-fallback-stop');

const allStates = {
  a: stateA,
  profileSelect: stateProfileSelect,
  b: stateB,
  savePrompt: stateSavePrompt,
  name: stateName,
  ready: stateReady,
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

  savedProfilesList.innerHTML = '';
  if (saved.length === 0) {
    savedProfilesBlock.classList.add('hidden');
  } else {
    savedProfilesBlock.classList.remove('hidden');
    for (const profile of saved) {
      const row = document.createElement('button');
      row.className = 'profile-row profile-row-saved';
      row.innerHTML = `
        <span class="profile-row-bullet" aria-hidden="true">&bull;</span>
        <span class="profile-row-text"><span class="profile-row-name"></span></span>
      `;
      row.querySelector('.profile-row-name').textContent = profile.name;
      row.addEventListener('click', () => chooseSavedProfile(profile));
      savedProfilesList.appendChild(row);
    }
  }

  transitionToState('profileSelect');
}

function chooseRecommended() {
  setSelectedProfile(RECOMMENDED_PROFILE);
  showReady();
}

/** "Create Custom Profile" — go to calibration's landing view (not straight into capture). */
function goToCalibrationLanding() {
  transitionToState('b');
}

function chooseSavedProfile(profile) {
  setSelectedProfile({
    name: profile.name,
    speakingDb: profile.speakingDb,
    savedProfileId: profile.id,
  });
  showReady();
}

// =============================================================================
// Ready Screen (pre-session — "You're All Set")
// =============================================================================

function showReady() {
  const selected = getSelectedProfile();
  currentProfileName.textContent = selected ? selected.name : RECOMMENDED_PROFILE.name;
  session.setActiveProfile(selected || RECOMMENDED_PROFILE);
  transitionToState('ready');
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

  // This profile is temporary until the user explicitly saves it — select it
  // immediately so Ready/monitoring can use it either way.
  pendingCalibratedProfile = { speakingDb, calibratedTs: Date.now() };
  setSelectedProfile({ name: null, speakingDb, savedProfileId: null });

  trackCalibrationCompleted();

  resetCalibrationView();
  transitionToState('savePrompt');
}

// =============================================================================
// Save Prompt / Naming
// =============================================================================

function handleSaveNotNow() {
  const profile = getSelectedProfile(); // set by finishCalibration() just before this prompt
  pendingCalibratedProfile = null;
  isCreateProfileEntry ? returnToPip(profile) : showReady();
}

function handleSaveProfileClick() {
  profileNameInput.value = '';
  transitionToState('name');
  requestAnimationFrame(() => profileNameInput.focus());
}

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

  isCreateProfileEntry ? returnToPip(selected) : showReady();
}

// =============================================================================
// Open Companion (from Ready) — Companion-capable browsers
// =============================================================================

/**
 * A real click on this document — exactly what Document PiP requires, no
 * relay through a second window needed. The status view shows immediately
 * (its static markup defaults to the "closed" copy, matching sessionState's
 * initial value) and updates reactively once openCompanion() resolves.
 */
async function handleOpenMezzoClick() {
  transitionToState('sessionStatus');
  await session.openCompanion();
}

// =============================================================================
// Start Monitoring (from Ready) — no-Companion-support fallback only
// =============================================================================

async function handleFallbackStartClick() {
  const ok = await session.startFallbackMonitoring(fallbackCircleContainer);
  if (ok) transitionToState('fallbackMonitor');
}

// =============================================================================
// Session Status View (companionReady / monitoringActive / companionClosed)
// =============================================================================

// No "bring to front" / "show" control anywhere — the Mezzo Companion is a
// Document PiP window and already stays above other windows on its own, so
// a focus/raise action would be misleading. This page reports status only;
// "Re-open Companion" is the sole primary action, and only appears once the
// Companion has actually closed. The secondary action is always "End
// Session" here (a full teardown) — Mezzo never offers a softer "stop but
// keep everything open" action; that's what the Companion's own Stop
// Monitoring button is for.
const SESSION_VIEW_COPY = {
  [session.SESSION_STATES.COMPANION_READY]: {
    heading: 'Mezzo Companion is open',
    statusLabel: 'Ready',
    body: "Start monitoring from the Mezzo Companion when you're ready.",
    primaryLabel: null,
  },
  [session.SESSION_STATES.MONITORING_ACTIVE]: {
    heading: 'Monitoring is active',
    statusLabel: '',
    body: 'The Mezzo Companion will stay visible above your other windows.',
    primaryLabel: null,
  },
  [session.SESSION_STATES.COMPANION_CLOSED]: {
    heading: 'Mezzo Companion is closed',
    statusLabel: '',
    body: 'Monitoring is not active.',
    primaryLabel: 'Re-open Companion',
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
  if (btnReopenCompanion) {
    btnReopenCompanion.classList.toggle('hidden', !copy.primaryLabel);
    if (copy.primaryLabel) btnReopenCompanion.textContent = copy.primaryLabel;
  }
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
// Change Profile
// =============================================================================

function handleChangeProfile() {
  renderProfileSelect();
}

// =============================================================================
// Initial Screen Routing
// =============================================================================

/**
 * After mic permission is confirmed granted, decide where to land:
 *   - ?entry=create-profile (opened from the Companion) → straight to calibration,
 *     skipping Choose a Profile entirely — the user already made that choice
 *     by clicking "+ Create New Profile..." there.
 *   - a profile already resolvable (this tab's own selection, or the
 *     cross-tab last-used profile — what lets a fresh tab launched by the
 *     browser extension skip straight to Ready) → resume Ready.
 *   - otherwise → Choose a Profile.
 */
function goToInitialScreen() {
  if (isCreateProfileEntry) {
    goToCalibrationLanding();
  } else if (resolveActiveProfile()) {
    showReady();
  } else {
    renderProfileSelect();
  }
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
btnChooseRecommended?.addEventListener('click', chooseRecommended);
btnCreateCustom?.addEventListener('click', goToCalibrationLanding);
btnStartCalibration?.addEventListener('click', startCalibration);
btnSaveNotNow?.addEventListener('click', handleSaveNotNow);
btnSaveProfile?.addEventListener('click', handleSaveProfileClick);
nameForm?.addEventListener('submit', handleNameFormSubmit);
btnChangeProfile?.addEventListener('click', handleChangeProfile);

// The Ready screen's primary action is decided once, per browser
// capability — never both "Open Companion" and "Start Monitoring."
if (btnStartMonitoring) {
  btnStartMonitoring.textContent = pipSupported ? 'Open Companion' : 'Start Monitoring';
  btnStartMonitoring.addEventListener('click', pipSupported ? handleOpenMezzoClick : handleFallbackStartClick);
}
if (!pipSupported && readyUnsupportedNote) {
  readyUnsupportedNote.classList.remove('hidden');
}

// Only ever visible in the companionClosed state (see renderSessionStatusView) —
// a real click here, so this is exactly what reopens the Companion via a
// fresh Document PiP request, same as the very first "Open Companion."
btnReopenCompanion?.addEventListener('click', () => session.openCompanion());
// Always a full teardown, in every session state — Mezzo doesn't offer a
// softer "stop but keep everything open" action; that lives only inside
// the Companion itself (its own Stop Monitoring button).
btnEndSession?.addEventListener('click', () => {
  session.endSession();
  transitionToState('ready');
});

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
