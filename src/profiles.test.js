/**
 * Mezzo Profile Storage Unit Tests
 *
 * Run with: node --test src/profiles.test.js
 * (Requires Node.js 18+ for built-in test runner)
 *
 * profiles.js reads/writes the real browser localStorage/sessionStorage
 * globals directly (no injected storage dependency) — Node doesn't provide
 * those globally, so this file installs a minimal in-memory stand-in before
 * anything in profiles.js is actually called. Safe to do at module top
 * level: the `import` below only evaluates profiles.js's own top-level code
 * (constants and function *definitions*, no storage access), so the mocks
 * are in place well before any test — which runs later, inside describe()/
 * it() callbacks — ever calls a function that touches storage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

function createMemoryStorage() {
  let store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

globalThis.localStorage = createMemoryStorage();
globalThis.sessionStorage = createMemoryStorage();

import {
  getSavedProfiles,
  saveSavedProfiles,
  deleteSavedProfile,
  addSavedProfile,
  updateSavedProfile,
  promoteTemporaryProfile,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  setLastUsedProfile,
  clearLastUsedProfile,
  getHasStartedMonitoring,
  setHasStartedMonitoring,
  resolveActiveProfile,
  normalizeProfileName,
  resolveSavePromptAction,
  commitSavePromptName,
  SAVE_PROMPT_ACTIONS,
  MAX_SAVED_PROFILES,
  needsRecalibration,
} from './profiles.js';

// =============================================================================
// Test Helpers
// =============================================================================

function makeCalibration(overrides = {}) {
  return {
    name: 'Kitchen',
    speakingDb: -30,
    spreadDb: 4,
    calibratedTs: 1000,
    ...overrides,
  };
}

function fillLibrary(count, namePrefix = 'Profile') {
  const added = [];
  for (let i = 0; i < count; i++) {
    added.push(addSavedProfile(makeCalibration({ name: `${namePrefix} ${i}`, speakingDb: -30 - i })));
  }
  return added;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// =============================================================================
// addSavedProfile
// =============================================================================

describe('addSavedProfile', () => {
  it('adds a new profile with a generated id', () => {
    const profile = addSavedProfile(makeCalibration());
    assert.ok(profile);
    assert.ok(typeof profile.id === 'string' && profile.id.length > 0);
    assert.strictEqual(profile.name, 'Kitchen');
    assert.strictEqual(profile.speakingDb, -30);
    assert.strictEqual(profile.spreadDb, 4);
    assert.strictEqual(profile.calibratedTs, 1000);
  });

  it('persists the new profile into the saved library', () => {
    addSavedProfile(makeCalibration());
    const saved = getSavedProfiles();
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Kitchen');
  });

  it('generates a distinct id per profile', () => {
    const a = addSavedProfile(makeCalibration({ name: 'A' }));
    const b = addSavedProfile(makeCalibration({ name: 'B' }));
    assert.notStrictEqual(a.id, b.id);
  });

  it('refuses to add a profile without a numeric speakingDb or spreadDb', () => {
    assert.strictEqual(addSavedProfile(makeCalibration({ speakingDb: undefined })), null);
    assert.strictEqual(addSavedProfile(makeCalibration({ spreadDb: undefined })), null);
    assert.strictEqual(getSavedProfiles().length, 0, 'nothing should have been persisted');
  });

  it('fails cleanly at MAX_SAVED_PROFILES without touching storage', () => {
    fillLibrary(MAX_SAVED_PROFILES);
    assert.strictEqual(getSavedProfiles().length, MAX_SAVED_PROFILES);

    const before = getSavedProfiles();
    const result = addSavedProfile(makeCalibration({ name: 'One Too Many' }));

    assert.strictEqual(result, null, 'a null return, not a thrown error, is the clean-failure signal the caller checks');
    const after = getSavedProfiles();
    assert.strictEqual(after.length, MAX_SAVED_PROFILES, 'library size must not grow past the limit');
    assert.deepStrictEqual(after, before, 'storage must be completely untouched by the failed attempt');
  });

  it('strips a temporary flag even if a caller mistakenly includes one', () => {
    const profile = addSavedProfile({ ...makeCalibration(), temporary: true });
    assert.strictEqual(profile.temporary, undefined);
    assert.strictEqual(getSavedProfiles()[0].temporary, undefined);
  });
});

// =============================================================================
// updateSavedProfile (recalibration)
// =============================================================================

describe('updateSavedProfile', () => {
  it('updates speakingDb, spreadDb, and calibratedTs on the matching profile', () => {
    const original = addSavedProfile(makeCalibration());
    const updated = updateSavedProfile(original.id, { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });

    assert.strictEqual(updated.speakingDb, -25);
    assert.strictEqual(updated.spreadDb, 6);
    assert.strictEqual(updated.calibratedTs, 2000);
  });

  it('preserves id, name, and every unrelated field', () => {
    const original = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const updated = updateSavedProfile(original.id, { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });

    assert.strictEqual(updated.id, original.id, 'recalibrating "Kitchen" must update "Kitchen", not create a new identity');
    assert.strictEqual(updated.name, 'Kitchen', 'recalibrating never implicitly renames');
  });

  it('never creates a duplicate entry — the library size is unchanged', () => {
    fillLibrary(3);
    const target = getSavedProfiles()[1];
    updateSavedProfile(target.id, { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });
    assert.strictEqual(getSavedProfiles().length, 3, 'recalibrating must never grow the library');
  });

  it('preserves the profile\'s exact array/library position', () => {
    fillLibrary(5);
    const before = getSavedProfiles();
    const targetId = before[2].id;

    updateSavedProfile(targetId, { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });

    const after = getSavedProfiles();
    assert.strictEqual(after.length, 5);
    assert.strictEqual(after[2].id, targetId, 'the recalibrated profile must stay at the same index');
    // every other profile, in the same order, untouched
    [0, 1, 3, 4].forEach((i) => {
      assert.deepStrictEqual(after[i], before[i], `profile at index ${i} should be completely unaffected`);
    });
  });

  it('only touches the three calibration fields — partial input leaves the rest alone', () => {
    const original = addSavedProfile(makeCalibration({ speakingDb: -30, spreadDb: 4, calibratedTs: 1000 }));
    const updated = updateSavedProfile(original.id, { speakingDb: -25 });

    assert.strictEqual(updated.speakingDb, -25);
    assert.strictEqual(updated.spreadDb, 4, 'not included in this update — must be untouched');
    assert.strictEqual(updated.calibratedTs, 1000, 'not included in this update — must be untouched');
  });

  it('ignores any fields in calibrationFields beyond speakingDb/spreadDb/calibratedTs', () => {
    const original = addSavedProfile(makeCalibration());
    const updated = updateSavedProfile(original.id, {
      speakingDb: -25,
      spreadDb: 6,
      calibratedTs: 2000,
      name: 'Hacked Name',
      id: 'not-the-real-id',
    });

    assert.strictEqual(updated.name, 'Kitchen', 'name must not be alterable through this path');
    assert.strictEqual(updated.id, original.id, 'id must not be alterable through this path');
  });

  it('returns null and touches nothing for an unknown id', () => {
    addSavedProfile(makeCalibration());
    const before = getSavedProfiles();

    const result = updateSavedProfile('does-not-exist', { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });

    assert.strictEqual(result, null);
    assert.deepStrictEqual(getSavedProfiles(), before);
  });

  it('still works at MAX_SAVED_PROFILES — recalibration never grows the library, so the limit is irrelevant to it', () => {
    fillLibrary(MAX_SAVED_PROFILES);
    const target = getSavedProfiles()[0];

    const updated = updateSavedProfile(target.id, { speakingDb: -25, spreadDb: 6, calibratedTs: 2000 });

    assert.ok(updated, 'recalibration must succeed even with a full library');
    assert.strictEqual(getSavedProfiles().length, MAX_SAVED_PROFILES);
  });

  it('backfills spreadDb onto a pre-migration profile that never had one', () => {
    // Simulates a profile saved before spreadDb existed: written directly,
    // bypassing addSavedProfile()'s numeric spreadDb requirement, the way a
    // real profile persisted under the old schema would already be sitting
    // in storage.
    saveSavedProfiles([{ id: 'legacy-1', name: 'Old Profile', speakingDb: -28, calibratedTs: 500 }]);
    assert.strictEqual(getSavedProfiles()[0].spreadDb, undefined, 'sanity check: no spreadDb yet, as a real pre-migration profile would have');

    const updated = updateSavedProfile('legacy-1', { speakingDb: -27, spreadDb: 5, calibratedTs: 1500 });

    assert.strictEqual(updated.spreadDb, 5, 'a real recalibration naturally backfills spreadDb');
    assert.strictEqual(updated.id, 'legacy-1');
    assert.strictEqual(updated.name, 'Old Profile');
  });
});

// =============================================================================
// promoteTemporaryProfile — the create-path operation behind Ready's own
// Save profile naming screen (via commitSavePromptName() below)
// =============================================================================

function makeTemporary(overrides = {}) {
  return {
    name: 'Current speaking range',
    speakingDb: -28,
    spreadDb: 5,
    calibratedTs: 999,
    savedProfileId: null,
    temporary: true,
    ...overrides,
  };
}

describe('promoteTemporaryProfile', () => {
  it('creates a new saved profile carrying only name/speakingDb/spreadDb/calibratedTs', () => {
    const { profile, error } = promoteTemporaryProfile(makeTemporary(), 'Kitchen');
    assert.strictEqual(error, null);
    assert.ok(typeof profile.id === 'string' && profile.id.length > 0);
    assert.strictEqual(profile.name, 'Kitchen');
    assert.strictEqual(profile.speakingDb, -28);
    assert.strictEqual(profile.spreadDb, 5);
    assert.strictEqual(profile.calibratedTs, 999);
    assert.strictEqual(profile.temporary, undefined, 'the saved profile must not carry the temporary flag');
    assert.strictEqual(profile.savedProfileId, undefined, 'savedProfileId was a marker on the temporary shape only, not a real saved-profile field');
  });

  it('persists the new profile into the saved library', () => {
    promoteTemporaryProfile(makeTemporary(), 'Kitchen');
    assert.strictEqual(getSavedProfiles().length, 1);
    assert.strictEqual(getSavedProfiles()[0].name, 'Kitchen');
  });

  it('rejects a non-temporary profile outright', () => {
    const notTemporary = { name: 'Kitchen', speakingDb: -28, spreadDb: 5, calibratedTs: 999 };
    assert.throws(() => promoteTemporaryProfile(notTemporary, 'Kitchen'), /genuine temporary profile/);
    assert.strictEqual(getSavedProfiles().length, 0);
  });

  it('rejects an empty or whitespace-only name without touching storage', () => {
    assert.throws(() => promoteTemporaryProfile(makeTemporary(), ''), /non-empty name/);
    assert.throws(() => promoteTemporaryProfile(makeTemporary(), '   '), /non-empty name/);
    assert.strictEqual(getSavedProfiles().length, 0);
  });

  it('never overwrites an existing profile — it only ever creates', () => {
    addSavedProfile({ name: 'Existing', speakingDb: -30, spreadDb: 4, calibratedTs: 1 });
    const before = getSavedProfiles();

    promoteTemporaryProfile(makeTemporary(), 'New One');

    const after = getSavedProfiles();
    assert.strictEqual(after.length, 2);
    assert.deepStrictEqual(after[0], before[0], 'the pre-existing profile must be completely untouched');
  });

  it('fails cleanly at the five-profile limit with a stable recoverable error code', () => {
    for (let i = 0; i < MAX_SAVED_PROFILES; i++) {
      addSavedProfile({ name: `Profile ${i}`, speakingDb: -30, spreadDb: 4, calibratedTs: i });
    }
    const before = getSavedProfiles();

    const { profile, error } = promoteTemporaryProfile(makeTemporary(), 'One Too Many');

    assert.strictEqual(profile, null);
    assert.strictEqual(error.code, 'PROFILE_LIMIT_REACHED');
    assert.deepStrictEqual(getSavedProfiles(), before, 'library must be completely unchanged on failure');
  });

  it('preserves the caller\'s temporary object untouched when the limit blocks saving', () => {
    for (let i = 0; i < MAX_SAVED_PROFILES; i++) {
      addSavedProfile({ name: `Profile ${i}`, speakingDb: -30, spreadDb: 4, calibratedTs: i });
    }
    const temp = makeTemporary();
    const tempSnapshotBefore = { ...temp };

    promoteTemporaryProfile(temp, 'One Too Many');

    assert.deepStrictEqual(temp, tempSnapshotBefore, 'the temporary object passed in must not be mutated');
  });

  it('never writes the temporary object to mezzoLastUsedProfile', () => {
    promoteTemporaryProfile(makeTemporary(), 'Kitchen');
    assert.strictEqual(getLastUsedProfile(), null, 'promotion is a pure storage-creation operation — selection/last-used is the caller\'s responsibility');
  });

  it('accepts an injected addSavedProfile for callers with their own profileOps (e.g. the calibration controller)', () => {
    const calls = [];
    const injected = (fields) => {
      calls.push(fields);
      return { id: 'injected-1', ...fields };
    };

    const { profile, error } = promoteTemporaryProfile(makeTemporary(), 'Kitchen', { addSavedProfile: injected });

    assert.strictEqual(error, null);
    assert.strictEqual(profile.id, 'injected-1');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(getSavedProfiles().length, 0, 'the real, module-level storage must be untouched when a different addSavedProfile is injected');
  });
});

// =============================================================================
// resolveSavePromptAction — the single helper deciding what a save-prompt
// name submission should do: invalid / create / update / blocked. Both the
// live "as you type" UI preview and commitSavePromptName() (below) call
// this same function — it is the one place name-matching and the
// profile-limit check happen.
// =============================================================================

describe('normalizeProfileName', () => {
  it('trims and lowercases', () => {
    assert.strictEqual(normalizeProfileName('  Kitchen  '), 'kitchen');
  });

  it('returns an empty string for non-string input', () => {
    assert.strictEqual(normalizeProfileName(null), '');
    assert.strictEqual(normalizeProfileName(undefined), '');
  });
});

describe('resolveSavePromptAction', () => {
  it('resolves an empty or whitespace-only name to invalid', () => {
    assert.strictEqual(resolveSavePromptAction('').kind, SAVE_PROMPT_ACTIONS.INVALID);
    assert.strictEqual(resolveSavePromptAction('   ').kind, SAVE_PROMPT_ACTIONS.INVALID);
    assert.strictEqual(resolveSavePromptAction(undefined).kind, SAVE_PROMPT_ACTIONS.INVALID);
  });

  it('resolves a unique name to create, with room in the library', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const resolution = resolveSavePromptAction('Coffee Shop');
    assert.strictEqual(resolution.kind, SAVE_PROMPT_ACTIONS.CREATE);
    assert.strictEqual(resolution.profile, null);
  });

  it('resolves a name matching an existing profile to update, carrying that exact profile', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const resolution = resolveSavePromptAction('Kitchen');
    assert.strictEqual(resolution.kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.deepStrictEqual(resolution.profile, kitchen);
  });

  it('matching ignores case', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    assert.strictEqual(resolveSavePromptAction('kitchen').kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(resolveSavePromptAction('KITCHEN').kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(resolveSavePromptAction('KiTcHeN').profile.id, kitchen.id);
  });

  it('matching ignores surrounding whitespace', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    assert.strictEqual(resolveSavePromptAction('  Kitchen  ').kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(resolveSavePromptAction('\tKitchen\n').kind, SAVE_PROMPT_ACTIONS.UPDATE);
  });

  it('never treats an internal-whitespace difference as a match', () => {
    addSavedProfile(makeCalibration({ name: 'Coffee Shop' }));
    assert.strictEqual(resolveSavePromptAction('CoffeeShop').kind, SAVE_PROMPT_ACTIONS.CREATE);
  });

  it('blocks a unique name once the library is at the five-profile limit', () => {
    fillLibrary(MAX_SAVED_PROFILES);
    const resolution = resolveSavePromptAction('One Too Many');
    assert.strictEqual(resolution.kind, SAVE_PROMPT_ACTIONS.BLOCKED);
  });

  it('an existing-name match still resolves to update at the five-profile limit — never blocked', () => {
    const profiles = fillLibrary(MAX_SAVED_PROFILES);
    const target = profiles[2];
    const resolution = resolveSavePromptAction(target.name);
    assert.strictEqual(resolution.kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(resolution.profile.id, target.id);
  });

  it('accepts an injected savedProfiles snapshot instead of reading storage', () => {
    const injected = [{ id: 'x1', name: 'Injected', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }];
    assert.strictEqual(resolveSavePromptAction('Injected', { savedProfiles: injected }).kind, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(getSavedProfiles().length, 0, 'real storage must be untouched — nothing was ever added here');
  });
});

// =============================================================================
// commitSavePromptName — the save prompt's actual commit, reusing
// promoteTemporaryProfile() (create) and updateSavedProfile() (update)
// exactly as-is rather than duplicating persistence logic.
// =============================================================================

describe('commitSavePromptName', () => {
  it('a unique name creates a new profile', () => {
    const { action, profile, error } = commitSavePromptName(makeTemporary(), 'Kitchen');
    assert.strictEqual(error, null);
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.CREATE);
    assert.ok(typeof profile.id === 'string' && profile.id.length > 0);
    assert.strictEqual(profile.name, 'Kitchen');
    assert.strictEqual(getSavedProfiles().length, 1);
  });

  it('an existing name updates the existing profile', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }));
    const temp = makeTemporary({ speakingDb: -20, spreadDb: 6, calibratedTs: 999 });

    const { action, profile, error } = commitSavePromptName(temp, 'Kitchen');

    assert.strictEqual(error, null);
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(profile.speakingDb, -20);
    assert.strictEqual(profile.spreadDb, 6);
    assert.strictEqual(profile.calibratedTs, 999);
    assert.strictEqual(getSavedProfiles().length, 1, 'updating must never grow the library');
    assert.notStrictEqual(kitchen.speakingDb, profile.speakingDb, 'sanity check: the calibration actually changed');
  });

  it('preserves the profile\'s id on update', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const { profile } = commitSavePromptName(makeTemporary(), 'Kitchen');
    assert.strictEqual(profile.id, kitchen.id);
  });

  it('preserves the profile\'s stored display name and casing on update, regardless of how the user typed it', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const { profile } = commitSavePromptName(makeTemporary(), 'kitchen'); // typed lowercase
    assert.strictEqual(profile.name, 'Kitchen', 'stored display casing must never change to match what was typed');
  });

  it('matching ignores case when committing, not just when resolving', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const { action, profile } = commitSavePromptName(makeTemporary(), 'KITCHEN');
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(profile.id, kitchen.id);
    assert.strictEqual(getSavedProfiles().length, 1);
  });

  it('matching ignores surrounding whitespace when committing', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const { action, profile } = commitSavePromptName(makeTemporary(), '  Kitchen  ');
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(profile.id, kitchen.id);
  });

  it('an existing-name update succeeds even when the library is already at the five-profile limit', () => {
    const profiles = fillLibrary(MAX_SAVED_PROFILES);
    const target = profiles[1];
    const temp = makeTemporary({ speakingDb: -19 });

    const { action, profile, error } = commitSavePromptName(temp, target.name);

    assert.strictEqual(error, null);
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.UPDATE);
    assert.strictEqual(profile.id, target.id);
    assert.strictEqual(profile.speakingDb, -19);
    assert.strictEqual(getSavedProfiles().length, MAX_SAVED_PROFILES, 'updating must not change the library size');
  });

  it('a unique-name create is blocked at the five-profile limit, with a stable recoverable error code', () => {
    fillLibrary(MAX_SAVED_PROFILES);
    const before = getSavedProfiles();

    const { action, profile, error } = commitSavePromptName(makeTemporary(), 'One Too Many');

    assert.strictEqual(profile, null);
    assert.strictEqual(action, null);
    assert.strictEqual(error.code, 'PROFILE_LIMIT_REACHED');
    assert.deepStrictEqual(getSavedProfiles(), before, 'library must be completely unchanged on failure');
  });

  it('duplicate profile names can never be created through this flow — a matching name always updates, never adds a second entry with the same name', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    commitSavePromptName(makeTemporary(), 'Kitchen');
    commitSavePromptName(makeTemporary(), 'kitchen'); // same name again, different casing
    commitSavePromptName(makeTemporary(), '  Kitchen  '); // same name again, with whitespace

    const saved = getSavedProfiles();
    assert.strictEqual(saved.length, 1, 'no duplicate "Kitchen" entries were ever created');
    assert.strictEqual(saved.filter((p) => normalizeProfileName(p.name) === 'kitchen').length, 1);
  });

  it('rejects a non-temporary profile outright, same as promoteTemporaryProfile', () => {
    const notTemporary = { name: 'Kitchen', speakingDb: -28, spreadDb: 5, calibratedTs: 999 };
    assert.throws(() => commitSavePromptName(notTemporary, 'Kitchen'), /genuine temporary profile/);
    assert.strictEqual(getSavedProfiles().length, 0);
  });

  it('rejects an empty or whitespace-only name without touching storage', () => {
    assert.throws(() => commitSavePromptName(makeTemporary(), ''), /non-empty name/);
    assert.throws(() => commitSavePromptName(makeTemporary(), '   '), /non-empty name/);
    assert.strictEqual(getSavedProfiles().length, 0);
  });

  it('always re-reads real storage fresh by default — a profile added after an earlier preview still changes the outcome, guarding against a stale decision', () => {
    // Simulates the save prompt's own real call pattern: no savedProfiles
    // override is ever passed by mezzo-session.js, so every call — the live
    // "as you type" preview and the final commit alike — independently
    // re-reads getSavedProfiles() at the moment it runs, never trusting an
    // earlier call's result.
    const earlierPreview = resolveSavePromptAction('Kitchen');
    assert.strictEqual(earlierPreview.kind, SAVE_PROMPT_ACTIONS.CREATE, 'nothing named Kitchen exists yet');

    // The library changes in between (e.g. another tab, or the user
    // recalibrating a different row) — commitSavePromptName() must not
    // reuse the stale "create" decision computed above.
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));

    const { action, profile } = commitSavePromptName(makeTemporary(), 'Kitchen');
    assert.strictEqual(action, SAVE_PROMPT_ACTIONS.UPDATE, 'must re-resolve fresh at commit time, not reuse the earlier "create" preview');
    assert.strictEqual(getSavedProfiles().length, 1, 'must update the profile that now exists, not create a duplicate');
    assert.strictEqual(profile.name, 'Kitchen');
  });

  it('the updated profile\'s calibratedTs reflects the new calibration, not the original', () => {
    const original = addSavedProfile(makeCalibration({ name: 'Kitchen', calibratedTs: 1000 }));
    const temp = makeTemporary({ calibratedTs: 5000 });

    const { profile } = commitSavePromptName(temp, 'Kitchen');

    assert.strictEqual(profile.calibratedTs, 5000);
    assert.notStrictEqual(profile.calibratedTs, original.calibratedTs, 'the timestamp must actually change on update, not just the speaking values');
  });
});

// =============================================================================
// commitSavePromptName's update path, end to end at the storage layer —
// mirrors the exact sequence src/mezzo-session.js's handleM2Submit() (the
// Ready-screen M2/M2a "Save profile" naming state) runs on success
// (commitSavePromptName -> setSelectedProfile -> setLastUsedProfile),
// without needing a real Document Picture-in-Picture window. Covers: the
// selected/last-used profile ends up being the updated saved profile (never
// a temporary one), no temporary profile is left behind in either storage
// layer, and a simulated "reopen" (resolveActiveProfile()) resolves straight
// to the updated profile.
// =============================================================================

describe('commitSavePromptName update path — selection/last-used/reopen integration', () => {
  it('after an update, the selected profile is the updated saved profile — same id, refreshed calibration', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen', speakingDb: -30, calibratedTs: 1 }));
    const temp = makeTemporary({ speakingDb: -18, spreadDb: 7, calibratedTs: 8000 });

    const { profile } = commitSavePromptName(temp, 'Kitchen');
    setSelectedProfile(profile);
    setLastUsedProfile(profile);

    const selected = getSelectedProfile();
    assert.strictEqual(selected.id, kitchen.id);
    assert.strictEqual(selected.speakingDb, -18);
    assert.strictEqual(selected.calibratedTs, 8000);
    assert.strictEqual(selected.temporary, undefined, 'the selected profile must never carry a temporary flag after an update commit');
  });

  it('no temporary profile remains in selected-profile or last-used-profile storage after an update commit', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    // Simulate the temporary profile having been the active/selected one
    // while monitoring, exactly as it would be mid-session.
    setSelectedProfile(makeTemporary());

    const { profile } = commitSavePromptName(makeTemporary({ speakingDb: -22 }), 'Kitchen');
    setSelectedProfile(profile);
    setLastUsedProfile(profile);

    assert.strictEqual(getSelectedProfile().temporary, undefined);
    assert.strictEqual(getLastUsedProfile().temporary, undefined);
    assert.strictEqual(getSelectedProfile().id, getLastUsedProfile().id, 'selected and last-used must agree on the same real profile');
  });

  it('reopening (resolveActiveProfile) resolves straight to the updated saved profile, not a stale or temporary one', () => {
    const kitchen = addSavedProfile(makeCalibration({ name: 'Kitchen', speakingDb: -30, calibratedTs: 1 }));
    const temp = makeTemporary({ speakingDb: -15, spreadDb: 8, calibratedTs: 9999 });

    const { profile } = commitSavePromptName(temp, 'Kitchen');
    setSelectedProfile(profile);
    setLastUsedProfile(profile);

    // "Reopen" — resolveActiveProfile() is exactly what startMonitoring()
    // calls on every Companion open.
    const resolved = resolveActiveProfile();
    assert.strictEqual(resolved.id, kitchen.id);
    assert.strictEqual(resolved.speakingDb, -15);
    assert.strictEqual(resolved.calibratedTs, 9999);
    assert.strictEqual(resolved.temporary, undefined);
  });

  it('the saved-profile count is unchanged by an update commit, before and after selection/last-used are set', () => {
    addSavedProfile(makeCalibration({ name: 'Home Office' }));
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    addSavedProfile(makeCalibration({ name: 'Coffee Shop' }));
    assert.strictEqual(getSavedProfiles().length, 3);

    const { profile } = commitSavePromptName(makeTemporary(), 'Kitchen');
    setSelectedProfile(profile);
    setLastUsedProfile(profile);

    assert.strictEqual(getSavedProfiles().length, 3, 'updating must never change the saved-profile count');
    assert.deepStrictEqual(
      getSavedProfiles().map((p) => p.name).sort(),
      ['Coffee Shop', 'Home Office', 'Kitchen']
    );
  });
});

// =============================================================================
// saveSavedProfiles sanitization
// =============================================================================

describe('saveSavedProfiles', () => {
  it('strips a temporary flag from any profile passed to it directly', () => {
    saveSavedProfiles([{ id: '1', name: 'X', speakingDb: -30, spreadDb: 4, calibratedTs: 1, temporary: true }]);
    assert.strictEqual(getSavedProfiles()[0].temporary, undefined);
  });

  it('leaves every other field untouched while stripping temporary', () => {
    saveSavedProfiles([{ id: '1', name: 'X', speakingDb: -30, spreadDb: 4, calibratedTs: 1, temporary: true }]);
    const saved = getSavedProfiles()[0];
    assert.strictEqual(saved.id, '1');
    assert.strictEqual(saved.name, 'X');
    assert.strictEqual(saved.speakingDb, -30);
    assert.strictEqual(saved.spreadDb, 4);
    assert.strictEqual(saved.calibratedTs, 1);
  });

  it('returns true on a successful write', () => {
    assert.strictEqual(saveSavedProfiles([]), true);
  });

  it('returns false, without throwing, when storage access throws', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: real.getItem.bind(real),
      setItem: () => { throw new Error('storage unavailable'); },
      removeItem: real.removeItem.bind(real),
      clear: real.clear.bind(real),
    };
    try {
      assert.doesNotThrow(() => {
        const result = saveSavedProfiles([{ id: '1', name: 'X', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }]);
        assert.strictEqual(result, false);
      });
    } finally {
      globalThis.localStorage = real;
    }
  });
});

// =============================================================================
// deleteSavedProfile — Batch 1: the one dedicated persistence function for
// removal, reporting real success/failure rather than assuming success (the
// confirmed root cause of deletion being able to leave the Companion's
// delete screen stuck on "Deleting…" indefinitely).
// =============================================================================

describe('deleteSavedProfile', () => {
  it('removes the matching profile and persists the result', () => {
    const [kitchen, office] = fillLibrary(2);
    const result = deleteSavedProfile(kitchen.id);
    assert.strictEqual(result.removed, true);
    assert.strictEqual(result.error, null);
    assert.deepStrictEqual(result.remaining.map((p) => p.id), [office.id]);
    assert.deepStrictEqual(getSavedProfiles().map((p) => p.id), [office.id]);
  });

  it('preserves the order of every profile it does not remove', () => {
    const [a, b, c] = fillLibrary(3);
    deleteSavedProfile(b.id);
    assert.deepStrictEqual(getSavedProfiles().map((p) => p.id), [a.id, c.id]);
  });

  it('leaves storage untouched and reports PROFILE_MISSING for an id that is not present', () => {
    const [kitchen] = fillLibrary(1);
    const result = deleteSavedProfile('not-a-real-id');
    assert.strictEqual(result.removed, false);
    assert.strictEqual(result.error.code, 'PROFILE_MISSING');
    assert.deepStrictEqual(getSavedProfiles().map((p) => p.id), [kitchen.id]);
  });

  it('leaves the profile in storage and reports PERSIST_FAILED when the write fails', () => {
    const [kitchen] = fillLibrary(1);
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: real.getItem.bind(real),
      setItem: () => { throw new Error('storage unavailable'); },
      removeItem: real.removeItem.bind(real),
      clear: real.clear.bind(real),
    };
    try {
      const result = deleteSavedProfile(kitchen.id);
      assert.strictEqual(result.removed, false);
      assert.strictEqual(result.error.code, 'PERSIST_FAILED');
      assert.strictEqual(result.error.message, "We couldn't delete this profile. Try again.");
    } finally {
      globalThis.localStorage = real;
    }
    // The profile must still be there once real storage is restored — a
    // failed delete must never have removed it.
    assert.deepStrictEqual(getSavedProfiles().map((p) => p.id), [kitchen.id]);
  });

  it('does not throw for an unexpected id shape', () => {
    fillLibrary(1);
    assert.doesNotThrow(() => deleteSavedProfile(undefined));
  });
});

// =============================================================================
// setLastUsedProfile — the temporary guard
// =============================================================================

describe('setLastUsedProfile', () => {
  it('persists a normal, non-temporary profile', () => {
    const profile = { id: '1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    setLastUsedProfile(profile);
    assert.deepStrictEqual(getLastUsedProfile(), profile);
  });

  it('refuses to persist a temporary calibration', () => {
    const temp = { name: 'Current speaking range', speakingDb: -30, spreadDb: 4, calibratedTs: 1, savedProfileId: null, temporary: true };
    setLastUsedProfile(temp);
    assert.strictEqual(getLastUsedProfile(), null, 'storage must remain empty — no last-used profile at all is correct here');
  });

  it('does not clobber a previously-persisted real profile with a later temporary attempt', () => {
    const real = { id: '1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    setLastUsedProfile(real);

    const temp = { name: 'Current speaking range', speakingDb: -20, spreadDb: 3, calibratedTs: 2, savedProfileId: null, temporary: true };
    setLastUsedProfile(temp);

    assert.deepStrictEqual(getLastUsedProfile(), real, 'the temporary attempt must be a pure no-op, not a partial or failed overwrite');
  });
});

// =============================================================================
// clearLastUsedProfile — deletion safety: no stored reference should ever
// point at a missing profile
// =============================================================================

describe('clearLastUsedProfile', () => {
  it('removes a previously-persisted last-used profile', () => {
    setLastUsedProfile({ id: '1', name: 'Kitchen', speakingDb: -30, spreadDb: 4, calibratedTs: 1 });
    clearLastUsedProfile();
    assert.strictEqual(getLastUsedProfile(), null);
  });

  it('is a safe no-op when nothing was ever persisted', () => {
    assert.doesNotThrow(() => clearLastUsedProfile());
    assert.strictEqual(getLastUsedProfile(), null);
  });
});

// =============================================================================
// resolveActiveProfile — cross-tier fallback, still correct with the new fields
// =============================================================================

describe('resolveActiveProfile', () => {
  it('prefers this tab\'s own selected profile over last-used', () => {
    const selected = { id: '1', name: 'Selected', speakingDb: -30, spreadDb: 4, calibratedTs: 1 };
    const lastUsed = { id: '2', name: 'LastUsed', speakingDb: -25, spreadDb: 3, calibratedTs: 2 };
    setSelectedProfile(selected);
    setLastUsedProfile(lastUsed);

    assert.deepStrictEqual(resolveActiveProfile(), selected);
  });

  it('falls back to last-used when nothing is selected in this tab, and adopts it as selected', () => {
    const lastUsed = { id: '2', name: 'LastUsed', speakingDb: -25, spreadDb: 3, calibratedTs: 2 };
    setLastUsedProfile(lastUsed);

    assert.deepStrictEqual(resolveActiveProfile(), lastUsed);
    assert.deepStrictEqual(getSelectedProfile(), lastUsed, 'should keep this tab consistent going forward');
  });

  it('a temporary calibration selected in this tab is still returned — resolveActiveProfile does not filter it out', () => {
    const temp = { name: 'Current speaking range', speakingDb: -20, spreadDb: 3, calibratedTs: 2, savedProfileId: null, temporary: true };
    setSelectedProfile(temp);
    assert.deepStrictEqual(resolveActiveProfile(), temp);
  });

  it('returns null when nothing is selected or last-used anywhere', () => {
    assert.strictEqual(resolveActiveProfile(), null);
  });
});

// =============================================================================
// getHasStartedMonitoring / setHasStartedMonitoring — the Ready-screen PRD's
// first-conversation flag. Storage-only at this phase: not yet called from
// beginMonitoringSession() (src/mezzo-session.js), so these tests exercise
// the two functions directly rather than through any monitoring flow.
// =============================================================================

describe('getHasStartedMonitoring / setHasStartedMonitoring', () => {
  it('returns false when nothing has been stored yet', () => {
    assert.strictEqual(getHasStartedMonitoring(), false);
  });

  it('setHasStartedMonitoring() persists the flag, read back as true', () => {
    setHasStartedMonitoring();
    assert.strictEqual(getHasStartedMonitoring(), true);
  });

  it('a previously-set flag still reads true on a later, independent call', () => {
    setHasStartedMonitoring();
    // Two independent reads — getHasStartedMonitoring() has no in-memory
    // cache, so this also guards against a future accidental one.
    assert.strictEqual(getHasStartedMonitoring(), true);
    assert.strictEqual(getHasStartedMonitoring(), true);
  });

  it('getHasStartedMonitoring() fails safe (returns false, does not throw) when storage access throws', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: real.setItem.bind(real),
      removeItem: real.removeItem.bind(real),
      clear: real.clear.bind(real),
    };
    try {
      assert.doesNotThrow(() => getHasStartedMonitoring());
      assert.strictEqual(getHasStartedMonitoring(), false);
    } finally {
      globalThis.localStorage = real;
    }
  });

  it('setHasStartedMonitoring() fails safe (does not throw) when storage access throws', () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: real.getItem.bind(real),
      setItem: () => { throw new Error('storage unavailable'); },
      removeItem: real.removeItem.bind(real),
      clear: real.clear.bind(real),
    };
    try {
      assert.doesNotThrow(() => setHasStartedMonitoring());
    } finally {
      globalThis.localStorage = real;
    }
  });
});

// =============================================================================
// Peak and room noise (2026-10-22), and profiles saved before them
// =============================================================================

describe('calibration peak and room noise are saved with a profile', () => {
  it('addSavedProfile, promoteTemporaryProfile, and updateSavedProfile keep peakDb and roomNoiseDb', () => {
    const added = addSavedProfile(makeCalibration({ peakDb: 2.4, roomNoiseDb: -48.9 }));
    assert.strictEqual(added.peakDb, 2.4);
    assert.strictEqual(added.roomNoiseDb, -48.9);

    const temp = { ...makeCalibration({ peakDb: 3, roomNoiseDb: -50 }), temporary: true, savedProfileId: null };
    const { profile } = promoteTemporaryProfile(temp, 'Office');
    assert.strictEqual(profile.peakDb, 3);
    assert.strictEqual(profile.roomNoiseDb, -50);
    assert.ok(!('temporary' in profile));

    const updated = updateSavedProfile(added.id, { speakingDb: -31, spreadDb: 3, calibratedTs: 2, peakDb: 1.8, roomNoiseDb: -55 });
    assert.strictEqual(updated.peakDb, 1.8);
    assert.strictEqual(updated.roomNoiseDb, -55);
  });

  it('a recalibration without a room reading replaces the old one rather than keeping a stale room', () => {
    const added = addSavedProfile(makeCalibration({ peakDb: 2, roomNoiseDb: -40 }));
    const updated = updateSavedProfile(added.id, { speakingDb: -31, spreadDb: 3, calibratedTs: 2, peakDb: 2.2, roomNoiseDb: null });
    assert.strictEqual(updated.peakDb, 2.2);
    assert.ok(!('roomNoiseDb' in updated));
  });

  it('a save-by-matching-name (Update) carries them too', () => {
    addSavedProfile(makeCalibration({ name: 'Kitchen' }));
    const temp = { ...makeCalibration({ peakDb: 2.5, roomNoiseDb: -45 }), temporary: true, savedProfileId: null };
    const { profile } = commitSavePromptName(temp, 'kitchen');
    assert.strictEqual(profile.peakDb, 2.5);
    assert.strictEqual(profile.roomNoiseDb, -45);
  });
});

describe('migration: profiles saved before the sound filter', () => {
  it('a profile without a calibration peak needs recalibration; one with it does not', () => {
    assert.strictEqual(needsRecalibration({ id: 'a', name: 'Old', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }), true);
    assert.strictEqual(needsRecalibration({ id: 'b', name: 'New', speakingDb: -30, spreadDb: 4, calibratedTs: 1, peakDb: 2 }), false);
    // Room noise can be missing on a new profile (nothing measured); the peak decides.
    assert.strictEqual(needsRecalibration({ id: 'c', name: 'New', speakingDb: -30, spreadDb: 4, calibratedTs: 1, peakDb: 2, roomNoiseDb: undefined }), false);
    assert.strictEqual(needsRecalibration(null), false);
  });

  it('old profiles are kept as they are: nothing is deleted or rewritten on read', () => {
    const old = [{ id: 'a', name: 'Old', speakingDb: -30, spreadDb: 4, calibratedTs: 1 }];
    localStorage.setItem('mezzoProfiles', JSON.stringify(old));
    assert.deepStrictEqual(getSavedProfiles(), old);
    assert.deepStrictEqual(JSON.parse(localStorage.getItem('mezzoProfiles')), old);
  });
});
