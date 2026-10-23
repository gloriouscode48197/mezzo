/**
 * Zone announcer — the only spoken output during Monitoring
 * (docs/prd/range-ring-and-lantern-refresh.md §6, §11.2).
 *
 * The four status labels are no longer visible text. A visually hidden live
 * region still carries them, debounced so it doesn't chatter: it announces
 * only changes into or out of Outside range, and only once the new state has
 * held for ANNOUNCE_HOLD_MS. Moves between Listening, Within range, and
 * Approaching end of range are never announced on their own.
 *
 * Pure apart from the injected timer functions, so it is unit-testable with
 * a fake clock.
 */

export const ANNOUNCE_HOLD_MS = 1000;

export const ZONE_LABELS = Object.freeze(['Listening', 'Within range', 'Approaching end of range', 'Outside range']);

const OUTSIDE = 3;

/**
 * @param {{
 *   announce: (text: string) => void,
 *   holdMs?: number,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout,
 * }} deps
 */
export function createZoneAnnouncer({
  announce,
  holdMs = ANNOUNCE_HOLD_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let announcedOutside = false; // what the listener last heard
  let zone = 0;
  let timer = null;

  function cancel() {
    if (timer !== null) { clearTimeoutFn(timer); timer = null; }
  }

  return {
    /** Feed every committed zone change (repeats are harmless). */
    update(nextZone) {
      zone = nextZone;
      const isOutside = zone === OUTSIDE;
      if (isOutside === announcedOutside) {
        cancel(); // back where the listener already is: nothing to say
        return;
      }
      if (timer !== null) return; // already waiting on this same change
      timer = setTimeoutFn(() => {
        timer = null;
        announcedOutside = zone === OUTSIDE;
        announce(ZONE_LABELS[zone]);
      }, holdMs);
    },
    /** Start of a monitoring session: nothing announced yet. */
    reset() {
      cancel();
      announcedOutside = false;
      zone = 0;
    },
    destroy: cancel,
  };
}
