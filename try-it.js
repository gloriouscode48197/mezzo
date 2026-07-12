/**
 * Mezzo — Try It Page Controller
 *
 * States, one visible at a time:
 *   a:              Mic permission not granted → show enable mic prompt
 *   profile-select: Choose a Profile — Recommended, Create Custom Profile, or a saved profile
 *   b:              Calibration (creates a custom profile) — landing + listening
 *   save-prompt:    "Save this profile?" — Not Now / Save Profile
 *   name:           Name a profile before saving it
 *   ready:          Profile chosen — "You're All Set", Start Monitoring / Change Profile
 *   return-to-pip:  Reached only via ?entry=create-profile (opened from PiP's "+ Create New
 *                   Profile...") — hands the new profile back to the PiP-owning tab instead of
 *                   offering to start monitoring from here.
 *
 * Profile storage lives in src/profiles.js (shared with monitoring.js) — see that file for the
 * three storage layers (saved-profile library, this-tab selection, cross-tab last-used).
 */

import { AudioProcessor } from './src/audio.js?v=2';
import { MezzoEngine } from './src/engine.js?v=5';
import { pageEnter } from './src/page-transition.js';
import { trackAppOpened, trackCalibrationCompleted } from './src/analytics.js';
import {
  RECOMMENDED_PROFILE,
  getSavedProfiles,
  saveSavedProfiles,
  getSelectedProfile,
  setSelectedProfile,
  setLastUsedProfile,
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

// Set when opened from PiP's "+ Create New Profile..." — a genuinely new tab
// (Document PiP doesn't survive its opener navigating, so this can never be
// the same tab that owns an open PiP window). Skips straight to calibration
// and, on completion, hands the profile back via BroadcastChannel instead of
// showing the normal Ready screen — starting monitoring from *this* tab was
// never the intent.
const isCreateProfileEntry = new URLSearchParams(window.location.search).get('entry') === 'create-profile';
const profileSyncChannel = new BroadcastChannel('mezzo-profile-sync');

// =============================================================================
// Instances
// =============================================================================

const audio = new AudioProcessor();
const engine = new MezzoEngine();

// =============================================================================
// DOM References
// =============================================================================

const stateA = document.getElementById('state-a');
const stateProfileSelect = document.getElementById('state-profile-select');
const stateB = document.getElementById('state-b');
const stateSavePrompt = document.getElementById('state-save-prompt');
const stateName = document.getElementById('state-name');
const stateReady = document.getElementById('state-ready');
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

const listeningHeading = document.getElementById('listening-heading');
const calRingCanvas = document.getElementById('cal-ring-canvas');

const allStates = {
  a: stateA,
  profileSelect: stateProfileSelect,
  b: stateB,
  savePrompt: stateSavePrompt,
  name: stateName,
  ready: stateReady,
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
// Ready Screen
// =============================================================================

function showReady() {
  const selected = getSelectedProfile();
  currentProfileName.textContent = selected ? selected.name : RECOMMENDED_PROFILE.name;
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
// Open the Companion Window (from Ready)
// =============================================================================

/**
 * A real, separate window — matching what the extension does via
 * chrome.windows.create — not a same-tab navigation. Document PiP requires
 * a fresh user gesture on monitoring.html itself, so the actual "Start
 * Monitoring" click has to happen there, not here; this just opens/focuses
 * that window and hands off. Reusing the same window name means a second
 * click from this tab refocuses it rather than duplicating — though this
 * can't detect a companion window the extension already opened via a
 * different code path (no cross-context window enumeration without
 * extension privileges).
 */
function handleOpenMezzoClick() {
  window.open('monitoring.html', 'mezzo-companion', 'width=480,height=640,popup');
  transitionToState('returnToPip');
}

// =============================================================================
// Return to PiP (only reached via ?entry=create-profile)
// =============================================================================

/**
 * Hand the freshly-created profile back to whichever tab owns the open PiP
 * window, via BroadcastChannel — this tab never navigates that one directly
 * (Document PiP doesn't survive its opener navigating away), so cross-tab
 * messaging is the only way to close the loop.
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
 *   - ?entry=create-profile (opened from PiP) → straight to calibration,
 *     skipping Choose a Profile entirely — the user already made that choice
 *     by clicking "+ Create New Profile..." in PiP.
 *   - a profile already selected this session (e.g. returning from a stopped
 *     monitoring session) → resume Ready.
 *   - otherwise → Choose a Profile.
 */
function goToInitialScreen() {
  if (isCreateProfileEntry) {
    goToCalibrationLanding();
  } else if (getSelectedProfile()) {
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
btnStartMonitoring?.addEventListener('click', handleOpenMezzoClick);
btnChangeProfile?.addEventListener('click', handleChangeProfile);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  audio.release();
});

// =============================================================================
// Init
// =============================================================================

pageEnter();
detectInitialState();

trackAppOpened(getSelectedProfile() !== null);
