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
  getBaselineChecks,
  setBaselineCheck,
  onCheckInChange,
  codeBoundKey,
  getMezzoStageUnlockedAt,
  getMezzoStageStartAt,
  sessionSpeechMs,
  MAX_SPEECH_FRAME_MS,
  getTesterCode,
  getBrowserId,
  createGlowCounter,
  mainView,
  saveLastSession,
  getLastSession,
  markCheckInHandled,
  shouldShowCheckInCard,
  isWithinCheckInWindow,
  checkInExpiresAt,
  buildCheckInUrl,
  formatSessionDate,
  sessionMinutes,
  getFirstSessionAt,
  studyStage,
  studyEndsAt,
  isStudyOver,
  formatLongDate,
  formatMonthDay,
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
  it('holds the forms, the window, the speech minimum and every parameter name', () => {
    assert.equal(STUDY_CONFIG.checkInFormUrl, 'https://tally.so/r/gber54');
    assert.equal('wrapUpFormUrl' in STUDY_CONFIG, false); // emailed, not linked from Mezzo
    assert.equal(STUDY_CONFIG.checkInWindowMs, 2 * HOUR);
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
      view: 'mezzo_view',
      windowSize: 'mezzo_window',
      minutesAfter: 'mezzo_minutes_after',
    });
    assert.deepEqual(STUDY_CONFIG.sources, {
      companion: 'companion', studyPage: 'study_page', companionClosed: 'companion_closed', companionOpen: 'companion_open', home: 'home',
    });
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

describe('Companion view and window size (mezzo_view, mezzo_window)', () => {
  it('counts the time in each view at each window size, between frames, capped like speaking time', () => {
    let t = 0;
    const c = createGlowCounter({ now: () => t });
    c.start();
    const compact = { name: 'Compact', width: 240, height: 186 };
    const mini = { name: 'Mini', width: 280, height: 110 };
    c.onFrame(false, 0, compact);
    c.onFrame(false, 400, compact);   // 400ms Compact
    c.onFrame(true, 700, mini);       // 300ms Mini
    c.onFrame(true, 60000, mini);     // a stall: counts 1000ms at most
    assert.deepEqual(c.viewMs, { 'Compact|240x186': 400, 'Mini|280x110': 1300 });
    t = 60000;
    const s = c.stop();
    assert.equal(s.view, 'Mini');
    assert.equal(s.window, '280x110');
  });

  it('frames without a view (no Companion) add nothing', () => {
    const c = createGlowCounter({ now: () => 0 });
    c.start();
    c.onFrame(true, 0);
    c.onFrame(true, 500);
    const s = c.stop();
    assert.equal(s.view, undefined);
    assert.equal(s.window, undefined);
  });

  it('the main view is the one with the most time in total; the window is its most-used size', () => {
    assert.deepEqual(mainView({
      'Compact|240x186': 300, 'Compact|220x220': 400, // Compact: 700 in all
      'Expanded|382x512': 600,
    }), { view: 'Compact', window: '220x220' });
    assert.deepEqual(mainView({}), {});
    assert.deepEqual(mainView(null), {});
  });

  it('window sizes are whole pixels', () => {
    const c = createGlowCounter({ now: () => 0 });
    c.start();
    c.onFrame(false, 0, { name: 'Expanded', width: 381.6, height: 512.2 });
    c.onFrame(false, 100, { name: 'Expanded', width: 381.6, height: 512.2 });
    assert.deepEqual(c.viewMs, { 'Expanded|382x512': 100 });
  });

  it('Reopen Companion continues the view time', () => {
    const c = createGlowCounter({ now: () => 0 });
    c.start({ startedAt: 5, glows: 1, speechMs: 10, viewMs: { 'Compact|240x186': 900 } });
    c.onFrame(false, 0, { name: 'Mini', width: 140, height: 140 });
    c.onFrame(false, 500, { name: 'Mini', width: 140, height: 140 });
    assert.deepEqual(c.stop().view, 'Compact');
  });

  it('kept with the last session (only with a tester code), and in the check-in link', () => {
    const storage = withCode();
    saveLastSession({ ...session(), view: 'Compact', window: '240x186' }, storage);
    const kept = getLastSession(storage);
    assert.equal(kept.view, 'Compact');
    assert.equal(kept.window, '240x186');
    const url = new URL(buildCheckInUrl({ testerCode: 'R4-01', source: 'study_page', session: kept, now: kept.endedAt + MIN }));
    assert.equal(url.searchParams.get('mezzo_view'), 'Compact');
    assert.equal(url.searchParams.get('mezzo_window'), '240x186');
    assert.equal(saveLastSession({ ...session(), view: 'Compact', window: '240x186' }, memoryStorage()), null);
  });

  it('no session, no view or window', () => {
    const url = new URL(buildCheckInUrl({ testerCode: 'R4-01', source: 'study_page', session: null }));
    assert.equal(url.searchParams.has('mezzo_view'), false);
    assert.equal(url.searchParams.has('mezzo_window'), false);
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

  it('no minimum length: a short session with a minute of speech qualifies (2026-11-11)', () => {
    assert.equal(STUDY_CONFIG.minSessionMs, undefined);
    const short = session({ minutes: 1.5, speechMinutes: 1 });
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: short, now: short.endedAt }), true);
    assert.equal(shouldShowCheckInCard({ testerCode: 'R4-01', session: s, now: s.endedAt }), true);
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

  it('no tester code, no link', () => {
    assert.equal(buildCheckInUrl({ testerCode: null, browserId: 'b', source: 'companion' }), null);
  });

  it('dates are local YYYY-MM-DD; minutes have one decimal', () => {
    assert.equal(formatSessionDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(sessionMinutes(40 * 1000), 0.7);
    assert.equal(sessionMinutes(0), 0);
  });
});

describe('keeping every view in step', () => {
  it('a saved session, and opening or skipping its check-in, notify every listener on the next task, so a link opens first', async () => {
    await new Promise((r) => setTimeout(r, 10)); // earlier tests' notices settle first
    const storage = withCode();
    let calls = 0;
    const off = onCheckInChange(() => { calls += 1; });
    saveLastSession(session(), storage);
    assert.equal(calls, 0); // not during the click
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(calls, 1);
    markCheckInHandled(session().id, 'skipped', storage);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(calls, 2);
    off();
    markCheckInHandled(session().id, 'opened', storage);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(calls, 2);
  });
});

describe('study stages', () => {
  it('with Part 1 on: no code: none; a code before the With Mezzo stage: baseline; after it began: mezzo', () => {
    const withBaseline = { ...STUDY_CONFIG, includeBaseline: true };
    assert.equal(studyStage({ testerCode: null, mezzoStageStartAt: null }, withBaseline), 'none');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: null }, withBaseline), 'baseline');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: Date.now() }, withBaseline), 'mezzo');
  });

  it('Part 1 is off by default (2026-11-23): any tester code is in the With Mezzo stage from the start', () => {
    assert.equal(STUDY_CONFIG.includeBaseline, false);
    assert.equal(studyStage({ testerCode: null, mezzoStageStartAt: null }), 'none');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: null }), 'mezzo');
    assert.equal(studyStage({ testerCode: 'R4-01', mezzoStageStartAt: Date.now() }), 'mezzo');
  });

  it('extensionUrl is the Chrome Web Store listing', () => {
    assert.equal(STUDY_CONFIG.extensionUrl, 'https://chromewebstore.google.com/detail/mezzo-meeting-volume-remi/hnjokbmcagbbbcgipkgfjnkmlkmnohhl');
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

  it('the stage, first-session date and last session belong to the tester code: a new code starts at the baseline (Part 1 on), and an earlier code finds its own again', () => {
    const withBaseline = { ...STUDY_CONFIG, includeBaseline: true };
    const storage = withCode('TEST-01');
    applyStartParam('?start=1', storage, STUDY_CONFIG, 3000);
    saveLastSession(session({ startedAt: 8000 }), storage);
    assert.equal(studyStage({ testerCode: getTesterCode(storage), mezzoStageStartAt: getMezzoStageStartAt(storage) }, withBaseline), 'mezzo');
    assert.equal(storage.getItem(`${KEYS.mezzoStage}:TEST-01`), '3000');

    applyStudyParam('?study=TEST-02', storage);
    assert.equal(getMezzoStageStartAt(storage), null);
    assert.equal(getFirstSessionAt(storage), null);
    assert.equal(getLastSession(storage), null);
    assert.equal(studyStage({ testerCode: getTesterCode(storage), mezzoStageStartAt: getMezzoStageStartAt(storage) }, withBaseline), 'baseline');

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

  it("Part 1's checkboxes: kept per tester code, nothing without one, removed by ?study=clear", () => {
    const storage = memoryStorage();
    assert.deepEqual(getBaselineChecks(storage), [false, false]);
    assert.equal(setBaselineCheck(0, true, storage), false); // no code
    applyStudyParam('?study=TEST-01', storage);
    assert.equal(setBaselineCheck(0, true, storage), true);
    assert.deepEqual(getBaselineChecks(storage), [true, false]);
    assert.equal(storage.getItem('mezzoStudyBaselineChecks:TEST-01'), '[true,false]');
    assert.equal(setBaselineCheck(2, true, storage), false); // only two
    applyStudyParam('?study=TEST-02', storage);
    assert.deepEqual(getBaselineChecks(storage), [false, false]);
    applyStudyParam('?study=TEST-01', storage);
    setBaselineCheck(1, true, storage);
    setBaselineCheck(0, false, storage);
    assert.deepEqual(getBaselineChecks(storage), [false, true]);
    storage.setItem('mezzoStudyBaselineChecks:TEST-01', 'not json');
    assert.deepEqual(getBaselineChecks(storage), [false, false]);
    setBaselineCheck(0, true, storage);
    clearStudy(storage);
    assert.equal(storage.getItem('mezzoStudyBaselineChecks:TEST-01'), null);
  });

  it("Part 2's checkboxes: their own key per tester code, apart from Part 1's, removed by ?study=clear", () => {
    const storage = memoryStorage();
    applyStudyParam('?study=TEST-01', storage);
    setBaselineCheck(1, true, storage, undefined, 'mezzoChecks');
    assert.deepEqual(getBaselineChecks(storage, undefined, 'mezzoChecks'), [false, true]);
    assert.deepEqual(getBaselineChecks(storage), [false, false]);
    assert.equal(storage.getItem('mezzoStudyMezzoChecks:TEST-01'), '[false,true]');
    clearStudy(storage);
    assert.equal(storage.getItem('mezzoStudyMezzoChecks:TEST-01'), null);
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

  it('the study ends at the start of the local day 14 days after the first session', () => {
    assert.equal(studyEndsAt(first), new Date(2026, 10, 23).getTime());
    assert.equal(formatLongDate(studyEndsAt(first)), 'November 23, 2026');
    assert.equal(formatMonthDay(studyEndsAt(first)), 'November 23');
    assert.equal(isStudyOver(first, new Date(2026, 10, 22, 23, 59).getTime()), false);
    assert.equal(isStudyOver(first, new Date(2026, 10, 23, 0, 0).getTime()), true);
    assert.equal(isStudyOver(null, Date.now()), false);
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
    assert.equal(isStudyOver(getFirstSessionAt(storage), first + 30 * 24 * HOUR), true);
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
  const section = (id, next) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${next}"`));

  it('names Mixpanel and its events; no cookies; no location from the IP; study codes kept out', () => {
    const usage = section('anonymous-usage-data', 'research-participants');
    assert.match(usage, /Mezzo uses Mixpanel, an analytics service/);
    for (const event of ['Mezzo opened', 'A calibration finished', 'Monitoring started', 'Monitoring ended, with how long it lasted and whether the glow appeared']) {
      assert.ok(usage.includes(event), event);
    }
    assert.match(usage, /Mezzo sets no cookies\./);
    assert.match(usage, /tells it not to use that address to estimate your location/);
    assert.match(usage, /Study codes are removed from the page address before Mixpanel starts\./);
    assert.match(usage, /isn’t tied to your name or email unless you join a study/);
    assert.match(usage, /It isn’t shared across devices, or with other websites except in a study check-in\./);
    assert.match(usage, /<a href="#research-participants">Research participants<\/a>/);
  });

  it('Research participants: Tally gets the fields when the survey opens; the same ID links check-ins to usage', () => {
    const study = section('research-participants', 'chrome-extension');
    assert.match(study, /Check-ins are collected through Tally/);
    assert.match(study, /If you sign up for a study, Tally stores the name and email you enter, used only to contact you about the study\./);
    assert.match(study, /Tally receives these when the survey opens, and saves them as a response only if you submit it\./);
    assert.match(study, /how many times the glow appeared, and which Companion view you used and its window size\./);
    assert.match(study, /a submitted check-in can be matched with that browser’s usage events/);
    assert.ok(study.includes('Your study code lets me match your check-ins to your sign-up, so I can send your gift card. Anything I quote in my case study stays anonymous.'));
  });

  it('Your control: how a study participant gets their answers deleted', () => {
    const control = html.slice(html.indexOf('id="your-control"'));
    assert.ok(control.includes('If you took part in a study and want your answers deleted, reply to any study email.</p>'));
    assert.doesNotMatch(html, /\[email\]/);
  });

  it('the extension: the page bridge, where it runs, and a Limited Use statement', () => {
    const ext = section('chrome-extension', 'what-mezzo-does-not-do');
    assert.ok(ext.includes('On Mezzo’s own site, it also reads whether the Mezzo Companion is open and monitoring, to show that in its toolbar menu. It runs only on Google Meet, Zoom, Microsoft Teams and Mezzo’s own pages.'));
    assert.match(ext, /complies with the <a [^>]*>Chrome Web Store User Data Policy<\/a>, including its Limited Use requirements\./);
    assert.match(ext, /The extension collects no personal or sensitive data: it checks meeting pages only on your device and sends nothing to Mezzo or anyone else\./);
  });

  it('speaking profiles: the name and a few calibration values', () => {
    assert.ok(html.includes('Mezzo saves only the profile name and a few calibration values (your usual speaking level and the room’s background noise)'));
  });

  it('the extension, the outside services, and no Google Fonts', () => {
    assert.match(section('chrome-extension', 'what-mezzo-does-not-do'), /doesn’t use your microphone, doesn’t read meeting content, and doesn’t store or send any data/);
    assert.match(text, /The only outside services are Mixpanel, for the anonymous usage events above, and Tally, for study check-ins\./);
    assert.match(text, /Mezzo’s fonts come from its own site\./);
  });
});
