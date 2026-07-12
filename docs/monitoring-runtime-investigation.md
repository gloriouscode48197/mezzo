# Background-Tab Reliability Investigation: Monitoring Runtime

**Status:** Investigation in progress — instrumentation and prototype built and verified
functionally; real-world background-tab measurement still needed (see Part 1).
**Owner:** Engineering
**Related:** PRD-004 (PiP-First Monitoring Flow)

---

## Why this exists

Reliable background monitoring is a core product requirement — PiP is the primary interface,
which means the Mezzo tab is expected to sit backgrounded (Zoom/Meet/Teams focused instead) for
the length of a meeting. Chrome throttles JavaScript timers in hidden tabs, and Mezzo's actual
audio sampling and volume-zone classification currently run via `setInterval` on the **opener**
tab's main thread — not inside the PiP window itself. If that gets throttled, the PiP window
could sit on screen looking fine while the data feeding it goes stale or arrives once a minute.

This is directly acknowledged in the [Document Picture-in-Picture spec](https://wicg.github.io/document-picture-in-picture/) itself, which
warns about exactly this and recommends running application logic inside the PiP window rather
than the opener — the opposite of Mezzo's current architecture.

**Scope note:** `CLAUDE.md` says the sound-detection algorithm is "already built, do not rewrite
it." This investigation is a deliberate, explicit exception to that instruction, requested
because background reliability is a core requirement PiP-first depends on — not an unrequested
change to settled code.

---

## Part 1 — Real-World Measurement

### What's been built

Temporary, opt-in instrumentation (delete once this investigation concludes):

- **`src/_timing-debug.js`** — tracks three things, all gated behind `?timing=true` so it has
  zero effect on normal use or any other testing:
  - **Audio sample cadence** — gap between consecutive `audio.js` `processAudioFrame()` calls
    (marked via `markSample()`).
  - **Classification cadence** — gap between consecutive `engine.processFrame()` calls in
    `monitoring.js`'s `onAudioFrame()` (marked via `markClassification()`).
  - **PiP update latency** — gap between consecutive `activeCircle.update()` calls, *plus* (when
    PiP is open) the delay between the opener calling `update()` and the PiP window's own next
    `requestAnimationFrame` tick — isolating how much delay is specifically coming from the
    (possibly throttled) opener versus the PiP window's own rendering, which per the spec is not
    itself throttled.
  - Prints a summary every 30s (`document.hidden` state included), and exposes
    `window.__mezzoTiming.export()` for a full raw dump (timestamp + gap + hidden-state per
    sample) — copyable to clipboard via `copy(JSON.stringify(window.__mezzoTiming.export()))`.

- **`src/prototypes/audio-worklet-test.html`** — a standalone A/B harness (not linked from the
  real app) that runs **both** the current `setInterval`+`AnalyserNode` approach and a prototype
  AudioWorklet-based approach against the *same* live mic input simultaneously, tracking both
  with the same gap/summary logic, live on screen. Lets one real session produce a direct
  comparison instead of needing two separate runs.

Both were verified functionally correct (sample cadence ~50ms, no errors, AudioWorklet module
registers and delivers messages) in an automated headless browser. That environment **cannot**
validate the actual question, though — confirmed directly: `document.hidden` never even flips
to `true` when backgrounding a page via Playwright's multi-page-per-context model, since that
isn't how a real user backgrounds a tab. Real-world testing requires an actual human, an actual
second application in focus, and real wall-clock time.

### Manual test protocol

Run this in a real, non-automated Chrome browser — a real user session, not a dev tool.

**Setup**
1. `cd /Users/gloriamaria/mezzo && python3 -m http.server 8899`
2. Open `http://localhost:8899/monitoring.html?timing=true` (calibrate/select a profile first via
   `try-it.html` if you don't already have one selected — or just append `?timing=true` to
   whatever URL you land on after starting monitoring).
3. Open DevTools → Console, confirm you see `[TIMING] Instrumentation enabled`.
4. Separately, open `http://localhost:8899/src/prototypes/audio-worklet-test.html` in a **second
   tab**, click **Start**, grant mic access there too.

**Test**
5. Switch to a different tab or application entirely (ideally a real Zoom/Meet/Teams call, or at
   minimum a busy tab like a video) so the Mezzo tabs are genuinely backgrounded, not just
   scrolled out of view.
6. Leave it running for **15–20 minutes**, doing something normally (talking, in a real or
   simulated meeting).
7. Come back. Before touching anything, in each tab's console run:
   - Monitoring tab: `window.__mezzoTiming.summary()`
   - A/B prototype tab: read the on-screen stats directly (updates live)
8. Export full raw data from both for the record:
   - `copy(JSON.stringify(window.__mezzoTiming.export()))`
   - `copy(JSON.stringify(window.__abTest.export()))`

**What to look for**
- `avgGapMs` close to 50 = healthy. Climbing into the hundreds or thousands = throttled.
- `throttledCount` (gaps > 200ms) — should be 0 in a healthy run; any nonzero count while
  `hidden: true` confirms throttling is occurring.
- Compare the `setInterval` vs. `AudioWorklet` columns in the A/B prototype directly — if
  `setInterval`'s numbers degrade while `AudioWorklet`'s stay near 50ms throughout, that's a
  direct, real-world confirmation the migration is worth doing (and exactly the "MessagePort
  delivery isn't throttled the way `setInterval` is" claim this whole investigation hinges on —
  see Part 2).
- The `pip-rAF-latency` console lines (if any print — they only log when >50ms) show whether the
  PiP window's own rendering is ever the bottleneck, as opposed to the data feeding it.

**Results — fill in after running:**

| Metric | setInterval (current) | AudioWorklet (prototype) |
|---|---|---|
| Avg gap, tab visible | | |
| Avg gap, tab hidden 5+ min | | |
| Max gap, tab hidden | | |
| Throttled-sample count | | |
| Notes | | |

---

## Part 2 — Proposed Architecture: `MonitoringRuntime`

### Why AudioWorklet, and why it should also fix the delivery side (pending Part 1 confirmation)

`AudioWorkletProcessor.process()` is driven by the Web Audio graph's own render-quantum pull (128
samples at a time, driven by the audio hardware clock) — not a `setTimeout`/`setInterval` call at
all, so there is no timer for Chrome's background-tab throttling to clamp. That part is
structural, not something that needs empirical confirmation.

The part that *did* need checking: getting the computed RMS value back to the main thread (where
classification currently happens) goes through `AudioWorkletNode.port`, which is a
`MessagePort`. General Chrome architecture documentation indicates `MessageChannel`/`MessagePort`
delivery is specifically **not** subject to the same clamps as `setTimeout`/`setInterval` — it's
scheduled as a normal macrotask regardless of page visibility. If Part 1 confirms this in
practice, it means classification doesn't need to move anywhere special either — it can stay a
synchronous handler that runs when the worklet's message arrives, same shape as today's
`onAudioFrame`, and the whole pipeline becomes throttle-resistant without needing to relocate
anything into the PiP window's own script context (which Web Audio's object model doesn't
cleanly support anyway — an `AudioContext` and its nodes belong to the document that created
them).

### The runtime

```js
// src/monitoring-runtime.js — no DOM, no PiP, no page-navigation knowledge
export class MonitoringRuntime {
  constructor() {
    this.engine = new MezzoEngine();
    this.sampler = null;           // RmsSampler — AudioWorklet-backed, see below
    this._stateListeners = new Set();
    this._zone = 0;
    this._isSustained = false;
    this._sustainedTimer = null;
  }

  async start(profile) { /* calibrate engine, create + start sampler, wire sampler->_onFrame */ }
  stop() { /* stop + release sampler, engine.stopMonitoring(), clear sustained timer */ }

  onStateChange(callback) { /* subscribe; returns an unsubscribe function */ }
  getState() { return { zone: this._zone, isSustained: this._isSustained }; }

  _onFrame(rms) { /* engine.processFrame + sustained-escalation timing — same logic that
                      currently lives inline in monitoring.js's onAudioFrame */ }
}
```

`RmsSampler` wraps the sampling mechanism behind one interface (`start(onSample)` / `stop()`),
with two implementations: `AudioWorkletRmsSampler` (primary) and the current
`AnalyserNode` + `setInterval` approach kept as `LegacyIntervalRmsSampler` — a defensive fallback
for the rare case `audioWorklet.addModule()` fails (very old browsers; AudioWorklet has shipped
in Chrome/Edge/Firefox/Safari for years, so this is not a real compatibility concern, more a
"never leave zero fallback" safety net).

### How PiP / the plain page consume it — no duplicated logic

Exactly one `MonitoringRuntime` instance exists per monitoring session (mirrors today's single
`engine` + `audio` instances in `monitoring.js`). Whichever surface currently has visible UI —
the plain page's card, or the PiP window's DOM — subscribes:

```js
runtime.onStateChange(({ zone, isSustained }) => {
  activeCircle.update(zone, isSustained);
  updateHeading(zone);
});
```

This is barely different from what `onAudioFrame` already does today — the change is extracting
it into an independently testable class with a clean public surface, not inventing a new control
flow. Switching between "plain page hosts it" and "PiP hosts it" (today's `openPiP()`/
`resumeMainMonitoring()` handoff) stays exactly as it is: only *which DOM* is being updated
changes, never which logic computed the state.

---

## Migration Scope

Per "do not begin a broad rewrite until the investigation identifies the smallest reliable
change" — this is a **proposal**, not something to execute yet. If Part 1 confirms the
AudioWorklet approach:

- **New files:** `src/monitoring-runtime.js`, `src/rms-sampler.js` (the two `RmsSampler`
  implementations), promoting the already-built `src/prototypes/rms-processor.worklet.js` out of
  `prototypes/`.
- **Changed:** `monitoring.js` — replace the inline `engine`/`audio`/sustained-timer logic with a
  `MonitoringRuntime` instance + subscription, same call sites (`startMonitoring`,
  `stopMonitoring`, `resumeMonitoringFromPipReady`) but delegating instead of implementing.
- **Untouched:** `src/voice-circle.js`, `try-it.js`, `src/profiles.js`, `src/theme.js`,
  `extension/*` — none of this is downstream of the sampling mechanism.
- **`src/audio.js` / `src/engine.js`:** `engine.js`'s classification logic (the zone thresholds,
  the `_computeZone` math) doesn't change at all — only *what calls it and how often* changes.
  `audio.js` itself would largely be superseded by the new sampler, though its mic
  acquire/release lifecycle management (the TRUST-CRITICAL section) is unrelated to sampling
  cadence and could either stay as the acquisition layer the sampler builds on, or get folded
  directly into `RmsSampler` — a decision for the actual migration, not this investigation.

Estimated risk: **low-to-moderate**. The class boundary mirrors what already conceptually exists;
the main new surface area is the `AudioWorkletProcessor` itself (a small, pure, easily unit-
testable RMS calculation) and the sampler's start/stop lifecycle needing the same TRUST-CRITICAL
discipline `audio.js` already has (mic indicator must exactly match listening state).

---

## Browser Limitations

- **AudioWorklet requires a secure context** (HTTPS or localhost) — already true of this app.
- **Safari** supports AudioWorklet but has historically had rougher edge cases around
  worklet module loading timing; would need real Safari testing before relying on it there,
  separate from this Chrome-focused investigation.
- **Document PiP itself** (separate from the audio/timing question) is Chrome/Edge-only today —
  already an existing, accepted constraint from PRD-004, not new to this investigation.
- Chrome's background-tab throttling behavior is **not guaranteed to stay the same across
  versions** — this class of optimization has changed multiple times historically (see the
  Chrome 88 "heavy throttling of chained timers" change). Whatever Part 1 confirms is a snapshot,
  not a permanent guarantee; worth a periodic re-check, not a one-time fix-and-forget.

---

## Fallback Behavior

Unchanged by this investigation, and this is important context for why the risk here is bounded:
PiP is already designed to gracefully degrade to the plain monitoring page when
`documentPictureInPicture` is unsupported or fails to open (see PRD-004's implementation — the
manual "Pop Out" button always works since it's a real click). The plain page, sitting in the
foreground as the active tab, is **not** subject to background-tab throttling at all — so the
absolute worst case if this investigation's fix isn't shipped is: PiP-hosted monitoring can
degrade when backgrounded for a long time, but a user who keeps the plain Mezzo tab focused (not
using PiP) is unaffected regardless. This is not a "monitoring might silently stop working"
severity issue for all users — it's specifically a PiP-while-backgrounded issue.

---

## Risks

- **Part 1 might not confirm the hypothesis** — if `MessagePort` delivery turns out to *also* be
  throttled in practice (contradicting the general documentation found), AudioWorklet alone
  wouldn't fully solve this, and the heavier "host the runtime inside the PiP window's own
  script context" approach (floated and set aside above, since Web Audio objects don't move
  between documents) would need real design work — worth explicitly not assuming away.
- **AudioWorklet module loading is itself async** (`addModule()`) and happens at monitoring
  start — a small added latency (~tens of ms typically) before sampling begins, not present
  today. Should be measured, not assumed negligible.
- **Losing the FFT-based analyser entirely** — `audio.js` currently also exposes `rawDb`/`rawRms`
  and `isSpeaking()`/noise-floor helpers via the `AnalyserNode` path. Confirm nothing outside
  `engine.js`'s zone classification actually depends on those before removing them; a quick grep
  didn't surface external use this session, but worth re-checking at migration time, not assumed
  from this investigation alone.

## Test Coverage (for the actual migration, not yet built)

- Unit tests for `RmsSampler`'s RMS math against known synthetic buffers (mirrors
  `engine.test.js`'s existing pattern of pure-logic testing).
- `MonitoringRuntime` tests using a fake/mock sampler (inject synthetic RMS values), verifying
  `onStateChange` fires correctly — same style as `engine.test.js`'s `readyEngine()` helpers.
- A real (not headless-only) manual re-run of this same background-tab protocol post-migration,
  as the actual acceptance test — automated headless testing cannot validate this class of fix,
  confirmed above, so it isn't a one-time investigation cost, it's the permanent verification
  method for this specific concern.
