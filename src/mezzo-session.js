/**
 * Mezzo — Session Ownership Module (PiP-First)
 *
 * Owns everything about a monitoring session: the audio/engine pipeline,
 * the Mezzo Companion (Document Picture-in-Picture) lifecycle, the
 * explicit `sessionState` (src/session-state.js), and an explicit
 * `layoutMode` for the Companion's own two supported presentations
 * (Expanded / Compact — kept as a fully separate piece of state, never
 * inferred from window dimensions).
 *
 * The Mezzo Companion is the sole operational surface (see CLAUDE.md's
 * Non-Negotiable Decisions). Home (index.html/landing.js, via
 * src/home-dock.js, before a Companion exists) has exactly one job: call
 * startMonitoring() to open the Companion. It
 * does not choose a profile, does not request microphone permission, and
 * does not decide Welcome vs. Ready — the Companion decides all of that
 * for itself, every time it opens, from src/profiles.js's own storage:
 * zero saved profiles → Welcome, one or more → Ready. There is no more
 * "Home already chose a profile, skip straight to Monitoring" path —
 * every open goes through Welcome or Ready, first session of the day
 * included. Document Picture-in-Picture support is required to use Mezzo
 * at all now; there is no no-Companion-support fallback.
 *
 * The Companion renders as a set of genuinely separate screens — never a
 * shared layout with elements toggled: Welcome/01, C1 (calibration intro),
 * Calibrating/C2, Calibration Failed, C0 (microphone blocked), Ready, the
 * full-screen decision states M1 (replace/keep-as-unsaved), M2/M2a
 * (name/replace a new profile), M3 (five-profile limit), 06b (delete
 * confirmation), and Monitoring. See
 * docs/prd/ready-screen-speaking-profiles-mvp.md for the full state model.
 * Every screen except Monitoring shares one fixed size
 * (MEZZO_COMPANION_READY_WIDTH × MEZZO_COMPANION_READY_BASE_HEIGHT) and is
 * always Expanded — there is no Compact variant for any of them. Monitoring
 * is the only screen with two layouts:
 *   - Expanded (MEZZO_COMPANION_EXPANDED_SIZE, 382×512 — the same size as
 *     every other screen since 2026-11-02; was 382×480, and 290×420
 *     before the 2026-08-18 redesign): the live awareness-state label
 *     (Listening / Within range / Approaching end of range / Outside
 *     range — the most prominent text on the screen, centered on the same
 *     axis Ready's own heading occupies), quiet profile-name text beneath
 *     it, the visualization, and a single centered low-contrast Stop pill
 *     — never a large full-width Stop Monitoring button. The Compact
 *     toggle lives as its own icon-only "window chrome" control in the
 *     top-right corner, not in the control row with Stop. No in-page
 *     title bar — the real Document Picture-in-Picture window chrome is
 *     the only title bar (see `pipDoc.title` below); every other state
 *     uses the same real window chrome too, with no in-page title bar of
 *     its own. Below 382×512, purely presentational CSS thresholds
 *     progressively drop the profile name, then turn the Stop pill into a
 *     bottom-left icon, then drop the status text — never touching
 *     `layoutMode` itself; see the Monitoring CSS's own comment for the
 *     exact breakpoints. Manual resizing is left freeform (no aspect-
 *     ratio lock, no resizeTo() call in response to a resize event) —
 *     382×512 is `applyLayoutMode()`'s own Expand target, not an enforced
 *     ratio.
 *   - Compact (MEZZO_COMPANION_COMPACT_SIZE, 220×220): peripheral
 *     awareness, but with the same Stop reachable as Expanded — not
 *     session management beyond that. The visualization (centered,
 *     dominant) is the ONLY thing visible at rest — no wordmark, no
 *     visible status text, no profile metadata, and (2026-08-18 redesign)
 *     not even the Stop/Expand controls themselves: both fade in only on
 *     hover or keyboard focus, so the resting window is nothing but the
 *     visual. Stop sits bottom-left; Expand sits top-right, deliberately
 *     the same corner Expanded's own Compact toggle occupies, so nothing
 *     appears to jump when the mode switches. Both are real, always-
 *     focusable `<button>`s (never focusable-while-invisible — visibility
 *     is opacity/CSS only, driven by :hover/:focus-within, not
 *     display/visibility) and both are icon-only (aria-label carries
 *     their accessible name, same as before). The awareness-state element
 *     stays in the DOM (visually hidden, still aria-live) so assistive
 *     tech keeps hearing state changes; there is no visible equivalent.
 *     Stop in Compact calls the exact same stopMonitoring() Expanded's
 *     Stop does — it returns to Ready, it does not close the Companion.
 *     The native window-close control remains a separate, always-
 *     available way to close the Companion outright from any state — see
 *     handlePipClose, which already treats any Companion close (native ✕
 *     or programmatic) as "stop monitoring, keep Mezzo open, layout
 *     resets to Expanded for the next open" rather than a full
 *     endSession() teardown.
 *
 * Profile selection, deletion, the 5-profile limit, calibration, and
 * recalibration all happen on the Companion's own Ready screen now — Home
 * never touches any of it. Once monitoring starts the profile is locked
 * and shown as plain informational text (Expanded only), so there is no
 * mid-monitoring profile-switch flow to reconcile. Stopping returns the
 * (still-open) Companion to Ready, where the profile selector unlocks
 * again for starting again, switching profiles, deleting one, or
 * calibrating a new one.
 *
 * Extracted out of what used to be monitoring.js's page controller so that
 * Home/Dock (src/home-dock.js, called from landing.js) can drive its own
 * minimal status view off this module's public surface without duplicating
 * the engine/audio/PiP internals — "one source of truth," not a second copy.
 *
 * Public surface is deliberately small: src/home-dock.js never calls
 * anything for Start/Stop Monitoring, profile selection, calibration, or
 * Expanded/Compact layout, directly — those controls live *inside* the
 * Companion's own document and are wired here. src/home-dock.js only needs: init,
 * startMonitoring (no arguments — the Companion resolves its own profile
 * and entry screen), stopMonitoring (fallback safety net, effectively
 * unreachable from Home now that Home has no Stop control), endSession
 * (Close Companion), subscribe/getSessionState (the Dock's status
 * mapping), and isPipSupported (the unsupported-browser check). There is
 * deliberately no "bring to front"/"focus" export — the Companion is a
 * Document PiP window and already stays above other windows on its own, so
 * a focus/raise action would be misleading. There is also no "Close
 * Companion" control anywhere in the Companion itself — the native
 * Picture-in-Picture window close control is the only way a user closes it
 * directly. Mezzo never closes the Companion on the user's behalf except
 * via endSession() (a full session teardown). Layout mode is likewise
 * entirely internal — nothing outside the Companion needs to know or care
 * whether it's Expanded or Compact.
 */

import { AudioProcessor } from './audio.js?v=2';
import { MezzoEngine, DEFAULT_ZONE_SETTINGS, isNoisyRoom } from './engine.js?v=5';
import { MezzoRangeRing, edgeForBandExtent, edgeForExtent, ringExtent, bandExtent, largestClearCircle, scaledBand, DEFAULT_RING_SETTINGS } from './range-ring.js';
import { MezzoLevelMeter } from './level-meter.js';
import { createZoneAnnouncer, ZONE_LABELS } from './zone-announcer.js';
import { createCalibrationController } from './calibration-controller.js';
import { createCalibrationLock } from './calibration-lock.js';
import { trackMonitoringStarted, trackMonitoringSession, trackCalibrationCompleted } from './analytics.js';
import { markClassification, markPipUpdate } from './_timing-debug.js';
import {
  createGlowCounter,
  saveLastSession,
  getLastSession,
  onCheckInChange,
  getTesterCode,
  getMezzoStageStartAt,
  wrapUpOpensAt,
  getBrowserId,
  shouldShowCheckInCard,
  checkInExpiresAt,
  markCheckInHandled,
  buildCheckInUrl,
} from './study.js';
import { STUDY_CONFIG } from './study-config.js';
import { SESSION_STATES, createSessionState } from './session-state.js';
import {
  getSavedProfiles,
  deleteSavedProfile,
  getSelectedProfile,
  setSelectedProfile,
  getLastUsedProfile,
  setLastUsedProfile,
  clearLastUsedProfile,
  resolveActiveProfile,
  resolveSavePromptAction,
  commitSavePromptName,
  SAVE_PROMPT_ACTIONS,
  MAX_SAVED_PROFILES,
  getHasStartedMonitoring,
  setHasStartedMonitoring,
  needsRecalibration,
} from './profiles.js';

// Calibration failure codes (src/calibration-controller.js) mapped to calm,
// specific UI copy — never the raw engine.js error message, which is meant
// for logs/tests, not users. Both engine.js's baseline-floor and voiced-
// ratio rejections currently share one INSUFFICIENT_VOICE code (see
// calibration-controller.js's mapCalibrationError) and so share one message
// here too — distinguishing them further would require engine.js's own
// messages to diverge first.
//
// CROSS_TAB_LOCKED is not one of calibration-controller.js's own codes — it
// never reaches the controller at all. src/calibration-lock.js's acquire()
// is checked before a calibration attempt starts (see beginCalibrationFlow()
// on both surfaces); a rejection there is reported through this exact same
// Calibration Failed screen and copy map for a calm, consistent experience,
// without ever touching the controller, the mic, or generating a real
// calibration failure of its own.
// No terminal periods (2026-08-16 Companion heading-punctuation audit) — see
// the module-level note above CALIBRATION_FAILURE_COPY's own doc comment
// block for the full scope. Every entry here renders as failedMessageEl's
// sole text (.pip-h1.pip-failed-message — the Failed screen's only
// heading-equivalent content, see showFailedScreen()), so each is trimmed of
// its own trailing period; any internal, mid-sentence period (e.g.
// MIC_PERMISSION_DENIED's "...calibrate. Check...") is left exactly as
// written, since only the terminal period is in scope.
export const CALIBRATION_FAILURE_COPY = {
  SILENCE: "Didn't catch enough clear speech. Let's try again",
  INSUFFICIENT_VOICE: "Didn't catch enough clear speech. Let's try again",
  UNSTABLE_ENVIRONMENT: 'Try somewhere a little quieter',
  MIC_PERMISSION_DENIED: 'Mezzo needs microphone access to calibrate. Check your browser\'s microphone permission for this site, then try again',
  // Always routed to the dedicated C0 screen (see showFailedScreen()), same
  // as MIC_PERMISSION_DENIED above — this entry exists only as the same
  // kind of defensive fallback MIC_PERMISSION_DENIED's own entry already
  // is, not because this code is expected to reach the generic screen.
  MIC_ACQUISITION_TIMEOUT: 'The connection took longer than expected. Try again to restart calibration',
  NO_SAMPLES: "Didn't catch enough clear speech. Let's try again",
  CROSS_TAB_LOCKED: 'Calibration is already open in another Mezzo tab',
  UNKNOWN: "Something went wrong. Let's try again",
};

// C0's own heading/body pairs, keyed by failure code — the two codes that
// route there (see showFailedScreen()/showC0Screen()) render genuinely
// different, honest copy on the one shared screen/illustration/actions
// rather than a single fixed message covering both. MIC_PERMISSION_DENIED
// matches the PRD/design artifact exactly (see the C0 skeleton's own build
// comment in startMonitoring()); MIC_ACQUISITION_TIMEOUT is the
// calibration-stall reliability correction's own approved copy —
// deliberately never describing the mic as denied or blocked, since a
// stalled/slow acquisition is a different, calmer failure mode than an
// explicit browser-level block. Exported alongside calibrationFailureMessage()
// below so this pure copy mapping is unit-testable without a DOM.
// heading strings carry no terminal period (2026-08-16 audit — see
// CALIBRATION_FAILURE_COPY's own doc comment above); body strings are
// explanatory helper text, not headings, and keep their periods unchanged.
export const C0_COPY = {
  MIC_PERMISSION_DENIED: {
    heading: 'Your browser has blocked microphone access',
    body: 'Click the icon in your address bar and change the microphone setting to "Allow," then try again.',
  },
  MIC_ACQUISITION_TIMEOUT: {
    heading: 'Mezzo couldn’t connect to your microphone',
    body: 'The connection took longer than expected. Try again to restart calibration.',
  },
};

// Exported (along with isTemporaryProfile/profileMetaText below) purely so
// these pure, DOM-free helpers can be unit tested directly — see
// src/mezzo-session.test.js — without needing a Document PiP-capable
// browser environment, which this module otherwise requires end to end.
export function calibrationFailureMessage(failure) {
  return CALIBRATION_FAILURE_COPY[failure?.code] || CALIBRATION_FAILURE_COPY.UNKNOWN;
}

/**
 * Pure copy for M2/M2a (see docs/prd/ready-screen-speaking-profiles-mvp.md)
 * — the Ready-screen "Save profile" naming state, given a
 * resolveSavePromptAction() (src/profiles.js) resolution. The single place
 * this state's terminology-sensitive text lives, so it's unit-testable
 * directly (see src/mezzo-session.test.js) without a Document PiP-capable
 * browser, and so renderM2State() below only renders it rather than
 * composing strings inline.
 *
 * BLOCKED is not normally reachable here — handleSaveProfileClick() routes
 * straight to M3 at the five-profile cap, never opening M2 in the first
 * place (see the PRD: "below cap → M2; at cap → M3, never M2 directly").
 * It's still handled defensively (disabled, generic copy) in case the
 * library reaches the cap in the brief window M2 is open.
 */
export function saveProfileNameCopy(resolution) {
  switch (resolution?.kind) {
    case SAVE_PROMPT_ACTIONS.UPDATE:
      return {
        warningText: `A profile named “${resolution.profile.name}” already exists.`,
        buttonLabel: 'Update',
        disabled: false,
      };
    case SAVE_PROMPT_ACTIONS.BLOCKED:
      return {
        warningText: 'Delete a saved profile before saving this one.',
        buttonLabel: 'Save',
        disabled: true,
      };
    case SAVE_PROMPT_ACTIONS.CREATE:
      return { warningText: '', buttonLabel: 'Save', disabled: false };
    default: // INVALID — nothing typed yet
      return { warningText: '', buttonLabel: 'Save', disabled: true };
  }
}

/**
 * Pure copy for Variant 2's own primary button label (post-creation result
 * screen, reached only from a saved-profile recalibration's completion —
 * never session mode, or speaking again for the current Temporary profile,
 * both of which land on Variant 1 instead — see handleCalibrationCompleted()
 * below). `targetName` is the recalibrated saved profile's own name.
 *
 * Revised twice now: the original "Replace existing {name} profile?"
 * heading put the name in the heading; the first Slice 2 pass moved it into
 * a dynamic body ("Replace the saved calibration for {name}..."), asking
 * essentially the same question as the heading. This revision retires both
 * — Variant 1 and Variant 2 now share one static heading/body pair ("Your
 * new speaking profile is ready" / "What would you like to do with it?",
 * built directly into each screen's own DOM, no copy function needed for
 * either), and the target name lives only here, in the one place it's
 * actually decision-relevant: the primary button itself. Curly quotes,
 * matching CLAUDE.md's convention for interpolated names elsewhere
 * (Delete “{name}”?, A profile named “{name}” already exists., etc.) —
 * the button's own visible text is also its accessible name, so a
 * long or unusual profile name still produces an understandable label
 * without any separate aria-label needed.
 */
/** Ready's heading. */
export function readyHeadingCopy({ hasStartedMonitoring, savedProfileCount }) {
  return !hasStartedMonitoring && savedProfileCount === 0 ? 'Ready for your first conversation' : 'Ready when you are';
}

/** M1's question under "New calibration ready": the profile it would update. */
export function recalibrationQuestion(targetName) {
  return targetName ? `Save it to “${targetName}”?` : 'Save it to this profile?';
}

export function replaceButtonLabel(targetName) {
  return targetName ? `Update “${targetName}”` : 'Update this profile';
}

// The one and only signal for "this profile is a runtime-only calibration
// that hasn't been saved" — never inferred from name, a missing id,
// calibratedTs recency, or which screen produced it. See CLAUDE.md's
// Profiles section and src/profiles.js's file header for the same rule
// applied to storage.
export function isTemporaryProfile(profile) {
  return profile?.temporary === true;
}

// Small decorative glyphs, shared across the DOM-construction functions
// below — module-level so they're not rebuilt on every Companion open.
// aria-hidden in every use site; the button/control's own text or
// aria-label is always the real accessible name.
const CHEVRON_ICON_SVG = '<span class="pip-ready-selector-chevron" aria-hidden="true"><svg viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
const TRASH_ICON_SVG = '<svg width="13" height="14" viewBox="0 0 13 14" fill="none" aria-hidden="true"><path d="M1 3.5h11M4.5 3.5V2h4v1.5M5.5 6.5v4M7.5 6.5v4M2 3.5l.8 8.5h7.4l.8-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A circular arrow, "do it again", on the Ready selector's per-row
// Recalibrate action (2026-10-27; it was a pencil, which reads as edit or
// rename, neither of which Mezzo offers). Drawn at the same 1:1 scale,
// stroke width (1.3), caps and joins as TRASH_ICON_SVG, in currentColor,
// so it takes the row action's own color and states. Decorative only
// (aria-hidden: the button's aria-label, set per row in
// buildSelectorRow(), is the real accessible name).
const RECALIBRATE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 2v2.5H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Microphone blocked (PRD §9a): a solid circle with a slash. The body copy
// says where to restore access; the icon only marks the state.
const C0_BLOCKED_ICON_SVG = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true"><circle cx="22" cy="22" r="20" style="fill: var(--color-text-muted)"/><path d="M10.5 10.5l23 23" style="stroke: var(--color-bg-decision)" stroke-width="3.5" stroke-linecap="round"/></svg>';

// Mirrors calibration-controller.js's own DEFAULT_CAPTURE_DURATION_MS
// (6000ms), which isn't exported — kept in sync here for the countdown
// display only. The controller's own capture timer is the actual source of
// truth for when capture ends; this constant only decides what the
// countdown text counts down from.
const CALIBRATION_COUNTDOWN_SECONDS = 6;
// Result screens, when speech sat less than NOISY_ROOM_GAP_DB above the room.
const NOISY_ROOM_TIP = 'Your room is a bit noisy for how softly you speak. Try moving a little closer to your mic.';
// Ready, under a profile saved before the speech-band filter and peaks.
// "Recalibrate" in it is an inline link (see renderContextualActions()).
const RECALIBRATE_NOTE = ['Made before the new sound filter. ', 'Recalibrate', ''];
// Calibration is two steps (2026-10-26, "say it once, then count"): each
// has a prep screen that says what to do and for how long, then waits for
// "I'm ready"; its listening screen only names what Mezzo is listening to,
// with a large countdown. Step 1 listens to the room (3s), Step 2 to the
// voice (6s).
const PREP_COPY = Object.freeze({
  1: Object.freeze({
    eyebrow: 'Step 1 of 2',
    heading: "First, let's hear the room",
    body: 'For 3 seconds, Mezzo measures the background noise without your voice, so it can tell the two apart.',
  }),
  2: Object.freeze({
    eyebrow: 'Step 2 of 2',
    heading: 'Now speak at the level you want to maintain',
    body: "Talk for 6 seconds at a level that won't carry to people nearby.",
  }),
});
// The listening screens lead with the instruction (2026-10-27): after a
// few runs people skim the prep screens and only read the countdown
// screen, the one they can't leave. The step, the instruction as the
// heading (each entry of `heading` is a line of its own), and a helper
// under the meter. The announcement reads the step and the heading.
const LISTENING_COPY = Object.freeze({
  room: Object.freeze({
    eyebrow: 'Step 1 of 2',
    heading: Object.freeze(['Background noise only', '(no talking)']),
    helper: 'Mezzo is listening to the room.',
  }),
  voice: Object.freeze({
    eyebrow: 'Step 2 of 2',
    heading: Object.freeze(['Keep talking until the timer ends']),
    helper: "At a level that won't carry to people nearby.",
  }),
});
const listeningAnnouncement = (phase, seconds) => {
  const copy = LISTENING_COPY[phase];
  return `${copy.eyebrow}. ${copy.heading.join(' ')}. ${seconds} seconds.`;
};
// How often the 3-2-1 mic check reads the level — audio.js's own sampling
// interval during capture, so the circle moves the same way before and after.
const MIC_CHECK_INTERVAL_MS = 50;

// Mirrors calibration-controller.js's own DEFAULT_PREPARATION_MS (3000ms) —
// same relationship as CALIBRATION_COUNTDOWN_SECONDS above: the controller's
// own fixed-window timer is the real source of truth for when capture may
// begin, this constant only decides what the the 3-2-1 number text
// counts down from. See startPreparationCountdown() below.
const PREPARATION_COUNTDOWN_SECONDS = 3;

// Delayed-disclosure timing for "Preparing microphone…" (calibration pacing
// revision, second pass — real-Chrome feedback showed the message could
// flash briefly enough to capture attention even when technically accurate,
// and that a flat 1s "Get ready…" beat wasn't reliably noticeable either).
// PREPARING_MESSAGE_DELAY_MS: how long audio.acquire() must remain pending
// before the message is shown at all — a fast/warm acquisition (the common
// case; see calibration-controller.js's own DEFAULT_PREPARATION_MS comment)
// never shows it. PREPARING_MESSAGE_MIN_DISPLAY_MS: once shown, the minimum
// real time it stays visible before the fixed countdown may begin, even if
// acquisition itself finishes sooner — prevents a second, equally
// unreadable flash. See the dedicated subscribe() listener below for the
// exact sequencing.
const PREPARING_MESSAGE_DELAY_MS = 500;
const PREPARING_MESSAGE_MIN_DISPLAY_MS = 500;

// Shared full-screen-decision affirmative-action timing (see the PRD's
// "Processing and Toast Feedback" requirements).
const DECISION_PROCESSING_MS = 1000;
// Toast timing — from showToast() adding the visible class to removing it,
// after which the 200ms CSS fade out runs (see .pip-toast). 2150ms
// (2026-10-26): the 150ms fade in, then about 2s fully shown.
const TOAST_VISIBLE_MS = 2150;

// Custom row-action tooltip (2026-08-20) hover delay — the approved
// ~200-300ms range, replacing reliance on the browser's own native
// title-attribute tooltip (which on Chrome takes noticeably longer, and
// duplicates this one if left in place — see buildSelectorRow()'s own
// comment). Keyboard focus shows the tooltip immediately, unaffected by
// this delay — see showTooltipFor()'s own callers.
const TOOLTIP_HOVER_DELAY_MS = 250;

// Expanded selector panel positioning (2026-08-20 manual-review fix) — the
// panel used to always extend downward from the trigger at a flat
// `top: calc(100% + 8px)`, which could push it past the Companion's own
// visible bottom edge once enough rows existed (four saved profiles was
// the reported threshold). positionSelectorPanel() (below) replaces that
// fixed offset with one computed at open time: centered within the usable
// viewport (this margin kept clear top and bottom), extending upward past
// the trigger when centering calls for it, and height-capped to whatever
// actually fits — see that function's own comment for the full algorithm.
// 16px matches the toast's own top inset, already established elsewhere
// in this file as a comfortable safe margin at this Companion size.
const SELECTOR_PANEL_SAFE_MARGIN_PX = 16;

// Brief completion transition ("Creating your speaking profile…") shown
// between the end of capture and the post-creation result screen (Slice 2
// revision) — see showCreatingTransition() below. The actual work this
// screen represents (committing the just-completed calibration to a
// Temporary profile object, or simply preparing to show the recalibration
// decision screen) is synchronous and effectively instant today, so this
// constant is the WHOLE visible duration in practice, not a floor added on
// top of real processing time — showCreatingTransition() still computes it
// as `max(0, this - elapsed-since-shown)`, so if a future change ever made
// the underlying work genuinely slower, the transition would only ever get
// longer, never shorter than this. Picked from the requested 600–800ms
// range's midpoint — long enough to register as a real, perceptible state
// change, short enough not to read as a stall.
const CREATING_TRANSITION_MIN_MS = 700;

// One product-oriented configuration source for every fixed Companion size —
// named for what they are, not for the underlying Picture-in-Picture API.
// Avoid introducing further bespoke sizes; intermediate sizes (from a user
// manually resizing) are handled by responsive CSS, not new constants.
// Ready is its own fixed size, distinct from Monitoring's Expanded size —
// the two used to share one constant, but the Ready and Monitoring cards
// have different target dimensions.
//
// Batch 2 (2026-08-09): 382×512 is the approved, fixed pre-monitoring
// content-viewport target — reference-verified against the approved
// standalone Ready-screen HTML and screenshots, not derived from this
// screen's own content the way the old 380/364 pair was. Passed directly to
// documentPictureInPicture.requestWindow() (the primary mechanism — its
// width/height are documented to describe the window's content area) and,
// as a best-effort correction only, to resizeCompanionToContent() — not the
// plain resizeCompanionTo() Monitoring uses — which measures the window's
// actual innerWidth/innerHeight first and adjusts outerWidth/outerHeight by
// only the observed gap, rather than handing window.resizeTo() (an OUTER-
// window call per the HTML spec) these same content-area numbers directly,
// which is what the pre-Batch-2-audit code did. Neither call is
// independently verifiable from this Playwright/CDP sandbox, which is
// confirmed (see tests/companion-sizing.spec.js's own header comment) to
// always render at a fixed 1280×720 regardless of what's requested — the
// real window.innerWidth/innerHeight this constant is meant to produce can
// only be confirmed on real desktop Chrome.
export const MEZZO_COMPANION_READY_WIDTH = 382;

// Fixed height — shared by every pre-monitoring screen (Welcome, the
// calibration-introduction interstitial, Calibrating, and every full-screen
// decision state, alongside Ready itself). See computeReadyContentHeight()
// below — it has no profile-count or selector-state term of any kind: this
// constant is the whole answer, unconditionally. The Ready screen's own
// selector (both collapsed and its expanded overlay panel, up to five saved
// profiles plus an unsaved one) fits and scrolls entirely within this fixed
// height — see positionSelectorPanel()'s own comment (the panel's height
// and position are computed fresh on every open, not a flat constant) —
// never by growing the window. Opening the selector does
// not call resizeCompanionTo() or resizeCompanionToContent() at all (see
// openSelectorPanel()).
export const MEZZO_COMPANION_READY_BASE_HEIGHT = 512;

const MEZZO_COMPANION_READY_SIZE = { width: MEZZO_COMPANION_READY_WIDTH, height: MEZZO_COMPANION_READY_BASE_HEIGHT };

/**
 * Ready-screen height — always MEZZO_COMPANION_READY_BASE_HEIGHT, full stop.
 * No profile-count term, no selector-state term, no addition of any kind:
 * Ready must never request more height because a saved-profile library or
 * an unsaved profile exists (Batch 2's explicit sizing requirement) — the
 * selector's own overlay panel is computed and height-capped to fit within
 * this fixed height instead (see positionSelectorPanel()), the same way it
 * already did before Batch 2 changed the target
 * from 380×364 to 382×512. Kept as an exported function, not inlined to a
 * bare constant, so every call site still reads as "the Ready screen's own
 * computed height" rather than a magic number, and so a future change that
 * genuinely does need to vary this again has exactly one place to do it —
 * that place currently does nothing but return the constant.
 *
 * Unlike the pre-Batch-2 380×364 target, 382×512 was not derived bottom-up
 * from this screen's own element min-heights — it's the approved,
 * reference-verified fixed target itself (see CLAUDE.md's Batch 2 notes).
 * .pip-screen-ready's own justify-content:center is what absorbs the
 * difference between the screen's actual content height and 512px, showing
 * up as breathing room above the heading and below the disclaimer, exactly
 * as it did at the old size — no elements were added solely to fill space.
 */
export function computeReadyContentHeight() {
  return MEZZO_COMPANION_READY_BASE_HEIGHT;
}
// Monitoring's own sizes — completely separate from the Ready/pre-monitoring
// constants above (a different object, never MEZZO_COMPANION_READY_SIZE).
// Exported, matching the Ready constants' own pattern, so this separation
// is a directly testable fact (see src/mezzo-session.test.js) rather than
// something only provable by reading source.
//
// 382×512 (2026-11-02; was 382×480, and 290×420 before 2026-08-18): the
// same size as every pre-monitoring screen, so the window doesn't change
// size between Ready and Expanded Monitoring. Compact is the only other
// size. Still its own constant, since it's applyLayoutMode()'s Expand
// target — a starting point Expand snaps to, not a ratio enforced during
// manual resize (manual resizing stays freeform; see the Monitoring CSS's
// own responsive-breakpoint comment).
export const MEZZO_COMPANION_EXPANDED_SIZE = { width: 382, height: 512 };
// 220×220 — the intentional Compact footprint: a small, square window built
// for peripheral awareness, not a shrunk-down Expanded window (was
// 220×260 — matched against the approved design direction and updated).
// No title bar (the real Document PiP window chrome covers that) and no
// wordmark/status text/profile metadata; only the visualization and the
// Stop/Expand corner-overlay controls remain.
export const MEZZO_COMPANION_COMPACT_SIZE = { width: 220, height: 220 };

const LAYOUT_MODES = Object.freeze({ EXPANDED: 'expanded', COMPACT: 'compact' });

const OUTSIDE_ZONE = 3; // "Outside Range" — there's no higher volume tier
const SUSTAINED_DRIFT_MS = 1000; // continuous time outside range before drift escalates

// Sentence case (2026-08-18 redesign, was Title Case: "Quiet" / "Within
// Range" / "Approaching End of Range" / "Outside Range") — an approved
// wording change from the accepted Monitoring design, not incidental
// drift. See CLAUDE.md's Canonical Terminology for the current, sole
// approved four labels; the zone-classification logic these map from is
// completely unchanged.
function zoneLabel(zone) {
  return ZONE_LABELS[zone] ?? ZONE_LABELS[OUTSIDE_ZONE];
}


// The Monitoring screen's read-only profile line — as of the 2026-08-18
// redesign, just the profile name itself, e.g. "Coffee Shop", set small
// and low-contrast beneath the status (see the .pip-profile-info CSS).
// Batch 4 (independent corrections) had already removed the old
// "(Custom)"/"(Unsaved)" parenthetical qualifiers this used to append —
// saved-vs-unsaved status is still fully tracked in the underlying
// profile object and still governs real behavior elsewhere (Ready's
// selector groups, save/replace/delete availability, etc.), just never
// surfaced here. This pass goes one step further and drops the leading
// "Profile: " prefix too, per the accepted design ("set small and
// low-contrast under the status — sentence case, since long names are
// hard to read in caps") — the surrounding status/position/typography
// already makes clear what this line is; the label no longer needs to
// say so. The name itself, unmodified from however it was entered/
// stored, remains the one piece of accessibility-relevant information
// this exists to convey.
export function profileMetaText(profile) {
  // A neutral fallback — there is no built-in default profile to fall back
  // to a label for. Every real profile shape reaching this function
  // (temporary, or saved via `id`) already carries a real `name`; this
  // branch is only reached with `profile` itself missing entirely (e.g.
  // before init() resolves an active profile), never with a real, named
  // profile lacking one.
  return profile?.name || 'Unknown Profile';
}

export function createMezzoSession({
  baseUrl,
  onSessionStateChange,          // (state) => void — drives the Dock's status mapping.
} = {}) {
  const pipSupported = 'documentPictureInPicture' in window;
  const sessionState = createSessionState();

  const audio = new AudioProcessor();
  const engine = new MezzoEngine();
  // One instance for this tab's whole session — used exclusively by this
  // module's own Welcome/Calibrating/Calibrated/Calibration-Failed screens
  // now (Home has no calibration UI of its own to share it with — see
  // CLAUDE.md's Engineering Notes on the retired dual-surface model).
  // Reuses this module's own `audio` (AudioProcessor) rather than a second,
  // redundant mic pipeline — calibration and monitoring are always
  // sequential, never concurrent, so one shared instance is safe: by the
  // time any commit method resolves, the controller has already fully
  // released its own hold on the mic (see calibration-controller.js's
  // micHeld-gated teardown), well before beginMonitoringSession() below
  // ever re-acquires it. See CLAUDE.md's "Calibration Controller Instance
  // Rule" — this single instance is what satisfies it for this tab.
  const calibrationController = createCalibrationController({ audio });

  // Cross-tab lease (src/calibration-lock.js) — a DIFFERENT browser tab
  // running its own Mezzo session can't hold the microphone or race this
  // tab's profile-storage writes during a calibration attempt. One instance
  // per tab, used only internally now that Home has no calibration UI of its
  // own to share it with — see calibration-lock.js's own header for why this
  // is a localStorage lease, not a second controller, and why it's kept
  // structurally separate from calibration measurement logic entirely.
  const calibrationLock = createCalibrationLock();

  // Release is centralized here, not scattered across every cancel/commit/
  // failure call site on both surfaces: 'idle' covers every commit, cancel,
  // and close (reset() always lands there, including the pagehide handler's
  // own calibrationController.cancel() call below) — 'failed' releases too,
  // since the mic is already free by the time FAILED is reached (see
  // calibration-controller.js's runCapture()); nothing is left to protect
  // through the Failed screen's "try again or back" decision. Deliberately
  // NOT gated by getOwner() — release must happen regardless of which
  // surface owned the run.
  calibrationController.subscribe((state) => {
    if (state.status === 'idle' || state.status === 'failed') {
      calibrationLock.release();
    }
  });

  // Generic reactions to controller state — 'failed' and 'calibrated'
  // always mean the same screen transition regardless of how the run got
  // there, so they're handled centrally here. 'calibrating' and 'idle'
  // are deliberately NOT handled generically: 'calibrating' is already
  // shown synchronously by whatever called startSessionCalibration()/
  // startRecalibration()/retry(), and 'idle' can mean several different
  // next screens depending on context (Ready, or navigating elsewhere
  // entirely) that a single generic handler couldn't infer safely.
  //
  // Ungated: this module is the calibration controller's one and only
  // subscriber for rendering purposes now — Home (landing.js/src/home-dock.js)
  // never starts a calibration run and has no screens of its own to render, so there is no
  // second surface's state changes to filter out here anymore. (The earlier
  // dual-surface model's CALIBRATION_OWNERS-gated version of this listener
  // is retired along with that model — see CLAUDE.md's Engineering Notes.)
  calibrationController.subscribe((state) => {
    if (state.status === 'failed') {
      showFailedScreen(state.failure);
    } else if (state.status === 'calibrated') {
      trackCalibrationCompleted();
      handleCalibrationCompleted(state);
    }
  });

  // The state.preparing false→true edge (delayed-disclosure decision for
  // "Preparing microphone…", then the the 3-2-1 countdown)
  // is handled by a dedicated listener defined alongside
  // prepareCalibratingScreen() below, since its logic depends on local
  // preparation-timer state declared there — see handleAcquisitionConfirmed().

  // Calibration-stall reliability correction (see CLAUDE.md's Engineering
  // Notes), extended for the calibration pacing revision (second pass):
  // starts the visible "Listening… {n}s" countdown AND reveals the
  // meter on state.capturing's false→true edge — the point
  // calibration-controller.js's runCapture() has confirmed
  // audio.startMonitoring() actually succeeded, not merely that it was
  // called and not merely that CALIBRATING status was set (which happens
  // before audio.acquire() even resolves, well before the fixed
  // preparation countdown even starts). Also fires the one-time "Listening
  // for 6 seconds." announcement here, and defensively stops the
  // preparation countdown (startPreparationCountdown()'s own 3→2→1 timer
  // should already have stopped itself by this point, but capture
  // beginning is the real authority on when preparation is over, not the
  // presentational countdown's own arithmetic). calibrationCountdownStarted
  // guards this to fire at most once per attempt; prepareCalibratingScreen()
  // resets it to false at the start of every fresh attempt/retry. A
  // dedicated listener, not folded into the generic one above, since it
  // reacts to a different signal (a field, not a status transition) for a
  // different purpose (presentational timing, not screen routing).
  calibrationController.subscribe((state) => {
    if (state.capturing && !calibrationCountdownStarted) {
      calibrationCountdownStarted = true;
      stopPreparationCountdown();
      stopMicCheck();
      clearPreparingMessageTimers();
      if (calibratingStatusEl) calibratingStatusEl.textContent = '';
      setCalibratingPhase('voice');
      levelMeter?.start();
      if (calibratingAnnounceEl) calibratingAnnounceEl.textContent = listeningAnnouncement('voice', CALIBRATION_COUNTDOWN_SECONDS);
      startCalibratingCountdown();
    }
  });

  let pipCircle = null;
  let activeCircle = null;
  let pipWindow = null;
  let pipDocument = null;
  let baselineRMS = 0;
  let activeProfile = null;
  let isMonitoringActive = false;
  // True while Start monitoring (or a Reopen that resumes it) waits for the
  // microphone: a Companion closed in that window still releases it and
  // still offers to resume (handlePipClose()).
  let monitoringStarting = false;
  let isPageUnloading = false;
  // Reopen Companion (2026-10-23). Only endSession() (Home's Close Companion
  // link) closes the Companion on purpose from this page's side; the
  // native ✕ and being replaced by another picture-in-picture window (Meet's
  // mini window, screen sharing) look the same from inside, so either of
  // those leaves a reopen offer: the profile (an unsaved one included, still
  // in memory only) and whether monitoring was running. Home shows Reopen
  // and Done; Reopen restores both, Done drops the offer.
  let closingOnPurpose = false;
  let reopenOffer = null;     // { profile, unsaved, resumeMonitoring } | null
  let pendingRestore = null;  // the offer being reopened, read once the window exists

  // Explicit, Companion-internal — never inferred from pipWindow's actual
  // dimensions. Only meaningful while sessionState is monitoringActive;
  // every other state is unconditionally Expanded regardless of this value.
  let layoutMode = LAYOUT_MODES.EXPANDED;

  // Welcome/01-screen DOM ref — reached exactly once, the first time the
  // Companion ever opens with zero saved profiles (see showWelcomeScreen()).
  let welcomeScreenEl = null;

  // C1 — calibration-introduction interstitial, shown before every
  // session-mode calibration: Welcome's own primary action
  // (handleWelcomeCalibrateClick()) and Ready's Create new profile
  // (handleCreateNewProfileClick()) both route through it. Recalibrate
  // (saved or unsaved profile) is the one calibration entry that skips it,
  // going straight to Calibrating instead — see beginCalibrationFlow()'s own
  // callers below for the resolved rule (this PRD's own §19 flagged the
  // recalibrate case as an open item; "Create new profile" was not — see
  // docs/prd/ready-screen-speaking-profiles-mvp.md's §12 State Transitions).
  // The two calibration prep screens (Step 1, the room; Step 2, the voice).
  let prepScreenEls = { 1: null, 2: null };
  // The "Recalibrating {name}" header bar on the screens of a saved
  // profile's recalibration that aren't decision screens (both prep
  // screens, the listening screen, the processing screen): [{ screen, label }].
  // See applyRecalibrationBar().
  let recalibrationBars = [];
  let m1BarTitleEl = null; // the result screen's own bar, same label
  let prepHeadingEls = { 1: null, 2: null };

  // What the current calibration is, and where it started: set when Step
  // 1's prep screen opens, read by Step 1's "I'm ready", by every Cancel
  // (which returns to `source`: Welcome for first-time setup, Ready
  // otherwise) and by Try again. Never inferred from profile counts.
  // { mode: 'session'|'recalibrate', targetProfileId, source: 'welcome'|'ready', recalibratingName }
  let calibrationIntent = null;
  // True once Step 1 has measured the room in the current calibration, so
  // a failed voice capture's Try again returns to Step 2's prep screen.
  let roomStepDone = false;

  // C0 — dedicated microphone-blocked screen, reached instead of the
  // generic Calibration Failed screen for MIC_PERMISSION_DENIED and
  // MIC_ACQUISITION_TIMEOUT alike (see showFailedScreen()). Heading/body
  // are re-set per failure code on every show (see showC0Screen()) rather
  // than fixed at DOM-build time, so the two failure codes can render
  // distinct, honest copy on the one shared screen/illustration/actions.
  let c0ScreenEl = null;
  let c0HeadingEl = null;
  let c0BodyEl = null;

  // Ready-screen DOM refs, (re)assigned each time startMonitoring() builds
  // the document. The approved selector model (see
  // docs/prd/ready-screen-speaking-profiles-mvp.md): a collapsed trigger
  // that expands into an overlay panel — own internal scroll, absolutely
  // positioned within the card's own bounds, never resizes the window (see
  // MEZZO_COMPANION_READY_BASE_HEIGHT's own comment) — with grouped
  // Unsaved/Saved rows, followed by contextual text-link actions and Start
  // monitoring, both rendered fresh on every selection change.
  let readyScreenEl = null;
  let readyHeadingEl = null;
  let readySelectorTriggerEl = null;
  let readySelectorTriggerNameEl = null;
  let readySelectorPanelEl = null;
  let readyScrimEl = null;
  let readyContextualActionsEl = null;
  let readyStartBtn = null;
  let readyDisclaimerEl = null;
  let selectorExpanded = false;

  // Full-screen decision states — the post-creation completion transition
  // (creatingScreenEl) and result screens (Slice 2's "Your new speaking
  // profile is ready", Variant 1 = resultScreenEl, Variant 2 = m1ScreenEl),
  // M2/M2a (name/replace a new profile), M3 (five-profile limit), and 06b
  // (delete confirmation). Each is a genuinely separate screen (see
  // CLAUDE.md: never one screen with elements toggled), built from the
  // shared .pip-screen-decision visual vocabulary. Variant 1 and Variant 2
  // now share one static heading/body pair — only Variant 2's primary
  // button label is still dynamic (see replaceButtonLabel()).
  let m1ScreenEl = null;
  let m1HeadingEl = null;
  let m1BodyEl = null;
  let m1ReplaceBtn = null;
  let m1KeepBtn = null;
  let m1DiscardBtn = null;

  // "Your new speaking profile is ready" (Slice 2, Variant 1) — reached
  // from a session-mode calibration's completion (a brand-new profile, or
  // redoing for the current Temporary profile — both are session mode; see
  // handleCalibrationCompleted() below). Static copy throughout.
  let resultScreenEl = null;
  let resultTipEl = null; // NOISY_ROOM_TIP on the new-profile result
  let m1TipEl = null;     // and on the recalibration result
  let resultHeadingEl = null;
  let resultSaveBtn = null;
  let resultKeepBtn = null;
  let resultDiscardBtn = null; // see priorProfileBeforeCreation

  // "Creating your speaking profile…" — the brief completion transition
  // (Slice 2 revision) between real capture ending and a result screen
  // appearing. See showCreatingTransition() below for the timing model.
  let creatingScreenEl = null;
  let creatingAnnounceEl = null; // visually-hidden aria-live region — one announcement, as this screen appears
  let creatingTransitionTimer = null;

  // Variant 1's own Discard needs to know what was selected before the
  // CURRENT "new speaking profile" creation flow began, so it can restore
  // that selection rather than merely falling back to some default. Set
  // once, at the first beginCalibrationFlow('session', ...) call of a given
  // flow (never overwritten by a later Redo within the same flow, so
  // Discard can undo the whole flow, not just its most recent take);
  // consumed and reset back to `undefined` whenever the flow concludes
  // (Save, Keep temporarily, Discard itself, a Calibrating-screen Cancel,
  // or the Companion closing). `undefined` means "no session-mode creation
  // flow is currently in progress"; `null` is itself a valid snapshot
  // (nothing was selected beforehand). Variant 2 (recalibrating a saved
  // profile) never needs this: activeProfile is never reassigned during
  // that flow until a commit, so its own Discard already just falls back to
  // the untouched original selection — see handleM1Discard().
  let priorProfileBeforeCreation;

  let m2ScreenEl = null;
  let m2WarningEl = null;
  let m2NameInput = null;
  let m2SubmitBtn = null;
  // Where M2's own Cancel returns to — 'ready' (the existing, default entry
  // point: Ready's own "Save profile" contextual link) or 'result' (Slice
  // 2's "Speaking profile ready" screen's own Save profile button). Only
  // Cancel branches on this — a successful save always returns to Ready
  // regardless of origin (see handleM2Submit()), so this is deliberately
  // narrower than a general "where did M2 come from" state: it exists
  // purely to satisfy "cancelling the save flow returns to the result
  // screen with the calibration still available" without a second M2
  // implementation. Set by showM2Screen(); read and reset by handleM2Cancel().
  let m2ReturnTo = 'ready';

  let m3ScreenEl = null;
  let m3BodyEl = null;
  let m3CloseBtn = null;

  let deleteScreenEl = null; // 06b
  let deleteHeadingEl = null; // full "Delete "{name}"?" text set live in openDeleteScreen()
  let deleteConfirmBtn = null;
  let deleteCancelBtn = null;
  let deleteErrorEl = null; // failure copy — see deleteSavedProfile()'s error branch in handleDeleteConfirm()

  // Toast — a save/replace confirmation, floated above whichever screen is
  // visible (a sibling of every .pip-screen, not owned by any one of them).
  let toastEl = null;
  let toastCardEl = null;
  let toastTextEl = null;
  let toastHideTimer = null;

  // Custom row-action tooltip (2026-08-20) — a single shared element (same
  // "one instance, one sibling of every .pip-screen" pattern the toast
  // above already uses), reused for both the Recalibrate and Delete/
  // Discard row icons; only one can ever be visible at once by
  // construction, since there is only ever one DOM node. tooltipTargetEl
  // tracks which button (if any) currently owns it, so a mouseleave/blur
  // firing for a button that isn't the current owner (e.g. a stale event
  // from a row already replaced by a re-render) can't hide a tooltip some
  // other, newer interaction just showed.
  let tooltipEl = null;
  let tooltipShowTimer = null;
  let tooltipTargetEl = null;

  let pendingDeleteProfileId = null;

  // Monitoring-screen DOM refs
  let monitoringScreenEl = null;
  // Visually hidden live region (PRD §6): the four status labels are
  // screen-reader-only now, announced through zoneAnnouncer.
  let pipZoneLiveEl = null;
  const zoneAnnouncer = createZoneAnnouncer({
    announce: (text) => { if (pipZoneLiveEl) pipZoneLiveEl.textContent = text; },
  });
  let monitoringProfileNameEl = null;
  let pipCircleWrapperEl = null;

  // Calibrating-screen (C2) DOM refs
  let calibratingScreenEl = null;
  let calibratingSubheadingEl = null; // mode-aware "Recalibrating {name}" line — session mode leaves it empty
  let calibratingStatusEl = null; // aria-hidden visible text: blank, then (if shown) "Preparing microphone…", blank during the 3-2-1 (calibratingCountEl shows the number), then a live "Listening… {n}s" countdown
  let calibratingAnnounceEl = null; // visually-hidden aria-live region — exactly two one-time announcements, see its own construction comment above
  let levelMeter = null; // MezzoLevelMeter: six segments following the live level (3-2-1 mic check, then capture)
  let calibratingHintEl = null; // the helper under the meter (LISTENING_COPY)
  let calibratingHeadingEl = null; // the instruction (LISTENING_COPY)
  let calibratingCountEl = null; // the large countdown: 3 to 1, then 6 to 1
  let creatingTextEl = null; // "Saving your calibration…" (a saved profile) or "Creating your speaking profile…"
  let micCheckTimer = null; // reads the mic level during the 3-2-1 so the circle can react before capture — see startMicCheck()
  let calibratingCountdownTimer = null;
  // Guards the countdown's false→true "start exactly once per attempt"
  // requirement — reset in prepareCalibratingScreen() at the top of every
  // fresh attempt/retry, flipped true by the calibrationController.subscribe()
  // listener below the first time state.capturing reads true for that
  // attempt. Without this, a second capturing:true notification for the
  // same attempt (there isn't one today, but nothing prevents it structurally)
  // would otherwise restart the countdown from 6 mid-capture.
  let calibrationCountdownStarted = false;

  // Preparation-stage local timing state (calibration pacing revision,
  // second pass — delayed disclosure + fixed 3-2-1 countdown). None of this
  // is calibration-controller.js's concern: the controller only knows
  // "preparing:true started" and "beginCountdown() was called" — the
  // decision of WHEN to call beginCountdown() (immediately, for a fast
  // acquisition; after a minimum-display wait, for a slow one) is a
  // presentation-layer timing decision this module owns instead. See the
  // dedicated calibrationController.subscribe() listener below for how
  // these are used, and prepareCalibratingScreen()/stopPreparationCountdown()
  // for where they're reset/cleared.
  let preparingMessageDelayTimer = null; // fires PREPARING_MESSAGE_DELAY_MS after acquisition begins; shows "Preparing microphone…" if acquisition is still pending
  let preparingMessageMinDisplayTimer = null; // once the message is shown, guarantees it stays up for PREPARING_MESSAGE_MIN_DISPLAY_MS before beginCountdown() fires
  let preparingMessageShown = false; // true once "Preparing microphone…" has actually been rendered this attempt — decides whether the min-display wait applies at all
  let preparingMessageShownAt = 0; // Date.now() at the moment the message actually rendered — 0 (unused) whenever preparingMessageShown is false
  let preparationCountdownTimer = null; // drives the visible/announced the 3-2-1 ticks, started only once beginCountdown() is actually called
  // Guards state.preparing's false→true edge to run at most once per
  // attempt — reset in prepareCalibratingScreen(), same pattern/reasoning
  // as calibrationCountdownStarted below for the capturing:true edge. See
  // handleAcquisitionConfirmed()'s own doc comment.
  let preparingHandled = false;

  // Calibration Failed-screen DOM refs
  let failedScreenEl = null;
  let failedMessageEl = null;

  // The unsaved (temporary) profile for this Companion-open lifetime — held
  // purely in memory, never sessionStorage: Document PiP shares the opener
  // tab's storage, so anything written there would incorrectly survive a
  // native Companion close (see CLAUDE.md's canonical temporary-profile
  // shape). At most one exists at a time — a fresh calibration (whether
  // reached via Recalibrate of the unsaved profile itself, or Create new
  // profile from a saved-profile selection) always replaces whichever one
  // existed before, never adds a second.
  let unsavedProfile = null;

  // Whichever contextual-action/row button opened the currently-visible
  // full-screen decision state, if any — restored focus on returning to
  // Ready, so keyboard/screen-reader users land back where they started
  // rather than at the top of the screen.
  let decisionTriggerEl = null;

  // Reentrancy guard shared by every decision-state affirmative action
  // (M1/M2/M2a/06b) — the brief processing state each renders is what makes
  // a rapid double Enter/click visible in the first place, so one shared
  // flag is enough: only one decision screen is ever visible at a time.
  let decisionCommitInFlight = false;

  let unsubscribeCalibrationLevel = null; // Calibrating screen's live-level subscription — torn down whenever that screen isn't active

  let currentZone = 0;
  let isSustained = false;
  let sustainedTimer = null;

  let monitoringStartTime = null;
  let sessionAlertTriggered = false;

  // Round 4 study mode (src/study.js). The glow counter runs for every
  // session but only reads the zone the engine already committed; its
  // result is kept, and the check-in card shown, only while a tester code
  // is saved. studyResume carries the interrupted session into Reopen
  // Companion's resumed monitoring, so one call stays one session.
  const glowCounter = createGlowCounter({ outsideZone: OUTSIDE_ZONE });
  let studyResume = null;
  let studyCardEl = null;
  let studyCardOpenEl = null;
  let studyCardSession = null;
  let studyCardTimer = null;
  // Opening or skipping the check-in in any view (or a session ending)
  // re-renders the card here too; renderStudyCard() is a no-op until the
  // Companion has built it.
  onCheckInChange(() => renderStudyCard());

  function clearSustained() {
    if (sustainedTimer) { clearTimeout(sustainedTimer); sustainedTimer = null; }
    isSustained = false;
  }

  /** No visible text changes during monitoring (PRD §6): zone changes only
   *  reach the debounced screen-reader announcer. */
  function updateHeading(zone) {
    if (sessionState.get() === SESSION_STATES.MONITORING_ACTIVE) zoneAnnouncer.update(zone);
    if (monitoringScreenEl) monitoringScreenEl.dataset.zone = String(zone);
  }

  function onAudioFrame({ rms, rawRms }) {
    // Explicit real timestamp, not engine.js's own performance.now() default —
    // keeps the caller in control of the clock the Outside-of-Range entry
    // dwell (see OUTSIDE_ENTRY_DWELL_MS in engine.js) measures against.
    // Zones read the raw per-frame level (zoneInputRaw: audio.js's EMA would
    // add 50-150ms on top of the zone window), and only frames the circle's
    // own gate counts as voice go into that window (voicedOnly).
    const zoneInput = DEFAULT_ZONE_SETTINGS.zoneInputRaw && Number.isFinite(rawRms) ? rawRms : rms;
    const voiced = activeCircle ? activeCircle.gateOpen : true;
    const frameAt = performance.now();
    engine.processFrame(zoneInput, frameAt, voiced);
    // Study speaking time: the same gate verdict, only read (study.js).
    glowCounter.onFrame(voiced, frameAt);
    markClassification(); // TEMPORARY — see docs/monitoring-runtime-investigation.md

    const zone = engine.getZone();

    if (zone !== currentZone) {
      const wasOutside = currentZone === OUTSIDE_ZONE;
      const nowOutside = zone === OUTSIDE_ZONE;

      updateHeading(zone);
      currentZone = zone;
      glowCounter.onZone(zone);

      if (nowOutside && !wasOutside) {
        sustainedTimer = setTimeout(() => {
          sustainedTimer = null;
          isSustained = true;
          sessionAlertTriggered = true;
        }, SUSTAINED_DRIFT_MS);
      } else if (!nowOutside && wasOutside) {
        clearSustained();
      }
    }

    // The Range Ring reads the committed zone and the engine's own
    // boundaries; it never classifies. It follows the raw, per-sample level
    // (eased in its own loop — see range-ring.js's followLevel()), while
    // the engine above classifies from audio.js's EMA-smoothed level.
    // isSustained (SUSTAINED_DRIFT_MS) is no longer a visual input — it
    // still feeds sessionAlertTriggered above.
    if (activeCircle) {
      activeCircle.update({ zone: currentZone, rawRms: rawRms ?? rms, bounds: engine.getRangeBoundsDb() });
      markPipUpdate(pipWindow); // TEMPORARY — see docs/monitoring-runtime-investigation.md
    }

    const diff = rms - baselineRMS;
    console.log(`[Session] baseline=${baselineRMS.toFixed(4)}  rms=${rms.toFixed(4)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(4)}  zone=${currentZone}  sustained=${isSustained}  ${zoneLabel(currentZone)}`);
  }

  /** @returns {Promise<boolean>} false if mic acquisition failed */
  async function beginMonitoringSession(profile) {
    activeProfile = profile;
    // setLastUsedProfile() silently refuses a temporary profile on its own
    // (src/profiles.js) — but setSelectedProfile() has no such guard (it
    // stores whatever it's given), so it needs the check here: without this,
    // starting monitoring from a never-saved session-mode calibration would
    // overwrite this tab's real remembered selection (sessionStorage) with a
    // temporary profile object. That stale entry would then outlive the
    // temporary profile itself — discarded on Stop/close everywhere else,
    // but still sitting in storage — and resolveActiveProfile() would hand
    // it back as this tab's "own session choice" on the next Companion open,
    // silently masking whatever real saved profile the user had selected
    // before. Only a genuine saved profile should ever become this tab's
    // remembered selection.
    if (!isTemporaryProfile(profile)) setSelectedProfile(profile);
    setLastUsedProfile(profile);

    baselineRMS = Math.pow(10, profile.speakingDb / 20);
    // loadCalibration(), not calibrate() against a synthetic sample array —
    // this profile's calibration was already validated once when it was
    // first calibrated (or last recalibrated); re-deriving it from a fake
    // uniform-fill array would silently discard its real spreadDb (a
    // uniform array always measures spread as ~0) — see engine.js's own
    // loadCalibration() doc comment.
    // peakOffsetDb: the calibration's peak, which sets the end of range.
    // Profiles saved before peaks were recorded have none and fall back to
    // the spread rule (see needsRecalibration()).
    engine.loadCalibration({ baselineRMS, spreadDb: profile.spreadDb, peakOffsetDb: profile.peakDb });
    engine.startMonitoring();

    currentZone = 0;
    clearSustained();
    zoneAnnouncer.reset();
    if (pipZoneLiveEl) pipZoneLiveEl.textContent = '';
    if (monitoringScreenEl) monitoringScreenEl.dataset.zone = '0';

    monitoringStarting = true;
    try {
      await audio.acquire();
    } catch (err) {
      // AbortError: the Companion closed while the mic was on its way, and
      // handlePipClose() already released it.
      if (err?.name === 'AbortError') console.log('[Session] Monitoring not started: the Companion closed first');
      else console.error('[Session] Mic acquisition failed:', err.message);
      return false;
    } finally {
      monitoringStarting = false;
    }
    // Defensive: never monitor without a Companion.
    if (!pipWindow) {
      audio.release();
      return false;
    }

    audio.onLevelChange = onAudioFrame;
    audio.startMonitoring();

    isMonitoringActive = true;
    monitoringStartTime = Date.now();
    sessionAlertTriggered = false;
    glowCounter.start(studyResume);
    studyResume = null;
    hideStudyCard();
    trackMonitoringStarted();
    // One-way — see the Ready-screen PRD's first-conversation rule
    // (§2 in the implementation spec): only ever set here, the one place
    // monitoring actually, successfully begins. Never set on calibrate,
    // save, replace, select, or a decision-state opening.
    setHasStartedMonitoring();
    return true;
  }

  /** Stops audio/engine/analytics — the shared "actual stop" work behind both
   *  a normal Stop Monitoring click and the Companion closing mid-session. */
  function teardownMonitoringEngine() {
    finishStudySession();
    if (monitoringStartTime) {
      const durationSeconds = Math.round((Date.now() - monitoringStartTime) / 1000);
      trackMonitoringSession({
        durationSeconds,
        usedPip: true, // always true now — there is no no-Companion-support fallback path anymore
        alertTriggered: sessionAlertTriggered,
      });
      monitoringStartTime = null;
    }

    isMonitoringActive = false;
    engine.stopMonitoring();
    audio.stopMonitoring();
    audio.release();

    clearSustained();
    currentZone = 0;
  }

  /** Ends the study session (if one is running) and keeps it as the last
   *  session when a tester code is saved. Runs on every way monitoring ends:
   *  Stop, the Companion closing, and this page closing. */
  function finishStudySession() {
    const session = glowCounter.stop();
    if (session) saveLastSession(session);
    return session;
  }

  /** Round 4 study check-in card, at the foot of Ready. Shown only with a
   *  saved tester code, for a session of at least 5 minutes, with at least
   *  1 minute of speech, that ended under 2 hours ago and wasn't already opened or skipped (src/study.js's
   *  shouldShowCheckInCard()). Read from storage, so it also appears the
   *  next time the Companion opens after a session ended by closing it. */
  function renderStudyCard() {
    if (!studyCardEl || !studyCardOpenEl) return;
    clearStudyCardTimer();
    const testerCode = getTesterCode();
    // While Reopen Companion is about to resume the interrupted session,
    // that session isn't over: no card for it.
    const session = studyResume ? null : getLastSession();
    const mezzoStageStartAt = getMezzoStageStartAt();
    const now = Date.now();
    // After the study's 14 days the card stops (the tester code stays).
    if (!shouldShowCheckInCard({ testerCode, session, now, mezzoStageStartAt })) {
      hideStudyCard();
      return;
    }
    studyCardSession = session;
    studyCardOpenEl.href = studyCheckInUrl(testerCode, session, now);
    studyCardEl.classList.remove('hidden');
    // Leaves on its own once the 2-hour window closes or the study ends.
    const leavesAt = Math.min(checkInExpiresAt(session), wrapUpOpensAt(mezzoStageStartAt) ?? Infinity);
    studyCardTimer = pipWindow?.setTimeout(renderStudyCard, Math.max(0, leavesAt - now) + 50) ?? null;
  }

  function studyCheckInUrl(testerCode, session, now) {
    return buildCheckInUrl({
      testerCode,
      browserId: getBrowserId(),
      source: STUDY_CONFIG.sources.companion,
      session,
      now,
    });
  }

  function clearStudyCardTimer() {
    if (studyCardTimer !== null) {
      try { pipWindow?.clearTimeout(studyCardTimer); } catch { /* window already gone */ }
      studyCardTimer = null;
    }
  }

  function hideStudyCard() {
    clearStudyCardTimer();
    studyCardSession = null;
    studyCardEl?.classList.add('hidden');
    studyCardOpenEl?.removeAttribute('href');
  }

  function handleStudyCardOpen() {
    const session = studyCardSession;
    if (!session) return;
    // Fresh "minutes since the session ended" at the moment of the click.
    const testerCode = getTesterCode();
    if (testerCode) studyCardOpenEl.href = studyCheckInUrl(testerCode, session, Date.now());
    markCheckInHandled(session.id, 'opened');
    // Hide after the new tab has its URL; removing href now would cancel it.
    pipWindow?.setTimeout(hideStudyCard, 0);
  }

  function handleStudyCardSkip() {
    const session = studyCardSession;
    if (session) markCheckInHandled(session.id, 'skipped');
    hideStudyCard();
    readyStartBtn?.focus();
  }

  function stopMonitoring() {
    if (!pipWindow) return; // defensive — Stop only ever exists inside the Companion now

    teardownMonitoringEngine();

    // The Companion stays open — Document PiP does not survive its opener
    // navigating away, so doing so would silently kill the window. Always
    // returns straight to Ready: a temporary profile simply stays selected
    // and usable (see the PRD's Unsaved-Profile Ready States) rather than
    // forcing a save decision before the user can do anything else —
    // showReadyScreen(), not enterPipReadyMode(), since activeProfile (still
    // set, whether temporary or saved) means this is never genuinely the
    // zero-saved-profiles Welcome case.
    showReadyScreen();
  }

  /**
   * Best-effort resizes the actual window to a given fixed size. Resizing an
   * already-open Document PiP window isn't guaranteed by every browser — if
   * it's unsupported or blocked, the layout still renders correctly at
   * whatever size the window actually is; explicit state, not window
   * dimensions, decides which content shows. Monitoring-only as of Batch 2's
   * audit correction below — every pre-monitoring screen uses
   * resizeCompanionToContent() instead, since window.resizeTo() itself
   * operates on outerWidth/outerHeight (chrome-inclusive), and handing it
   * the same numbers requested as a *content*-area target (as this function
   * does, unchanged, still correct for its own Monitoring callers, which
   * have never claimed a content-viewport guarantee) is exactly the
   * mismatch that helper exists to correct for pre-monitoring's own,
   * explicit 382×512 content-viewport requirement.
   */
  function resizeCompanionTo(size) {
    if (!pipWindow) return;
    try {
      pipWindow.resizeTo(size.width, size.height);
    } catch (err) {
      console.warn('[Session] Could not resize the Mezzo Companion:', err.message);
    }
  }

  /**
   * Pre-monitoring-only content-aware resize (Batch 2 audit correction) —
   * replaces the old blind resizeCompanionTo(target) call (an OUTER-window
   * resizeTo() being handed CONTENT-area numbers) with a measure-first
   * correction: reads the window's actual innerWidth/innerHeight, and only
   * ever adjusts outerWidth/outerHeight by the OBSERVED gap between that and
   * the target — never assumes a fixed chrome inset, never blindly sets
   * outer=target the way the old call did. Platform-tolerant by
   * construction: zero chrome means the delta is 0 (an effective no-op);
   * real chrome means this corrects for exactly however much exists, on
   * whatever OS/Chrome version this happens to be — never a hardcoded
   * assumption either way.
   *
   * Still a best-effort correction, not a guarantee: nothing here (or
   * anywhere in JavaScript) can force Chrome to honor a resize it chooses to
   * clamp or ignore outright — the same caveat resizeCompanionTo() itself
   * already carried. If the measurements this depends on aren't usable
   * (missing, non-finite, zero, or negative — e.g. a browser that doesn't
   * expose them the way this assumes), this deliberately does NOT fall back
   * to a blind resizeTo(target.width, target.height): that blind call is
   * the exact behavior being corrected, not a safe default to land on when
   * uncertain.
   *
   * Called both right after requestWindow() resolves and on every
   * pre-monitoring screen transition (Welcome/C1/Calibrating/every decision
   * state/Ready) — the repeated calls stay, so a user's manual resize
   * between screens still gets corrected back, but because this measures
   * first, a call where nothing has actually drifted is a genuine no-op
   * rather than a wasted (or actively harmful) resizeTo() invocation.
   *
   * Also guards against a computed, non-positive resize target — found via
   * this correction's own focused Playwright coverage (not assumed): this
   * Playwright/CDP sandbox's real PiP window leaves innerWidth/innerHeight
   * permanently locked at its fixed automation viewport but *does* let
   * outerWidth/outerHeight drift after a resizeTo() call, an asymmetry real
   * desktop Chrome isn't expected to have (there, outer and inner move
   * together). Left uncorrected, a later call's delta math against that
   * drifted outerWidth against a still-locked innerWidth can compute a
   * negative width/height — never a value any real caller should hand to
   * resizeTo(). Same "no blind fallback" policy as the measurement-usability
   * check above: skip the call outright rather than clamp to some
   * arbitrary substitute size.
   */
  function resizeCompanionToContent(target) {
    if (!pipWindow) return;
    try {
      const { innerWidth, innerHeight, outerWidth, outerHeight } = pipWindow;
      const usable = [innerWidth, innerHeight, outerWidth, outerHeight].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
      );
      if (!usable) return; // no blind fallback — see this function's own doc comment
      if (innerWidth === target.width && innerHeight === target.height) return; // already correct
      const deltaW = target.width - innerWidth;
      const deltaH = target.height - innerHeight;
      const nextWidth = outerWidth + deltaW;
      const nextHeight = outerHeight + deltaH;
      if (nextWidth <= 0 || nextHeight <= 0) return; // computed target is nonsensical — see this function's own doc comment
      pipWindow.resizeTo(nextWidth, nextHeight);
    } catch (err) {
      console.warn('[Session] Could not resize the Mezzo Companion:', err.message);
    }
  }

  // forceInitialCompanionSize() — the JS-side initial-sizing correction
  // that used to live here (first a single same-tick call, then a
  // double-rAF-gated attempt, then a several-hundred-ms time-spread retry
  // schedule) — was retired outright (2026-08-19), not merely simplified.
  // Confirmed why no version of it could ever have been a reliable fix,
  // not just an insufficiently-tuned one: resizeTo()/resizeBy() on a
  // Document Picture-in-Picture window require transient user activation
  // per spec, which a setTimeout/requestAnimationFrame callback firing
  // after the opening click has already returned is not reliably still
  // holding — no amount of retrying or spreading those calls out over
  // time could fix a mechanism the platform itself won't honor outside a
  // real, current user gesture. The actual, sanctioned fix is
  // requestWindow()'s own preferInitialWindowPlacement option — see its
  // call site's doc comment in startMonitoring() above. Welcome's/Ready's
  // own showXScreen() functions still each call resizeCompanionToContent()
  // synchronously on every show (unchanged) — that's legitimate, real
  // user-gesture-driven correction for a manual resize made mid-session on
  // a different screen, not the initial-open case this removal concerns.

  /**
   * Applies an explicit Monitoring layout mode: updates the state variable,
   * flips the data-layout attribute that the Compact/Expanded CSS keys off
   * (the intentional, state-driven presentation), and resizes to that
   * layout's fixed size. Ready has its own fixed size and resize path (see
   * enterPipReadyMode) — this is Monitoring-only.
   */
  function applyLayoutMode(mode) {
    layoutMode = mode;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', mode);
    // Expanded sizes the content area, like Ready (resizeCompanionToContent),
    // so the two match exactly and Stop from Expanded doesn't grow the
    // window by the title bar. Compact keeps its outer 220×220.
    if (mode === LAYOUT_MODES.COMPACT) resizeCompanionTo(MEZZO_COMPANION_COMPACT_SIZE);
    else resizeCompanionToContent(MEZZO_COMPANION_EXPANDED_SIZE);
    pipCircle?.relayout(); // the ring's preferred edge depends on the mode
  }

  function enterExpandedLayout() {
    applyLayoutMode(LAYOUT_MODES.EXPANDED);
  }

  function enterCompactLayout() {
    // Compact is only ever offered while monitoring — Ready has no Compact
    // variant, so this is a no-op otherwise.
    if (sessionState.get() !== SESSION_STATES.MONITORING_ACTIVE) return;
    applyLayoutMode(LAYOUT_MODES.COMPACT);
  }

  /**
   * Requests microphone permission on Home, independent of the Companion —
   * the one narrow, deliberate exception to "microphone access is
   * Companion-only" (see CLAUDE.md's Non-Negotiable Decisions: "permission
   * should follow understanding"). Home calls this only after explaining why
   * Mezzo needs mic access and the user has explicitly asked to enable it —
   * never on page load, never merged into startMonitoring() below — so a
   * first-time user is never shown the browser's raw permission prompt out
   * of context, and launching the Companion stays a separate, later,
   * explicit action rather than something this call triggers itself.
   *
   * Acquires and immediately releases: this is a probe, not a hold. Its only
   * job is confirming (or triggering) the permission grant — not keeping the
   * microphone open while the user is still on Home deciding whether to
   * launch the Companion. Reuses this module's own `audio` (AudioProcessor)
   * instance directly, the same one calibrationController holds — never a
   * second, parallel acquisition path (see the Calibration Controller
   * Instance Rule in CLAUDE.md). Deliberately bypasses calibrationController
   * itself: this is a plain permission probe, not a calibration attempt, so
   * none of its mode/state machinery should be touched. Because the browser
   * persists the grant per origin, calibration's own later `audio.acquire()`
   * call (inside the Companion, unchanged) simply resolves silently once
   * this has succeeded — no second prompt, and no reliance on whether a
   * PiP-triggered prompt would even work.
   * @returns {Promise<boolean>} whether microphone access was granted
   */
  async function requestMicrophoneAccess() {
    try {
      await audio.acquire();
    } catch (err) {
      console.warn('[Session] Microphone access denied:', err.message);
      return false;
    }
    audio.release();
    return true;
  }

  /**
   * Opens the Mezzo Companion — Home's one action for actually launching it,
   * with no arguments: Home never chooses a profile and never decides what
   * screen the Companion opens to. Microphone permission is no longer this
   * function's concern either — see requestMicrophoneAccess() above, a
   * separate, earlier action Home calls only once it already has a grant, so
   * this call and the permission prompt are never the same user gesture.
   * Once the window and its document exist, the Companion resolves its own
   * entry state from src/profiles.js's storage (see enterPipReadyMode()
   * near the bottom of this function) — Welcome for zero saved profiles,
   * Ready for one or more — never straight into Monitoring. Call directly
   * from a real click (this is what satisfies Document PiP's
   * fresh-user-gesture requirement now that the caller is index.html's own
   * page, not a separate window relaying the gesture).
   * @returns {Promise<boolean>} whether the Companion actually opened
   */
  async function startMonitoring() {
    if (!pipSupported) {
      console.warn('[Session] Document PiP API not supported');
      return false;
    }

    try {
      // Ready's size, not Monitoring's Expanded size — every open now lands
      // on a pre-monitoring screen first, never straight into Monitoring,
      // so requesting the window at the size it'll actually need avoids a
      // visible resize flash immediately after opening. Every pre-
      // monitoring screen (Welcome/01, Ready, Calibrating, and every
      // full-screen decision state) now shares this one fixed size — see
      // MEZZO_COMPANION_READY_BASE_HEIGHT's own comment for why Ready's
      // height stopped depending on saved-profile count.
      //
      // preferInitialWindowPlacement: true (2026-08-19, replaces the
      // retired forceInitialCompanionSize() correction — see the note left
      // in its place just above startMonitoring()) — the
      // Document Picture-in-Picture spec's own, browser-native answer to
      // "a returning user's previously-honored manual resize" (Chrome
      // 130+): it tells the browser not to reuse the previous Document PiP
      // window's remembered position/size for this open, so width/height
      // above are what actually get honored rather than a stale manual
      // size the window otherwise remembers across opens. This replaces a
      // whole prior generation of JS-side correction attempts (a
      // same-tick resizeCompanionToContent() call, then a double-rAF-gated
      // one, then a several-hundred-ms time-spread retry schedule) that
      // were never structurally capable of fixing this: per spec,
      // resizeTo()/resizeBy() on a Document PiP window require transient
      // user activation, which a setTimeout/requestAnimationFrame callback
      // firing after the opening click has already returned does not
      // reliably still have. No amount of retrying or spreading those
      // calls out over time could fix a mechanism the platform itself
      // won't honor outside a real, current user gesture — this option is
      // the actual, sanctioned fix, not another timing adjustment. Welcome's
      // and Ready's own showXScreen() functions still each call
      // resizeCompanionToContent() themselves on every show (unchanged,
      // and legitimate to keep: each is reached via a real, synchronous
      // in-window click — Cancel, Discard, Recalibrate, Stop, and so on —
      // so a manual resize made mid-session, on a different screen, still
      // gets corrected on the next real user-initiated transition, under
      // that click's own valid activation, not a deferred timer's).
      pipWindow = await documentPictureInPicture.requestWindow({
        ...MEZZO_COMPANION_READY_SIZE,
        preferInitialWindowPlacement: true,
      });
    } catch (err) {
      console.error('[Session] Failed to open the Mezzo Companion:', err.message);
      return false;
    }

    const pipDoc = pipWindow.document;
    pipDocument = pipDoc;

    // The real Document Picture-in-Picture window chrome is the Companion's
    // only title bar now (see the Monitoring screen build below, which no
    // longer constructs an in-page one). "Mezzo Companion" matches CLAUDE.md's
    // canonical terminology exactly (was "MEZZO COMPANION" — normalized,
    // not a behavior change).
    //
    // PiP TITLE INVESTIGATION (Step 7) — what this line actually controls,
    // and what it doesn't:
    //  - Confirmed via source + live testing: this sets pipDocument.title on
    //    a genuinely separate Document object (the PiP window shares the
    //    opener's JS realm but not its `document`) — reading it back returns
    //    exactly what was assigned, and changing it never touches the main
    //    tab's own document.title. Isolation is real, not assumed.
    //  - Confirmed via the Document Picture-in-Picture spec (wicg.github.io/
    //    document-picture-in-picture): "It is required that the user agent
    //    makes it clear to the user which origin is controlling the
    //    DocumentPictureInPicture window at all times... the user agent may
    //    display the origin of the website in a titlebar on the window."
    //    This is a security requirement, not an implementation detail — the
    //    floating window has no address bar, so the titlebar is the
    //    substitute origin indicator.
    //  - NOT verified in this environment: what the real, native OS title
    //    bar chrome actually renders in Chrome today — whether it's this
    //    document.title, the origin, or both. Automated testing (Playwright)
    //    can only inspect the DOM property; it cannot capture native window
    //    chrome pixels, and this sandbox has no way to eyeball a real
    //    desktop Chrome window. Community documentation corroborates the
    //    spec's origin-titlebar reading (see the Step 7 report), which
    //    suggests this assignment may have little-to-no effect on the
    //    visible titlebar text specifically, even though it demonstrably
    //    works as a DOM property.
    // Kept, not removed: document.title still has real, independent value
    // for accessibility trees, OS task-switcher/taskbar entries, and
    // browser history, regardless of what the titlebar glyphs show — see
    // docs/product-experience.md's engineering notes for the full writeup.
    // Only the casing changed here; no behavior was added or removed since
    // the evidence doesn't clearly support that being effective, per this
    // investigation's own findings.
    pipDoc.title = 'Mezzo Companion';

    const fontLink = pipDoc.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap';
    pipDoc.head.appendChild(fontLink);

    const link = pipDoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = baseUrl + 'design-tokens/mezzo-tokens.css';
    const cssReady = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    pipDoc.head.appendChild(link);
    await cssReady;

    const style = pipDoc.createElement('style');
    style.textContent = `
      /* Lantern (PRD §4.5): Companion primary buttons are cream, not the
         website's chartreuse. Inside the Companion, chartreuse only ever
         means the over-range band. */
      :root { --color-btn-primary-bg: var(--color-text); }

      .hidden { display: none !important; }

      body {
        margin: 0;
        width: 100%;
        height: 100vh;
        background: var(--surface);
        overflow: hidden;
      }
      .pip-layout {
        width: 100%;
        height: 100%;
        position: relative;
      }
      /* Shared "card" treatment — every screen renders as a rounded,
         shadowed card filling the real (fixed-size) Picture-in-Picture
         window, matching the reference's own per-state card mockups.
         position:relative so the Ready screen's profile-dropdown backdrop
         (a child of .pip-screen-ready) can use inset:0 against this card's
         own bounds, not the whole document. overflow:hidden keeps the
         backdrop's corners and everything else clipped to the radius.
         Square, borderless edges (2026-10-20): the card fills the whole
         window, so a rounded corner and 1px border only drew a faint
         outline with background showing through at each corner. No outer
         shadow either, since nothing outside the window could show it.
         Lantern (PRD §7): screens are flat; the inset glow is gone too. */
      .pip-screen {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        overflow: hidden;
        background: var(--color-bg); /* flat screen layer (PRD §7) */
      }
      /* Shared cap for every full-width, single-column pill action in the
         Companion — every full-screen decision state's primary/secondary
         action shares this one rule (Recalibrate/Create new profile/Save
         profile are text links, not pills, so they never need this cap).
         Discard (M1/Result) is covered too — as of the 2026-08-14
         visual-language pass it carries .pip-decision-secondary-btn
         directly (see that class's own comment), not a separate class of
         its own, so no extra selector is needed here. Start monitoring is
         not part of this group either — it has its own dedicated
         width/max-width rule instead (see .pip-ready-start-btn's own CSS
         comment), narrower than this 320px cap, not wider.
         Compact controls, selector rows, and the native window-close
         control are untouched — they don't use this pattern either. */
      .pip-decision-primary-btn,
      .pip-decision-secondary-btn {
        max-width: 320px;
        margin-inline: auto;
      }

      /* ── Shared Companion H1 typography — every real <h1> in the
         Companion (Welcome, C1, C0, Ready, and both post-creation result
         screens) uses this one rule for font-size/weight/line-height/
         letter-spacing/color, rather than each screen redefining its own
         (found to have drifted — Welcome/C1/C0 at 17px with no
         letter-spacing, decision screens at 15px — during this revision's
         own H1-consistency pass). Values are Ready's own pre-existing H1
         treatment, copied here as the shared source of truth; layout-only
         concerns that genuinely differ per screen (margin, min-height,
         max-width) stay on each screen's own class alongside this one,
         never duplicated here. ── */
      /* h1.pip-h1/p.pip-h1, not just .pip-h1: every real <h1> this applies
         to needs the element+class compound selector's higher specificity
         to reliably win over .pip-decision-heading's own font-size/
         line-height/color (still used, unchanged, by M2/M3/06b's own <p>
         headings) regardless of which rule happens to come later in this
         stylesheet — no fragile reliance on source order between the two.
         p.pip-h1 was added in the 2026-08-14 Companion-wide typography
         pass, extending this exact same shared rule to Calibrating's own
         heading (.pip-calibrating-heading) and Failed's own message
         (.pip-failed-message) — both real <p> elements, not <h1> (see
         "Preserve semantic heading structure" — this pass changes their
         typography only, never their tag), so h1.pip-h1 alone would never
         have matched them; neither carries .pip-decision-heading, so no
         specificity conflict exists there either, but the same compound
         pattern is used for consistency and to guard against one being
         added later. */
      h1.pip-h1,
      p.pip-h1 {
        font-family: var(--font-display);
        font-weight: var(--weight-semibold);
        font-size: 24px;
        line-height: 1.15;
        letter-spacing: var(--tracking-heading);
        color: var(--color-text);
        text-align: center;
        margin: 0;
      }

      /* ── Shared intro-text vocabulary — heading + body, used by both
         Welcome/01 and C1 (their content shape is identical: a short
         heading, one explanatory paragraph, one primary action). Typography
         itself now comes from .pip-h1 (always paired on the same element) —
         this class no longer redeclares it. ── */
      .pip-intro-heading {
        margin: 0;
      }
      /* Text-only lowercase wordmark on Welcome (PRD §9a). */
      .pip-wordmark {
        margin: 0 0 4px;
        font-family: var(--font-display);
        font-weight: var(--weight-semibold);
        font-size: 20px;
        line-height: 1;
        letter-spacing: var(--tracking-heading);
        color: var(--color-text);
      }
      .pip-intro-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: color-mix(in srgb, var(--color-text-soft) 80%, transparent);
        margin: 0;
        max-width: 250px;
      }
      .pip-intro-disclaimer {
        font-family: var(--font-body);
        font-size: 10.5px;
        line-height: 1.4;
        color: var(--color-text-muted);
        margin: 2px 0 4px;
        max-width: 240px;
      }

      /* ── Welcome/01, C1, C0 — all reached before any usable speaking
         profile exists, all share Ready's fixed size (see
         MEZZO_COMPANION_READY_BASE_HEIGHT). Centered, generous padding —
         the same treatment across all three keeps the first-time
         experience visually continuous rather than three unrelated
         layouts. ── */
      .pip-screen-welcome,
      .pip-screen-prep,
      .pip-screen-c0 {
        justify-content: center;
        padding: 28px 24px;
        box-sizing: border-box;
        gap: 12px;
        text-align: center;
      }

      /* C1's spacing: see the Rhythm block at the end. */
      /* Welcome's spacing: see the Rhythm block at the end. */
      h1.pip-welcome-wordmark {
        margin: 0;
        font-family: var(--font-display);
        font-weight: var(--weight-semibold);
        font-size: 30px;
        line-height: 1;
        letter-spacing: -0.045em;
        text-transform: lowercase;
        text-align: center;
        color: var(--color-text);
      }

      /* Primary action shares the pill treatment .pip-ready-start-btn
         below defines — reused verbatim as .pip-intro-primary-btn so
         Welcome/01, C1, and Start monitoring all read as the same kind of
         affirmative action. Icon + label sit inline. */
      .pip-intro-primary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        background: var(--color-btn-primary-bg);
        border: none;
        border-radius: var(--radius-control);
        padding: 12px;
        font-family: var(--font-body);
        font-size: 14px;
        font-weight: var(--weight-medium);
        color: var(--color-btn-primary-text);
        cursor: pointer;
        transition: opacity 0.15s ease;
        box-sizing: border-box;
        min-height: 40px;
        max-width: 320px;
        margin-inline: auto;
      }
      /* Same hover as Start monitoring (.btn-primary): never dimmed, so every
         primary button stays the same cream. Dimming read as gray on the
         lighter decision background. */
      .pip-intro-primary-btn:hover { background: color-mix(in srgb, var(--color-btn-primary-bg) 86%, var(--color-text)); }

      /* C0's address-bar illustration — schematic, not photorealistic:
         enough to point at "the icon in your address bar" without
         claiming to be a literal screenshot of any specific browser. */
      .pip-c0-illustration {
        width: 100%;
        max-width: 44px;
        margin: 4px 0;
      }

      /* ── Ready screen — the approved selector model (see
         docs/prd/ready-screen-speaking-profiles-mvp.md). One stable
         layout: heading, "Speaking profile" label, a collapsed selector
         trigger that expands into an overlay panel (own internal scroll,
         never resizes the window — see MEZZO_COMPANION_READY_BASE_HEIGHT's
         own comment), contextual actions, Start monitoring, and the
         privacy disclaimer, always in that order. justify-content:center
         so the ~50px breathing room the height formula reserves shows up
         at both ends, not just pushed below the last element. ── */
      .pip-screen-ready {
        justify-content: center;
        padding: 18px 20px 18px;
        box-sizing: border-box;
        gap: 10px;
      }

      /* Typography now comes from .pip-h1 (always paired on the same
         element) — this class only carries Ready's own layout specifics. */
      .pip-ready-heading {
        margin: 2px 0 0;
        min-height: 32px;
        flex-shrink: 0;
      }

      /* margin-top (2026-08-15 pass): the heading should read as the
         screen's own introduction, with the SPEAKING PROFILE label/selector
         beneath it as a distinctly separate, closely-connected control
         group — the screen's own flat 10px .pip-screen-ready gap didn't
         differentiate "end of the intro" from "start of a tight label+
         selector pairing." 14px added on top of that 10px base (reusing
         the same value already used elsewhere in this same pass for an
         analogous "noticeably larger than the base rhythm" gap — see
         .pip-screen-result/.pip-screen-m1's own .pip-decision-actions
         margin-top) gives ~24px between the heading and the label.
         Label-to-selector spacing is deliberately NOT touched — it stays
         at the screen's own base 10px gap, since that pairing should stay
         tight. */
      .pip-ready-profile-label {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: var(--weight-regular);
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
        color: var(--color-label);
        text-align: center;
        min-height: 12px;
        flex-shrink: 0;
        margin-top: 14px;
      }

      /* Collapsed summary row — shows the selected profile, opens the
         panel below on click. A real <button>, not a native <select>: the
         panel's own grouped/sectioned layout (Unsaved vs. Saved profiles,
         inline delete/discard) has no equivalent in a native select.
         Reference-matched (Batch 2): a centered, borderless pill — border:0
         explicitly, not a low-contrast border left to read as invisible.
         Surface: the menu layer (--color-bg-menu, PRD §7), shared with
         .pip-ready-selector-panel below so the closed trigger and its
         open panel read as one component. Trigger text on it clears
         4.5:1. */
      .pip-ready-selector-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        min-height: 44px;
        box-sizing: border-box;
        padding: 13px 18px;
        border-radius: var(--radius-control);
        background: var(--color-bg-menu);
        border: 0;
        font-family: var(--font-body);
        font-weight: var(--weight-regular);
        font-size: 17px;
        color: color-mix(in srgb, var(--color-text-soft) 92%, transparent);
        cursor: pointer;
        flex-shrink: 0;
        text-align: left;
      }
      /* Lighter on hover (--color-bg-menu-hover); text still clears 4.5:1. */
      .pip-ready-selector-trigger:hover { background: var(--color-bg-menu-hover); }
      /* Open state (PRD §7): the trigger stays above the scrim, lifted to
         the hover surface with a faint sage edge while its panel is open. */
      .pip-ready-selector-trigger[aria-expanded="true"] {
        background: var(--color-bg-menu-hover);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-link) 45%, transparent);
      }

      /* Menu-layer scrim (PRD §7): dims everything behind the open
         selector; .pip-ready-selector-wrap (z-index 26) sits above it. */
      .pip-ready-scrim {
        position: absolute;
        inset: 0;
        z-index: 25;
        background: color-mix(in srgb, var(--color-shadow) 60%, transparent);
      }

      /* 8px sage dot (PRD §9a): the trigger's bullet before the selected
         name, and the selected-row marker inside the panel. */
      .pip-dot {
        display: inline-block;
        flex-shrink: 0;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-link);
      }
      .pip-ready-selector-trigger-name {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* display:inline-flex + centered align/justify (2026-08-16 fix — was a
         bare inline <span>, so its width:10px/height:10px never actually
         applied per CSS's own rules for inline boxes, leaving the SVG glyph
         positioned by its default inline baseline instead of centered in
         its declared box): one shared vertical-centering anchor for both
         the closed (downward) and expanded (upward, rotated) states — the
         icon's own box is now genuinely centered on itself, so the default
         center transform-origin rotate(180deg) already pivots around the
         same visual center the closed state renders at, rather than
         needing separate offsets per state. The parent trigger's own
         align-items:center (unchanged) still centers this whole box within
         the row; this rule only fixes what happens *inside* the box.
         Caret badge: the wrapper itself is the circular affordance —
         20x20, fully round, white glyph. Enlarging the wrapper doesn't
         move its own center: the trigger's own fixed padding/justify-
         content are unchanged, and rotate(180deg) on a geometrically
         circular, symmetric box is visually a no-op for the circle itself
         — only the (non-symmetric) glyph inside visibly rotates, so "must
         not shift vertically or horizontally" holds by construction, not
         by extra positioning rules.
         Color: a faint cream disc with a cream glyph — a plain disclosure
         affordance, not an action color, and clear of 3:1 against the
         menu surface (WCAG 1.4.11). */
      .pip-ready-selector-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--color-text) 14%, transparent);
        color: var(--color-text);
        transition: transform 0.15s ease;
      }
      /* Fixed 10x6 (2026-08-20: was 100%/100% of the old 10x10 wrapper,
         which would now stretch to fill the new 20x20 badge circle far
         too large) — the chevron SVG's own intrinsic viewBox ratio
         (10x6), so the glyph keeps its original visual proportions and
         weight, simply centered within the larger circular badge via the
         wrapper's own flex centering above, rather than being resized to
         match the badge. display:block avoids the SVG's own inline
         baseline gap inside the flex box (belt and suspenders alongside
         align-items:center above). */
      .pip-ready-selector-chevron svg {
        display: block;
        width: 10px;
        height: 6px;
      }
      .pip-ready-selector-trigger[aria-expanded="true"] .pip-ready-selector-chevron {
        transform: rotate(180deg);
      }

      /* Trigger + panel share this positioning context, not .pip-screen-ready
         itself. Reference-matched (Batch 2): 260px, centered — not the full
         card width. */
      .pip-ready-selector-wrap {
        position: relative;
        width: 260px;
        max-width: 100%;
        margin-inline: auto;
        flex-shrink: 0;
        z-index: 26;
      }

      /* Expanded panel — a native <fieldset> now (Batch 2), not a
         role="listbox" <div>: its content is a mutually-exclusive group of
         native radio profile choices plus independent delete/discard
         buttons, which radiogroup semantics describe honestly and listbox
         semantics don't (a listbox's option children aren't expected to
         contain their own focusable descendants). border/margin/min-width
         reset the default fieldset chrome. Absolutely positioned over the
         card's own bounds (.pip-screen is already position:relative,
         overflow:hidden clips this to the 14px radius), so it never
         affects window height — opening it never calls
         resizeCompanionTo() or resizeCompanionToContent() (see
         openSelectorPanel()).
         Position and height (2026-08-20 manual-review fix): the "top"
         value below is only a same-tick-paint fallback —
         positionSelectorPanel() (see its own comment) always overrides
         both "top" and "max-height" inline, computed fresh on every open
         from the trigger's real position and
         the Companion's real viewport, so the panel can extend above the
         trigger and stays within the visible Companion regardless of
         profile count. display:flex/flex-direction:column (new) lays out
         the legend (absolutely positioned, out of flow, unaffected), the
         scrollable .pip-ready-selector-rows region, and the stable
         Create-new-profile footer as a column — only the rows region
         itself scrolls now (see that class's own comment); the panel
         element no longer scrolls its entire content as one block the way
         it used to at a flat max-height:260px. */
      .pip-ready-selector-panel {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 8px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 30;
        background: var(--color-bg-menu); /* matches .pip-ready-selector-trigger's own (restored) surface — see that rule's comment */
        border: 1px solid var(--border);
        margin: 0;
        min-width: 0;
        border-radius: 6px;
        box-shadow: 0 12px 32px color-mix(in srgb, var(--color-shadow) 50%, transparent);
        box-sizing: border-box;
        padding: 6px 0;
      }
      /* Scrollable rows region (2026-08-20) — the Unsaved/Saved groups
         only; Create new profile (a sibling of this element, appended
         directly to .pip-ready-selector-panel — see renderSelectorPanel())
         is deliberately outside it, so it can never be scrolled out of
         view or clipped: min-height:0 is what actually lets a flex child
         shrink below its own content size in the first place (the flex
         default is content-driven, which would otherwise let this region
         push the footer below it right out of the panel instead of
         yielding scroll space to it). flex:1 1 auto claims whatever space
         the panel's own JS-computed max-height leaves after the footer's
         own fixed size. overflow-y:auto only engages when the rows
         genuinely don't fit — positionSelectorPanel() sizes the panel
         itself to its natural content height whenever that fits inside
         the usable viewport, so scrolling here is the exception, not the
         default. */
      .pip-ready-selector-rows {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      /* The <fieldset>'s <legend> — provides its one accessible name
         ("Speaking profiles"), same string the old aria-label carried.
         Visually hidden via the standard clip technique (never
         display:none/visibility:hidden, which would drop it from the
         accessibility tree instead of just hiding it visually — legends
         don't need to be seen here, the "Speaking profile" label above the
         trigger already carries the visible heading). */
      .pip-ready-selector-legend {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .pip-ready-selector-group-label {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: var(--weight-regular);
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
        color: color-mix(in srgb, var(--color-text-muted) 90%, var(--color-text)); /* 5.1:1 on the menu panel, 4.5:1 on a hovered row */
        padding: 8px 14px 4px;
      }
      .pip-ready-selector-divider {
        height: 1px;
        background: color-mix(in srgb, var(--color-overlay) 8%, transparent);
        margin: 6px 10px;
        /* Only meaningful for the footer divider — the one direct flex
           child of .pip-ready-selector-panel's own flex column (the other
           usage, between the Unsaved/Saved groups, lives inside
           .pip-ready-selector-rows' own block flow, where flex-shrink is
           simply inert). Guarantees it never shrinks away if the panel's
           own JS-computed height is ever genuinely tight. */
        flex-shrink: 0;
      }
      /* Create new profile — persistent selector-panel footer action
         (2026-08-18, moved here from the retired Ready-level contextual
         link). A plain, full-width text button reusing the row's own
         padding rhythm (8px 14px) rather than a filled pill — "visually
         separated... without becoming a large marketing-style button."
         Sentence case in the DOM (not forced uppercase via CSS, unlike
         .pip-ready-contextual-link/.pip-text-btn's own treatment) — this
         reads as a persistent list action, not a secondary link.
         Color: sage (--color-link), the Companion's text-link color, which
         clears 4.5:1 on the menu panel at rest and on hover/focus. */
      .pip-ready-selector-footer-action {
        display: block;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 14px;
        background: none;
        border: none;
        font-family: var(--font-body);
        font-size: 12.5px;
        font-weight: var(--weight-medium);
        color: var(--color-link);
        text-align: center;
        cursor: pointer;
        flex-shrink: 0; /* stays a stable footer, never squeezed by the rows region above it — see .pip-ready-selector-rows' own comment */
      }
      .pip-ready-selector-footer-action:hover {
        background: color-mix(in srgb, var(--color-overlay) 6%, transparent);
      }
      .pip-ready-selector-footer-action:focus-visible {
        outline: 2px solid var(--color-link); /* see .pip-ready-selector-footer-action's own color comment */
        outline-offset: -2px;
        background: color-mix(in srgb, var(--color-overlay) 6%, transparent);
      }
      .pip-ready-selector-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        min-height: 40px;
        box-sizing: border-box;
      }
      .pip-ready-selector-row:hover { background: color-mix(in srgb, var(--color-overlay) 4%, transparent); }
      /* Visually hidden, never removed from the accessibility tree or the
         focus order (no display:none/visibility:hidden) — the standard
         "visually-hidden" clip technique, collapsed to 1x1px. This is a
         native radio: Tab/Arrow/Space behavior is entirely the browser's,
         no custom keydown handling. position:absolute takes it out of
         normal flow (so it never introduces stray flex-gap spacing before
         the label) and — because no inset properties are set — it renders
         at its own static position (approximately where the label starts),
         never stretched to cover the row, so it can never overlay or
         intercept the delete/discard button further along the same row. */
      .pip-ready-selector-row-radio {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .pip-ready-selector-row-label {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      .pip-ready-selector-row-name {
        flex: 1;
        min-width: 0;
        font-family: var(--font-body);
        font-size: 13px;
        color: color-mix(in srgb, var(--color-text-soft) 92%, transparent);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The checkmark and the selected row's own medium weight are both
         derived directly from the radio's native :checked state — no
         second, JS-maintained "selected" flag to drift out of sync with
         it. visibility (not opacity/color) toggling survives forced-colors
         mode, where custom color rules are overridden but layout
         properties are not. aria-hidden below: the radio itself already
         announces "checked" to assistive tech: the glyph is decorative
         reinforcement, not a second thing to announce. */
      .pip-ready-selector-row-radio:checked ~ .pip-ready-selector-row-label .pip-ready-selector-row-name {
        font-weight: var(--weight-medium);
      }
      /* The checkmark: a small sage dot (PRD §9a), clear of 3:1 on the panel. */
      .pip-ready-selector-row-check {
        flex-shrink: 0;
        visibility: hidden;
        width: 8px;
        height: 8px;
      }
      .pip-ready-selector-row-radio:checked ~ .pip-ready-selector-row-label .pip-ready-selector-row-check {
        visibility: visible;
      }
      /* Redirects the hidden radio's own focus ring onto the visible label
         — outline, not a background/color-only change, so the indicator
         itself also survives forced-colors/high-contrast presentation.
         The 2px sage focus ring used everywhere (PRD §9a). */
      .pip-ready-selector-row-radio:focus-visible ~ .pip-ready-selector-row-label {
        outline: 2px solid var(--color-link);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .pip-ready-selector-row-note {
        font-family: var(--font-body);
        font-size: 10px;
        color: color-mix(in srgb, var(--color-text-muted) 90%, var(--color-text)); /* 5.1:1 on the menu panel, 4.5:1 on a hovered row */
        padding: 0 14px 6px;
        margin: -6px 0 0;
      }
      /* Delete (saved rows) / discard (the unsaved row) — same restrained
         icon-button treatment either way, distinguished only by which icon
         and aria-label the row supplies. An independent sibling of the
         radio+label, never nested inside either — selecting a row can
         never accidentally activate it, and activating it can never check
         the radio (see handleSelectorRowChange() / the row action's own
         click handler, both unchanged from before Batch 2).
         Idle color: muted text at 75%, so the icon clears 3:1 on a hovered
         row even before the icon itself is hovered or focused. */
      .pip-ready-selector-row-action {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        background: none;
        border: none;
        border-radius: var(--radius-control);
        padding: 0;
        color: color-mix(in srgb, var(--color-text-muted) 75%, transparent);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease, color 0.12s ease, background 0.12s ease;
      }
      .pip-ready-selector-row:hover .pip-ready-selector-row-action,
      .pip-ready-selector-row-action:focus-visible {
        opacity: 1;
      }
      .pip-ready-selector-row-action:hover,
      .pip-ready-selector-row-action:focus-visible {
        color: color-mix(in srgb, var(--color-text-soft) 92%, transparent);
        background: color-mix(in srgb, var(--color-overlay) 6%, transparent);
      }

      /* Contextual actions — reference-matched (Batch 2): sentence-case,
         underlined inline links, not the old uppercase .pip-text-btn chip
         treatment. Unsaved-profile-only now (2026-08-18): Save profile is
         the sole action ever shown here. Recalibrate moved to the
         selector panel's own per-row icon (2026-08-17) and Create new
         profile moved to the selector panel's own persistent footer
         action (2026-08-18, see renderSelectorPanel()) — a saved profile
         selected shows nothing in this row at all.
         min-height: 20px removed (2026-08-19 spacing pass, see
         .pip-ready-start-btn's own comment for the full before/after
         gap math) — the row now collapses to zero height when it's
         genuinely empty (the common, saved-profile-selected case) instead
         of always reserving space for content that isn't there. A
         selected unsaved profile's own "Save profile" link still renders
         at its natural (unchanged) size when it IS present — this only
         removes the empty case's own reserved minimum, so the row's
         height still simply follows its actual content either way. */
      .pip-ready-contextual-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px;
        width: 100%;
        flex-shrink: 0;
        font-family: var(--font-body);
        font-size: 12px;
      }
      /* Shared secondary text-action treatment (2026-08-14 Companion-wide
         visual-language pass) — Ready's own Recalibrate link is the
         reference; .pip-text-btn (Cancel across C1/Calibrating/Failed,
         Back across C0) now shares this exact rule rather than its own
         older uppercase-chip treatment, so every secondary text action
         in the Companion reads
         the same way: sentence case, underlined, no forced letter-spacing,
         no decorative icon. font-family/font-size are explicit here (not
         font:inherit, the original Ready-only version's own approach) so
         this reads identically regardless of which screen's ambient
         context it's used in — Ready's own .pip-ready-contextual-actions
         happens to already set this exact font-family/size on its
         children, so this is a no-op change there, but M1/Result/C1/C0/
         Calibrating/Failed have no equivalent ambient font of their own to
         inherit correctly. */
      .pip-ready-contextual-link,
      .pip-text-btn {
        font-family: var(--font-body);
        font-size: 12px;
        color: color-mix(in srgb, var(--color-link-quiet) 85%, transparent);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .pip-ready-contextual-link:hover,
      .pip-text-btn:hover { color: color-mix(in srgb, var(--color-text-soft) 92%, transparent); }
      .pip-text-btn:disabled { opacity: 0.5; cursor: default; }
      .pip-ready-contextual-link:focus-visible,
      .pip-text-btn:focus-visible {
        outline: 2px solid var(--color-link);
        outline-offset: 2px;
        border-radius: 2px;
      }
      /* Width (2026-08-19 pass): narrower than the 260px selector above it
         (.pip-ready-selector-wrap), not the "no cap, intrinsically sized"
         Batch 2 treatment this replaces (which happened to land around
         ~240px purely as a side effect of .btn-wide's own 64px horizontal
         padding — a padding value doing width's job, not an actual width
         rule). width:100% + max-width:224px is the real, explicit sizing
         rule instead: at the standard 382px Companion width (382 - 2×20px
         screen padding = 342px available), 100% would be 342px, so
         max-width always clamps it to exactly the approved ~224px target;
         on a narrower manually-resized window, width:100% shrinks it
         proportionally with the available space instead of holding a
         fixed 224px and overflowing. box-sizing:border-box (own padding
         below included in that 224px, not added on top of it) is what
         makes that clamping arithmetic exact rather than approximate.
         Centered for free via .pip-screen's own align-items:center, same
         as the Batch 2 version — a capped width, not width:100% actually
         filling the row, is what leaves room for that centering. Padding
         reduced from .btn-wide's old 16px 64px (a value sized to produce
         a WIDTH, no longer this rule's job) to a plainer, purely
         vertical-comfort-driven 13px 24px, matching .btn-primary's own
         base 13px 28px closely rather than reintroducing another
         width-shaping number. */
      /* margin-top: 14px -> 24px (2026-08-15 pass) -> 10px (2026-08-18) ->
         4px (2026-08-19, this pass). With the now-empty contextual-actions
         row's own min-height also removed (see that class's own comment
         above), the total visual gap from the closed selector to Start
         monitoring in the common (saved-profile-selected) case is the
         screen's own two 10px base flex gaps either side of the
         zero-height empty row, plus this 4px: 10 + 0 + 10 + 4 = 24px,
         reference-matched to the approved ~24px target — down from ~50px
         (10 + 20 + 10 + 10) before this pass. Start monitoring now reads
         as directly, closely following the selector, not a separately
         emphasized step, while the 4px still keeps the two visually
         distinct rather than touching. When an unsaved profile IS selected
         (the contextual-actions row showing its own "Save profile" link
         instead of being empty), the gap is correspondingly larger by
         that link's own real rendered height — unchanged by this pass,
         and not a regression: there is visibly a link occupying that
         space in that case. */
      .pip-ready-start-btn {
        flex-shrink: 0;
        margin-top: 4px;
        width: 100%;
        max-width: 224px;
        box-sizing: border-box;
        padding: 13px 24px;
      }
      .pip-ready-start-btn:disabled { opacity: 0.5; cursor: default; }

      .pip-ready-disclaimer {
        font-family: var(--font-body);
        font-size: 11px;
        line-height: 1.4;
        color: var(--color-text-muted);
        text-align: center;
        margin: 14px 0 0;
        max-width: 260px;
        min-height: 32px;
        flex-shrink: 0;
      }

      /* ── Calibrating (C2) (PRD §8) — heading, a six-segment level meter
         about 52px below it, a sage "Listening… {n}s" countdown, one line
         of guidance, and Cancel pinned to the bottom. Completes on its own
         after the capture; no manual "I'm done" control. Shares the
         Ready/Welcome/C1/C0 fixed size. ── */
      .pip-screen-calibrating {
        justify-content: center;
        padding: 20px 24px 56px; /* bottom room for the pinned Cancel */
        box-sizing: border-box;
      }
      .pip-calibrating-subheading {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
        color: var(--color-text-muted);
        text-align: center;
        margin-bottom: 10px;
      }
      .pip-calibrating-subheading:empty { display: none; }
      p.pip-h1.pip-calibrating-heading {
        font-weight: var(--weight-medium);
        font-size: 20px;
        line-height: 1.25;
        max-width: 280px;
        text-wrap: balance;
      }
      .pip-calibrating-visual {
        position: relative;
        margin-top: 52px;
      }
      /* The 3-2-1: the number stands where the meter will be. */
      .pip-calibrating-count {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        font-family: var(--font-body);
        font-size: 36px;
        font-weight: var(--weight-medium);
        line-height: 1;
        font-variant-numeric: tabular-nums;
        color: var(--color-text);
      }
      /* "Preparing microphone…" / the 3-2-1 number / "Listening…
         {n}s" — aria-hidden (see calibratingAnnounceEl for what assistive
         tech actually hears). min-height holds its space while blank. */
      .pip-calibrating-status {
        margin-top: 18px;
        font-family: var(--font-body);
        font-size: 15px;
        font-weight: var(--weight-medium);
        line-height: 1.25;
        color: var(--color-link);
        text-align: center;
        min-height: 19px;
      }
      .pip-calibrating-hint {
        margin: 6px 0 0;
        font-family: var(--font-body);
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-text-muted);
        text-align: center;
        max-width: 300px;
      }
      .pip-calibrating-cancel {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        min-height: 24px;
      }
      /* .pip-text-btn's own rule now lives merged with .pip-ready-contextual-link
         above (2026-08-14 visual-language pass) — the old uppercase-chip
         treatment (11px, letter-spacing, padded/bordered hover chip) is
         retired in favor of Ready's own Recalibrate link styling, shared
         directly rather than duplicated. */

      /* ── Calibration Failed — calm, specific copy mapped from a stable
         controller failure code (never the raw engine.js message). Try
         Again calls retry() (same mode/target); Back cancels and returns
         to Ready. Microphone-permission denial routes to the dedicated C0
         screen instead — see showFailedScreen() below — so this screen
         only ever renders the other failure codes now. ── */
      .pip-screen-failed {
        justify-content: center;
        padding: 32px 28px;
        box-sizing: border-box;
        gap: 20px;
        text-align: center;
      }
      /* Typography now comes from .pip-h1 (2026-08-14 pass — see p.pip-h1's
         own comment on the shared rule above); this class only carries the
         one genuinely layout-specific concern left. */
      .pip-failed-message {
        max-width: 250px;
      }

      /* ── Shared full-screen decision vocabulary — M1, M2/M2a, M3, and
         06b (delete confirmation) all share this one visual pattern:
         heading, optional body/warning text, then one or two actions.
         Full-screen per the PRD (never a modal/overlay — see 06b's own
         "do not use a floating dialog" requirement), so each of the four
         gets its own top-level screen element built from this same
         vocabulary rather than four near-duplicate rule sets. ── */
      /* ── Decision layer (Lantern, PRD §7). Every decision state (both
         post-calibration result variants, naming M2/M2a, the five-profile
         limit M3, delete confirmation 06b) turns the whole window slate,
         with a 44px header bar naming the decision in Geist Mono (Cancel in
         its corner where the state has one), the content in the middle,
         and the actions pinned to the bottom. Still full-screen states,
         never modals: no dialog semantics, nothing underneath stays
         visible or interactive. This retires the 2026-08-17 inset
         modal-card system, including the result screen's one-off card. ── */
      .pip-screen-decision {
        justify-content: flex-start;
        padding: 0;
        box-sizing: border-box;
        text-align: center;
        background: var(--color-bg-decision);
      }
      .pip-decision-bar {
        flex: 0 0 44px;
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border);
      }
      .pip-decision-bar-title {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pip-decision-bar-cancel { flex-shrink: 0; }
      .pip-decision-content {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 16px 24px;
      }
      /* M2: the form spans content and actions, so it takes the remaining
         height the way content and actions do on the other screens. */
      .pip-decision-form {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
      }
      .pip-decision-heading {
        font-family: var(--font-display);
        font-weight: var(--weight-semibold);
        font-size: 15px;
        line-height: 1.5;
        color: color-mix(in srgb, var(--color-text-soft) 85%, transparent);
        text-align: center;
        margin: 0;
        max-width: 260px;
        letter-spacing: var(--tracking-heading);
      }
      .pip-decision-body {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.5;
        color: color-mix(in srgb, var(--color-text-soft) 75%, transparent);
        text-align: center;
        margin: 0;
        max-width: 250px;
      }
      /* The noisy-room tip: sage notice text under the question. */
      .pip-decision-tip {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-notice);
        text-align: center;
        margin: 8px 0 0;
        max-width: 280px;
        text-wrap: pretty;
      }
      /* Under a profile that predates the sound filter (needsRecalibration()). */
      .pip-ready-recalibrate-note {
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-text-muted);
        text-align: center;
        text-wrap: pretty;
        max-width: 300px;
        margin: 0;
      }
      .pip-inline-link {
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        color: var(--color-link);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .pip-inline-link:hover { color: var(--color-text); }
      .pip-inline-link:focus-visible {
        outline: 2px solid var(--color-link);
        outline-offset: 2px;
        border-radius: 2px;
      }
      /* M2a's "already exists" warning — calmer than an error tone (a
         name collision is an expected, natural outcome here, not a
         mistake), reused as the associated message for .pip-name-input
         below (see aria-describedby in the DOM). */
      .pip-decision-warning {
        font-family: var(--font-body);
        font-size: 11.5px;
        line-height: 1.4;
        color: color-mix(in srgb, var(--color-notice) 90%, transparent);
        text-align: center;
        margin: 0;
        max-width: 240px;
      }
      .pip-decision-actions { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 230px; }
      /* Bottom-pinned actions on decision states; the shared 320px button
         cap (see .pip-decision-primary-btn above) still applies. */
      .pip-screen-decision .pip-decision-actions {
        flex: 0 0 auto;
        max-width: none;
        box-sizing: border-box;
        padding: 0 24px 20px;
        align-items: center;
      }
      .pip-name-input { max-width: 260px; }
      .pip-decision-primary-btn {
        width: 100%;
        background: var(--color-btn-primary-bg);
        border: none;
        border-radius: var(--radius-control);
        padding: 12px;
        font-family: var(--font-body);
        font-size: 14px;
        font-weight: var(--weight-medium);
        color: var(--color-btn-primary-text);
        cursor: pointer;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .pip-decision-primary-btn:hover { background: color-mix(in srgb, var(--color-btn-primary-bg) 86%, var(--color-text)); }
      .pip-decision-primary-btn:disabled { opacity: 0.5; cursor: default; }
      .pip-decision-secondary-btn {
        width: 100%;
        background: transparent;
        border: 1px solid var(--color-btn-secondary-border);
        border-radius: var(--radius-control);
        padding: 11px 14px;
        font-family: var(--font-body);
        font-size: 14px;
        font-weight: var(--weight-medium);
        color: var(--color-text);
        cursor: pointer;
        overflow-wrap: anywhere;
        line-height: 1.3;
      }
      .pip-decision-secondary-btn:hover { background: color-mix(in srgb, var(--color-text) 6%, transparent); border-color: color-mix(in srgb, var(--color-text) 55%, transparent); }


      /* ── Result-screen action hierarchy — M1/Result answer one question:
         "what do I want to do with it?" (the body/question introduces the
         three decisions below it — Save/Replace > Keep temporarily >
         Discard). Try again was removed (2026-08-18 — see this screen's
         own construction comment): a user unhappy with the result can
         Discard, return to the appropriate prior state, and begin again,
         so the extra shortcut wasn't necessary. Heading, question, and the
         decision group all now sit at the screen's own plain, unscoped
         base gap (.pip-screen-decision's own 14px) — no scoped override
         needed anymore, since there's no longer a second, more-separated
         question to create space before. No divider anywhere in this
         sequence, and Discard is a real third full-width decision inside
         .pip-decision-actions, not a text link paired with anything.
         Discard shares .pip-decision-secondary-btn's exact treatment
         directly (same class, applied alongside this one) rather than its
         own bespoke surface — Keep temporarily and Discard look identical
         at rest, which is itself the de-emphasis signal relative to the
         filled primary above them. No icon, no destructive-red (this
         design system has none — discarding a pending, not-yet-reviewed
         result is a low-consequence action, not equivalent to deleting a
         saved profile). The three decisions are equally spaced from one
         another via .pip-decision-actions' own single shared gap (10px,
         unchanged) — no per-button margin drift. */

      /* ── "Creating your speaking profile…" — the brief completion
         transition (see showCreatingTransition()). A single processing
         state, start to finish: a spinning ring plus static text, with no
         discrete "done" state of its own — the result screen immediately
         behind it is what communicates completion. Under
         prefers-reduced-motion the ring simply stops spinning; the text
         alone still communicates "processing" understandably, so no
         fallback state change is needed. ── */
      .pip-screen-creating {
        justify-content: center;
        padding: 32px 24px;
        box-sizing: border-box;
        gap: 14px;
      }
      .pip-creating-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .pip-creating-spinner {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--color-text) 18%, transparent);
        border-top-color: var(--color-link);
        animation: pip-creating-spin 0.8s linear infinite;
      }
      @keyframes pip-creating-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .pip-creating-spinner { animation: none; }
      }
      .pip-creating-text {
        font-family: var(--font-body);
        font-size: 12.5px;
        color: color-mix(in srgb, var(--color-text-soft) 85%, transparent);
        text-align: center;
        margin: 0;
      }


      .pip-name-input {
        width: 100%;
        box-sizing: border-box;
        padding: 11px 14px;
        border-radius: var(--radius-control);
        background: color-mix(in srgb, var(--color-overlay) 6%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-overlay) 14%, transparent);
        font-family: var(--font-body);
        font-size: 13px;
        color: color-mix(in srgb, var(--color-text-soft) 95%, transparent);
      }
      .pip-name-input:focus-visible { outline: 2px solid var(--border-outline); outline-offset: 1px; }

      /* ── Toast — transient save/update/discard confirmation, shared by
         every message that uses it. A child of .pip-layout (sibling to
         every .pip-screen), so it floats above whichever screen is visible.
         Centered, 12px below the top of the window (in Monitoring, 8px
         below the profile name instead, so it never covers it: see
         placeToast()). Never shifts layout and never takes input
         (pointer-events: none).
         Look (2026-10-26): a fully rounded chip on a surface lighter than
         the window, a thin cream edge, cream text at regular weight, and
         a small sage check. Fully rounded on purpose: buttons are 3px, so
         the shape says it isn't clickable. No cream fill, no chartreuse.
         Motion: fades in over 150ms, holds about 2s, fades out over 200ms;
         with reduced motion it simply appears and disappears. */
      .pip-toast {
        position: absolute;
        left: 0;
        right: 0;
        top: var(--space-3);
        z-index: 40;
        display: flex;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease; /* the fade out */
      }
      .pip-toast.pip-toast-visible { opacity: 1; transition: opacity 0.15s ease; /* the fade in */ }
      @media (prefers-reduced-motion: reduce) {
        .pip-toast, .pip-toast.pip-toast-visible { transition: none; }
      }
      .pip-toast-card {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        max-width: calc(100% - 2 * var(--space-3));
        box-sizing: border-box;
        padding: 6px 14px 6px 10px;
        background: #4A4B4F;
        border: 1px solid rgba(243, 235, 222, 0.18);
        border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: var(--weight-regular);
        line-height: 18px;
        color: #F3EBDE;
        text-align: left;
      }
      .pip-toast-icon { flex-shrink: 0; width: 12px; height: 12px; color: #CEE2C4; }

      /* ── Row-action tooltip (2026-08-20) — the compact, dark-surface
         treatment for the selector panel's own Recalibrate/Delete icon
         buttons, replacing the slow native title-attribute tooltip.
         position:fixed, not absolute: escapes the selector panel's own
         overflow-y:auto/overflow-x:hidden clipping entirely (no ancestor
         between this element and the viewport sets transform/filter/
         will-change, which would otherwise contain a fixed-position
         descendant — confirmed by inspection of every ancestor rule in
         this file), and is positioned in JS (see positionTooltip()) from
         the target button's own getBoundingClientRect(), clamped to stay
         within the real Companion viewport on every side. Same raised
         surface as the toast, so small transient chrome reads as one
         family. pointer-events:none (like
         the toast) — it must never block clicks or pointer movement, and
         has no interactive content of its own to receive them anyway.
         Shown/hidden via the shared .hidden utility class (display:none),
         not opacity — a display:none tooltip is unambiguously absent from
         layout/hit-testing with no transition to race against a fast
         mouseleave/blur. */
      .pip-tooltip {
        position: fixed;
        z-index: 50;
        background: var(--color-bg-raised);
        color: color-mix(in srgb, var(--color-text-soft) 92%, transparent);
        font-family: var(--font-body);
        font-size: 11px;
        font-weight: var(--weight-medium);
        padding: 5px 9px;
        border-radius: 6px;
        box-shadow: 0 8px 20px color-mix(in srgb, var(--color-shadow) 45%, transparent);
        pointer-events: none;
        white-space: nowrap;
      }

      /* ── Monitoring screen (2026-08-18 redesign, superseding the layout
         comment history below) — the visualization fills the middle and
         stays the visual hero; status + profile sit above it, centered on
         the same axis Ready's/Calibrating's own heading occupies; a
         single quiet Stop pill sits below, centered; the Compact toggle
         is its own icon-only "window chrome" control, permanently
         anchored top-right, entirely separate from the Stop control row.
         The only screen that ever shows the visualization or the live
         zone label, and the only screen with two layouts (Expanded /
         Compact), driven by [data-layout] on <body> — an explicit state,
         set only by applyLayoutMode()/enterExpandedLayout()/
         enterCompactLayout(), never inferred from window size. Everything
         from the responsive breakpoints onward (below the [data-layout]
         rules) is purely presentational CSS reacting to manual resize
         *within* whichever mode is already active — none of it calls
         resizeTo() or touches layoutMode; manual resizing stays
         completely freeform, including at non-4:5 aspect ratios. ── */
      .pip-screen-monitoring {
        justify-content: flex-start;
        position: relative;
      }
      /* Visually hidden but announced: the zone live region (PRD §6). */
      .pip-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      /* ── Monitoring, by size band (2026-10-26) ──
         Everything keys off the window's short side (data-size-band, set
         by ringLayout() on every resize): Mini under 160, Compact 160 to
         299, Expanded 300 and up, with controls 8 / 12 / 16px from the
         edges (--edge). The explicit layout mode only decides which size
         Expand and Compact view switch the window to.
         Controls are 32×32, icons #B0AB9E at full opacity (about 6:1 on
         charcoal; the old 35% resting opacity failed the 3:1 minimum for
         icons). Hover and focus get a soft cream background; focus keeps
         the sage ring.
         - Compact: icon-only Stop (bottom left), Expand (top right).
         - Expanded: a real Stop button, styled like the secondary buttons,
           and a Compact view icon (top right).
         - Mini: the ring only; Stop and Expand fade in, over a soft top and
           bottom scrim, when the pointer enters or a control has focus
           (see setUpMiniReveal()).
         The profile name sits in the top row, centered between the
         corners, in Expanded only (2026-11-11: hidden in Compact and Mini,
         where the ring takes the whole window, see ringEdge()). */
      .pip-screen-monitoring { --edge: 12px; }
      .pip-screen-monitoring[data-size-band="mini"] { --edge: 8px; }
      .pip-screen-monitoring[data-size-band="expanded"] { --edge: 16px; }
      .pip-monitoring-header {
        position: absolute;
        top: var(--edge);
        left: calc(var(--edge) + 40px);
        right: calc(var(--edge) + 40px);
        z-index: 1;
        display: block;
      }
      .pip-screen-monitoring[data-size-band="mini"] .pip-monitoring-header,
      .pip-screen-monitoring[data-size-band="compact"] .pip-monitoring-header { display: none; }
      .pip-monitoring-header { text-align: center; }
      /* The glow may reach under the name (the ring is sized by its solid
         band), so while the ring is Outside range, and only then, a soft
         oval of the window's own background fades in behind the name. Its
         center is solid and its edges feather to transparent, so there's
         no box; it keeps the name at 4.5:1 over the glow. At rest it isn't
         drawn at all. It's on the status block, not the name, because the
         name clips its own overflow for the ellipsis. */
      .pip-monitoring-status-block {
        position: relative;
        display: inline-block;
        vertical-align: top;
        max-width: 100%;
        isolation: isolate;
      }
      .pip-monitoring-status-block::before {
        content: '';
        position: absolute;
        inset: -10px -24px;
        z-index: -1;
        background: radial-gradient(closest-side, var(--color-bg) 80%, transparent);
        opacity: 0;
        transition: opacity 0.1s linear;
        pointer-events: none;
      }
      .pip-screen-monitoring:has(.mezzo-ring[data-zone="3"]) .pip-monitoring-status-block::before { opacity: 1; }
      @media (prefers-reduced-motion: reduce) {
        .pip-monitoring-status-block::before { transition: none; }
      }
      .pip-profile-info {
        display: block;
        box-sizing: border-box;
        padding: 8px 6px;
        max-width: 100%;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-family: var(--font-mono);
        font-weight: var(--weight-regular);
        font-size: 11px;
        line-height: 16px; /* plus 8px padding: centered on the 32px controls beside it */
        letter-spacing: 0.12em;
        text-transform: uppercase;
        text-align: center;
        color: #B0AB9E;
      }
      /* The ring area: the full window width between the top row and the
         bottom row; its top and height are set by ringLayout(), and the
         ring is centered in it. */
      .pip-circle-wrapper {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 0; /* under the name (z-index 1), which the glow may reach */
      }
      .pip-monitoring-controls { padding: 0; }
      .pip-control-btn {
        position: absolute;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 32px;
        height: 32px;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        background: none;
        border: none;
        border-radius: 3px;
        color: #B0AB9E;
        cursor: pointer;
        transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease, opacity 0.15s ease;
      }
      /* Interaction states: hover brightens the icon to cream over a soft
         cream square, pressed deepens it, keyboard focus gets the sage
         ring (no tooltip on focus: the aria-label covers it). */
      .pip-control-btn:hover { color: #F3EBDE; background: rgba(243, 235, 222, 0.10); }
      .pip-control-btn:active { background: rgba(243, 235, 222, 0.16); }
      .pip-control-btn:focus-visible { outline: 2px solid #CEE2C4; outline-offset: 2px; }
      .pip-control-btn-stop { bottom: var(--edge); left: var(--edge); }
      .pip-control-btn-compact,
      .pip-control-btn-expand { top: var(--edge); right: var(--edge); }
      .pip-control-icon-stop {
        width: 10px;
        height: 10px;
        border-radius: 2px;
        background: currentColor;
        flex-shrink: 0;
      }
      .pip-control-icon-expand,
      .pip-control-icon-compact { width: 14px; height: 14px; flex-shrink: 0; }
      .pip-control-label { display: none; }
      /* Expand below Expanded; Compact view at Expanded. */
      .pip-control-btn-compact { display: none; }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-compact { display: flex; }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-expand { display: none; }
      /* Expanded: Stop is a real button, like "Keep temporarily". */
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-stop {
        width: auto;
        height: auto;
        min-height: 40px;
        padding: 0 16px;
        border: 1px solid rgba(243, 235, 222, 0.3);
        color: #F3EBDE;
        font-family: var(--font-body);
        font-size: 14px;
        font-weight: var(--weight-medium);
      }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-stop:hover {
        border-color: rgba(243, 235, 222, 0.6);
        background: rgba(243, 235, 222, 0.06);
      }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-stop:active { background: rgba(243, 235, 222, 0.12); }
      /* Tooltip for the icon-only controls, beside the control, after
         about 500ms of hover (see setUpControlTooltips()). */
      .pip-control-tooltip {
        position: absolute;
        z-index: 3;
        padding: 4px 8px;
        background: #4A4B4F;
        border: 1px solid rgba(243, 235, 222, 0.18);
        border-radius: 3px;
        color: #F3EBDE;
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 16px;
        white-space: nowrap;
        pointer-events: none;
      }
      .pip-control-tooltip[hidden] { display: none; }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-icon-stop { width: 9px; height: 9px; }
      .pip-screen-monitoring[data-size-band="expanded"] .pip-control-label { display: inline; }
      /* Mini: the ring only, until the pointer enters or a control has
         focus. opacity, never display: the controls stay in the tab order. */
      .pip-screen-monitoring[data-size-band="mini"] .pip-control-btn { opacity: 0; }
      .pip-screen-monitoring[data-size-band="mini"].pip-controls-revealed .pip-control-btn { opacity: 1; }
      .pip-screen-monitoring::before,
      .pip-screen-monitoring::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 48px;
        z-index: 1;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .pip-screen-monitoring::before { top: 0; background: linear-gradient(rgba(36, 37, 40, 0.55), transparent); }
      .pip-screen-monitoring::after { bottom: 0; background: linear-gradient(transparent, rgba(36, 37, 40, 0.55)); }
      .pip-screen-monitoring[data-size-band="mini"].pip-controls-revealed::before,
      .pip-screen-monitoring[data-size-band="mini"].pip-controls-revealed::after { opacity: 1; }
      /* ── Compact and Mini toolbar (2026-11-11): Stop and Expand together
         in one small, low-contrast panel (a faint cream outline over a
         barely lighter fill, never chartreuse), so they read as controls
         without competing with the glow. Always pinned to the bottom-right
         corner, so resizing never moves it (2026-11-12); data-toolbar (set
         by ringLayout() from the window's shape) only turns it: "side",
         stacked, when the window is wider than tall; "bottom", side by
         side, otherwise. The ring is the largest circle that keeps its
         far-over glow clear of it (ringLayout()). The panel is decorative; each button keeps
         its own accessible name. In Mini it fades in with the buttons, and
         the top and bottom scrims aren't needed. ── */
      .pip-monitoring-toolbar {
        display: none;
        position: absolute;
        z-index: 1;
        box-sizing: border-box;
        border: 1px solid rgba(243, 235, 222, 0.12);
        border-radius: 6px;
        background: rgba(243, 235, 222, 0.04);
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      .pip-screen-monitoring[data-toolbar] .pip-monitoring-toolbar { display: block; }
      .pip-screen-monitoring[data-toolbar]::before,
      .pip-screen-monitoring[data-toolbar]::after { display: none; }
      .pip-screen-monitoring[data-size-band="mini"] .pip-monitoring-toolbar { opacity: 0; }
      .pip-screen-monitoring[data-size-band="mini"].pip-controls-revealed .pip-monitoring-toolbar { opacity: 1; }
      .pip-screen-monitoring[data-toolbar] .pip-monitoring-toolbar { right: var(--edge); bottom: var(--edge); }
      .pip-screen-monitoring[data-toolbar="side"] .pip-monitoring-toolbar { width: 40px; height: 88px; }
      .pip-screen-monitoring[data-toolbar="bottom"] .pip-monitoring-toolbar { width: 88px; height: 40px; }
      /* 4px inside the panel, 16px between the two (the tap-target rule:
         16px of clear space between adjacent hit areas). Expand always in
         the corner; Stop above it, or to its left. */
      .pip-screen-monitoring[data-toolbar] .pip-control-btn-expand {
        top: auto; left: auto; right: calc(var(--edge) + 4px); bottom: calc(var(--edge) + 4px);
      }
      .pip-screen-monitoring[data-toolbar="side"] .pip-control-btn-stop {
        top: auto; left: auto; right: calc(var(--edge) + 4px); bottom: calc(var(--edge) + 52px);
      }
      .pip-screen-monitoring[data-toolbar="bottom"] .pip-control-btn-stop {
        top: auto; left: auto; right: calc(var(--edge) + 52px); bottom: calc(var(--edge) + 4px);
      }
      @media (prefers-reduced-motion: reduce) {
        .pip-control-btn,
        .pip-screen-monitoring[data-size-band="expanded"] .pip-control-btn-stop,
        .pip-screen-monitoring::before,
        .pip-screen-monitoring::after,
        .pip-monitoring-toolbar { transition: none; }
      }

      /* ════════════════════════════════════════════════════════════════
         Rhythm (2026-10-23). One spacing scale and one column for every
         screen, applied last so it wins over older one-off values. Space
         shows what belongs together:
           --space-2 (8)   within a group
           --space-3 (12)  a status line and its visual; a primary button
                           and its fine print
           --space-5 (24)  between groups
           --space-6 (32)  screen edges (top and sides)
         Footer links (Cancel) sit 20px from the bottom.
         Type, at most four styles a screen: eyebrow (Geist Mono 11px,
         uppercase, tracked, muted), heading (20px, 500, tight, two lines
         at most), body/status (14–15px), helper/fine print (12px, muted).
         Three templates:
           A. Sequence (Calibrating, Creating): eyebrow + heading at a fixed
              top; the middle slot centered in the space above Cancel.
           B. Single choice (Welcome, C1, Ready, C0, Calibration failed):
              the whole stack centered; heading, 24, the control group,
              24, primary button → 12 → fine print.
           C. Decision (result, M1, M2, M3, Delete): the slate bar, then
              heading → 8 → subtext, 24, the buttons (16 apart, column
              width), the whole stack centered below the bar.
         Hit areas: every control at least 24px tall (from padding), with
         at least 16px of clear space between adjacent hit areas.
         ════════════════════════════════════════════════════════════════ */
      /* --space-1 … --space-6 come from design-tokens/mezzo-tokens.css. */
      :root {
        --col-width: 280px;
        --footer-inset: 20px;
      }

      /* Type */
      p.pip-h1, h1.pip-h1, .pip-h1 {
        font-size: 20px;
        font-weight: var(--weight-medium);
        line-height: 1.25;
        letter-spacing: var(--tracking-heading);
        max-width: var(--col-width);
        text-wrap: balance;
      }
      .pip-ready-profile-label,
      .pip-calibrating-subheading,
      .pip-prep-eyebrow,
      .pip-decision-bar-title {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: var(--tracking-label);
        text-transform: uppercase;
        color: var(--color-text-muted);
      }
      .pip-intro-body,
      .pip-decision-body {
        font-size: 14px;
        line-height: 1.45;
        max-width: var(--col-width);
      }
      .pip-intro-disclaimer,
      .pip-ready-disclaimer,
      .pip-calibrating-hint,
      .pip-decision-tip,
      .pip-decision-warning,
      .pip-ready-recalibrate-note {
        font-size: 12px;
        line-height: 1.45;
        max-width: var(--col-width);
        min-height: 0;
        margin: 0;
      }
      /* Helper and fine print: balanced lines, no orphans. */
      .pip-intro-disclaimer,
      .pip-ready-disclaimer,
      .pip-calibrating-hint,
      .pip-decision-tip,
      .pip-decision-warning,
      .pip-ready-recalibrate-note,
      .pip-ready-selector-row-note { text-wrap: balance; }
      .pip-ready-selector-trigger { font-size: 15px; }

      /* One column: controls, helper text and buttons share its width. */
      .pip-ready-selector-wrap,
      .pip-ready-start-btn,
      .pip-intro-primary-btn,
      .pip-name-input,
      .pip-decision-actions,
      .pip-screen-decision .pip-decision-actions,
      .pip-decision-form .pip-decision-actions {
        width: var(--col-width);
        max-width: 100%;
        box-sizing: border-box;
      }
      .pip-decision-primary-btn,
      .pip-decision-secondary-btn { width: 100%; max-width: none; }

      /* ── B. Single choice ── */
      .pip-screen-welcome,
      .pip-screen-prep,
      .pip-screen-c0,
      .pip-screen-failed,
      .pip-screen-ready {
        justify-content: center;
        gap: 0;
        padding: var(--space-6);
      }
      .pip-screen-welcome > *,
      .pip-screen-prep > *,
      .pip-screen-c0 > *,
      .pip-screen-failed > *,
      .pip-screen-ready > * { margin: 0; flex-shrink: 0; }
      /* Heading → 8 → its subtext (one group). */
      .pip-screen-welcome > .pip-intro-body { margin-top: var(--space-2); }
      /* Prep screens: Step N of 2 → 8 →
         heading → 8 → body → 24 → I'm ready → Cancel (16 clear between the
         two hit areas: the tap-target floor, as on every screen). */
      .pip-prep-eyebrow { line-height: 1.4; text-align: center; }
      .pip-screen-prep > .pip-prep-heading {
        margin-top: var(--space-2);
        font-size: 22px;
        font-weight: var(--weight-medium);
        line-height: 1.25;
        text-wrap: balance;
      }
      .pip-prep-heading:focus { outline: none; } /* focused for screen readers, not an interactive control */
      .pip-screen-prep > .pip-prep-body {
        margin-top: var(--space-2);
        max-width: 316px;
        font-family: var(--font-body);
        font-size: 14px;
        line-height: 1.45;
        color: var(--color-text-muted);
        text-wrap: balance;
      }
      /* Between groups. */
      .pip-screen-c0 > .pip-c0-illustration,
      .pip-screen-ready > .pip-ready-profile-label,
      .pip-screen-welcome > .pip-intro-primary-btn,
      .pip-screen-prep > .pip-intro-primary-btn,
      .pip-screen-c0 > .pip-intro-primary-btn,
      .pip-screen-failed > .pip-decision-actions,
      .pip-screen-ready > .pip-ready-start-btn { margin-top: var(--space-5); }
      /* Within the control group. */
      .pip-screen-c0 > .pip-intro-body,
      .pip-screen-ready > .pip-ready-selector-wrap,
      .pip-screen-ready > .pip-ready-contextual-actions { margin-top: var(--space-2); }
      .pip-screen-ready > .pip-ready-contextual-actions:empty { display: none; }
      /* Primary button → 12 → its fine print or text link. */
      .pip-screen-welcome > .pip-intro-disclaimer,
      .pip-screen-prep > .pip-text-btn,
      .pip-screen-c0 > .pip-text-btn,
      .pip-screen-failed > .pip-text-btn,
      .pip-screen-ready > .pip-ready-disclaimer { margin-top: var(--space-3); }
      .pip-screen-ready > .pip-ready-heading { min-height: 0; }
      .pip-c0-illustration { max-width: 44px; }
      /* The sound-filter note: one line at the 280px column, centered;
         it wraps only in a manually narrowed window. */
      .pip-ready-recalibrate-note { text-align: center; }
      /* Round 4 study check-in card (renderStudyCard()): a bordered group
         after the disclaimer, one group gap below it, a little lighter than
         the window so it stands out (2026-11-10). Open check-in is filled
         with a translucent cream, lighter than Start monitoring's solid
         cream so the two don't compete. No chartreuse. */
      .pip-screen-ready > .pip-study-card { margin-top: var(--space-5); }
      .pip-study-card.hidden { display: none; }
      .pip-study-card {
        width: 100%;
        max-width: var(--col-width);
        box-sizing: border-box;
        padding: var(--space-3) var(--space-4);
        border: 1px solid color-mix(in srgb, var(--color-text) 16%, transparent);
        border-radius: var(--radius-control);
        background: color-mix(in srgb, var(--color-text) 8%, var(--color-bg));
        text-align: center;
      }
      .pip-study-card-title {
        margin: 0;
        font-family: var(--font-body);
        font-size: 14px;
        font-weight: var(--weight-medium);
        line-height: 1.4;
        color: var(--color-text);
      }
      .pip-study-card-sub {
        margin: 2px 0 0;
        font-family: var(--font-body);
        font-size: 12px;
        line-height: 1.4;
        color: var(--color-text-muted);
      }
      .pip-study-card-actions {
        margin-top: var(--space-3);
        display: flex;
        justify-content: center;
        align-items: center;
        gap: var(--space-4);
      }
      .pip-study-card-open {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        box-sizing: border-box;
        padding: 0 var(--space-3);
        border: 1px solid transparent;
        border-radius: var(--radius-control);
        background: color-mix(in srgb, var(--color-text) 22%, transparent);
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: var(--weight-medium);
        color: var(--color-text);
        text-decoration: none;
        cursor: pointer;
      }
      .pip-study-card-open:hover {
        background: color-mix(in srgb, var(--color-text) 30%, transparent);
      }
      .pip-study-card-open:active {
        background: color-mix(in srgb, var(--color-text) 36%, transparent);
      }
      .pip-study-card-open:focus-visible {
        outline: 2px solid var(--color-link);
        outline-offset: 2px;
      }
      .pip-study-card-skip { min-height: 24px; }

      /* ── A. Sequence ── */
      .pip-screen-calibrating,
      .pip-screen-creating {
        justify-content: flex-start;
        gap: 0;
        padding: var(--space-6) var(--space-6) calc(var(--footer-inset) + 24px + var(--space-5));
      }
      .pip-sequence-spacer { visibility: hidden; }
      .pip-sequence-spacer-meter { height: 14px; }
      .pip-calibrating-top {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
      }
      .pip-calibrating-subheading { margin: 0 0 var(--space-2); }
      p.pip-h1.pip-calibrating-heading { margin: 0; }
      .pip-calibrating-middle {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
      }
      /* The number and the status line share one slot, one height. */
      .pip-calibrating-slot {
        position: relative;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
      }
      .pip-calibrating-status { margin: 0; min-height: 0; }
      .pip-calibrating-count { top: 50%; }
      .pip-calibrating-visual { margin: var(--space-3) 0 0; }
      .pip-calibrating-hint { margin-top: var(--space-3); text-align: center; }
      /* The Sequence screens (both listening steps and processing, one
         layout): "Step N of 2" → 8 → the heading, which always reserves two
         lines; then, centered in the middle, the slot (the 48px countdown,
         or the spinner) → 16 → the sage meter → 8 → the helper. Processing
         keeps invisible meter and helper rows, so its slot lines up too. */
      .pip-screen-calibrating p.pip-h1.pip-calibrating-heading,
      .pip-screen-creating p.pip-h1.pip-calibrating-heading { min-height: calc(2 * 1.25em); }
      .pip-screen-calibrating .pip-calibrating-slot,
      .pip-screen-creating .pip-calibrating-slot { height: 48px; }
      .pip-screen-calibrating .pip-calibrating-count {
        font-family: var(--font-mono);
        font-size: 48px;
        font-weight: var(--weight-regular);
        line-height: 1;
        color: #F3EBDE;
      }
      .pip-screen-calibrating .pip-calibrating-visual,
      .pip-screen-creating .pip-calibrating-visual { margin-top: var(--space-4); }
      .pip-screen-calibrating .pip-calibrating-hint,
      .pip-screen-creating .pip-calibrating-hint {
        margin-top: var(--space-2);
        min-height: calc(12px * 1.45);
        color: #B0AB9E;
      }
      .pip-calibrating-cancel { bottom: var(--footer-inset); }

      /* ── C. Decision ── */
      .pip-decision-bar { padding: 0 var(--space-4); }

      /* Recalibrating a saved profile: the Decision bar, "Recalibrating
         {name}", on every screen of the flow. On the prep, listening and
         processing screens it sits over the screen (slate, like the result
         screen it leads to) and the screen's own layout re-centers in the
         space under it, keeping its 32px edge below the bar. */
      .pip-recalibration-bar {
        display: none;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 44px;
        background: var(--color-bg-decision);
      }
      .pip-has-recalibration-bar > .pip-recalibration-bar { display: flex; }
      .pip-screen-prep.pip-has-recalibration-bar,
      .pip-screen-calibrating.pip-has-recalibration-bar,
      .pip-screen-creating.pip-has-recalibration-bar { padding-top: calc(44px + var(--space-6)); }
      .pip-screen-decision > .pip-decision-content,
      .pip-decision-form > .pip-decision-content {
        flex: 0 0 auto;
        margin-top: auto;
        gap: var(--space-2);
        padding: var(--space-5) var(--space-6) 0;
      }
      .pip-screen-decision > .pip-decision-content:last-child { margin-bottom: auto; padding-bottom: var(--space-5); }
      .pip-screen-decision > .pip-decision-actions,
      .pip-decision-form > .pip-decision-actions {
        flex: 0 0 auto;
        gap: var(--space-4); /* 16px clear between stacked buttons (the tap-target rule) */
        margin: var(--space-5) auto auto;
        padding: 0 0 var(--space-5);
      }
      .pip-decision-form { flex: 1 1 auto; justify-content: flex-start; }
      /* Decision screens have no side padding of their own: keep the 32px edges. */
      .pip-screen-decision > .pip-decision-actions,
      .pip-decision-form > .pip-decision-actions { max-width: calc(100% - 2 * var(--space-6)); }
      .pip-decision-tip { margin: 0; }

      /* ── Hit areas: every control at least 24px tall (padding, not
         bigger text), with at least 16px of clear space between adjacent
         hit areas. Text links get their height from padding. ── */
      .pip-text-btn,
      .pip-ready-contextual-link,
      .pip-ready-selector-footer-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 24px;
        padding-block: 4px;
        box-sizing: border-box;
      }
      .pip-ready-contextual-link { padding-inline: 4px; }
      /* The inline Recalibrate: a 24px-tall hit area within its line. */
      .pip-ready-recalibrate-note { line-height: 24px; }
      .pip-inline-link { display: inline-block; line-height: 24px; padding-inline: 2px; }
      /* A link under a button: 16px clear between the two hit areas. */
      .pip-screen-prep > .pip-text-btn,
      .pip-screen-c0 > .pip-text-btn,
      .pip-screen-failed > .pip-text-btn { margin-top: var(--space-4); }
      /* Ready: the link or note under the dropdown, 16px clear (12 asked
         for, but 16 is the floor between hit areas), then 24 to Start. */
      .pip-screen-ready > .pip-ready-contextual-actions { margin-top: var(--space-4); }

      /* Monitoring's controls: see "Monitoring, by size band" above. */
    `;
    pipDoc.head.appendChild(style);

    pipDoc.body.setAttribute('data-surface', 'dark');
    pipDoc.body.setAttribute('data-layout', layoutMode);

    const layout = pipDoc.createElement('div');
    layout.className = 'pip-layout';

    // ── Welcome/01 — reached exactly once, the first time the Companion
    //    opens with zero saved profiles (see enterPipReadyMode()). A
    //    deliberate first moment, not an instant redirect into Calibrating.
    //    Its own primary action goes to C1 (the calibration-introduction
    //    interstitial) — microphone access isn't requested until C1's own
    //    primary action actually starts a calibration. No secondary dismiss
    //    action here (see the PRD's State 01 — it lists none) — closing the
    //    Companion remains available through the native window control
    //    regardless of screen. Reuses Ready's fixed size; no Compact
    //    variant. Copy matches docs/prd/ready-screen-speaking-profiles-mvp.md
    //    and design/prototypes/ready-screen-states.html exactly. ──
    const welcomeScreen = pipDoc.createElement('div');
    welcomeScreen.className = 'pip-screen pip-screen-welcome hidden';

    // The "mezzo" wordmark is Welcome's heading (2026-10-22, replacing a
    // separate "Welcome" heading): the screen's one <h1>, at the top. The
    // window's accessible name reads "Mezzo, welcome." while it shows (see
    // showOnlyScreen()).
    const welcomeWordmark = pipDoc.createElement('h1');
    welcomeWordmark.className = 'pip-wordmark pip-welcome-wordmark';
    welcomeWordmark.textContent = 'mezzo';
    welcomeScreen.appendChild(welcomeWordmark);

    const welcomeBody = pipDoc.createElement('p');
    welcomeBody.className = 'pip-intro-body';
    welcomeBody.textContent = "A gentle nudge when you're talking louder than you'd like. First, a quick voice calibration.";
    welcomeScreen.appendChild(welcomeBody);

    // The primary action, then its fine print (the Single-choice template:
    // button → 12 → fine print).
    const welcomePrimaryBtn = pipDoc.createElement('button');
    welcomePrimaryBtn.type = 'button';
    welcomePrimaryBtn.className = 'pip-intro-primary-btn';
    welcomePrimaryBtn.textContent = 'Create speaking profile';
    welcomePrimaryBtn.addEventListener('click', handleWelcomeCalibrateClick);
    welcomeScreen.appendChild(welcomePrimaryBtn);

    const welcomeDisclaimer = pipDoc.createElement('p');
    welcomeDisclaimer.className = 'pip-intro-disclaimer';
    welcomeDisclaimer.textContent = 'Mezzo only measures volume. Nothing you say is recorded.';
    welcomeScreen.appendChild(welcomeDisclaimer);

    layout.appendChild(welcomeScreen);
    welcomeScreenEl = welcomeScreen;

    // ── Calibration prep screens (the Single choice template): one per
    //    step. Each says which step this is, what to do and for how long,
    //    then waits: nothing is measured until "I'm ready". Recalibrating a
    //    saved profile adds the "Recalibrating {name}" header bar. See
    //    PREP_COPY. ──
    const addRecalibrationBar = (screen) => {
      const bar = pipDoc.createElement('div');
      bar.className = 'pip-decision-bar pip-recalibration-bar';
      const label = pipDoc.createElement('p');
      label.className = 'pip-decision-bar-title';
      bar.appendChild(label);
      screen.appendChild(bar);
      recalibrationBars.push({ screen, label });
    };

    for (const step of [1, 2]) {
      const copy = PREP_COPY[step];
      const prepScreen = pipDoc.createElement('div');
      prepScreen.className = `pip-screen pip-screen-prep pip-screen-prep-${step === 1 ? 'room' : 'voice'} hidden`;

      addRecalibrationBar(prepScreen);
      const eyebrow = pipDoc.createElement('p');
      eyebrow.className = 'pip-prep-eyebrow pip-prep-step';
      eyebrow.textContent = copy.eyebrow;
      prepScreen.appendChild(eyebrow);

      const heading = pipDoc.createElement('h1');
      heading.className = 'pip-h1 pip-prep-heading';
      heading.tabIndex = -1; // focused when the screen opens
      heading.textContent = copy.heading;
      prepScreen.appendChild(heading);
      prepHeadingEls[step] = heading;

      const body = pipDoc.createElement('p');
      body.className = 'pip-prep-body';
      body.textContent = copy.body;
      prepScreen.appendChild(body);

      const readyBtn = pipDoc.createElement('button');
      readyBtn.type = 'button';
      readyBtn.className = 'pip-intro-primary-btn';
      readyBtn.textContent = "I'm ready";
      readyBtn.addEventListener('click', step === 1 ? handleRoomStepReady : handleVoiceStepReady);
      prepScreen.appendChild(readyBtn);

      const cancelBtn = pipDoc.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pip-text-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', handleCalibrationCancel);
      prepScreen.appendChild(cancelBtn);

      layout.appendChild(prepScreen);
      prepScreenEls[step] = prepScreen;
    }

    // ── C0 — dedicated microphone-blocked screen, reached instead of the
    //    generic Calibration Failed screen for MIC_PERMISSION_DENIED and
    //    (as of the calibration-stall reliability correction) also
    //    MIC_ACQUISITION_TIMEOUT (see showFailedScreen()/showC0Screen()).
    //    Reuses Failed's own Try Again/Back handlers — the underlying
    //    recovery is identical, only the explanatory copy differs, and now
    //    differs BY failure code too, not just from the generic screen:
    //    MIC_PERMISSION_DENIED's heading/body match the PRD/design artifact
    //    exactly, with one deliberate change: "then try again" rather than
    //    the PRD's "then reload this page" — this screen's own in-app Try
    //    again action (see below) makes a manual page reload unnecessary;
    //    the PRD's own wording assumed no such action existed.
    //    MIC_ACQUISITION_TIMEOUT gets its own distinct, approved copy (see
    //    showC0Screen()) — deliberately never describing the mic as denied
    //    or blocked, since a timeout is a different, calmer failure mode. ──
    const c0Screen = pipDoc.createElement('div');
    c0Screen.className = 'pip-screen pip-screen-c0 hidden';

    // Text content is set per failure code in showC0Screen() below, not
    // here — this is only the empty skeleton, built once. Same icon either
    // way (a solid circle with a slash).
    const c0Heading = pipDoc.createElement('h1');
    c0Heading.className = 'pip-h1 pip-intro-heading';
    c0Screen.appendChild(c0Heading);
    c0HeadingEl = c0Heading;

    const c0Illustration = pipDoc.createElement('div');
    c0Illustration.className = 'pip-c0-illustration';
    c0Illustration.innerHTML = C0_BLOCKED_ICON_SVG;
    c0Screen.appendChild(c0Illustration);

    const c0Body = pipDoc.createElement('p');
    c0Body.className = 'pip-intro-body';
    c0Screen.appendChild(c0Body);
    c0BodyEl = c0Body;

    const c0PrimaryBtn = pipDoc.createElement('button');
    c0PrimaryBtn.type = 'button';
    c0PrimaryBtn.className = 'pip-intro-primary-btn';
    c0PrimaryBtn.textContent = 'Try again';
    c0PrimaryBtn.addEventListener('click', handleFailedTryAgain);
    c0Screen.appendChild(c0PrimaryBtn);

    const c0BackBtn = pipDoc.createElement('button');
    c0BackBtn.type = 'button';
    c0BackBtn.className = 'pip-text-btn';
    c0BackBtn.textContent = 'Back';
    c0BackBtn.addEventListener('click', handleFailedBack);
    c0Screen.appendChild(c0BackBtn);

    layout.appendChild(c0Screen);
    c0ScreenEl = c0Screen;

    // ── Ready screen — the approved selector model (see
    //    docs/prd/ready-screen-speaking-profiles-mvp.md). Heading, the
    //    "Speaking profile" label, a collapsed selector trigger that
    //    expands into an overlay panel, contextual actions, Start
    //    monitoring, and the privacy disclaimer — always in that order, a
    //    profile change never restructures the screen. Populated by
    //    renderReadyScreen()/renderSelectorPanel() below, not here — this
    //    only builds the empty skeleton once; content is (re)rendered every
    //    time the screen is (re)shown or the selection changes. ──
    const readyScreen = pipDoc.createElement('div');
    readyScreen.className = 'pip-screen pip-screen-ready';
    // No in-page title bar here either — the real Document PiP window
    // chrome is the only title bar now, in every state (see pipDoc.title
    // in startMonitoring()).

    const readyHeading = pipDoc.createElement('h1');
    readyHeading.className = 'pip-h1 pip-ready-heading';
    readyScreen.appendChild(readyHeading);
    readyHeadingEl = readyHeading;

    const readyLabel = pipDoc.createElement('div');
    readyLabel.id = 'pip-ready-profile-label';
    readyLabel.className = 'pip-ready-profile-label';
    readyLabel.textContent = 'Speaking profile';
    // No visible colon on the eyebrow; its aria-label keeps one, so the
    // selector's accessible name still reads "Speaking profile: {name}"
    // (see the trigger's aria-labelledby below).
    readyLabel.setAttribute('aria-label', 'Speaking profile:');
    readyScreen.appendChild(readyLabel);

    // Trigger and panel share one position:relative wrapper (see
    // .pip-ready-selector-wrap's own comment above) — not the whole Ready
    // screen — so the panel always anchors just below the trigger's real
    // rendered position, regardless of how tall the heading/label above it
    // happen to render.
    // Menu-layer scrim (PRD §7): dims the screen behind the open selector.
    // Sits under .pip-ready-selector-wrap, so the trigger and its panel stay
    // undimmed. Clicks on it fall through to handleSelectorOutsideClick(),
    // which already closes the panel for any click outside it.
    const selectorScrim = pipDoc.createElement('div');
    selectorScrim.className = 'pip-ready-scrim hidden';
    selectorScrim.setAttribute('aria-hidden', 'true');
    readyScreen.appendChild(selectorScrim);
    readyScrimEl = selectorScrim;

    const selectorWrap = pipDoc.createElement('div');
    selectorWrap.className = 'pip-ready-selector-wrap';
    readyScreen.appendChild(selectorWrap);

    // Disclosure trigger (Batch 2) — aria-expanded + aria-controls only, no
    // aria-haspopup: the disclosed panel below is a <fieldset> now, not a
    // listbox, so claiming listbox popup semantics here would be
    // inaccurate. See the panel's own comment for why it's a fieldset.
    const selectorTrigger = pipDoc.createElement('button');
    selectorTrigger.type = 'button';
    selectorTrigger.className = 'pip-ready-selector-trigger';
    selectorTrigger.setAttribute('aria-expanded', 'false');
    selectorTrigger.setAttribute('aria-controls', 'pip-ready-selector-panel');
    const selectorTriggerName = pipDoc.createElement('span');
    selectorTriggerName.id = 'pip-ready-selector-trigger-name';
    selectorTriggerName.className = 'pip-ready-selector-trigger-name';
    // aria-labelledby chains the static "Speaking profile" label (its colon
    // visually hidden) with the
    // dynamic selected-name span, in that order, so the trigger's computed
    // accessible name is "Speaking profile: {name}" (e.g. "Speaking
    // profile: Presentation") rather than the bare name alone — found
    // missing during the Batch 2 audit (see CLAUDE.md's Engineering Notes).
    // Both referenced ids live on elements already inside the trigger's own
    // rendered content, so this updates automatically whenever
    // selectorTriggerName's textContent changes (see renderReadyScreen())
    // — no separate aria-label to keep in sync. The chevron stays
    // aria-hidden (see CHEVRON_ICON_SVG) so it never contributes text.
    selectorTrigger.setAttribute('aria-labelledby', 'pip-ready-profile-label pip-ready-selector-trigger-name');
    // Sage dot bullet before the selected name (PRD §9a). Decorative.
    const selectorTriggerDot = pipDoc.createElement('span');
    selectorTriggerDot.className = 'pip-dot';
    selectorTriggerDot.setAttribute('aria-hidden', 'true');
    selectorTrigger.appendChild(selectorTriggerDot);
    selectorTrigger.appendChild(selectorTriggerName);
    selectorTrigger.insertAdjacentHTML('beforeend', CHEVRON_ICON_SVG);
    selectorTrigger.addEventListener('click', handleSelectorTriggerClick);
    selectorWrap.appendChild(selectorTrigger);
    readySelectorTriggerEl = selectorTrigger;
    readySelectorTriggerNameEl = selectorTriggerName;

    // A native <fieldset> — the smallest native structure that accurately
    // represents what's actually inside it: a mutually-exclusive group of
    // native radio profile choices (real radiogroup semantics, entirely
    // free arrow-key/Tab/Space behavior, no custom keydown handling needed
    // for selection itself) plus independent delete/discard buttons, which
    // don't belong inside any single ARIA composite widget's option/radio
    // children. role="listbox" was the pre-Batch-2 choice here and didn't
    // honestly describe either of those things. Its <legend> — the
    // fieldset's one accessible name (visually hidden — the visible
    // "Speaking profile" label above the trigger already serves as the
    // on-screen heading for this control); no aria-label needed alongside
    // it — is (re)created fresh in renderSelectorPanel() on every open, not
    // here: this skeleton build only runs once, but the panel's own
    // innerHTML gets fully rebuilt on every open, which would otherwise
    // wipe a legend only ever added at this one-time skeleton stage.
    const selectorPanel = pipDoc.createElement('fieldset');
    selectorPanel.id = 'pip-ready-selector-panel';
    selectorPanel.className = 'pip-ready-selector-panel hidden';
    selectorWrap.appendChild(selectorPanel);
    readySelectorPanelEl = selectorPanel;

    const contextualActions = pipDoc.createElement('div');
    contextualActions.className = 'pip-ready-contextual-actions';
    readyScreen.appendChild(contextualActions);
    readyContextualActionsEl = contextualActions;

    // Reuses the shared marketing-site .btn-primary treatment for its
    // color/typography (Batch 2) — its own width now comes from
    // .pip-ready-start-btn directly (2026-08-19: narrower-than-the-
    // selector target, see that class's own CSS comment), not the old
    // .btn-wide modifier (padding-driven width, retired along with this —
    // it had no other caller).
    const pipStartBtn = pipDoc.createElement('button');
    pipStartBtn.type = 'button';
    pipStartBtn.className = 'pip-ready-start-btn btn-primary';
    pipStartBtn.textContent = 'Start monitoring';
    pipStartBtn.addEventListener('click', resumeMonitoringFromPipReady);
    readyScreen.appendChild(pipStartBtn);
    readyStartBtn = pipStartBtn;

    const readyDisclaimer = pipDoc.createElement('p');
    readyDisclaimer.className = 'pip-ready-disclaimer';
    readyDisclaimer.textContent = 'Mezzo only measures volume. Nothing you say is recorded.';
    readyScreen.appendChild(readyDisclaimer);
    readyDisclaimerEl = readyDisclaimer;

    // Round 4 study check-in card (renderStudyCard()). After the
    // disclaimer, so Ready's own order is unchanged and the card can never
    // cover Start monitoring; hidden unless a tester code is saved.
    const studyCard = pipDoc.createElement('div');
    studyCard.className = 'pip-study-card hidden';
    studyCard.setAttribute('role', 'group');
    studyCard.setAttribute('aria-labelledby', 'pip-study-card-title');
    const studyCardTitle = pipDoc.createElement('p');
    studyCardTitle.id = 'pip-study-card-title';
    studyCardTitle.className = 'pip-study-card-title';
    studyCardTitle.textContent = 'How did your call go?';
    const studyCardSub = pipDoc.createElement('p');
    studyCardSub.className = 'pip-study-card-sub';
    studyCardSub.textContent = '1-minute check-in';
    const studyCardActions = pipDoc.createElement('div');
    studyCardActions.className = 'pip-study-card-actions';
    const studyCardOpen = pipDoc.createElement('a');
    studyCardOpen.className = 'pip-study-card-open';
    studyCardOpen.textContent = 'Open check-in';
    studyCardOpen.target = '_blank';
    studyCardOpen.rel = 'noopener noreferrer';
    studyCardOpen.addEventListener('click', handleStudyCardOpen);
    const studyCardSkip = pipDoc.createElement('button');
    studyCardSkip.type = 'button';
    studyCardSkip.className = 'pip-text-btn pip-study-card-skip';
    studyCardSkip.textContent = 'Skip this one';
    studyCardSkip.addEventListener('click', handleStudyCardSkip);
    studyCardActions.append(studyCardOpen, studyCardSkip);
    studyCard.append(studyCardTitle, studyCardSub, studyCardActions);
    readyScreen.appendChild(studyCard);
    studyCardEl = studyCard;
    studyCardOpenEl = studyCardOpen;

    layout.appendChild(readyScreen);
    readyScreenEl = readyScreen;

    // ── Calibrating (C2) ── (see "Calibration" in docs/product-experience.md)
    const calibratingScreen = pipDoc.createElement('div');
    calibratingScreen.className = 'pip-screen pip-screen-calibrating hidden';
    addRecalibrationBar(calibratingScreen);

    // The Sequence template: the eyebrow ("Listening to background noise" /
    // "Listening to your voice") sits at a fixed top position
    // (.pip-calibrating-top), and the middle slot (the countdown, the meter
    // and, in Step 2, its helper) is centered between it and Cancel. Both
    // steps share this one screen and its layout; only the eyebrow and the
    // helper line differ.
    const calibratingTop = pipDoc.createElement('div');
    calibratingTop.className = 'pip-calibrating-top';
    calibratingScreen.appendChild(calibratingTop);

    // aria-hidden, both: the one-time announcement (calibratingAnnounceEl)
    // reads the step, the instruction and the length instead.
    const calibratingSubheading = pipDoc.createElement('div');
    calibratingSubheading.className = 'pip-calibrating-subheading pip-listening-eyebrow';
    calibratingSubheading.setAttribute('aria-hidden', 'true');
    calibratingTop.appendChild(calibratingSubheading);
    calibratingSubheadingEl = calibratingSubheading;
    const calibratingHeading = pipDoc.createElement('p');
    calibratingHeading.className = 'pip-h1 pip-calibrating-heading pip-listening-heading';
    calibratingHeading.setAttribute('aria-hidden', 'true');
    calibratingTop.appendChild(calibratingHeading);
    calibratingHeadingEl = calibratingHeading;

    const calibratingMiddle = pipDoc.createElement('div');
    calibratingMiddle.className = 'pip-calibrating-middle';
    calibratingScreen.appendChild(calibratingMiddle);

    // One slot for the countdown and, only while a slow microphone is still
    // starting, "Preparing microphone…", so they sit in the same place.
    // Both are aria-hidden: assistive tech hears one announcement per step
    // instead (calibratingAnnounceEl, below), never every second.
    const calibratingSlot = pipDoc.createElement('div');
    calibratingSlot.className = 'pip-calibrating-slot';
    calibratingMiddle.appendChild(calibratingSlot);
    const calibratingCount = pipDoc.createElement('div');
    calibratingCount.className = 'pip-calibrating-count';
    calibratingCount.setAttribute('aria-hidden', 'true'); // the one-time announcement covers it
    calibratingSlot.appendChild(calibratingCount);
    calibratingCountEl = calibratingCount;
    const calibratingStatus = pipDoc.createElement('div');
    calibratingStatus.className = 'pip-calibrating-status';
    calibratingStatus.setAttribute('aria-hidden', 'true');
    calibratingSlot.appendChild(calibratingStatus);
    calibratingStatusEl = calibratingStatus;

    // Segmented level meter (PRD §8): six sage segments that follow the
    // live level in both steps (the room in Step 1, the voice in Step 2).
    // role="meter", 0–6.
    const calibratingVisual = pipDoc.createElement('div');
    calibratingVisual.className = 'pip-calibrating-visual';
    calibratingMiddle.appendChild(calibratingVisual);
    levelMeter = new MezzoLevelMeter(calibratingVisual);

    const calibratingHint = pipDoc.createElement('p');
    calibratingHint.className = 'pip-calibrating-hint';
    calibratingMiddle.appendChild(calibratingHint);
    calibratingHintEl = calibratingHint;

    // Static, visually-hidden live region carrying one announcement per
    // step ("Listening to background noise, 3 seconds" / "Listening to your
    // voice, 6 seconds"), kept separate from the countdown so its
    // per-second changes never reach assistive tech.
    const calibratingAnnounce = pipDoc.createElement('div');
    calibratingAnnounce.className = 'pip-calibrating-announce';
    calibratingAnnounce.setAttribute('aria-live', 'polite');
    calibratingAnnounce.style.cssText = 'position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;';
    calibratingScreen.appendChild(calibratingAnnounce);
    calibratingAnnounceEl = calibratingAnnounce;

    const calibratingCancelBtn = pipDoc.createElement('button');
    calibratingCancelBtn.type = 'button';
    calibratingCancelBtn.className = 'pip-text-btn pip-calibrating-cancel';
    calibratingCancelBtn.textContent = 'Cancel';
    calibratingCancelBtn.addEventListener('click', handleCalibrationCancel);
    calibratingScreen.appendChild(calibratingCancelBtn);

    layout.appendChild(calibratingScreen);
    calibratingScreenEl = calibratingScreen;

    // ── Calibration Failed — every failure code except MIC_PERMISSION_DENIED
    //    (which routes to the dedicated C0 screen above instead). ──
    const failedScreen = pipDoc.createElement('div');
    failedScreen.className = 'pip-screen pip-screen-failed hidden';

    const failedMessage = pipDoc.createElement('p');
    failedMessage.className = 'pip-h1 pip-failed-message';
    failedMessage.setAttribute('aria-live', 'assertive');
    failedScreen.appendChild(failedMessage);
    failedMessageEl = failedMessage;

    const failedActions = pipDoc.createElement('div');
    failedActions.className = 'pip-decision-actions';
    const failedTryAgainBtn = pipDoc.createElement('button');
    failedTryAgainBtn.type = 'button';
    failedTryAgainBtn.className = 'pip-decision-primary-btn';
    failedTryAgainBtn.textContent = 'Try Again';
    failedTryAgainBtn.addEventListener('click', handleFailedTryAgain);
    failedActions.appendChild(failedTryAgainBtn);
    failedScreen.appendChild(failedActions);

    const failedBackBtn = pipDoc.createElement('button');
    failedBackBtn.type = 'button';
    failedBackBtn.className = 'pip-text-btn';
    failedBackBtn.textContent = 'Back';
    failedBackBtn.addEventListener('click', handleFailedBack);
    failedScreen.appendChild(failedBackBtn);

    layout.appendChild(failedScreen);
    failedScreenEl = failedScreen;

    // ── "Creating your speaking profile…" — the brief completion
    //    transition (Slice 2 revision, simplified 2026-08-12) between real
    //    capture ending and a result screen appearing. Not a decision
    //    screen (no buttons) — a small spinner plus static text, matching
    //    Calibrating's own non-h1, transient-state heading treatment (see
    //    calibratingHeading above) rather than the decision screens'
    //    focused h1. Single-stage throughout — no checkmark/"done" state of
    //    its own; the result screen behind it communicates completion. See
    //    showCreatingTransition() for the timing model. ──
    // The Sequence template, like Calibrating: the same eyebrow and
    // heading position, and the spinner in the same slot the 3-2-1 number
    // and "Listening… Ns" use. The meter and hint rows are kept as
    // invisible spacers so the slot lands in exactly the same place. No
    // Cancel: there's nothing left to cancel.
    const creatingScreen = pipDoc.createElement('div');
    creatingScreen.className = 'pip-screen pip-screen-creating pip-screen-sequence hidden';
    addRecalibrationBar(creatingScreen);

    const creatingTop = pipDoc.createElement('div');
    creatingTop.className = 'pip-calibrating-top';
    creatingScreen.appendChild(creatingTop);
    // An invisible eyebrow line, so the heading sits one line below where
    // listening's eyebrow is, in every flow. A recalibration's profile name
    // is in the header bar instead.
    const creatingEyebrow = pipDoc.createElement('div');
    creatingEyebrow.className = 'pip-calibrating-subheading pip-sequence-spacer';
    creatingEyebrow.setAttribute('aria-hidden', 'true');
    creatingEyebrow.textContent = '\u00a0';
    creatingTop.appendChild(creatingEyebrow);
    const creatingText = pipDoc.createElement('p');
    creatingText.className = 'pip-h1 pip-calibrating-heading pip-creating-text';
    creatingText.textContent = 'Creating your speaking profile…';
    creatingText.setAttribute('aria-hidden', 'true'); // decorative visible text — the announcement below is what assistive tech hears
    creatingTop.appendChild(creatingText);
    creatingTextEl = creatingText;

    const creatingMiddle = pipDoc.createElement('div');
    creatingMiddle.className = 'pip-calibrating-middle';
    creatingScreen.appendChild(creatingMiddle);
    const creatingSlot = pipDoc.createElement('div');
    creatingSlot.className = 'pip-calibrating-slot';
    creatingMiddle.appendChild(creatingSlot);
    const creatingIcon = pipDoc.createElement('div');
    creatingIcon.className = 'pip-creating-icon';
    creatingIcon.setAttribute('aria-hidden', 'true');
    creatingIcon.innerHTML = '<span class="pip-creating-spinner"></span>';
    creatingSlot.appendChild(creatingIcon);
    const creatingMeterSpacer = pipDoc.createElement('div');
    creatingMeterSpacer.className = 'pip-calibrating-visual pip-sequence-spacer pip-sequence-spacer-meter';
    creatingMeterSpacer.setAttribute('aria-hidden', 'true');
    creatingMiddle.appendChild(creatingMeterSpacer);
    const creatingHintSpacer = pipDoc.createElement('p');
    creatingHintSpacer.className = 'pip-calibrating-hint pip-sequence-spacer';
    creatingHintSpacer.setAttribute('aria-hidden', 'true');
    creatingHintSpacer.textContent = '\u00a0';
    creatingMiddle.appendChild(creatingHintSpacer);

    // Visually-hidden, single-fire live region — announces once, as soon
    // as this screen appears, rather than narrating a spinner it can't
    // meaningfully describe anyway. Kept separate from the visible text
    // above so this element's own content only ever changes at the one
    // moment meant to be announced (see the identical convention already
    // established for Calibrating's own calibratingAnnounceEl).
    const creatingAnnounce = pipDoc.createElement('div');
    creatingAnnounce.className = 'pip-creating-announce';
    creatingAnnounce.setAttribute('aria-live', 'polite');
    creatingAnnounce.style.cssText = 'position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;';
    creatingScreen.appendChild(creatingAnnounce);
    creatingAnnounceEl = creatingAnnounce;

    layout.appendChild(creatingScreen);
    creatingScreenEl = creatingScreen;

    // ── M1 (Slice 2, Variant 2) — reached only from a saved-profile
    //    recalibration's completion (see handleCalibrationCompleted()).
    //    Shares Variant 1's exact heading/body (see resultHeading/resultBody
    //    below) — only the primary button's label still differs, since
    //    naming the target profile is the one thing this variant alone
    //    needs to say (see replaceButtonLabel()).
    //
    //    Action hierarchy (2026-08-13 revision; reordered 2026-08-16; Try
    //    again removed 2026-08-18 — see below): the screen answers one
    //    question — "what do I want to do with it?" — top to bottom:
    //    heading, body/question, then the three decisions — primary
    //    (Replace), Keep temporarily, Discard — all inside one
    //    .pip-decision-actions block, full-width, no divider between them.
    //    Try again (a standalone shortcut that repeated capture without
    //    going through Discard first) was removed outright: a user unhappy
    //    with the result can already Discard, return to the appropriate
    //    prior state, and begin again — the extra shortcut wasn't
    //    necessary. DOM order matches visual and keyboard-focus order
    //    exactly. ──
    // The noisy-room tip (2026-10-22): shown on a result screen when the
    // calibration's speech sat less than 10 dB above the room noise
    // measured during Step 1 (engine.js's isNoisyRoom(), NOISY_ROOM_GAP_DB).
    const buildNoisyRoomTip = () => {
      const tip = pipDoc.createElement('p');
      tip.className = 'pip-decision-tip hidden';
      tip.textContent = NOISY_ROOM_TIP;
      return tip;
    };

    const m1Screen = pipDoc.createElement('div');
    // pip-screen-m1 — a dedicated hook class, not just pip-screen-decision:
    // this screen and resultScreen below now render byte-for-byte identical
    // heading/body text (both "Your new speaking profile is ready"/"What
    // would you like to do with it?"), so a heading-text-based locator can
    // no longer tell them apart (both exist in the DOM simultaneously, one
    // merely hidden) — this class (and resultScreen's own pip-screen-result)
    // is what tests use instead.
    m1Screen.className = 'pip-screen pip-screen-decision pip-screen-m1 hidden';

    // ── Decision-state header bar (Lantern layers, PRD §7) — shared by
    //    every decision state below: a 44px bar naming the decision in
    //    Geist Mono and, where the state has a way out, holding Cancel in
    //    its corner. The <h1> inside the content stays the screen's real
    //    heading; this title is a plain label. ──
    const buildDecisionBar = (title, cancelBtn = null) => {
      const bar = pipDoc.createElement('div');
      bar.className = 'pip-decision-bar';
      const label = pipDoc.createElement('p');
      label.className = 'pip-decision-bar-title';
      label.textContent = title;
      bar.appendChild(label);
      if (cancelBtn) {
        cancelBtn.classList.add('pip-decision-bar-cancel');
        bar.appendChild(cancelBtn);
      }
      return bar;
    };

    // Content block between the header bar and the bottom-pinned actions
    // (the 2026-08-17 inset modal card is retired — PRD §7).
    const m1Bar = buildDecisionBar('Recalibrating');
    m1BarTitleEl = m1Bar.firstChild; // "Recalibrating {name}", set in showM1Screen()
    m1Screen.appendChild(m1Bar);
    const m1Card = pipDoc.createElement('div');
    m1Card.className = 'pip-decision-content';
    m1Screen.appendChild(m1Card);

    const m1Heading = pipDoc.createElement('h1');
    m1Heading.className = 'pip-h1 pip-decision-heading';
    m1Heading.tabIndex = -1; // programmatically focusable only — see showM1Screen()'s own focus call
    m1Heading.textContent = 'New calibration ready';
    m1Card.appendChild(m1Heading);
    m1HeadingEl = m1Heading;

    // Try again removed (2026-08-18) — a user unhappy with the result can
    // Discard, return to the appropriate prior state, and begin again; the
    // extra shortcut wasn't necessary (see this screen's own construction
    // comment above for the current, simplified hierarchy: heading,
    // question, then the three decisions). handleM1Redo() itself was
    // removed outright along with this — it had no other caller.
    const m1Body = pipDoc.createElement('p');
    m1Body.className = 'pip-decision-body';
    m1Card.appendChild(m1Body); // recalibrationQuestion(), set in showM1Screen()
    m1BodyEl = m1Body;
    m1TipEl = buildNoisyRoomTip();
    m1Card.appendChild(m1TipEl);

    const m1Actions = pipDoc.createElement('div');
    m1Actions.className = 'pip-decision-actions';

    const m1Replace = pipDoc.createElement('button');
    m1Replace.type = 'button';
    m1Replace.className = 'pip-decision-primary-btn';
    m1Replace.addEventListener('click', handleM1Replace);
    m1Actions.appendChild(m1Replace);
    m1ReplaceBtn = m1Replace;

    const m1Keep = pipDoc.createElement('button');
    m1Keep.type = 'button';
    m1Keep.className = 'pip-decision-secondary-btn';
    m1Keep.textContent = 'Keep temporarily';
    m1Keep.addEventListener('click', handleM1KeepAsUnsaved);
    m1Actions.appendChild(m1Keep);
    m1KeepBtn = m1Keep;

    // Discard — the third full-width decision, sharing Keep temporarily's
    // exact secondary-button treatment (2026-08-14 visual-language pass —
    // no icon, no distinct de-emphasized surface of its own; see
    // .pip-decision-discard-btn's own comment for why).
    const m1Discard = pipDoc.createElement('button');
    m1Discard.type = 'button';
    m1Discard.className = 'pip-decision-secondary-btn pip-decision-discard-btn';
    m1Discard.textContent = 'Discard';
    m1Discard.addEventListener('click', handleM1Discard);
    m1Actions.appendChild(m1Discard);
    m1DiscardBtn = m1Discard;

    m1Screen.appendChild(m1Actions);

    layout.appendChild(m1Screen);
    m1ScreenEl = m1Screen;

    // ── "Your new speaking profile is ready" (Slice 2, Variant 1) —
    //    reached from a session-mode calibration's completion: a brand-new
    //    profile, or redoing for the current Temporary profile (both
    //    session mode — see handleCalibrationCompleted()). The calibration
    //    result is already committed to the Temporary profile by the time
    //    this screen shows (see showCreatingTransition()), so its own
    //    actions reuse the exact same profile/session state Ready itself
    //    would use. No Start monitoring here (starting Monitoring is a
    //    separate choice, made from Ready) — every action below resolves
    //    the new profile first, then returns to Ready.
    //
    //    Action hierarchy: identical structure/reasoning to M1 above — see
    //    that screen's own comment (heading, question, then the three
    //    decisions — Try again removed 2026-08-18). ──
    const resultScreen = pipDoc.createElement('div');
    resultScreen.className = 'pip-screen pip-screen-decision pip-screen-result hidden';

    // The one-off result card is removed (PRD §2.3, §7): same header bar,
    // content block, and bottom-pinned actions as every decision state.
    resultScreen.appendChild(buildDecisionBar('New profile'));
    const resultCard = pipDoc.createElement('div');
    resultCard.className = 'pip-decision-content';
    resultScreen.appendChild(resultCard);

    const resultHeading = pipDoc.createElement('h1');
    resultHeading.className = 'pip-h1 pip-decision-heading';
    resultHeading.tabIndex = -1;
    resultHeading.textContent = 'Your new speaking profile is ready';
    resultCard.appendChild(resultHeading);
    resultHeadingEl = resultHeading;

    // Try again removed (2026-08-18) — see M1's own construction comment
    // above for the full reasoning; identical here. Redoing is still
    // reachable indirectly: Discard restores the prior selection (or
    // Welcome, for a first-ever creation — see handleResultDiscard()) and
    // handleUnsavedRecalibrateClick() (unchanged, still shared with the
    // Ready selector panel's own per-row Recalibrate icon for the
    // Temporary profile) remains the way a Temporary profile gets
    // re-captured from there.
    const resultBody = pipDoc.createElement('p');
    resultBody.className = 'pip-decision-body';
    resultBody.textContent = 'What would you like to do with it?';
    resultCard.appendChild(resultBody);
    resultTipEl = buildNoisyRoomTip();
    resultCard.appendChild(resultTipEl);

    const resultActions = pipDoc.createElement('div');
    resultActions.className = 'pip-decision-actions';

    const resultSave = pipDoc.createElement('button');
    resultSave.type = 'button';
    resultSave.className = 'pip-decision-primary-btn';
    resultSave.textContent = 'Save speaking profile';
    // Direct reuse of Ready's own Save profile handler — unsavedProfile is
    // already set, so the exact same validation/5-profile-limit/duplicate-
    // name handling applies. 'result' tells M2's own Cancel where to
    // return to (see handleM2Cancel()) — a successful save still always
    // returns to Ready regardless (see handleM2Submit()).
    resultSave.addEventListener('click', (event) => handleSaveProfileClick(event, 'result'));
    resultActions.appendChild(resultSave);
    resultSaveBtn = resultSave;

    const resultKeep = pipDoc.createElement('button');
    resultKeep.type = 'button';
    resultKeep.className = 'pip-decision-secondary-btn';
    resultKeep.textContent = 'Keep temporarily';
    resultKeep.addEventListener('click', handleResultKeepTemporarily);
    resultActions.appendChild(resultKeep);
    resultKeepBtn = resultKeep;

    const resultDiscard = pipDoc.createElement('button');
    resultDiscard.type = 'button';
    resultDiscard.className = 'pip-decision-secondary-btn pip-decision-discard-btn';
    resultDiscard.textContent = 'Discard';
    resultDiscard.addEventListener('click', handleResultDiscard);
    resultActions.appendChild(resultDiscard);
    resultDiscardBtn = resultDiscard;

    resultScreen.appendChild(resultActions);

    layout.appendChild(resultScreen);
    resultScreenEl = resultScreen;

    // ── M2/M2a — naming a new profile (below the five-profile cap; at cap,
    //    handleSaveProfileClick() routes to M3 instead, never opening this
    //    screen — see the PRD). M2a is this exact same screen with a
    //    warning shown and the submit button's label swapped to "Update"
    //    (see renderM2State()), not a second screen. ──
    const m2Screen = pipDoc.createElement('div');
    // pip-screen-m2 — a dedicated hook class (2026-08-17, new — this screen
    // previously had none beyond the shared pip-screen-decision), scoping
    // this screen's own inset-modal-card padding override and its own
    // input-to-actions spacing/action-layout rules without touching M3/06b,
    // which still share the plain pip-screen-decision treatment.
    m2Screen.className = 'pip-screen pip-screen-decision pip-screen-m2 hidden';

    // Content block (heading, field, warning); see the header bar and the
    // form assembly below for where it sits.
    const m2Card = pipDoc.createElement('div');
    m2Card.className = 'pip-decision-content';

    // <h1>, not <p> (2026-08-17) — this is the naming screen's one
    // meaningful heading, so it now gets real heading semantics and the
    // exact same typography as "Your new speaking profile is ready" via
    // the shared pip-h1 class (font family/size/weight/line-height/
    // letter-spacing/responsive behavior all come from that one rule —
    // pip-decision-heading only still contributes its own max-width
    // constraint, same as on the result screens). No tabIndex/focus
    // change: this heading is never programmatically focused (unlike
    // resultHeading/m1Heading) — showM2Screen() still focuses m2NameInput
    // directly, unchanged, so tabIndex=-1 (which those two headings use
    // only because THEY receive focus()) would serve no purpose here.
    const m2Heading = pipDoc.createElement('h1');
    m2Heading.className = 'pip-h1 pip-decision-heading';
    m2Heading.textContent = 'Name this profile';
    m2Card.appendChild(m2Heading);

    const m2Form = pipDoc.createElement('form');
    m2Form.className = 'pip-decision-form';

    const m2Input = pipDoc.createElement('input');
    m2Input.type = 'text';
    m2Input.className = 'pip-name-input';
    m2Input.maxLength = 40;
    m2Input.placeholder = 'e.g. Coffee Shop';
    m2Input.setAttribute('aria-label', 'Profile name');
    m2Input.addEventListener('input', renderM2State);
    m2Card.appendChild(m2Input);
    m2NameInput = m2Input;

    // Live, non-error-toned warning — an existing-name match is an
    // expected, natural outcome of this flow (see saveProfileNameCopy()),
    // not a validation failure. Stays directly beneath the input via the
    // form's own unchanged base 10px gap — only the gap above the actions
    // group (below) was widened, so this never moves away from the field
    // it describes.
    const m2Warning = pipDoc.createElement('p');
    m2Warning.className = 'pip-decision-warning hidden';
    m2Warning.id = 'm2-name-warning';
    m2Warning.setAttribute('aria-live', 'polite');
    m2Card.appendChild(m2Warning);
    m2WarningEl = m2Warning;

    // Save (or Replace) is the one bottom-pinned action; Cancel lives in
    // the header bar (PRD §7). pip-m2-actions stays as a hook class.
    const m2Actions = pipDoc.createElement('div');
    m2Actions.className = 'pip-decision-actions pip-m2-actions';

    const m2Submit = pipDoc.createElement('button');
    m2Submit.type = 'submit';
    m2Submit.className = 'pip-decision-primary-btn';
    m2Submit.textContent = 'Save';
    m2Actions.appendChild(m2Submit);
    m2SubmitBtn = m2Submit;

    const m2Cancel = pipDoc.createElement('button');
    m2Cancel.type = 'button';
    m2Cancel.className = 'pip-text-btn';
    m2Cancel.textContent = 'Cancel';
    m2Cancel.addEventListener('click', handleM2Cancel);

    // The form spans content and actions so Save stays a real submit
    // button while the actions sit pinned to the bottom.
    m2Form.appendChild(m2Card);
    m2Form.appendChild(m2Actions);
    m2Form.addEventListener('submit', handleM2Submit);
    m2Screen.appendChild(buildDecisionBar('Save profile', m2Cancel));
    m2Screen.appendChild(m2Form);
    layout.appendChild(m2Screen);
    m2ScreenEl = m2Screen;

    // ── M3 — the five-profile limit. Close-icon-only: no delete/replacement
    //    management inside this screen (see the PRD). ──
    const m3Screen = pipDoc.createElement('div');
    // pip-screen-m3 (2026-08-20, new — this screen previously had none
    // beyond the shared pip-screen-decision) — same pattern as
    // pip-screen-result/-m1/-m2 above: gives the shared modal-card outer-
    // padding rule (see its own comment) a class to key off for this
    // screen specifically, and a dedicated test hook.
    m3Screen.className = 'pip-screen pip-screen-decision pip-screen-m3 hidden';

    // M3's one way out is Cancel in the header bar (formerly a close icon
    // inside the card; same handler, same behavior).
    const m3Close = pipDoc.createElement('button');
    m3Close.type = 'button';
    m3Close.className = 'pip-text-btn';
    m3Close.textContent = 'Cancel';
    m3Close.addEventListener('click', handleM3Close);
    m3Screen.appendChild(buildDecisionBar('Profile limit', m3Close));

    const m3Card = pipDoc.createElement('div');
    m3Card.className = 'pip-decision-content';
    m3Screen.appendChild(m3Card);

    // <h1>, not <p> (2026-08-20) — same reasoning as M2's own heading
    // above: this is the screen's one meaningful heading, so it gets real
    // heading semantics and the exact same typography as "Your new
    // speaking profile is ready" via the shared pip-h1 class.
    const m3Heading = pipDoc.createElement('h1');
    m3Heading.className = 'pip-h1 pip-decision-heading';
    m3Heading.textContent = '5 of 5 profiles saved';
    m3Card.appendChild(m3Heading);

    const m3Body = pipDoc.createElement('p');
    m3Body.className = 'pip-decision-body';
    m3Body.textContent = 'Delete a saved profile before saving this one.';
    m3Card.appendChild(m3Body);
    m3BodyEl = m3Body;

    // Manage profiles: back to Ready with the selector open, where each
    // saved profile has its Delete.
    const m3Actions = pipDoc.createElement('div');
    m3Actions.className = 'pip-decision-actions';
    const m3Manage = pipDoc.createElement('button');
    m3Manage.type = 'button';
    m3Manage.className = 'pip-decision-primary-btn pip-m3-manage-btn';
    m3Manage.textContent = 'Manage profiles';
    m3Manage.addEventListener('click', handleM3ManageProfiles);
    m3Actions.appendChild(m3Manage);
    m3Screen.appendChild(m3Actions);

    layout.appendChild(m3Screen);
    m3ScreenEl = m3Screen;
    m3CloseBtn = m3Close;

    // ── 06b — saved-profile delete confirmation. A dedicated full-screen
    //    state (never an in-dropdown or browser-native confirmation — see
    //    the PRD), reached from the selector panel's own per-row delete
    //    control (see openDeleteScreen()). ──
    const deleteScreen = pipDoc.createElement('div');
    // pip-screen-delete (2026-08-20, new — same reasoning as pip-screen-m3
    // above).
    deleteScreen.className = 'pip-screen pip-screen-decision pip-screen-delete hidden';

    const deleteCancel = pipDoc.createElement('button');
    deleteCancel.type = 'button';
    deleteCancel.className = 'pip-text-btn';
    deleteCancel.textContent = 'Cancel';
    deleteCancel.addEventListener('click', handleDeleteCancel);
    deleteCancelBtn = deleteCancel;
    deleteScreen.appendChild(buildDecisionBar('Delete profile', deleteCancel));

    const deleteCard = pipDoc.createElement('div');
    deleteCard.className = 'pip-decision-content';
    deleteScreen.appendChild(deleteCard);

    // <h1>, not <p> (2026-08-20) — carries the live "Delete "{name}"?" text
    // (set in openDeleteScreen()) — same shared pip-h1 typography as every
    // other modal heading; the profile name interpolated into it wraps
    // safely via pip-decision-heading's own max-width:260px + this card's
    // overflow-wrap-anywhere buttons below (long names were already
    // exercised by this screen's own existing tests).
    const deleteHeading = pipDoc.createElement('h1');
    deleteHeading.className = 'pip-h1 pip-decision-heading';
    deleteCard.appendChild(deleteHeading);
    deleteHeadingEl = deleteHeading;

    const deleteBody = pipDoc.createElement('p');
    deleteBody.className = 'pip-decision-body';
    deleteBody.textContent = "This permanently removes the saved speaking profile. This can't be undone.";
    deleteCard.appendChild(deleteBody);

    // Inline failure copy — same convention as M2's own m2WarningEl (hidden
    // by default, aria-live="polite", shown/hidden via handleDeleteConfirm()'s
    // failure branch below). Reusing the existing .pip-decision-warning
    // pattern rather than inventing a second one; see handleDeleteConfirm()
    // for why this screen needs a failure path at all (Batch 1 root-cause fix).
    const deleteError = pipDoc.createElement('p');
    deleteError.className = 'pip-decision-warning hidden';
    deleteError.id = 'delete-error';
    deleteError.setAttribute('aria-live', 'polite');
    deleteCard.appendChild(deleteError);
    deleteErrorEl = deleteError;

    // Delete is the one bottom-pinned action; Cancel lives in the header
    // bar (PRD §7). pip-delete-actions stays as a hook class.
    const deleteActions = pipDoc.createElement('div');
    deleteActions.className = 'pip-decision-actions pip-delete-actions';

    const deleteConfirmBtnEl = pipDoc.createElement('button');
    deleteConfirmBtnEl.type = 'button';
    deleteConfirmBtnEl.className = 'pip-decision-secondary-btn pip-delete-confirm-btn'; // an outline button: a destructive action shouldn't be the bright default
    deleteConfirmBtnEl.textContent = 'Delete';
    deleteConfirmBtnEl.addEventListener('click', handleDeleteConfirm);
    deleteActions.appendChild(deleteConfirmBtnEl);
    deleteConfirmBtn = deleteConfirmBtnEl;

    deleteScreen.appendChild(deleteActions);
    layout.appendChild(deleteScreen);
    deleteScreenEl = deleteScreen;

    // ── Toast — a save/replace confirmation, floated above whichever screen
    //    is visible (a sibling of every .pip-screen, not owned by any one of
    //    them — see showToast()). ──
    const toast = pipDoc.createElement('div');
    toast.className = 'pip-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const toastCard = pipDoc.createElement('div');
    toastCard.className = 'pip-toast-card';
    toastCard.innerHTML = '<svg class="pip-toast-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false"><path d="M2.5 6.3l2.3 2.2 4.7-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const toastText = pipDoc.createElement('span');
    toastText.className = 'pip-toast-text';
    toastCard.appendChild(toastText);
    toast.appendChild(toastCard);
    layout.appendChild(toast);
    toastEl = toast;
    toastCardEl = toastCard;
    toastTextEl = toastText;
    // A toast that's showing keeps clear of the profile name and controls
    // when the window is resized (placeToast()).
    pipDoc.defaultView?.addEventListener('resize', () => {
      if (toastEl?.classList.contains('pip-toast-visible')) placeToast();
    });

    // ── Row-action tooltip (2026-08-20) — a single shared element, same
    //    sibling-of-every-screen pattern as the toast just above (see
    //    showTooltipFor()/hideTooltip()). role="tooltip", not aria-live:
    //    it's connected to its owning button via aria-describedby (set per
    //    button in buildSelectorRow()), the standard accessible pattern for
    //    a tooltip — not an independent announcement. position:fixed (see
    //    its own CSS) means this never needs to live inside the selector
    //    panel's own scrolling container to stay near a row's button; a
    //    sibling of every .pip-screen keeps it un-clipped by the panel's
    //    overflow-y/overflow-x regardless of scroll position. ──
    const tooltip = pipDoc.createElement('div');
    tooltip.className = 'pip-tooltip hidden';
    tooltip.id = 'pip-row-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    layout.appendChild(tooltip);
    tooltipEl = tooltip;

    // ── Monitoring screen (Expanded + Compact share this one DOM tree —
    //    see the [data-layout] CSS above for what each hides/shows) ──
    const monitoringScreen = pipDoc.createElement('div');
    monitoringScreen.className = 'pip-screen pip-screen-monitoring hidden';

    // Compact view: top right, shown only in the Expanded size band (see
    // the CSS). Inward arrows, the mirror of Expand's outward ones.
    const compactBtn = pipDoc.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'pip-control-btn pip-control-btn-compact';
    compactBtn.setAttribute('aria-label', 'Compact view');
    compactBtn.innerHTML =
      '<svg class="pip-control-icon-compact" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<path d="M10.5 4.5H7.5V1.5M1.5 7.5H4.5V10.5M7.5 4.5L11 1M4.5 7.5L1 11" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    compactBtn.addEventListener('click', enterCompactLayout);
    monitoringScreen.appendChild(compactBtn);

    const monitoringHeader = pipDoc.createElement('div');
    monitoringHeader.className = 'pip-monitoring-header';
    // No in-page title bar here (see startMonitoring()'s pipDoc.title) —
    // the real Document PiP window chrome is the only title bar for every
    // Companion state now, Ready included.

    const statusBlock = pipDoc.createElement('div');
    statusBlock.className = 'pip-monitoring-status-block';

    // The status labels are screen-reader-only (PRD §6): a visually hidden,
    // polite live region, written only by zoneAnnouncer (into or out of
    // Outside range, after it has held ~1s). A direct child of the screen,
    // not the header, so no responsive tier or Compact rule that hides the
    // header can ever silence it.
    const zoneLive = pipDoc.createElement('p');
    zoneLive.className = 'pip-sr-only pip-zone-live';
    zoneLive.setAttribute('role', 'status');
    zoneLive.setAttribute('aria-live', 'polite');
    monitoringScreen.appendChild(zoneLive);
    pipZoneLiveEl = zoneLive;

    const profileInfo = pipDoc.createElement('span');
    profileInfo.className = 'pip-profile-info';
    profileInfo.textContent = profileMetaText(activeProfile);
    statusBlock.appendChild(profileInfo);
    monitoringProfileNameEl = profileInfo;

    monitoringHeader.appendChild(statusBlock);
    monitoringScreen.appendChild(monitoringHeader);

    const circleWrapper = pipDoc.createElement('div');
    circleWrapper.className = 'pip-circle-wrapper';
    monitoringScreen.appendChild(circleWrapper);
    // The Compact and Mini toolbar's panel, behind Stop and Expand
    // (decorative; the buttons keep their own names).
    const toolbarPanel = pipDoc.createElement('div');
    toolbarPanel.className = 'pip-monitoring-toolbar';
    toolbarPanel.setAttribute('aria-hidden', 'true');
    monitoringScreen.appendChild(toolbarPanel);
    pipCircleWrapperEl = circleWrapper;

    // Stop: bottom left. Icon-only in Mini and Compact, a labeled button
    // in Expanded (the label is hidden by CSS below Expanded).
    const controls = pipDoc.createElement('div');
    controls.className = 'pip-monitoring-controls';

    const pipStopBtn = pipDoc.createElement('button');
    pipStopBtn.type = 'button';
    pipStopBtn.className = 'pip-control-btn pip-control-btn-stop';
    pipStopBtn.setAttribute('aria-label', 'Stop monitoring');
    const stopIcon = pipDoc.createElement('span');
    stopIcon.className = 'pip-control-icon-stop';
    stopIcon.setAttribute('aria-hidden', 'true');
    const stopLabel = pipDoc.createElement('span');
    stopLabel.className = 'pip-control-label';
    stopLabel.textContent = 'Stop';
    pipStopBtn.appendChild(stopIcon);
    pipStopBtn.appendChild(stopLabel);
    pipStopBtn.addEventListener('click', stopMonitoring);
    controls.appendChild(pipStopBtn);

    monitoringScreen.appendChild(controls);

    // Expand: top right, below the Expanded size band. Restores the
    // Expanded size without stopping monitoring.
    const expandBtn = pipDoc.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'pip-control-btn pip-control-btn-expand';
    expandBtn.setAttribute('aria-label', 'Expand');
    expandBtn.innerHTML =
      '<svg class="pip-control-icon-expand" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<path d="M7.5 1.5H10.5V4.5M4.5 10.5H1.5V7.5M10.5 1.5L6.5 5.5M1.5 10.5L5.5 6.5" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    expandBtn.addEventListener('click', enterExpandedLayout);
    monitoringScreen.appendChild(expandBtn);

    layout.appendChild(monitoringScreen);
    monitoringScreenEl = monitoringScreen;
    setUpMiniReveal(monitoringScreen);
    setUpControlTooltips(monitoringScreen);

    pipDoc.body.appendChild(layout);

    pipWindow.addEventListener('pagehide', handlePipClose);

    // Resolve the active profile from storage — this tab's own selection if
    // any, else whichever saved profile was last used anywhere (see
    // src/profiles.js's resolveActiveProfile()) — rather than requiring the
    // caller to have already chosen one. Home doesn't choose profiles
    // anymore, so this is the only place that resolution now happens.
    // enterPipReadyMode() then decides Welcome vs. Ready from the saved-
    // profile count itself; every open lands there, never straight into
    // Monitoring.
    activeProfile = resolveActiveProfile();
    const restore = pendingRestore;
    pendingRestore = null;
    if (restore) {
      // Reopen: the same profile as before the close, the unsaved one too.
      unsavedProfile = restore.unsaved ?? null;
      activeProfile = restore.profile ?? activeProfile;
      if (restore.resumeMonitoring) studyResume = restore.studySession ?? null;
    }
    enterPipReadyMode();
    // Reopen after an involuntary close picks up where it left off: if
    // monitoring was running, it starts again with the same profile. A
    // fresh open from Home always stops at Welcome or Ready.
    if (restore?.resumeMonitoring && activeProfile) await resumeMonitoringFromPipReady();
    if (studyResume) {
      // Monitoring didn't resume (no profile, or no microphone): the
      // interrupted session stays ended, and Ready can offer its check-in.
      studyResume = null;
      renderStudyCard();
    }

    return true;
  }

  /** Whether the Companion closed in a way Home should offer to undo (see
   *  reopenOffer). */
  /** True while Reopen Companion is about to continue an interrupted call
   *  (or just has, before monitoring restarts): that call isn't over, so
   *  no view offers its check-in yet. */
  function isResumingCall() {
    return Boolean(pendingRestore?.resumeMonitoring) || Boolean(studyResume);
  }

  function hasReopenOffer() {
    return reopenOffer !== null;
  }

  /** Reopen Companion: from Home's click (Document PiP needs it), with the
   *  profile and monitoring state the close interrupted. */
  async function reopenCompanion() {
    if (!reopenOffer) return startMonitoring();
    pendingRestore = reopenOffer;
    reopenOffer = null;
    const opened = await startMonitoring();
    if (!opened) pendingRestore = null;
    return opened;
  }

  /** Done: the person doesn't want the Companion back. */
  function dismissReopenOffer() {
    reopenOffer = null;
  }

  /** The "Companion closed" page's Open check-in: the interrupted call is
   *  over, like Stop. Its study session was already saved when the
   *  Companion closed (finishStudySession()); Reopen now opens to Ready
   *  instead of resuming monitoring and continuing that session. */
  function endInterruptedSession() {
    if (!reopenOffer) return;
    reopenOffer = { ...reopenOffer, resumeMonitoring: false, studySession: null };
  }

  /** Full teardown: stop monitoring, release the mic, close the Companion. */
  function endSession() {
    reopenOffer = null;
    calibrationController.cancel(); // safe from any status, including idle — covers ending mid-calibration
    if (isMonitoringActive) teardownMonitoringEngine();
    activeCircle = null;
    if (pipWindow) {
      closingOnPurpose = true; // read by handlePipClose(): this close is not offered back
      try { pipWindow.close(); } catch { /* ignore */ }
    }
    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  function enterPipMonitoringMode() {
    if (!pipWindow) return;
    // The ring area depends on where the name and controls landed.
    requestAnimationFrame(() => pipCircle?.relayout());
    // A toast still showing moves below the profile name (placeToast()).
    if (toastEl?.classList.contains('pip-toast-visible')) requestAnimationFrame(placeToast);
    if (monitoringProfileNameEl) {
      monitoringProfileNameEl.textContent = profileMetaText(activeProfile);
    }
    // showOnlyScreen(), not a hardcoded "hide Ready, show Monitoring" pair —
    // a historical fix (see CLAUDE.md's Engineering Notes) that stays
    // correct here as more screens were added: it always hides every other
    // top-level screen, not just whichever one happened to be visible
    // before Start monitoring was clicked.
    showOnlyScreen(monitoringScreenEl);
  }

  /**
   * Starts monitoring in an already-open Companion window, using whichever
   * profile is currently active. Shared by the Companion's own Ready-screen
   * "Start Monitoring" button (subsequent same-day sessions) and
   * startMonitoring()'s first-open path (see below).
   * @returns {Promise<boolean>} whether monitoring actually started
   */
  /**
   * The ring's area and size (scaling rules, 2026-10-26). Everything keys
   * off the window's short side: Mini under 160, Compact 160 to 299,
   * Expanded 300 and up, with a gap of 8 / 12 / 16px. The ring area is the
   * full window width between the top row (the profile name, Compact or
   * Expand) and the bottom row (Stop); in Mini the name is hidden and the
   * area is the whole window. The ring's largest extent (full Outside,
   * band and glow included) is the area's smaller side minus twice the
   * gap, centered in the area, so the space above and below it is equal.
   * Positions the ring's container as a side effect.
   */
  // Icon-only controls get a short tooltip naming the action, after about
// 500ms of hover: beside the control (to the inside of its corner), in the
// control's own row, so it never sits over the ring. If even that would
// touch the ring (Compact and Mini, where the ring has the whole window:
// the ring there is a circle, its edge plus its widest band), it tries
// above or below the control instead, and otherwise stays hidden: the
// aria-label already names the control. Hidden on pointer leave and on
// press; never shown for keyboard focus. Expanded's Stop has a visible
// label, so it gets none.
const TOOLTIP_DELAY_MS = 500;
function setUpControlTooltips(screen) {
  const doc = screen.ownerDocument;
  const tip = doc.createElement('div');
  tip.className = 'pip-control-tooltip';
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  screen.appendChild(tip);
  let timer = null;
  const hide = () => { clearTimeout(timer); timer = null; tip.hidden = true; };
  const iconOnly = (btn) =>
    !(btn.classList.contains('pip-control-btn-stop') && screen.dataset.sizeBand === 'expanded');
  const show = (btn) => {
    tip.textContent = btn.getAttribute('aria-label');
    tip.hidden = false;
    const s = screen.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const w = tip.offsetWidth; const h = tip.offsetHeight;
    const bx = b.left - s.left; const by = b.top - s.top;
    const onLeft = bx + b.width / 2 < s.width / 2;
    const onTop = by + b.height / 2 < s.height / 2;
    const besideX = onLeft ? bx + b.width + 6 : bx - 6 - w;
    const alignX = onLeft ? bx : bx + b.width - w;
    const candidates = [
      { x: besideX, y: by + (b.height - h) / 2 },
      { x: alignX, y: onTop ? by + b.height + 6 : by - 6 - h },
    ];
    const layout = ringLayout();
    const inWindow = ({ x, y }) => x >= 0 && y >= 0 && x + w <= s.width && y + h <= s.height;
    let clearOfRing;
    if (layout.band === 'expanded') {
      const { extent, top, bottom } = layout;
      const ring = { left: (s.width - extent) / 2, top: (top + bottom - extent) / 2 };
      ring.right = ring.left + extent; ring.bottom = ring.top + extent;
      clearOfRing = ({ x, y }) => x + w <= ring.left || x >= ring.right || y + h <= ring.top || y >= ring.bottom;
    } else {
      const radius = bandExtent(ringEdge(), ringBand()) / 2;
      clearOfRing = ({ x, y }) => distanceToRect(layout.cx, layout.cy, { left: x, top: y, right: x + w, bottom: y + h }) >= radius;
    }
    const fits = (spot) => inWindow(spot) && clearOfRing(spot);
    const spot = candidates.find(fits);
    if (!spot) { tip.hidden = true; return; }
    tip.style.left = `${Math.round(spot.x)}px`;
    tip.style.top = `${Math.round(spot.y)}px`;
  };
  for (const btn of screen.querySelectorAll('.pip-control-btn')) {
    btn.addEventListener('pointerenter', () => {
      hide();
      if (!iconOnly(btn)) return;
      timer = setTimeout(() => show(btn), TOOLTIP_DELAY_MS);
    });
    btn.addEventListener('pointerleave', hide);
    btn.addEventListener('pointerdown', hide);
  }
}

// Mini (short side under 160) shows the ring only. The pointer entering
// the window, or keyboard focus on a control, fades Stop and Expand in;
// they hide again 2s after the pointer has left and focus has moved out.
// Harmless at the other sizes: the class only has an effect in Mini.
const MINI_HIDE_DELAY_MS = 2000;
function setUpMiniReveal(screen) {
  let hovered = false;
  let hideTimer = null;
  const show = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    screen.classList.add('pip-controls-revealed');
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (hovered || screen.contains(screen.ownerDocument.activeElement)) return;
      screen.classList.remove('pip-controls-revealed');
    }, MINI_HIDE_DELAY_MS);
  };
  screen.addEventListener('pointerenter', () => { hovered = true; show(); });
  screen.addEventListener('pointerleave', () => { hovered = false; scheduleHide(); });
  screen.addEventListener('focusin', show);
  screen.addEventListener('focusout', (e) => {
    if (!screen.contains(e.relatedTarget)) scheduleHide();
  });
}

// In the Compact size band the band's widest width is capped smaller (and
// its whole range with it, so it still grows with how far over), which
// lets the ring's edge grow: at 220×220 the cap of 0.1 of the edge gives a
// 90px edge with a band growing from about 3px just over to 9px, where
// Expanded's 0.18 would give 79px. (0.04 gave 100px, but its 4px band
// read as an outline: the nudge matters more than the resting size.)
const COMPACT_BAND_CAP = 0.1;
function ringBandScale() {
  return monitoringScreenEl?.dataset.sizeBand === 'compact'
    ? COMPACT_BAND_CAP / DEFAULT_RING_SETTINGS.band.maxFraction
    : 1;
}
function ringBand() {
  return scaledBand(DEFAULT_RING_SETTINGS.band, ringBandScale());
}

// The ring's edge.
// Expanded: the circle plus its widest band fills the ring area less the
// gap (the glow isn't counted, so it may reach into the gap and under the
// name), but the glow stays inside the window's width, where the window's
// side would otherwise cut it off visibly (382 wide).
// Compact and Mini (2026-11-11; toolbar pinned 2026-11-12): the ring is the
// largest thing in the window, sized by its far-over extent (the circle, the
// widest band and the glow's visible reach, ringExtent()): the largest
// circle in the window that keeps clear of the bottom-right toolbar
// (largestClearCircle()), so it's never clipped and never reaches the
// toolbar, at any window size; the edge is at most RING_MAX_FRACTION of the
// short side.
const RING_MAX_FRACTION = 0.8;
const RING_GLOW_MARGIN_PX = 2;
// Space kept between the ring's far-over glow and the Compact/Mini toolbar.
const TOOLBAR_GAP_PX = 4;
function ringEdge() {
  const layout = ringLayout(); // sets the size band first
  const band = ringBand();
  if (layout.band === 'expanded') {
    return Math.min(edgeForBandExtent(layout.extent, band), edgeForExtent(layout.width, band));
  }
  const radius = Math.max(0, layout.clearRadius - RING_GLOW_MARGIN_PX);
  const short = Math.min(layout.width, layout.height);
  return Math.min(edgeForExtent(2 * radius, band), RING_MAX_FRACTION * short);
}

/** Distance from a point to the nearest point of a rectangle (0 inside). */
function distanceToRect(x, y, r) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function ringLayout() {
    const width = pipWindow?.innerWidth || 0;
    const height = pipWindow?.innerHeight || 0;
    const short = Math.min(width, height);
    const band = short < 160 ? 'mini' : short < 300 ? 'compact' : 'expanded';
    const gap = band === 'mini' ? 8 : band === 'compact' ? 12 : 16;
    if (monitoringScreenEl) monitoringScreenEl.dataset.sizeBand = band;
    let top = 0;
    let bottom = height;
    // Compact and Mini: Stop and Expand share a toolbar pinned to the
    // bottom-right corner; the ring is the largest circle that fits in the
    // window and keeps clear of it (TOOLBAR_GAP_PX around its panel and
    // buttons), so its far-over glow never reaches the toolbar or the
    // window's edges (see ringEdge()).
    if (band !== 'expanded') {
      const toolbar = width > height ? 'side' : 'bottom';
      if (monitoringScreenEl) monitoringScreenEl.dataset.toolbar = toolbar;
      const pad = (r) => ({ left: r.left - TOOLBAR_GAP_PX, top: r.top - TOOLBAR_GAP_PX, right: r.right + TOOLBAR_GAP_PX, bottom: r.bottom + TOOLBAR_GAP_PX });
      const obstacles = [];
      for (const el of monitoringScreenEl?.querySelectorAll('.pip-monitoring-toolbar, .pip-control-btn') ?? []) {
        if (el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) obstacles.push(pad(r));
      }
      const { cx, cy, radius } = largestClearCircle(width, height, obstacles);
      if (pipCircleWrapperEl) {
        const box = Math.max(0, 2 * radius);
        pipCircleWrapperEl.style.left = `${cx - radius}px`;
        pipCircleWrapperEl.style.right = 'auto';
        pipCircleWrapperEl.style.width = `${box}px`;
        pipCircleWrapperEl.style.top = `${cy - radius}px`;
        pipCircleWrapperEl.style.height = `${box}px`;
      }
      return { band, gap, top: 0, bottom: height, cx, cy, width, height, toolbar, clearRadius: radius, extent: Math.max(0, 2 * radius - 2 * gap) };
    }
    if (monitoringScreenEl) delete monitoringScreenEl.dataset.toolbar;
    if (pipCircleWrapperEl) {
      pipCircleWrapperEl.style.left = '';
      pipCircleWrapperEl.style.right = '';
      pipCircleWrapperEl.style.width = '';
    }
    if (monitoringScreenEl) {
      const rows = [monitoringProfileNameEl, ...monitoringScreenEl.querySelectorAll('.pip-control-btn')];
      for (const el of rows) {
        if (!el || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        if (r.top + r.height / 2 < height / 2) top = Math.max(top, r.bottom);
        else bottom = Math.min(bottom, r.top);
      }
    }
    if (pipCircleWrapperEl) {
      pipCircleWrapperEl.style.top = `${top}px`;
      pipCircleWrapperEl.style.height = `${Math.max(0, bottom - top)}px`;
    }
    return { band, gap, top, bottom, width, height, extent: Math.max(0, Math.min(width, bottom - top) - 2 * gap) };
  }

  async function resumeMonitoringFromPipReady() {
    const profile = activeProfile;
    if (!profile) return false; // shouldn't happen — Ready mode always has an active profile

    const ok = await beginMonitoringSession(profile);
    if (!ok) return false; // stay in Ready mode; nothing else to clean up

    if (!pipCircle && pipCircleWrapperEl) {
      pipCircle = new MezzoRangeRing(pipCircleWrapperEl, {
        // Sized for its loudest state (the scaling rules, ringLayout()): at
        // full Outside, the circle plus its widest band fills the ring area
        // minus the gap, so the solid band never reaches the name or the
        // controls. The soft glow isn't counted: it may reach into the gap
        // and under the name, which draws above the ring.
        preferredEdgePx: ringEdge,
        // Room for the glow beyond that, so the ring keeps its widest band.
        viewportSize: () => {
          const room = ringExtent(ringEdge(), ringBand());
          return { width: room, height: room };
        },
        bandScale: ringBandScale,
        levelOffsetDb: (rms) => engine.getLevelOffsetDb(rms),
        // The room noise measured with this profile's calibration, relative
        // to its speaking level; the circle rests below it (plus a margin).
        roomNoiseOffsetDb: () => (Number.isFinite(activeProfile?.roomNoiseDb) ? activeProfile.roomNoiseDb - activeProfile.speakingDb : -Infinity),
      });
    }
    activeCircle = pipCircle;

    // Starting monitoring always begins Compact (2026-10-22: the small,
    // peripheral window is the default; Expand is one click away), whatever
    // the previous session in this Companion-open lifetime was left in.
    applyLayoutMode(LAYOUT_MODES.COMPACT);
    enterPipMonitoringMode();
    sessionState.set(SESSION_STATES.MONITORING_ACTIVE);
    return true;
  }

  // ===========================================================================
  // Ready screen — the approved selector model. Grouped Unsaved/Saved rows
  // in an overlay panel, contextual text-link actions, and Start monitoring,
  // all re-rendered on every show and every selection change.
  // ===========================================================================

  /** Hides every top-level screen except the given one, and tears down the
   *  Calibrating screen's live-meter subscription and countdown timer
   *  whenever navigating away from it — the one chokepoint every screen
   *  transition passes through, so that cleanup can't be missed by a
   *  handler that forgets to do it. */
  function showOnlyScreen(screenEl) {
    // Row-action tooltip (2026-08-20): every screen transition dismisses
    // it — the one chokepoint every transition already passes through, so
    // this covers every origin (Recalibrate, Delete, a naming/limit
    // decision resolving, Stop, and so on) without a per-caller hook.
    hideTooltip();
    [
      welcomeScreenEl, prepScreenEls[1], prepScreenEls[2], c0ScreenEl, readyScreenEl, calibratingScreenEl, creatingScreenEl,
      failedScreenEl, m1ScreenEl, resultScreenEl, m2ScreenEl, m3ScreenEl, deleteScreenEl, monitoringScreenEl,
    ].forEach((el) => {
      if (el) el.classList.toggle('hidden', el !== screenEl);
    });
    // The window's accessible name follows the screen: Welcome's heading is
    // only the wordmark, so the window says what it is.
    if (pipDocument) pipDocument.title = screenEl && screenEl === welcomeScreenEl ? 'Mezzo, welcome.' : 'Mezzo Companion';
    if (screenEl !== calibratingScreenEl) {
      if (unsubscribeCalibrationLevel) { unsubscribeCalibrationLevel(); unsubscribeCalibrationLevel = null; }
      stopMicCheck();
      levelMeter?.reset();
      stopCalibratingCountdown();
      stopPreparationCountdown();
      clearPreparingMessageTimers();
    }
    // The completion transition's own minimum-display timer must not fire
    // into a screen the user (or a native Companion close) has already
    // navigated away from — same "clear it at the one chokepoint every
    // transition passes through" convention as Calibrating's own timers
    // above, not scattered per-caller cleanup.
    if (screenEl !== creatingScreenEl && creatingTransitionTimer) {
      clearTimeout(creatingTransitionTimer);
      creatingTransitionTimer = null;
    }
    if (screenEl !== readyScreenEl) closeSelectorPanel();
    applyRecalibrationBar();
  }

  /** The "Recalibrating {name}" header bar: shown on the prep, listening
   *  and processing screens only while a saved profile is being
   *  recalibrated (the result screen, M1, has its own). First-time setup,
   *  Create new profile and recalibrating the Temporary profile are
   *  session-mode calibrations and get no bar. */
  function applyRecalibrationBar() {
    let name = null;
    if (calibrationIntent?.mode === 'recalibrate') {
      name = calibrationIntent.recalibratingName
        ?? getSavedProfiles().find((p) => p.id === calibrationIntent.targetProfileId)?.name
        ?? null;
    }
    for (const { screen, label } of recalibrationBars) {
      screen.classList.toggle('pip-has-recalibration-bar', name !== null);
      label.textContent = name !== null ? `Recalibrating ${name}` : '';
    }
  }

  /** Reached exactly once per Companion lifetime — the very first open with
   *  zero saved profiles (see enterPipReadyMode()). Maps to the Dock's
   *  "Ready" status, same as the real Ready screen — the Dock doesn't
   *  distinguish Welcome from Ready (see CLAUDE.md's Dock status mapping). */
  function showWelcomeScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(welcomeScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  /** "Create speaking profile": straight to Step 1's prep screen. The
   *  microphone isn't touched until its "I'm ready". */
  function handleWelcomeCalibrateClick() {
    startCalibrationIntro({ mode: 'session', targetProfileId: null, source: 'welcome', recalibratingName: null });
  }

  /** Every calibration starts here, at Step 1's prep screen: first-time
   *  setup (Welcome), Create new profile, and Recalibrate alike. */
  function startCalibrationIntro(intent) {
    if (!pipWindow) return;
    calibrationIntent = intent;
    roomStepDone = false;
    showPrepScreen(1);
  }

  /** A prep screen: the step, what to do and for how long, "I'm ready" and
   *  Cancel. Focus moves to its heading. Step 2's prep screen is shown while
   *  the controller holds the mic between the steps (or after a failed
   *  voice capture); nothing is measured on either. */
  function showPrepScreen(step) {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(prepScreenEls[step]);
    sessionState.set(step === 1 ? SESSION_STATES.COMPANION_READY : SESSION_STATES.COMPANION_CALIBRATING);
    prepHeadingEls[step]?.focus();
  }

  /** Step 1's "I'm ready": start the calibration (the room step). */
  function handleRoomStepReady() {
    const intent = calibrationIntent ?? { mode: 'session', targetProfileId: null, source: 'ready', recalibratingName: null };
    beginCalibrationFlow(intent.mode, intent.targetProfileId);
  }

  /** Step 2's "I'm ready": start the voice capture. Between the steps the
   *  controller is waiting for exactly this; after a failed voice capture
   *  it retries only the voice step, keeping Step 1's room reading. */
  function handleVoiceStepReady() {
    const state = calibrationController.getState();
    if (state.awaitingVoice) {
      prepareCalibratingScreen('voice');
      calibrationController.beginVoiceCapture();
      return;
    }
    if (state.status !== 'failed') { showPrepScreen(1); return; } // defensive: nothing to continue
    if (!calibrationLock.acquire()) {
      pendingLockedAttempt = { mode: state.mode, targetProfileId: state.targetProfileId };
      showFailedScreen({ code: 'CROSS_TAB_LOCKED' });
      return;
    }
    pendingLockedAttempt = null;
    prepareCalibratingScreen('voice');
    try {
      calibrationController.retryVoice();
    } catch (err) {
      console.error('[Session] Could not retry the voice step:', err.message);
      calibrationLock.release();
      handleCalibrationCancel();
    }
  }

  /** Cancel, from any step (and Back on the failure screens): stops any
   *  calibration, discards what it measured, and returns to where it
   *  started: Welcome for first-time setup, Ready otherwise. */
  function handleCalibrationCancel() {
    calibrationController.cancel();
    // The whole creation flow is abandoned (not superseded by a retry), so
    // the snapshot can't leak into a later, unrelated flow. A no-op for
    // recalibrate mode, which never sets it.
    priorProfileBeforeCreation = undefined;
    pendingLockedAttempt = null;
    roomStepDone = false;
    const source = calibrationIntent?.source;
    calibrationIntent = null;
    if (source === 'welcome' && getSavedProfiles().length === 0 && !unsavedProfile) {
      showWelcomeScreen();
    } else {
      showReadyScreen();
    }
  }

  /** Dedicated microphone-blocked/timed-out screen — reused Try Again/Back
   *  handlers are identical to the generic Failed screen's (see
   *  handleFailedTryAgain/handleFailedBack below); only the explanatory
   *  copy differs, so no separate C0 handlers exist. Heading/body are set
   *  here, per failure code (see C0_COPY), rather than fixed at DOM-build
   *  time — MIC_PERMISSION_DENIED and MIC_ACQUISITION_TIMEOUT render
   *  distinct copy on this one shared screen. Falls back to
   *  MIC_PERMISSION_DENIED's own copy for a failure with neither code (not
   *  expected — showFailedScreen() only ever routes these two codes here —
   *  but never leaves the screen blank if it happened). */
  function showC0Screen(failure) {
    activeCircle = null; // defensive, matching every other screen-show function — never actually non-null here, since C0 is only ever reached before monitoring starts
    const copy = C0_COPY[failure?.code] || C0_COPY.MIC_PERMISSION_DENIED;
    if (c0HeadingEl) c0HeadingEl.textContent = copy.heading;
    if (c0BodyEl) c0BodyEl.textContent = copy.body;
    showOnlyScreen(c0ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_NEEDS_ATTENTION);
  }

  /** Raw Ready renderer — always shows Ready, never auto-redirects, even if
   *  the saved-profile library happens to be empty (a normal, valid Ready
   *  presentation as long as an unsaved profile exists). Used by every path
   *  that must not risk re-triggering the Welcome redirect below —
   *  Cancel/Back from Calibrating, Calibration Failed, and every decision
   *  state, and Stop. See enterPipReadyMode() for the "smart" entry point. */
  function showReadyScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(readyScreenEl);
    renderReadyScreen();
    sessionState.set(SESSION_STATES.COMPANION_READY);
  }

  /** Smart Ready entry point — used by every real "we no longer have an
   *  active session, show the next screen" moment: startMonitoring()'s
   *  first (and every) open. Zero saved profiles AND no unsaved profile
   *  shows Welcome — a deliberate first moment, never an instant
   *  auto-calibrate redirect — per the product model: there is no built-in,
   *  uncalibrated default profile, so a user with nothing usable yet has
   *  exactly one path in, but they choose to take it. */
  function enterPipReadyMode() {
    if (!pipWindow) return;
    if (getSavedProfiles().length === 0 && !unsavedProfile) {
      showWelcomeScreen();
      return;
    }
    showReadyScreen();
  }

  /** Two saved-vs-temporary profiles are "the same" for selection/radio
   *  purposes only if both are temporary (there is only ever one unsaved
   *  profile slot at a time — see unsavedProfile's own doc comment) or both
   *  are the same saved id. Never compares by reference alone: activeProfile
   *  and a freshly-read getSavedProfiles() entry describing the same saved
   *  profile are different object instances. */
  function isSameProfile(a, b) {
    if (!a || !b) return a === b;
    if (isTemporaryProfile(a) || isTemporaryProfile(b)) return isTemporaryProfile(a) && isTemporaryProfile(b);
    return a.id === b.id;
  }

  /** Re-renders the heading, selector trigger, and contextual actions from
   *  current state — saved profiles can change between visits (one saved,
   *  deleted, or recalibrated elsewhere), so this always reads fresh rather
   *  than diffing. */
  function renderReadyScreen() {
    if (!readyScreenEl || !pipDocument) return;

    // First-conversation heading — a one-way, persisted flag; see
    // setHasStartedMonitoring()'s own call site (beginMonitoringSession())
    // for the only place it's ever set.
    if (readyHeadingEl) {
      // No terminal period (2026-08-16 heading-punctuation audit) — see
      // this file's own module-level note on Companion heading punctuation.
      // "Ready for your first conversation" only right after first setup
      // (nothing monitored yet, no saved profiles); otherwise "Ready when
      // you are".
      readyHeadingEl.textContent = readyHeadingCopy({
        hasStartedMonitoring: getHasStartedMonitoring(),
        savedProfileCount: getSavedProfiles().length,
      });
    }

    // Re-resolve the active selection fresh — a saved profile may have been
    // deleted elsewhere, or this may be the first render after a
    // calibration just produced a new unsaved profile.
    const saved = getSavedProfiles();
    const stillValid = (isTemporaryProfile(activeProfile) && unsavedProfile) || saved.some((p) => p.id === activeProfile?.id);
    if (!stillValid) {
      activeProfile = unsavedProfile ?? saved[0] ?? null;
    }

    renderSelectorTrigger();
    renderContextualActions();
    if (readyStartBtn) readyStartBtn.disabled = !activeProfile;
    renderStudyCard();
  }

  function renderSelectorTrigger() {
    if (!readySelectorTriggerNameEl) return;
    readySelectorTriggerNameEl.textContent = activeProfile
      ? (isTemporaryProfile(activeProfile) ? 'Temporary profile' : activeProfile.name)
      : 'Select a speaking profile';
  }

  /** Contextual actions directly beneath the selector — never the old
   *  always-visible pills; a sentence-case, underlined inline link (Batch 2)
   *  shown only for the unsaved profile (§5).
   *  Recalibrate retired from this row entirely (2026-08-17) — it now
   *  lives inside the selector panel itself, as a per-row icon action next
   *  to Delete/Discard (see buildSelectorRow()'s own doc comment and
   *  handleSelectorRowRecalibrateClick()).
   *  Create new profile retired from this row too (2026-08-18) — it's now
   *  a persistent footer action inside the selector panel itself (see
   *  renderSelectorPanel()), reachable regardless of which profile happens
   *  to be selected (including at the five-profile cap, where it used to
   *  be hidden here entirely), not a contextual link that only appeared
   *  for a saved-profile selection below the cap. A saved profile selected
   *  now shows nothing at all here — this row is unsaved-profile-only. A
   *  profile change re-renders this in place; the surrounding screen
   *  layout never restructures. */
  function renderContextualActions() {
    if (!readyContextualActionsEl || !pipDocument) return;
    readyContextualActionsEl.innerHTML = '';
    if (!activeProfile) return;
    if (isTemporaryProfile(activeProfile)) {
      readyContextualActionsEl.appendChild(buildActionLink('Save profile', handleSaveProfileClick));
    } else if (needsRecalibration(activeProfile)) {
      // Saved before the speech-band filter and calibration peaks: it still
      // works (with the older spread-based end of range); the note's own
      // Recalibrate link (or the selector panel's) updates it in place.
      const note = pipDocument.createElement('p');
      note.className = 'pip-ready-recalibrate-note';
      const [before, linkText, after] = RECALIBRATE_NOTE;
      const link = pipDocument.createElement('button');
      link.type = 'button';
      link.className = 'pip-inline-link';
      link.textContent = linkText;
      link.setAttribute('aria-label', `Recalibrate ${activeProfile.name}`);
      const profile = activeProfile;
      link.addEventListener('click', () => handleSelectorRowRecalibrateClick(profile));
      note.append(before, link, after);
      readyContextualActionsEl.appendChild(note);
    }
  }

  function buildActionLink(text, onClick) {
    const btn = pipDocument.createElement('button');
    btn.type = 'button';
    btn.className = 'pip-ready-contextual-link';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---------------------------------------------------------------------------
  // Selector — collapsed trigger + overlay panel (grouped Unsaved/Saved rows)
  // ---------------------------------------------------------------------------

  function handleSelectorTriggerClick() {
    if (selectorExpanded) closeSelectorPanel();
    else openSelectorPanel();
  }

  /** Positions and height-caps the expanded selector panel — called from
   *  openSelectorPanel() after the panel is rendered and unhidden, on
   *  every open. See SELECTOR_PANEL_SAFE_MARGIN_PX's own comment for why
   *  this replaced the old flat `top: calc(100% + 8px)` offset (reported:
   *  the panel could extend past the Companion's own visible bottom edge
   *  once enough rows existed).
   *
   *  Lantern menu layer, native-select style (PRD §7): the panel opens
   *  over its trigger, its top edge starting at the trigger's top, and
   *  shifts up only as far as it must to stay inside the usable Companion
   *  viewport (the real window height minus a safe margin on each side).
   *  If it is taller than that, it fills the usable height and its rows
   *  scroll internally. One behavior for every profile count, up to the
   *  full 1 Temporary + 5 saved + Create new profile, without ever
   *  resizing the Companion window itself — opening the panel still never
   *  calls resizeCompanionTo()/resizeCompanionToContent(), unchanged (see
   *  openSelectorPanel()'s own comment on that). Library order and the
   *  Unsaved/Saved grouping are unchanged; the selected row is marked by
   *  its sage dot.
   *
   *  Two inline styles only — `top` and `max-height` — both reset by
   *  closeSelectorPanel() so a later open never inherits a stale value
   *  computed for a different profile count or window size. max-height is
   *  cleared and re-measured (via scrollHeight) on every call, specifically
   *  so a later open with fewer rows — or a taller real window — isn't
   *  silently capped by a stale value left over from a larger one. */
  function positionSelectorPanel() {
    if (!readySelectorPanelEl || !pipWindow) return;
    const wrap = readySelectorPanelEl.parentElement;
    if (!wrap) return;

    const viewportHeight = pipWindow.innerHeight;
    const usableTop = SELECTOR_PANEL_SAFE_MARGIN_PX;
    const usableHeight = Math.max(0, viewportHeight - SELECTOR_PANEL_SAFE_MARGIN_PX * 2);

    readySelectorPanelEl.style.maxHeight = '';
    // scrollHeight excludes the panel's own border, but max-height applies
    // to its border box (box-sizing: border-box), so add the border back or
    // the rows lose 2px and scroll.
    const borderY = readySelectorPanelEl.offsetHeight - readySelectorPanelEl.clientHeight;
    const naturalHeight = readySelectorPanelEl.scrollHeight + borderY;

    const wrapTop = wrap.getBoundingClientRect().top;
    const triggerTop = (readySelectorTriggerEl || wrap).getBoundingClientRect().top;
    const panelHeight = Math.min(naturalHeight, usableHeight);
    const usableBottom = usableTop + usableHeight;
    const viewportTop = Math.max(usableTop, Math.min(triggerTop, usableBottom - panelHeight));
    readySelectorPanelEl.style.maxHeight = `${panelHeight}px`;
    readySelectorPanelEl.style.top = `${viewportTop - wrapTop}px`;
  }

  function openSelectorPanel() {
    if (!readySelectorPanelEl || !readySelectorTriggerEl || !pipDocument) return;
    renderSelectorPanel();
    readySelectorPanelEl.classList.remove('hidden');
    readyScrimEl?.classList.remove('hidden');
    positionSelectorPanel();
    readySelectorTriggerEl.setAttribute('aria-expanded', 'true');
    selectorExpanded = true;
    pipDocument.addEventListener('click', handleSelectorOutsideClick, true);
    pipDocument.addEventListener('keydown', handleSelectorKeydown, true);
    // Predictable focus movement on open (Batch 2): the checked radio if
    // one exists, else the first available radio — never left stranded on
    // the trigger once the panel it disclosed is actually visible.
    // requestAnimationFrame matches the same convention every decision
    // screen already uses (see showM1Screen() etc.) — one frame for the
    // browser to register the just-unhidden radio as focusable before
    // focusing it.
    //
    // Confirmed lifecycle race (2026-08-20 fix): this rAF callback used to
    // assign focus unconditionally, racing anything that focuses a row
    // action immediately after the panel becomes visible — a fast keyboard
    // user, or any caller — since a rAF scheduled here fires on the *next*
    // paint, strictly after the synchronous click handler that scheduled
    // it returns, but not necessarily after that caller's own next action.
    // When this rAF lost that race, it silently stole focus back to a
    // radio, firing blur on whatever had just been focused — which, for a
    // row-action icon, drove hideTooltip() via its own (otherwise entirely
    // correct) blur handler and hid a tooltip that had only just legitimately
    // appeared. Reproduced directly (instrumented focus/blur logging, no
    // artificial delay): 4 of 5 raw attempts. Guard: only move focus if it's
    // still where opening the panel left it (the trigger, or nothing inside
    // the panel yet) — if it has already moved to something inside the
    // panel by the time this fires, the original goal ("don't strand focus
    // on the trigger") is already satisfied, and overriding it is exactly
    // the race above.
    requestAnimationFrame(() => {
      const radios = readySelectorPanelEl?.querySelectorAll('input[type="radio"]');
      if (!radios || radios.length === 0) return;
      if (readySelectorPanelEl?.contains(pipDocument?.activeElement)) return;
      const checked = readySelectorPanelEl.querySelector('input[type="radio"]:checked');
      (checked || radios[0]).focus();
    });
  }

  function closeSelectorPanel() {
    selectorExpanded = false;
    readySelectorPanelEl?.classList.add('hidden');
    readyScrimEl?.classList.add('hidden');
    // Positioning (2026-08-20): clears the inline top/max-height
    // positionSelectorPanel() set on open — the collapsed selector reverts
    // to its plain, non-positioned CSS presentation rather than carrying a
    // stale computed value forward (which the next open would immediately
    // overwrite anyway, but leaving it in place between opens is exactly
    // the "stale positioning left behind" this reset avoids). No separate
    // scroll-position reset is needed: renderSelectorPanel() rebuilds
    // .pip-ready-selector-rows from scratch on every open (innerHTML='',
    // a fresh element each time), so stale scroll offset can't survive a
    // close/reopen cycle in the first place.
    if (readySelectorPanelEl) {
      readySelectorPanelEl.style.top = '';
      readySelectorPanelEl.style.maxHeight = '';
    }
    readySelectorTriggerEl?.setAttribute('aria-expanded', 'false');
    pipDocument?.removeEventListener('click', handleSelectorOutsideClick, true);
    pipDocument?.removeEventListener('keydown', handleSelectorKeydown, true);
    // Row-action tooltip (2026-08-20): the panel closing (Escape, an
    // outside click, or a row selection — every path already funnels
    // through this one function) always removes the row buttons it was
    // pointing at from view, so dismiss it here rather than leaving it to
    // whichever dismissal trigger happens to fire next.
    hideTooltip();
  }

  function handleSelectorOutsideClick(event) {
    if (!readySelectorPanelEl || !readySelectorTriggerEl) return;
    if (readySelectorPanelEl.contains(event.target) || readySelectorTriggerEl.contains(event.target)) return;
    closeSelectorPanel();
  }

  function handleSelectorKeydown(event) {
    if (event.key === 'Escape') {
      closeSelectorPanel();
      readySelectorTriggerEl?.focus();
    }
  }

  /** Rebuilds the panel's rows from current storage — Unsaved first (if one
   *  exists), a divider, then Saved profiles — grouped with programmatic
   *  labels for assistive tech (see the PRD's accessibility requirements),
   *  not just a visual heading. */
  function renderSelectorPanel() {
    if (!readySelectorPanelEl || !pipDocument) return;
    readySelectorPanelEl.innerHTML = '';
    // The <legend> must be re-added here, not just once at initial skeleton
    // build time: the innerHTML='' above clears it along with the old rows
    // on every re-render, and a <legend> only provides a <fieldset>'s
    // accessible name while it's actually present as its first child.
    const selectorLegend = pipDocument.createElement('legend');
    selectorLegend.className = 'pip-ready-selector-legend';
    selectorLegend.textContent = 'Speaking profiles';
    readySelectorPanelEl.appendChild(selectorLegend);

    // Rows region (2026-08-20) — a dedicated scrollable container for just
    // the Unsaved/Saved groups, separate from the panel element itself.
    // Create new profile (below) is a sibling of this div, not a child of
    // it, so it stays a stable, always-visible footer even when the rows
    // region itself needs to scroll — see positionSelectorPanel()'s own
    // comment for why the panel as a whole no longer scrolls its entire
    // content as one block the way it used to.
    const rowsContainer = pipDocument.createElement('div');
    rowsContainer.className = 'pip-ready-selector-rows';
    readySelectorPanelEl.appendChild(rowsContainer);

    const saved = getSavedProfiles();

    // Each section is its own role="group" + aria-labelledby, pointing at
    // the same visible "Unsaved"/"Saved profiles" <div> already used as the
    // on-screen heading — not a second, hidden label. This gives assistive
    // tech a programmatic association the plain sibling <div>s below never
    // had (found during the Batch 2 audit — see CLAUDE.md's Engineering
    // Notes). Deliberately role="group", not a second <fieldset>/radiogroup:
    // there is still exactly one native radio group (one shared `name`)
    // spanning both sections, so arrow keys/Tab move across the whole
    // Unsaved+Saved set as one native control — these wrapper divs only add
    // a label association, they never partition the radios themselves.
    if (unsavedProfile) {
      const unsavedGroup = pipDocument.createElement('div');
      unsavedGroup.setAttribute('role', 'group');
      unsavedGroup.setAttribute('aria-labelledby', 'pip-ready-selector-unsaved-label');

      const unsavedLabel = pipDocument.createElement('div');
      unsavedLabel.id = 'pip-ready-selector-unsaved-label';
      unsavedLabel.className = 'pip-ready-selector-group-label';
      unsavedLabel.textContent = 'Temporary';
      unsavedGroup.appendChild(unsavedLabel);

      unsavedGroup.appendChild(buildSelectorRow(unsavedProfile, {
        label: 'Temporary profile',
        recalibrateLabel: 'Recalibrate Temporary profile',
        onRecalibrate: () => handleSelectorRowRecalibrateClick(unsavedProfile),
        actionLabel: 'Discard temporary profile',
        onAction: () => handleDiscardUnsaved(),
      }));

      const note = pipDocument.createElement('div');
      note.className = 'pip-ready-selector-row-note';
      note.textContent = 'Disappears when you close Mezzo';
      unsavedGroup.appendChild(note);

      rowsContainer.appendChild(unsavedGroup);

      if (saved.length > 0) {
        const divider = pipDocument.createElement('div');
        divider.className = 'pip-ready-selector-divider';
        rowsContainer.appendChild(divider);
      }
    }

    if (saved.length > 0) {
      const savedGroup = pipDocument.createElement('div');
      savedGroup.setAttribute('role', 'group');
      savedGroup.setAttribute('aria-labelledby', 'pip-ready-selector-saved-label');

      const savedLabel = pipDocument.createElement('div');
      savedLabel.id = 'pip-ready-selector-saved-label';
      savedLabel.className = 'pip-ready-selector-group-label';
      savedLabel.textContent = 'Saved profiles';
      savedGroup.appendChild(savedLabel);

      saved.forEach((profile) => {
        savedGroup.appendChild(buildSelectorRow(profile, {
          label: profile.name,
          recalibrateLabel: `Recalibrate ${profile.name}`,
          onRecalibrate: () => handleSelectorRowRecalibrateClick(profile),
          actionLabel: `Delete ${profile.name} profile`,
          onAction: (triggerBtn) => openDeleteScreen(profile, triggerBtn),
        }));
      });

      rowsContainer.appendChild(savedGroup);
    }

    // Create new profile — persistent footer action (2026-08-18), moved
    // here from the old Ready-level contextual link (see
    // renderContextualActions()'s own updated doc comment). Always present
    // regardless of profile count, including at the five-profile cap —
    // never hidden or disabled there; activating it at the cap routes to
    // the existing M3 limit screen instead of beginning calibration (see
    // handleCreateNewProfileClick()). The panel is only ever opened once
    // at least one profile exists (Unsaved and/or Saved), so there is
    // always at least one row above this — the divider below reuses the
    // exact same treatment already used between the Unsaved/Saved groups,
    // not a second, bespoke separator rule, keeping this a visually
    // distinct footer without turning it into a large marketing-style
    // button of its own.
    const footerDivider = pipDocument.createElement('div');
    footerDivider.className = 'pip-ready-selector-divider';
    readySelectorPanelEl.appendChild(footerDivider);

    const createNewProfileBtn = pipDocument.createElement('button');
    createNewProfileBtn.type = 'button';
    createNewProfileBtn.className = 'pip-ready-selector-footer-action';
    createNewProfileBtn.textContent = 'Create new profile';
    createNewProfileBtn.addEventListener('click', handleCreateNewProfileClick);
    readySelectorPanelEl.appendChild(createNewProfileBtn);
  }

  /** Native radio (visually hidden — see .pip-ready-selector-row-radio's own
   *  CSS comment) + a visible label wrapping the name and a decorative
   *  checkmark, both driven straight off :checked in CSS — no second,
   *  JS-maintained "selected" flag. The recalibrate icon and the
   *  delete/discard button are both independent siblings of the
   *  radio+label, never descendants of either, so neither can ever
   *  accidentally check the radio, and the radio's own change handler
   *  never touches either of them.
   *
   *  Recalibrate icon (2026-08-17, new — see renderContextualActions()'s
   *  own doc comment for why the standalone Ready-screen Recalibrate link
   *  was retired in favor of this): placed immediately before the
   *  delete/discard button, sharing its exact .pip-ready-selector-row-action
   *  treatment (size, stroke weight/color, hover/focus behavior, target
   *  size) so the two read as one consistent pair of row-level icon
   *  actions. Both supported profile types get one — a saved profile via
   *  onRecalibrate targeting beginCalibrationFlow('recalibrate', profile.id)
   *  directly, the Temporary profile via the same handleUnsavedRecalibrateClick()
   *  the old standalone link already used for it (see
   *  handleSelectorRowRecalibrateClick()) — there is no profile type this
   *  selector ever lists that recalibration doesn't already support. */
  function buildSelectorRow(profile, { label, actionLabel, onAction, recalibrateLabel, onRecalibrate }) {
    const row = pipDocument.createElement('div');
    row.className = 'pip-ready-selector-row';

    const rowId = `ready-selector-${profile.id ?? 'unsaved'}`;

    const radio = pipDocument.createElement('input');
    radio.type = 'radio';
    radio.name = 'ready-selector-profile';
    radio.className = 'pip-ready-selector-row-radio';
    radio.id = rowId;
    radio.checked = isSameProfile(profile, activeProfile);
    radio.addEventListener('change', () => handleSelectorRowChange(profile));
    row.appendChild(radio);

    const rowLabel = pipDocument.createElement('label');
    rowLabel.className = 'pip-ready-selector-row-label';
    rowLabel.setAttribute('for', rowId);

    const rowName = pipDocument.createElement('span');
    rowName.className = 'pip-ready-selector-row-name';
    rowName.textContent = label;
    rowName.title = label;

    // Decorative only — aria-hidden, since the radio itself already
    // announces its own checked state to assistive tech; this glyph would
    // only double it. visibility (not opacity/color) is what actually
    // shows/hides it, via :checked in CSS — survives forced-colors mode.
    const rowCheck = pipDocument.createElement('span');
    rowCheck.className = 'pip-ready-selector-row-check';
    rowCheck.setAttribute('aria-hidden', 'true');
    rowCheck.classList.add('pip-dot'); // 8px sage dot (PRD §9a)
    // Before the name, like the trigger's own dot (PRD §9a). Hidden (not
    // removed) on unselected rows, so every name keeps the same indent.
    rowLabel.appendChild(rowCheck);
    rowLabel.appendChild(rowName);

    row.appendChild(rowLabel);

    // Custom tooltip wiring (2026-08-20), shared by both row-action icons
    // below — replaces the recalibrate icon's old native title attribute
    // outright (a native tooltip left in place alongside this one would
    // show twice, at two different delays — see .pip-tooltip's own CSS
    // comment) rather than adding a second tooltip mechanism next to it.
    // aria-describedby, not aria-labelledby: connects the visible tooltip
    // as an accessible DESCRIPTION without touching the button's own
    // aria-label, which stays the full "Recalibrate {name}"/"Delete
    // {name}" accessible name passed in above. Hover shows after
    // TOOLTIP_HOVER_DELAY_MS (cleared on mouseleave before it fires, so a
    // quick pass-over never shows it); keyboard focus shows it
    // immediately, matching how a sighted keyboard user expects to see
    // what a focused control does without waiting. hideTooltip() itself
    // guards against a stale target (see its own comment), so a leave/blur
    // firing for a row no longer current is always safe.
    function attachRowTooltip(btn, text) {
      // No aria-describedby set here — see showTooltipFor()/hideTooltip()'s
      // own comments. Setting it unconditionally at attach time would leave
      // every row-action button permanently referencing the shared
      // tooltip, active or not; the relationship must exist only while
      // this specific button's own tooltip is genuinely showing.
      btn.addEventListener('mouseenter', () => {
        if (tooltipShowTimer) clearTimeout(tooltipShowTimer);
        tooltipShowTimer = setTimeout(() => {
          tooltipShowTimer = null;
          showTooltipFor(btn, text);
        }, TOOLTIP_HOVER_DELAY_MS);
      });
      btn.addEventListener('mouseleave', () => {
        if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
        if (tooltipTargetEl === btn) hideTooltip();
      });
      btn.addEventListener('focus', () => {
        if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
        showTooltipFor(btn, text);
      });
      btn.addEventListener('blur', () => {
        if (tooltipTargetEl === btn) hideTooltip();
      });
    }

    const recalibrateBtn = pipDocument.createElement('button');
    recalibrateBtn.type = 'button';
    recalibrateBtn.className = 'pip-ready-selector-row-action';
    recalibrateBtn.setAttribute('aria-label', recalibrateLabel);
    recalibrateBtn.innerHTML = RECALIBRATE_ICON_SVG;
    attachRowTooltip(recalibrateBtn, 'Recalibrate');
    recalibrateBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      hideTooltip();
      onRecalibrate();
    });
    row.appendChild(recalibrateBtn);

    const actionBtn = pipDocument.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'pip-ready-selector-row-action';
    actionBtn.setAttribute('aria-label', actionLabel);
    actionBtn.innerHTML = TRASH_ICON_SVG;
    // The visible tooltip must describe the action that will actually
    // occur, same as the accessible name already does: Discard for the
    // Temporary row (its own aria-label already says "Discard temporary
    // profile", never a Delete confirmation screen — see onAction above),
    // Delete for every saved row.
    attachRowTooltip(actionBtn, isTemporaryProfile(profile) ? 'Discard' : 'Delete');
    actionBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      hideTooltip();
      onAction(actionBtn);
    });
    row.appendChild(actionBtn);

    return row;
  }

  /** Selecting a row updates selection, closes the selector, and updates
   *  contextual actions — it never starts monitoring and never deletes or
   *  discards anything else. Fires on the radio's native 'change' event,
   *  which — because arrow-key movement between radios in the same native
   *  group changes which one is checked immediately, not just on a
   *  separate confirm step — means an arrow press that lands on a
   *  different profile selects it and closes the panel right away. This is
   *  native <input type="radio"> behavior, not a bug: there is no
   *  "highlight several options while the panel stays open, then commit"
   *  step here, by design (see the accompanying test). Returns focus to
   *  the trigger afterward — the panel that just held it is now hidden,
   *  which would otherwise strand focus on <body>. */
  function handleSelectorRowChange(profile) {
    activeProfile = profile;
    if (!isTemporaryProfile(profile)) setSelectedProfile(profile);
    closeSelectorPanel();
    renderSelectorTrigger();
    renderContextualActions();
    if (readyStartBtn) readyStartBtn.disabled = !activeProfile;
    readySelectorTriggerEl?.focus();
  }

  // ---------------------------------------------------------------------------
  // Fallback selection — shared by Discard (§10) and Delete (§11)
  // ---------------------------------------------------------------------------

  /** "Most-recently-used" among `savedProfiles`: this tab's own last-used
   *  signal first (see src/profiles.js's getLastUsedProfile()), then this
   *  tab's own current selection if it's a saved profile still in the list,
   *  then simply the first remaining profile. */
  function pickFallbackSavedProfile(savedProfiles) {
    if (savedProfiles.length === 0) return null;
    const lastUsed = getLastUsedProfile();
    if (lastUsed && savedProfiles.some((p) => p.id === lastUsed.id)) return lastUsed;
    const selected = getSelectedProfile();
    if (selected && !isTemporaryProfile(selected) && savedProfiles.some((p) => p.id === selected.id)) return selected;
    return savedProfiles[0];
  }

  /** Delete's own fallback order (§11): unsaved profile first if one
   *  exists, then the most-recently-used remaining saved profile, then null
   *  (caller routes to Welcome). */
  function pickFallbackProfile(remainingSaved) {
    if (unsavedProfile) return unsavedProfile;
    return pickFallbackSavedProfile(remainingSaved);
  }

  /** Discard — no confirmation (§10). Drops the unsaved profile entirely;
   *  nothing was ever written to storage for it, so there is nothing to
   *  undo, only the in-memory reference to forget.
   *
   *  Only recomputes/replaces the active selection if the unsaved profile
   *  was itself the one selected — discarding it while a different, saved
   *  profile is active must leave that selection untouched (Batch 1:
   *  "Removing a nonselected unsaved profile"). isTemporaryProfile(activeProfile)
   *  is a reliable "was the unsaved profile the active one" check on its
   *  own: there is at most one unsaved profile at a time (see unsavedProfile's
   *  own doc comment), so being temporary and being *this* unsaved profile
   *  are the same thing here. */
  function handleDiscardUnsaved() {
    const wasSelected = isTemporaryProfile(activeProfile);
    unsavedProfile = null;
    closeSelectorPanel();

    if (!wasSelected) return; // a different, saved profile stays selected — nothing else to do

    const saved = getSavedProfiles();
    const fallback = pickFallbackSavedProfile(saved);
    activeProfile = fallback;
    if (fallback) {
      if (!isTemporaryProfile(fallback)) setSelectedProfile(fallback);
      showReadyScreen();
    } else {
      showWelcomeScreen();
    }
  }

  // ---------------------------------------------------------------------------
  // 06b — saved-profile delete confirmation (full-screen, never a modal)
  // ---------------------------------------------------------------------------

  function openDeleteScreen(profile, triggerBtn) {
    if (!pipWindow) return;
    pendingDeleteProfileId = profile.id;
    decisionTriggerEl = triggerBtn ?? null;
    if (deleteHeadingEl) deleteHeadingEl.textContent = `Delete “${profile.name}”?`;
    // Reset from any prior failed attempt — a fresh open should never carry
    // over a stale error message or a Cancel button a previous attempt left
    // disabled (see handleDeleteConfirm()'s failure branch below).
    if (deleteErrorEl) { deleteErrorEl.textContent = ''; deleteErrorEl.classList.add('hidden'); }
    if (deleteCancelBtn) deleteCancelBtn.disabled = false;
    closeSelectorPanel();
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(deleteScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => deleteCancelBtn?.focus());
  }

  function handleDeleteCancel() {
    pendingDeleteProfileId = null;
    showReadyScreen();
    restoreDecisionFocus();
  }

  /** Confirm — removes the profile via deleteSavedProfile() (src/profiles.js),
   *  which reports whether the write actually succeeded rather than assuming
   *  it did (the confirmed root cause of deletion being able to leave the
   *  screen stuck on "Deleting…" indefinitely — see CLAUDE.md's Batch 1
   *  notes). deleteCancelBtn is disabled for the same processing window
   *  deleteConfirmBtn already was, closing a race where clicking Cancel
   *  during that window used to navigate away immediately while the
   *  already-scheduled commit still ran underneath and deleted the profile
   *  anyway.
   *
   *  On success: repairs any stored reference that pointed at the deleted
   *  profile (this tab's selection, the cross-tab last-used profile — see
   *  CLAUDE.md's Profile Model: no stored reference should ever point at a
   *  missing profile), then falls back per §11 (unchanged — still
   *  most-recently-used, not visible-list order): the unsaved profile if one
   *  exists, else the most-recently-used remaining saved profile, else
   *  Welcome.
   *
   *  On failure — either the handled kind (deleteSavedProfile() reports
   *  removed:false) or an unexpected exception anywhere else in this
   *  commitFn (caught by runDecisionCommit()'s own generic catch, which
   *  calls the onError callback below): nothing above has happened — the
   *  profile list, the current selection, and every stored reference are
   *  untouched. Stays on this screen, restores both buttons (runDecisionCommit
   *  itself only ever knows about deleteConfirmBtn — deleteCancelBtn and the
   *  inline error are this screen's own responsibility, via showDeleteFailure()
   *  below, called from both failure paths so there's exactly one recovery
   *  routine, not two), and shows an inline error (the same .pip-decision-warning
   *  convention M2's own naming-collision warning already uses) rather than
   *  the generic "let commitFn silently not finish" behavior every failure
   *  used to fall into before this fix. */
  function handleDeleteConfirm() {
    if (!pendingDeleteProfileId) return;
    const deletedId = pendingDeleteProfileId;
    const deletedName = getSavedProfiles().find((p) => p.id === deletedId)?.name;
    if (deleteCancelBtn) deleteCancelBtn.disabled = true;

    // The one, complete recovery routine for both failure paths below —
    // deliberately restores deleteConfirmBtn itself too, not just Cancel and
    // the error copy: runDecisionCommit()'s own catch only ever fires for
    // the onError (unexpected-exception) path, never for the handled
    // removed:false path below, which returns normally rather than
    // throwing. Making this function fully self-sufficient means both
    // failure paths get identical recovery with no risk of drift between
    // them, rather than splitting the restoration across two places.
    const showDeleteFailure = (message) => {
      if (deleteConfirmBtn) { deleteConfirmBtn.disabled = false; deleteConfirmBtn.textContent = 'Delete'; }
      if (deleteCancelBtn) deleteCancelBtn.disabled = false;
      if (deleteErrorEl) {
        deleteErrorEl.textContent = message || "We couldn't delete this profile. Try again.";
        deleteErrorEl.classList.remove('hidden');
      }
    };

    runDecisionCommit(deleteConfirmBtn, 'Deleting…', () => {
      const { removed, remaining, error } = deleteSavedProfile(deletedId);

      if (!removed) {
        showDeleteFailure(error?.message);
        return;
      }

      if (getSelectedProfile()?.id === deletedId) setSelectedProfile(null);
      if (getLastUsedProfile()?.id === deletedId) clearLastUsedProfile();

      pendingDeleteProfileId = null;

      if (activeProfile?.id === deletedId) {
        activeProfile = pickFallbackProfile(remaining);
        // Persist the fallback as this tab's own selection — the same guard
        // handleDiscardUnsaved() already applies for its own fallback
        // (never persist a temporary profile as the selection; see
        // beginMonitoringSession()'s identical guard). Without this, a
        // reload right after deletion would re-resolve from whatever
        // mezzoSelectedProfile/mezzoLastUsedProfile already say — not
        // necessarily the fallback just landed on here — leaving the
        // in-memory and persisted selection out of sync until the user
        // picked something again.
        if (activeProfile && !isTemporaryProfile(activeProfile)) setSelectedProfile(activeProfile);
      }

      if (!activeProfile) {
        enterPipReadyMode(); // re-resolves fresh: Welcome if nothing usable is left
      } else {
        showReadyScreen();
      }
      // Only here, after the profile is really gone: never on a failure.
      if (deletedName) showToast(`Profile “${deletedName}” deleted`);
      restoreDecisionFocus();
    }, () => showDeleteFailure());
  }

  // ---------------------------------------------------------------------------
  // Contextual-action click handlers
  // ---------------------------------------------------------------------------

  /** Recalibrating the unsaved profile itself is just another session-mode
   *  calibration — handleCalibrationCompleted() below always replaces
   *  unsavedProfile wholesale on completion, satisfying "at most one unsaved
   *  profile at a time" without this needing to special-case anything. */
  function handleUnsavedRecalibrateClick() {
    startCalibrationIntro({ mode: 'session', targetProfileId: null, source: 'ready', recalibratingName: 'Temporary profile' });
  }

  /** Ready selector panel's own per-row Recalibrate icon (2026-08-17 —
   *  replaces the retired standalone Ready-screen Recalibrate link; see
   *  renderContextualActions()'s own doc comment). Takes the row's own
   *  profile explicitly rather than reading activeProfile, so it always
   *  targets the exact profile the icon was clicked on — not whichever
   *  profile happened to already be selected. Deliberately does NOT
   *  reassign activeProfile/selection before starting: beginCalibrationFlow()
   *  threads targetProfileId straight through to the calibration
   *  controller (see startRecalibration()/getTargetSnapshot() in
   *  calibration-controller.js), which is entirely independent of this
   *  module's own activeProfile — and both existing outcomes already
   *  handle the "was this the selected profile or a different one"
   *  question correctly on their own: handleM1Replace() explicitly
   *  re-selects whichever profile was just updated (regardless of prior
   *  selection), and handleM1Discard() simply returns to Ready with
   *  activeProfile exactly as it was before this call — the same
   *  behavior a saved profile's recalibration has always had. This is the
   *  smallest safe change that satisfies "target the profile in its own
   *  row," not a new selection-state rule.
   *  Both currently-recalibratable profile types are supported here, same
   *  as the retired standalone link: a saved profile via
   *  beginCalibrationFlow('recalibrate', profile.id) directly (this
   *  function's own former handleSavedRecalibrateClick() body, now reached
   *  this way instead), and the Temporary profile via the exact same
   *  handleUnsavedRecalibrateClick() the old link always called for it —
   *  no profile type this selector ever lists is left without a working
   *  icon. */
  function handleSelectorRowRecalibrateClick(profile) {
    closeSelectorPanel();
    if (isTemporaryProfile(profile)) {
      handleUnsavedRecalibrateClick();
    } else {
      if (!profile?.id) return; // defensive — should be unreachable, every saved profile has an id
      startCalibrationIntro({ mode: 'recalibrate', targetProfileId: profile.id, source: 'ready', recalibratingName: profile.name });
    }
  }

  /** Create new profile — Step 1's prep screen, same as Welcome's own
   *  first-time entry and Recalibrate (2026-10-26: the old intro screen,
   *  C1, is retired; each step's prep screen does its job).
   *
   *  At the five-profile cap (2026-08-18 — now reachable at the cap too,
   *  since this is a persistent selector-panel footer action rather than a
   *  contextual link the cap used to hide outright): routes to the
   *  existing M3 five-profile-limit screen instead, mirroring
   *  handleSaveProfileClick()'s own at-cap check exactly — no calibration
   *  ever begins, and no new profile-renaming capability is implied
   *  (M3 remains close-icon-only, unchanged). */
  function handleCreateNewProfileClick(event) {
    const atCap = getSavedProfiles().length >= MAX_SAVED_PROFILES;
    if (atCap) {
      showM3Screen(event?.currentTarget ?? null, 'create');
      return;
    }
    startCalibrationIntro({ mode: 'session', targetProfileId: null, source: 'ready', recalibratingName: null });
  }

  /** Save profile — below cap opens M2; at cap goes straight to M3, never
   *  opening M2 at all (§5/§9). Shared by Ready's own contextual "Save
   *  profile" link (returnTo defaults to 'ready', unchanged behavior) and
   *  Slice 2's "Speaking profile ready" result screen's own Save profile
   *  button (returnTo: 'result') — the exact same validation/limit/
   *  duplicate-name handling either way; only where M2's own Cancel
   *  returns to differs (see showM2Screen()/handleM2Cancel()). M3's own
   *  Close always returns to Ready regardless of origin — reaching the
   *  five-profile limit is a blocking notice, not "the save flow" itself,
   *  and Ready already reflects the calibration as the selected Unsaved
   *  profile either way, so nothing is lost by not threading returnTo
   *  through M3 too. */
  function handleSaveProfileClick(event, returnTo = 'ready') {
    if (!unsavedProfile) return;
    const atCap = getSavedProfiles().length >= MAX_SAVED_PROFILES;
    const triggerBtn = event?.currentTarget ?? null;
    if (atCap) showM3Screen(triggerBtn);
    else showM2Screen(triggerBtn, returnTo);
  }

  // ===========================================================================
  // Calibrating (C2) / Calibration Failed / C0 — driven by the shared
  // calibration controller (src/calibration-controller.js). This module owns
  // none of the calibration business logic or storage writes itself — it
  // only renders the controller's state and calls its methods.
  // ===========================================================================

  // Set only when the most recent Failed screen was shown because
  // calibrationLock.acquire() was rejected (another tab holds it), not
  // because the controller itself failed — see beginCalibrationFlow() and
  // handleFailedTryAgain() below. In that one case, no controller run ever
  // started (mode/targetProfileId were never handed to the controller), so
  // "Try Again" must re-attempt the lock via beginCalibrationFlow() itself
  // rather than calling calibrationController.retry(), which would throw
  // (there is nothing to retry — status is still 'idle').
  let pendingLockedAttempt = null;

  /**
   * Starts a calibration run (session or recalibrate) and shows the
   * Calibrating screen. Synchronous startXxx() misuse errors (an unknown
   * recalibration target, or calling this while already calibrating) are
   * caught here and fall back to Ready — actual calibration failures
   * (silence, unstable environment, mic permission) are not exceptions,
   * they arrive asynchronously via the controller's own state and are
   * handled by the subscribe() listener set up right after this module
   * creates calibrationController.
   */
  function beginCalibrationFlow(mode, targetProfileId) {
    if (!pipWindow) return;

    // Checked first, before any Calibrating-screen setup or mic/controller
    // involvement — a rejection here means a different tab genuinely holds
    // the cross-tab lease right now (see src/calibration-lock.js), so this
    // attempt goes straight to the Failed screen instead of ever flashing
    // Calibrating.
    if (!calibrationLock.acquire()) {
      pendingLockedAttempt = { mode, targetProfileId };
      showFailedScreen({ code: 'CROSS_TAB_LOCKED' });
      return;
    }
    pendingLockedAttempt = null;

    // Snapshot what was selected before this "new speaking profile" flow
    // began — Variant 1's own Discard restores it later (see
    // handleResultDiscard()). Captured only once per flow: a later "Speak
    // again" re-enters this same function with mode 'session' again, but
    // priorProfileBeforeCreation is no longer undefined by then, so it's
    // left alone — Discard must be able to undo the whole flow, not just
    // its most recent take. Recalibrate mode never touches this at all —
    // Variant 2's own Discard relies on activeProfile simply never being
    // reassigned during that flow instead (see handleM1Discard()).
    if (mode === 'session' && priorProfileBeforeCreation === undefined) {
      priorProfileBeforeCreation = activeProfile;
    }

    roomStepDone = false;
    prepareCalibratingScreen('room');

    try {
      if (mode === 'recalibrate') {
        calibrationController.startRecalibration(targetProfileId);
      } else {
        calibrationController.startSessionCalibration();
      }
    } catch (err) {
      console.error('[Session] Could not start calibration:', err.message);
      calibrationLock.release(); // acquired above, but the controller never actually started
      showReadyScreen();
    }
  }

  /**
   * Shows a listening screen, reset to its starting state: 'room' for Step
   * 1 (at the start of every calibration) and 'voice' for Step 2 (from
   * Step 2's "I'm ready"). Resets layout/size, the meter, every timer and
   * flag, and the countdown, then waits: the countdown starts only when
   * the real step does (the room step once the mic is acquired, see
   * handleAcquisitionConfirmed(); the voice step on the capturing:true
   * edge). If acquiring the mic takes a while, "Preparing microphone…"
   * shows in the countdown's place (delayed disclosure, below).
   */
  function prepareCalibratingScreen(phase) {
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE); // the listening screens share Ready's fixed size — see CLAUDE.md's Companion sizes
    activeCircle = null;

    stopMicCheck();
    levelMeter?.reset(); // nothing lit until the step starts
    setCalibratingPhase(phase);
    stopCalibratingCountdown();
    stopPreparationCountdown();
    clearPreparingMessageTimers();
    preparingHandled = false;
    calibrationCountdownStarted = false;
    if (calibratingStatusEl) calibratingStatusEl.textContent = '';
    if (calibratingAnnounceEl) calibratingAnnounceEl.textContent = '';
    showOnlyScreen(calibratingScreenEl);
    unsubscribeCalibrationLevel = calibrationController.subscribeToLevel(handleCalibrationLevelSample);
    sessionState.set(SESSION_STATES.COMPANION_CALIBRATING);

    // Delayed disclosure for "Preparing microphone…": shown only if
    // acquiring the mic is still pending after PREPARING_MESSAGE_DELAY_MS.
    // Cleared when the step starts (see handleAcquisitionConfirmed() and
    // the capturing:true edge).
    preparingMessageDelayTimer = setTimeout(() => {
      preparingMessageDelayTimer = null;
      preparingMessageShown = true;
      preparingMessageShownAt = Date.now();
      if (calibratingStatusEl) calibratingStatusEl.textContent = 'Preparing microphone…';
    }, PREPARING_MESSAGE_DELAY_MS);
  }

  /** Clears both "Preparing microphone…" timers and resets the
   *  shown/shown-at bookkeeping — called from prepareCalibratingScreen()
   *  (fresh attempt) and every calibration-teardown path (cancel, close,
   *  navigating away) so a stale delayed-disclosure or minimum-display
   *  timer from an abandoned attempt can never fire into a screen that's no
   *  longer showing Calibrating. */
  function clearPreparingMessageTimers() {
    if (preparingMessageDelayTimer) { clearTimeout(preparingMessageDelayTimer); preparingMessageDelayTimer = null; }
    if (preparingMessageMinDisplayTimer) { clearTimeout(preparingMessageMinDisplayTimer); preparingMessageMinDisplayTimer = null; }
    preparingMessageShown = false;
    preparingMessageShownAt = 0;
  }

  /** state.preparing's false→true edge: the mic is acquired and the
   *  controller is ready to run Step 1. Starts the room step at once, or,
   *  if "Preparing microphone…" is showing, once it has been readable for
   *  PREPARING_MESSAGE_MIN_DISPLAY_MS. preparingHandled keeps this to once
   *  per attempt (reset in prepareCalibratingScreen()). */
  calibrationController.subscribe((state) => {
    if (state.preparing && !preparingHandled) {
      preparingHandled = true;
      handleAcquisitionConfirmed();
    }
  });

  /** state.awaitingVoice's false→true edge: Step 1 has measured the room.
   *  The mic stays held (nothing measured) while Step 2's prep screen asks
   *  for the voice. */
  calibrationController.subscribe((state) => {
    if (state.awaitingVoice && calibratingScreenEl && !calibratingScreenEl.classList.contains('hidden')) {
      stopMicCheck();
      stopPreparationCountdown();
      roomStepDone = true;
      showPrepScreen(2);
    }
  });

  function handleAcquisitionConfirmed() {
    if (preparingMessageDelayTimer) {
      // Fast acquisition: "Preparing microphone…" never rendered.
      clearTimeout(preparingMessageDelayTimer);
      preparingMessageDelayTimer = null;
      beginRoomStep();
      return;
    }
    if (preparingMessageShown) {
      const remaining = PREPARING_MESSAGE_MIN_DISPLAY_MS - (Date.now() - preparingMessageShownAt);
      if (remaining > 0) {
        preparingMessageMinDisplayTimer = setTimeout(() => {
          preparingMessageMinDisplayTimer = null;
          beginRoomStep();
        }, remaining);
        return;
      }
    }
    beginRoomStep();
  }

  /** Step 1 starts: the one place calibrationController.beginCountdown()
   *  is called. The controller's 3s room window and this screen's visible
   *  3-2-1 begin in the same synchronous step, so they stay in lockstep;
   *  the live room level feeds both the meter and the room reading. */
  function beginRoomStep() {
    if (calibratingStatusEl) calibratingStatusEl.textContent = '';
    if (calibratingAnnounceEl) calibratingAnnounceEl.textContent = listeningAnnouncement('room', PREPARATION_COUNTDOWN_SECONDS);
    calibrationController.beginCountdown();
    startPreparationCountdown();
    levelMeter?.start();
    startMicCheck();
  }

  /** Step 1's live level: reads the already-acquired microphone's raw level
   *  directly (audio.calculateRms(), which touches neither audio.js's
   *  smoothing nor the voice samples) and hands it to the controller's room
   *  reading (recordRoomSample(), which counts it only during Step 1) and
   *  to the meter. Stopped when Step 1 ends or the screen is left. */
  function startMicCheck() {
    stopMicCheck();
    micCheckTimer = setInterval(() => {
      if (!audio.isMicrophoneActive) return;
      const rms = audio.calculateRms();
      calibrationController.recordRoomSample(rms);
      levelMeter?.setLevel(rms);
    }, MIC_CHECK_INTERVAL_MS);
  }

  function stopMicCheck() {
    if (micCheckTimer) { clearInterval(micCheckTimer); micCheckTimer = null; }
  }

  /** 'room' (Step 1) | 'voice' (Step 2): sets the eyebrow, the heading
   *  and the helper (LISTENING_COPY), and clears the countdown. CSS keys
   *  off data-phase. */
  function setCalibratingPhase(phase) {
    const copy = LISTENING_COPY[phase];
    if (calibratingScreenEl) calibratingScreenEl.dataset.phase = phase;
    if (calibratingSubheadingEl) calibratingSubheadingEl.textContent = copy?.eyebrow ?? '';
    if (calibratingHeadingEl) {
      calibratingHeadingEl.replaceChildren();
      (copy?.heading ?? []).forEach((line, i) => {
        if (i > 0) calibratingHeadingEl.appendChild(calibratingHeadingEl.ownerDocument.createElement('br'));
        calibratingHeadingEl.appendChild(calibratingHeadingEl.ownerDocument.createTextNode(line));
      });
    }
    if (calibratingHintEl) calibratingHintEl.textContent = copy?.helper ?? '';
    if (calibratingCountEl) calibratingCountEl.textContent = '';
  }

  /** Step 1's visible 3-2-1 (aria-hidden; the one-time announcement in
   *  beginRoomStep() is what assistive tech hears). The controller's own
   *  room-window timer is the real source of truth for when Step 1 ends;
   *  the number stays on 1 until it does. */
  function startPreparationCountdown() {
    stopPreparationCountdown();
    let remaining = PREPARATION_COUNTDOWN_SECONDS;
    if (calibratingCountEl) calibratingCountEl.textContent = String(remaining);
    preparationCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0 && calibratingCountEl) calibratingCountEl.textContent = String(remaining);
      if (remaining <= 1) stopPreparationCountdown();
    }, 1000);
  }

  function stopPreparationCountdown() {
    if (preparationCountdownTimer) { clearInterval(preparationCountdownTimer); preparationCountdownTimer = null; }
  }

  /** Step 2's visible 6-to-1 countdown (aria-hidden, like Step 1's). The
   *  controller's capture timer (calibration-controller.js's
   *  DEFAULT_CAPTURE_DURATION_MS) is the real source of truth for when
   *  capture ends; the number stays on 1 until it does. Started on the
   *  capturing:true edge, never before: acquiring the mic isn't counted. */
  function startCalibratingCountdown() {
    stopCalibratingCountdown();
    let remaining = CALIBRATION_COUNTDOWN_SECONDS;
    if (calibratingCountEl) calibratingCountEl.textContent = String(remaining);
    calibratingCountdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0 && calibratingCountEl) calibratingCountEl.textContent = String(remaining);
      if (remaining <= 1) stopCalibratingCountdown();
    }, 1000);
  }

  function stopCalibratingCountdown() {
    if (calibratingCountdownTimer) { clearInterval(calibratingCountdownTimer); calibratingCountdownTimer = null; }
  }

  /** Feeds the level meter during the voice capture with the raw,
   *  per-sample level (the controller's samples stay the EMA-smoothed
   *  values). During Step 1, startMicCheck() feeds it instead. */
  function handleCalibrationLevelSample(rms, rawRms) {
    levelMeter?.setLevel(rawRms ?? rms);
  }

  /** MIC_PERMISSION_DENIED and MIC_ACQUISITION_TIMEOUT both route to the
   *  dedicated C0 screen instead of the generic Failed screen (with
   *  distinct copy per code — see showC0Screen()/C0_COPY) — every other
   *  failure code renders on the generic screen. */
  function showFailedScreen(failure) {
    if (failure?.code === 'MIC_PERMISSION_DENIED' || failure?.code === 'MIC_ACQUISITION_TIMEOUT') {
      showC0Screen(failure);
      return;
    }
    if (failedMessageEl) failedMessageEl.textContent = calibrationFailureMessage(failure);
    showOnlyScreen(failedScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_NEEDS_ATTENTION);
  }

  /** Try again (the Failed screen and C0): back to the prep screen of the
   *  step that failed. A failed voice capture ("Didn't catch enough clear
   *  speech") returns to Step 2's prep screen, since Step 1's room reading
   *  is still valid; anything that failed before the room was measured
   *  (the mic, or another tab holding calibration) returns to Step 1's. */
  function handleFailedTryAgain() {
    if (roomStepDone && !pendingLockedAttempt) {
      showPrepScreen(2);
      return;
    }
    if (pendingLockedAttempt && !calibrationIntent) {
      calibrationIntent = { ...pendingLockedAttempt, source: 'ready', recalibratingName: null };
    }
    pendingLockedAttempt = null;
    roomStepDone = false;
    showPrepScreen(1);
  }

  /** Back (the Failed screen and C0): the same as Cancel. */
  function handleFailedBack() {
    handleCalibrationCancel();
  }

  // ===========================================================================
  // Calibration completion (Slice 2, revised). Real capture ending always
  // shows the brief "Creating your speaking profile…" transition first (see
  // showCreatingTransition()), then routes to whichever result screen fits:
  // session mode (a brand-new profile, or speaking again for the current
  // Temporary profile) shows "Your new speaking profile is ready" (Variant
  // 1, showResultScreen()); recalibrate mode shows the same heading/body
  // but with a name-specific primary button (Variant 2, showM1Screen()),
  // since it targets an existing saved profile the user must explicitly
  // choose to replace, keep separate, or discard. Recalibrate mode persists
  // nothing until M1's own commit handlers below. Session mode's commit
  // happens during the transition (see showCreatingTransition()) — it only
  // ever produces an in-memory, never-persisted Temporary profile, so it
  // isn't "persisting a new calibration" in the sense the state/routing
  // safeguards mean by that phrase (only Save speaking profile writes to
  // storage); it's what lets the result screen's own actions reuse Ready's
  // existing profile/session state exactly, rather than inventing a second,
  // uncommitted calibration-result model.
  // ===========================================================================

  function handleCalibrationCompleted(state) {
    showCreatingTransition(state);
  }

  /** "Creating your speaking profile…" — the brief completion transition
   *  (Slice 2 revision) between real capture ending and a result screen
   *  appearing. Does the actual, genuine work up front — committing a
   *  session-mode result to a Temporary profile (recalibrate mode has
   *  nothing to commit yet; M1 itself stays fully uncommitted, exactly as
   *  before) — then holds this screen for whatever's left of
   *  CREATING_TRANSITION_MIN_MS beyond however long that took, so a real
   *  (if today near-instant) processing step and a perceivable minimum
   *  display time are the same mechanism, not two competing ones. Never a
   *  full extra artificial second on top: `remaining` is computed from
   *  actual elapsed time.
   *
   *  Single-stage by design (2026-08-12 revision): earlier versions swapped
   *  the spinner for a checkmark partway through and announced "Speaking
   *  profile created." at that moment. Manual acceptance found the
   *  checkmark confusing — the result screen immediately behind it already
   *  communicates "ready," so a second "done" signal one beat earlier was
   *  redundant, not clarifying. This screen now stays a single processing
   *  state (spinner + "Creating your speaking profile…") from start to
   *  finish and hands off directly to the result screen with no
   *  intermediate completion state to announce or render. */
  function showCreatingTransition(state) {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    // Recalibrating a saved profile saves a calibration; everything else
    // creates a speaking profile. The profile's name is in the header bar.
    const savingCalibration = state?.mode === 'recalibrate';
    if (creatingTextEl) creatingTextEl.textContent = savingCalibration ? 'Saving your calibration…' : 'Creating your speaking profile…';
    showOnlyScreen(creatingScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    // Announced once, immediately, independent of the paint-confirmation
    // wait below: a screen-reader announcement isn't gated on visual paint
    // the way the spinner's own perceptibility is, and delaying it to
    // match the visual gate would only add latency an AT user gains
    // nothing from.
    if (creatingAnnounceEl) creatingAnnounceEl.textContent = savingCalibration ? 'Saving your calibration.' : 'Creating your speaking profile.';

    // Confirm the spinner has actually had a chance to paint before doing
    // anything else. Root-caused via manual real-Chrome acceptance testing
    // (2026-08-11): the original version of this function used the bare
    // global requestAnimationFrame for its own checkmark-swap step — which,
    // because Document Picture-in-Picture shares the opener tab's JS realm
    // (see CLAUDE.md's Engineering Notes — the same class of issue as the
    // earlier window.__lateStream finding), is the OPENER tab's rAF, tied
    // to the opener's own paint cycle, not the Companion's. Document PiP is
    // a genuinely separate always-on-top compositor surface; nothing
    // guarantees the opener's paint schedule correlates with it. This
    // Companion's OTHER real-time UI (Calibrating's countdown, the 3-2-1
    // preparation countdown) survived the same mistake elsewhere in this
    // file only because each ticks visibly many times over several real
    // seconds — one dropped/delayed frame among dozens is imperceptible.
    // This transition is architecturally different: a single one-shot
    // state change with exactly one visible window, so a single missed
    // paint opportunity can make the ENTIRE state invisible, which is what
    // real-Chrome manual testing found.
    //
    // pipWindow.requestAnimationFrame (double-rAF, the standard "confirm a
    // paint happened" technique) is the preferred signal — real desktop
    // Chrome should fire it within a frame or two. But gating the WHOLE
    // flow behind it turned out to trade one bug for a worse one: this
    // project's own Playwright/CDP sandbox measurably fires
    // pipWindow.requestAnimationFrame unreliably (confirmed while building
    // this fix's own regression test — sometimes several seconds late,
    // sometimes not at all before a test's own timeout), which would leave
    // a real user permanently stuck on this screen if the same ever
    // happened outside the sandbox. `proceed()` below is therefore raced
    // against a short, bounded safety-net timer — "fails open," matching
    // this codebase's own established philosophy elsewhere (e.g. the
    // cross-tab calibration lock's own fails-open default under a
    // localStorage failure) — so this flow always completes within a
    // bounded time regardless of whether the paint-confirmation signal
    // itself ever arrives.
    let paintConfirmed = false;
    const proceed = () => {
      if (paintConfirmed) return;
      paintConfirmed = true;
      if (!pipWindow) return; // closed during the wait — nothing left to transition
      const startedAt = Date.now();

      // The genuine work this screen represents — synchronous today, but
      // structured so a future genuinely-async version of this step would
      // still fit the same shape (do the work, THEN compute what's left of
      // the minimum display time from real elapsed time).
      let destination;
      if (state.mode === 'recalibrate') {
        destination = showM1Screen;
      } else {
        // commitStartMonitoring() only produces the temporary-profile
        // object and resets the controller to idle here — it does not
        // itself start monitoring (see its own doc comment in
        // calibration-controller.js); reused rather than duplicating that
        // object construction.
        const temp = calibrationController.commitStartMonitoring();
        unsavedProfile = temp;
        activeProfile = temp;
        destination = showResultScreen;
      }

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, CREATING_TRANSITION_MIN_MS - elapsed);
      creatingTransitionTimer = setTimeout(() => {
        creatingTransitionTimer = null;
        destination();
      }, remaining);
    };

    const pipRaf = typeof pipWindow.requestAnimationFrame === 'function'
      ? pipWindow.requestAnimationFrame.bind(pipWindow)
      : null;
    if (pipRaf) pipRaf(() => pipRaf(proceed));
    // Safety net — always armed, regardless of whether pipRaf exists or
    // ever fires. 100ms is generous for "two real frames" (normally
    // ~32ms at 60fps) while staying comfortably inside the overall ~700ms
    // budget, so it practically never wins the race in real desktop
    // Chrome — only when the preferred signal is slow or absent.
    setTimeout(proceed, 100);
  }

  /** "Your new speaking profile is ready" (Slice 2, Variant 1) — reached
   *  only from a session-mode calibration's completion (see
   *  showCreatingTransition() above). Static copy throughout — nothing to
   *  interpolate here (unlike M1). Focus moves to the heading, not a
   *  button — a deliberate departure from every other decision screen's
   *  own convention (see the DOM construction comment on
   *  m1Heading/resultHeading's shared tabIndex=-1 treatment) — reusing the
   *  same requestAnimationFrame-after-render mechanism every other
   *  showXScreen() already uses, just aimed at a different element, so a
   *  keyboard/screen-reader user hears what changed ("Your new speaking
   *  profile is ready") immediately rather than landing on an unlabeled
   *  button. */
  function showResultScreen() {
    if (!pipWindow) return;
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    resultTipEl?.classList.toggle('hidden', !isNoisyRoom(unsavedProfile?.speakingDb, unsavedProfile?.roomNoiseDb));
    showOnlyScreen(resultScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => resultHeadingEl?.focus());
  }

  /** Keep temporarily (Slice 2, Variant 1 — new in this revision). The
   *  Temporary profile is already exactly what showCreatingTransition()
   *  committed and selected — nothing further to write anywhere, so this
   *  is just "return to Ready with what's already selected," same as
   *  every other exit from this screen. Concludes the creation flow: the
   *  Discard-restoration snapshot is no longer needed once the user has
   *  explicitly chosen to keep this result (even temporarily).
   *
   *  Shows one "Available until you close the Companion" toast (2026-08-16)
   *  once Ready has rendered with the Temporary profile selected — accurate
   *  per handlePipClose()'s own unconditional `unsavedProfile = null` on
   *  every close path (native window-close and the Dock's programmatic
   *  pipWindow.close(), both funnel through the same pipWindow 'pagehide'
   *  listener — see that function's own doc comment). Deliberately scoped
   *  to this one call site: Cancel/Save/Replace/Discard all end this flow
   *  a different way and must not show this toast (see the shared toast's
   *  own single-message-at-a-time behavior in showToast()). */
  function handleResultKeepTemporarily() {
    priorProfileBeforeCreation = undefined;
    showReadyScreen();
    showToast('Available until you close the Companion');
    restoreDecisionFocus();
  }

  /** Discard (Slice 2, Variant 1 — new in this revision). Discards only
   *  the newly created Temporary profile, restoring whatever was selected
   *  before this creation flow began (see priorProfileBeforeCreation's own
   *  doc comment) — re-validated in case a saved profile it pointed to was
   *  deleted elsewhere during capture. Falls back to the application's
   *  existing default (most-recently-used saved profile, else Welcome —
   *  the same pickFallbackSavedProfile()/showWelcomeScreen() pair
   *  Discard-unsaved and Delete already use) when there's no valid prior
   *  selection to restore — a first-ever creation from Welcome, or a prior
   *  saved profile that's since been deleted.
   *
   *  Shows one "New profile discarded" toast (shortened 2026-08-15, was
   *  "New speaking profile discarded") regardless of which restoration
   *  path was taken — the toast confirms the discard action itself, not
   *  which screen it lands on.
   *  Deliberately scoped to this one call site only: cancelling calibration
   *  (handleCalibratingCancel) and closing the Companion (handlePipClose)
   *  both already reach a "nothing was ever created" or "abandoned mid-
   *  capture" state through different paths and must not show this toast,
   *  and Variant 2's own Discard (handleM1Discard) discards a new
   *  *calibration attempt* for an existing saved profile, not a "newly
   *  created speaking profile" — a different action this approval doesn't
   *  cover. */
  function handleResultDiscard() {
    const prior = priorProfileBeforeCreation;
    priorProfileBeforeCreation = undefined;
    unsavedProfile = null;

    let restored = null;
    if (prior && isTemporaryProfile(prior)) {
      // The flow started from speaking again for the Temporary profile
      // itself — that object was never destroyed (only ever replaced by a
      // later commit), so it's always still valid to restore as-is.
      unsavedProfile = prior;
      restored = prior;
    } else if (prior) {
      // Was a saved profile — re-validate it still exists.
      restored = getSavedProfiles().some((p) => p.id === prior.id) ? prior : null;
    }
    if (!restored) {
      restored = pickFallbackSavedProfile(getSavedProfiles());
    }

    activeProfile = restored;
    if (restored && !isTemporaryProfile(restored)) setSelectedProfile(restored);

    if (restored) {
      showReadyScreen();
    } else {
      showWelcomeScreen();
    }
    showToast('New profile discarded');
    restoreDecisionFocus();
  }

  // ===========================================================================
  // M1 (Slice 2, Variant 2) — reached only from a saved-profile
  // recalibration's completion.
  // ===========================================================================

  function showM1Screen() {
    if (!pipWindow) return;
    // M1 is never reached from a synchronous click on Ready — a real ~6s
    // calibration capture (plus the completion transition) sits in
    // between — so there is no real "the button that opened this" to
    // capture; decisionTriggerEl is left unset here, and
    // restoreDecisionFocus() below falls back to the selector trigger.
    const targetName = calibrationController.getTargetSnapshot()?.name;
    if (m1ReplaceBtn) m1ReplaceBtn.textContent = replaceButtonLabel(targetName);
    if (m1BodyEl) m1BodyEl.textContent = recalibrationQuestion(targetName);
    if (m1BarTitleEl) m1BarTitleEl.textContent = `Recalibrating ${targetName ?? ''}`.trim();
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    const result = calibrationController.getState().result;
    m1TipEl?.classList.toggle('hidden', !isNoisyRoom(result?.speakingDb, result?.roomNoiseDb));
    showOnlyScreen(m1ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    // Focus moves to the heading, not m1ReplaceBtn — see showResultScreen()'s
    // own comment on this deliberate, Slice-2-specific departure from every
    // OTHER decision screen's "focus the primary button" convention.
    requestAnimationFrame(() => m1HeadingEl?.focus());
  }

  /** Update "{name}" — writes the recalibration to the targeted saved
   *  profile, preserving its id/name/library position (the same
   *  updateSavedProfile() Recalibrate's own commit path always used). Falls
   *  back safely to Ready if the target was deleted elsewhere mid-
   *  calibration (commitError). */
  function handleM1Replace() {
    runDecisionCommit(m1ReplaceBtn, 'Updating…', () => {
      const updated = calibrationController.commitUpdateProfile();
      if (updated) {
        activeProfile = updated;
        setSelectedProfile(updated);
      }
      showReadyScreen();
      // The same wording as the naming screen's own Update.
      if (updated) showToast(`Profile “${updated.name}” updated`);
      restoreDecisionFocus();
    });
  }

  /** Keep temporarily — the saved profile this attempt targeted is left
   *  completely untouched; the new calibration becomes a fresh Temporary
   *  profile instead (see commitKeepAsUnsaved() in calibration-controller.js).
   *
   *  Shows the same one "Available until you close the Companion" toast as
   *  Variant 1's own Keep temporarily (handleResultKeepTemporarily) —
   *  identical claim, identical lifecycle guarantee, reached from the other
   *  result variant. See that function's own doc comment for the full
   *  reasoning. */
  function handleM1KeepAsUnsaved() {
    runDecisionCommit(m1KeepBtn, 'Keeping…', () => {
      const temp = calibrationController.commitKeepAsUnsaved();
      unsavedProfile = temp;
      activeProfile = temp;
      showReadyScreen();
      showToast('Available until you close the Companion');
      restoreDecisionFocus();
    });
  }

  /** Discard (Slice 2, Variant 2 — renamed from "Discard new calibration").
   *  Deliberately not labeled "Cancel": that wouldn't clearly describe what
   *  gets discarded (this new, uncommitted calibration result — not the
   *  saved profile, which was never touched to begin with). A plain
   *  cancel(), not a runDecisionCommit()-wrapped commit: nothing is written
   *  anywhere, so there's nothing to "process" — matches the same
   *  immediate, no-processing-state treatment every other escape-hatch
   *  text link in this Companion already uses (M2's own Cancel, M3's
   *  Close, Calibrating's own Cancel). activeProfile was never reassigned
   *  during a recalibration attempt (only a commit does that), so it's
   *  still the original saved profile — showReadyScreen() naturally shows
   *  it still selected, unchanged, with no extra bookkeeping needed here. */
  function handleM1Discard() {
    calibrationController.cancel();
    showReadyScreen();
    restoreDecisionFocus();
  }

  // ===========================================================================
  // M2/M2a — naming (or explicitly replacing) a new saved profile from the
  // current unsaved profile.
  // ===========================================================================

  function showM2Screen(triggerBtn, returnTo = 'ready') {
    if (!pipWindow || !unsavedProfile) return;
    decisionTriggerEl = triggerBtn ?? null;
    m2ReturnTo = returnTo;
    if (m2NameInput) m2NameInput.value = '';
    renderM2State();
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(m2ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => m2NameInput?.focus());
  }

  /** Renders purely from resolveSavePromptAction(name)'s current outcome —
   *  the one place M2/M2a's warning text and button label/enabled state are
   *  decided (see saveProfileNameCopy()). Called on every keystroke (live
   *  preview) and once when the screen first opens. */
  function renderM2State() {
    if (!m2NameInput) return;
    const resolution = resolveSavePromptAction(m2NameInput.value);
    const copy = saveProfileNameCopy(resolution);

    if (m2SubmitBtn) {
      m2SubmitBtn.disabled = copy.disabled;
      m2SubmitBtn.textContent = copy.buttonLabel;
    }
    if (m2WarningEl) {
      m2WarningEl.textContent = copy.warningText;
      m2WarningEl.classList.toggle('hidden', !copy.warningText);
    }
    m2NameInput.setAttribute('aria-describedby', copy.warningText ? 'm2-name-warning' : '');
  }

  /** Cancel — where it returns depends on where Save profile was opened
   *  from (see showM2Screen()'s own returnTo param and m2ReturnTo's doc
   *  comment): Ready's own "Save profile" contextual link (the default,
   *  unchanged behavior) returns to Ready; Slice 2's "Speaking profile
   *  ready" result screen's own Save profile button returns there instead
   *  — "cancelling the save flow returns to the result screen with the
   *  calibration still available" (it's still the selected Unsaved
   *  profile; nothing about it changes by opening and cancelling M2).
   *  showResultScreen() manages its own heading focus, the same way every
   *  other showXScreen() does — restoreDecisionFocus() is deliberately not
   *  called in that branch, since it would otherwise re-focus M2's own
   *  now-hidden trigger button instead. */
  function handleM2Cancel() {
    if (m2ReturnTo === 'result') {
      decisionTriggerEl = null;
      showResultScreen();
      return;
    }
    showReadyScreen();
    restoreDecisionFocus();
  }

  /** Commits the naming step — creates a new profile for a unique name, or
   *  explicitly replaces the matching existing profile's calibration for a
   *  name that already exists (see commitSavePromptName() in profiles.js,
   *  which re-resolves the outcome fresh rather than trusting whatever
   *  renderM2State() last rendered). decisionCommitInFlight guards against a
   *  double Enter/click re-entering this handler mid-processing. */
  function handleM2Submit(event) {
    event.preventDefault();
    if (decisionCommitInFlight) return;
    const name = m2NameInput?.value ?? '';
    if (!name.trim() || !unsavedProfile) return;

    const isUpdate = resolveSavePromptAction(name).kind === SAVE_PROMPT_ACTIONS.UPDATE;
    runDecisionCommit(m2SubmitBtn, isUpdate ? 'Updating…' : 'Saving…', () => {
      const { profile, error } = commitSavePromptName(unsavedProfile, name);

      if (!profile) {
        // Blocked (limit reached) or, vanishingly rarely, a same-instant
        // deletion race — either way, re-render the live state so the UI
        // self-corrects to match reality instead of silently doing nothing.
        renderM2State();
        if (m2WarningEl && error?.message) { m2WarningEl.textContent = error.message; m2WarningEl.classList.remove('hidden'); }
        return;
      }

      setSelectedProfile(profile);
      setLastUsedProfile(profile);
      activeProfile = profile;
      unsavedProfile = null;
      showReadyScreen();
      // "Speaking profile saved" (this revision) for the create path —
      // generic rather than name-interpolated, matching the terminology
      // section's "center on speaking profiles" principle; the replace
      // path (a name typed here happens to match an existing profile) is
      // untouched, unrelated to this revision's own explicitly-scoped
      // save-confirmation toast, and still reserved for the later
      // toast-feedback work otherwise.
      showToast(isUpdate ? `Profile “${profile.name}” updated` : 'Speaking profile saved');
      restoreDecisionFocus();
    });
  }

  // ===========================================================================
  // M3 — the five-profile limit.
  // ===========================================================================

  /** Shared by two entry points now (2026-08-18): Save profile at the cap
   *  (context 'save', the original/default — unchanged copy, unchanged
   *  every other call site) and the selector panel's own persistent
   *  Create new profile action at the cap (context 'create' — see
   *  handleCreateNewProfileClick()). Same screen, same close behavior,
   *  same "no calibration begins" guarantee either way — only the body
   *  copy differs, since "before saving this one" would be inaccurate from
   *  the create path (nothing has been calibrated/named yet to "save"). */
  function showM3Screen(triggerBtn, context = 'save') {
    if (!pipWindow) return;
    decisionTriggerEl = triggerBtn ?? null;
    if (m3BodyEl) {
      m3BodyEl.textContent = context === 'create'
        ? 'Delete a saved profile before creating another.'
        : 'Delete a saved profile before saving this one.';
    }
    layoutMode = LAYOUT_MODES.EXPANDED;
    if (pipDocument?.body) pipDocument.body.setAttribute('data-layout', LAYOUT_MODES.EXPANDED);
    resizeCompanionToContent(MEZZO_COMPANION_READY_SIZE);
    activeCircle = null;
    showOnlyScreen(m3ScreenEl);
    sessionState.set(SESSION_STATES.COMPANION_READY);
    requestAnimationFrame(() => m3CloseBtn?.focus());
  }

  function handleM3Close() {
    showReadyScreen();
    restoreDecisionFocus();
  }

  /** Manage profiles: Ready, with the selector open so a profile can be deleted. */
  function handleM3ManageProfiles() {
    showReadyScreen();
    openSelectorPanel();
  }

  // ===========================================================================
  // Shared decision-state processing/focus/toast helpers
  // ===========================================================================

  /** Brief processing state (§12) on a decision screen's affirmative
   *  button: disables it, swaps its label, then runs the actual commit
   *  after a short delay. decisionCommitInFlight is the shared reentrancy
   *  guard — only one decision screen is ever visible at a time, so one
   *  flag is enough. Deliberately does not restore the button's own label
   *  afterward — every commitFn either navigates away (making the old label
   *  moot) or, on a failure it wants to stay on-screen for, calls its own
   *  render function to set the correct label itself.
   *
   *  `onError` (optional) — this helper only knows about `button`, the one
   *  affirmative control it manages directly; it has no knowledge of a
   *  screen's OTHER controls (e.g. delete's own Cancel button) or its error
   *  copy. `onError` is the caller's hook to restore both when the generic
   *  catch below fires, without this shared helper needing screen-specific
   *  knowledge — see handleDeleteConfirm()'s own use of it. Only delete
   *  passes one today; every other decision screen is unaffected. */
  function runDecisionCommit(button, processingLabel, commitFn, onError) {
    if (decisionCommitInFlight) return;
    decisionCommitInFlight = true;
    const originalLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = processingLabel; }
    const restoreButton = () => {
      if (button) { button.disabled = false; button.textContent = originalLabel ?? processingLabel; }
    };
    setTimeout(() => {
      decisionCommitInFlight = false;
      // The Companion (and everything module-level state a commitFn reads —
      // unsavedProfile, activeProfile, every DOM ref) may have been closed
      // and torn down by handlePipClose() during this delay — this module
      // runs in the opener tab's own JS realm, so this pending timer is not
      // cancelled just because the PiP window closed. Bail out rather than
      // running a commitFn against already-nulled state (e.g.
      // commitSavePromptName() throwing on a null unsavedProfile) — there is
      // no Companion left to show the result in anyway.
      if (!pipWindow) return;
      // Restore the button BEFORE commitFn, not after (2026-10-20 fix):
      // every decision screen is built once per Companion open and reused,
      // so a button left disabled on its processing label after a
      // successful commit is what the NEXT visit to that screen opens
      // with (e.g. a second delete in the same Companion stuck on
      // "Deleting…" before it was ever clicked). Restoring first, rather
      // than in a finally, lets a commitFn's own handled-failure branch
      // still set the final state it wants: M2's blocked path re-renders
      // its button as disabled via renderM2State(), which a later restore
      // would wrongly undo.
      restoreButton();
      try {
        commitFn();
      } catch (err) {
        // Defense in depth, not the primary fix for any known failure mode —
        // every commitFn is expected to handle its own failure branch
        // explicitly (see handleDeleteConfirm()'s deleteSavedProfile()
        // branch, the confirmed root-cause fix for deletion getting stuck on
        // "Deleting…"). This exists so an unexpected exception here — not
        // just an already-handled one — still can't leave a decision
        // screen's button permanently disabled on its processing label with
        // no way to recover. A caught error here should be treated as a bug
        // to fix at its source, not relied on as the primary safeguard.
        console.error('[Decision] commitFn threw during processing:', err);
        restoreButton();
        onError?.();
      }
    }, DECISION_PROCESSING_MS);
  }

  /** Restores focus to whichever contextual-action/row button opened the
   *  decision state that just closed (§14's focus-restoration requirement) —
   *  a no-op if that element is no longer in the DOM (e.g. the row it
   *  belonged to was just rebuilt). */
  /**
   * The captured trigger isn't always still a valid focus target by the
   * time this runs: M2/M3 are opened from a contextual-action button that
   * renderContextualActions() unconditionally rebuilds (innerHTML = '') on
   * every showReadyScreen() — already called, just before this, by every
   * caller — so that exact DOM node no longer exists. 06b's trigger (a row
   * inside the selector panel) does still exist, but closeSelectorPanel()
   * left its whole panel display:none, so it's unfocusable even though it's
   * still attached. Falls back to the selector trigger — always present,
   * never rebuilt, and a logical landing spot regardless of which decision
   * state just closed — whenever the original isn't a real, visible target.
   */
  function restoreDecisionFocus() {
    const isFocusable = decisionTriggerEl?.isConnected && decisionTriggerEl.offsetParent !== null;
    const target = isFocusable ? decisionTriggerEl : readySelectorTriggerEl;
    target?.focus?.();
    decisionTriggerEl = null;
  }

  /** Shared toast mechanism (§12; also used by the discard confirmation) —
   *  never shifts layout (position:absolute, out of flow) and never steals
   *  focus (no focus() call here); a polite aria-live region announces it
   *  instead. One shared positioning rule for every message that uses this
   *  — see .pip-toast's own CSS comment for where and why. */
  function showToast(message) {
    if (!toastEl || !toastTextEl) return;
    toastTextEl.textContent = message;
    placeToast();
    toastEl.classList.add('pip-toast-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      toastEl?.classList.remove('pip-toast-visible');
      toastHideTimer = null;
    }, TOAST_VISIBLE_MS);
  }

  /** 12px below the top of the window. In Monitoring, if that would cover
   *  the profile name or a top-corner control (Compact, Expand), 8px below
   *  the lowest of them instead. */
  function placeToast() {
    if (!toastEl) return;
    let top = 12;
    const monitoringShown = monitoringScreenEl && !monitoringScreenEl.classList.contains('hidden');
    if (monitoringShown) {
      const toastHeight = toastCardEl?.offsetHeight || 32;
      const inTheWay = [monitoringProfileNameEl, ...monitoringScreenEl.querySelectorAll('.pip-control-btn')]
        .filter((el) => el && el.offsetParent !== null)
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.top < top + toastHeight);
      for (const r of inTheWay) top = Math.max(top, Math.round(r.bottom + 8));
    }
    toastEl.style.top = `${top}px`;
  }

  /** Positions the shared tooltip against a specific target button, using
   *  the Companion window's own real, live viewport (pipWindow.innerWidth/
   *  innerHeight, not an assumed 382×512 — correct at whatever size the
   *  window actually is). Prefers directly above the button (rows are
   *  short and the icon pair sits near the row's own right edge, so above
   *  is the common, uncluttered direction); flips to below only if there
   *  genuinely isn't room above, and clamps horizontally so the tooltip
   *  itself never extends past either viewport edge — both real
   *  possibilities for a button near the panel's own top edge or the
   *  window's left/right edges. Called only while the tooltip is already
   *  unhidden (see showTooltipFor()) — offsetWidth/offsetHeight read 0 on
   *  a display:none element, which would silently miscompute this. */
  function positionTooltip(targetEl) {
    if (!tooltipEl || !pipWindow) return;
    const margin = 6;
    const rect = targetEl.getBoundingClientRect();
    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;
    const viewportWidth = pipWindow.innerWidth;
    const viewportHeight = pipWindow.innerHeight;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - tooltipWidth - margin));

    let top = rect.top - tooltipHeight - margin;
    if (top < margin) top = Math.min(rect.bottom + margin, viewportHeight - tooltipHeight - margin);

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  /** Shows the shared tooltip for a specific button with specific text —
   *  see .pip-tooltip's own CSS comment and buildSelectorRow()'s own
   *  wiring for when this is actually called (hover, after
   *  TOOLTIP_HOVER_DELAY_MS; keyboard focus, immediately). Text is set
   *  before un-hiding so positionTooltip()'s own offsetWidth/offsetHeight
   *  read the size the tooltip will actually render at, not a stale one
   *  left over from whichever button last used it.
   *
   *  aria-describedby is attached HERE, to targetEl specifically — not at
   *  buildSelectorRow()'s attach-time — so only the button whose tooltip
   *  is genuinely showing right now ever references it; every other row
   *  action stays undescribed. The `tooltipTargetEl && !== targetEl` guard
   *  is defense-in-depth for switching directly between two triggers
   *  without an intervening hideTooltip() call (there normally is one —
   *  mouseleave/blur on the old trigger fires before mouseenter/focus on
   *  the new one — but this makes the invariant "at most one button is
   *  ever described by this element" hold unconditionally, not just on
   *  the common event ordering). */
  function showTooltipFor(targetEl, text) {
    if (!tooltipEl) return;
    if (tooltipTargetEl && tooltipTargetEl !== targetEl) {
      tooltipTargetEl.removeAttribute('aria-describedby');
    }
    tooltipTargetEl = targetEl;
    tooltipEl.textContent = text;
    tooltipEl.classList.remove('hidden');
    targetEl.setAttribute('aria-describedby', 'pip-row-tooltip');
    positionTooltip(targetEl);
  }

  /** Hides the shared tooltip unconditionally — safe to call whether or
   *  not it's currently showing, and whether or not a hover-delay timer is
   *  still pending (cleared here too, so a mouseleave shortly after
   *  mouseenter can't still show it moments later). Called from every
   *  dismissal trigger the spec requires: pointer leave/blur/Escape (see
   *  buildSelectorRow()'s own listeners and handleSelectorKeydown()),
   *  panel close (closeSelectorPanel(), which covers Escape, an outside
   *  click, and row selection all at once), row-action clicks themselves
   *  (before whatever they trigger next), and every screen transition
   *  (showOnlyScreen(), the one chokepoint every transition already
   *  passes through — see its own doc comment).
   *
   *  Removes aria-describedby from whichever button currently holds it
   *  (the only one that ever can, per showTooltipFor()'s own invariant)
   *  before forgetting it — leaving the relationship in place on a hidden
   *  tooltip would let its now-stale text keep surfacing as that button's
   *  accessible description even though nothing is visibly shown. */
  function hideTooltip() {
    if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
    if (tooltipTargetEl) tooltipTargetEl.removeAttribute('aria-describedby');
    tooltipTargetEl = null;
    tooltipEl?.classList.add('hidden');
  }

  function handlePipClose() {
    const wasActive = isMonitoringActive; // capture before teardownMonitoringEngine clears it
    const wasStarting = monitoringStarting; // Start monitoring pressed, mic not here yet
    const wasTemporary = isTemporaryProfile(activeProfile);
    const onPurpose = closingOnPurpose;
    closingOnPurpose = false;
    if (!onPurpose && !isPageUnloading) {
      reopenOffer = {
        profile: activeProfile,
        unsaved: unsavedProfile,
        resumeMonitoring: wasActive || wasStarting,
        // The call this close interrupted, so a resumed session continues it.
        studySession: wasActive && glowCounter.running ? { startedAt: glowCounter.startedAt, glows: glowCounter.glows, speechMs: glowCounter.speechMs } : null,
      };
    }

    // Covers every state the Companion could have been in when it closed —
    // idle/Ready (a harmless no-op), mid-Calibrating (stops capture,
    // releases the mic, discards whatever partial samples existed), or
    // Calibrated-but-uncommitted (discards the uncommitted result — nothing
    // was ever written to storage for it). close(), not cancel(): this is
    // specifically the native-window-close trigger, not a user clicking a
    // Cancel/Back button — same underlying cleanup, distinct call site for
    // what it's worth in logs.
    calibrationController.close();
    // Defensive symmetry with every other exit from the selector, even
    // though the PiP document (and its listeners) is about to be discarded
    // with the window regardless — see closeSelectorPanel()'s own
    // unconditional removeEventListener calls, safe as a no-op either way.
    closeSelectorPanel();

    if (pipCircle) {
      pipCircle.destroy();
      pipCircle = null;
    }
    zoneAnnouncer.reset();
    pipWindow = null;
    pipDocument = null;
    welcomeScreenEl = null;
    prepScreenEls = { 1: null, 2: null };
    recalibrationBars = [];
    m1BarTitleEl = null;
    prepHeadingEls = { 1: null, 2: null };
    calibrationIntent = null;
    roomStepDone = false;
    c0ScreenEl = null;
    c0HeadingEl = null;
    c0BodyEl = null;
    readyScreenEl = null;
    readyHeadingEl = null;
    readySelectorTriggerEl = null;
    readySelectorTriggerNameEl = null;
    readySelectorPanelEl = null;
    readyScrimEl = null;
    readyContextualActionsEl = null;
    readyStartBtn = null;
    readyDisclaimerEl = null;
    clearStudyCardTimer();
    studyCardEl = null;
    studyCardOpenEl = null;
    studyCardSession = null;
    selectorExpanded = false;
    m1ScreenEl = null;
    m1HeadingEl = null;
    m1BodyEl = null;
    m1ReplaceBtn = null;
    m1KeepBtn = null;
    m1DiscardBtn = null;
    resultScreenEl = null;
    resultTipEl = null;
    m1TipEl = null;
    resultHeadingEl = null;
    resultSaveBtn = null;
    resultKeepBtn = null;
    resultDiscardBtn = null;
    if (creatingTransitionTimer) { clearTimeout(creatingTransitionTimer); creatingTransitionTimer = null; }
    creatingScreenEl = null;
    creatingAnnounceEl = null;
    // In-memory only, same reasoning as unsavedProfile's own doc comment —
    // a native Companion close is exactly the boundary a pending creation
    // flow's own restoration snapshot must not survive either.
    priorProfileBeforeCreation = undefined;
    m2ScreenEl = null;
    m2WarningEl = null;
    m2NameInput = null;
    m2SubmitBtn = null;
    m2ReturnTo = 'ready';
    m3ScreenEl = null;
    m3BodyEl = null;
    m3CloseBtn = null;
    deleteScreenEl = null;
    deleteHeadingEl = null;
    deleteConfirmBtn = null;
    deleteCancelBtn = null;
    deleteErrorEl = null;
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
    toastEl = null;
    toastCardEl = null;
    toastTextEl = null;
    if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
    tooltipEl = null;
    tooltipTargetEl = null;
    pendingDeleteProfileId = null;
    monitoringScreenEl = null;
    pipZoneLiveEl = null;
    monitoringProfileNameEl = null;
    pipCircleWrapperEl = null;
    calibratingScreenEl = null;
    calibratingSubheadingEl = null;
    calibratingStatusEl = null;
    calibratingAnnounceEl = null;
    stopMicCheck();
    levelMeter?.destroy();
    levelMeter = null;
    calibratingHintEl = null;
    calibratingHeadingEl = null;
    calibratingCountEl = null;
    creatingTextEl = null;
    stopCalibratingCountdown();
    stopPreparationCountdown();
    clearPreparingMessageTimers();
    preparingHandled = false;
    calibrationCountdownStarted = false;
    failedScreenEl = null;
    failedMessageEl = null;
    pendingLockedAttempt = null;
    decisionTriggerEl = null;
    decisionCommitInFlight = false;
    // In-memory only, by design (see unsavedProfile's own doc comment) — a
    // native Companion close is exactly the boundary it must not survive.
    unsavedProfile = null;
    if (unsubscribeCalibrationLevel) { unsubscribeCalibrationLevel(); unsubscribeCalibrationLevel = null; }
    layoutMode = LAYOUT_MODES.EXPANDED; // a fresh open always starts Expanded

    // A temporary profile was never written anywhere — closing natively
    // while monitoring with one (or holding one uncommitted) simply means
    // there is nothing left to discard beyond this in-memory reference.
    if (wasTemporary) activeProfile = null;

    if (isPageUnloading) return; // this page's own pagehide is already tearing everything down

    // This fires for every way the Companion actually goes away — the
    // native ✕ (the only way to close it directly, in any state) and
    // endSession()'s programmatic pipWindow.close() — since Document PiP's
    // own pagehide is what's wired to this handler, not either call site
    // individually. By the time this runs after endSession(), monitoring
    // has already been torn down there and sessionState has already been
    // eagerly set to COMPANION_CLOSED, so wasActive is already false and
    // the sessionState.set() below is a harmless no-op for that path
    // (createSessionState() guards against re-firing on an unchanged
    // value). What matters is the native-✕ case: monitoring can never
    // continue without the Companion open, so if it was still active
    // reaching here, tear it down now — not "silently keep running" — and
    // reflect the closed Companion (not a full endSession) in session
    // state, so Mezzo (index.html) returns to Home instead of a full
    // endSession() teardown — see src/home-dock.js's handleSessionStateChange().
    if (wasActive) {
      teardownMonitoringEngine();
      activeCircle = null;
    } else if (wasStarting) {
      // Mezzo never listens while the Companion is closed. Start monitoring
      // (or Reopen resuming it) is still waiting for the mic: release()
      // makes that request stop its stream when it arrives (audio.js's
      // _acquire()). Only then: Close Companion has already sent the page
      // Home, whose own permission check may be acquiring right now, and
      // calibration releases its own mic in calibrationController.close().
      audio.release();
    }

    sessionState.set(SESSION_STATES.COMPANION_CLOSED);
  }

  // =============================================================================
  // Public interface
  // =============================================================================

  function init() {
    // This page is the runtime owner of the session — closing it stops
    // monitoring and the Companion (see the pagehide handler below).
    // beforeunload asks for confirmation only: Chrome hasn't allowed custom
    // dialog text/buttons since Chrome 51, so the closest supported
    // approximation of "Close Mezzo? ... [Cancel] [Close and Stop]" is the
    // browser's own generic "Leave site?" prompt. Actual teardown must NOT
    // happen here (the user might cancel) — it's deferred to pagehide.
    window.addEventListener('beforeunload', (event) => {
      if (!isMonitoringActive) return;
      event.preventDefault();
      event.returnValue = '';
    });

    window.addEventListener('pagehide', () => {
      isPageUnloading = true;
      finishStudySession(); // keeps the session for the next open's check-in card
      clearSustained();
      calibrationController.cancel(); // safe from any status — covers the page closing mid-calibration
      if (pipWindow) {
        try { pipWindow.close(); } catch { /* ignore */ }
      }
      engine.stopMonitoring();
      audio.release();
    });
  }

  sessionState.subscribe((state) => onSessionStateChange?.(state));

  return {
    SESSION_STATES,
    getSessionState: sessionState.get,
    subscribe: sessionState.subscribe,
    isPipSupported: () => pipSupported,

    init,
    requestMicrophoneAccess,
    startMonitoring,
    stopMonitoring,
    endSession,
    hasReopenOffer,
    reopenCompanion,
    dismissReopenOffer,
    endInterruptedSession,
    isResumingCall,
  };
}
