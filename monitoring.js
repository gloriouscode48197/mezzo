/**
 * Mezzo — Monitoring Controller
 *
 * Uses existing AudioProcessor for mic capture and RMS sampling,
 * MezzoEngine for volume-zone classification (0-3), and MezzoVoiceCircle
 * for the voice visualization (gray -> orange tint + organic ring drift,
 * no background change, no blinking).
 *
 * Companion window: this page is meant to run inside a dedicated browser
 * window opened by the extension (extension/lib/window-manager.js), not a
 * tab in the user's meeting window — but it works identically if opened
 * directly, since none of the logic below depends on how the tab/window
 * was created. Three page-level views:
 *   - view-monitoring: live status + circle, "Stop Monitoring" (also the
 *     fallback shown whenever PiP isn't open, including if it fails to
 *     open or closes unexpectedly while monitoring is active)
 *   - view-ready: profile selection before starting — shown for
 *     `?launch=choose` launches, or if PiP closes with no active session
 *   - view-pip-running ("control room"): shown once PiP is open —
 *     "Return to PiP" focuses the floating window, "End Monitoring" stops
 *     the session without closing PiP (transitions it to Ready mode)
 *
 * PiP-first (PRD-004): Picture-in-Picture is the primary surface, not an
 * optional pop-out. Once monitoring starts, PiP opens automatically and
 * stays open across Stop/Start cycles — it has two modes, toggled without
 * tearing down the PiP window:
 *   - Monitoring mode: live status, circle, "Stop Monitoring"
 *   - Ready mode: "Ready", current profile + a switcher, "Start Monitoring"
 * Stopping monitoring while PiP is open never navigates the opener —
 * Document PiP does not survive its opener navigating away (verified), so
 * doing so would silently kill the PiP window. Creating a new profile from
 * PiP's "+ Create New Profile..." opens a genuinely new tab for the same
 * reason, syncing the result back via BroadcastChannel.
 *
 * Supports Picture-in-Picture via the Document PiP API:
 *   - Auto-opens after Start Monitoring succeeds (not in demo mode)
 *   - PiP closes unexpectedly (user clicks its own ✕) while monitoring is
 *     active → falls back to the plain view-monitoring circle in this
 *     window; the session itself is never interrupted by this
 *   - Monitoring runs in EITHER PiP OR this window's plain view, never both
 */

import { AudioProcessor } from './src/audio.js?v=2';
import { MezzoEngine } from './src/engine.js?v=5';
import { MezzoVoiceCircle } from './src/voice-circle.js?v=4';
import { trackMonitoringStarted, trackMonitoringSession } from './src/analytics.js';
import { pageEnter, navigateTo, transitionView } from './src/page-transition.js';
import { getResolvedSurface, onThemeChange } from './src/theme.js';
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

const PIP_WIDTH = 1;
const PIP_HEIGHT = 1;

// Zone 3 is "Outside of Range" — there's no higher volume tier.
const OUTSIDE_ZONE = 3;

const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

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
const btnPip = document.getElementById('btn-pip');
const monHeading = document.getElementById('mon-heading');

// Ready view (main page) — shown for ?launch=choose launches, and as the
// fallback when the floating PiP window closes with no active session.
const readyProfileSelector = document.getElementById('ready-profile-selector');
const readyProfileNameEl = document.getElementById('ready-profile-name');
const readyProfileDropdown = document.getElementById('ready-profile-dropdown');
const btnReadyStart = document.getElementById('btn-ready-start');

// Control room (main page, shown while PiP is running)
const pipRunningProfileNameEl = document.getElementById('pip-running-profile-name');
const btnReturnToPip = document.getElementById('btn-return-to-pip');
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
let unsubscribePipTheme = null; // clears the PiP window's theme-sync listener on close

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
// Heading Text (Listening / Within Range / Outside of Range / Ready)
// =============================================================================

function zoneLabel(zone) {
  if (zone === 0) return 'Listening';
  if (zone === OUTSIDE_ZONE) return 'Outside of Range';
  return 'Within Range';
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
// Start Monitoring (fresh page load / demo mode)
// =============================================================================

async function startMonitoring(profileOverride) {
  const profile = profileOverride || loadActiveProfile();
  if (!profile) {
    navigateTo('try-it.html');
    return;
  }

  // PiP is the primary surface (PRD-004) — open it automatically rather
  // than requiring a manual "Pop Out" click. This has to happen BEFORE any
  // other awaited work: requestWindow() requires a live user gesture, and
  // Chrome's activation window is short enough that awaiting mic
  // acquisition first (a few hundred ms, sometimes more) can let it expire
  // — confirmed empirically, this is a real race, not a hypothetical.
  // Opening PiP first uses the click's activation as directly as possible.
  // If it still doesn't happen (unsupported browser, activation unavailable
  // for any reason), everything below degrades gracefully to the plain
  // page with a manual Pop Out button — this is not a hard requirement.
  // Demo mode never auto-opens PiP — it's a debugging tool, and forcing a
  // real popup during automated verification would break the existing
  // demo-mode-based testing approach used throughout this project.
  if (!isDemo) {
    await openPiP();
  }

  const ok = await beginMonitoringSession(profile);
  if (!ok) {
    navigateTo('try-it.html');
    return;
  }

  if (pipWindow) {
    activeCircle = pipCircle;
    sessionUsedPip = true;
  } else {
    mainCircle = new MezzoVoiceCircle(circleContainer, { assetPath: 'assets' });
    activeCircle = mainCircle;
    sessionUsedPip = false;
  }
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
    pipCircle = new MezzoVoiceCircle(pipCircleWrapperEl, { assetPath: baseUrl + 'assets' });
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
    // circle alive showing the idle "Listening" state and switch to Ready.
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
      .pip-profile-selector { display: flex; }
      .pip-controls, .pip-ready-panel { display: flex; }
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

  // ── Build PiP layout: heading + circle + monitoring controls + ready panel ──
  const layout = pipDoc.createElement('div');
  layout.className = 'pip-layout';
  layout.style.position = 'relative'; // anchors the switch-confirm overlay

  const pipH = pipDoc.createElement('h1');
  pipH.className = 'pip-heading';
  pipH.textContent = zoneLabel(currentZone);
  layout.appendChild(pipH);
  pipHeading = pipH;

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

  // ── Create PiP circle (absolute URLs for about:blank context) ──
  pipCircle = new MezzoVoiceCircle(wrapper, { assetPath: baseUrl + 'assets' });
  activeCircle = pipCircle;

  // Immediately sync PiP circle to current state
  pipCircle.update(currentZone, isSustained);

  // openPiP() is only ever called right after monitoring has just started —
  // resuming from Ready mode reuses this same open window instead.
  pipMode = 'monitoring';

  // ── Switch companion window to the control-room state ──
  sessionUsedPip = true;
  updatePipRunningProfileDisplay();
  showView('pipRunning');

  // ── Handle PiP close (browser close button or programmatic) ──
  pipWindow.addEventListener('pagehide', handlePipClose);
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
  const wasReadyMode = pipMode === 'ready';

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
  if (unsubscribePipTheme) {
    unsubscribePipTheme();
    unsubscribePipTheme = null;
  }

  // Guard against running during window close
  if (isPageUnloading) return;

  // Reaching here always means the floating PiP window was closed directly
  // (its own ✕) — "Return to PiP" only focuses it (see btnReturnToPip
  // below) and "End Monitoring" stops the session without closing PiP, so
  // neither of those trigger this handler. Fall back to the companion
  // window's own view rather than tearing anything down — it remains the
  // runtime owner of the session either way.
  if (wasReadyMode) {
    enterReadyView(); // no active session to resume — show the equivalent state here
  } else {
    resumeMainMonitoring(); // monitoring continues, now shown in this window's plain view
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

// =============================================================================
// Event Binding
// =============================================================================

btnStop?.addEventListener('click', stopMonitoring);
btnPip?.addEventListener('click', openPiP);
btnReadyStart?.addEventListener('click', () => startMonitoring(activeProfile));
readyProfileSelector?.addEventListener('click', toggleReadyProfileDropdown);
btnReturnToPip?.addEventListener('click', () => {
  // Extensions can't focus a floating PiP window (chrome.tabs/windows only
  // reach the underlying tab) — but this page holds a direct same-origin
  // reference to it, and page-level window.focus() is not similarly
  // restricted for a window this page itself opened.
  if (!pipWindow) return;
  try {
    pipWindow.focus();
  } catch (err) {
    console.warn('[Monitoring] Could not focus PiP window:', err.message);
  }
});
btnEndMonitoring?.addEventListener('click', stopMonitoring);

// Hide PiP button if API not supported
if (!('documentPictureInPicture' in window)) {
  if (btnPip) btnPip.style.display = 'none';
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

// ?launch=choose (meeting-prompt "Change...") shows profile selection
// first instead of auto-starting — see extension/background.js.
const launchMode = new URLSearchParams(window.location.search).get('launch');

pageEnter();
if (isDemo) {
  startDemoMode();
} else if (launchMode === 'choose') {
  enterReadyView();
} else {
  startMonitoring();
}
