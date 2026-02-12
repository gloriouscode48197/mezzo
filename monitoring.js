/**
 * Mezzo — Monitoring Controller
 *
 * Uses existing AudioProcessor for mic capture and RMS sampling,
 * MezzoEngine for state detection (in-range / out-of-range / sustained),
 * and MezzoVoiceCircle for the voice visualization.
 *
 * Supports Picture-in-Picture via the Document PiP API:
 *   - Pop Out → circle moves to PiP window, main page shows "running in mini window"
 *   - Return → PiP closes, circle returns to main page
 *   - Close PiP → monitoring stops, navigates to calibrated-return
 *   - Monitoring runs in EITHER PiP OR main page, never both
 */

import { AudioProcessor } from './src/audio.js';
import { MezzoEngine, LogicalState } from './src/engine.js';
import { MezzoVoiceCircle, RING_THRESHOLDS } from './src/voice-circle.js';
import { trackMonitoringStarted, trackMonitoringSession } from './src/analytics.js';
import { pageEnter, navigateTo, transitionView } from './src/page-transition.js';

// =============================================================================
// Constants
// =============================================================================

const STATE_STORAGE_KEY = 'mezzoState';
const PIP_WIDTH = 1;
const PIP_HEIGHT = 1;

// =============================================================================
// DOM References
// =============================================================================

const views = {
  monitoring: document.getElementById('view-monitoring'),
  pipRunning: document.getElementById('view-pip-running'),
};

const circleContainer = document.getElementById('circle-container');
const btnStop = document.getElementById('btn-stop');
const btnPip = document.getElementById('btn-pip');
const btnReturn = document.getElementById('btn-return');

// =============================================================================
// Instances
// =============================================================================

const audio = new AudioProcessor();
const engine = new MezzoEngine();

// =============================================================================
// State
// =============================================================================

let mainCircle = null;
let pipCircle = null;
let activeCircle = null;
let pipWindow = null;
let baselineRMS = 0;
let isPipClosingForReturn = false;
let isPageUnloading = false;
let isOutsideRange = false;
let sustainedTimer = null;

// ── Blink alert state ──
let isAlertMode = false;   // true once sustained threshold reached (500ms)
let blinkDark = false;     // current blink phase (true = dark theme)
let blinkInterval = null;  // setInterval ID for theme toggling
let fastBlinkTimer = null; // setTimeout ID for 3s fast-blink escalation
let demoInterval = null;   // setInterval ID for demo mode fake RMS

const SUSTAINED_ALERT_MS = 500;   // 500ms → slow blink starts
const SLOW_BLINK_MS = 1000;       // slow blink interval
const FAST_BLINK_MS = 450;        // fast blink interval
const FAST_BLINK_AFTER_MS = 2500; // 2.5s after alert (3s total out-of-range)

// ── Session analytics state ──
let monitoringStartTime = null;
let sessionUsedPip = false;
let sessionAlertTriggered = false;

// Absolute base URL for asset paths in PiP documents (about:blank origin)
const baseUrl = new URL('.', window.location.href).href;

// =============================================================================
// View Management
// =============================================================================

function showView(name) {
  transitionView(views, name);
}

// =============================================================================
// Calibration Loader
// =============================================================================

function loadCalibration() {
  try {
    const stored = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored);
    if (!data.profile || data.profile.calibratedTs === null) return null;
    return data.profile;
  } catch {
    return null;
  }
}

// =============================================================================
// Blink Management
// =============================================================================

function startBlink(intervalMs) {
  if (blinkInterval) clearInterval(blinkInterval);
  blinkInterval = setInterval(() => {
    blinkDark = !blinkDark;
  }, intervalMs);
}

function stopBlink() {
  if (blinkInterval) { clearInterval(blinkInterval); blinkInterval = null; }
  if (fastBlinkTimer) { clearTimeout(fastBlinkTimer); fastBlinkTimer = null; }
  if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
  isAlertMode = false;
  blinkDark = false;
}

// =============================================================================
// Audio Frame Handler
// =============================================================================

function onAudioFrame({ rms }) {
  engine.processFrame(rms);

  const state = engine.getCurrentState();
  const newIsOutside = state !== LogicalState.IN_RANGE;

  // ── Sustained alert: blink system on outside-range transitions ──
  if (newIsOutside !== isOutsideRange) {
    isOutsideRange = newIsOutside;

    if (newIsOutside) {
      // Entered outside range — start 500ms sustained timer
      const timerStartedAt = Date.now();
      console.log('[SUSTAINED] Timer started at %d — waiting %dms', timerStartedAt, SUSTAINED_ALERT_MS);
      sustainedTimer = setTimeout(() => {
        console.log('[SUSTAINED] Slow blink started at %d — elapsed %dms', Date.now(), Date.now() - timerStartedAt);
        isAlertMode = true;
        blinkDark = true;
        sessionAlertTriggered = true;
        sustainedTimer = null;

        // Start slow blink (1s interval)
        startBlink(SLOW_BLINK_MS);

        // After 2.5 more seconds (3s total), escalate to fast blink
        fastBlinkTimer = setTimeout(() => {
          console.log('[SUSTAINED] Fast blink started — 3s total out-of-range');
          startBlink(FAST_BLINK_MS);
          fastBlinkTimer = null;
        }, FAST_BLINK_AFTER_MS);
      }, SUSTAINED_ALERT_MS);
    } else {
      // Returned to range — stop everything, reset to light
      console.log('[Monitoring] Returned to range — blink stopped');
      stopBlink();
    }
  }

  // Update whichever circle is active
  if (activeCircle) {
    activeCircle.update(rms, baselineRMS, isAlertMode, blinkDark);
  }

  // ── Debug: per-frame volume and threshold info ──
  const ringLevel = activeCircle ? activeCircle.currentRingLevel : -1;
  const diff = rms - baselineRMS;
  console.log(`[Frame] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  ring1@${(baselineRMS * RING_THRESHOLDS[0]).toFixed(4)}(×1.5)  ring2@${(baselineRMS * RING_THRESHOLDS[1]).toFixed(4)}(×2)  ring3@${(baselineRMS * RING_THRESHOLDS[2]).toFixed(4)}(×3)  → ring-${ringLevel}  ${ringLevel >= 1 ? 'OUTSIDE' : 'within'}`);
}

// =============================================================================
// Start Monitoring (main page)
// =============================================================================

async function startMonitoring() {
  const profile = loadCalibration();
  if (!profile) {
    navigateTo('try-it.html');
    return;
  }

  // Convert stored dB back to RMS
  baselineRMS = Math.pow(10, profile.speakingDb / 20);

  // Calibrate engine with synthetic samples matching stored baseline
  const samples = new Array(100).fill(baselineRMS);
  engine.calibrate(samples);
  engine.startMonitoring();

  // Acquire mic
  try {
    await audio.acquire();
  } catch (err) {
    console.error('[Monitoring] Mic acquisition failed:', err.message);
    navigateTo('try-it.html');
    return;
  }

  // Create voice circle — card element receives data-surface changes (not body)
  const monCard = document.querySelector('.mon-card');
  mainCircle = new MezzoVoiceCircle(circleContainer, {
    assetPath: 'assets',
    surfaceElement: monCard,
  });
  activeCircle = mainCircle;

  // Audio frame callback
  audio.onLevelChange = onAudioFrame;
  audio.startMonitoring();

  // Analytics
  monitoringStartTime = Date.now();
  sessionUsedPip = false;
  sessionAlertTriggered = false;
  trackMonitoringStarted();

  // Update lastUsedTs
  try {
    const stored = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      data.profile.lastUsedTs = Date.now();
      sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(data));
    }
  } catch { /* ignore */ }
}

// =============================================================================
// Stop Monitoring
// =============================================================================

function stopMonitoring() {
  // Fire session analytics before teardown
  if (monitoringStartTime) {
    const durationSeconds = Math.round((Date.now() - monitoringStartTime) / 1000);
    trackMonitoringSession({
      durationSeconds,
      usedPip: sessionUsedPip,
      alertTriggered: sessionAlertTriggered,
    });
    monitoringStartTime = null;
  }

  engine.stopMonitoring();
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
  audio.stopMonitoring();
  audio.release();

  // Clear all blink/alert timers
  stopBlink();
  isOutsideRange = false;

  if (mainCircle) {
    mainCircle.destroy();
    mainCircle = null;
  }
  if (pipCircle) {
    pipCircle.destroy();
    pipCircle = null;
  }
  activeCircle = null;

  if (!isPageUnloading) {
    try { sessionStorage.setItem('mezzoReturnSource', 'monitoring'); } catch { /* ignore */ }
    navigateTo('try-it.html');
  }
}

// =============================================================================
// Picture-in-Picture
// =============================================================================

async function openPiP() {
  if (!('documentPictureInPicture' in window)) {
    console.warn('[Monitoring] Document PiP API not supported');
    return;
  }

  try {
    pipWindow = await documentPictureInPicture.requestWindow({
      width: PIP_WIDTH,
      height: PIP_HEIGHT,
    });
  } catch (err) {
    console.error('[Monitoring] Failed to open PiP window:', err.message);
    return;
  }

  console.log('[PiP] Requested: %d×%d — Actual: %d×%d', PIP_WIDTH, PIP_HEIGHT, pipWindow.innerWidth, pipWindow.innerHeight);

  const pipDoc = pipWindow.document;

  // ── Inject Google Fonts ──
  const fontLink = pipDoc.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400&family=Sora:wght@300;400;500&display=swap';
  pipDoc.head.appendChild(fontLink);

  // ── Inject mezzo-tokens.css (wait for load so theming works immediately) ──
  const link = pipDoc.createElement('link');
  link.rel = 'stylesheet';
  link.href = baseUrl + 'design-tokens/mezzo-tokens.css';
  const cssReady = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });
  pipDoc.head.appendChild(link);
  await cssReady;

  // ── Inject PiP styles (compact + expanded modes) ──
  const style = pipDoc.createElement('style');
  style.textContent = `
    body {
      margin: 0;
      width: 100%;
      height: 100vh;
      background: var(--surface);
      overflow: hidden;
      transition: background-color 300ms ease;
    }
    .mezzo-circle { background: transparent !important; }

    /* ── Layout shell ── */
    .pip-layout {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* ── Elements hidden in compact mode ── */
    .pip-heading {
      display: none;
      font-family: var(--font-display);
      font-weight: var(--weight-light);
      font-size: 24px;
      line-height: 115%;
      letter-spacing: -0.2px;
      color: var(--text-primary);
      text-align: center;
      margin: 0;
      padding: 32px 20px 0;
      transition: color 300ms ease;
    }
    .pip-controls {
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 0 20px 32px;
      gap: 12px;
    }
    .pip-micro {
      font-family: var(--font-body);
      font-weight: var(--weight-light);
      font-size: 12px;
      line-height: 150%;
      color: var(--text-subdued);
      margin: 0;
    }
    .btn-wide {
      padding: 16px 64px;
      min-width: 240px;
    }

    /* ── Circle wrapper ── */
    .pip-circle-wrapper {
      flex: 1;
      width: 100%;
      overflow: hidden;
    }

    /* ── Compact mode: circle fills the window ── */
    .mezzo-circle-stage {
      width: 100cqmin !important;
      height: 100cqmin !important;
    }
    .mezzo-ring-layer:nth-child(1) { width: calc(100% - 20px) !important; height: calc(100% - 20px) !important; }
    .mezzo-ring-layer:nth-child(2) { width: 140% !important; height: 140% !important; }
    .mezzo-ring-layer:nth-child(3) { width: 175% !important; height: 175% !important; }
    .mezzo-ring-layer:nth-child(4) { width: 210% !important; height: 210% !important; }

    /* ── Expanded mode: card-like layout ── */
    @media (min-width: 300px) and (min-height: 350px) {
      .pip-heading { display: block; }
      .pip-controls { display: flex; }
      .pip-circle-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
      }
      .mezzo-circle {
        width: 280px !important;
        height: 280px !important;
      }
      .mezzo-circle-stage {
        width: min(var(--mezzo-size, var(--circle-within)), 90cqmin) !important;
        height: min(var(--mezzo-size, var(--circle-within)), 90cqmin) !important;
      }
      .mezzo-ring-layer:nth-child(1) { width: 32.14% !important; height: 32.14% !important; }
      .mezzo-ring-layer:nth-child(2) { width: 57.14% !important; height: 57.14% !important; }
      .mezzo-ring-layer:nth-child(3) { width: 85.71% !important; height: 85.71% !important; }
      .mezzo-ring-layer:nth-child(4) { width: 100% !important; height: 100% !important; }
    }
  `;
  pipDoc.head.appendChild(style);

  // ── Set surface theme to match current blink phase ──
  pipDoc.body.setAttribute('data-surface', blinkDark ? 'dark' : 'light');

  // ── Build PiP layout: heading + circle + controls ──
  const layout = pipDoc.createElement('div');
  layout.className = 'pip-layout';

  const pipH = pipDoc.createElement('h1');
  pipH.className = 'pip-heading';
  pipH.textContent = 'Listening';
  layout.appendChild(pipH);

  const wrapper = pipDoc.createElement('div');
  wrapper.className = 'pip-circle-wrapper';
  layout.appendChild(wrapper);

  const controls = pipDoc.createElement('div');
  controls.className = 'pip-controls';

  const pipStopBtn = pipDoc.createElement('button');
  pipStopBtn.className = 'btn-primary btn-wide';
  pipStopBtn.textContent = 'Stop listening';
  pipStopBtn.addEventListener('click', () => {
    if (pipWindow) pipWindow.close();
  });
  controls.appendChild(pipStopBtn);

  const pipMicro = pipDoc.createElement('p');
  pipMicro.className = 'pip-micro';
  pipMicro.textContent = 'Nothing is recorded or saved.';
  controls.appendChild(pipMicro);

  layout.appendChild(controls);
  pipDoc.body.appendChild(layout);

  // ── Tear down main circle ──
  if (mainCircle) {
    mainCircle.destroy();
    mainCircle = null;
  }

  // ── Create PiP circle (absolute URLs for about:blank context) ──
  pipCircle = new MezzoVoiceCircle(wrapper, {
    assetPath: baseUrl + 'assets',
    surfaceElement: pipDoc.body,
  });
  activeCircle = pipCircle;

  // Immediately sync PiP circle to current state
  const currentRms = audio.getCurrentLevel().rms;
  pipCircle.update(currentRms, baselineRMS, isAlertMode, blinkDark);

  // ── Switch main page to "running in mini window" view ──
  sessionUsedPip = true;
  showView('pipRunning');

  // ── Handle PiP close (browser close button or programmatic) ──
  pipWindow.addEventListener('pagehide', handlePipClose);
}

function handlePipClose() {
  // Clean up PiP circle
  if (pipCircle) {
    pipCircle.destroy();
    pipCircle = null;
  }
  pipWindow = null;

  // Guard against running during tab close
  if (isPageUnloading) return;

  if (isPipClosingForReturn) {
    // "Return to this window" → resume monitoring on main page
    isPipClosingForReturn = false;
    resumeMainMonitoring();
  } else {
    // User closed PiP via browser button → stop monitoring entirely
    stopMonitoring();
  }
}

function resumeMainMonitoring() {
  showView('monitoring');

  // Recreate circle on main page — card element receives data-surface changes
  const monCard = document.querySelector('.mon-card');
  monCard.setAttribute('data-surface', blinkDark ? 'dark' : 'light');
  mainCircle = new MezzoVoiceCircle(circleContainer, {
    assetPath: 'assets',
    surfaceElement: monCard,
  });
  activeCircle = mainCircle;

  // Immediately sync circle to current state
  const currentRms = audio.getCurrentLevel().rms;
  mainCircle.update(currentRms, baselineRMS, isAlertMode, blinkDark);
}

function returnFromPip() {
  isPipClosingForReturn = true;
  if (pipWindow) {
    pipWindow.close();
  }
}

// =============================================================================
// Event Binding
// =============================================================================

btnStop?.addEventListener('click', stopMonitoring);
btnPip?.addEventListener('click', openPiP);
btnReturn?.addEventListener('click', returnFromPip);

// Hide PiP button if API not supported
if (!('documentPictureInPicture' in window)) {
  if (btnPip) btnPip.style.display = 'none';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  isPageUnloading = true;
  stopBlink();
  if (pipWindow) {
    try { pipWindow.close(); } catch { /* ignore */ }
  }
  engine.stopMonitoring();
  audio.release();
});

// =============================================================================
// Demo Mode
// =============================================================================

function startDemoMode() {
  baselineRMS = 0.05;

  // Calibrate engine with synthetic samples at the fake baseline
  const samples = new Array(100).fill(baselineRMS);
  engine.calibrate(samples);
  engine.startMonitoring();
  engine.graceRemainingMs = 0; // skip grace period so alerts trigger immediately

  // Create voice circle on the card (same as real mode)
  const monCard = document.querySelector('.mon-card');
  mainCircle = new MezzoVoiceCircle(circleContainer, {
    assetPath: 'assets',
    surfaceElement: monCard,
  });
  activeCircle = mainCircle;

  const CYCLE_MS = 12000;
  const INTERVAL_MS = 50;
  const baseline = baselineRMS;

  demoInterval = setInterval(() => {
    const t = Date.now() % CYCLE_MS;
    let targetRMS;

    if (t < 3000) {
      // 0-3s: within range
      targetRMS = baseline;
    } else if (t < 5000) {
      // 3-5s: ring-1
      targetRMS = baseline * 1.6;
    } else if (t < 7000) {
      // 5-7s: ring-2
      targetRMS = baseline * 2.2;
    } else if (t < 10000) {
      // 7-10s: ring-3 (sustained alert + dark card)
      targetRMS = baseline * 3.5;
    } else {
      // 10-12s: return to range
      targetRMS = baseline;
    }

    onAudioFrame({ rms: targetRMS });
  }, INTERVAL_MS);
}

// =============================================================================
// Init
// =============================================================================

const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

pageEnter();
isDemo ? startDemoMode() : startMonitoring();
