/**
 * Round 4 study mode (src/study.js, src/study-config.js): the tester code,
 * the glow count, when the check-in card shows, and the form links.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STUDY_CONFIG } from './study-config.js';
import {
  applyStudyParam,
  getTesterCode,
  getBrowserId,
  createGlowCounter,
  saveLastSession,
  getLastSession,
  markCheckInHandled,
  shouldShowCheckInCard,
  isWithinCheckInWindow,
  checkInExpiresAt,
  buildCheckInUrl,
  buildWrapUpUrl,
  formatSessionDate,
  sessionMinutes,
} from './study.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const KEYS = STUDY_CONFIG.storageKeys;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function withCode(code = 'R4-01') {
  const storage = memoryStorage();
  applyStudyParam(`?study=${code}`, storage);
  return storage;
}

function session({ startedAt = Date.UTC(2026, 10, 9, 15), minutes = 30, glows = 2 } = {}) {
  return { id: String(startedAt), startedAt, endedAt: startedAt + minutes * MIN, glows };
}

describe('config', () => {
  it('holds both forms, the window, the minimum and every parameter name', () => {
    assert.equal(STUDY_CONFIG.checkInFormUrl, 'https://tally.so/r/gber54');
    assert.equal(STUDY_CONFIG.wrapUpFormUrl, 'https://tally.so/r/q5alaO');
    assert.equal(STUDY_CONFIG.checkInWindowMs, 2 * HOUR);
    assert.equal(STUDY_CONFIG.minSessionMs, 5 * MIN);
    assert.deepEqual(STUDY_CONFIG.params, {
      tester: 'mezzo_tester',
      browserId: 'mezzo_browser_id',
      source: 'mezzo_source',
      sessionDate: 'mezzo_session_date',
      sessionMinutes: 'mezzo_session_minutes',
      glows: 'mezzo_glows',
      minutesAfter: 'mezzo_minutes_after',
    });
    assert.deepEqual(STUDY_CONFIG.sources, { companion: 'companion', studyPage: 'study_page' });
  });

  it('the browser ID is the existing analytics ID', () => {
    assert.equal(KEYS.browserId, 'mezzo_anonymous_id');
  });
});

describe('tester code', () => {
  it('?study=CODE saves it', () => {
    const storage = memoryStorage();
    assert.equal(applyStudyParam('?study=R4-01', storage), 'saved');
    assert.equal(getTesterCode(storage), 'R4-01');
  });

  it('?study=clear removes the code and the last session, not the browser ID', () => {
    const storage = withCode();
    storage.setItem(KEYS.browserId, 'browser-1');
    saveLastSession(session(), storage);
    assert.equal(applyStudyParam('?study=clear', storage), 'cleared');
    assert.equal(getTesterCode(storage), null);
    assert.equal(getLastSession(storage), null);
    assert.equal(storage.getItem(KEYS.browserId), 'browser-1');
  });

  it('no parameter leaves the code alone; a bad one is rejected without overwriting', () => {
    const storage = withCode();
    assert.equal(applyStudyParam('', storage), 'none');
    assert.equal(applyStudyParam('?study=%3Cb%3E', storage), 'invalid');
    assert.equal(applyStudyParam(`?study=${'a'.repeat(65)}`, storage), 'invalid');
    assert.equal(getTesterCode(storage), 'R4-01');
  });
});

describe('browser ID', () => {
  it('reuses the existing anonymous ID', () => {
    const storage = memoryStorage();
    storage.setItem(KEYS.browserId, 'existing-id');
    assert.equal(getBrowserId(storage, () => 'new-id'), 'existing-id');
  });

  it('makes one, once, under the analytics key if there is none', () => {
    const storage = memoryStorage();
    let calls = 0;
    const make = () => `id-${++calls}`;
    assert.equal(getBrowserId(storage, make), 'id-1');
    assert.equal(getBrowserId(storage, make), 'id-1');
    assert.equal(storage.getItem(KEYS.browserId), 'id-1');
  });
});

describe('glow counter', () => {
  function clock(t = 1000) {
    return { now: () => t, advance: (ms) => { t += ms; } };
  }

  it('counts once per glow, not per frame', () => {
    const c = createGlowCounter();
    c.start();
    for (const zone of [0, 1, 2, 3, 3, 3, 3, 2, 3, 3, 1, 0, 3]) c.onZone(zone);
    assert.equal(c.glows, 3);
  });

  it('resets each session and reports its start, end and length', () => {
    const t = clock();
    const c = createGlowCounter({ now: t.now });
    c.start();
    c.onZone(3); c.onZone(2); c.onZone(3);
    t.advance(6 * MIN);
    assert.deepEqual(c.stop(), { id: '1000', startedAt: 1000, endedAt: 1000 + 6 * MIN, glows: 2 });

    c.start();
    assert.equal(c.glows, 0);
    c.onZone(3); // the new session's first glow counts again
    assert.equal(c.glows, 1);
  });

  it('continues an interrupted session when resumed', () => {
    const t = clock(5000);
    const c = createGlowCounter({ now: t.now });
    c.start({ startedAt: 1000, glows: 2 });
    c.onZone(3);
    t.advance(MIN);
    assert.deepEqual(c.stop(), { id: '1000', startedAt: 1000, endedAt: 5000 + MIN, glows: 3 });
  });

  it('ignores zones outside a session; stop() without start() is null', () => {
    const c = createGlowCounter();
    c.onZone(3);
    assert.equal(c.stop(), null);
    assert.equal(c.glows, 0);
  });
});

describe('last session', () => {
  it('is kept only while a tester code is saved', () => {
    const none = memoryStorage();
    assert.equal(saveLastSession(session(), none), null);
    assert.equal(getLastSession(none), null);

    const storage = withCode();
    saveLastSession(session(), storage);
    assert.equal(getLastSession(storage).glows, 2);
  });

  it('a new session replaces the previous one', () => {
    const storage = withCode();
    saveLastSession(session({ glows: 1 }), storage);
    saveLastSession(session({ startedAt: Date.UTC(2026, 10, 9, 17), glows: 4 }), storage);
    assert.equal(getLastSession(storage).glows, 4);
  });
});

describe('check-in card', () => {
  const s = session({ minutes: 30 });

  it('never shows without a tester code', () => {
    assert.equal(shouldShowCheckInCard({ testerCode: null, session: s, now: s.endedAt + MIN }), false);
  });

  it('shows after a session of 5 minutes or more', () => {
    const fiveMin = session({ minutes: 5 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: s, now: s.endedAt }), true);
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: fiveMin, now: fiveMin.endedAt }), true);
  });

  it('not after a shorter session', () => {
    const short = session({ minutes: 4.9 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: short, now: short.endedAt }), false);
  });

  it('not once 2 hours have passed since the session ended', () => {
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: s, now: s.endedAt + 2 * HOUR - 1 }), true);
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: s, now: s.endedAt + 2 * HOUR }), false);
    assert.equal(checkInExpiresAt(s), s.endedAt + 2 * HOUR);
  });

  it('only once per session: opened or skipped, it stays gone', () => {
    for (const how of ['opened', 'skipped']) {
      const storage = withCode();
      saveLastSession(s, storage);
      assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: getLastSession(storage), now: s.endedAt }), true);
      assert.equal(markCheckInHandled(s.id, how, storage), true);
      assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: getLastSession(storage), now: s.endedAt }), false);
    }
  });

  it('marking a different session changes nothing', () => {
    const storage = withCode();
    saveLastSession(s, storage);
    assert.equal(markCheckInHandled('other', 'skipped', storage), false);
    assert.equal(getLastSession(storage).handled, undefined);
  });

  it('the window check used by /study', () => {
    assert.equal(isWithinCheckInWindow(s, s.endedAt + 119 * MIN), true);
    assert.equal(isWithinCheckInWindow(s, s.endedAt + 120 * MIN), false);
    assert.equal(isWithinCheckInWindow(null, s.endedAt), false);
  });
});

describe('form links', () => {
  it('the Companion check-in carries every parameter, encoded', () => {
    const s = session({ minutes: 12.5, glows: 3 });
    const href = buildCheckInUrl({
      testerCode: 'R4-01',
      browserId: 'id with space&amp',
      source: 'companion',
      session: s,
      now: s.endedAt + 17.4 * MIN,
    });
    const url = new URL(href);
    assert.equal(url.origin + url.pathname, 'https://tally.so/r/gber54');
    assert.deepEqual([...url.searchParams.keys()], [
      'mezzo_tester', 'mezzo_browser_id', 'mezzo_source',
      'mezzo_session_date', 'mezzo_session_minutes', 'mezzo_glows', 'mezzo_minutes_after',
    ]);
    assert.equal(url.searchParams.get('mezzo_tester'), 'R4-01');
    assert.equal(url.searchParams.get('mezzo_browser_id'), 'id with space&amp');
    assert.match(href, /mezzo_browser_id=id\+with\+space%26amp&/); // encoded in the URL itself
    assert.equal(url.searchParams.get('mezzo_source'), 'companion');
    assert.equal(url.searchParams.get('mezzo_session_date'), formatSessionDate(new Date(s.startedAt)));
    assert.equal(url.searchParams.get('mezzo_session_minutes'), '12.5');
    assert.equal(url.searchParams.get('mezzo_glows'), '3');
    assert.equal(url.searchParams.get('mezzo_minutes_after'), '17');
  });

  it('without a recent session, only the tester code and browser ID (and source)', () => {
    const url = new URL(buildCheckInUrl({ testerCode: 'R4-01', browserId: 'b-1', source: 'study_page', session: null }));
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      mezzo_tester: 'R4-01',
      mezzo_browser_id: 'b-1',
      mezzo_source: 'study_page',
    });
  });

  it('wrap-up carries only the tester code', () => {
    const url = new URL(buildWrapUpUrl({ testerCode: 'R4-01' }));
    assert.equal(url.origin + url.pathname, 'https://tally.so/r/q5alaO');
    assert.deepEqual(Object.fromEntries(url.searchParams), { mezzo_tester: 'R4-01' });
  });

  it('no tester code, no link', () => {
    assert.equal(buildCheckInUrl({ testerCode: null, browserId: 'b', source: 'companion' }), null);
    assert.equal(buildWrapUpUrl({ testerCode: '' }), null);
  });

  it('dates are local YYYY-MM-DD; minutes have one decimal', () => {
    assert.equal(formatSessionDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(sessionMinutes(40 * 1000), 0.7);
    assert.equal(sessionMinutes(0), 0);
  });
});
