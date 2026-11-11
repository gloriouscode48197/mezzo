/**
 * Round 4 study mode: pure logic, no DOM. Settings live in
 * src/study-config.js.
 *
 * A tester opens Mezzo once with ?study=CODE; the code stays in
 * localStorage until ?study=clear. While a code is saved, each monitoring
 * session's length and glow count are kept as "the last session", and the
 * Companion offers a check-in card for it (src/mezzo-session.js); the
 * /study page offers it too (study/index.html). Without a code nothing is
 * stored and nothing shows.
 *
 * Mezzo itself sends nothing: the values ride in the form link the tester
 * chooses to open, and reach the form only if they submit it. The glow
 * counter only reads the zone the engine already committed, so the signal,
 * tuning and calibration are untouched.
 */
import { STUDY_CONFIG } from './study-config.js';

const MAX_CODE_LENGTH = 64;

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// ── Tester code ──────────────────────────────────────────────────────────

/** Letters, digits, "-" and "_" only, at most 64 characters. */
export function normalizeTesterCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (!code || code.length > MAX_CODE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  return code;
}

export function getTesterCode(storage = defaultStorage(), config = STUDY_CONFIG) {
  try { return normalizeTesterCode(storage?.getItem(config.storageKeys.testerCode) ?? null); } catch { return null; }
}

// ── Data tied to the tester code ─────────────────────────────────────────

/** The study data kept per tester code: the last session, the first-session
 *  date and the With Mezzo unlock. Each is stored under `${key}:${code}`,
 *  so a new code starts at "Your usual calls" and a code switched back to
 *  finds its own. The tester code itself and the browser ID are not. */
export const CODE_BOUND_KEYS = Object.freeze(['lastSession', 'firstSession', 'mezzoStage']);

/** The storage key for `name` under the saved tester code, or null
 *  without one. */
export function codeBoundKey(name, storage = defaultStorage(), config = STUDY_CONFIG) {
  const code = getTesterCode(storage, config);
  return code ? `${config.storageKeys[name]}:${code}` : null;
}

function storageKeysOf(storage) {
  try {
    if (typeof storage?.length !== 'number' || typeof storage.key !== 'function') return [];
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
    return keys;
  } catch {
    return [];
  }
}

/** Removes the tester code and every code's study data (the last session,
 *  the first-session date and the With Mezzo unlock), including copies
 *  saved before the data was tied to the code.
 *  The anonymous browser ID belongs to analytics, so it stays. */
export function clearStudy(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    const bases = CODE_BOUND_KEYS.map((name) => config.storageKeys[name]);
    const current = CODE_BOUND_KEYS.map((name) => codeBoundKey(name, storage, config)).filter(Boolean);
    const all = storageKeysOf(storage).filter((key) => bases.some((base) => key === base || key.startsWith(`${base}:`)));
    for (const key of new Set([...bases, ...current, ...all])) storage?.removeItem(key);
    storage?.removeItem(config.storageKeys.testerCode);
  } catch { /* storage unavailable */ }
}

/**
 * Reads ?study= from a query string: CODE saves it, "clear" removes it.
 * @returns {'saved'|'cleared'|'invalid'|'none'} so the caller can drop the
 *   parameter from the address bar.
 */
export function applyStudyParam(search, storage = defaultStorage(), config = STUDY_CONFIG) {
  let value;
  try { value = new URLSearchParams(search).get(config.urlParam); } catch { return 'none'; }
  if (value === null) return 'none';
  if (value.trim().toLowerCase() === config.clearValue) {
    clearStudy(storage, config);
    return 'cleared';
  }
  const code = normalizeTesterCode(value);
  if (!code) return 'invalid';
  try { storage?.setItem(config.storageKeys.testerCode, code); } catch { return 'invalid'; }
  return 'saved';
}

/**
 * Reads ?start=1: with a tester code saved, moves the tester to the With
 * Mezzo stage now (the first monitoring session still does it otherwise).
 * Run after applyStudyParam(), so ?study=CODE&start=1 works in one link.
 * @returns {'started'|'already'|'no-code'|'none'}
 */
export function applyStartParam(search, storage = defaultStorage(), config = STUDY_CONFIG, now = Date.now()) {
  let value;
  try { value = new URLSearchParams(search).get(config.startParam); } catch { return 'none'; }
  if (value === null || value.trim() !== config.startValue) return 'none';
  if (!getTesterCode(storage, config)) return 'no-code';
  if (getMezzoStageUnlockedAt(storage, config) !== null) return 'already';
  try { storage?.setItem(codeBoundKey('mezzoStage', storage, config), String(now)); } catch { return 'none'; }
  return 'started';
}

/** Applies ?study= on a page and then removes it from the address bar, so a
 *  bookmark or a shared link doesn't carry the code. With `start: true`
 *  (the /study page), ?start=1 too. */
export function applyStudyFromLocation(win = globalThis.window, storage = defaultStorage(), config = STUDY_CONFIG, { start = false } = {}) {
  if (!win?.location) return 'none';
  const result = applyStudyParam(win.location.search, storage, config);
  const startResult = start ? applyStartParam(win.location.search, storage, config) : 'none';
  if (result !== 'none' || startResult !== 'none') {
    try {
      const url = new URL(win.location.href);
      url.searchParams.delete(config.urlParam);
      if (start) url.searchParams.delete(config.startParam);
      win.history?.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
    } catch { /* leave the address bar as it is */ }
  }
  return result;
}

/** The existing anonymous analytics ID (src/analytics.js), made the same
 *  way if this browser doesn't have one yet. */
export function getBrowserId(storage = defaultStorage(), makeId = () => globalThis.crypto.randomUUID(), config = STUDY_CONFIG) {
  try {
    const existing = storage?.getItem(config.storageKeys.browserId);
    if (existing) return existing;
    const id = makeId();
    storage?.setItem(config.storageKeys.browserId, id);
    return id;
  } catch {
    return null;
  }
}

// ── Glow count, speaking time and session length ─────────────────────────

/** A frame never counts for more than this much speaking time, so a long
 *  pause in the audio loop (a sleeping laptop) isn't counted as speech.
 *  Generous enough for a background tab's 1-second timer throttling. */
export const MAX_SPEECH_FRAME_MS = 1000;

/**
 * Counts one monitoring session: glows, one each time the committed zone
 * moves into Outside range (the moment the glow turns on), never per frame;
 * and speaking time, the time between audio frames while the circle's
 * noise gate counted the level as voice (onFrame()). start() begins a new
 * session at zero; start({ startedAt, glows, speechMs }) continues one
 * (Reopen Companion after an involuntary close resumes the same call).
 * stop() returns the session, or null if none was running.
 */
export function createGlowCounter({ outsideZone = 3, now = () => Date.now() } = {}) {
  let running = false;
  let startedAt = null;
  let lastZone = 0;
  let glows = 0;
  let speechMs = 0;
  let lastFrameAt = null;

  return {
    start(resume = null) {
      running = true;
      startedAt = Number.isFinite(resume?.startedAt) ? resume.startedAt : now();
      glows = Number.isFinite(resume?.glows) ? resume.glows : 0;
      speechMs = Number.isFinite(resume?.speechMs) ? resume.speechMs : 0;
      lastZone = 0;
      lastFrameAt = null;
    },
    onZone(zone) {
      if (!running) return;
      if (zone === outsideZone && lastZone !== outsideZone) glows += 1;
      lastZone = zone;
    },
    /** One audio frame: `voiced` is the noise gate's verdict for it. The
     *  time since the previous frame counts as speech when it is voiced. */
    onFrame(voiced, atMs = now()) {
      if (!running) return;
      if (voiced && lastFrameAt !== null) speechMs += Math.min(Math.max(0, atMs - lastFrameAt), MAX_SPEECH_FRAME_MS);
      lastFrameAt = atMs;
    },
    get glows() { return glows; },
    get speechMs() { return speechMs; },
    get startedAt() { return startedAt; },
    get running() { return running; },
    /** @returns {{ id: string, startedAt: number, endedAt: number, glows: number, speechMs: number } | null} */
    stop() {
      if (!running) return null;
      running = false;
      const endedAt = Math.max(startedAt, now());
      return { id: String(startedAt), startedAt, endedAt, glows, speechMs };
    },
  };
}

// ── The last session ─────────────────────────────────────────────────────

/** Keeps the session as "the last session", only while a tester code is
 *  saved. A new session replaces the previous one. The first one also
 *  records the first-session date, which moves /study to the Mezzo stage.
 *  @returns {object|null} the stored record */
export function saveLastSession(session, storage = defaultStorage(), config = STUDY_CONFIG) {
  if (!session || !getTesterCode(storage, config)) return null;
  const record = { id: session.id, startedAt: session.startedAt, endedAt: session.endedAt, glows: session.glows };
  if (Number.isFinite(session.speechMs)) record.speechMs = session.speechMs;
  // The same session saved again (Reopen Companion continued it, then
  // Stop): keep its check-in answer, so the card shows once per session
  // wherever it was opened or skipped first.
  const previous = getLastSession(storage, config);
  if (previous?.id === record.id && previous.handled) record.handled = previous.handled;
  try {
    storage?.setItem(codeBoundKey('lastSession', storage, config), JSON.stringify(record));
    if (getFirstSessionAt(storage, config) === null) {
      storage?.setItem(codeBoundKey('firstSession', storage, config), String(session.startedAt));
    }
  } catch { return null; }
  notifyCheckInChange();
  return record;
}

/** When the first monitoring session with a tester code started, or null
 *  if there hasn't been one in this browser. */
export function getFirstSessionAt(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    const key = codeBoundKey('firstSession', storage, config);
    if (!key) return null;
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined || raw === '') return null;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** When ?start=1 unlocked the With Mezzo stage, or null. */
export function getMezzoStageUnlockedAt(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    const key = codeBoundKey('mezzoStage', storage, config);
    if (!key) return null;
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined || raw === '') return null;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** When the With Mezzo stage began: the earlier of the ?start=1 unlock and
 *  the first monitoring session, or null before either. The study's 14
 *  days (the wrap-up date, and the end of the check-in card) count from it. */
export function getMezzoStageStartAt(storage = defaultStorage(), config = STUDY_CONFIG) {
  const times = [getMezzoStageUnlockedAt(storage, config), getFirstSessionAt(storage, config)].filter((t) => t !== null);
  return times.length ? Math.min(...times) : null;
}

// ── Study stages ─────────────────────────────────────────────────────────

/**
 * Which /study stage applies:
 * 'none' without a tester code; 'baseline' with a code before the With
 * Mezzo stage began; 'mezzo' once it has (getMezzoStageStartAt(): the
 * ?start=1 unlock or the first monitoring session).
 */
export function studyStage({ testerCode, mezzoStageStartAt }) {
  if (!testerCode) return 'none';
  return mezzoStageStartAt === null || mezzoStageStartAt === undefined ? 'baseline' : 'mezzo';
}

/** The start of the local day `studyDays` after the With Mezzo stage began
 *  (getMezzoStageStartAt()): the wrap-up opens then, and the check-in card
 *  stops. */
export function wrapUpOpensAt(mezzoStageStartAt, config = STUDY_CONFIG) {
  if (!Number.isFinite(mezzoStageStartAt)) return null;
  const d = new Date(mezzoStageStartAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + config.studyDays).getTime();
}

export function isWrapUpOpen(mezzoStageStartAt, now, config = STUDY_CONFIG) {
  const opensAt = wrapUpOpensAt(mezzoStageStartAt, config);
  return opensAt !== null && now >= opensAt;
}

/** "November 23, 2026" */
export function formatLongDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function getLastSession(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    const key = codeBoundKey('lastSession', storage, config);
    if (!key) return null;
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || typeof r.id !== 'string' || !Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt)
      || !Number.isFinite(r.glows) || r.endedAt < r.startedAt) return null;
    // speechMs is optional: sessions saved before speaking time was tracked
    // have none (and so never meet the speech minimum).
    if (r.speechMs !== undefined && !(Number.isFinite(r.speechMs) && r.speechMs >= 0)) return null;
    return r;
  } catch {
    return null;
  }
}

// ── Keeping every view in step ───────────────────────────────────────────

const checkInListeners = new Set();

/** Calls fn whenever the pending check-in may have changed in this tab: a
 *  session was saved, or a check-in was opened or skipped. Other tabs see
 *  it through the storage event. @returns {() => void} unsubscribe */
export function onCheckInChange(fn) {
  checkInListeners.add(fn);
  return () => checkInListeners.delete(fn);
}

/** On the next task, not now: a card's Open check-in link must open before
 *  any card is hidden (removing its href in the click would cancel it). */
function notifyCheckInChange() {
  const run = () => { for (const fn of [...checkInListeners]) { try { fn(); } catch { /* one view's failure isn't another's */ } } };
  if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(run, 0);
  else run();
}

/** Records that the check-in for this session was opened or skipped, so the
 *  card shows once per session, and clears it from every view. */
export function markCheckInHandled(sessionId, how, storage = defaultStorage(), config = STUDY_CONFIG) {
  const record = getLastSession(storage, config);
  if (!record || record.id !== sessionId) return false;
  record.handled = how;
  try { storage?.setItem(codeBoundKey('lastSession', storage, config), JSON.stringify(record)); } catch { return false; }
  notifyCheckInChange();
  return true;
}

export function sessionDurationMs(session) {
  return session ? Math.max(0, session.endedAt - session.startedAt) : 0;
}

/** True while the session ended less than the check-in window ago. */
export function isWithinCheckInWindow(session, now, config = STUDY_CONFIG) {
  if (!session) return false;
  const since = now - session.endedAt;
  return since >= 0 && since < config.checkInWindowMs;
}

/** Speaking time in the session; 0 when it wasn't recorded. */
export function sessionSpeechMs(session) {
  return Number.isFinite(session?.speechMs) ? session.speechMs : 0;
}

/** A pending check-in (the cards, in every view): a tester code, a session
 *  with at least the minimum speaking time (there is no minimum length),
 *  ended inside the 2-hour window, not yet opened or skipped, and the
 *  study's 14 days not over (the tester code stays saved either way). */
export function shouldShowCheckInCard({ testerCode, session, now, mezzoStageStartAt = null }, config = STUDY_CONFIG) {
  return Boolean(testerCode)
    && !isWrapUpOpen(mezzoStageStartAt, now, config)
    && Boolean(session)
    && !session.handled
    && sessionSpeechMs(session) >= config.minSpeechMs
    && isWithinCheckInWindow(session, now, config);
}

/** When the card stops being offered. */
export function checkInExpiresAt(session, config = STUDY_CONFIG) {
  return session ? session.endedAt + config.checkInWindowMs : 0;
}

// ── Form links ───────────────────────────────────────────────────────────

/** Local date as YYYY-MM-DD. */
export function formatSessionDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minutes, to one decimal place (a 40-second session is 0.7, not 0). */
export function sessionMinutes(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(durationMs / 6000) / 10;
}

/**
 * The check-in form link. With a session, it carries that session's date
 * (the day it started), length, speaking time (when recorded), glow count
 * and whole minutes since it ended; without one, only the tester code and browser ID (and the source).
 * Values are URL-encoded by URLSearchParams.
 * @returns {string|null} null without a tester code
 */
export function buildCheckInUrl({ testerCode, browserId, source, session = null, now = Date.now() }, config = STUDY_CONFIG) {
  if (!testerCode) return null;
  const p = config.params;
  const url = new URL(config.checkInFormUrl);
  url.searchParams.set(p.tester, testerCode);
  if (browserId) url.searchParams.set(p.browserId, browserId);
  url.searchParams.set(p.source, source);
  if (session) {
    url.searchParams.set(p.sessionDate, formatSessionDate(new Date(session.startedAt)));
    url.searchParams.set(p.sessionMinutes, String(sessionMinutes(sessionDurationMs(session))));
    if (Number.isFinite(session.speechMs)) url.searchParams.set(p.speechMinutes, String(sessionMinutes(session.speechMs)));
    url.searchParams.set(p.glows, String(session.glows));
    url.searchParams.set(p.minutesAfter, String(Math.max(0, Math.round((now - session.endedAt) / 60000))));
  }
  return url.toString();
}

/** A form URL is usable once its placeholder ID has been replaced. */
export function isFormUrlReady(formUrl) {
  if (typeof formUrl !== 'string' || !formUrl || /[[\]]/.test(formUrl)) return false;
  try { return new URL(formUrl).protocol === 'https:'; } catch { return false; }
}

/** The baseline-stage form link, with the tester code only. Null until the
 *  baseline form's ID is in the config. */
export function buildBaselineUrl({ testerCode }, config = STUDY_CONFIG) {
  if (!testerCode || !isFormUrlReady(config.baselineFormUrl)) return null;
  const url = new URL(config.baselineFormUrl);
  url.searchParams.set(config.params.tester, testerCode);
  return url.toString();
}

/** The end-of-study form link, with the tester code only. */
export function buildWrapUpUrl({ testerCode }, config = STUDY_CONFIG) {
  if (!testerCode) return null;
  const url = new URL(config.wrapUpFormUrl);
  url.searchParams.set(config.params.tester, testerCode);
  return url.toString();
}
