/**
 * Mezzo — Analytics (Mixpanel)
 *
 * Lightweight event tracking for engagement metrics. Loaded on Home
 * (index.html) only; its Mixpanel snippet sets persistence: 'localStorage'
 * (no cookies), ip: false (no location from the IP address), and turns
 * off autocapture and automatic page views, so these are the only events:
 * - Anonymous persistent user ID (localStorage, no cookies)
 * - Debug exclusion via ?debug=true URL param
 * - Only 4 events tracked (see exports), plus Mixpanel's own $identify
 * - No audio data, volume levels, or voice content is ever sent; a session
 *   says only whether the glow appeared (alert_triggered)
 */

// =============================================================================
// Constants
// =============================================================================

const ANON_ID_KEY = 'mezzo_anonymous_id';
const DEBUG_KEY = 'mezzo_debug_user';

// =============================================================================
// Debug Exclusion
// =============================================================================

/** If ?debug=true is in the URL, permanently flag this browser as excluded. */
function checkDebugFlag() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      localStorage.setItem(DEBUG_KEY, 'true');
    }
  } catch { /* ignore */ }
}

function isDebugUser() {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

// =============================================================================
// Anonymous ID
// =============================================================================

function getOrCreateAnonymousId() {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// =============================================================================
// Initialization
// =============================================================================

checkDebugFlag();

const _disabled = isDebugUser();

// Mixpanel is initialized by the snippet in index.html's <head>.
// We just need to identify the anonymous user.
if (!_disabled && typeof window.mixpanel !== 'undefined') {
  const anonId = getOrCreateAnonymousId();
  if (anonId) {
    window.mixpanel.identify(anonId);
  }
}

// =============================================================================
// Internal Helper
// =============================================================================

function track(eventName, properties = {}) {
  if (_disabled || typeof window.mixpanel === 'undefined') return;
  try {
    window.mixpanel.track(eventName, properties);
  } catch { /* silent — analytics should never break the app */ }
}

// =============================================================================
// Exported Event Functions
// =============================================================================

/** Fire once per session when any page loads. */
export function trackAppOpened(returningUser) {
  track('App Opened', { returning_user: returningUser });
}

/** Fire when calibration finishes successfully. */
export function trackCalibrationCompleted() {
  track('Calibration Completed');
}

/** Fire when monitoring begins. */
export function trackMonitoringStarted() {
  track('Monitoring Started');
}

/**
 * Fire when a monitoring session ends (stop button, PiP close, or tab close).
 * @param {Object} props
 * @param {number} props.durationSeconds
 * @param {boolean} props.usedPip
 * @param {boolean} props.alertTriggered
 */
export function trackMonitoringSession({ durationSeconds, usedPip, alertTriggered }) {
  track('Monitoring Session', {
    duration_seconds: durationSeconds,
    used_pip: usedPip,
    alert_triggered: alertTriggered,
  });
}
