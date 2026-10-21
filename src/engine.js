/**
 * Mezzo Audio Processing Engine
 *
 * Core logic for classifying speaking volume relative to a calibrated baseline.
 * No UI, animations, or browser APIs - just pure state machine logic.
 */

// =============================================================================
// Constants (all configurable)
// =============================================================================

// Zone thresholds, expressed as offsets from the calibrated baseline in
// multiples of that same calibration's own measured spread (spreadDb — see
// calibrate() below), not fixed dB or ratio constants. This scales each
// profile's zone widths to how variable that person's voice actually was
// during calibration, instead of one-size-fits-all multipliers: a person who
// calibrates with a very steady voice gets tighter zones, a person with more
// natural dynamic range gets wider ones. Zone 0 (Listening) sits below
// ZONE_SILENCE_SPREAD_MULT; each successive zone runs up to its multiplier;
// zone 3 (Outside of Range) is open-ended above ZONE_ACCEPTABLE_SPREAD_MULT
// — there's no volume tier beyond it. "Sustained/consistent outside" is a
// duration flag owned by src/mezzo-session.js, not a louder-volume zone.
//
// These four multipliers are a reasoned starting point, not yet validated
// against real listening tests — the same "first-pass tunable default"
// status the old fixed Everyday Conversation baseline had, before it was
// retired in favor of per-profile calibration. Expect to retune by ear.
export const ZONE_SILENCE_SPREAD_MULT = -2.0;   // baseline + this × spread -> zone 0/1 boundary
export const ZONE_TARGET_SPREAD_MULT = 1.0;     // baseline + this × spread -> zone 1/2 boundary
export const ZONE_ACCEPTABLE_SPREAD_MULT = 2.5; // baseline + this × spread -> zone 2/3 boundary

// Floor applied to a calibration's measured spread before it's used to
// derive zone boundaries (see calibrate() and _computeZone() below) — never
// applied to the spreadDb value actually stored/reported. Two distinct
// situations need this floor: a genuinely very steady real voice (measured
// spread small but nonzero, which would otherwise produce uncomfortably
// tight zones), and a perfectly uniform synthetic calibration — e.g. a fixed
// demo baseline, or a test fixture that fills every sample with one value —
// whose measured spread is exactly 0 and would otherwise collapse every zone
// boundary onto the baseline itself, so that any deviation at all reads as
// Outside Range.
export const MIN_SPREAD_DB = 2;

// Calibration rejection thresholds — see calibrate() below. Each guards a
// different failure mode: a silent room, "forgot to speak" (voice present
// but not for most of the window), and an inconsistent environment
// (background noise, a door slam) that would otherwise just look like
// unusually wide — but genuine — vocal variance.
export const MIN_USABLE_BASELINE_DB = -55;  // trimmed-mean baseline below this reads as no real speech, not calibrated silence
const MIN_VOICED_SAMPLE_RATIO = 0.4; // fraction of the raw (untrimmed) window that must sit meaningfully above the window's own quietest moment
export const VOICED_SAMPLE_MARGIN_DB = 6;   // "meaningfully above" = at least this many dB over the raw buffer's own minimum; also gates whether the check runs at all — see calibrate()
export const MAX_SPREAD_DB = 20;            // measured spread above this reads as an unstable environment, not a steady voice

export const INITIAL_GRACE_MS_MIN = 5000;
export const INITIAL_GRACE_MS_MAX = 8000;

// Confirmation window before a rise into zone 3 (Outside of Range) actually
// commits. Investigated live: an ordinary ~150ms vocal attack crosses the
// entire zone-2 band and reaches zone 3 in ~150ms, which is fast enough that
// a brief, non-sustained spike could commit — and then reverse — before a
// user could perceive it, and faster than the visualizer's own display
// energy can visually catch up, so the ring was still visibly escalating
// after the label had already dropped back down. 300ms was tried first and
// measured against a real ~500ms vocal-emphasis event; it still let that
// ordinary emphasis commit zone 3. Compared 300/500/700ms head to head:
// 500ms is the smallest value that keeps that same ~500ms emphasis from
// ever committing, and 700ms didn't filter anything more in that same
// comparison, just added delay before genuinely sustained loud speech gets
// its full-severity confirmation. This gate only delays the *commit* to
// zone 3 — de-escalation and every other zone transition are untouched.
// See processFrame() below.
export const OUTSIDE_ENTRY_DWELL_MS = 500;

// Assumed real interval between processFrame() calls. Must match the
// caller's actual sampling cadence (audio.js's SAMPLE_INTERVAL_MS = 50) for
// INITIAL_GRACE_MS_* to mean what its name says.
export const FRAME_MS = 50;

// =============================================================================
// Engine Class
// =============================================================================

// Local, dependency-free — mirrors audio.js's own EPSILON/rmsToDb, kept
// separate rather than imported so this file stays pure logic with no
// browser/UI dependencies, per the file header above.
const EPSILON = 1e-10;

export class MezzoEngine {
  constructor() {
    // Calibration values
    this.baselineRMS = null;
    this.spreadDb = null; // dB standard deviation of the trimmed calibration samples — see calibrate()

    // Current zone (0-3)
    this.currentZone = 0;

    // Lifecycle flags
    this.monitoringActive = false;
    this.calibrationComplete = false;

    // Grace period
    this.gracePeriodActive = false;
    this.graceRemainingMs = 0;

    // Outside-of-Range entry confirmation — see OUTSIDE_ENTRY_DWELL_MS above.
    // Monotonic timestamp (matches whatever clock processFrame()'s nowMs
    // argument uses) marking when the signal first qualified for zone 3 and
    // hasn't yet been confirmed; null whenever there's no pending escalation.
    this.pendingOutsideSince = null;
  }

  // ===========================================================================
  // Calibration
  // ===========================================================================

  /**
   * Calibrate the engine with RMS samples.
   *
   * - Sort samples, trim the lowest and highest 10%
   * - Compute mean of the remaining values -> baselineRMS
   * - Compute the dB standard deviation of those same trimmed values -> spreadDb
   * - Reject the calibration outright (throws, nothing is set) if it looks
   *   like silence, mostly-unvoiced input, or an unstable environment —
   *   see the three rejection checks below and their constants above
   *
   * @param {number[]} rmsSamples - Array of RMS values from calibration period
   * @throws {Error} If no valid samples exist, or the sample set fails validation
   */
  calibrate(rmsSamples) {
    if (!rmsSamples || rmsSamples.length === 0) {
      throw new Error('Calibration failed: no samples provided');
    }

    // Sort samples ascending
    const sorted = [...rmsSamples].sort((a, b) => a - b);

    // Calculate trim counts (10% from each end)
    const trimCount = Math.floor(sorted.length * 0.1);

    // Trim lowest 10% and highest 10%. Trimming here in the RMS domain
    // (rather than converting to dB first) produces an identical trimmed
    // set either way, since dB conversion is monotonic — this just avoids
    // an extra pass over the untrimmed data.
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);

    if (trimmed.length === 0) {
      throw new Error('Calibration failed: no valid samples after trimming');
    }

    // Compute mean of remaining values
    const sum = trimmed.reduce((acc, val) => acc + val, 0);
    const mean = sum / trimmed.length;

    // Validate: mean must be positive (silence-only would be ~0)
    if (mean <= 0) {
      throw new Error('Calibration failed: samples appear to be silence-only');
    }

    const baselineDb = MezzoEngine.rmsToDb(mean);
    if (baselineDb < MIN_USABLE_BASELINE_DB) {
      throw new Error('Calibration failed: not enough clear speech detected');
    }

    // Voiced-sample check, against the RAW (untrimmed) buffer — trimming
    // protects the *mean* from a single outlier, but this check needs to
    // know how much of the whole window was actually voiced, which trimming
    // would hide (e.g. one loud moment surrounded mostly by near-silence can
    // trim clean while still failing this check).
    //
    // Measured relative to the raw buffer's OWN minimum, not a fixed
    // absolute floor — a fixed floor (e.g. MIN_USABLE_BASELINE_DB + margin)
    // would reject a stable, clearly-voiced speaker whose whole calibration
    // legitimately sits just above MIN_USABLE_BASELINE_DB: a soft-but-
    // consistent voice at, say, -52dB has nothing in it that clears a fixed
    // -49dB bar, even though every sample is equally, legitimately voice —
    // that directly contradicts the baseline check just above, which already
    // accepted -52dB as usable.
    //
    // Only applied when the raw buffer's own dB range is at least
    // VOICED_SAMPLE_MARGIN_DB wide. Below that, the check is skipped rather
    // than run: this isn't just a degenerate-uniform-data special case, it's
    // mathematically necessary — if the whole buffer spans less than the
    // margin, no sample could *ever* clear "raw minimum + margin", so an
    // unconditional check would reject every low-range buffer regardless of
    // legitimacy, including both a soft-but-stable voice AND (already
    // covered by the baseline check above) genuine near-silence. A
    // meaningful low-vs-high split — the actual failure mode this check
    // exists to catch — always has range comfortably above the margin, so
    // this doesn't weaken the check for that case; do not set
    // VOICED_SAMPLE_MARGIN_DB and the range gate independently — the gate
    // must stay at least the margin, or the check becomes impossible to
    // pass by construction.
    const rawDb = rmsSamples.map((s) => MezzoEngine.rmsToDb(s));
    const rawMinDb = Math.min(...rawDb);
    const rawMaxDb = Math.max(...rawDb);
    if (rawMaxDb - rawMinDb >= VOICED_SAMPLE_MARGIN_DB) {
      const voicedCount = rawDb.filter((db) => db >= rawMinDb + VOICED_SAMPLE_MARGIN_DB).length;
      if (voicedCount / rmsSamples.length < MIN_VOICED_SAMPLE_RATIO) {
        throw new Error('Calibration failed: not enough clear speech detected');
      }
    }

    // Spread: dB standard deviation of the trimmed samples around their own
    // dB-domain mean (not around baselineDb, which is the dB of the RMS
    // mean — a different, and for this purpose wrong, center to measure
    // dispersion against).
    const dbSamples = trimmed.map((s) => MezzoEngine.rmsToDb(s));
    const dbMean = dbSamples.reduce((a, b) => a + b, 0) / dbSamples.length;
    const variance = dbSamples.reduce((acc, v) => acc + (v - dbMean) ** 2, 0) / dbSamples.length;
    const spreadDb = Math.sqrt(variance);

    if (spreadDb > MAX_SPREAD_DB) {
      throw new Error('Calibration failed: environment too inconsistent — try somewhere quieter');
    }

    // Set calibration values
    this.baselineRMS = mean;
    this.spreadDb = spreadDb;
    this.calibrationComplete = true;
  }

  // ===========================================================================
  // Monitoring Lifecycle
  // ===========================================================================

  /**
   * Start monitoring.
   *
   * - Must not start unless calibration is complete
   * - Resets zone state
   * - Enters grace period with random duration
   *
   * @throws {Error} If calibration is not complete
   */
  startMonitoring() {
    if (!this.calibrationComplete) {
      throw new Error('Cannot start monitoring: calibration not complete');
    }

    // Reset zone state
    this.currentZone = 0;
    this.pendingOutsideSince = null;

    // Set monitoring state
    this.monitoringActive = true;

    // Enter grace period with random duration
    this.gracePeriodActive = true;
    this.graceRemainingMs = this._randomBetween(
      INITIAL_GRACE_MS_MIN,
      INITIAL_GRACE_MS_MAX
    );
  }

  /**
   * Stop monitoring.
   *
   * - Immediately stops all processing
   * - Resets all counters and timers
   */
  stopMonitoring() {
    // Reset zone state
    this.currentZone = 0;
    this.gracePeriodActive = false;
    this.graceRemainingMs = 0;
    this.pendingOutsideSince = null;

    // Set monitoring state
    this.monitoringActive = false;
  }

  // ===========================================================================
  // Frame Processing (Core Loop)
  // ===========================================================================

  /**
   * Process a single audio frame.
   *
   * Called once per FRAME_MS interval with current RMS value. `nowMs` is a
   * monotonic timestamp (defaults to performance.now()) — the Outside-of-
   * Range entry dwell (see OUTSIDE_ENTRY_DWELL_MS) is measured against real
   * elapsed time, not frame counts, so it behaves the same regardless of the
   * caller's actual sampling cadence. Tests pass synthetic, deterministic
   * timestamps explicitly rather than relying on real wall-clock time.
   *
   * @param {number} rmsValue - Current RMS value from audio processor
   * @param {number} [nowMs] - Monotonic timestamp for this frame
   */
  processFrame(rmsValue, nowMs = performance.now()) {
    if (!this.monitoringActive) {
      return;
    }

    if (this.gracePeriodActive) {
      this.graceRemainingMs -= FRAME_MS;
      if (this.graceRemainingMs <= 0) {
        this.gracePeriodActive = false;
      }
      this.pendingOutsideSince = null; // no pending escalation carries into/through grace
      return; // No zone updates during grace period
    }

    this.currentZone = this._resolveZone(this._computeZone(rmsValue), nowMs);
  }

  /**
   * Gates entry into zone 3 (Outside of Range) behind OUTSIDE_ENTRY_DWELL_MS
   * of continuous qualification — every other transition (0->1, 1->2, and
   * de-escalation out of 3) passes through immediately, unchanged. While a
   * rise into zone 3 is pending confirmation, the emitted zone is 2
   * (Approaching End of Range) — not whatever the raw zone is — since the
   * signal hasn't yet earned the more severe state. Dropping back below the
   * Outside threshold at any point cancels the pending timer outright, not
   * just pauses it: the next rise starts a fresh dwell window.
   *
   * @param {number} rawZone - _computeZone()'s immediate, undebounced result
   * @param {number} nowMs - monotonic timestamp for this frame
   * @returns {number} the zone to actually commit/emit
   * @private
   */
  _resolveZone(rawZone, nowMs) {
    if (rawZone < 3) {
      this.pendingOutsideSince = null;
      return rawZone;
    }

    // Already confirmed and still qualifying — stays 3, no re-confirmation.
    if (this.currentZone === 3) {
      return 3;
    }

    if (this.pendingOutsideSince === null) {
      this.pendingOutsideSince = nowMs;
    }

    if (nowMs - this.pendingOutsideSince >= OUTSIDE_ENTRY_DWELL_MS) {
      this.pendingOutsideSince = null;
      return 3;
    }

    return 2; // held at Approaching End of Range while confirmation pends
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the current zone. Doubles as the ring level to render — they're the
   * same number now that there's no volume tier beyond zone 3.
   *
   * @returns {number} 0 (Listening) through 3 (Outside of Range)
   */
  getZone() {
    return this.currentZone;
  }

  /**
   * Check if monitoring is currently active.
   *
   * @returns {boolean}
   */
  isMonitoring() {
    return this.monitoringActive;
  }

  /**
   * Check if calibration has been completed.
   *
   * @returns {boolean}
   */
  isCalibrated() {
    return this.calibrationComplete;
  }

  /**
   * Get calibration values (for debugging/testing, and for callers — e.g.
   * src/mezzo-session.js's calibration flow — that persist a profile from them).
   *
   * @returns {{ baselineRMS: number|null, spreadDb: number|null }}
   */
  getCalibrationValues() {
    return {
      baselineRMS: this.baselineRMS,
      spreadDb: this.spreadDb,
    };
  }

  /**
   * The zone boundaries this calibration classifies against, as dB offsets
   * from the calibrated baseline — the exact values _computeZone() uses
   * (same spread floor, same multipliers). Read-only, for presentation: the
   * Range Ring (src/range-ring.js) maps the level against these instead of
   * re-deriving its own, so it can never disagree with classification.
   *
   * @returns {{ silenceDb: number, targetDb: number, endDb: number }}
   *   silenceDb: Listening/Within boundary; targetDb: Within/Approaching;
   *   endDb: the end of range (Approaching/Outside)
   */
  getRangeBoundsDb() {
    const spread = Math.max(this.spreadDb || 0, MIN_SPREAD_DB);
    return {
      silenceDb: ZONE_SILENCE_SPREAD_MULT * spread,
      targetDb: ZONE_TARGET_SPREAD_MULT * spread,
      endDb: ZONE_ACCEPTABLE_SPREAD_MULT * spread,
    };
  }

  /**
   * A level relative to the calibrated baseline, in dB — the same diffDb
   * _computeZone() compares against getRangeBoundsDb(). Returns -Infinity
   * for silence or before calibration.
   *
   * @param {number} rmsValue
   * @returns {number}
   */
  getLevelOffsetDb(rmsValue) {
    if (!this.baselineRMS || this.baselineRMS <= 0 || !rmsValue || rmsValue <= 0) return -Infinity;
    return MezzoEngine.rmsToDb(rmsValue) - MezzoEngine.rmsToDb(this.baselineRMS);
  }

  /**
   * Load an already-computed calibration directly — for starting a
   * monitoring session from a saved profile's stored speakingDb/spreadDb,
   * as opposed to calibrate(), which validates a fresh batch of raw
   * samples. A saved profile was already validated once, when it was first
   * calibrated (or last recalibrated); re-deriving it by feeding calibrate()
   * a synthetic uniform-fill sample array — the previous approach — is both
   * redundant (nothing left to validate) and lossy (a single stored number
   * can't reconstruct the real spreadDb a uniform-fill always measures as
   * exactly 0, silently discarding the profile's real calibrated spread).
   *
   * @param {{ baselineRMS: number, spreadDb?: number }} values
   * @throws {Error} If baselineRMS isn't a usable positive number
   */
  loadCalibration({ baselineRMS, spreadDb }) {
    if (typeof baselineRMS !== 'number' || !Number.isFinite(baselineRMS) || baselineRMS <= 0) {
      throw new Error('loadCalibration requires a positive, finite baselineRMS');
    }
    this.baselineRMS = baselineRMS;
    // Older profiles saved before spreadDb existed carry none — falls back
    // to 0, which _computeZone()'s own MIN_SPREAD_DB floor already handles
    // exactly like a freshly-measured, perfectly uniform calibration would.
    this.spreadDb = typeof spreadDb === 'number' && Number.isFinite(spreadDb) ? spreadDb : 0;
    this.calibrationComplete = true;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Classify an RMS value into a zone (0-3) relative to the calibrated
   * baseline, using zone boundaries derived from this calibration's own
   * spreadDb (see the ZONE_*_SPREAD_MULT constants above) rather than fixed
   * ratios shared across every profile.
   *
   * @param {number} rmsValue
   * @returns {number}
   * @private
   */
  _computeZone(rmsValue) {
    if (!this.baselineRMS || this.baselineRMS <= 0 || !rmsValue || rmsValue <= 0) {
      return 0;
    }

    const spread = Math.max(this.spreadDb || 0, MIN_SPREAD_DB);
    const diffDb = MezzoEngine.rmsToDb(rmsValue) - MezzoEngine.rmsToDb(this.baselineRMS);

    if (diffDb < ZONE_SILENCE_SPREAD_MULT * spread) return 0;
    if (diffDb <= ZONE_TARGET_SPREAD_MULT * spread) return 1;
    if (diffDb <= ZONE_ACCEPTABLE_SPREAD_MULT * spread) return 2;
    return 3;
  }

  /**
   * Generate random integer between min and max (inclusive).
   *
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number}
   * @private
   */
  _randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ===========================================================================
  // Static Utilities
  // ===========================================================================

  static rmsToDb(rms) {
    return 20 * Math.log10(rms + EPSILON);
  }
}
