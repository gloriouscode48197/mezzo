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
 *   - Compact (MEZZO_COMPANION_COMPACT_SIZE, 220×220): peripheral awareness,
 *     but with the same Stop reachable as Expanded — not session management
 *     beyond that. The visualization (centered, dominant), a Stop control
 *     (bottom-left corner overlay), and an Expand control (bottom-right
 *     corner overlay) are the ONLY persistent content — no wordmark, no
 *     visible status text, no profile metadata. Both corner controls are
 *     icon-only (aria-label carries their accessible name, same as
 *     Expand already did). The awareness-state element stays in the DOM
 *     (visually hidden, still aria-live) so assistive tech keeps hearing
 *     state changes; there is no visible equivalent. Stop in Compact calls
 *     the exact same stopMonitoring() Expanded's Stop does — it returns to
 *     Ready, it does not close the Companion. The native window-close
 *     control remains a separate, always-available way to close the
 *     Companion outright from any state — see handlePipClose, which
 *     already treats any Companion close (native ✕ or programmatic) as
 *     "stop monitoring, keep Mezzo open, layout resets to Expanded for the
 *     next open" rather than a full endSession() teardown.
 * Profile selection happens in Mezzo (for the first session) or on the
 * Companion's own Ready screen (for subsequent same-day sessions) — never
 * both for the same session. startMonitoring(profile) opens the Companion
 * and starts monitoring in one action, with no Ready confirmation step and
 * no second "Start Monitoring" click — Mezzo already chose the profile.
 * Once monitoring starts the profile is locked and shown as plain
 * informational text (Expanded only), so there is no mid-monitoring
 * profile-switch flow to reconcile. Stopping returns the (still-open)
 * Companion to Ready, where the profile selector unlocks again for
 * starting again, switching profiles, or creating a new one.
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
 * startMonitoring, stopMonitoring (for its own "End Session" click),
 * endSession, setActiveProfile, subscribe/getSessionState, and (fallback
 * path only) startFallbackMonitoring/startDemo. There is deliberately no
 * "bring to front"/"focus" export — the Companion is a Document PiP window
 * and already stays above other windows on its own, so a focus/raise
 * action would be misleading. There is also no "Close Companion" control
 * anywhere in the Companion itself — the native Picture-in-Picture window
 * close control is the only way a user closes it directly. Mezzo never
 * closes the Companion on the user's behalf except via endSession() (a
 * full session teardown) or when the Companion's own "+ Create New
 * Profile..." action closes it. Layout mode is likewise entirely internal —
 * nothing outside the Companion needs to know or care whether it's Expanded
 * or Compact.
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

// One product-oriented configuration source for every fixed Companion size —
// named for what they are, not for the underlying Picture-in-Picture API.
// Avoid introducing further bespoke sizes; intermediate sizes (from a user
// manually resizing) are handled by responsive CSS, not new constants.
// Ready is its own fixed size, distinct from Monitoring's Expanded size —
// the two used to share one constant, but the Ready and Monitoring cards
// have different target dimensions.
const MEZZO_COMPANION_READY_SIZE = { width: 320, height: 354 };
const MEZZO_COMPANION_EXPANDED_SIZE = { width: 380, height: 420 };
// 220×220 — the intentional Compact footprint: a small, square window built
// for peripheral awareness, not a shrunk-down Expanded window (was
// 220×260 — matched against the approved design direction and updated).
// No title bar (the real Document PiP window chrome covers that) and no
// wordmark/status text/profile metadata; only the visualization and the
// Stop/Expand corner-overlay controls remain.
const MEZZO_COMPANION_COMPACT_SIZE = { width: 220, height: 220 };

const LAYOUT_MODES = Object.freeze({ EXPANDED: 'expanded', COMPACT: 'compact' });

// The one recognized value of companionCloseIntent (see the declaration
// below) — named and exported (not a raw string) so the host doesn't have
// to match a magic string to tell this COMPANION_CLOSED apart from others.
const COMPANION_CLOSE_INTENTS = Object.freeze({ CREATE_PROFILE: 'createProfile' });

const OUTSIDE_ZONE = 3; // "Outside Range" — there's no higher volume tier
const SUSTAINED_DRIFT_MS = 1000; // continuous time outside range before drift escalates

function zoneLabel(zone) {
  if (zone === 0) return 'Quiet';
  if (zone === 1) return 'Within Range';
  if (zone === 2) return 'Approaching End of Range';
  return 'Outside Range'; // zone === OUTSIDE_ZONE
}

// The Monitoring screen's read-only profile line, e.g. "Profile: Everyday
// Conversation (Recommended)" or "Profile: Coffee Shop (Custom)".
function profileMetaText(profile) {
  const name = profile?.name || RECOMMENDED_PROFILE.name;
  return profile?.savedProfileId ? `Profile: ${name} (Custom)` : `Profile: ${name} (Recommended)`;
}

export function createMezzoSession({
  baseUrl,
  onSessionStateChange,          // (state, closeIntent) => void — drives the host's 3-state status view. closeIntent is COMPANION_CLOSE_INTENTS.CREATE_PROFILE on the one COMPANION_CLOSED transition caused by "+ Create New Profile...", null otherwise — see companionCloseIntent below.
  onFallbackHeadingChange,       // (text) => void — fallback/demo path's own zone-label heading
  onFallbackMonitoringStop,      // () => void — fallback path: host switches back to its own Ready view
  onCreateNewProfileRequested,   // () => void — "+ Create New Profile..." was chosen; host should transition itself (in place, no navigation) to the first screen of the Create Speaking Profile flow
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

  // Explicit bookkeeping for *why* the Companion is closing — set only by
  // handleCreateNewProfile(), read once by the sessionState listener below,
  // then cleared immediately. This exists so the host (try-it.js) can tell
  // "Companion closed because of Create New Profile" apart from "Companion
  // closed natively / via End Session" without ever guessing from timing:
  // the real Document PiP `pagehide` for this same close arrives later,
  // asynchronously (see handlePipClose), and by then this is already back
  // to null — that later, redundant sessionState.set() call is a no-op
  // (createSessionState() guards against re-firing on an unchanged value),
  // so it never has a stale intent to misread in the first place.
  let companionCloseIntent = null;

  // Ready-screen DOM refs, (re)assigned each time startMonitoring() builds the document
  let readyScreenEl = null;
  let readyProfileNameEl = null;
  let readyProfileSelectorEl = null; // the trigger button — dropdown-close refocuses it
  let readyProfileDropdown = null; // the dropdown's row-list container, not the backdrop/modal itself
  let readyProfileBackdropEl = null; // the centered-modal overlay that shows/hides the dropdown

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
      // Presentational only — drives the status label's per-zone color (see
      // the .pip-status-heading[data-zone] CSS). Doesn't change what zone is
      // computed or when the label updates, both still decided above.
      pipStatusHeadingEl.dataset.zone = String(zone);
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
   * Best-effort resizes the actual window to a given fixed size. Resizing an
   * already-open Document PiP window isn't guaranteed by every browser — if
   * it's unsupported or blocked, the layout still renders correctly at
   * whatever size the window actually is; explicit state, not window
   * dimensions, decides which content shows.
   */
  function resizeCompanionTo(size) {
    if (!pipWindow) return;
    try {
      pipWindow.resizeTo(size.width, size.height);
    } catch (err) {
      console.warn('[Session] Could not resize the Mezzo Companion:', err.message);
    }
  }

  /**
   * Applies an explicit Monitoring layout mode: updates the state variable,
   * flips the data-layout attribute that the Compact/Expanded CSS keys off
   * (the intentional, state-driven presentation), and resizes to that
   * layout's fixed size. Ready has its own fixed size and resize path (see
   * enterPipReadyMode) — this is Monitoring-only.
   */
  function applyLayoutMode(mode) {
    layoutMode = mode;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', mode);
    resizeCompanionTo(mode === LAYOUT_MODES.COMPACT ? MEZZO_COMPANION_COMPACT_SIZE : MEZZO_COMPANION_EXPANDED_SIZE);
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
   * Opens the Mezzo Companion and starts monitoring immediately with the
   * given profile — Mezzo (not the Companion) already chose the profile for
   * this first session, so there is no Ready confirmation step here and no
   * second "Start Monitoring" click. Falls back to the Ready screen only if
   * mic acquisition fails, so the user isn't left with a broken window.
   * Call directly from a real click (this is what satisfies Document PiP's
   * fresh-user-gesture requirement now that the caller is try-it.html's own
   * page, not a separate window relaying the gesture).
   * @returns {Promise<boolean>} whether the Companion actually opened
   */
  async function startMonitoring(profile) {
    if (!pipSupported) {
      console.warn('[Session] Document PiP API not supported');
      return false;
    }

    try {
      pipWindow = await documentPictureInPicture.requestWindow(MEZZO_COMPANION_EXPANDED_SIZE); // first open always goes straight to Monitoring
    } catch (err) {
      console.error('[Session] Failed to open the Mezzo Companion:', err.message);
      return false;
    }

    const pipDoc = pipWindow.document;
    pipDocument = pipDoc;

    // The real Document Picture-in-Picture window chrome is the Companion's
    // only title bar now (see the Monitoring screen build below, which no
    // longer constructs an in-page one) — this is what makes it read
    // "MEZZO COMPANION" instead of falling back to this document's URL.
    pipDoc.title = 'MEZZO COMPANION';

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
      /* Shared "card" treatment — every screen renders as a rounded,
         shadowed card filling the real (fixed-size) Picture-in-Picture
         window, matching the reference's own per-state card mockups.
         position:relative so the Ready screen's profile-dropdown backdrop
         (a child of .pip-screen-ready) can use inset:0 against this card's
         own bounds, not the whole document. overflow:hidden keeps the
         backdrop's corners and everything else clipped to the radius. */
      .pip-screen {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        overflow: hidden;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        box-shadow: 0 24px 56px rgba(0, 0, 0, 0.55), inset 0 0 40px rgba(0, 0, 0, 0.16);
        background: #3c3b3f;
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
         Compact Ready variant). No in-page title bar — the real Document
         Picture-in-Picture window chrome is the only title bar (see
         pipDoc.title in startMonitoring()). Composition: a "poster" area
         that centers the heading in the remaining space (flex:1 +
         justify-content:center, not a spacer-pair), then a fixed-padding
         action card pinned at the bottom holding the profile selector and
         Start Monitoring. There is no footer here — the native
         Picture-in-Picture window close control is the only way to
         close the Companion, so there is nothing for a footer to hold. ── */
      .pip-screen-ready {
        justify-content: flex-start;
      }

      .pip-ready-poster {
        flex: 1;
        width: 100%;
        min-height: 0;
        box-sizing: border-box;
        padding: 32px 20px 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pip-ready-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-light);
        font-size: 22px;
        line-height: 1.4;
        letter-spacing: 0.01em;
        color: rgba(222, 210, 194, 0.82);
        text-align: center;
        max-width: 240px;
        margin: 0;
      }

      /* Fixed-padding action card, not a flex-centered spacer child —
         matches the reference's own dedicated card region. */
      .pip-ready-card {
        width: calc(100% - 48px);
        margin: 0 24px;
        padding: 20px 16px 40px;
        box-sizing: border-box;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      /* Wrapper only needs to size and position the trigger button now —
         the dropdown itself is a centered overlay (see .pip-profile-backdrop
         below), not anchored beneath this wrapper. */
      .pip-profile-wrap { width: 100%; margin-bottom: 16px; }

      .pip-profile-selector {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 14px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.10);
        font-family: var(--font-body);
        font-size: 13px;
        letter-spacing: 0.02em;
        color: rgba(222, 210, 194, 0.92);
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .pip-profile-selector:hover { opacity: 0.88; }
      /* Squares off the trigger's bottom corners while the menu above it
         is open — a "pressed" visual echo of the reference, even though
         the menu itself renders as a centered overlay, not anchored here. */
      .pip-profile-selector.is-open { border-radius: 8px 8px 0 0; }

      .pip-ready-start-btn {
        width: 100%;
        background: var(--hanko-fill);
        border: none;
        border-radius: 50px;
        padding: 12px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: var(--weight-medium);
        color: rgba(255, 255, 255, 0.92);
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .pip-ready-start-btn:hover { opacity: 0.88; }

      /* Centered modal overlay, not an anchored dropdown — a dimmed
         backdrop covering the Ready card's own bounds (a child of
         .pip-screen-ready, which is position:relative — see the shared
         .pip-screen card rule above) with the menu centered and
         height-constrained with internal scrolling. This keeps the menu
         inside the Companion's own small bounds at every supported window
         size, where an anchored dropdown could previously clip outside
         content that simply isn't rendered at all. Clicking the dimmed
         backdrop (not the menu itself) or pressing Escape closes it, same
         as any other modal dismissal. */
      .pip-profile-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 14px;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      }
      .pip-profile-dropdown {
        width: 100%;
        background: #3c3b3f;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.72);
        overflow: hidden;
      }
      .pip-profile-dropdown-label {
        font-family: var(--font-body);
        font-weight: var(--weight-medium);
        font-size: 9px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(172, 158, 136, 0.50);
        padding: 12px 16px 8px;
      }
      .pip-profile-dropdown-list {
        display: flex;
        flex-direction: column;
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
        border-left: 3px solid transparent;
        padding: 13px 14px 13px 10px;
        font-family: var(--font-body);
        font-weight: var(--weight-regular);
        font-size: 13px;
        letter-spacing: 0.02em;
        color: rgba(222, 210, 194, 0.75);
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.10s ease;
      }
      /* Hover is a plain background darkening — no accent bar — so it
         never reads as "selected." */
      .pip-profile-option:hover { background: rgba(0, 0, 0, 0.18); color: rgba(222, 210, 194, 0.95); }
      /* Keyboard focus gets its own distinct treatment (an outline, not a
         background tint or the selected state's left bar) so hovered,
         focused, and selected never look the same as one another. */
      .pip-profile-option:focus-visible {
        outline: 1px solid var(--border-outline);
        outline-offset: -1px;
        background: rgba(0, 0, 0, 0.18);
      }
      .pip-profile-option-tag {
        font-size: 11px;
        font-weight: var(--weight-light);
        color: rgba(172, 158, 136, 0.60);
      }
      /* Already selected — restrained, not louder: a quiet accent bar and
         dimmer text, rather than a bright checkmark competing for attention.
         Deliberately its own look (left bar), distinct from hover's plain
         background darkening and focus's outline. */
      .pip-profile-option.is-active {
        color: rgba(222, 210, 194, 0.45);
        background: rgba(0, 0, 0, 0.12);
        border-left-color: var(--hanko-fill);
        cursor: default;
      }
      .pip-profile-option.is-active:hover { background: rgba(0, 0, 0, 0.12); color: rgba(222, 210, 194, 0.45); }
      .pip-profile-divider { border: none; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 4px 14px; }
      /* Neutral by default, orange only on hover/focus — kept as its own
         rule (not the shared :hover/:focus-visible above) since this row's
         hover state is a text-color change with no background darkening,
         unlike the other rows. */
      .pip-profile-option-create {
        border-left-width: 2px;
        padding: 13px 14px 13px 12px;
        color: rgba(222, 210, 194, 0.75);
        justify-content: flex-start;
      }
      .pip-profile-option-create:hover,
      .pip-profile-option-create:focus-visible { background: none; color: rgba(196, 89, 58, 0.85); }

      /* ── Monitoring screen — the shared title bar at top, circle fills
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
        flex-shrink: 0;
        width: 100%;
        box-sizing: border-box;
      }
      .pip-monitoring-status-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 24px 0;
      }
      /* The awareness state (Quiet / Within Range / Approaching End of
         Range / Outside Range) is the most prominent text in the header.
         Shared by Expanded and Compact — Compact repositions rather than
         duplicates this element. Color is keyed off data-zone, a purely
         presentational attribute updateHeading() sets alongside the
         existing textContent assignment — the zone-classification and
         label-text logic themselves are untouched. */
      .pip-status-heading {
        font-size: 20px;
        color: var(--text-primary);
      }
      .pip-status-heading[data-zone="0"],
      .pip-status-heading[data-zone="1"] { color: var(--text-subdued); }
      .pip-status-heading[data-zone="2"] { color: var(--text-default); }
      .pip-status-heading[data-zone="3"] { color: var(--hanko-text); }
      .pip-profile-info {
        font-family: var(--font-body);
        font-size: 10px;
        color: var(--text-subdued);
        letter-spacing: 0.02em;
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
      .pip-control-icon-expand { width: 14px; height: 14px; flex-shrink: 0; }
      .pip-control-btn-stop:hover { color: var(--hanko-text); }
      /* Expand only ever appears in Compact — see the [data-layout] rules
         below, which are what actually reveal it. */
      .pip-control-btn-expand { display: none; }

      @media (min-width: 300px) and (min-height: 350px) {
        .pip-monitoring-header { display: flex; }
      }

      /* ── Compact layout — explicit state ([data-layout="compact"]), not
         a media query. Peripheral awareness, but Stop stays reachable: the
         visualization (centered, dominant), Stop (bottom-left corner), and
         Expand (bottom-right corner) are the only persistent content — no
         in-page title bar either (the real Document PiP window chrome
         covers that, same as Expanded), and no status text or profile
         metadata competing for the small space. Stop here is the exact
         same button/handler as Expanded's Stop, just repositioned and
         icon-only — it stops monitoring and returns to Ready, it does not
         close the Companion. The native window-close control remains a
         separate, always-available way to close the Companion outright
         (see handlePipClose). The awareness state stays in the DOM and
         keeps announcing via aria-live for assistive tech; it's just
         visually hidden, not removed, since there's no visible text status
         in Compact. ── */
      /* Compact's card is smaller-radius, single-layer shadow (no inset
         glow) — its own distinct treatment, not just a scaled-down Ready/
         Monitoring card. */
      body[data-layout="compact"] .pip-screen-monitoring {
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.52);
      }
      body[data-layout="compact"] .pip-monitoring-header {
        display: block;
      }
      /* Collapses the block's own padding rather than hiding it outright —
         .pip-status-heading (inside it) needs display other than none to
         keep announcing via aria-live; see below. */
      body[data-layout="compact"] .pip-monitoring-status-block {
        padding: 0;
      }
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
      body[data-layout="compact"] .pip-monitoring-controls {
        position: static;
        border-top: none;
        padding: 0;
      }
      /* Compact-toggle hidden — already in Compact, nothing to switch to. */
      body[data-layout="compact"] .pip-control-btn-compact {
        display: none;
      }
      /* Stop — bottom-left corner overlay, icon-only (its text label is
         hidden below; aria-label already carries the accessible name, same
         as Expand). Same stopMonitoring() click handler as Expanded's Stop
         — this is that exact button repositioned, not a second one — so it
         returns to Ready, it does not close the Companion. */
      body[data-layout="compact"] .pip-control-btn-stop {
        display: flex;
        position: absolute;
        bottom: 8px;
        left: 8px;
        margin: 0;
        padding: 12px;
        border-radius: 6px;
        z-index: 2;
        color: rgba(172, 158, 136, 0.82);
      }
      body[data-layout="compact"] .pip-control-btn-stop span:not(.pip-control-icon-stop) {
        display: none;
      }
      body[data-layout="compact"] .pip-control-icon-stop {
        width: 12px;
        height: 12px;
      }
      body[data-layout="compact"] .pip-control-btn-expand {
        display: flex;
        position: absolute;
        bottom: 8px;
        right: 8px;
        margin: 0;
        padding: 12px;
        border-radius: 6px;
        z-index: 2;
        color: rgba(172, 158, 136, 0.82);
      }
      /* Hover stays background-only here too, same as Expanded — see the
         approved correction above (.pip-control-btn-stop:hover etc.):
         icon color is deliberately pinned to Compact's own default (0.82,
         not Monitoring's 0.75) rather than left to fall through to any
         other rule, so it visibly does NOT change on hover. Scoped with
         [data-layout="compact"] so it doesn't affect Monitoring's own
         hover color. */
      body[data-layout="compact"] .pip-control-btn-stop:hover,
      body[data-layout="compact"] .pip-control-btn-expand:hover {
        color: rgba(172, 158, 136, 0.82);
        background: rgba(0, 0, 0, 0.36);
        border-radius: 6px;
      }
    `;
    pipDoc.head.appendChild(style);

    pipDoc.body.setAttribute('data-surface', 'dark');
    pipDoc.body.setAttribute('data-layout', layoutMode);

    const layout = pipDoc.createElement('div');
    layout.className = 'pip-layout';

    // ── Ready screen — shared title bar pinned at top, a "poster" area
    //    that centers the heading in the remaining space, then a
    //    fixed-padding action card (profile selector + Start Monitoring)
    //    pinned at the bottom. Matches the reference card's own
    //    composition rather than the flexible-spacer approach used before. ──
    const readyScreen = pipDoc.createElement('div');
    readyScreen.className = 'pip-screen pip-screen-ready';
    // No in-page title bar here either — the real Document PiP window
    // chrome is the only title bar now, in every state (see pipDoc.title
    // in startMonitoring()).

    const readyPoster = pipDoc.createElement('div');
    readyPoster.className = 'pip-ready-poster';

    const readyHeading = pipDoc.createElement('h1');
    readyHeading.className = 'pip-ready-heading';
    readyHeading.textContent = 'Ready for the next conversation.';
    readyPoster.appendChild(readyHeading);

    readyScreen.appendChild(readyPoster);

    const readyCard = pipDoc.createElement('div');
    readyCard.className = 'pip-ready-card';

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
    readyProfileSelectorEl = profileSelector;

    profileWrap.appendChild(profileSelector);
    readyCard.appendChild(profileWrap);

    const pipStartBtn = pipDoc.createElement('button');
    pipStartBtn.className = 'pip-ready-start-btn';
    pipStartBtn.textContent = 'Start Monitoring';
    pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
    readyCard.appendChild(pipStartBtn);

    readyScreen.appendChild(readyCard);

    // ── Profile dropdown — a centered modal overlay scoped to this Ready
    //    card's own bounds (.pip-screen-ready is position:relative — see
    //    the shared .pip-screen card rule). Only ever rendered/opened while
    //    Ready; monitoring locks the profile. ──
    const profileBackdrop = pipDoc.createElement('div');
    profileBackdrop.className = 'pip-profile-backdrop hidden';
    // Only close on a direct backdrop click — clicks inside the menu
    // itself bubble here too, and must not be treated as "click outside."
    profileBackdrop.addEventListener('click', (event) => {
      if (event.target === profileBackdrop) closeReadyProfileDropdown();
    });

    const dropdown = pipDoc.createElement('div');
    dropdown.className = 'pip-profile-dropdown';

    const dropdownLabel = pipDoc.createElement('div');
    dropdownLabel.className = 'pip-profile-dropdown-label';
    dropdownLabel.textContent = 'Select Profile';
    dropdown.appendChild(dropdownLabel);

    const dropdownList = pipDoc.createElement('div');
    dropdownList.className = 'pip-profile-dropdown-list';
    dropdown.appendChild(dropdownList);
    readyProfileDropdown = dropdownList;

    profileBackdrop.appendChild(dropdown);
    readyScreen.appendChild(profileBackdrop);
    readyProfileBackdropEl = profileBackdrop;

    layout.appendChild(readyScreen);
    readyScreenEl = readyScreen;

    // ── Monitoring screen (Expanded + Compact share this one DOM tree —
    //    see the [data-layout] CSS above for what each hides/shows) ──
    const monitoringScreen = pipDoc.createElement('div');
    monitoringScreen.className = 'pip-screen pip-screen-monitoring hidden';

    const monitoringHeader = pipDoc.createElement('div');
    monitoringHeader.className = 'pip-monitoring-header';
    // No in-page title bar here (see startMonitoring()'s pipDoc.title) —
    // the real Document PiP window chrome is the only title bar for every
    // Companion state now, Ready included.

    const statusBlock = pipDoc.createElement('div');
    statusBlock.className = 'pip-monitoring-status-block';

    // aria-live so assistive tech hears state changes without the
    // interruption a stronger "assertive" politeness would cause. Shared
    // by Expanded and Compact — Compact visually hides the surrounding
    // status block but keeps this element announcing (see the
    // [data-layout="compact"] CSS).
    const statusHeading = pipDoc.createElement('span');
    statusHeading.className = 'pip-status-heading';
    statusHeading.textContent = zoneLabel(currentZone);
    statusHeading.dataset.zone = String(currentZone);
    statusHeading.setAttribute('aria-live', 'polite');
    statusBlock.appendChild(statusHeading);
    pipStatusHeadingEl = statusHeading;

    const profileInfo = pipDoc.createElement('span');
    profileInfo.className = 'pip-profile-info';
    profileInfo.textContent = profileMetaText(activeProfile);
    statusBlock.appendChild(profileInfo);
    monitoringProfileNameEl = profileInfo;

    monitoringHeader.appendChild(statusBlock);
    monitoringScreen.appendChild(monitoringHeader);

    const circleWrapper = pipDoc.createElement('div');
    circleWrapper.className = 'pip-circle-wrapper';
    monitoringScreen.appendChild(circleWrapper);
    pipCircleWrapperEl = circleWrapper;

    // Control bar — shared by Expanded and Compact. Expanded lays these out
    // as a normal-flow bottom bar (Stop, Compact); Compact repositions Stop
    // as a bottom-left corner overlay (icon-only there), hides the
    // Compact-toggle entirely (already in Compact — nothing to toggle to),
    // and reveals a dedicated Expand control (bottom-right corner) — see
    // the [data-layout="compact"] CSS.
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

    pipWindow.addEventListener('pagehide', handlePipClose);

    // Go straight to Monitoring — Mezzo already chose this profile, so there
    // is no Ready confirmation step on first open. If mic acquisition fails,
    // fall back to Ready so the user can retry Start Monitoring from inside
    // the Companion instead of being left with a broken window. Subsequent
    // same-day sessions reuse this same open window via enterPipReadyMode()
    // (on Stop) and resumeMonitoringFromPipReady() (on its own Start
    // Monitoring button) instead of this path.
    activeProfile = profile;
    const started = await resumeMonitoringFromPipReady();
    if (!started) {
      enterPipReadyMode();
      sessionState.set(SESSION_STATES.COMPANION_READY);
    }

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

  /** Ready is always Expanded (data-layout) and has its own fixed size,
   *  distinct from Monitoring's Expanded size — restores both here so every
   *  path back to Ready (first open, reopen, stopping monitoring) converges. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED; // Ready has no Compact variant; kept in sync for when Monitoring resumes
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionTo(MEZZO_COMPANION_READY_SIZE);
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

  /**
   * Starts monitoring in an already-open Companion window, using whichever
   * profile is currently active. Shared by the Companion's own Ready-screen
   * "Start Monitoring" button (subsequent same-day sessions) and
   * startMonitoring()'s first-open path (see below).
   * @returns {Promise<boolean>} whether monitoring actually started
   */
  async function resumeMonitoringFromPipReady() {
    const profile = activeProfile;
    if (!profile) return false; // shouldn't happen — Ready mode always has an active profile

    const ok = await beginMonitoringSession(profile);
    if (!ok) return false; // stay in Ready mode; nothing else to clean up

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
    return true;
  }

  // Shared by the Companion's Ready-screen profile dropdown — same options,
  // same "+ Create New Profile..." row. Only ever rendered while Ready;
  // monitoring locks the profile and shows it as plain text instead.
  //
  // Selected state reads as a quiet accent bar + dimmer text (not a
  // checkmark) — restrained, since it's already the active choice, not
  // something that needs to shout. Saved (custom) profiles get a small
  // "Custom" tag, right-aligned, Title Case — the built-in Everyday
  // Conversation profile doesn't (it isn't a saved custom profile).
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
    if (!readyProfileBackdropEl) return;
    const opening = readyProfileBackdropEl.classList.contains('hidden');
    if (opening) renderReadyProfileDropdown();
    readyProfileBackdropEl.classList.toggle('hidden');
    readyProfileSelectorEl?.classList.toggle('is-open', opening);
    if (pipDocument) {
      if (opening) {
        pipDocument.addEventListener('keydown', handleProfileDropdownKeydown);
        // Move focus into the menu (selected row, or the first row if
        // none) — otherwise Tab from the trigger would fall through to
        // whatever's next in the Ready screen's own DOM order instead of
        // entering the now-open modal, since the backdrop is a sibling of
        // the screens, not nested where the trigger sits.
        const active = readyProfileDropdown?.querySelector('.pip-profile-option.is-active');
        const firstOption = active || readyProfileDropdown?.querySelector('.pip-profile-option');
        firstOption?.focus();
      } else {
        pipDocument.removeEventListener('keydown', handleProfileDropdownKeydown);
      }
    }
  }

  function closeReadyProfileDropdown() {
    if (!readyProfileBackdropEl) return;
    const wasOpen = !readyProfileBackdropEl.classList.contains('hidden');
    const focusWasInside = wasOpen && pipDocument && readyProfileBackdropEl.contains(pipDocument.activeElement);
    readyProfileBackdropEl.classList.add('hidden');
    readyProfileSelectorEl?.classList.remove('is-open');
    if (pipDocument) pipDocument.removeEventListener('keydown', handleProfileDropdownKeydown);
    // Return focus to the trigger only if it was actually inside the menu —
    // avoids stealing focus on the other, defensive closeReadyProfileDropdown()
    // calls (e.g. entering Ready mode) where the menu was never open.
    if (focusWasInside) readyProfileSelectorEl?.focus();
  }

  function handleProfileDropdownKeydown(event) {
    if (event.key === 'Escape') closeReadyProfileDropdown();
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

  /**
   * The Companion never contains calibration/profile-creation UI itself.
   * Stops monitoring if it's somehow active (defensive — Create New Profile
   * only ever appears on the Ready screen, so this shouldn't normally be
   * reachable mid-session), closes the Companion, brings the Anchor page
   * (this same tab — this function already runs in its JS realm, since the
   * Companion's own document only ever calls back into functions defined
   * here) into focus, and hands off to it via onCreateNewProfileRequested —
   * never a new tab, never a real navigation. companionCloseIntent marks
   * this specific close so the sessionState listener (wired below) can tell
   * it apart from a native ✕ or End Session close; it's set right before
   * the eager sessionState.set() below and cleared immediately after, the
   * same eager-transition pattern endSession() already uses rather than
   * waiting for the Document PiP window's own asynchronous pagehide.
   */
  function handleCreateNewProfile() {
    closeReadyProfileDropdown();
    if (isMonitoringActive) teardownMonitoringEngine();
    activeCircle = null;
    companionCloseIntent = COMPANION_CLOSE_INTENTS.CREATE_PROFILE;
    try { pipWindow.close(); } catch { /* ignore */ }
    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
    companionCloseIntent = null;
    window.focus();
    onCreateNewProfileRequested?.();
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
    readyProfileSelectorEl = null;
    readyProfileDropdown = null;
    readyProfileBackdropEl = null;
    monitoringScreenEl = null;
    pipStatusHeadingEl = null;
    monitoringProfileNameEl = null;
    pipCircleWrapperEl = null;
    layoutMode = LAYOUT_MODES.EXPANDED; // a fresh open always starts Expanded

    if (isPageUnloading) return; // this page's own pagehide is already tearing everything down

    // This fires for every way the Companion actually goes away — the
    // native ✕ (the only way to close it directly, in any state),
    // endSession()'s programmatic pipWindow.close(), and
    // handleCreateNewProfile()'s programmatic pipWindow.close() — since
    // Document PiP's own pagehide is what's wired to this handler, not any
    // of those call sites individually. By the time this runs after
    // endSession() or handleCreateNewProfile(), monitoring has already been
    // torn down there and sessionState has already been eagerly set to
    // COMPANION_CLOSED, so wasActive is already false and the
    // sessionState.set() below is a harmless no-op for those paths
    // (createSessionState() guards against re-firing on an unchanged
    // value) — companionCloseIntent is also already back to null by the
    // time this async handler runs, so there's nothing stale to misread
    // even if it weren't a no-op. What matters is the native-✕ case:
    // monitoring can never continue without the Companion open, so if it
    // was still active reaching here, tear it down now — not "silently
    // keep running" — and reflect the closed Companion (not a full
    // endSession) in session state, so Mezzo (try-it.html) returns to the
    // profile library instead of a full endSession() teardown — see
    // try-it.js's handleSessionStateChange().
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

  // companionCloseIntent is read here, at the moment the listener actually
  // fires — see handleCreateNewProfile()'s eager sessionState.set() and the
  // comment on the companionCloseIntent declaration above.
  sessionState.subscribe((state) => onSessionStateChange?.(state, companionCloseIntent));

  return {
    SESSION_STATES,
    COMPANION_CLOSE_INTENTS,
    getSessionState: sessionState.get,
    subscribe: sessionState.subscribe,
    getActiveProfile: () => activeProfile,
    setActiveProfile: (profile) => { activeProfile = profile; },
    isPipSupported: () => pipSupported,

    init,
    startMonitoring,
    stopMonitoring,
    endSession,

    startFallbackMonitoring,
    startDemo,
  };
}
