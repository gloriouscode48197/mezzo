/**
 * Mezzo — Session State
 *
 * One explicit, centralized model for src/mezzo-session.js (the module
 * try-it.js, Home/Dock, uses to own the session) to hold a single enum of
 * what the Companion is currently doing. Deliberately not inferred from
 * `pipWindow`'s truthiness — that alone can't distinguish "Companion open,
 * Ready" from "Companion open, Monitoring," which is exactly the bug this
 * replaces.
 *
 * Five values, not three: PiP-first made the Dock responsible for a
 * read-only, high-level status readout (see CLAUDE.md's Dock status
 * mapping) that has to distinguish more than just "open vs. monitoring" —
 * COMPANION_CALIBRATING and COMPANION_NEEDS_ATTENTION exist purely so the
 * Dock can render "Calibrating…" / "Needs attention." without reaching into
 * the Companion's own internal screen state. This mapping deliberately
 * collapses detail the Companion itself still tracks precisely: Welcome and
 * Ready both report COMPANION_READY here (the Dock doesn't distinguish
 * them), and the Calibrated checkpoint also reports COMPANION_READY, not a
 * state of its own — see src/mezzo-session.js's showWelcomeScreen()/
 * showReadyScreen()/showCalibratedScreen() for exactly where each of these
 * is set.
 *
 * `pipWindow` itself, `activeProfile`, and `isMonitoringActive` stay as
 * their own module-level facts in mezzo-session.js — this store only tracks
 * the one enum.
 */

export const SESSION_STATES = Object.freeze({
  COMPANION_CLOSED: 'companionClosed',
  COMPANION_READY: 'companionReady',
  COMPANION_CALIBRATING: 'companionCalibrating',
  COMPANION_NEEDS_ATTENTION: 'companionNeedsAttention',
  MONITORING_ACTIVE: 'monitoringActive',
});

export function createSessionState(initial = SESSION_STATES.COMPANION_CLOSED) {
  let state = initial;
  const listeners = new Set();

  return {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      listeners.forEach((fn) => fn(state));
    },
    /** @returns {() => void} unsubscribe function */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
