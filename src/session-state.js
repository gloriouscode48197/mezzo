/**
 * Mezzo — Session State
 *
 * One explicit, centralized model for src/mezzo-session.js (the module
 * try-it.js, the Session Window, uses to own the session) to hold: whether
 * the Mezzo Companion is open, and whether monitoring is active.
 * Deliberately not inferred from `pipWindow`'s truthiness — that alone
 * can't distinguish "Companion open, Ready" from "Companion open,
 * Monitoring," which is exactly the bug this replaces.
 *
 * `pipWindow` itself, `activeProfile`, and `isMonitoringActive` (used by the
 * separate no-Companion-support fallback path) stay as their own
 * module-level facts in mezzo-session.js — this store only tracks the one
 * enum.
 */

export const SESSION_STATES = Object.freeze({
  COMPANION_CLOSED: 'companionClosed',
  COMPANION_READY: 'companionReady',
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
