/**
 * Mezzo — Companion Window Controller
 *
 * Uses existing AudioProcessor for mic capture and RMS sampling,
 * MezzoEngine for volume-zone classification (0-3), and MezzoWaveVisualizer
 * for the voice visualization (canvas-drawn organic contour + propagating
 * wave ripples, gray -> orange tint, no background change, no blinking).
 *
 * Every entry path — a tab navigation from try-it.html, a window.open()
 * popup, or the extension's chrome.windows.create popup — loads this exact
 * same page/script, so the experience is identical regardless of how the
 * user got here. Three page-level views:
 *   - view-ready: profile selection, "Start Monitoring" — the ALWAYS
 *     default landing state. Monitoring never starts on page load; it only
 *     starts from a real click on this view, because the Floating
 *     Companion (Document PiP) requires a fresh user gesture on this exact
 *     document — that gesture cannot survive a page navigation, so no
 *     entry path may auto-start.
 *   - view-pip-running ("control room"): shown once monitoring has
 *     actually started on a Floating-Companion-capable browser. Never
 *     shows the live circle — it's a management surface, not the
 *     monitoring interface. Two copy states driven by pipWindow's own
 *     truthiness (no separate tracked flag): "connected" (Floating
 *     Companion open, Show/End) and "disconnected" (closed unexpectedly,
 *     session still running, Reopen/End).
 *   - view-monitoring: live status + circle, "Stop Monitoring" — reachable
 *     ONLY when the browser has no Document PiP support at all. For that
 *     one case the Companion Window becomes the actual monitoring
 *     interface (not a fallback within a supported browser), keeping dark
 *     styling to preserve continuity with what the Floating Companion
 *     would have looked like.
 *
 * The Floating Companion (Document PiP) is the primary monitoring surface
 * whenever the browser supports it — dark, ambient, minimal, built for
 * peripheral awareness during a meeting. It has two internal modes,
 * toggled without tearing down the window itself:
 *   - Monitoring mode: live status, circle, "Stop Monitoring"
 *   - Ready mode: "Ready", current profile + a switcher, "Start Monitoring"
 * Stopping monitoring while it's open never navigates the opener —
 * Document PiP does not survive its opener navigating away (verified), so
 * doing so would silently kill the window. Creating a new profile from
 * "+ Create New Profile..." opens a genuinely new tab for the same reason,
 * syncing the result back via BroadcastChannel.
 */

import { AudioProcessor } from './src/audio.js?v=2';
import { MezzoEngine } from './src/engine.js?v=5';
import { MezzoWaveVisualizer } from './src/wave-visualizer.js';
import { trackMonitoringStarted, trackMonitoringSession } from './src/analytics.js';
import { pageEnter, navigateTo, transitionView } from './src/page-transition.js';
// TEMPORARY — background-tab throttling investigation, see
// docs/monitoring-runtime-investigation.md. Delete this import and its two
// call sites (in onAudioFrame) once the investigation concludes.
import { markClassification, markPipUpdate } from './src/_timing-debug.js';
import {
  RECOMMENDED_PROFILE,
  getSavedProfiles,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  setLastUsedProfile,
} from './src/profiles.js';

// =============================================================================
// Constants
// =============================================================================

const PIP_WIDTH = 345;
const PIP_HEIGHT = 360;

// Zone 3 is "Outside Range" — there's no higher volume tier.
const OUTSIDE_ZONE = 3;

const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

// Decided once, up front — never re-checked reactively per failed attempt.
// A browser either supports the Floating Companion or it doesn't; if it
// doesn't, the Companion Window becomes the actual monitoring interface for
// that browser rather than trying and falling back.
const pipSupported = 'documentPictureInPicture' in window;

// =============================================================================
// DOM References (main page)
// =============================================================================

const views = {
  monitoring: document.getElementById('view-monitoring'),
  ready: document.getElementById('view-ready'),
  pipRunning: document.getElementById('view-pip-running'),
};

const circleContainer = document.getElementById('circle-container');
const btnStop = document.getElementById('btn-stop');
const monHeading = document.getElementById('mon-heading');

// Ready view (main page) — the universal default landing state.
const readyProfileSelector = document.getElementById('ready-profile-selector');
const readyProfileNameEl = document.getElementById('ready-profile-name');
const readyProfileDropdown = document.getElementById('ready-profile-dropdown');
const btnReadyStart = document.getElementById('btn-ready-start');
const readyUnsupportedNote = document.getElementById('ready-unsupported-note');
const readyRetry = document.getElementById('ready-retry');
const btnReadyRetry = document.getElementById('btn-ready-retry');

// Control room (main page, shown once monitoring has actually started on a
// Floating-Companion-capable browser)
const pipRunningProfileNameEl = document.getElementById('pip-running-profile-name');
const pipRunningStatusText = document.getElementById('pip-running-status-text');
const btnShowFloatingCompanion = document.getElementById('btn-return-to-pip');
const btnEndMonitoring = document.getElementById('btn-end-monitoring');

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
let pipDocument = null; // the PiP window's own `document`, set while PiP is open
let baselineRMS = 0;
let activeProfile = null; // the profile object currently in use — needed for PiP's display/dropdown
let isMonitoringActive = false; // true from a successful mic acquisition until stopMonitoring()
let isPageUnloading = false;
let demoInterval = null;   // setInterval ID for demo mode fake RMS

// 'monitoring' | 'ready' — only meaningful while pipWindow is open
let pipMode = 'monitoring';

// PiP DOM refs, (re)assigned each time openPiP() builds the document
let pipHeading = null;
let pipCircleWrapperEl = null;
let pipMonitoringControls = null;
let pipReadyPanel = null;
let pipProfileNameEl = null;
let pipProfileDropdown = null;
let pipSwitchConfirmEl = null;
let pipSwitchCurrentNameEl = null;
let pendingSwitchProfile = null; // profile chosen from the dropdown while monitoring, awaiting confirm

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
// Cross-Tab Profile Sync
// =============================================================================

// Receives the freshly-created profile from a "+ Create New Profile..." tab
// (opened via window.open, since Document PiP doesn't survive this tab
// navigating away — see file header). Active for the lifetime of this page.
const profileSyncChannel = new BroadcastChannel('mezzo-profile-sync');
profileSyncChannel.addEventListener('message', (event) => {
  if (event.data?.type !== 'PROFILE_READY' || !event.data.profile) return;
  const profile = event.data.profile;
  setSelectedProfile(profile);
  setLastUsedProfile(profile);

  // Only actually adopt it as the active profile if we're not mid-session —
  // switching profiles while monitoring still requires the explicit
  // stop-and-switch confirmation, same as picking one from the dropdown.
  if (!isMonitoringActive) {
    activateProfile(profile); // refreshes PiP/ready/control-room displays too
  }
});

// =============================================================================
// View Management
// =============================================================================

function showView(name) {
  transitionView(views, name);
}

// =============================================================================
// Profile Resolution
// =============================================================================

/**
 * Resolve which profile this tab should use: this tab's own session choice
 * first, then whichever profile was last used anywhere (what lets a fresh
 * tab launched by the browser extension skip straight to monitoring), then
 * null (genuinely first-time — caller should send them to Choose a Profile).
 */
function loadActiveProfile() {
  let profile = getSelectedProfile();
  if (profile) return profile;

  profile = getLastUsedProfile();
  if (profile) {
    setSelectedProfile(profile); // keep this tab's session consistent going forward
    return profile;
  }

  return null;
}

function profilesMatch(a, b) {
  if (!a || !b) return false;
  return (a.savedProfileId ?? null) === (b.savedProfileId ?? null) && a.name === b.name;
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
// Heading Text (Quiet / Within Range / Approaching Range / Outside Range / Ready)
// =============================================================================

function zoneLabel(zone) {
  if (zone === 0) return 'Quiet';
  if (zone === 1) return 'Within Range';
  if (zone === 2) return 'Approaching Range';
  return 'Outside Range'; // zone === OUTSIDE_ZONE
}

function updateHeading(zone) {
  const text = zoneLabel(zone);
  if (monHeading) monHeading.textContent = text;
  if (pipHeading && pipMode === 'monitoring') pipHeading.textContent = text;
}

// =============================================================================
// Audio Frame Handler
// =============================================================================

function onAudioFrame({ rms }) {
  engine.processFrame(rms);
  markClassification(); // TEMPORARY — see docs/monitoring-runtime-investigation.md

  const zone = engine.getZone();

  if (zone !== currentZone) {
    const wasOutside = currentZone === OUTSIDE_ZONE;
    const nowOutside = zone === OUTSIDE_ZONE;

    updateHeading(zone);
    currentZone = zone;

    if (nowOutside && !wasOutside) {
      // Crossed into Outside Range — subtle drift begins immediately;
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
    markPipUpdate(pipWindow); // TEMPORARY — see docs/monitoring-runtime-investigation.md
  }

  // ── Debug: per-frame volume/zone info ──
  const diff = rms - baselineRMS;
  console.log(`[Frame] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  zone=${currentZone}  sustained=${isSustained}  ${zoneLabel(currentZone)}`);
}

// =============================================================================
// Shared Session Setup
// =============================================================================

/**
 * Calibrate the engine, acquire the mic, and start frame processing for
 * `profile`. Does not create/attach a circle or touch PiP — callers differ
 * on that (fresh page load vs. resuming from PiP's Ready mode).
 * @returns {Promise<boolean>} false if mic acquisition failed
 */
async function beginMonitoringSession(profile) {
  activeProfile = profile;
  setSelectedProfile(profile);
  setLastUsedProfile(profile);

  baselineRMS = Math.pow(10, profile.speakingDb / 20);
  const samples = new Array(100).fill(baselineRMS);
  engine.calibrate(samples);
  engine.startMonitoring();

  currentZone = 0;
  clearSustained();
  updateHeading(0);

  try {
    await audio.acquire();
  } catch (err) {
    console.error('[Monitoring] Mic acquisition failed:', err.message);
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

// =============================================================================
// Start Monitoring (from a real click on the Ready view)
// =============================================================================

/**
 * The one place monitoring actually starts. Only ever called from a real,
 * same-page click on view-ready's "Start Monitoring" button — never on page
 * load — because the Floating Companion requires a fresh user gesture on
 * this exact document, and that's the only way to guarantee one.
 */
async function handleStartMonitoringClick() {
  const profile = activeProfile;
  if (!profile) return;

  if (pipSupported) {
    const opened = await openPiP();
    if (!opened) {
      // Rare on a supported browser reached via a real click — stay on
      // Ready and offer an explicit retry rather than silently degrading.
      showReadyRetry();
      return;
    }

    const ok = await beginMonitoringSession(profile);
    if (!ok) {
      // Mic denied after the Floating Companion already opened — nothing
      // to show in it, close it and stay on Ready.
      closeOrphanedPip();
      return;
    }

    activeCircle = pipCircle;
    sessionUsedPip = true;
    // openPiP() already switched to the control room and rendered its
    // "connected" copy.
  } else {
    const ok = await beginMonitoringSession(profile);
    if (!ok) return; // stay on Ready

    mainCircle = new MezzoWaveVisualizer(circleContainer);
    activeCircle = mainCircle;
    sessionUsedPip = false;
    showView('monitoring');
  }
}

function showReadyRetry() {
  if (readyRetry) readyRetry.classList.remove('hidden');
}

function hideReadyRetry() {
  if (readyRetry) readyRetry.classList.add('hidden');
}

function closeOrphanedPip() {
  if (!pipWindow) return;
  try { pipWindow.close(); } catch { /* ignore */ }
}

// =============================================================================
// Resume Monitoring from PiP's Ready Mode
// =============================================================================

async function resumeMonitoringFromPipReady() {
  const profile = activeProfile;
  if (!profile) return; // shouldn't happen — Ready mode always has an active profile

  const ok = await beginMonitoringSession(profile);
  if (!ok) return; // stay in Ready mode; nothing else to clean up since nothing started

  if (!pipCircle && pipCircleWrapperEl) {
    pipCircle = new MezzoWaveVisualizer(pipCircleWrapperEl);
  }
  activeCircle = pipCircle;
  sessionUsedPip = true;

  enterPipMonitoringMode();
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

  isMonitoringActive = false;
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

  if (pipWindow) {
    // PiP-first (PRD-004): stopping never closes PiP or navigates the
    // opener — Document PiP does not survive its opener navigating away
    // (verified), so doing so would silently kill the PiP window. Keep the
    // circle alive showing the idle "Quiet" state and switch to Ready.
    activeCircle = pipCircle;
    if (pipCircle) pipCircle.update(0, false);
    enterPipReadyMode();
    return;
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

/** @returns {Promise<boolean>} whether the Floating Companion actually opened */
async function openPiP() {
  if (!('documentPictureInPicture' in window)) {
    console.warn('[Monitoring] Document PiP API not supported');
    return false;
  }

  try {
    pipWindow = await documentPictureInPicture.requestWindow({
      width: PIP_WIDTH,
      height: PIP_HEIGHT,
    });
  } catch (err) {
    console.error('[Monitoring] Failed to open PiP window:', err.message);
    return false;
  }

  console.log('[PiP] Requested: %d×%d — Actual: %d×%d', PIP_WIDTH, PIP_HEIGHT, pipWindow.innerWidth, pipWindow.innerHeight);

  const pipDoc = pipWindow.document;
  pipDocument = pipDoc;

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

  // ── Inject PiP styles (compact + expanded modes, both PiP modes) ──
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
    /* ── Layout shell ── */
    .pip-layout {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* ── Header block (wordmark + status row) — hidden in compact mode ── */
    .pip-header-block {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 28px 20px 0;
      width: 100%;
      box-sizing: border-box;
    }
    .pip-wordmark {
      font-family: var(--font-display);
      font-weight: var(--weight-light);
      font-size: 14px;
      color: var(--text-primary);
      letter-spacing: 0.04em;
    }
    .mon-status {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mon-status-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--hanko-fill);
      flex-shrink: 0;
      animation: mezzo-pulse 3.3s ease-in-out infinite;
    }
    @keyframes mezzo-pulse {
      0%, 100% { opacity: 0.26; transform: scale(1); }
      50%       { opacity: 0.54; transform: scale(1.22); }
    }
    .mon-heading {
      font-family: var(--font-display);
      font-weight: var(--weight-light);
      font-size: 15px;
      color: var(--text-subdued);
      letter-spacing: 0.04em;
    }
    .pip-controls, .pip-ready-panel {
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 0 20px 32px;
      gap: 12px;
      width: 100%;
      box-sizing: border-box;
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

    /* ── Profile selector — persistent across both modes ── */
    .pip-profile-selector {
      position: relative;
      display: none;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 100px;
      padding: 8px 16px;
      font-family: var(--font-body);
      font-size: 13px;
      color: var(--text-default);
      cursor: pointer;
    }
    .pip-profile-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
      padding: 6px;
      display: flex;
      flex-direction: column;
      z-index: 10;
      max-height: 180px;
      overflow-y: auto;
    }
    .pip-profile-option {
      text-align: left;
      background: none;
      border: none;
      padding: 8px 10px;
      font-family: var(--font-body);
      font-size: 13px;
      color: var(--text-default);
      cursor: pointer;
      border-radius: 6px;
      white-space: nowrap;
    }
    .pip-profile-option:hover { background: var(--surface-card); }
    .pip-profile-divider { border: none; border-top: 1px solid var(--border); margin: 4px 0; }

    /* ── Switch Profile confirmation (Monitoring mode, overlays everything) ── */
    .pip-switch-confirm {
      position: absolute;
      inset: 0;
      background: var(--surface);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px;
      text-align: center;
      z-index: 20;
      font-family: var(--font-body);
    }
    .pip-switch-confirm p { margin: 0; color: var(--text-default); font-size: 13px; }
    .pip-switch-confirm .pip-switch-title {
      font-family: var(--font-display);
      font-size: 18px;
      color: var(--text-primary);
    }
    .pip-switch-actions { display: flex; gap: 12px; margin-top: 8px; }

    /* ── Circle wrapper — the new visualizer sizes itself to this via
       ResizeObserver, so no ring-specific sizing rules are needed here. ── */
    .pip-circle-wrapper {
      flex: 1;
      width: 100%;
      overflow: hidden;
    }

    /* ── Expanded mode: card-like layout ── */
    @media (min-width: 300px) and (min-height: 350px) {
      .pip-header-block { display: flex; }
      .pip-profile-selector { display: flex; }
      .pip-controls, .pip-ready-panel { display: flex; }
      .pip-circle-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
      }
    }
  `;
  pipDoc.head.appendChild(style);

  // Dark is the fixed site-wide look (no theme toggle) — the PiP window is
  // a separate `document`, so it doesn't pick up the main page's
  // data-surface automatically and needs this set directly.
  pipDoc.body.setAttribute('data-surface', 'dark');

  // ── Build PiP layout: header block + circle + monitoring controls + ready panel ──
  const layout = pipDoc.createElement('div');
  layout.className = 'pip-layout';
  layout.style.position = 'relative'; // anchors the switch-confirm overlay

  const headerBlock = pipDoc.createElement('div');
  headerBlock.className = 'pip-header-block';

  const wordmark = pipDoc.createElement('span');
  wordmark.className = 'pip-wordmark';
  wordmark.textContent = 'Mezzo';
  headerBlock.appendChild(wordmark);

  const statusRow = pipDoc.createElement('div');
  statusRow.className = 'mon-status';
  const statusDot = pipDoc.createElement('div');
  statusDot.className = 'mon-status-dot';
  statusRow.appendChild(statusDot);

  const pipH = pipDoc.createElement('span');
  pipH.className = 'mon-heading';
  pipH.textContent = zoneLabel(currentZone);
  statusRow.appendChild(pipH);
  pipHeading = pipH;

  headerBlock.appendChild(statusRow);
  layout.appendChild(headerBlock);

  // ── Profile selector — persistent across both modes (per PRD, switching
  //    profiles is reachable *while monitoring* too, just gated behind the
  //    confirmation dialog instead of switching immediately). ──
  const profileSelector = pipDoc.createElement('button');
  profileSelector.type = 'button';
  profileSelector.className = 'pip-profile-selector';
  const profileNameSpan = pipDoc.createElement('span');
  profileNameSpan.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
  const chevronSpan = pipDoc.createElement('span');
  chevronSpan.textContent = '▾';
  chevronSpan.setAttribute('aria-hidden', 'true');
  profileSelector.appendChild(profileNameSpan);
  profileSelector.appendChild(chevronSpan);
  profileSelector.addEventListener('click', togglePipProfileDropdown);
  pipProfileNameEl = profileNameSpan;

  const dropdown = pipDoc.createElement('div');
  dropdown.className = 'pip-profile-dropdown hidden';
  profileSelector.appendChild(dropdown);
  pipProfileDropdown = dropdown;

  layout.appendChild(profileSelector);

  const wrapper = pipDoc.createElement('div');
  wrapper.className = 'pip-circle-wrapper';
  layout.appendChild(wrapper);
  pipCircleWrapperEl = wrapper;

  // ── Monitoring mode controls ──
  const controls = pipDoc.createElement('div');
  controls.className = 'pip-controls';

  const pipStopBtn = pipDoc.createElement('button');
  pipStopBtn.className = 'btn-primary btn-wide';
  pipStopBtn.textContent = 'Stop Monitoring';
  pipStopBtn.addEventListener('click', stopMonitoring);
  controls.appendChild(pipStopBtn);

  const pipMicro = pipDoc.createElement('p');
  pipMicro.className = 'pip-micro';
  pipMicro.textContent = 'Nothing is recorded or saved.';
  controls.appendChild(pipMicro);

  layout.appendChild(controls);
  pipMonitoringControls = controls;

  // ── Ready mode panel: just "Start Monitoring" now — the profile selector
  //    above is shared with monitoring mode. ──
  const readyPanel = pipDoc.createElement('div');
  readyPanel.className = 'pip-ready-panel hidden';

  const pipStartBtn = pipDoc.createElement('button');
  pipStartBtn.className = 'btn-primary btn-wide';
  pipStartBtn.textContent = 'Start Monitoring';
  pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
  readyPanel.appendChild(pipStartBtn);

  layout.appendChild(readyPanel);
  pipReadyPanel = readyPanel;

  // ── Switch Profile confirmation overlay ──
  const switchConfirm = pipDoc.createElement('div');
  switchConfirm.className = 'pip-switch-confirm hidden';

  const switchTitle = pipDoc.createElement('p');
  switchTitle.className = 'pip-switch-title';
  switchTitle.textContent = 'Switch Profile?';
  switchConfirm.appendChild(switchTitle);

  const switchBody1 = pipDoc.createElement('p');
  switchBody1.textContent = 'Monitoring is currently using:';
  switchConfirm.appendChild(switchBody1);

  const switchCurrentName = pipDoc.createElement('p');
  switchCurrentName.style.fontWeight = '600';
  switchConfirm.appendChild(switchCurrentName);
  pipSwitchCurrentNameEl = switchCurrentName;

  const switchBody2 = pipDoc.createElement('p');
  switchBody2.textContent = 'Switching profiles requires restarting monitoring.';
  switchConfirm.appendChild(switchBody2);

  const switchActions = pipDoc.createElement('div');
  switchActions.className = 'pip-switch-actions';

  const switchCancelBtn = pipDoc.createElement('button');
  switchCancelBtn.className = 'btn-outline';
  switchCancelBtn.textContent = 'Cancel';
  switchCancelBtn.addEventListener('click', handleSwitchCancel);
  switchActions.appendChild(switchCancelBtn);

  const switchConfirmBtn = pipDoc.createElement('button');
  switchConfirmBtn.className = 'btn-primary';
  switchConfirmBtn.textContent = 'Stop & Switch';
  switchConfirmBtn.addEventListener('click', handleSwitchConfirm);
  switchActions.appendChild(switchConfirmBtn);

  switchConfirm.appendChild(switchActions);
  layout.appendChild(switchConfirm);
  pipSwitchConfirmEl = switchConfirm;

  pipDoc.body.appendChild(layout);

  // ── Tear down main circle ──
  if (mainCircle) {
    mainCircle.destroy();
    mainCircle = null;
  }

  // ── Create PiP visualizer ──
  pipCircle = new MezzoWaveVisualizer(wrapper);
  activeCircle = pipCircle;

  // Immediately sync PiP circle to current state
  pipCircle.update(currentZone, isSustained);

  // openPiP() is only ever called right after monitoring has just started —
  // resuming from Ready mode reuses this same open window instead.
  pipMode = 'monitoring';

  // ── Switch companion window to the control-room state ──
  sessionUsedPip = true;
  updatePipRunningProfileDisplay();
  updateControlRoomView();
  showView('pipRunning');

  // ── Handle PiP close (browser close button or programmatic) ──
  pipWindow.addEventListener('pagehide', handlePipClose);

  return true;
}

// =============================================================================
// PiP Mode Switching
// =============================================================================

function enterPipReadyMode() {
  if (!pipWindow) return;
  pipMode = 'ready';
  if (pipHeading) pipHeading.textContent = 'Ready';
  if (pipMonitoringControls) pipMonitoringControls.classList.add('hidden');
  if (pipReadyPanel) pipReadyPanel.classList.remove('hidden');
  closePipProfileDropdown();
  hidePipSwitchConfirm();
  updatePipProfileDisplay();
}

function enterPipMonitoringMode() {
  if (!pipWindow) return;
  pipMode = 'monitoring';
  if (pipMonitoringControls) pipMonitoringControls.classList.remove('hidden');
  if (pipReadyPanel) pipReadyPanel.classList.add('hidden');
  closePipProfileDropdown();
  hidePipSwitchConfirm();
  updateHeading(currentZone);
}

// =============================================================================
// PiP Profile Switching
// =============================================================================

// Shared by the PiP profile dropdown and the main-page Ready view's
// dropdown — same options, same "+ Create New Profile..." row, different
// document/container/callbacks per caller. Avoids duplicating the profile
// list rendering in two places.
function renderProfileDropdown(doc, dropdownEl, { onPick, onCreateNew }) {
  if (!dropdownEl || !doc) return;
  dropdownEl.innerHTML = '';

  const profiles = [RECOMMENDED_PROFILE, ...getSavedProfiles()];
  for (const profile of profiles) {
    const isActive = profilesMatch(activeProfile, profile);
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'pip-profile-option';
    row.textContent = (isActive ? '✓ ' : '') + profile.name;
    row.addEventListener('click', () => onPick(profile));
    dropdownEl.appendChild(row);
  }

  const divider = doc.createElement('hr');
  divider.className = 'pip-profile-divider';
  dropdownEl.appendChild(divider);

  const createBtn = doc.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'pip-profile-option';
  createBtn.textContent = '+ Create New Profile...';
  createBtn.addEventListener('click', onCreateNew);
  dropdownEl.appendChild(createBtn);
}

function updatePipProfileDisplay() {
  if (pipProfileNameEl) {
    pipProfileNameEl.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
  }
  renderPipProfileDropdown();
}

function renderPipProfileDropdown() {
  renderProfileDropdown(pipDocument, pipProfileDropdown, {
    onPick: handlePipProfilePick,
    onCreateNew: handleCreateNewProfileFromPip,
  });
}

function togglePipProfileDropdown() {
  if (pipProfileDropdown) renderPipProfileDropdown(); // refresh in case profiles changed
  if (pipProfileDropdown) pipProfileDropdown.classList.toggle('hidden');
}

function closePipProfileDropdown() {
  if (pipProfileDropdown) pipProfileDropdown.classList.add('hidden');
}

// ── Ready view (main page) — same dropdown, no confirmation gate since
//    nothing is monitoring while this view is shown. ──

function updateReadyProfileDisplay() {
  if (readyProfileNameEl) {
    readyProfileNameEl.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
  }
  renderProfileDropdown(document, readyProfileDropdown, {
    onPick: handleReadyProfilePick,
    onCreateNew: handleCreateNewProfileFromReady,
  });
}

function toggleReadyProfileDropdown() {
  if (readyProfileDropdown) updateReadyProfileDisplay(); // refresh in case profiles changed
  if (readyProfileDropdown) readyProfileDropdown.classList.toggle('hidden');
}

function closeReadyProfileDropdown() {
  if (readyProfileDropdown) readyProfileDropdown.classList.add('hidden');
}

function handleReadyProfilePick(profile) {
  closeReadyProfileDropdown();
  if (profilesMatch(activeProfile, profile)) return;
  activateProfile(profile);
}

function handleCreateNewProfileFromReady() {
  closeReadyProfileDropdown();
  window.open('try-it.html?entry=create-profile', '_blank');
}

/** Show the Ready view with the current/last-used profile for display. */
function enterReadyView() {
  activeProfile = loadActiveProfile() || RECOMMENDED_PROFILE;
  updateReadyProfileDisplay();
  showView('ready');
}

/** Reflects the active profile in the control-room state (view-only there). */
function updatePipRunningProfileDisplay() {
  if (pipRunningProfileNameEl) {
    pipRunningProfileNameEl.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
  }
}

/**
 * The control room has exactly one source of truth for which of its two
 * copy states to show: whether pipWindow is currently set. No separate
 * "connected" flag to keep in sync — this is called any time that could
 * have changed (after opening, reopening, or the Floating Companion
 * closing unexpectedly).
 */
function updateControlRoomView() {
  const connected = !!pipWindow;
  if (pipRunningStatusText) {
    pipRunningStatusText.textContent = connected
      ? 'The Floating Companion is open.'
      : 'Floating Companion closed. Monitoring is still active.';
  }
  if (btnShowFloatingCompanion) {
    btnShowFloatingCompanion.textContent = connected
      ? 'Show Floating Companion'
      : 'Reopen Floating Companion';
  }
}

function handlePipProfilePick(profile) {
  closePipProfileDropdown();
  if (profilesMatch(activeProfile, profile)) return;

  if (pipMode === 'monitoring') {
    // Switching while actively monitoring requires confirmation.
    pendingSwitchProfile = profile;
    showPipSwitchConfirm();
  } else {
    // Ready mode — switches immediately, no confirmation (per PRD).
    activateProfile(profile);
  }
}

function activateProfile(profile) {
  activeProfile = profile;
  setSelectedProfile(profile);
  updatePipProfileDisplay();
  updatePipRunningProfileDisplay();
  updateReadyProfileDisplay();
}

function showPipSwitchConfirm() {
  if (!pipSwitchConfirmEl) return;
  if (pipSwitchCurrentNameEl) {
    pipSwitchCurrentNameEl.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
  }
  pipSwitchConfirmEl.classList.remove('hidden');
}

function hidePipSwitchConfirm() {
  if (pipSwitchConfirmEl) pipSwitchConfirmEl.classList.add('hidden');
  pendingSwitchProfile = null;
}

function handleSwitchCancel() {
  hidePipSwitchConfirm();
}

function handleSwitchConfirm() {
  const profile = pendingSwitchProfile;
  hidePipSwitchConfirm();
  if (!profile) return;
  activateProfile(profile); // updated before stopping so Ready mode shows the new profile
  stopMonitoring(); // pipWindow is open, so this transitions to Ready mode (not a navigation)
}

function handleCreateNewProfileFromPip() {
  closePipProfileDropdown();
  // A genuinely new tab — Document PiP does not survive this tab navigating
  // away, so the calibration flow can never happen in the PiP-owning tab.
  window.open('try-it.html?entry=create-profile', '_blank');
}

// =============================================================================
// PiP Lifecycle
// =============================================================================

function handlePipClose() {
  const wasMonitoringMode = pipMode === 'monitoring';

  // Clean up PiP circle
  if (pipCircle) {
    pipCircle.destroy();
    pipCircle = null;
  }
  pipWindow = null;
  pipDocument = null;
  pipHeading = null;
  pipCircleWrapperEl = null;
  pipMonitoringControls = null;
  pipReadyPanel = null;
  pipProfileNameEl = null;
  pipProfileDropdown = null;
  pipSwitchConfirmEl = null;
  pipSwitchCurrentNameEl = null;

  // Guard against running during window close
  if (isPageUnloading) return;

  // Reaching here always means the floating window was closed directly (its
  // own ✕) — "Show Floating Companion" only focuses it (see
  // btnShowFloatingCompanion below) and "End Monitoring" stops the session
  // without closing it, so neither of those trigger this handler.
  if (wasMonitoringMode && isMonitoringActive) {
    // Session is still running — the control room stays the control room,
    // it never becomes a monitoring interface. Just re-render its copy for
    // the now-disconnected state (pipWindow is already null above).
    updateControlRoomView();
  } else {
    // No active session (includes the rare case where mic acquisition
    // failed right after the Floating Companion opened).
    enterReadyView();
  }
}

// =============================================================================
// Event Binding
// =============================================================================

btnStop?.addEventListener('click', stopMonitoring);
btnReadyStart?.addEventListener('click', handleStartMonitoringClick);
btnReadyRetry?.addEventListener('click', () => {
  hideReadyRetry();
  handleStartMonitoringClick();
});
readyProfileSelector?.addEventListener('click', toggleReadyProfileDropdown);
btnShowFloatingCompanion?.addEventListener('click', () => {
  if (pipWindow) {
    // Extensions can't focus a floating PiP window (chrome.tabs/windows
    // only reach the underlying tab) — but this page holds a direct
    // same-origin reference to it, and page-level window.focus() is not
    // similarly restricted for a window this page itself opened.
    try {
      pipWindow.focus();
    } catch (err) {
      console.warn('[Monitoring] Could not focus the Floating Companion:', err.message);
    }
  } else {
    // Disconnected — this is a fresh click, so it should succeed. openPiP()
    // reads currentZone/isSustained/activeProfile from existing state, so
    // the reopened window syncs to live state automatically.
    openPiP();
  }
});
btnEndMonitoring?.addEventListener('click', stopMonitoring);

// Shown once, before monitoring begins, so the user isn't surprised later.
if (!pipSupported && readyUnsupportedNote) {
  readyUnsupportedNote.classList.remove('hidden');
}

// The companion window is the runtime owner of the session — closing it
// stops monitoring and PiP (see the pagehide handler below). beforeunload
// is used ONLY to ask for confirmation: Chrome has not allowed custom
// dialog text/buttons here since Chrome 51 (abuse hardening), so the
// closest supported approximation of "Close Mezzo? ... [Cancel] [Close and
// Stop]" is the browser's own generic "Leave site?" prompt. Actual teardown
// must NOT happen in this handler, since the user might cancel — it's
// deferred to pagehide, which only fires once the unload actually proceeds.
window.addEventListener('beforeunload', (event) => {
  if (!isMonitoringActive) return;
  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('pagehide', () => {
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

  // Create visualizer on the card (same as real mode)
  mainCircle = new MezzoWaveVisualizer(circleContainer);
  activeCircle = mainCircle;

  const CYCLE_MS = 12000;
  const INTERVAL_MS = 50;
  const baseline = baselineRMS;

  demoInterval = setInterval(() => {
    const t = Date.now() % CYCLE_MS;
    let targetRMS;

    if (t < 2000) {
      // 0-2s: silence — zone 0, Quiet
      targetRMS = baseline * 0.1;
    } else if (t < 4000) {
      // 2-4s: zone 1 — Within Range (target)
      targetRMS = baseline * 1.0;
    } else if (t < 6000) {
      // 4-6s: zone 2 — Approaching Range
      targetRMS = baseline * 1.5;
    } else if (t < 10000) {
      // 6-10s: zone 3 — Outside Range. Orange + subtle drift begin
      // immediately; drift escalates to "active" once sustained past 7s.
      targetRMS = baseline * 2.3;
    } else {
      // 10-12s: back to silence — zone 0, Quiet
      targetRMS = baseline * 0.1;
    }

    onAudioFrame({ rms: targetRMS });
  }, INTERVAL_MS);
}

// =============================================================================
// Init
// =============================================================================

pageEnter();
if (isDemo) {
  startDemoMode();
} else {
  // Ready is the universal landing state for every entry path — monitoring
  // never starts on page load, only from a real click on this view (see
  // handleStartMonitoringClick()).
  enterReadyView();
}
