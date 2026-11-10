/**
 * Mezzo — Home / Dock Controller
 *
 * The single, reusable Home ↔ Dock ↔ Unsupported-browser state machine:
 * session creation, direct Companion launch, Dock status mapping, and the
 * transitionToState() fade machinery. index.html (via landing.js) is this
 * module's one consumer — the Mezzo Companion (a Document Picture-in-Picture
 * window, built by src/mezzo-session.js) still owns calibration, speaking
 * profiles, Ready state, and monitoring outright, but this module now also
 * owns one narrow, deliberate exception: requesting microphone permission
 * before the Companion exists (see CLAUDE.md's Non-Negotiable Decisions,
 * "permission should follow understanding"). Three outer states, plus a
 * live-permission-state sub-machine nested inside `home`:
 *
 *   home:        Preparation and trust. Reflects the browser's CURRENT
 *                microphone-permission state, not first-time-vs-returning
 *                visit history — there is no persisted onboarding flag
 *                anywhere in this module, deliberately. Three
 *                mutually-exclusive sub-states (see refreshMicState()/
 *                showMicState() below): mic-request (not yet granted —
 *                explain, then let the user explicitly ask), mic-granted
 *                (confirmed — a separate, later "Open Mezzo Companion"
 *                click actually launches it), mic-denied (recovery, kept on
 *                this page; the Companion never opens). No profile choice,
 *                no calibration decision happens here either way — the
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
 *                native ✕ isn't reachable.
 *
 * Extracted from the retired try-it.js — try-it.html used to be a separate
 * page implementing this same Home/Dock model on its own — so there is
 * exactly one implementation of this state machine now, not a page-level
 * copy independently evolving alongside index.html's. See CLAUDE.md's
 * Product Architecture for why try-it.html is now just a compatibility
 * redirect to index.html, not a second page with its own logic.
 */

import { createMezzoSession } from './mezzo-session.js';
import { applyStudyFromLocation } from './study.js';

const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;

/**
 * @param {object} elements
 * @param {HTMLElement} elements.stateHome
 * @param {HTMLElement} elements.stateUnsupported
 * @param {HTMLElement} elements.stateDock
 * @param {HTMLElement} [elements.micRequestEl] - Home's not-yet-granted sub-state
 * @param {HTMLElement} [elements.micGrantedEl] - Home's permission-confirmed sub-state
 * @param {HTMLElement} [elements.micDeniedEl] - Home's recovery sub-state
 * @param {HTMLElement} [elements.micDeniedHeadingEl] - mic-denied's own heading, focused
 *   in place of a primary action (2026-08-17 redesign — this sub-state has no
 *   in-page recovery control anymore; see showMicState()'s own comment).
 * @param {HTMLElement} [elements.btnEnableMicrophone] - mic-request's one action
 * @param {HTMLElement} [elements.btnOpenCompanion] - mic-granted's one action; launches the Companion
 * @param {HTMLElement} [elements.btnCloseCompanion]
 * @param {HTMLElement} [elements.runningLiveEl] - the running state's polite live region
 * @param {string} elements.baseUrl - passed straight through to createMezzoSession().
 * @returns {{ session: object, isPipSupported: () => boolean }}
 */
/**
 * The running page's status line: whether monitoring is active, nothing
 * finer. Every other Companion state (Welcome, Ready, Calibrating, a
 * decision) reads "not active".
 */
export function dockStatusCopy(state, SESSION_STATES) {
  return state === SESSION_STATES.MONITORING_ACTIVE ? 'Monitoring is active' : 'Monitoring is not active';
}

/**
 * What the browser extension's popup needs to know, from the same session
 * state that drives the running page's status line (dockStatusCopy()), so
 * the two never disagree: is a Companion open, and is it monitoring?
 */
export function extensionStatus(state, SESSION_STATES) {
  return {
    companionOpen: Boolean(state) && state !== SESSION_STATES.COMPANION_CLOSED,
    monitoring: state === SESSION_STATES.MONITORING_ACTIVE,
  };
}

/**
 * The page's side of the extension bridge (extension/content-scripts/
 * mezzo-page-bridge.js). The page posts its status to its own window, and
 * answers when the extension asks; the content script relays it. Only
 * same-window, same-origin messages are read or sent, and only the two
 * booleans ever leave the page.
 */
export const MEZZO_PAGE_SOURCE = 'mezzo-page';
export const MEZZO_EXTENSION_SOURCE = 'mezzo-extension';
export function createExtensionReporter(win = window) {
  let status = { companionOpen: false, monitoring: false };
  // Never allowed to break the page: telling the extension is best-effort.
  const post = () => {
    try {
      win.postMessage?.({ source: MEZZO_PAGE_SOURCE, type: 'MEZZO_STATE', state: status }, win.location.origin);
    } catch { /* no extension to tell */ }
  };
  win.addEventListener?.('message', (event) => {
    if (event.source !== win || event.data?.source !== MEZZO_EXTENSION_SOURCE) return;
    if (event.data.type === 'MEZZO_STATE_REQUEST') post();
  });
  return {
    report(next) {
      if (next.companionOpen === status.companionOpen && next.monitoring === status.monitoring) return;
      status = { companionOpen: next.companionOpen, monitoring: next.monitoring };
      post();
    },
  };
}

export function initHomeDock({
  stateHome,
  stateUnsupported,
  stateDock,
  micRequestEl,
  micGrantedEl,
  micDeniedEl,
  micDeniedHeadingEl,
  btnEnableMicrophone,
  btnOpenCompanion,
  btnCloseCompanion,
  runningLiveEl,
  baseUrl,
}) {
  // Round 4 study mode: ?study=CODE saves a tester code, ?study=clear
  // removes it; either way the parameter leaves the address bar.
  applyStudyFromLocation();
  const allStates = { home: stateHome, unsupported: stateUnsupported, dock: stateDock };

  // =============================================================================
  // View Transitions (opacity-only fade, no translateY)
  // =============================================================================

  // visibleEl tracks the element ACTUALLY on screen right now (only updated
  // once a fade-out has genuinely finished and the swap has genuinely
  // happened) — deliberately not derived by scanning classList each call.
  // pendingTarget lets a new call redirect an already-in-flight fade-out
  // rather than starting a second, independent one on the same outgoing
  // element (see try-it.js's git history for the rapid-back-to-back-call bug
  // this fixes, before this module existed).
  let visibleEl = null;
  let pendingTarget = null;
  let pendingTransitionTimeout = null;

  function transitionToState(name) {
    const nextEl = allStates[name];
    if (!nextEl) return;

    // Presentational only — lets CSS key a page-level treatment off which
    // state is showing, without this module owning any styling itself.
    document.body.dataset.pageState = name;
    // The running state (the Dock) is the website's one cream surface.
    document.body.dataset.surface = name === 'dock' ? 'cream' : 'dark';

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
  // Microphone permission — Home's own narrow, deliberate exception (see
  // CLAUDE.md's Non-Negotiable Decisions, "permission should follow
  // understanding"). Three mutually-exclusive sub-states nested inside the
  // `home` state, toggled with a plain class swap rather than
  // transitionToState()'s fade machinery — every trigger here is a single,
  // sequential, user-driven action (initial load or one click), never the
  // kind of rapid/overlapping calls that machinery exists to guard against,
  // so there's nothing to reuse it for.
  // =============================================================================

  const micStates = { request: micRequestEl, granted: micGrantedEl, denied: micDeniedEl };
  // 2026-08-17 redesign: mic-denied has no primary action anymore (recovery
  // happens entirely through the browser's own site controls plus a manual
  // reload — see index.html's own comment on #mic-denied) — its own heading
  // is what receives focus instead, so a state with no action never leaves
  // focus stranded on whatever was focused just before the transition.
  const micFocusTargets = { request: btnEnableMicrophone, granted: btnOpenCompanion, denied: micDeniedHeadingEl };

  // 2026-08-17 manual-review fix: the very first showMicState() call — the
  // browser's own initial paint of whichever mic sub-state Home happens to
  // land on first — must NOT move focus at all. Landing a fresh page load
  // straight onto a visible focus ring around Enable microphone (before the
  // user has done anything) reads as an unexplained, premature nudge, and
  // breaks the normal expectation that a freshly loaded page starts with
  // focus at the browser's own default position (the document/body),
  // leaving standard Tab order to reach the button naturally. Every LATER
  // call — a real click's own transition, or returning to Home after Close
  // Companion — is a genuine, user-driven state change, and still gets the
  // focus move described below; this flag distinguishes the two rather than
  // hardcoding "skip focus for state X specifically" (the first-rendered
  // state isn't always 'request' — a returning user can land on 'granted'
  // or 'denied' immediately, and none of those should auto-focus on load
  // either).
  let isInitialMicRender = true;

  /** Moves focus to the newly-shown sub-state's primary action, or — for a
   *  sub-state with none — its own heading (micDeniedHeadingEl, given
   *  tabIndex=-1 in index.html, the same programmatic-focus-only convention
   *  src/mezzo-session.js's result headings already use). Same
   *  requestAnimationFrame(() => el?.focus()) convention every Companion
   *  decision-state transition already uses (see src/mezzo-session.js's
   *  showM1Screen()/showM2Screen()/showM3Screen()/openDeleteScreen()) —
   *  reused here rather than invented fresh. Hiding a sub-state's container
   *  (`display:none`) drops focus to <body> if that container held it, so
   *  this always re-lands it somewhere useful; the requestAnimationFrame
   *  wrap gives the browser one frame to register the target as focusable
   *  again after the `hidden` class is removed, matching why the existing
   *  convention wraps it the same way. Skips the very first call entirely —
   *  see isInitialMicRender's own comment. */
  function showMicState(name) {
    Object.entries(micStates).forEach(([k, el]) => el?.classList.toggle('hidden', k !== name));
    if (isInitialMicRender) {
      isInitialMicRender = false;
      return;
    }
    requestAnimationFrame(() => micFocusTargets[name]?.focus());
  }

  /** navigator.permissions.query() is used narrowly — only to pick which of
   *  the three sub-states to show, never to decide success or failure by
   *  itself (see CLAUDE.md's Calibration Controller Instance Rule /
   *  Non-Negotiable Decisions for why that stays the acquire/release path's
   *  job alone). Unsupported browsers, or the query itself throwing, fall
   *  back to 'prompt' behavior — the safe default that waits for an
   *  explicit click rather than assuming anything. */
  async function queryMicrophonePermissionState() {
    if (!navigator.permissions?.query) return 'prompt';
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state;
    } catch {
      return 'prompt';
    }
  }

  /**
   * Decides which mic sub-state to show — driven entirely by the browser's
   * CURRENT permission state, never by visit history (no persisted
   * onboarding/completion flag exists anywhere in this module). Called once
   * on load and again every time the Companion closes back to Home, so a
   * permission change made while the Companion was open (or in another tab)
   * is reflected the next time this page is looked at.
   *
   * A 'granted' query result is still only a hint for which screen to show
   * first — it never substitutes for the real thing. This still runs
   * session.requestMicrophoneAccess() (the actual acquire/release path) in
   * the background before landing on the success state, so a stale or
   * inaccurate query result can't strand the user on a "granted" screen that
   * can't actually launch the Companion.
   */
  async function refreshMicState() {
    const state = await queryMicrophonePermissionState();
    if (state === 'denied') {
      showMicState('denied');
      return;
    }
    if (state === 'granted') {
      const granted = await session.requestMicrophoneAccess();
      showMicState(granted ? 'granted' : 'denied');
      return;
    }
    showMicState('request');
  }

  /** mic-request's one action — the only click that can ever trigger the
   *  browser's raw microphone-permission prompt. Never chained into
   *  launching the Companion: granting access and opening the Companion
   *  stay two separate, explicit user gestures (see handleLaunchCompanion-
   *  Click() below), so Document PiP's own fresh-gesture requirement is
   *  never at risk of running out mid-flow. */
  async function handleEnableMicrophoneClick() {
    const granted = await session.requestMicrophoneAccess();
    showMicState(granted ? 'granted' : 'denied');
  }

  // mic-denied's own in-page retry action was retired (2026-08-17 redesign):
  // Chrome/Edge already provide a Reload control in the address bar itself
  // once the user changes the site's microphone permission, and a fresh
  // getUserMedia() call always re-checks the live permission state anyway —
  // an in-app "Try again" duplicated a control the browser already supplies
  // for free. Recovery now happens purely via refreshMicState() re-running
  // on the next full page load (see setupPage()'s own initial
  // transitionToState()/refreshMicState() calls below), exactly like every
  // other "browser state changed since last load" case this module already
  // handles.

  // =============================================================================
  // Session
  // =============================================================================

  const session = createMezzoSession({ baseUrl, onSessionStateChange: handleSessionStateChange });
  const pipSupported = session.isPipSupported();

  session.init();

  /**
   * mic-granted's one action, and the only thing that actually opens the
   * Companion. Called from a real click (a genuine user gesture, which is
   * what Document PiP requires) — deliberately its own separate gesture
   * from whatever click most recently confirmed microphone access, never
   * chained onto it. This page never opens the Companion on its own, and
   * never navigates anywhere first. Home → Dock happens reactively via
   * handleSessionStateChange() below, the moment the Companion reports its
   * first state (Welcome or Ready, both COMPANION_READY here) rather than
   * being transitioned here directly — this page never predicts which
   * screen the Companion will choose to show.
   */
  async function handleLaunchCompanionClick() {
    await session.startMonitoring();
  }

  /** Same effect as the Companion's own native ✕ (session.endSession()
   *  closes the pipWindow and stops monitoring) — a page-side recovery path
   *  for when the floating window itself isn't reachable, not a second "end
   *  session" decision. See CLAUDE.md's Non-Negotiable Decisions. */
  function handleCloseCompanionClick() {
    session.endSession();
  }

  /**
   * The single router for every session-state change, including ones this
   * page didn't itself initiate (e.g. the Companion's own native ✕). Home ↔
   * Dock is driven entirely off session state, never a direct call from a
   * click handler — COMPANION_CLOSED always means Home (back to the granted
   * page once the permission check confirms it), everything else means the
   * running state (internally the Dock). The status line says only whether
   * monitoring is active (dockStatusCopy()); it never reads zone or profile.
   */
  let running = false;
  let lastStatus = null;
  const extensionReporter = createExtensionReporter();
  function handleSessionStateChange(state) {
    extensionReporter.report(extensionStatus(state, session.SESSION_STATES));
    if (state === session.SESSION_STATES.COMPANION_CLOSED) {
      running = false;
      lastStatus = null;
      // Closed by something other than Close Companion (another mini
      // window, such as Meet's, or the Companion's own ✕): stay on the
      // cream page and offer to reopen it.
      if (session.hasReopenOffer?.()) {
        showRunningVariant('closed');
        if (runningLiveEl) runningLiveEl.textContent = 'The Companion closed.';
        return;
      }
      if (runningLiveEl) runningLiveEl.textContent = '';
      goHome();
      return;
    }
    transitionToState('dock');
    showRunningVariant('open');
    running = true;
    const status = dockStatusCopy(state, session.SESSION_STATES);
    stateDock?.querySelector('.running-label-text')?.replaceChildren(status);
    if (stateDock) stateDock.dataset.monitoring = String(state === session.SESSION_STATES.MONITORING_ACTIVE);
    // Announce the status when it changes, not on every inner state change.
    if (status !== lastStatus && runningLiveEl) runningLiveEl.textContent = `${status}.`;
    lastStatus = status;
  }

  function goHome() {
    transitionToState('home');
    if (pipSupported) refreshMicState();
  }

  // ── The running page's two variants: the Companion open, or closed with
  //    a reopen offer. Same page, same cream surface. ──
  const RUNNING_COPY = {
    open: {
      label: null, // the live status line (dockStatusCopy())
      heading: 'Your Companion is open',
      body: 'Keep this page open while using Mezzo. Closing it will also close the Mezzo Companion.',
    },
    closed: {
      label: 'Companion closed',
      heading: 'The Companion closed',
      body: "If you didn't close it, another mini window like Meet's may have. Reopen it to pick up where you left off.",
    },
  };
  function showRunningVariant(variant) {
    if (!stateDock) return;
    const copy = RUNNING_COPY[variant];
    stateDock.dataset.variant = variant;
    const set = (sel, text) => { const el = stateDock.querySelector(sel); if (el) el.textContent = text; };
    if (copy.label) set('.running-label-text', copy.label);
    set('.running-heading', copy.heading);
    set('.running-body', copy.body);
    const reopen = stateDock.querySelector('.running-reopen');
    if (reopen) reopen.hidden = variant !== 'closed';
    if (btnCloseCompanion) btnCloseCompanion.hidden = variant === 'closed';
    const privacy = stateDock.querySelector('.running-privacy');
    if (privacy) privacy.hidden = variant !== 'closed';
  }

  async function handleReopenClick() {
    // A real click: Document PiP needs it to open the window.
    await session.reopenCompanion();
  }

  function handleReopenDoneClick() {
    session.dismissReopenOffer();
    if (runningLiveEl) runningLiveEl.textContent = '';
    goHome();
  }

  btnEnableMicrophone?.addEventListener('click', handleEnableMicrophoneClick);
  btnOpenCompanion?.addEventListener('click', handleLaunchCompanionClick);
  btnCloseCompanion?.addEventListener('click', handleCloseCompanionClick);
  stateDock?.querySelector('#btn-reopen-companion')?.addEventListener('click', handleReopenClick);
  stateDock?.querySelector('#btn-reopen-done')?.addEventListener('click', handleReopenDoneClick);

  // PiP support is a static browser capability, not something that changes
  // at runtime — decided once, here, rather than re-checked per interaction.
  transitionToState(pipSupported ? 'home' : 'unsupported');
  if (pipSupported) refreshMicState();

  return { session, isPipSupported: () => pipSupported };
}
