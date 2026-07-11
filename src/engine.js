/**
 * Mezzo Audio Processing Engine
 *
 * Core logic for classifying speaking volume relative to a calibrated baseline.
 * No UI, animations, or browser APIs - just pure state machine logic.
 */

// =============================================================================
// Constants (all configurable)
// =============================================================================

// Zone thresholds, expressed as multipliers on the calibrated baseline RMS.
// Zone 0 (Listening) sits below ZONE_SILENCE_RATIO; each successive zone
// runs up to its multiplier; zone 3 (Outside of Range) is open-ended above
// ZONE_ACCEPTABLE_MULT — there's no volume tier beyond it. "Sustained/
// consistent outside" is a duration flag owned by monitoring.js, not a
// louder-volume zone.
export const ZONE_SILENCE_RATIO = 0.3;    // < this × baseline -> zone 0 (Listening)
export const ZONE_TARGET_MULT = 1.15;     // <= this × baseline -> zone 1 (Within Range, target)
export const ZONE_ACCEPTABLE_MULT = 1.8;  // <= this × baseline -> zone 2 (Within Range, acceptable)
                                           // above -> zone 3 (Outside of Range)

export const INITIAL_GRACE_MS_MIN = 5000;
export const INITIAL_GRACE_MS_MAX = 8000;

// Assumed real interval between processFrame() calls. Must match the
// caller's actual sampling cadence (audio.js's SAMPLE_INTERVAL_MS = 50) for
// INITIAL_GRACE_MS_* to mean what its name says.
export const FRAME_MS = 50;

// =============================================================================
// Engine Class
// =============================================================================

export class MezzoEngine {
  constructor() {
    // Calibration values
    this.baselineRMS = null;

    // Current zone (0-3)
    this.currentZone = 0;

    // Lifecycle flags
    this.monitoringActive = false;
    this.calibrationComplete = false;

    // Grace period
    this.gracePeriodActive = false;
    this.graceRemainingMs = 0;
  }

  // ===========================================================================
  // Calibration
  // ===========================================================================

  /**
   * Calibrate the engine with RMS samples.
   *
   * - Sort samples
   * - Remove lowest 10% and highest 10%
   * - Compute mean of remaining values
   * - Set baselineRMS
   *
   * @param {number[]} rmsSamples - Array of RMS values from calibration period
   * @throws {Error} If no valid samples exist after trimming
   */
  calibrate(rmsSamples) {
    if (!rmsSamples || rmsSamples.length === 0) {
      throw new Error('Calibration failed: no samples provided');
    }

    // Sort samples ascending
    const sorted = [...rmsSamples].sort((a, b) => a - b);

    // Calculate trim counts (10% from each end)
    const trimCount = Math.floor(sorted.length * 0.1);

    // Trim lowest 10% and highest 10%
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

    // Set calibration values
    this.baselineRMS = mean;
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

    // Set monitoring state
    this.monitoringActive = false;
  }

  // ===========================================================================
  // Frame Processing (Core Loop)
  // ===========================================================================

  /**
   * Process a single audio frame.
   *
   * Called once per FRAME_MS interval with current RMS value.
   *
   * @param {number} rmsValue - Current RMS value from audio processor
   */
  processFrame(rmsValue) {
    if (!this.monitoringActive) {
      return;
    }

    if (this.gracePeriodActive) {
      this.graceRemainingMs -= FRAME_MS;
      if (this.graceRemainingMs <= 0) {
        this.gracePeriodActive = false;
      }
      return; // No zone updates during grace period
    }

    this.currentZone = this._computeZone(rmsValue);
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
   * Get calibration values (for debugging/testing).
   *
   * @returns {{ baselineRMS: number|null }}
   */
  getCalibrationValues() {
    return {
      baselineRMS: this.baselineRMS,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Classify an RMS value into a zone (0-3) relative to the calibrated baseline.
   *
   * @param {number} rmsValue
   * @returns {number}
   * @private
   */
  _computeZone(rmsValue) {
    if (!this.baselineRMS || this.baselineRMS <= 0 || !rmsValue || rmsValue <= 0) {
      return 0;
    }

    const ratio = rmsValue / this.baselineRMS;

    if (ratio < ZONE_SILENCE_RATIO) return 0;
    if (ratio <= ZONE_TARGET_MULT) return 1;
    if (ratio <= ZONE_ACCEPTABLE_MULT) return 2;
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
}
