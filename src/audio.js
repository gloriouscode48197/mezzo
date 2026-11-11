/**
 * Audio Processing Module
 *
 * TRUST-CRITICAL: Microphone lifecycle management
 *
 * Core invariant: Browser mic indicator must exactly match app's listening state.
 * - Mic ON only during: calibration capture, active monitoring
 * - Mic OFF during: landing, orientation, confirmation, idle, paused
 *
 * The microphone is acquired fresh for each listening session and fully released
 * when listening ends. We never keep the mic "warm" or "suspended".
 */

// =============================================================================
// Constants
// =============================================================================

const EPSILON = 1e-10;
const EMA_ALPHA = 0.2;
const SAMPLE_INTERVAL_MS = 50;
const FFT_SIZE = 2048;

/**
 * Input settings. The app uses these defaults (the speech-band filter on,
 * no browser noise suppression, no automatic gain); the tuning page
 * (design/prototypes/ring-tuner.html) passes its own live copy.
 *
 * speechFilter: an optional band-pass (high-pass then low-pass biquads)
 *   between the microphone and the analyser, so both the zone input and the
 *   visuals measure the speech band rather than fan rumble or hiss.
 * noiseSuppression: getUserMedia's noiseSuppression constraint, read at
 *   acquire() time. autoGainControl always stays off: it would undo the
 *   loudness Mezzo is measuring.
 */
export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  // On (2026-10-22): measuring only the speech band keeps fan rumble and hiss
  // from moving the circle or the zones. 120 Hz to 3400 Hz, the telephone
  // speech band, tuned in design/prototypes/ring-tuner.html.
  speechFilter: Object.freeze({ enabled: true, highPassHz: 120, lowPassHz: 3400 }),
  noiseSuppression: false,
});

// TEMPORARY — background-tab throttling investigation, see
// docs/monitoring-runtime-investigation.md. Delete this import and its one
// call site (in processAudioFrame) once the investigation concludes.
import { markSample } from './_timing-debug.js';

// =============================================================================
// AudioProcessor Class
// =============================================================================

class AudioProcessor {
  /**
   * @param {{ settings?: typeof DEFAULT_AUDIO_SETTINGS }} [options] - the app
   *   passes nothing
   */
  constructor({ settings = DEFAULT_AUDIO_SETTINGS } = {}) {
    this.settings = settings;
    this.highPassNode = null;
    this.lowPassNode = null;

    // Web Audio API objects - all null when mic is released
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.timeDomainData = null;

    // State flags
    this.isInitialized = false;  // True only while mic is actively acquired
    this.isMonitoring = false;   // True while actively sampling

    // A request still waiting on getUserMedia(), shared by every caller
    // that arrives meanwhile, and a count release() bumps: a request that
    // was waiting when release() ran stops its stream the moment it
    // arrives instead of keeping it (see acquire()).
    this.pendingAcquire = null;
    this.releaseCount = 0;

    // Sampling interval
    this.monitoringInterval = null;

    // Smoothed output values
    this.smoothedRms = 0;
    this.smoothedDb = -100;

    // Calibration reference
    this.noiseFloorDb = -60;

    // External callback
    this.onLevelChange = null;

    // Bind methods
    this.processAudioFrame = this.processAudioFrame.bind(this);
  }

  // ===========================================================================
  // Microphone Lifecycle - TRUST CRITICAL
  // ===========================================================================

  /**
   * Acquire microphone access and set up audio pipeline.
   *
   * MUST be called in direct response to user action.
   * After this returns, the browser mic indicator will be ON.
   */
  async acquire() {
    // Already acquired - no-op
    if (this.isInitialized && this.mediaStream) {
      console.log('[Audio] Microphone already acquired');
      return;
    }
    // A request already waiting: share it. A second getUserMedia() would
    // replace the first stream here, and the first could never be stopped.
    if (this.pendingAcquire) return this.pendingAcquire;

    const pending = this._acquire(this.releaseCount);
    this.pendingAcquire = pending;
    try {
      await pending;
    } finally {
      if (this.pendingAcquire === pending) this.pendingAcquire = null;
    }
  }

  /** acquire()'s work. `releaseCountAtStart` is releaseCount when the
   *  request began: if release() ran while getUserMedia() was waiting, the
   *  stream it returns belongs to nobody, so it's stopped right away and the
   *  request fails with an AbortError. */
  async _acquire(releaseCountAtStart) {
    console.log('[Audio] Acquiring microphone...');

    let stream;
    try {
      // Request microphone - this shows browser permission prompt if needed
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: !!this.settings.noiseSuppression,
          autoGainControl: false,
        },
      });
    } catch (error) {
      console.error('[Audio] Failed to acquire microphone:', error.message);
      throw error;
    }

    if (this.releaseCount !== releaseCountAtStart) {
      stream.getTracks().forEach((track) => track.stop());
      console.log('[Audio] Microphone arrived after release() - stopped it');
      const aborted = new Error('Microphone released while it was being acquired');
      aborted.name = 'AbortError';
      throw aborted;
    }

    try {
      this.mediaStream = stream;

      // Create AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0;

      // Connect microphone to analyser (through the speech-band filter
      // when it's enabled — see applyFilterSettings())
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.applyFilterSettings();

      // Create sample buffer
      this.timeDomainData = new Float32Array(this.analyser.fftSize);

      this.isInitialized = true;
      console.log('[Audio] Microphone acquired - browser indicator should be ON');

    } catch (error) {
      console.error('[Audio] Failed to set up the microphone:', error.message);
      // Ensure clean state on failure
      this.release();
      throw error;
    }
  }

  /**
   * (Re)wires source -> [high-pass -> low-pass] -> analyser from the current
   * settings. Called on acquire(), and again by the tuner whenever the
   * filter settings change, without reacquiring the microphone.
   */
  applyFilterSettings() {
    if (!this.audioContext || !this.sourceNode || !this.analyser) return;
    const { enabled, highPassHz, lowPassHz } = this.settings.speechFilter;
    this.sourceNode.disconnect?.();
    this.highPassNode?.disconnect();
    this.lowPassNode?.disconnect();
    if (!enabled) {
      this.sourceNode.connect(this.analyser);
      return;
    }
    if (!this.highPassNode) {
      this.highPassNode = this.audioContext.createBiquadFilter();
      this.highPassNode.type = 'highpass';
      this.lowPassNode = this.audioContext.createBiquadFilter();
      this.lowPassNode.type = 'lowpass';
    }
    this.highPassNode.frequency.value = highPassHz;
    this.lowPassNode.frequency.value = lowPassHz;
    this.sourceNode.connect(this.highPassNode);
    this.highPassNode.connect(this.lowPassNode);
    this.lowPassNode.connect(this.analyser);
  }

  /**
   * Fully release microphone and all audio resources.
   *
   * After this returns, the browser mic indicator MUST be OFF.
   * This is the ONLY way to turn off the mic indicator.
   */
  release() {
    console.log('[Audio] Releasing microphone...');

    // A request still waiting on getUserMedia() stops its stream when it
    // arrives (see _acquire()), and the next acquire() starts fresh.
    this.releaseCount += 1;
    this.pendingAcquire = null;

    // Stop monitoring interval if running
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;

    // Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }
    for (const node of [this.highPassNode, this.lowPassNode]) {
      try { node?.disconnect(); } catch (e) { /* ignore */ }
    }
    this.highPassNode = null;
    this.lowPassNode = null;

    // CRITICAL: Stop all tracks - this turns off the browser mic indicator
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log(`[Audio] Stopped track: ${track.kind}`);
      });
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        // Ignore close errors
      }
      this.audioContext = null;
    }

    // Clear all references
    this.analyser = null;
    this.timeDomainData = null;
    this.isInitialized = false;
    this.onLevelChange = null;

    // Reset smoothed values
    this.smoothedRms = 0;
    this.smoothedDb = -100;

    console.log('[Audio] Microphone released - browser indicator should be OFF');
  }

  /**
   * Check if microphone is currently acquired (browser indicator ON).
   */
  get isMicrophoneActive() {
    return this.isInitialized && this.mediaStream !== null;
  }

  // ===========================================================================
  // Legacy API - initialize() and destroy() map to acquire() and release()
  // ===========================================================================

  /**
   * @deprecated Use acquire() instead
   */
  async initialize() {
    return this.acquire();
  }

  /**
   * @deprecated Use release() instead
   */
  destroy() {
    return this.release();
  }

  // ===========================================================================
  // Monitoring
  // ===========================================================================

  /**
   * Start continuous audio level monitoring.
   * Microphone must be acquired first.
   */
  startMonitoring() {
    if (!this.isInitialized) {
      console.error('[Audio] Cannot start monitoring: microphone not acquired');
      return;
    }

    if (this.isMonitoring) {
      console.log('[Audio] Already monitoring');
      return;
    }

    console.log('[Audio] Starting monitoring...');
    this.isMonitoring = true;

    // Resume AudioContext if suspended
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }

    // Start sampling interval
    this.monitoringInterval = setInterval(() => {
      this.processAudioFrame();
    }, SAMPLE_INTERVAL_MS);

    console.log('[Audio] Monitoring started');
  }

  /**
   * Stop monitoring (but keep microphone acquired).
   * Use release() to fully release the microphone.
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    console.log('[Audio] Stopping monitoring...');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    console.log('[Audio] Monitoring stopped');
  }

  // ===========================================================================
  // Audio Processing
  // ===========================================================================

  processAudioFrame() {
    if (!this.analyser || !this.timeDomainData) return;

    markSample(); // TEMPORARY — see docs/monitoring-runtime-investigation.md

    const rms = this.calculateRms();
    const db = Math.max(-120, this.rmsToDb(rms));

    this.smoothedRms = this.applyEmaSmoothing(rms, this.smoothedRms);
    this.smoothedDb = this.applyEmaSmoothing(db, this.smoothedDb);

    if (this.onLevelChange) {
      this.onLevelChange({
        rms: this.smoothedRms,
        db: this.smoothedDb,
        rawRms: rms,
        rawDb: db,
      });
    }
  }

  calculateRms() {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    let sumOfSquares = 0;
    for (let i = 0; i < this.timeDomainData.length; i++) {
      const sample = this.timeDomainData[i];
      sumOfSquares += sample * sample;
    }

    return Math.sqrt(sumOfSquares / this.timeDomainData.length);
  }

  rmsToDb(rms) {
    return 20 * Math.log10(rms + EPSILON);
  }

  applyEmaSmoothing(currentValue, previousSmoothedValue) {
    return EMA_ALPHA * currentValue + (1 - EMA_ALPHA) * previousSmoothedValue;
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  getCurrentLevel() {
    return {
      db: this.smoothedDb,
      rms: this.smoothedRms,
    };
  }

  setNoiseFloor(db) {
    this.noiseFloorDb = db;
  }

  getNoiseFloor() {
    return this.noiseFloorDb;
  }

  isSpeaking(delta = 6) {
    return this.smoothedDb > this.noiseFloorDb + delta;
  }

  // ===========================================================================
  // Static Utilities
  // ===========================================================================

  static median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  static percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

export { AudioProcessor, EPSILON, EMA_ALPHA };
