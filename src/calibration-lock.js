/**
 * Mezzo — Cross-Tab Calibration Lock
 *
 * The smallest reliable coordination this codebase needs for two separate
 * browser TABS (not the Companion/Speaking-Profile-page pair within one
 * tab — that pair already shares one calibrationController instance, see
 * calibration-controller.js's INSTANCE RULE and CLAUDE.md's "Calibration
 * Controller Instance Rule"): a localStorage-based lease that stops two
 * tabs from both holding the microphone (and both racing to write
 * src/profiles.js's storage) for a calibration attempt at the same time.
 *
 * Deliberately separate from calibration-controller.js: this module knows
 * nothing about calibration measurement, mode, samples, or engine.js — only
 * "which tab, if any, currently owns a calibration attempt." It never
 * touches audio, and the lock record itself never carries anything beyond a
 * tab id and a timestamp — no audio data, no calibration samples, no
 * profile content of any kind ever passes through this module.
 *
 * Why localStorage over BroadcastChannel: the coordination this needs is
 * "check at the moment a user clicks Calibrate/Recalibrate, fail calmly if
 * someone else already has it" — a synchronous, point-in-time check, not a
 * live, reactive cross-tab feed. localStorage already gives that
 * synchronously, is supported everywhere BroadcastChannel is (and a little
 * beyond, historically), and needs no channel lifecycle to manage or leak.
 * BroadcastChannel would be the right tool for something this module
 * deliberately doesn't do — telling every other tab the instant a lock
 * frees up — which isn't a real requirement here: a second tab's user just
 * tries again after seeing "Calibration is already open in another Mezzo
 * tab," by which point the first tab has very likely already released it.
 *
 * Lifecycle: acquire() is called once, right before a calibration attempt
 * would otherwise start (see src/mezzo-session.js's beginCalibrationFlow()
 * — the Companion is the only caller now). Release is driven centrally,
 * not scattered across every cancel/commit/failure call site — see createMezzoSession()'s own
 * `calibrationController.subscribe()` wiring, which releases the lock
 * whenever the shared controller's status returns to 'idle' (covers every
 * commit, cancel, and close — reset() always lands there) or reaches
 * 'failed' (the mic is already released by that point; nothing left to
 * protect). A tab closing outright (pagehide) already calls
 * calibrationController.cancel(), which drives the same 'idle' transition,
 * so pagehide is covered by that one subscription too, not a second
 * handler. release() is always safe to call even when this tab doesn't
 * actually hold the lock (a no-op), so nothing needs to guard it.
 *
 * Staleness/recovery: a held lock that hasn't been refreshed within
 * STALE_AFTER_MS is treated as abandoned (the owning tab crashed, was
 * force-closed, or otherwise never got to run its own pagehide cleanup) and
 * can be acquired by another tab. A live, still-calibrating tab renews its
 * own lock periodically (see the heartbeat below) so a legitimately long
 * "reviewing the Calibrated screen" pause never expires out from under it.
 */

const LOCK_KEY = 'mezzoCalibrationLock';

// Long enough to safely cover one full capture window
// (calibration-controller.js's DEFAULT_CAPTURE_DURATION_MS, 6s) plus normal
// UI latency, short enough that a crashed/killed tab doesn't lock everyone
// else out for long. The heartbeat below is what actually keeps a
// legitimately long-held lock (e.g. a user pausing on the Calibrated
// checkpoint) from expiring — this constant only bounds how long an
// unrefreshed, abandoned lock survives.
const STALE_AFTER_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 5000;

function readLock(storage) {
  try {
    const raw = storage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.tabId === 'string' && typeof parsed.acquiredAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLock(storage, lock) {
  try {
    storage.setItem(LOCK_KEY, JSON.stringify(lock));
  } catch {
    // Storage unavailable/full/disabled (private browsing, quota) — fails
    // open, same as every other best-effort storage call in this codebase
    // (see src/profiles.js). Worse case: two tabs can both calibrate, same
    // as if this module didn't exist at all — never worse than that.
  }
}

function removeLock(storage) {
  try {
    storage.removeItem(LOCK_KEY);
  } catch {
    // best-effort, see writeLock()
  }
}

function isStale(lock, now) {
  return !lock || now - lock.acquiredAt > STALE_AFTER_MS;
}

/**
 * @param {object} [deps]
 * @param {{getItem, setItem, removeItem}} [deps.storage] - defaults to
 *   window.localStorage; tests inject an isolated in-memory mock so lock
 *   contention between "two tabs" can be simulated with two separate
 *   createCalibrationLock() instances sharing one fake storage object. When
 *   no usable storage exists at all (extremely locked-down privacy modes,
 *   or a non-browser environment that constructs createMezzoSession() —
 *   see src/mezzo-session.test.js — without ever exercising this path),
 *   this degrades to a no-op that always allows acquire(): fails open,
 *   same philosophy as every write*()/remove*() helper below — never worse
 *   than if this module didn't exist at all.
 * @param {() => number} [deps.now] - clock, defaults to Date.now.
 * @param {string} [deps.tabId] - defaults to a fresh random id; tests pass
 *   explicit ids (e.g. 'tab-a', 'tab-b') for readable assertions.
 * @param {(fn: Function, ms: number) => any} [deps.setIntervalFn]
 * @param {(handle: any) => void} [deps.clearIntervalFn]
 */
export function createCalibrationLock({
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  now = () => Date.now(),
  tabId = `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (handle) => clearInterval(handle),
} = {}) {
  if (!storage) {
    return {
      acquire: () => true,
      release: () => {},
      isHeldByThisTab: () => false,
      isHeldElsewhere: () => false,
      getTabId: () => tabId,
    };
  }

  let heldByThisTab = false;
  let heartbeatHandle = null;

  function stopHeartbeat() {
    if (heartbeatHandle !== null) {
      clearIntervalFn(heartbeatHandle);
      heartbeatHandle = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatHandle = setIntervalFn(() => {
      if (!heldByThisTab) return;
      writeLock(storage, { tabId, acquiredAt: now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Attempts to acquire the lease for this tab. Returns true when the lock
   * was free, already held by this same tab, or held by a stale (abandoned)
   * record from another tab. Returns false only when a different, live tab
   * genuinely holds it right now — the one real rejection case, and the
   * only one the caller needs to act on.
   */
  function acquire() {
    const current = readLock(storage);
    if (current && current.tabId !== tabId && !isStale(current, now())) {
      return false;
    }
    writeLock(storage, { tabId, acquiredAt: now() });
    heldByThisTab = true;
    startHeartbeat();
    return true;
  }

  /**
   * Releases the lease. Always safe to call — a no-op if this tab doesn't
   * currently hold it (never acquired, already released, or lost to
   * staleness) — so every real call site can call this unconditionally on
   * every exit path rather than tracking whether it's "worth" calling.
   * Never clears a lock a different tab holds, even if this tab's own
   * record went stale and was reclaimed elsewhere in the meantime.
   */
  function release() {
    heldByThisTab = false;
    stopHeartbeat();
    const current = readLock(storage);
    if (current && current.tabId === tabId) {
      removeLock(storage);
    }
  }

  function isHeldByThisTab() {
    return heldByThisTab;
  }

  /** For diagnostics/tests — true only when a different, live tab holds it. */
  function isHeldElsewhere() {
    const current = readLock(storage);
    return !!current && current.tabId !== tabId && !isStale(current, now());
  }

  return {
    acquire,
    release,
    isHeldByThisTab,
    isHeldElsewhere,
    getTabId: () => tabId,
  };
}
