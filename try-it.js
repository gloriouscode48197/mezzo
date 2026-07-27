/**
 * Mezzo — Home / Dock Controller
 *
 * try-it.js is the browser-page half of Mezzo, PiP-first: the Mezzo
 * Companion (a Document Picture-in-Picture window, built by
 * src/mezzo-session.js) is the sole operational surface. This page has
 * exactly two states before/after that:
 *
 *   home:        One operational action — "Open Mezzo Companion" — and
 *                nothing else. No microphone permission request, no
 *                profile choice, no calibration decision happens here; the
 *                Companion decides all of that for itself the instant it
 *                opens (Welcome with zero saved profiles, Ready with one or
 *                more — see src/mezzo-session.js's enterPipReadyMode()).
 *   unsupported: Shown instead of home when this browser has no Document
 *                Picture-in-Picture support at all — a hard requirement now,
 *                not a fallback-to-something-else case (see CLAUDE.md's
 *                Non-Negotiable Decisions).
 *   dock:        A minimal, read-only status readout for as long as the
 *                Companion stays open, mapped from session.SESSION_STATES —
 *                see CLAUDE.md's Dock status mapping. Never shows profile
 *                names, calibration progress, or any monitoring/profile
 *                control; Close Companion is its one lifecycle exception,
 *                a page-side recovery action for when the Companion's
 *                native ✕ isn't reachable (see handleCloseCompanionClick()).
 *
 * Every calibration, recalibration, profile-selection, monitoring, and
 * profile-management flow lives inside the Companion — this file owns none
 * of that logic, only Home/Dock's own two-state routing.
 */

import { pageEnter } from './src/page-transition.js';
import { trackAppOpened } from './src/analytics.js';
import { createMezzoSession } from './src/mezzo-session.js';
import { getSavedProfiles } from './src/profiles.js';

// =============================================================================
// Session
// =============================================================================

const session = createMezzoSession({
  baseUrl: new URL('.', window.location.href).href,
  onSessionStateChange: handleSessionStateChange,
});
const pipSupported = session.isPipSupported();

session.init();

// =============================================================================
// DOM References
// =============================================================================

const stateHome = document.getElementById('state-home');
const stateUnsupported = document.getElementById('state-unsupported');
const stateDock = document.getElementById('state-dock');

const btnOpenCompanion = document.getElementById('btn-open-companion');
const btnCloseCompanion = document.getElementById('btn-close-companion');

const dockStatusDot = document.getElementById('dock-status-dot');
const dockStatusText = document.getElementById('dock-status-text');

const allStates = {
  home: stateHome,
  unsupported: stateUnsupported,
  dock: stateDock,
};

// =============================================================================
// View Transitions (opacity-only fade, no translateY)
// =============================================================================

// visibleEl tracks the element ACTUALLY on screen right now (only updated
// once a fade-out has genuinely finished and the swap has genuinely
// happened) — deliberately not derived by scanning classList each call.
// pendingTarget lets a new call redirect an already-in-flight fade-out
// rather than starting a second, independent one on the same outgoing
// element (see try-it.js's git history for the rapid-back-to-back-call bug
// this fixes).
let visibleEl = null;
let pendingTarget = null;
let pendingTransitionTimeout = null;

const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;

function transitionToState(name) {
  const nextEl = allStates[name];
  if (!nextEl) return;

  // Nothing shown yet (initial load) — render directly, no fade.
  if (!visibleEl) {
    Object.entries(allStates).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
    visibleEl = nextEl;
    return;
  }

  // Already showing the target, and no fade in flight that could carry it
  // somewhere else — genuinely nothing to do.
  if (visibleEl === nextEl && pendingTransitionTimeout === null) return;

  pendingTarget = name;

  if (pendingTransitionTimeout !== null) {
    // A fade-out is already in flight — redirect where it lands instead of
    // starting a second, independent one on the same outgoing element.
    return;
  }

  const outgoingEl = visibleEl;
  outgoingEl.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  outgoingEl.style.opacity = '0';

  pendingTransitionTimeout = setTimeout(() => {
    pendingTransitionTimeout = null;
    outgoingEl.classList.add('hidden');
    outgoingEl.style.transition = '';
    outgoingEl.style.opacity = '';

    // Read fresh — pendingTarget may have been redirected one or more
    // times since this timeout was originally scheduled.
    const targetEl = allStates[pendingTarget];
    visibleEl = targetEl;

    targetEl.style.opacity = '0';
    targetEl.classList.remove('hidden');

    requestAnimationFrame(() => {
      targetEl.style.transition = `opacity ${FADE_IN_MS}ms ease`;
      requestAnimationFrame(() => {
        targetEl.style.opacity = '';

        setTimeout(() => {
          targetEl.style.transition = '';
        }, FADE_IN_MS + 50);
      });
    });
  }, FADE_OUT_MS);
}

// =============================================================================
// Open Mezzo Companion
// =============================================================================

/**
 * The one operational action Home offers. Called from a real click (a
 * genuine user gesture, which is what Document PiP requires) — this page
 * never opens the Companion on its own. Home → Dock happens reactively via
 * handleSessionStateChange() below, the moment the Companion reports its
 * first state (Welcome or Ready, both COMPANION_READY here) rather than
 * being transitioned here directly — this page never predicts which screen
 * the Companion will choose to show.
 */
async function handleOpenCompanionClick() {
  await session.startMonitoring();
}

/** Same effect as the Companion's own native ✕ (session.endSession() closes
 *  the pipWindow and stops monitoring) — a page-side recovery path for when
 *  the floating window itself isn't reachable, not a second "end session"
 *  decision. See CLAUDE.md's Non-Negotiable Decisions. */
function handleCloseCompanionClick() {
  session.endSession();
}

// =============================================================================
// Dock Status Mapping
// =============================================================================

// See CLAUDE.md's Dock status mapping: Welcome and Ready both report
// COMPANION_READY here (the Dock doesn't distinguish them), and the
// Calibrated checkpoint also reports COMPANION_READY, not a state of its
// own — src/session-state.js's own header comment documents this same
// collapsing from the Companion's side.
const DOCK_STATUS_COPY = {
  [session.SESSION_STATES.COMPANION_READY]: { text: 'Ready', modifier: 'ready' },
  [session.SESSION_STATES.COMPANION_CALIBRATING]: { text: 'Calibrating', modifier: 'calibrating' },
  [session.SESSION_STATES.MONITORING_ACTIVE]: { text: 'Monitoring', modifier: 'monitoring' },
  [session.SESSION_STATES.COMPANION_NEEDS_ATTENTION]: { text: 'Needs attention', modifier: 'attention' },
};

const DOCK_STATUS_MODIFIERS = ['ready', 'calibrating', 'monitoring', 'attention'];

function renderDockStatus(state) {
  const copy = DOCK_STATUS_COPY[state];
  if (!copy) return;
  if (dockStatusText) dockStatusText.textContent = copy.text;
  if (dockStatusDot) {
    DOCK_STATUS_MODIFIERS.forEach((m) => dockStatusDot.classList.toggle(`dock-status-dot-${m}`, m === copy.modifier));
  }
}

/**
 * The single router for every session-state change, including ones this
 * page didn't itself initiate (e.g. the Companion's own native ✕). Home ↔
 * Dock is driven entirely off session state, never a direct call from a
 * click handler — COMPANION_CLOSED always means Home, everything else
 * always means Dock with its status mapped per DOCK_STATUS_COPY above.
 */
function handleSessionStateChange(state) {
  if (state === session.SESSION_STATES.COMPANION_CLOSED) {
    transitionToState('home');
    return;
  }
  transitionToState('dock');
  renderDockStatus(state);
}

// =============================================================================
// Event Binding
// =============================================================================

btnOpenCompanion?.addEventListener('click', handleOpenCompanionClick);
btnCloseCompanion?.addEventListener('click', handleCloseCompanionClick);

// =============================================================================
// Init
// =============================================================================

pageEnter();

// PiP support is a static browser capability, not something that changes at
// runtime — decided once, here, rather than re-checked per interaction.
transitionToState(pipSupported ? 'home' : 'unsupported');

trackAppOpened(getSavedProfiles().length > 0);
