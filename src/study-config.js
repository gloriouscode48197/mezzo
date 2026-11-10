/**
 * Round 4 study mode: every setting in one place (src/study.js uses it).
 *
 * Not frozen on purpose: tests/study-checkin.spec.js shortens
 * minSessionMs in the page so a browser test doesn't need a real
 * 5-minute session. Nothing in the app writes to it.
 */
export const STUDY_CONFIG = {
  /** Opened after a call, from the Companion card or the /study page. */
  checkInFormUrl: 'https://tally.so/r/gber54',
  /** Opened once, at the end of the study, from the /study page. */
  wrapUpFormUrl: 'https://tally.so/r/q5alaO',
  /** Baseline stage: check-ins after calls before the tester has Mezzo.
   *  Paste the form's ID in place of [BASELINE ID]. Until then, /study
   *  shows the baseline note without the button (isFormUrlReady()). */
  baselineFormUrl: 'https://tally.so/r/[BASELINE ID]',

  /** The check-in is offered for this long after a session ends. */
  checkInWindowMs: 2 * 60 * 60 * 1000,
  /** Shorter sessions don't get a check-in card. */
  minSessionMs: 5 * 60 * 1000,
  /** Days after the first session (counted from its local date) when the
   *  wrap-up opens and the Companion stops showing the check-in card. */
  studyDays: 14,

  /** ?study=CODE saves a tester code; ?study=clear removes it. */
  urlParam: 'study',
  clearValue: 'clear',

  storageKeys: {
    testerCode: 'mezzoStudyTesterCode',
    lastSession: 'mezzoStudyLastSession',
    /** When the first monitoring session with a tester code started (ms).
     *  Switches /study from the baseline stage to the Mezzo stage. */
    firstSession: 'mezzoStudyFirstSession',
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
    glows: 'mezzo_glows',
    minutesAfter: 'mezzo_minutes_after',
  },

  /** Values for mezzo_source. */
  sources: {
    companion: 'companion',
    studyPage: 'study_page',
  },
};
