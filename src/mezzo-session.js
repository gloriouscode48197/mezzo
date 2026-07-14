/**
 * Mezzo — Session Ownership Module
 *
 * Owns everything about a monitoring session: the audio/engine pipeline,
 * the Mezzo Companion (Document Picture-in-Picture) lifecycle, the
 * explicit `sessionState` (src/session-state.js — companionClosed /
 * companionReady / monitoringActive), an explicit `layoutMode` for the
 * Companion's own two supported presentations (Expanded / Compact — kept
 * as a fully separate piece of state, never inferred from window
 * dimensions), and the no-Companion-support fallback's own start/stop.
 *
 * The Companion renders as two genuinely separate screens — Ready and
 * Monitoring — never a shared layout with elements toggled. Ready has no
 * visualization at all and is always Expanded; there is no Compact Ready
 * variant. Monitoring is the only screen with two layouts:
 *   - Expanded (MEZZO_COMPANION_EXPANDED_SIZE, 400×500): wordmark, a stable
 *     "Monitoring" system-state label, the live awareness-state label
 *     (Quiet / Within Range / Approaching End of Range / Outside Range —
 *     the most prominent text in the header), locked profile metadata,
 *     the visualization, and a restrained bottom control bar (Stop,
 *     Compact) — never a large full-width Stop Monitoring button.
 *   - Compact (MEZZO_COMPANION_COMPACT_SIZE, 220×220): peripheral awareness
 *     only, not session management. The visualization (centered, dominant)
 *     and an Expand control (bottom-right corner overlay) are the ONLY
 *     persistent content — no wordmark, no visible status text, no profile
 *     metadata, and deliberately no Stop control. The awareness-state
 *     element stays in the DOM (visually hidden, still aria-live) so
 *     assistive tech keeps hearing state changes; there is no visible
 *     equivalent. With no Stop in Compact, the native window-close control
 *     is the way to stop monitoring from here — see handlePipClose, which
 *     already treats any Companion close (native ✕ or programmatic) as
 *     "stop monitoring, keep Mezzo open, layout resets to Expanded for the
 *     next open" rather than a full endSession() teardown.
 * Profile selection only happens on the Ready screen — once monitoring
 * starts the profile is locked and shown as plain informational text
 * (Expanded only), so there is no mid-monitoring profile-switch flow to
 * reconcile.
 *
 * Extracted out of what used to be monitoring.js's page controller so that
 * try-it.js (now the single Mezzo session-owning page) can drive its own
 * status view off this module's public surface without duplicating the
 * engine/audio/PiP internals — "one source of truth," not a second copy.
 *
 * Public surface is deliberately small: for the Companion-supported path,
 * try-it.js never calls anything for Start/Stop Monitoring, or for
 * Expanded/Compact layout, directly — those controls live *inside* the
 * Companion's own document and are wired here. try-it.js only needs: init,
 * openCompanion, stopMonitoring (for its own "End Session" click),
 * endSession, setActiveProfile, subscribe/getSessionState, and (fallback
 * path only) startFallbackMonitoring/startDemo. There is deliberately no
 * "bring to front"/"focus" export — the Companion is a Document PiP window
 * and already stays above other windows on its own, so a focus/raise
 * action would be misleading. There is also no "Close Companion" export
 * beyond what the Companion's own button calls internally — Mezzo never
 * closes the Companion on the user's behalf except via endSession() (a
 * full session teardown, not the same action). Layout mode is likewise
 * entirely internal — nothing outside the Companion needs to know or care
 * whether it's Expanded or Compact.
 */

import { AudioProcessor } from './audio.js?v=2';
import { MezzoEngine } from './engine.js?v=5';
import { MezzoWaveVisualizer } from './wave-visualizer.js';
import { trackMonitoringStarted, trackMonitoringSession } from './analytics.js';
import { markClassification, markPipUpdate } from './_timing-debug.js';
import { SESSION_STATES, createSessionState } from './session-state.js';
import {
  RECOMMENDED_PROFILE,
  getSavedProfiles,
  setSelectedProfile,
  setLastUsedProfile,
} from './profiles.js';

// One product-oriented configuration source for both supported Companion
// sizes — named for what they are, not for the underlying Picture-in-Picture
// API. Avoid introducing a third bespoke size; intermediate sizes (from a
// user manually resizing) are handled by responsive CSS, not new constants.
const MEZZO_COMPANION_EXPANDED_SIZE = { width: 400, height: 500 };
// 220×220 — the intentional Compact footprint: a small square built for
// peripheral awareness, not a shrunk-down Expanded window. The wordmark and
// "Monitoring" label are dropped entirely; only the visualization, the live
// awareness state, and Stop/Expand remain, laid out as corner overlays.
const MEZZO_COMPANION_COMPACT_SIZE = { width: 220, height: 220 };

const LAYOUT_MODES = Object.freeze({ EXPANDED: 'expanded', COMPACT: 'compact' });

const OUTSIDE_ZONE = 3; // "Outside Range" — there's no higher volume tier
const SUSTAINED_DRIFT_MS = 1000; // continuous time outside range before drift escalates

function zoneLabel(zone) {
  if (zone === 0) return 'Quiet';
  if (zone === 1) return 'Within Range';
  if (zone === 2) return 'Approaching End of Range';
  return 'Outside Range'; // zone === OUTSIDE_ZONE
}

// The Monitoring screen's read-only profile line. Custom (saved) profiles
// get a "(Custom)" qualifier; the Recommended profile doesn't, since its
// name already says what it is — "Recommended (Recommended)" would be
// redundant.
function profileMetaText(profile) {
  const name = profile?.name || RECOMMENDED_PROFILE.name;
  return profile?.savedProfileId ? `Profile: ${name} (Custom)` : `Profile: ${name}`;
}

export function createMezzoSession({
  baseUrl,
  onSessionStateChange,       // (state) => void — drives the host's 3-state status view
  onFallbackHeadingChange,    // (text) => void — fallback/demo path's own zone-label heading
  onFallbackMonitoringStop,   // () => void — fallback path: host switches back to its own Ready view
} = {}) {
  const pipSupported = 'documentPictureInPicture' in window;
  const sessionState = createSessionState();

  const audio = new AudioProcessor();
  const engine = new MezzoEngine();

  let mainCircle = null;
  let pipCircle = null;
  let activeCircle = null;
  let pipWindow = null;
  let pipDocument = null;
  let baselineRMS = 0;
  let activeProfile = null;
  let isMonitoringActive = false;
  let isPageUnloading = false;
  let demoInterval = null;

  // Explicit, Companion-internal — never inferred from pipWindow's actual
  // dimensions. Only meaningful while sessionState is monitoringActive;
  // Ready is unconditionally Expanded regardless of this value.
  let layoutMode = LAYOUT_MODES.EXPANDED;

  // Ready-screen DOM refs, (re)assigned each time openCompanion() builds the document
  let readyScreenEl = null;
  let readyProfileNameEl = null;
  let readyProfileDropdown = null;

  // Monitoring-screen DOM refs
  let monitoringScreenEl = null;
  let pipStatusHeadingEl = null;
  let monitoringProfileNameEl = null;
  let pipCircleWrapperEl = null;

  let currentZone = 0;
  let isSustained = false;
  let sustainedTimer = null;

  let monitoringStartTime = null;
  let sessionUsedPip = false;
  let sessionAlertTriggered = false;

  const profileSyncChannel = new BroadcastChannel('mezzo-profile-sync');

  function profilesMatch(a, b) {
    if (!a || !b) return false;
    return (a.savedProfileId ?? null) === (b.savedProfileId ?? null) && a.name === b.name;
  }

  function clearSustained() {
    if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
    isSustained = false;
  }

  function updateHeading(zone) {
    const text = zoneLabel(zone);
    onFallbackHeadingChange?.(text);
    if (pipStatusHeadingEl && sessionState.get() === SESSION_STATES.MONITORING_ACTIVE) {
      pipStatusHeadingEl.textContent = text;
    }
  }

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
        sustainedTimer = setTimeout(() => {
          sustainedTimer = null;
          isSustained = true;
          sessionAlertTriggered = true;
        }, SUSTAINED_DRIFT_MS);
      } else if (!nowOutside && wasOutside) {
        clearSustained();
      }
    }

    if (activeCircle) {
      activeCircle.update(currentZone, isSustained);
      markPipUpdate(pipWindow); // TEMPORARY — see docs/monitoring-runtime-investigation.md
    }

    const diff = rms - baselineRMS;
    console.log(`[Session] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  zone=${currentZone}  sustained=${isSustained}  ${zoneLabel(currentZone)}`);
  }

  /** @returns {Promise<boolean>} false if mic acquisition failed */
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
      console.error('[Session] Mic acquisition failed:', err.message);
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

  /** Stops audio/engine/analytics — the shared "actual stop" work behind both
   *  a normal Stop Monitoring click and the Companion closing mid-session. */
  function teardownMonitoringEngine() {
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

    clearSustained();
    currentZone = 0;

    if (mainCircle) {
      mainCircle.destroy();
      mainCircle = null;
    }
  }

  function stopMonitoring() {
    teardownMonitoringEngine();

    if (pipWindow) {
      // The Companion stays open — Document PiP does not survive its opener
      // navigating away, so doing so would silently kill the window.
      // Return the Companion to its Ready screen (always Expanded), ready
      // to start again.
      enterPipReadyMode();
      sessionState.set(SESSION_STATES.COMPANION_READY);
      return;
    }

    // No-Companion-support fallback path.
    activeCircle = null;
    if (!isPageUnloading) onFallbackMonitoringStop?.();
  }

  /**
   * Applies an explicit layout mode: updates the state variable, flips the
   * data-layout attribute that the Compact/Expanded CSS keys off (the
   * intentional, state-driven presentation), and best-effort resizes the
   * actual window to match. Resizing an already-open Document PiP window
   * isn't guaranteed by every browser — if it's unsupported or blocked,
   * the layout still renders correctly at whatever size the window
   * actually is; explicit state, not window dimensions, decides which
   * content shows.
   */
  function applyLayoutMode(mode) {
    layoutMode = mode;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', mode);
    if (!pipWindow) return;
    const size = mode === LAYOUT_MODES.COMPACT ? MEZZO_COMPANION_COMPACT_SIZE : MEZZO_COMPANION_EXPANDED_SIZE;
    try {
      pipWindow.resizeTo(size.width, size.height);
    } catch (err) {
      console.warn('[Session] Could not resize the Mezzo Companion:', err.message);
    }
  }

  function enterExpandedLayout() {
    applyLayoutMode(LAYOUT_MODES.EXPANDED);
  }

  function enterCompactLayout() {
    // Compact is only ever offered while monitoring — Ready has no Compact
    // variant, so this is a no-op otherwise.
    if (sessionState.get() !== SESSION_STATES.MONITORING_ACTIVE) return;
    applyLayoutMode(LAYOUT_MODES.COMPACT);
  }

  /**
   * Opens the Mezzo Companion on its Ready screen — never starts monitoring
   * itself. Call directly from a real click (this is what satisfies
   * Document PiP's fresh-user-gesture requirement now that the caller is
   * try-it.html's own page, not a separate window relaying the gesture).
   * @returns {Promise<boolean>} whether the Companion actually opened
   */
  async function openCompanion() {
    if (!pipSupported) {
      console.warn('[Session] Document PiP API not supported');
      return false;
    }

    try {
      pipWindow = await documentPictureInPicture.requestWindow(MEZZO_COMPANION_EXPANDED_SIZE);
    } catch (err) {
      console.error('[Session] Failed to open the Mezzo Companion:', err.message);
      return false;
    }

    const pipDoc = pipWindow.document;
    pipDocument = pipDoc;

    const fontLink = pipDoc.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400&family=Sora:wght@300;400;500&display=swap';
    pipDoc.head.appendChild(fontLink);

    const link = pipDoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = baseUrl + 'design-tokens/mezzo-tokens.css';
    const cssReady = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    pipDoc.head.appendChild(link);
    await cssReady;

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
      .pip-layout {
        width: 100%;
        height: 100%;
        position: relative;
      }
      .pip-screen {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .pip-mode-label {
        font-family: var(--font-body);
        font-weight: var(--weight-regular);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-subdued);
      }
      .pip-status-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 15px;
        color: var(--text-subdued);
        letter-spacing: 0.04em;
      }
      .btn-wide {
        padding: 16px 64px;
        min-width: 240px;
      }

      /* ── Ready screen — no visualization, always Expanded (there is no
         Compact Ready variant). Layout: wordmark pinned near the top
         (left-aligned, a quiet signature — not centered with the rest), a
         flexible spacer, the headline/profile/button cluster, another
         flexible spacer, then the footer pinned to the bottom. The two
         spacers (not justify-content:center) are what let the wordmark and
         footer sit at their own fixed positions while everything between
         them centers naturally. ── */
      .pip-screen-ready {
        padding: 24px 28px 20px;
      }

      .pip-ready-wordmark {
        align-self: flex-start;
        font-family: var(--font-body);
        font-weight: var(--weight-medium);
        font-size: 11px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--text-subdued);
      }

      .pip-ready-spacer { flex: 1; min-height: 12px; }

      .pip-ready-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 23px;
        line-height: 130%;
        color: var(--text-primary);
        text-align: center;
        margin-bottom: 28px;
      }

      .pip-ready-main {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }

      .pip-profile-label {
        font-family: var(--font-body);
        font-weight: var(--weight-regular);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-subdued);
        margin-bottom: 8px;
      }

      /* Wrapper, not the button itself, positions the dropdown — a button
         cannot validly contain another button, which is what caused the
         dropdown's clipping/reopening bugs before this fix. */
      .pip-profile-wrap { position: relative; width: 100%; margin-bottom: 28px; }

      .pip-profile-selector {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: var(--surface-card);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 13px 14px;
        font-family: var(--font-body);
        font-size: 14px;
        color: var(--text-default);
        cursor: pointer;
        box-sizing: border-box;
      }
      .pip-profile-selector:hover { border-color: var(--border-outline); }

      /* Opens downward and is height-constrained with internal scrolling —
         opening upward (as before) could clip outside the Companion's own
         small window bounds, where content simply isn't rendered at all. */
      .pip-profile-dropdown {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        right: 0;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
        padding: 6px;
        display: flex;
        flex-direction: column;
        z-index: 10;
        max-height: 200px;
        overflow-y: auto;
      }
      .pip-profile-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        text-align: left;
        background: none;
        border: none;
        border-left: 2px solid transparent;
        padding: 10px 10px;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--text-default);
        cursor: pointer;
        border-radius: 6px;
        white-space: nowrap;
      }
      .pip-profile-option:hover,
      .pip-profile-option:focus-visible { background: var(--surface-card); }
      .pip-profile-option-tag {
        font-size: 11px;
        font-weight: var(--weight-light);
        color: var(--text-subdued);
      }
      /* Already selected — restrained, not louder: a quiet accent bar and
         dimmer text, rather than a bright checkmark competing for attention. */
      .pip-profile-option.is-active {
        color: var(--text-subdued);
        background: var(--surface-card);
        border-left-color: var(--hanko-fill);
      }
      .pip-profile-divider { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
      .pip-profile-option-create { color: var(--hanko-text); justify-content: flex-start; }

      .pip-ready-footer {
        width: 100%;
        border-top: 1px solid var(--border);
        padding-top: 14px;
        display: flex;
        justify-content: center;
      }
      .pip-footer-link {
        font-family: var(--font-body);
        font-weight: var(--weight-regular);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-subdued);
        background: none;
        border: none;
        cursor: pointer;
        padding: 6px 10px;
        transition: color 0.15s ease;
      }
      .pip-footer-link:hover { color: var(--text-default); }

      /* ── Monitoring screen — header at top (left-aligned, same quiet
         signature treatment as the Ready screen's wordmark), circle fills
         the middle and stays the visual hero, restrained bottom control
         bar. The only screen that ever shows the visualization or the
         live zone label, and the only screen with two layouts (Expanded /
         Compact), driven by [data-layout] on <body> — an explicit state,
         never inferred from window size. ── */
      .pip-screen-monitoring {
        justify-content: flex-start;
        position: relative;
      }
      .pip-monitoring-header {
        display: none;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 20px 24px 0;
        width: 100%;
        box-sizing: border-box;
      }
      .pip-monitoring-wordmark {
        background: none;
        border: none;
        padding: 0;
        cursor: default;
      }
      .pip-mode-label { margin-top: 8px; }
      /* The awareness state (Quiet / Within Range / Approaching End of
         Range / Outside Range) is the most prominent text in the header —
         "Monitoring" above it is stable chrome; this is what's actually
         changing and worth noticing. Shared by Expanded and Compact —
         Compact repositions rather than duplicates this element. */
      .pip-status-heading {
        font-size: 20px;
        color: var(--text-primary);
        margin-top: 2px;
      }
      .pip-profile-info {
        font-family: var(--font-body);
        font-size: 12px;
        color: var(--text-subdued);
        margin-top: 8px;
      }
      .pip-circle-wrapper {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      /* Bottom control bar — shared by Expanded and Compact. Restrained
         icon+text buttons, never a large full-width primary button; the
         visualization stays the focal point, controls stay discoverable
         but visually secondary. Compact repositions individual buttons as
         corner overlays rather than using this as a bar — see below. */
      .pip-monitoring-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--border);
        padding: 12px 20px 16px;
        width: 100%;
        box-sizing: border-box;
      }
      .pip-control-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        background: none;
        border: none;
        border-radius: 6px;
        padding: 6px 8px;
        margin: -6px -8px;
        font-family: var(--font-body);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-subdued);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .pip-control-btn:hover { background: var(--surface-card); color: var(--text-default); }
      .pip-control-icon-stop {
        width: 8px;
        height: 8px;
        background: currentColor;
        border-radius: 1px;
        flex-shrink: 0;
      }
      .pip-control-icon-compact {
        width: 13px;
        height: 11px;
        border: 1.5px solid currentColor;
        border-radius: 2px;
        position: relative;
        flex-shrink: 0;
      }
      .pip-control-icon-compact::after {
        content: '';
        position: absolute;
        right: 1px;
        top: 3.5px;
        width: 5px;
        height: 4.5px;
        background: currentColor;
        border-radius: 1px;
      }
      .pip-control-icon-expand { width: 13px; height: 13px; flex-shrink: 0; }
      .pip-control-btn-stop:hover { color: var(--hanko-text); }
      /* Expand only ever appears in Compact — see the [data-layout] rules
         below, which are what actually reveal it. */
      .pip-control-btn-expand { display: none; }

      @media (min-width: 300px) and (min-height: 350px) {
        .pip-monitoring-header { display: flex; }
      }

      /* ── Compact layout — explicit state ([data-layout="compact"]), not
         a media query. Peripheral awareness only, not session management:
         the visualization (centered, dominant) and Expand (bottom-right
         corner) are the only persistent content. There is no Stop in
         Compact at all — the native window-close control is the way to
         stop monitoring from here (see handlePipClose) — and no wordmark,
         status text, or profile metadata competing for the small space.
         The awareness state stays in the DOM and keeps announcing via
         aria-live for assistive tech; it's just visually hidden, not
         removed, since there's no visible text status in Compact. ── */
      body[data-layout="compact"] .pip-monitoring-header {
        display: block;
        position: static;
        padding: 0;
      }
      body[data-layout="compact"] .pip-monitoring-wordmark,
      body[data-layout="compact"] .pip-mode-label,
      body[data-layout="compact"] .pip-profile-info {
        display: none;
      }
      /* Visually hidden, not display:none — screen readers still need
         this element's aria-live announcements even though Compact shows
         no visible status text. */
      body[data-layout="compact"] .pip-status-heading {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      body[data-layout="compact"] .pip-circle-wrapper {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 168px;
        height: 168px;
        flex: none;
      }
      body[data-layout="compact"] .pip-monitoring-controls {
        position: static;
        border-top: none;
        padding: 0;
      }
      body[data-layout="compact"] .pip-control-btn-compact,
      body[data-layout="compact"] .pip-control-btn-stop {
        display: none;
      }
      body[data-layout="compact"] .pip-control-btn-expand {
        display: flex;
        position: absolute;
        bottom: 8px;
        right: 8px;
        margin: 0;
        padding: 8px;
        z-index: 2;
      }
    `;
    pipDoc.head.appendChild(style);

    pipDoc.body.setAttribute('data-surface', 'dark');
    pipDoc.body.setAttribute('data-layout', layoutMode);

    const layout = pipDoc.createElement('div');
    layout.className = 'pip-layout';

    // ── Ready screen — wordmark pinned top-left, headline/profile/button
    //    cluster centered via two flexible spacers, footer pinned bottom. ──
    const readyScreen = pipDoc.createElement('div');
    readyScreen.className = 'pip-screen pip-screen-ready';

    const readyWordmark = pipDoc.createElement('span');
    readyWordmark.className = 'pip-ready-wordmark';
    readyWordmark.textContent = 'Mezzo';
    readyScreen.appendChild(readyWordmark);

    const topSpacer = pipDoc.createElement('div');
    topSpacer.className = 'pip-ready-spacer';
    readyScreen.appendChild(topSpacer);

    const readyHeading = pipDoc.createElement('h1');
    readyHeading.className = 'pip-ready-heading';
    readyHeading.textContent = 'Ready when you are.';
    readyScreen.appendChild(readyHeading);

    const readyMain = pipDoc.createElement('div');
    readyMain.className = 'pip-ready-main';

    const profileLabel = pipDoc.createElement('span');
    profileLabel.className = 'pip-profile-label';
    profileLabel.textContent = 'Profile';
    readyMain.appendChild(profileLabel);

    const profileWrap = pipDoc.createElement('div');
    profileWrap.className = 'pip-profile-wrap';

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
    profileSelector.addEventListener('click', toggleReadyProfileDropdown);
    readyProfileNameEl = profileNameSpan;

    const dropdown = pipDoc.createElement('div');
    dropdown.className = 'pip-profile-dropdown hidden';
    readyProfileDropdown = dropdown;

    profileWrap.appendChild(profileSelector);
    profileWrap.appendChild(dropdown);
    readyMain.appendChild(profileWrap);

    const pipStartBtn = pipDoc.createElement('button');
    pipStartBtn.className = 'btn-primary btn-wide';
    pipStartBtn.style.width = '100%';
    pipStartBtn.textContent = 'Start Monitoring';
    pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
    readyMain.appendChild(pipStartBtn);

    readyScreen.appendChild(readyMain);

    const bottomSpacer = pipDoc.createElement('div');
    bottomSpacer.className = 'pip-ready-spacer';
    readyScreen.appendChild(bottomSpacer);

    const readyFooter = pipDoc.createElement('div');
    readyFooter.className = 'pip-ready-footer';
    const closeBtn = pipDoc.createElement('button');
    closeBtn.className = 'pip-footer-link';
    closeBtn.textContent = 'Close Companion';
    closeBtn.addEventListener('click', handleCloseCompanionClick);
    readyFooter.appendChild(closeBtn);
    readyScreen.appendChild(readyFooter);

    layout.appendChild(readyScreen);
    readyScreenEl = readyScreen;

    // ── Monitoring screen (Expanded + Compact share this one DOM tree —
    //    see the [data-layout] CSS above for what each hides/shows) ──
    const monitoringScreen = pipDoc.createElement('div');
    monitoringScreen.className = 'pip-screen pip-screen-monitoring hidden';

    const monitoringHeader = pipDoc.createElement('div');
    monitoringHeader.className = 'pip-monitoring-header';

    // Plain, non-interactive — Compact hides it entirely (its own Expand
    // control is the way back to Expanded; see below).
    const monitoringWordmark = pipDoc.createElement('span');
    monitoringWordmark.className = 'pip-ready-wordmark pip-monitoring-wordmark';
    monitoringWordmark.textContent = 'Mezzo';
    monitoringHeader.appendChild(monitoringWordmark);

    const modeLabel = pipDoc.createElement('span');
    modeLabel.className = 'pip-mode-label';
    modeLabel.textContent = 'Monitoring';
    monitoringHeader.appendChild(modeLabel);

    // Shared by Expanded and Compact — Compact repositions this as a
    // top-left corner overlay via CSS rather than duplicating it.
    // aria-live so assistive tech hears state changes without the
    // interruption a stronger "assertive" politeness would cause.
    const statusHeading = pipDoc.createElement('span');
    statusHeading.className = 'pip-status-heading';
    statusHeading.textContent = zoneLabel(currentZone);
    statusHeading.setAttribute('aria-live', 'polite');
    monitoringHeader.appendChild(statusHeading);
    pipStatusHeadingEl = statusHeading;

    const profileInfo = pipDoc.createElement('span');
    profileInfo.className = 'pip-profile-info';
    profileInfo.textContent = profileMetaText(activeProfile);
    monitoringHeader.appendChild(profileInfo);
    monitoringProfileNameEl = profileInfo;

    monitoringScreen.appendChild(monitoringHeader);

    const circleWrapper = pipDoc.createElement('div');
    circleWrapper.className = 'pip-circle-wrapper';
    monitoringScreen.appendChild(circleWrapper);
    pipCircleWrapperEl = circleWrapper;

    // Control bar — shared by Expanded and Compact. Expanded lays these out
    // as a normal-flow bottom bar (Stop, Compact); Compact repositions Stop
    // as a top-right corner overlay (icon-only there), hides the
    // Compact-toggle entirely, and reveals a dedicated Expand control
    // (bottom-right corner) instead — see the [data-layout="compact"] CSS.
    const controls = pipDoc.createElement('div');
    controls.className = 'pip-monitoring-controls';

    const pipStopBtn = pipDoc.createElement('button');
    pipStopBtn.type = 'button';
    pipStopBtn.className = 'pip-control-btn pip-control-btn-stop';
    pipStopBtn.setAttribute('aria-label', 'Stop Monitoring');
    const stopIcon = pipDoc.createElement('span');
    stopIcon.className = 'pip-control-icon-stop';
    stopIcon.setAttribute('aria-hidden', 'true');
    const stopLabel = pipDoc.createElement('span');
    stopLabel.textContent = 'Stop';
    pipStopBtn.appendChild(stopIcon);
    pipStopBtn.appendChild(stopLabel);
    pipStopBtn.addEventListener('click', stopMonitoring);
    controls.appendChild(pipStopBtn);

    const compactBtn = pipDoc.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'pip-control-btn pip-control-btn-compact';
    const compactIcon = pipDoc.createElement('span');
    compactIcon.className = 'pip-control-icon-compact';
    compactIcon.setAttribute('aria-hidden', 'true');
    const compactLabel = pipDoc.createElement('span');
    compactLabel.textContent = 'Compact';
    compactBtn.appendChild(compactIcon);
    compactBtn.appendChild(compactLabel);
    compactBtn.addEventListener('click', enterCompactLayout);
    controls.appendChild(compactBtn);

    // Compact-only — a familiar expand-window icon in the bottom-right
    // corner, restoring Expanded without stopping monitoring.
    const expandBtn = pipDoc.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'pip-control-btn pip-control-btn-expand';
    expandBtn.setAttribute('aria-label', 'Expand Companion');
    expandBtn.innerHTML =
      '<svg class="pip-control-icon-expand" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<path d="M7.5 1.5H10.5V4.5M4.5 10.5H1.5V7.5M10.5 1.5L6.5 5.5M1.5 10.5L5.5 6.5" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    expandBtn.addEventListener('click', enterExpandedLayout);
    controls.appendChild(expandBtn);

    monitoringScreen.appendChild(controls);

    layout.appendChild(monitoringScreen);
    monitoringScreenEl = monitoringScreen;

    pipDoc.body.appendChild(layout);

    if (mainCircle) {
      mainCircle.destroy();
      mainCircle = null;
    }

    // Every open lands on the Ready screen — never auto-starts monitoring.
    // The visualizer itself isn't created until monitoring actually starts
    // (see resumeMonitoringFromPipReady) — there is nothing to show yet.
    enterPipReadyMode();
    sessionState.set(SESSION_STATES.COMPANION_READY);

    pipWindow.addEventListener('pagehide', handlePipClose);

    return true;
  }

  /** Full teardown: stop monitoring, release the mic, close the Companion. */
  function endSession() {
    if (isMonitoringActive) teardownMonitoringEngine();
    activeCircle = null;
    if (pipWindow) {
      try { pipWindow.close(); } catch { /* ignore */ }
    }
    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  /**
   * The Companion's own "Close Companion" button (Ready screen only) —
   * closes just the Companion, leaving Mezzo (try-it.html) open. Monitoring
   * shouldn't be active while the Ready screen is showing, but this stops
   * it defensively first if it somehow is, exactly like endSession() does,
   * before closing — the only difference is this is a Companion-owned
   * action, not a session-ending one; handlePipClose() (via the window's
   * own pagehide) does the rest, identically to closing via the OS ✕.
   */
  function handleCloseCompanionClick() {
    if (isMonitoringActive) teardownMonitoringEngine();
    try { pipWindow.close(); } catch { /* ignore */ }
  }

  /** Ready is always Expanded — restores it here so every path back to
   *  Ready (first open, reopen, stopping monitoring) converges. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    enterExpandedLayout();
    activeCircle = null; // Ready never shows a visualization
    if (readyScreenEl) readyScreenEl.classList.remove('hidden');
    if (monitoringScreenEl) monitoringScreenEl.classList.add('hidden');
    closeReadyProfileDropdown();
    updateReadyProfileDisplay();
  }

  function enterPipMonitoringMode() {
    if (!pipWindow) return;
    if (monitoringProfileNameEl) {
      monitoringProfileNameEl.textContent = profileMetaText(activeProfile);
    }
    if (readyScreenEl) readyScreenEl.classList.add('hidden');
    if (monitoringScreenEl) monitoringScreenEl.classList.remove('hidden');
    updateHeading(currentZone);
  }

  async function resumeMonitoringFromPipReady() {
    const profile = activeProfile;
    if (!profile) return; // shouldn't happen — Ready mode always has an active profile

    const ok = await beginMonitoringSession(profile);
    if (!ok) return; // stay in Ready mode; nothing else to clean up

    if (!pipCircle && pipCircleWrapperEl) {
      pipCircle = new MezzoWaveVisualizer(pipCircleWrapperEl);
    }
    activeCircle = pipCircle;
    sessionUsedPip = true;

    // Starting monitoring always begins Expanded — never auto-switches to
    // Compact, even if a previous monitoring session earlier in this same
    // Companion-open lifetime had been left in Compact.
    enterExpandedLayout();
    enterPipMonitoringMode();
    sessionState.set(SESSION_STATES.MONITORING_ACTIVE);
  }

  // Shared by the Companion's Ready-screen profile dropdown — same options,
  // same "+ Create New Profile..." row. Only ever rendered while Ready;
  // monitoring locks the profile and shows it as plain text instead.
  //
  // Selected state reads as a quiet accent bar + dimmer text (not a
  // checkmark) — restrained, since it's already the active choice, not
  // something that needs to shout. Saved (custom) profiles get a small
  // "Custom" tag, right-aligned, Title Case — the Recommended profile
  // doesn't (its own name already says what it is).
  function renderProfileDropdown(doc, dropdownEl, { onPick, onCreateNew }) {
    if (!dropdownEl || !doc) return;
    dropdownEl.innerHTML = '';

    const profiles = [RECOMMENDED_PROFILE, ...getSavedProfiles()];
    for (const profile of profiles) {
      const isActive = profilesMatch(activeProfile, profile);
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'pip-profile-option' + (isActive ? ' is-active' : '');

      const nameSpan = doc.createElement('span');
      nameSpan.textContent = profile.name;
      row.appendChild(nameSpan);

      if (profile.savedProfileId) {
        const tag = doc.createElement('span');
        tag.className = 'pip-profile-option-tag';
        tag.textContent = 'Custom';
        row.appendChild(tag);
      }

      row.addEventListener('click', () => onPick(profile));
      dropdownEl.appendChild(row);
    }

    const divider = doc.createElement('hr');
    divider.className = 'pip-profile-divider';
    dropdownEl.appendChild(divider);

    const createBtn = doc.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'pip-profile-option pip-profile-option-create';
    createBtn.textContent = '+ Create New Profile...';
    createBtn.addEventListener('click', onCreateNew);
    dropdownEl.appendChild(createBtn);
  }

  function updateReadyProfileDisplay() {
    if (readyProfileNameEl) {
      readyProfileNameEl.textContent = activeProfile?.name || RECOMMENDED_PROFILE.name;
    }
    renderReadyProfileDropdown();
  }

  function renderReadyProfileDropdown() {
    renderProfileDropdown(pipDocument, readyProfileDropdown, {
      onPick: handleReadyProfilePick,
      onCreateNew: handleCreateNewProfile,
    });
  }

  function toggleReadyProfileDropdown() {
    if (readyProfileDropdown) renderReadyProfileDropdown();
    if (readyProfileDropdown) readyProfileDropdown.classList.toggle('hidden');
  }

  function closeReadyProfileDropdown() {
    if (readyProfileDropdown) readyProfileDropdown.classList.add('hidden');
  }

  // Profile selection only ever happens while Ready — monitoring locks it —
  // so this always switches immediately, no confirmation needed.
  function handleReadyProfilePick(profile) {
    closeReadyProfileDropdown();
    if (profilesMatch(activeProfile, profile)) return;
    activateProfile(profile);
  }

  function activateProfile(profile) {
    activeProfile = profile;
    setSelectedProfile(profile);
    updateReadyProfileDisplay();
  }

  function handleCreateNewProfile() {
    closeReadyProfileDropdown();
    // A genuinely new tab — Document PiP does not survive this tab navigating
    // away, so the calibration flow can never happen in the Companion-owning tab.
    window.open('try-it.html?entry=create-profile', '_blank');
  }

  function handlePipClose() {
    const wasActive = isMonitoringActive; // capture before teardownMonitoringEngine clears it

    if (pipCircle) {
      pipCircle.destroy();
      pipCircle = null;
    }
    pipWindow = null;
    pipDocument = null;
    readyScreenEl = null;
    readyProfileNameEl = null;
    readyProfileDropdown = null;
    monitoringScreenEl = null;
    pipStatusHeadingEl = null;
    monitoringProfileNameEl = null;
    pipCircleWrapperEl = null;
    layoutMode = LAYOUT_MODES.EXPANDED; // a fresh open always starts Expanded

    if (isPageUnloading) return; // this page's own pagehide is already tearing everything down

    // This fires for every way the Companion actually goes away — the
    // native ✕ (the only way out of Compact, which has no Stop control),
    // the Companion's own "Close Companion" button, and endSession()'s
    // programmatic pipWindow.close() — since Document PiP's own pagehide
    // is what's wired to this handler, not any one of those call sites
    // individually. By the time this runs after handleCloseCompanionClick()
    // or endSession(), monitoring has already been torn down there, so
    // wasActive is already false and this is a harmless no-op pass-through
    // for those paths. What matters is the native-✕ case: monitoring can
    // never continue without the Companion open, so if it was still active
    // reaching here, tear it down now — not "silently keep running" — and
    // reflect the closed Companion (not a full endSession) in session
    // state, so Mezzo (try-it.html) stays open and offers Reopen Companion.
    if (wasActive) {
      teardownMonitoringEngine();
      activeCircle = null;
    }

    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  // =============================================================================
  // No-Companion-support fallback + demo mode
  // =============================================================================

  /** @returns {Promise<boolean>} whether monitoring actually started */
  async function startFallbackMonitoring(container) {
    if (!activeProfile) return false;
    const ok = await beginMonitoringSession(activeProfile);
    if (!ok) return false;

    mainCircle = new MezzoWaveVisualizer(container);
    activeCircle = mainCircle;
    sessionUsedPip = false;
    return true;
  }

  function startDemo(container) {
    baselineRMS = 0.05;
    const samples = new Array(100).fill(baselineRMS);
    engine.calibrate(samples);
    engine.startMonitoring();
    engine.graceRemainingMs = 0; // skip grace period so zone changes trigger immediately

    mainCircle = new MezzoWaveVisualizer(container);
    activeCircle = mainCircle;

    const CYCLE_MS = 12000;
    const INTERVAL_MS = 50;
    const baseline = baselineRMS;

    demoInterval = setInterval(() => {
      const t = Date.now() % CYCLE_MS;
      let targetRMS;

      if (t < 2000) {
        targetRMS = baseline * 0.1; // 0-2s: silence — Quiet
      } else if (t < 4000) {
        targetRMS = baseline * 1.0; // 2-4s: Within Range
      } else if (t < 6000) {
        targetRMS = baseline * 1.5; // 4-6s: Approaching End of Range
      } else if (t < 10000) {
        targetRMS = baseline * 2.3; // 6-10s: Outside Range
      } else {
        targetRMS = baseline * 0.1; // 10-12s: back to silence
      }

      onAudioFrame({ rms: targetRMS });
    }, INTERVAL_MS);
  }

  // =============================================================================
  // Public interface
  // =============================================================================

  function init(resolvedProfile) {
    activeProfile = resolvedProfile;

    profileSyncChannel.addEventListener('message', (event) => {
      if (event.data?.type !== 'PROFILE_READY' || !event.data.profile) return;
      const profile = event.data.profile;
      setSelectedProfile(profile);
      setLastUsedProfile(profile);

      // Only adopt it as the active profile if we're not mid-session —
      // profile selection is Ready-only, same as picking one from the
      // Companion's own dropdown.
      if (!isMonitoringActive) activateProfile(profile);
    });

    // This page is the runtime owner of the session — closing it stops
    // monitoring and the Companion (see the pagehide handler below).
    // beforeunload asks for confirmation only: Chrome hasn't allowed custom
    // dialog text/buttons since Chrome 51, so the closest supported
    // approximation of "Close Mezzo? ... [Cancel] [Close and Stop]" is the
    // browser's own generic "Leave site?" prompt. Actual teardown must NOT
    // happen here (the user might cancel) — it's deferred to pagehide.
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
  }

  sessionState.subscribe((state) => onSessionStateChange?.(state));

  return {
    SESSION_STATES,
    getSessionState: sessionState.get,
    subscribe: sessionState.subscribe,
    getActiveProfile: () => activeProfile,
    setActiveProfile: (profile) => { activeProfile = profile; },
    isPipSupported: () => pipSupported,

    init,
    openCompanion,
    stopMonitoring,
    endSession,

    startFallbackMonitoring,
    startDemo,
  };
}
