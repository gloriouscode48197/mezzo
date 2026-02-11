/**
 * Mezzo — Try It Page Controller
 *
 * States, one visible at a time:
 *   A: Mic permission not granted → show enable mic prompt
 *   B: Mic granted, not calibrated → show calibration landing
 *   Calibrating: 6s countdown with ring animation
 *   Complete: Calibration done → "Ready to monitor"
 *   C: Mic granted + calibrated (within same session) → "Ready to monitor"
 *
 * Calibration data is stored in sessionStorage so it persists across
 * page navigations within the same tab but is cleared on tab close.
 * Users always recalibrate on a fresh visit.
 */

import { AudioProcessor } from './src/audio.js';
import { MezzoEngine } from './src/engine.js';
import { pageEnter, navigateTo } from './src/page-transition.js';
import { trackAppOpened, trackCalibrationCompleted } from './src/analytics.js';

// =============================================================================
// Constants
// =============================================================================

const STATE_STORAGE_KEY = 'mezzoState';
const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;
const COUNTDOWN_SECONDS = 6;
const VARIANT_CYCLE_MS = 2500;

// =============================================================================
// Instances
// =============================================================================

const audio = new AudioProcessor();
const engine = new MezzoEngine();

// =============================================================================
// DOM References
// =============================================================================

const stateA = document.getElementById('state-a');
const stateB = document.getElementById('state-b');
const stateCalibrating = document.getElementById('state-calibrating');
const stateComplete = document.getElementById('state-complete');
const stateC = document.getElementById('state-c');

const btnEnableMic = document.getElementById('btn-enable-mic');
const btnStartCalibration = document.getElementById('btn-start-calibration');
const btnCompleteStart = document.getElementById('btn-complete-start');
const btnStartMonitoring = document.getElementById('btn-start-monitoring');
const btnRecalibrateComplete = document.getElementById('btn-recalibrate-complete');
const btnRecalibrateC = document.getElementById('btn-recalibrate-c');
const deniedHelp = document.getElementById('denied-help');

const listeningHeading = document.getElementById('listening-heading');
const ringContainer = document.getElementById('ring-container');
const ringVariants = document.querySelectorAll('.ring-variant');

const allStates = {
  a: stateA,
  b: stateB,
  calibrating: stateCalibrating,
  complete: stateComplete,
  c: stateC,
};

// =============================================================================
// Calibration State
// =============================================================================

let rmsBuffer = [];
let countdownInterval = null;
let variantCycleInterval = null;
let currentVariant = 0;

// =============================================================================
// State Helpers
// =============================================================================

/**
 * Check if calibration baseline exists in sessionStorage.
 */
function isCalibrated() {
  try {
    const stored = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return data.profile && data.profile.calibratedTs !== null;
    }
  } catch {
    // Corrupted storage — treat as not calibrated
  }
  return false;
}

// =============================================================================
// View Transitions (opacity-only fade, no translateY)
// =============================================================================

/**
 * Fade from the current visible state to a new one.
 * Only one state is visible at a time.
 */
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

    // Transition to the correct next state
    if (isCalibrated()) {
      transitionToState('c');
    } else {
      transitionToState('b');
    }
  } catch (error) {
    console.warn('[TryIt] Microphone access denied:', error.message);

    // Show denial help text
    if (deniedHelp) deniedHelp.classList.remove('hidden');
  }
}

// =============================================================================
// Calibration
// =============================================================================

async function startCalibration() {
  rmsBuffer = [];

  try {
    await audio.acquire();
  } catch (error) {
    console.error('[TryIt] Mic acquisition failed:', error.message);
    // Mic was revoked — go back to state A
    transitionToState('a');
    return;
  }

  // Switch to calibrating view
  transitionToState('calibrating');

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
    // Reset heading and go back to B to retry
    listeningHeading.textContent = `Listening...${COUNTDOWN_SECONDS}s`;
    transitionToState('b');
    return;
  }

  // Save calibration to sessionStorage (cleared automatically on tab close)
  const { baselineRMS, upperThreshold } = engine.getCalibrationValues();
  const profile = {
    speakingDb: 20 * Math.log10(baselineRMS + 1e-10),
    upperBound: 20 * Math.log10(upperThreshold + 1e-10),
    calibratedTs: Date.now(),
    lastUsedTs: Date.now(),
  };

  try {
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({ profile }));
  } catch (e) {
    console.error('[TryIt] Failed to save profile:', e);
  }

  trackCalibrationCompleted();

  // Show complete view
  transitionToState('complete');
}

// =============================================================================
// State Detection (runs once on page load)
// =============================================================================

async function detectInitialState() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });

    if (result.state === 'granted') {
      // Mic already granted — show B or C based on calibration
      if (isCalibrated()) {
        transitionToState('c');
      } else {
        transitionToState('b');
      }
    } else {
      // 'prompt' or 'denied' — show State A
      transitionToState('a');

      // If previously denied, show help text immediately
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
btnStartCalibration?.addEventListener('click', startCalibration);
btnCompleteStart?.addEventListener('click', () => {
  navigateTo('monitoring.html');
});
btnStartMonitoring?.addEventListener('click', () => {
  navigateTo('monitoring.html');
});

function handleRecalibrate() {
  try {
    sessionStorage.removeItem(STATE_STORAGE_KEY);
  } catch { /* ignore */ }
  transitionToState('b');
}

btnRecalibrateComplete?.addEventListener('click', handleRecalibrate);
btnRecalibrateC?.addEventListener('click', handleRecalibrate);

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  audio.release();
});

// =============================================================================
// Init
// =============================================================================

pageEnter();
detectInitialState();

trackAppOpened(isCalibrated());
