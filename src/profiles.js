/**
 * Mezzo — Profile Storage
 *
 * Used by src/mezzo-session.js (creates/selects/deletes profiles and
 * resolves which one to use — including for a freshly-opened tab that
 * never went through onboarding, e.g. launched by the browser extension) —
 * profile creation/selection/deletion is Companion-only, per CLAUDE.md's
 * Non-Negotiable Decisions. landing.js (index.html's Home/Dock controller)
 * only ever reads getSavedProfiles() for its own returning-user analytics
 * flag; it never creates, selects, updates, or deletes a profile itself.
 *
 * Four storage layers, each with a different lifetime:
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
 *   - mezzoHasStartedMonitoring (localStorage, persists indefinitely) — a
 *     one-way flag: whether a monitoring session has ever *started* in this
 *     browser, not whether one completed. Drives the Ready screen's
 *     first-conversation copy (see the Ready-screen PRD,
 *     docs/prd/ready-screen-speaking-profiles-mvp.md) — not yet wired into
 *     beginMonitoringSession() as of this addition.
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
const HAS_STARTED_MONITORING_KEY = 'mezzoHasStartedMonitoring';

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
// Save Prompt Name Resolution — the single source of truth for what typing a
// given name into the Ready-screen's M2/M2a "Save profile" naming state
// (src/mezzo-session.js's showM2Screen()/handleM2Submit()) should do. Both
// the live "as you type" warning text/button label (renderM2State()) and the
// actual submit handler call this same function — the UI never re-implements
// name matching or the profile-limit check itself, it only renders whichever
// of the four outcomes this resolves to. See CLAUDE.md's Non-Negotiable
// Decisions for why an explicit name match is allowed to update an existing
// profile here (never silently — the changing warning text and button label
// are what make it explicit) while still never overwriting anything without
// the user visibly choosing to.
// =============================================================================

export const SAVE_PROMPT_ACTIONS = Object.freeze({
  INVALID: 'invalid',   // empty or whitespace-only — nothing to resolve yet
  CREATE: 'create',     // unique name, room in the library — becomes a new profile
  UPDATE: 'update',     // matches an existing profile's name — updates it in place
  BLOCKED: 'blocked',   // unique name, but the library is already at MAX_SAVED_PROFILES
});

/**
 * Normalizes a profile name for matching only — trims surrounding
 * whitespace and lowercases. Never used to decide what gets *stored*: a
 * newly created profile keeps exactly the name the user typed (trimmed,
 * not lowercased), and updating an existing profile never touches its
 * stored display name/casing at all (see resolveSavePromptAction below).
 */
export function normalizeProfileName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * Resolves what submitting `name` in the save prompt should do, against
 * `savedProfiles` (defaults to the real library). Pure and synchronous —
 * safe to call on every keystroke for a live preview, and again,
 * immediately before committing, to guard against a stale decision (e.g.
 * another tab changed the library while this prompt was open — see
 * commitSavePromptName() below, which always re-resolves rather than
 * trusting whatever was last rendered).
 *
 * Matching existing names always wins over the profile limit: updating an
 * existing profile never grows the library, so it must never be blocked by
 * MAX_SAVED_PROFILES the way creating a new one can be.
 *
 * @param {string} name
 * @param {{ savedProfiles?: object[], maxProfiles?: number }} [options]
 * @returns {{ kind: string, profile: object|null }} `profile` is the
 *   matched saved profile for `update`, otherwise null.
 */
export function resolveSavePromptAction(name, { savedProfiles = getSavedProfiles(), maxProfiles = MAX_SAVED_PROFILES } = {}) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    return { kind: SAVE_PROMPT_ACTIONS.INVALID, profile: null };
  }

  const normalized = normalizeProfileName(trimmed);
  const match = savedProfiles.find((p) => normalizeProfileName(p.name) === normalized) ?? null;
  if (match) {
    return { kind: SAVE_PROMPT_ACTIONS.UPDATE, profile: match };
  }

  if (savedProfiles.length >= maxProfiles) {
    return { kind: SAVE_PROMPT_ACTIONS.BLOCKED, profile: null };
  }

  return { kind: SAVE_PROMPT_ACTIONS.CREATE, profile: null };
}

/**
 * Commits a save-prompt submission for `name`: creates a new saved profile
 * for a unique name, or explicitly updates the matching existing profile's
 * calibration in place for a name that already exists — re-resolving fresh
 * via resolveSavePromptAction() rather than trusting a `kind` the caller
 * already computed, so a submit always reflects the current library, not
 * whatever was last rendered. Reuses promoteTemporaryProfile() (create) and
 * updateSavedProfile() (update) exactly as-is — this function only decides
 * which one to call and normalizes both outcomes into one return shape;
 * it duplicates no persistence logic of its own.
 *
 * The `update` path preserves id, name, and library position — behaviorally
 * identical to Recalibrate for that same profile, just reached by typing a
 * matching name here instead of choosing Recalibrate from Ready.
 *
 * @param {object} temporaryProfile - must carry `temporary: true`.
 * @param {string} name
 * @param {{ savedProfiles?: object[], maxProfiles?: number,
 *   addSavedProfile?: typeof addSavedProfile,
 *   updateSavedProfile?: typeof updateSavedProfile }} [deps]
 * @returns {{ action: 'create'|'update', profile: object, error: null } |
 *           { action: null, profile: null, error: { code: string, message: string } }}
 */
export function commitSavePromptName(temporaryProfile, name, deps = {}) {
  if (!temporaryProfile?.temporary) {
    throw new Error('commitSavePromptName requires a genuine temporary profile (temporary: true)');
  }

  const resolution = resolveSavePromptAction(name, deps);

  if (resolution.kind === SAVE_PROMPT_ACTIONS.INVALID) {
    throw new Error('commitSavePromptName requires a non-empty name');
  }

  if (resolution.kind === SAVE_PROMPT_ACTIONS.BLOCKED) {
    return { action: null, profile: null, error: { code: 'PROFILE_LIMIT_REACHED', message: 'Delete a profile to save a new one.' } };
  }

  if (resolution.kind === SAVE_PROMPT_ACTIONS.UPDATE) {
    const { speakingDb, spreadDb, calibratedTs } = temporaryProfile;
    const updateFn = deps.updateSavedProfile ?? updateSavedProfile;
    const updated = updateFn(resolution.profile.id, { speakingDb, spreadDb, calibratedTs });
    if (!updated) {
      // Only reachable if the matched profile was deleted in the instant
      // between resolution and this write — deps.savedProfiles (if the
      // caller injected a stale snapshot) is the one way that gap can
      // actually open up, since resolveSavePromptAction() and this write
      // otherwise run back-to-back with nothing else able to interleave.
      return { action: null, profile: null, error: { code: 'PROFILE_MISSING', message: 'That profile no longer exists — please try again.' } };
    }
    return { action: SAVE_PROMPT_ACTIONS.UPDATE, profile: updated, error: null };
  }

  // CREATE
  const { profile, error } = promoteTemporaryProfile(temporaryProfile, name, deps);
  if (!profile) {
    return { action: null, profile: null, error };
  }
  return { action: SAVE_PROMPT_ACTIONS.CREATE, profile, error: null };
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
 * tab launched by the browser extension, or a fresh visit to index.html,
 * skip straight to Ready instead of Welcome), then null (genuinely
 * first-time — caller should send them to Welcome).
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

// =============================================================================
// First-Time Monitoring Flag (localStorage, indefinite) — see the Ready-
// screen PRD's "First-conversation rule": the Ready heading reads "Ready for
// your first conversation" until monitoring has started once, ever, then
// "Ready for your next conversation" from then on, persisting across
// Companion restarts. Storage-only for now — see this function's own doc
// comment for what's not yet wired up.
// =============================================================================

/**
 * Whether a monitoring session has ever *started* in this browser — not
 * whether one completed (a session that starts and is immediately stopped
 * still counts). Read fresh on every call, same as every other getter in
 * this file — no in-memory cache to keep in sync.
 *
 * @returns {boolean}
 */
export function getHasStartedMonitoring() {
  try {
    return localStorage.getItem(HAS_STARTED_MONITORING_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Records that a monitoring session has started. One-way — there is no
 * corresponding "unset," since nothing in the product ever needs this to
 * become false again once it's true.
 *
 * Not yet called from beginMonitoringSession() (src/mezzo-session.js) —
 * this phase adds and tests the storage capability only.
 */
export function setHasStartedMonitoring() {
  try {
    localStorage.setItem(HAS_STARTED_MONITORING_KEY, 'true');
  } catch (e) {
    console.error('[Profiles] Failed to persist has-started-monitoring flag:', e);
  }
}
