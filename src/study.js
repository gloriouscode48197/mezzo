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

/** Removes the tester code and the last session. The anonymous browser ID
 *  belongs to analytics, so it stays. */
export function clearStudy(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    storage?.removeItem(config.storageKeys.testerCode);
    storage?.removeItem(config.storageKeys.lastSession);
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

/** Applies ?study= on a page and then removes it from the address bar, so a
 *  bookmark or a shared link doesn't carry the code. */
export function applyStudyFromLocation(win = globalThis.window, storage = defaultStorage(), config = STUDY_CONFIG) {
  if (!win?.location) return 'none';
  const result = applyStudyParam(win.location.search, storage, config);
  if (result !== 'none') {
    try {
      const url = new URL(win.location.href);
      url.searchParams.delete(config.urlParam);
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

// ── Glow count and session length ────────────────────────────────────────

/**
 * Counts glows in one monitoring session: one count each time the committed
 * zone moves into Outside range (the moment the glow turns on), never per
 * frame. start() begins a new session at zero; start({ startedAt, glows })
 * continues one (Reopen Companion after an involuntary close resumes the
 * same call). stop() returns the session, or null if none was running.
 */
export function createGlowCounter({ outsideZone = 3, now = () => Date.now() } = {}) {
  let running = false;
  let startedAt = null;
  let lastZone = 0;
  let glows = 0;

  return {
    start(resume = null) {
      running = true;
      startedAt = Number.isFinite(resume?.startedAt) ? resume.startedAt : now();
      glows = Number.isFinite(resume?.glows) ? resume.glows : 0;
      lastZone = 0;
    },
    onZone(zone) {
      if (!running) return;
      if (zone === outsideZone && lastZone !== outsideZone) glows += 1;
      lastZone = zone;
    },
    get glows() { return glows; },
    get startedAt() { return startedAt; },
    get running() { return running; },
    /** @returns {{ id: string, startedAt: number, endedAt: number, glows: number } | null} */
    stop() {
      if (!running) return null;
      running = false;
      const endedAt = Math.max(startedAt, now());
      return { id: String(startedAt), startedAt, endedAt, glows };
    },
  };
}

// ── The last session ─────────────────────────────────────────────────────

/** Keeps the session as "the last session", only while a tester code is
 *  saved. A new session replaces the previous one.
 *  @returns {object|null} the stored record */
export function saveLastSession(session, storage = defaultStorage(), config = STUDY_CONFIG) {
  if (!session || !getTesterCode(storage, config)) return null;
  const record = { id: session.id, startedAt: session.startedAt, endedAt: session.endedAt, glows: session.glows };
  try { storage?.setItem(config.storageKeys.lastSession, JSON.stringify(record)); } catch { return null; }
  return record;
}

export function getLastSession(storage = defaultStorage(), config = STUDY_CONFIG) {
  try {
    const raw = storage?.getItem(config.storageKeys.lastSession);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || typeof r.id !== 'string' || !Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt)
      || !Number.isFinite(r.glows) || r.endedAt < r.startedAt) return null;
    return r;
  } catch {
    return null;
  }
}

/** Records that the check-in for this session was opened or skipped, so the
 *  card shows once per session. */
export function markCheckInHandled(sessionId, how, storage = defaultStorage(), config = STUDY_CONFIG) {
  const record = getLastSession(storage, config);
  if (!record || record.id !== sessionId) return false;
  record.handled = how;
  try { storage?.setItem(config.storageKeys.lastSession, JSON.stringify(record)); } catch { return false; }
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

/** The Companion card: a tester code, a session of at least the minimum
 *  length, inside the window, not yet opened or skipped. */
export function shouldShowCheckInCard({ testerCode, session, now }, config = STUDY_CONFIG) {
  return Boolean(testerCode)
    && Boolean(session)
    && !session.handled
    && sessionDurationMs(session) >= config.minSessionMs
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
 * (the day it started), length, glow count and whole minutes since it
 * ended; without one, only the tester code and browser ID (and the source).
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
    url.searchParams.set(p.glows, String(session.glows));
    url.searchParams.set(p.minutesAfter, String(Math.max(0, Math.round((now - session.endedAt) / 60000))));
  }
  return url.toString();
}

/** The end-of-study form link, with the tester code only. */
export function buildWrapUpUrl({ testerCode }, config = STUDY_CONFIG) {
  if (!testerCode) return null;
  const url = new URL(config.wrapUpFormUrl);
  url.searchParams.set(config.params.tester, testerCode);
  return url.toString();
}
