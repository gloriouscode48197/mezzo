/**
 * Mezzo — Monitoring Controller
 *
 * Uses existing AudioProcessor for mic capture and RMS sampling,
 * MezzoEngine for volume-zone classification (0-3), and MezzoVoiceCircle
 * for the voice visualization (gray -> orange tint + organic ring drift,
 * no background change, no blinking).
 *
 * Supports Picture-in-Picture via the Document PiP API:
 *   - Pop Out → circle moves to PiP window, main page shows "running in mini window"
 *   - Return → PiP closes, circle returns to main page
 *   - Close PiP → monitoring stops, navigates to calibrated-return
 *   - Monitoring runs in EITHER PiP OR main page, never both
 */

import { AudioProcessor } from './src/audio.js';
import { MezzoEngine } from './src/engine.js?v=5';
import { MezzoVoiceCircle } from './src/voice-circle.js?v=4';
import { trackMonitoringStarted, trackMonitoringSession } from './src/analytics.js';
import { pageEnter, navigateTo, transitionView } from './src/page-transition.js';
import { getResolvedSurface, onThemeChange } from './src/theme.js';

// =============================================================================
// Constants
// =============================================================================

const SELECTED_PROFILE_KEY = 'mezzoSelectedProfile';
const PIP_WIDTH = 1;
const PIP_HEIGHT = 1;

// Zone 3 is "Outside of Range" — there's no higher volume tier.
const OUTSIDE_ZONE = 3;

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
const monHeading = document.getElementById('mon-heading');

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
let demoInterval = null;   // setInterval ID for demo mode fake RMS
let pipHeading = null;     // <h1> in the PiP window, set while PiP is open
let unsubscribePipTheme = null; // clears the PiP window's theme-sync listener on close

// ── Volume classification, kept in sync every frame regardless of which
//    circle (if any) is currently attached — this is what lets the PiP
//    handoff and resume paths sync a freshly created circle instantly. ──
let currentZone = 0;

// ── Outside-range escalation state (drives ring drift, not color/background —
//    color is derived straight from zone, drift escalates once sustained) ──
let isSustained = false;
let sustainedTimer = null; // setTimeout ID for the 1s subtle->active drift escalation

const SUSTAINED_DRIFT_MS = 1000; // continuous time outside range before drift escalates

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
// Profile Loader
// =============================================================================

/**
 * Load whichever profile the user chose on try-it.html this session
 * (Recommended, a saved profile, or a just-calibrated temp custom profile).
 */
function loadSelectedProfile() {
  try {
    const stored = sessionStorage.getItem(SELECTED_PROFILE_KEY);
    if (!stored) return null;
    const profile = JSON.parse(stored);
    return profile && typeof profile.speakingDb === 'number' ? profile : null;
  } catch {
    return null;
  }
}

// =============================================================================
// Sustained-Outside Escalation
// =============================================================================

/** Clear any pending escalation and drop back to unsustained immediately. */
function clearSustained() {
  if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
  isSustained = false;
}

// =============================================================================
// Heading Text (Listening / Within Range / Outside of Range)
// =============================================================================

function zoneLabel(zone) {
  if (zone === 0) return 'Listening';
  if (zone === OUTSIDE_ZONE) return 'Outside of Range';
  return 'Within Range';
}

function updateHeading(zone) {
  const text = zoneLabel(zone);
  if (monHeading) monHeading.textContent = text;
  if (pipHeading) pipHeading.textContent = text;
}

// =============================================================================
// Audio Frame Handler
// =============================================================================

function onAudioFrame({ rms }) {
  engine.processFrame(rms);

  const zone = engine.getZone();

  if (zone !== currentZone) {
    const wasOutside = currentZone === OUTSIDE_ZONE;
    const nowOutside = zone === OUTSIDE_ZONE;

    updateHeading(zone);
    currentZone = zone;

    if (nowOutside && !wasOutside) {
      // Crossed into Outside of Range — subtle drift begins immediately;
      // escalate to active drift after holding for SUSTAINED_DRIFT_MS.
      sustainedTimer = setTimeout(() => {
        sustainedTimer = null;
        isSustained = true;
        sessionAlertTriggered = true;
      }, SUSTAINED_DRIFT_MS);
    } else if (!nowOutside && wasOutside) {
      // Returned to an acceptable volume — settle immediately (the CSS
      // transitions on color/drift handle the smooth "return to center" feel).
      clearSustained();
    }
  }

  // Update whichever circle is active
  if (activeCircle) {
    activeCircle.update(currentZone, isSustained);
  }

  // ── Debug: per-frame volume/zone info ──
  const diff = rms - baselineRMS;
  console.log(`[Frame] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  zone=${currentZone}  sustained=${isSustained}  ${zoneLabel(currentZone)}`);
}

// =============================================================================
// Start Monitoring (main page)
// =============================================================================

async function startMonitoring() {
  const profile = loadSelectedProfile();
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

  // Reset to "Listening" for the new session
  currentZone = 0;
  clearSustained();
  updateHeading(0);

  // Acquire mic
  try {
    await audio.acquire();
  } catch (err) {
    console.error('[Monitoring] Mic acquisition failed:', err.message);
    navigateTo('try-it.html');
    return;
  }

  // Create voice circle
  mainCircle = new MezzoVoiceCircle(circleContainer, { assetPath: 'assets' });
  activeCircle = mainCircle;

  // Audio frame callback
  audio.onLevelChange = onAudioFrame;
  audio.startMonitoring();

  // Analytics
  monitoringStartTime = Date.now();
  sessionUsedPip = false;
  sessionAlertTriggered = false;
  trackMonitoringStarted();
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

  // Clear escalation state
  clearSustained();
  currentZone = 0;

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
        width: min(var(--circle-container), 90cqmin) !important;
        height: min(var(--circle-container), 90cqmin) !important;
      }
      .mezzo-ring-layer:nth-child(1) { width: 32.14% !important; height: 32.14% !important; }
      .mezzo-ring-layer:nth-child(2) { width: 57.14% !important; height: 57.14% !important; }
      .mezzo-ring-layer:nth-child(3) { width: 85.71% !important; height: 85.71% !important; }
      .mezzo-ring-layer:nth-child(4) { width: 100% !important; height: 100% !important; }
    }
  `;
  pipDoc.head.appendChild(style);

  // ── Inherit the active theme, and stay in sync if it changes while PiP
  //    is open — the PiP window is a separate `document`, so it doesn't
  //    pick up the main page's data-surface automatically. ──
  pipDoc.body.setAttribute('data-surface', getResolvedSurface());
  unsubscribePipTheme = onThemeChange((surface) => {
    pipDoc.body.setAttribute('data-surface', surface);
  });

  // ── Build PiP layout: heading + circle + controls ──
  const layout = pipDoc.createElement('div');
  layout.className = 'pip-layout';

  const pipH = pipDoc.createElement('h1');
  pipH.className = 'pip-heading';
  pipH.textContent = zoneLabel(currentZone);
  layout.appendChild(pipH);
  pipHeading = pipH;

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
  pipCircle = new MezzoVoiceCircle(wrapper, { assetPath: baseUrl + 'assets' });
  activeCircle = pipCircle;

  // Immediately sync PiP circle to current state
  pipCircle.update(currentZone, isSustained);

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
  pipHeading = null;
  if (unsubscribePipTheme) {
    unsubscribePipTheme();
    unsubscribePipTheme = null;
  }

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
  updateHeading(currentZone);

  // Recreate circle on main page
  mainCircle = new MezzoVoiceCircle(circleContainer, { assetPath: 'assets' });
  activeCircle = mainCircle;

  // Immediately sync circle to current state
  mainCircle.update(currentZone, isSustained);
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
  clearSustained();
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
  engine.graceRemainingMs = 0; // skip grace period so zone changes trigger immediately

  // Create voice circle on the card (same as real mode)
  mainCircle = new MezzoVoiceCircle(circleContainer, { assetPath: 'assets' });
  activeCircle = mainCircle;

  const CYCLE_MS = 12000;
  const INTERVAL_MS = 50;
  const baseline = baselineRMS;

  demoInterval = setInterval(() => {
    const t = Date.now() % CYCLE_MS;
    let targetRMS;

    if (t < 2000) {
      // 0-2s: silence — zone 0, Listening
      targetRMS = baseline * 0.1;
    } else if (t < 4000) {
      // 2-4s: zone 1 — Within Range (target)
      targetRMS = baseline * 1.0;
    } else if (t < 6000) {
      // 4-6s: zone 2 — Within Range (acceptable)
      targetRMS = baseline * 1.5;
    } else if (t < 10000) {
      // 6-10s: zone 3 — Outside of Range. Orange + subtle drift begin
      // immediately; drift escalates to "active" once sustained past 7s.
      targetRMS = baseline * 2.3;
    } else {
      // 10-12s: back to silence — zone 0, Listening
      targetRMS = baseline * 0.1;
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
