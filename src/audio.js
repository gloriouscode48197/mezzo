/**
 * Audio Processing Module
 *
 * Handles microphone access, RMS calculation, dB conversion,
 * EMA smoothing, and noise floor tracking.
 */

const EPSILON = 1e-10;
const EMA_ALPHA = 0.2;
const ANALYSIS_INTERVAL_MS = 50; // ~200ms window with smoothing

class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.mediaStream = null;
    this.source = null;
    this.dataArray = null;

    this.smoothedRms = 0;
    this.smoothedDb = -60;
    this.noiseFloorDb = -60;

    this.isInitialized = false;
    this.isMonitoring = false;
    this.analysisInterval = null;

    this.onLevelChange = null;
  }

  /**
   * Request microphone permission and initialize audio pipeline
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();

      // Configure for ~200ms analysis window
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.source.connect(this.analyser);

      this.dataArray = new Float32Array(this.analyser.fftSize);
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      throw error;
    }
  }

  /**
   * Calculate RMS from time-domain audio data
   */
  calculateRms() {
    this.analyser.getFloatTimeDomainData(this.dataArray);

    let sumSquares = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sumSquares += this.dataArray[i] * this.dataArray[i];
    }

    return Math.sqrt(sumSquares / this.dataArray.length);
  }

  /**
   * Convert RMS to relative dB
   */
  rmsToDb(rms) {
    return 20 * Math.log10(rms + EPSILON);
  }

  /**
   * Apply EMA smoothing
   */
  applySmoothing(currentValue, smoothedValue) {
    return EMA_ALPHA * currentValue + (1 - EMA_ALPHA) * smoothedValue;
  }

  /**
   * Process a single audio frame
   */
  processFrame() {
    if (!this.isInitialized || !this.isMonitoring) return;

    const rms = this.calculateRms();
    const db = this.rmsToDb(rms);

    this.smoothedRms = this.applySmoothing(rms, this.smoothedRms);
    this.smoothedDb = this.applySmoothing(db, this.smoothedDb);

    if (this.onLevelChange) {
      this.onLevelChange({
        rms: this.smoothedRms,
        db: this.smoothedDb,
        rawDb: db,
        isAboveNoiseFloor: this.smoothedDb > this.noiseFloorDb + 6,
      });
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring() {
    if (!this.isInitialized) {
      throw new Error('Audio not initialized. Call initialize() first.');
    }

    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.analysisInterval = setInterval(() => {
      this.processFrame();
    }, ANALYSIS_INTERVAL_MS);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.isMonitoring = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }

  /**
   * Set the noise floor (typically during calibration)
   */
  setNoiseFloor(db) {
    this.noiseFloorDb = db;
  }

  /**
   * Get current noise floor
   */
  getNoiseFloor() {
    return this.noiseFloorDb;
  }

  /**
   * Get current smoothed dB level
   */
  getCurrentDb() {
    return this.smoothedDb;
  }

  /**
   * Check if audio is above noise floor (i.e., user is speaking)
   */
  isSpeaking(delta = 6) {
    return this.smoothedDb > this.noiseFloorDb + delta;
  }

  /**
   * Collect samples for calibration
   * Returns array of dB readings over specified duration
   */
  async collectSamples(durationMs) {
    return new Promise((resolve) => {
      const samples = [];
      const startTime = Date.now();

      const collectInterval = setInterval(() => {
        if (!this.isInitialized) {
          clearInterval(collectInterval);
          resolve(samples);
          return;
        }

        const rms = this.calculateRms();
        const db = this.rmsToDb(rms);
        samples.push(db);

        if (Date.now() - startTime >= durationMs) {
          clearInterval(collectInterval);
          resolve(samples);
        }
      }, ANALYSIS_INTERVAL_MS);
    });
  }

  /**
   * Calculate median from array of values
   */
  static median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Calculate percentile from array of values
   */
  static percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopMonitoring();

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.onLevelChange = null;
  }
}

export { AudioProcessor, EPSILON, EMA_ALPHA };
