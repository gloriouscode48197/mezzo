/**
 * Round 4 study mode: every setting in one place (src/study.js uses it).
 *
 * Not frozen on purpose: tests/study-checkin.spec.js shortens minSpeechMs
 * in the page so a browser test doesn't need a real minute of speech.
 * Nothing in the app writes to it.
 */
export const STUDY_CONFIG = {
  /** Opened after a call, from the Companion card or the /study page. */
  checkInFormUrl: 'https://tally.so/r/gber54',
  /** Opened once, at the end of the study, from the /study page. */
  wrapUpFormUrl: 'https://tally.so/r/q5alaO',
  /** Baseline stage: check-ins after calls before the tester has Mezzo.
   *  Tester code only. A placeholder URL here hides the button
   *  (isFormUrlReady()). */
  baselineFormUrl: 'https://tally.so/r/zEN6jg',
  /** The extension's Chrome Web Store page, for /study's "Get the
   *  extension" link. Empty hides the link (isFormUrlReady()). */
  extensionUrl: '',

  /** The check-in is offered for this long after a session ends. */
  checkInWindowMs: 2 * 60 * 60 * 1000,
  /** A session qualifies for a check-in with at least this much speech: the
   *  time the circle's noise gate counted as voice (study.js's
   *  createGlowCounter()). There is no minimum session length (2026-11-11). */
  minSpeechMs: 60 * 1000,
  /** Days after the first session (counted from its local date) when the
   *  wrap-up opens and the Companion stops showing the check-in card. */
  studyDays: 14,

  /** ?study=CODE saves a tester code; ?study=clear removes it. */
  urlParam: 'study',
  clearValue: 'clear',
  /** /study?start=1 (with a tester code) moves the tester to the With Mezzo
   *  stage right away, before their first monitoring session. */
  startParam: 'start',
  startValue: '1',

  /** lastSession, firstSession, mezzoStage and baselineChecks are stored
   *  per tester code,
   *  as `${key}:${code}` (study.js's codeBoundKey()). */
  storageKeys: {
    testerCode: 'mezzoStudyTesterCode',
    lastSession: 'mezzoStudyLastSession',
    /** When the first monitoring session with a tester code started (ms).
     *  Switches /study from the baseline stage to the Mezzo stage. */
    firstSession: 'mezzoStudyFirstSession',
    /** When ?start=1 moved the tester to the With Mezzo stage (ms). */
    mezzoStage: 'mezzoStudyMezzoStage',
    /** /study's Part 1 checkboxes ("I finished check-in 1/2"), as a JSON
     *  array of two booleans. The tester's own reminder: never sent. */
    baselineChecks: 'mezzoStudyBaselineChecks',
    /** The existing anonymous analytics ID (src/analytics.js's ANON_ID_KEY). */
    browserId: 'mezzo_anonymous_id',
  },

  /** Form URL parameter names. */
  params: {
    tester: 'mezzo_tester',
    browserId: 'mezzo_browser_id',
    source: 'mezzo_source',
    sessionDate: 'mezzo_session_date',
    sessionMinutes: 'mezzo_session_minutes',
    speechMinutes: 'mezzo_speech_minutes',
    glows: 'mezzo_glows',
    /** The Companion view used most of the session: Expanded, Compact or Mini. */
    view: 'mezzo_view',
    /** That view's window size most of that time, as WIDTHxHEIGHT (px). */
    windowSize: 'mezzo_window',
    minutesAfter: 'mezzo_minutes_after',
  },

  /** Values for mezzo_source. */
  sources: {
    companion: 'companion',
    studyPage: 'study_page',
    companionClosed: 'companion_closed',
    /** The main tab's "Keep this page open" page. */
    companionOpen: 'companion_open',
    /** The page the tab returns to after Done or Close Companion. */
    home: 'home',
  },
};
