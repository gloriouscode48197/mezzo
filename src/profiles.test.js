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
  addSavedProfile,
  updateSavedProfile,
  promoteTemporaryProfile,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  setLastUsedProfile,
  clearLastUsedProfile,
  resolveActiveProfile,
  MAX_SAVED_PROFILES,
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
// promoteTemporaryProfile — the shared Stop-time-save / pre-monitoring-save operation
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
