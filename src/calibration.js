/**
 * Calibration Module
 *
 * Three-step calibration flow:
 * 1. Silence (5s) - Capture noise floor
 * 2. Normal Voice - Capture median speaking level
 * 3. Nearby-Audible - Capture louder anchor
 *
 * Outputs a context profile with band thresholds and confidence score.
 */

import { AudioProcessor } from './audio.js';

const SILENCE_DURATION_MS = 5000;
const VOICE_SAMPLE_DURATION_MS = 8000;
const MIN_LOUD_DELTA_DB = 3; // Minimum difference between normal and loud

const CalibrationStep = {
  IDLE: 'idle',
  SILENCE: 'silence',
  NORMAL: 'normal',
  LOUD: 'loud',
  CONFIRM: 'confirm',
  COMPLETE: 'complete',
};

class CalibrationFlow {
  constructor(audioProcessor) {
    this.audio = audioProcessor;
    this.step = CalibrationStep.IDLE;

    this.noiseFloorDb = -60;
    this.normalDb = -30;
    this.loudDb = -20;

    this.silenceSamples = [];
    this.normalSamples = [];
    this.loudSamples = [];

    this.onStepChange = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  /**
   * Start the calibration flow
   */
  async start() {
    if (!this.audio.isInitialized) {
      await this.audio.initialize();
    }

    this.step = CalibrationStep.SILENCE;
    this.notifyStepChange();

    try {
      await this.captureSilence();
      await this.captureNormalVoice();
      await this.captureLoudVoice();
      this.step = CalibrationStep.CONFIRM;
      this.notifyStepChange();
    } catch (error) {
      this.step = CalibrationStep.IDLE;
      if (this.onError) {
        this.onError(error);
      }
    }
  }

  /**
   * Step 1: Capture noise floor during silence
   */
  async captureSilence() {
    this.step = CalibrationStep.SILENCE;
    this.notifyStepChange();

    const samples = await this.collectWithProgress(SILENCE_DURATION_MS);
    this.silenceSamples = samples;

    // Use 90th percentile as noise floor to account for occasional ambient sounds
    this.noiseFloorDb = AudioProcessor.percentile(samples, 90);
    this.audio.setNoiseFloor(this.noiseFloorDb);
  }

  /**
   * Step 2: Capture normal speaking voice
   */
  async captureNormalVoice() {
    this.step = CalibrationStep.NORMAL;
    this.notifyStepChange();

    const samples = await this.collectWithProgress(VOICE_SAMPLE_DURATION_MS);

    // Filter out silence (only keep samples above noise floor)
    const voiceSamples = samples.filter(db => db > this.noiseFloorDb + 6);
    this.normalSamples = voiceSamples;

    if (voiceSamples.length < 10) {
      throw new Error('Not enough voice detected. Please speak more during calibration.');
    }

    // Use median of voice samples
    this.normalDb = AudioProcessor.median(voiceSamples);
  }

  /**
   * Step 3: Capture nearby-audible (louder) voice
   */
  async captureLoudVoice() {
    this.step = CalibrationStep.LOUD;
    this.notifyStepChange();

    const samples = await this.collectWithProgress(VOICE_SAMPLE_DURATION_MS);

    // Filter out silence
    const voiceSamples = samples.filter(db => db > this.noiseFloorDb + 6);
    this.loudSamples = voiceSamples;

    if (voiceSamples.length < 10) {
      throw new Error('Not enough voice detected. Please speak more during calibration.');
    }

    // Use 75th percentile to capture the louder moments
    this.loudDb = AudioProcessor.percentile(voiceSamples, 75);
  }

  /**
   * Collect samples with progress updates
   */
  async collectWithProgress(durationMs) {
    const startTime = Date.now();
    const samples = [];
    const intervalMs = 50;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        if (this.audio.isInitialized) {
          const rms = this.audio.calculateRms();
          const db = this.audio.rmsToDb(rms);
          samples.push(db);
        }

        if (this.onProgress) {
          this.onProgress(progress, this.step);
        }

        if (elapsed >= durationMs) {
          clearInterval(interval);
          resolve(samples);
        }
      }, intervalMs);
    });
  }

  /**
   * Check if loud level is sufficiently different from normal
   */
  isLoudLevelValid() {
    return this.loudDb - this.normalDb >= MIN_LOUD_DELTA_DB;
  }

  /**
   * Retry the loud voice capture
   */
  async retryLoudCapture() {
    await this.captureLoudVoice();
    this.step = CalibrationStep.CONFIRM;
    this.notifyStepChange();
  }

  /**
   * Calculate the Horizon Band boundaries
   */
  calculateBand() {
    // Band lower = normal speaking level minus a small buffer
    const bandLower = this.normalDb - 3;

    // Band upper = midpoint between normal and loud
    const bandUpper = this.normalDb + (this.loudDb - this.normalDb) * 0.6;

    return { bandLower, bandUpper };
  }

  /**
   * Calculate drift thresholds
   */
  calculateThresholds() {
    const range = this.loudDb - this.normalDb;

    return {
      slight: this.normalDb + range * 0.5,      // Start of drift
      significant: this.normalDb + range * 0.75, // Clear drift
      extreme: this.loudDb + 3,                   // Very loud
    };
  }

  /**
   * Complete calibration and return the profile
   */
  confirm() {
    const { bandLower, bandUpper } = this.calculateBand();
    const thresholds = this.calculateThresholds();

    const profile = {
      noiseFloorDb: this.noiseFloorDb,
      normalDb: this.normalDb,
      loudDb: this.loudDb,
      bandLower,
      bandUpper,
      thresholds,
      confidenceScore: 50, // Start at middle confidence
      lastUsedTs: Date.now(),
      calibratedTs: Date.now(),
    };

    this.step = CalibrationStep.COMPLETE;
    this.notifyStepChange();

    if (this.onComplete) {
      this.onComplete(profile);
    }

    return profile;
  }

  /**
   * Cancel calibration
   */
  cancel() {
    this.step = CalibrationStep.IDLE;
    this.notifyStepChange();
  }

  /**
   * Get current step info for UI
   */
  getStepInfo() {
    const steps = {
      [CalibrationStep.IDLE]: {
        title: 'Ready to calibrate',
        instruction: 'Click start to begin calibration.',
      },
      [CalibrationStep.SILENCE]: {
        title: 'Calibrating your voice',
        instruction: 'Stay quiet for a moment so we can measure background noise.',
      },
      [CalibrationStep.NORMAL]: {
        title: 'Speak normally',
        instruction: 'Talk at your usual comfortable volume for this space.',
      },
      [CalibrationStep.LOUD]: {
        title: 'Speak a bit louder',
        instruction: 'Now speak at a level someone nearby could easily hear.',
      },
      [CalibrationStep.CONFIRM]: {
        title: 'Review your range',
        instruction: 'This is your Horizon Band. The dot shows your current level.',
      },
      [CalibrationStep.COMPLETE]: {
        title: 'Calibration complete',
        instruction: 'Your voice range is set. Start monitoring when ready.',
      },
    };

    return steps[this.step] || steps[CalibrationStep.IDLE];
  }

  notifyStepChange() {
    if (this.onStepChange) {
      this.onStepChange(this.step, this.getStepInfo());
    }
  }
}

export { CalibrationFlow, CalibrationStep };
