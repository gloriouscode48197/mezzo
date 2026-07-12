/**
 * Mezzo — TEMPORARY Timing Instrumentation
 *
 * Built to answer one question: does Chrome's background-tab timer
 * throttling degrade Mezzo's actual monitoring loop when the tab is
 * hidden (e.g. Zoom/Meet/Teams focused instead) for an extended period?
 * See docs/monitoring-runtime-investigation.md for the full writeup this
 * feeds into.
 *
 * DELETE THIS FILE (and its three call sites in audio.js, monitoring.js)
 * once the investigation concludes — it is not meant to ship. Everything
 * here is additive logging; it does not change any real behavior.
 *
 * Opt-in only (?timing=true) so it doesn't affect normal use or any other
 * testing. Usage:
 *   http://localhost:8899/monitoring.html?timing=true
 * Then, after a real session (visibility changes and all), open DevTools
 * and run:
 *   copy(JSON.stringify(window.__mezzoTiming.export()))
 * to get the full raw dataset on your clipboard for analysis.
 */

const ENABLED = new URLSearchParams(window.location.search).get('timing') === 'true';

// Gaps larger than this are flagged as "throttled" in the summary — well
// above the expected ~50ms sample interval, but well below where a human
// would need to see it printed individually.
const THROTTLE_FLAG_MS = 200;
const SUMMARY_INTERVAL_MS = 30000;

function makeTrack(label) {
  const samples = []; // { t: performance.now(), gap: ms since previous, hidden: document.hidden }
  let lastT = null;

  function mark() {
    if (!ENABLED) return;
    const t = performance.now();
    const gap = lastT === null ? null : t - lastT;
    lastT = t;
    samples.push({ t, gap, hidden: document.hidden });
  }

  function summarize(windowMs = SUMMARY_INTERVAL_MS) {
    const cutoff = performance.now() - windowMs;
    const recent = samples.filter(s => s.t >= cutoff && s.gap !== null);
    if (recent.length === 0) return null;
    const gaps = recent.map(s => s.gap);
    const throttledCount = gaps.filter(g => g > THROTTLE_FLAG_MS).length;
    return {
      label,
      count: recent.length,
      avgGapMs: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
      maxGapMs: Math.round(Math.max(...gaps)),
      minGapMs: Math.round(Math.min(...gaps)),
      throttledCount,
      hiddenNow: document.hidden,
    };
  }

  return { mark, summarize, samples };
}

const sampleTrack = makeTrack('audio-sample');
const classifyTrack = makeTrack('classification');
const pipUpdateTrack = makeTrack('pip-update');

export function markSample() {
  sampleTrack.mark();
}

export function markClassification() {
  classifyTrack.mark();
}

/**
 * Call right after pushing a state update into the PiP DOM. Measures the
 * gap between consecutive updates (same as the other tracks) AND, if a PiP
 * window is open, schedules a callback via THAT window's own
 * requestAnimationFrame — since the PiP window itself is not throttled the
 * way its opener is, comparing "when did the opener call this" against
 * "when did the PiP window's own rAF next fire" isolates how much delay is
 * specifically coming from the throttled opener feeding stale/infrequent
 * data, versus the PiP window's own rendering.
 */
export function markPipUpdate(pipWindow) {
  if (!ENABLED) return;
  pipUpdateTrack.mark();
  if (pipWindow && !pipWindow.closed) {
    const calledAt = performance.now();
    pipWindow.requestAnimationFrame(() => {
      const rafLatency = performance.now() - calledAt;
      if (rafLatency > 50) {
        console.log(`[TIMING] pip-rAF-latency: ${Math.round(rafLatency)}ms (opener->PiP paint gap)`);
      }
    });
  }
}

if (ENABLED) {
  console.log('[TIMING] Instrumentation enabled (?timing=true) — temporary, see src/_timing-debug.js');

  window.__mezzoTiming = {
    export() {
      return {
        capturedAt: new Date().toISOString(),
        audioSample: sampleTrack.samples,
        classification: classifyTrack.samples,
        pipUpdate: pipUpdateTrack.samples,
      };
    },
    summary() {
      return {
        audioSample: sampleTrack.summarize(),
        classification: classifyTrack.summarize(),
        pipUpdate: pipUpdateTrack.summarize(),
      };
    },
  };

  setInterval(() => {
    const s = window.__mezzoTiming.summary();
    console.log('[TIMING] 30s summary — document.hidden=%s', document.hidden, s);
  }, SUMMARY_INTERVAL_MS);
}
