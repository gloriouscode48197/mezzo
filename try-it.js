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
 *
 * Two storage keys:
 *   - mezzoProfiles (localStorage, persists across tabs) — saved custom profiles.
 *     Only ever written when the user explicitly clicks "Save Profile".
 *   - mezzoSelectedProfile (sessionStorage, cleared on tab close) — whichever profile is
 *     active this session. A fresh tab always starts at Choose Profile ("remember last used"
 *     is out of scope for this release); within a tab, this is what lets Start Monitoring →
 *     Stop Monitoring loop back to Ready without re-choosing.
 */

import { AudioProcessor } from './src/audio.js';
import { MezzoEngine } from './src/engine.js?v=5';
import { pageEnter, navigateTo } from './src/page-transition.js';
import { trackAppOpened, trackCalibrationCompleted } from './src/analytics.js';

// =============================================================================
// Constants
// =============================================================================

const PROFILES_STORAGE_KEY = 'mezzoProfiles';
const SELECTED_PROFILE_KEY = 'mezzoSelectedProfile';
const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;
const COUNTDOWN_SECONDS = 6;
const VARIANT_CYCLE_MS = 2500;

// Baseline for the built-in Recommended profile — no calibration exists to derive
// this from, so it's a first-pass tunable default (roughly the midpoint of real
// calibrated baselines observed during testing, -34dB to -19dB).
const RECOMMENDED_SPEAKING_DB = -26;
const RECOMMENDED_PROFILE = { name: 'Recommended', speakingDb: RECOMMENDED_SPEAKING_DB, savedProfileId: null };

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
const ringContainer = document.getElementById('ring-container');
const ringVariants = document.querySelectorAll('.ring-variant');

const allStates = {
  a: stateA,
  profileSelect: stateProfileSelect,
  b: stateB,
  savePrompt: stateSavePrompt,
  name: stateName,
  ready: stateReady,
};

// =============================================================================
// Calibration State
// =============================================================================

let rmsBuffer = [];
let countdownInterval = null;
let variantCycleInterval = null;
let currentVariant = 0;

// The profile just calibrated this session, pending a save/discard decision.
let pendingCalibratedProfile = null;

// =============================================================================
// Profile Storage
// =============================================================================

function getSavedProfiles() {
  try {
    const stored = localStorage.getItem(PROFILES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSavedProfiles(profiles) {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (e) {
    console.error('[TryIt] Failed to persist saved profiles:', e);
  }
}

function getSelectedProfile() {
  try {
    const stored = sessionStorage.getItem(SELECTED_PROFILE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed.speakingDb === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function setSelectedProfile(profile) {
  try {
    sessionStorage.setItem(SELECTED_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('[TryIt] Failed to select profile:', e);
  }
}

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
// Ring Variant Crossfade
// =============================================================================

function startVariantCycle() {
  currentVariant = 0;
  ringVariants.forEach((v, i) => v.classList.toggle('active', i === 0));
  ringContainer.classList.add('pulsing');

  variantCycleInterval = setInterval(() => {
    ringVariants[currentVariant].classList.remove('active');
    currentVariant = (currentVariant + 1) % ringVariants.length;
    ringVariants[currentVariant].classList.add('active');
  }, VARIANT_CYCLE_MS);
}

function stopVariantCycle() {
  if (variantCycleInterval) {
    clearInterval(variantCycleInterval);
    variantCycleInterval = null;
  }
  ringContainer.classList.remove('pulsing');
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
  stopVariantCycle();
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
  startVariantCycle();

  // Collect RMS samples
  audio.onLevelChange = ({ rms }) => {
    rmsBuffer.push(rms);
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
  stopVariantCycle();

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
  pendingCalibratedProfile = null;
  showReady();
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

  setSelectedProfile({ name, speakingDb: newProfile.speakingDb, savedProfileId: id });
  pendingCalibratedProfile = null;

  showReady();
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
 * resume Ready if a profile is already selected this session (e.g. returning
 * from a stopped monitoring session), otherwise Choose a Profile.
 */
function goToInitialScreen() {
  if (getSelectedProfile()) {
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
btnStartMonitoring?.addEventListener('click', () => {
  navigateTo('monitoring.html');
});
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
