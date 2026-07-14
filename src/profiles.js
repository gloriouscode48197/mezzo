/**
 * Mezzo — Profile Storage
 *
 * Used by try-it.js (creates/selects profiles, and resolves which profile
 * to use — including for a freshly-opened tab that never went through
 * onboarding, e.g. launched by the browser extension) and
 * src/mezzo-session.js (the session-ownership module try-it.js uses).
 *
 * Three storage layers, each with a different lifetime:
 *   - mezzoProfiles (localStorage, persists indefinitely) — the saved-profile
 *     library. Only ever written when the user explicitly clicks "Save Profile".
 *   - mezzoSelectedProfile (sessionStorage, this tab only) — whichever profile
 *     is active *in this tab* right now. Highest priority: respects an explicit
 *     mid-session "Change Profile" choice.
 *   - mezzoLastUsedProfile (localStorage, persists indefinitely) — whichever
 *     profile was last put into actual use, anywhere. Lets a brand-new tab
 *     (no session state yet) resume without re-choosing — this is what makes
 *     the browser extension's "Returning User" flow skip straight to
 *     monitoring instead of Choose a Profile.
 */

const PROFILES_STORAGE_KEY = 'mezzoProfiles';
const SELECTED_PROFILE_KEY = 'mezzoSelectedProfile';
const LAST_USED_PROFILE_KEY = 'mezzoLastUsedProfile';

// Baseline for the built-in Recommended profile — no calibration exists to derive
// this from, so it's a first-pass tunable default (roughly the midpoint of real
// calibrated baselines observed during testing, -34dB to -19dB).
export const RECOMMENDED_SPEAKING_DB = -26;
export const RECOMMENDED_PROFILE = { name: 'Recommended', speakingDb: RECOMMENDED_SPEAKING_DB, savedProfileId: null };

// =============================================================================
// Saved Profile Library (localStorage, indefinite)
// =============================================================================

export function getSavedProfiles() {
  try {
    const stored = localStorage.getItem(PROFILES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedProfiles(profiles) {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (e) {
    console.error('[Profiles] Failed to persist saved profiles:', e);
  }
}

// =============================================================================
// Selected Profile (sessionStorage, this tab only)
// =============================================================================

export function getSelectedProfile() {
  try {
    const stored = sessionStorage.getItem(SELECTED_PROFILE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed.speakingDb === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function setSelectedProfile(profile) {
  try {
    sessionStorage.setItem(SELECTED_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('[Profiles] Failed to select profile:', e);
  }
}

// =============================================================================
// Last Used Profile (localStorage, indefinite — survives fresh tabs)
// =============================================================================

export function getLastUsedProfile() {
  try {
    const stored = localStorage.getItem(LAST_USED_PROFILE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed.speakingDb === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function setLastUsedProfile(profile) {
  try {
    localStorage.setItem(LAST_USED_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('[Profiles] Failed to persist last-used profile:', e);
  }
}

// =============================================================================
// Resolution (this tab's selection, falling back to cross-tab last-used)
// =============================================================================

/**
 * Resolve which profile this tab should use: this tab's own session choice
 * first, then whichever profile was last used anywhere (what lets a fresh
 * tab launched by the browser extension, or a fresh visit to try-it.html,
 * skip straight to Ready instead of Choose a Profile), then null
 * (genuinely first-time — caller should send them to Choose a Profile).
 */
export function resolveActiveProfile() {
  let profile = getSelectedProfile();
  if (profile) return profile;

  profile = getLastUsedProfile();
  if (profile) {
    setSelectedProfile(profile); // keep this tab's session consistent going forward
    return profile;
  }

  return null;
}
