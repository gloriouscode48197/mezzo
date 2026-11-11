/**
 * Round 4 study mode (src/study.js, src/study-config.js): the tester code,
 * the glow count, when the check-in card shows, and the form links.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STUDY_CONFIG } from './study-config.js';
import {
  applyStudyParam,
  applyStartParam,
  clearStudy,
  codeBoundKey,
  getMezzoStageUnlockedAt,
  getMezzoStageStartAt,
  sessionSpeechMs,
  MAX_SPEECH_FRAME_MS,
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
  getFirstSessionAt,
  studyStage,
  wrapUpOpensAt,
  isWrapUpOpen,
  formatLongDate,
  isFormUrlReady,
  buildBaselineUrl,
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
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

function withCode(code = 'R4-01') {
  const storage = memoryStorage();
  applyStudyParam(`?study=${code}`, storage);
  return storage;
}

function session({ startedAt = Date.UTC(2026, 10, 9, 15), minutes = 30, glows = 2, speechMinutes = 5 } = {}) {
  const s = { id: String(startedAt), startedAt, endedAt: startedAt + minutes * MIN, glows };
  if (speechMinutes !== null) s.speechMs = speechMinutes * MIN;
  return s;
}

describe('config', () => {
  it('holds the forms, the window, the minimums and every parameter name', () => {
    assert.equal(STUDY_CONFIG.checkInFormUrl, 'https://tally.so/r/gber54');
    assert.equal(STUDY_CONFIG.wrapUpFormUrl, 'https://tally.so/r/q5alaO');
    assert.equal(STUDY_CONFIG.checkInWindowMs, 2 * HOUR);
    assert.equal(STUDY_CONFIG.minSessionMs, 5 * MIN);
    assert.equal(STUDY_CONFIG.minSpeechMs, 1 * MIN);
    assert.equal(STUDY_CONFIG.startParam, 'start');
    assert.equal(STUDY_CONFIG.startValue, '1');
    assert.deepEqual(STUDY_CONFIG.params, {
      tester: 'mezzo_tester',
      browserId: 'mezzo_browser_id',
      source: 'mezzo_source',
      sessionDate: 'mezzo_session_date',
      sessionMinutes: 'mezzo_session_minutes',
      speechMinutes: 'mezzo_speech_minutes',
      glows: 'mezzo_glows',
      minutesAfter: 'mezzo_minutes_after',
    });
    assert.deepEqual(STUDY_CONFIG.sources, { companion: 'companion', studyPage: 'study_page', companionClosed: 'companion_closed' });
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
    assert.deepEqual(c.stop(), { id: '1000', startedAt: 1000, endedAt: 1000 + 6 * MIN, glows: 2, speechMs: 0 });

    c.start();
    assert.equal(c.glows, 0);
    c.onZone(3); // the new session's first glow counts again
    assert.equal(c.glows, 1);
  });

  it('continues an interrupted session when resumed', () => {
    const t = clock(5000);
    const c = createGlowCounter({ now: t.now });
    c.start({ startedAt: 1000, glows: 2, speechMs: 90 * 1000 });
    c.onZone(3);
    c.onFrame(true, 0);
    c.onFrame(true, 50);
    t.advance(MIN);
    assert.deepEqual(c.stop(), { id: '1000', startedAt: 1000, endedAt: 5000 + MIN, glows: 3, speechMs: 90 * 1000 + 50 });
  });

  it('speaking time: the time between frames the gate counted as voice', () => {
    const c = createGlowCounter();
    c.start();
    // 50ms frames: 3 voiced intervals, then 2 silent ones, then 1 voiced.
    const frames = [[0, true], [50, true], [100, true], [150, true], [200, false], [250, false], [300, true]];
    for (const [at, voiced] of frames) c.onFrame(voiced, at);
    assert.equal(c.speechMs, 200); // 50→150 (3 × 50) + 300 (50)
  });

  it('speaking time: a long pause between frames counts at most a second', () => {
    const c = createGlowCounter();
    c.start();
    c.onFrame(true, 0);
    c.onFrame(true, 60 * 1000); // a sleeping laptop
    assert.equal(c.speechMs, MAX_SPEECH_FRAME_MS);
    c.onFrame(true, 60 * 1000 + 1000); // a background tab's 1s timer
    assert.equal(c.speechMs, 2 * MAX_SPEECH_FRAME_MS);
  });

  it('speaking time: a new session starts at zero, and frames outside a session are ignored', () => {
    const c = createGlowCounter();
    c.onFrame(true, 0);
    c.onFrame(true, 50);
    c.start();
    assert.equal(c.speechMs, 0);
    c.onFrame(true, 100); // the first frame of a session has no interval yet
    assert.equal(c.speechMs, 0);
    c.onFrame(true, 150);
    assert.equal(c.speechMs, 50);
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

  it('keeps the speaking time', () => {
    const storage = withCode();
    saveLastSession(session({ speechMinutes: 2.5 }), storage);
    assert.equal(getLastSession(storage).speechMs, 2.5 * MIN);
  });

  it('the same session saved again (Reopen, then Stop) keeps its check-in answer; a new session does not', () => {
    const storage = withCode();
    const s = session({ minutes: 10 });
    saveLastSession(s, storage);
    markCheckInHandled(s.id, 'skipped', storage);
    saveLastSession({ ...s, endedAt: s.endedAt + 5 * MIN, glows: 5 }, storage);
    assert.equal(getLastSession(storage).handled, 'skipped');
    assert.equal(getLastSession(storage).glows, 5);
    saveLastSession(session({ startedAt: s.startedAt + HOUR }), storage);
    assert.equal(getLastSession(storage).handled, undefined);
  });

  it('rejects a stored speaking time that is not a number', () => {
    const storage = withCode();
    saveLastSession(session(), storage);
    const key = codeBoundKey('lastSession', storage);
    const raw = JSON.parse(storage.getItem(key));
    storage.setItem(key, JSON.stringify({ ...raw, speechMs: 'lots' }));
    assert.equal(getLastSession(storage), null);
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

  it('not with under 1 minute of speech, however long the session', () => {
    const quiet = session({ minutes: 45, speechMinutes: 0.99 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: quiet, now: quiet.endedAt }), false);
    const enough = session({ minutes: 45, speechMinutes: 1 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: enough, now: enough.endedAt }), true);
    // Saved before speaking time was tracked: no speech on record.
    const old = session({ minutes: 45, speechMinutes: null });
    assert.equal(sessionSpeechMs(old), 0);
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: old, now: old.endedAt }), false);
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
    const s = { ...session({ minutes: 12.5, glows: 3 }), speechMs: 4 * MIN + 20 * 1000 };
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
      'mezzo_session_date', 'mezzo_session_minutes', 'mezzo_speech_minutes', 'mezzo_glows', 'mezzo_minutes_after',
    ]);
    assert.equal(url.searchParams.get('mezzo_tester'), 'R4-01');
    assert.equal(url.searchParams.get('mezzo_browser_id'), 'id with space&amp');
    assert.match(href, /mezzo_browser_id=id\+with\+space%26amp&/); // encoded in the URL itself
    assert.equal(url.searchParams.get('mezzo_source'), 'companion');
    assert.equal(url.searchParams.get('mezzo_session_date'), formatSessionDate(new Date(s.startedAt)));
    assert.equal(url.searchParams.get('mezzo_session_minutes'), '12.5');
    assert.equal(url.searchParams.get('mezzo_speech_minutes'), '4.3'); // one decimal
    assert.equal(url.searchParams.get('mezzo_glows'), '3');
    assert.equal(url.searchParams.get('mezzo_minutes_after'), '17');
  });

  it('a session saved before speaking time was tracked has no mezzo_speech_minutes', () => {
    const s = session({ speechMinutes: null });
    const url = new URL(buildCheckInUrl({ testerCode: 'R4-01', browserId: 'b', source: 'companion', session: s, now: s.endedAt }));
    assert.equal(url.searchParams.has('mezzo_speech_minutes'), false);
    assert.equal(url.searchParams.get('mezzo_session_minutes'), '30');
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

describe('study stages', () => {
  it('no code: none; a code before the With Mezzo stage: baseline; after it began: mezzo', () => {
    assert.equal(studyStage({ testerCode: null, mezzoStageStartAt: null }), 'none');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: null }), 'baseline');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: Date.now() }), 'mezzo');
  });

  it('?start=1 with a code unlocks the With Mezzo stage once, before any session', () => {
    const storage = withCode();
    assert.equal(getMezzoStageStartAt(storage), null);
    assert.equal(applyStartParam('?start=1', storage, STUDY_CONFIG, 5000), 'started');
    assert.equal(getMezzoStageUnlockedAt(storage), 5000);
    assert.equal(getMezzoStageStartAt(storage), 5000);
    assert.equal(applyStartParam('?start=1', storage, STUDY_CONFIG, 9000), 'already');
    assert.equal(getMezzoStageUnlockedAt(storage), 5000);
  });

  it('?start=1 needs a code; other values do nothing', () => {
    assert.equal(applyStartParam('?start=1', memoryStorage()), 'no-code');
    const storage = withCode();
    assert.equal(applyStartParam('?start=0', storage), 'none');
    assert.equal(applyStartParam('', storage), 'none');
    assert.equal(getMezzoStageUnlockedAt(storage), null);
  });

  it('the With Mezzo stage begins at the earlier of the unlock and the first session', () => {
    const storage = withCode();
    saveLastSession(session({ startedAt: 8000 }), storage);
    assert.equal(getMezzoStageStartAt(storage), 8000);
    applyStartParam('?start=1', storage, STUDY_CONFIG, 3000);
    assert.equal(getMezzoStageStartAt(storage), 3000);
    const later = withCode();
    applyStartParam('?start=1', later, STUDY_CONFIG, 9000);
    saveLastSession(session({ startedAt: 12000 }), later);
    assert.equal(getMezzoStageStartAt(later), 9000);
  });

  it('the stage, first-session date and last session belong to the tester code: a new code starts at the baseline, and an earlier code finds its own again', () => {
    const storage = withCode('TEST-01');
    applyStartParam('?start=1', storage, STUDY_CONFIG, 3000);
    saveLastSession(session({ startedAt: 8000 }), storage);
    assert.equal(studyStage({ testerCode: getTesterCode(storage), mezzoStageStartAt: getMezzoStageStartAt(storage) }), 'mezzo');
    assert.equal(storage.getItem(`${KEYS.mezzoStage}:TEST-01`), '3000');

    applyStudyParam('?study=TEST-02', storage);
    assert.equal(getMezzoStageStartAt(storage), null);
    assert.equal(getFirstSessionAt(storage), null);
    assert.equal(getLastSession(storage), null);
    assert.equal(studyStage({ testerCode: getTesterCode(storage), mezzoStageStartAt: getMezzoStageStartAt(storage) }), 'baseline');

    // TEST-02's first session is its own, and doesn't touch TEST-01's.
    saveLastSession(session({ startedAt: 20000, glows: 7 }), storage);
    assert.equal(getFirstSessionAt(storage), 20000);

    applyStudyParam('?study=TEST-01', storage);
    assert.equal(getMezzoStageStartAt(storage), 3000);
    assert.equal(getFirstSessionAt(storage), 8000);
    assert.equal(getLastSession(storage).startedAt, 8000);
  });

  it('data saved before it was tied to the code (no code in its key) is ignored', () => {
    const storage = withCode('TEST-02');
    storage.setItem(KEYS.firstSession, '5000');
    storage.setItem(KEYS.mezzoStage, '5000');
    storage.setItem(KEYS.lastSession, JSON.stringify(session()));
    assert.equal(getMezzoStageStartAt(storage), null);
    assert.equal(getLastSession(storage), null);
  });

  it('?study=clear removes the code and every code\'s stage, first-session date and last session, old unkeyed copies too; the browser ID stays', () => {
    const storage = withCode('TEST-01');
    applyStartParam('?start=1', storage);
    saveLastSession(session(), storage);
    applyStudyParam('?study=TEST-02', storage);
    saveLastSession(session({ startedAt: 9000 }), storage);
    storage.setItem(KEYS.firstSession, '5000'); // an old, unkeyed copy
    storage.setItem(KEYS.browserId, 'browser-1');
    assert.equal(applyStudyParam('?study=clear', storage), 'cleared');
    const left = [...Array(storage.length).keys()].map((i) => storage.key(i));
    assert.deepEqual(left, [KEYS.browserId]);
    // Back with an old code: it starts over.
    applyStudyParam('?study=TEST-01', storage);
    assert.equal(getMezzoStageStartAt(storage), null);
    assert.equal(getLastSession(storage), null);
  });

  it('?study=clear removes the unlock too', () => {
    const storage = withCode();
    applyStartParam('?start=1', storage);
    clearStudy(storage);
    assert.equal(getMezzoStageUnlockedAt(storage), null);
  });

  it('the first session with a code saves its date, once; later sessions keep it', () => {
    const storage = withCode();
    assert.equal(getFirstSessionAt(storage), null);
    const first = session({ startedAt: Date.UTC(2026, 10, 9, 15) });
    saveLastSession(first, storage);
    assert.equal(getFirstSessionAt(storage), first.startedAt);
    saveLastSession(session({ startedAt: Date.UTC(2026, 10, 12, 15) }), storage);
    assert.equal(getFirstSessionAt(storage), first.startedAt);
  });

  it('no code, no first-session date', () => {
    const storage = memoryStorage();
    saveLastSession(session(), storage);
    assert.equal(getFirstSessionAt(storage), null);
  });

  it('?study=clear removes the first-session date too', () => {
    const storage = withCode();
    saveLastSession(session(), storage);
    applyStudyParam('?study=clear', storage);
    assert.equal(getFirstSessionAt(storage), null);
  });
});

describe('end of study', () => {
  const first = new Date(2026, 10, 9, 15, 30).getTime(); // Nov 9, local

  it('the wrap-up opens at the start of the local day 14 days after the first session', () => {
    assert.equal(wrapUpOpensAt(first), new Date(2026, 10, 23).getTime());
    assert.equal(formatLongDate(wrapUpOpensAt(first)), 'November 23, 2026');
    assert.equal(isWrapUpOpen(first, new Date(2026, 10, 22, 23, 59).getTime()), false);
    assert.equal(isWrapUpOpen(first, new Date(2026, 10, 23, 0, 0).getTime()), true);
    assert.equal(isWrapUpOpen(null, Date.now()), false);
  });

  it('after 14 days the check-in card stops, even for a fresh long session', () => {
    const late = session({ startedAt: new Date(2026, 10, 23, 10).getTime(), minutes: 30 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: late, now: late.endedAt, mezzoStageStartAt: first }), false);
    const inside = session({ startedAt: new Date(2026, 10, 22, 10).getTime(), minutes: 30 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: inside, now: inside.endedAt, mezzoStageStartAt: first }), true);
  });

  it('the tester code stays saved after the 14 days', () => {
    const storage = withCode();
    saveLastSession(session({ startedAt: first }), storage);
    assert.equal(isWrapUpOpen(getFirstSessionAt(storage), first + 30 * 24 * HOUR), true);
    assert.equal(getTesterCode(storage), 'R4-01');
  });
});

describe('baseline form', () => {
  it('is in the config, and its link carries only the tester code', () => {
    assert.match(STUDY_CONFIG.baselineFormUrl, /^https:\/\/tally\.so\/r\//);
    const config = { ...STUDY_CONFIG, baselineFormUrl: 'https://tally.so/r/base01' };
    const url = new URL(buildBaselineUrl({ testerCode: 'R4-01' }, config));
    assert.equal(url.origin + url.pathname, 'https://tally.so/r/base01');
    assert.deepEqual(Object.fromEntries(url.searchParams), { mezzo_tester: 'R4-01' });
  });

  it('no link while the ID is still the placeholder, or without a code', () => {
    assert.equal(isFormUrlReady('https://tally.so/r/[BASELINE ID]'), false);
    assert.equal(isFormUrlReady('https://tally.so/r/base01'), true);
    const placeholder = { ...STUDY_CONFIG, baselineFormUrl: 'https://tally.so/r/[BASELINE ID]' };
    assert.equal(buildBaselineUrl({ testerCode: 'R4-01' }, placeholder), null);
    assert.equal(buildBaselineUrl({ testerCode: null }, { ...STUDY_CONFIG, baselineFormUrl: 'https://tally.so/r/base01' }), null);
  });
});

describe('privacy page', () => {
  const html = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  const text = html.replace(/<[^>]+>/g, '');

  it('the anonymous ID is not shared with other websites, except a submitted study check-in, linked to Research participants', () => {
    assert.doesNotMatch(text, /not shared across websites/);
    assert.match(text, /is not shared with other websites, except in a study check-in you choose to submit/);
    assert.match(html, /<a href="#research-participants">Research participants<\/a>/);
  });

  it('no sale of data; third parties only for submitted check-ins through Tally', () => {
    assert.doesNotMatch(text, /No sale or sharing of data with third parties/);
    assert.match(text, /No sale of data\. Data is never shared with third parties, except study check-ins you choose to submit through the survey tool, Tally\./);
  });

  it('Research participants says check-ins are collected through Tally', () => {
    const section = html.slice(html.indexOf('id="research-participants"'), html.indexOf('id="what-mezzo-does-not-do"'));
    assert.match(section, /Check-ins are collected through Tally/);
  });
});
