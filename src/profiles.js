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
 *     library. A saved profile is a persistent, reusable identity
 *     (id, name, library position) — written via addSavedProfile() when the
 *     user explicitly saves a new one, and updated in place via
 *     updateSavedProfile() when they recalibrate an existing one. Capped at
 *     MAX_SAVED_PROFILES.
 *   - mezzoSelectedProfile (sessionStorage, this tab only) — whichever profile
 *     is active *in this tab* right now. Highest priority: respects an explicit
 *     mid-session "Change Profile" choice. May hold a temporary calibration
 *     (an in-session-only speaking range, not yet — or never — saved as a
 *     profile); mezzoProfiles and mezzoLastUsedProfile never may.
 *   - mezzoLastUsedProfile (localStorage, persists indefinitely) — whichever
 *     *saved* profile was last put into actual use, anywhere. Lets a brand-new
 *     tab (no session state yet) resume without re-choosing — this is what
 *     makes the browser extension's "Returning User" flow skip straight to
 *     monitoring instead of Choose a Profile. Never a temporary calibration —
 *     see setLastUsedProfile() below; a session that was never saved has
 *     nothing appropriate to resume into on a later, unrelated visit.
 *
 * `temporary: true` is a runtime-only marker on the in-session calibration
 * object (see src/engine.js's calibrate()/getCalibrationValues() for where
 * speakingDb/spreadDb themselves come from) — it is never written into
 * mezzoProfiles. saveSavedProfiles() strips it defensively regardless of
 * what's passed in, so it can't leak into storage even by caller mistake.
 */

const PROFILES_STORAGE_KEY = 'mezzoProfiles';
const SELECTED_PROFILE_KEY = 'mezzoSelectedProfile';
const LAST_USED_PROFILE_KEY = 'mezzoLastUsedProfile';

// Saved-profile library cap — enforced here (the storage layer), not only as
// a UI-level disabled-button affordance, so a bug in a calling surface can
// never silently write a 6th profile.
export const MAX_SAVED_PROFILES = 5;

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
    // Defense in depth: `temporary` is a runtime-only concept for the
    // in-session calibration object (see the file header above) — never a
    // field a saved profile should carry. Stripped here, at the one place
    // the saved library is actually persisted, regardless of what an
    // upstream caller passed in.
    const sanitized = profiles.map(({ temporary, ...rest }) => rest);
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (e) {
    console.error('[Profiles] Failed to persist saved profiles:', e);
  }
}

/**
 * Add a new saved profile — the only way a brand-new library entry should be
 * created (as opposed to updateSavedProfile(), which refreshes an existing
 * one's calibration in place). Generates the id; the caller supplies the
 * rest of a freshly-completed calibration.
 *
 * Fails cleanly (returns null, writes nothing) at MAX_SAVED_PROFILES rather
 * than silently truncating or overwriting an existing profile — the caller
 * is responsible for keeping whatever temporary calibration this came from
 * intact so the user can still use or retry it.
 *
 * @param {{ name: string, speakingDb: number, spreadDb: number, calibratedTs: number }} profile
 * @returns {object|null} the full new saved profile (with its generated id), or null if at the limit
 */
export function addSavedProfile({ name, speakingDb, spreadDb, calibratedTs }) {
  if (typeof speakingDb !== 'number' || typeof spreadDb !== 'number') {
    console.error('[Profiles] Refusing to add a profile without numeric speakingDb/spreadDb');
    return null;
  }

  const profiles = getSavedProfiles();
  if (profiles.length >= MAX_SAVED_PROFILES) {
    return null;
  }

  const newProfile = { id: crypto.randomUUID(), name, speakingDb, spreadDb, calibratedTs };
  saveSavedProfiles([...profiles, newProfile]);
  return newProfile;
}

/**
 * Promote a runtime-only temporary calibration into a brand-new saved
 * profile — the single shared operation behind both "Save as New Profile"
 * on a session-mode Calibrated screen (src/calibration-controller.js's
 * commitSaveAsNewProfile()) and the "save this for next time?" prompt a
 * user sees at Stop, after monitoring with an unsaved temporary profile
 * (src/mezzo-session.js). Both call sites must produce identical storage
 * behavior; routing both through this one function is what guarantees that,
 * rather than two independently-maintained implementations quietly drifting
 * apart.
 *
 * Deliberately does not touch mezzoSelectedProfile/mezzoLastUsedProfile —
 * updating "what's selected now" is session-lifecycle behavior the caller
 * owns, not a storage concern. This function's only job is turning a
 * temporary calibration into a saved one, correctly.
 *
 * @param {object} temporaryProfile - must carry `temporary: true`; only its
 *   speakingDb/spreadDb/calibratedTs are persisted — never savedProfileId,
 *   never the temporary flag itself, never any other field it happens to carry.
 * @param {string} name - the name to save it under.
 * @param {{ addSavedProfile?: typeof addSavedProfile }} [deps] - injectable
 *   for callers (e.g. the calibration controller) that need their own
 *   profileOps for testability, rather than always hitting real storage
 *   directly. Defaults to this module's own addSavedProfile.
 * @returns {{ profile: object, error: null } | { profile: null, error: { code: string, message: string } }}
 */
export function promoteTemporaryProfile(temporaryProfile, name, { addSavedProfile: addSavedProfileFn = addSavedProfile } = {}) {
  if (!temporaryProfile?.temporary) {
    throw new Error('promoteTemporaryProfile requires a genuine temporary profile (temporary: true)');
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('promoteTemporaryProfile requires a non-empty name');
  }

  const { speakingDb, spreadDb, calibratedTs } = temporaryProfile;
  // addSavedProfile() only ever creates — it never overwrites an existing
  // profile — so "never overwrite" is satisfied by construction, not by an
  // extra check here.
  const saved = addSavedProfileFn({ name: name.trim(), speakingDb, spreadDb, calibratedTs });

  if (!saved) {
    // Fails cleanly: the temporary profile passed in is untouched by this
    // call (it was never mutated, only read from) — the caller still has it
    // and can retry, or fall back to using it unsaved.
    return { profile: null, error: { code: 'PROFILE_LIMIT_REACHED', message: 'Delete a profile to save a new one.' } };
  }

  return { profile: saved, error: null };
}

/**
 * Update an existing saved profile's calibration in place — the only way a
 * recalibration should ever reach storage. Touches speakingDb, spreadDb, and
 * calibratedTs alone (whichever of those three are actually present in
 * `calibrationFields`); id, name, every other field, and the profile's
 * position in the saved array are all preserved untouched. Recalibrating
 * "Kitchen" updates "Kitchen" — never a duplicate, never implicitly renamed.
 *
 * Never subject to MAX_SAVED_PROFILES: this replaces an existing entry
 * in place, it never grows the library.
 *
 * @param {string} id
 * @param {{ speakingDb?: number, spreadDb?: number, calibratedTs?: number }} calibrationFields
 * @returns {object|null} the updated profile, or null if no profile with that id exists
 */
export function updateSavedProfile(id, calibrationFields) {
  const profiles = getSavedProfiles();
  const index = profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    return null;
  }

  const { speakingDb, spreadDb, calibratedTs } = calibrationFields;
  const updated = { ...profiles[index] };
  if (speakingDb !== undefined) updated.speakingDb = speakingDb;
  if (spreadDb !== undefined) updated.spreadDb = spreadDb;
  if (calibratedTs !== undefined) updated.calibratedTs = calibratedTs;

  const next = [...profiles];
  next[index] = updated; // in-place replace — array position (and every other profile) untouched
  saveSavedProfiles(next);
  return updated;
}

// =============================================================================
// Selected Profile (sessionStorage, this tab only)
// =============================================================================

export function getSelectedProfile() {
  try {
    const stored = sessionStorage.getItem(SELECTED_PROFILE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // spreadDb is intentionally not required here: profiles saved before it
    // existed are still valid, just without a personalized spread yet.
    // Consumers must treat spreadDb as possibly undefined and fall back
    // sensibly, not assume every stored profile has one.
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
    // spreadDb is intentionally not required here: profiles saved before it
    // existed are still valid, just without a personalized spread yet — see
    // the migration note in getSelectedProfile() above.
    return parsed && typeof parsed.speakingDb === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the cross-session "last used" profile. Refuses a temporary
 * calibration outright — this is the one guarantee that actually matters,
 * since resolveActiveProfile() (below) uses this value to let a brand-new
 * tab, days later, skip straight to Ready: a session that was never saved
 * has nothing appropriate to resume into on a later, unrelated visit.
 */
export function setLastUsedProfile(profile) {
  if (profile?.temporary) {
    console.warn('[Profiles] Refusing to persist a temporary calibration as the last-used profile');
    return;
  }
  try {
    localStorage.setItem(LAST_USED_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('[Profiles] Failed to persist last-used profile:', e);
  }
}

/**
 * Clears the cross-session "last used" profile — called when the profile it
 * points at is deleted, so a later fresh tab (or the browser extension's
 * "Returning User" flow, which resolves straight through resolveActiveProfile()
 * without ever visiting Choose a Speaking Profile) never silently resumes
 * into a profile that no longer exists. No stored reference should ever
 * point at a missing profile — see CLAUDE.md's Profile Model.
 */
export function clearLastUsedProfile() {
  try {
    localStorage.removeItem(LAST_USED_PROFILE_KEY);
  } catch (e) {
    console.error('[Profiles] Failed to clear last-used profile:', e);
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
