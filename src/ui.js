/**
 * UI Module - Horizon Band Rendering
 *
 * Visual metaphor:
 * - Horizontal band = "in range"
 * - Floating dot = current voice level
 * - Soft motion, no numbers
 *
 * Stage-based visibility:
 * - TRAINING: always visible
 * - COACHING: auto-hides after period of good behavior
 * - GUARDRAIL: appears briefly on drift, then fades
 * - DORMANT: almost invisible, minimal interruption
 */

import { UIStage } from './state.js';
import { DriftLevel } from './feedback.js';

// Timing constants
const COACHING_HIDE_DELAY_MS = 5000;
const GUARDRAIL_SHOW_DURATION_MS = 3000;
const DORMANT_SHOW_DURATION_MS = 2000;
const FADE_DURATION_MS = 300;

class HorizonBandUI {
  constructor(container) {
    this.container = container;
    this.elements = {};

    this.currentStage = UIStage.TRAINING;
    this.isVisible = true;
    this.hideTimeout = null;
    this.showTimeout = null;

    this.createElements();
  }

  /**
   * Create the Horizon Band DOM elements
   */
  createElements() {
    this.container.innerHTML = `
      <div class="horizon-band-wrapper">
        <div class="horizon-band">
          <div class="band-fill"></div>
          <div class="voice-dot"></div>
        </div>
        <div class="microcopy"></div>
      </div>
    `;

    this.elements = {
      wrapper: this.container.querySelector('.horizon-band-wrapper'),
      band: this.container.querySelector('.horizon-band'),
      fill: this.container.querySelector('.band-fill'),
      dot: this.container.querySelector('.voice-dot'),
      microcopy: this.container.querySelector('.microcopy'),
    };
  }

  /**
   * Update the voice dot position (0-1 range, can exceed)
   */
  updatePosition(position) {
    // Clamp visual position to 0-1.2 range for display
    const visualPosition = Math.max(0, Math.min(1.2, position));

    // Convert to percentage (0% = left edge, 100% = right edge of band)
    const percentage = visualPosition * 83.33; // Scale so 1.0 = 83.33%, leaving room for overflow

    this.elements.dot.style.left = `${percentage}%`;

    // Update dot color based on position
    if (position <= 1) {
      this.elements.dot.classList.remove('warning', 'danger');
    } else if (position <= 1.3) {
      this.elements.dot.classList.add('warning');
      this.elements.dot.classList.remove('danger');
    } else {
      this.elements.dot.classList.add('danger');
      this.elements.dot.classList.remove('warning');
    }
  }

  /**
   * Show drift feedback with appropriate messaging
   */
  showDriftFeedback(driftLevel, message) {
    this.elements.microcopy.textContent = message;
    this.elements.microcopy.classList.add('visible');

    // Set drift level class on band
    this.elements.band.classList.remove('drift-slight', 'drift-significant', 'drift-extreme');
    if (driftLevel !== DriftLevel.NONE) {
      this.elements.band.classList.add(`drift-${driftLevel}`);
    }

    // Show UI based on stage
    this.show();

    // Schedule hide based on stage
    this.scheduleAutoHide();
  }

  /**
   * Clear drift feedback
   */
  clearDriftFeedback() {
    this.elements.microcopy.classList.remove('visible');
    this.elements.band.classList.remove('drift-slight', 'drift-significant', 'drift-extreme');
  }

  /**
   * Set UI stage and update visibility behavior
   */
  setStage(stage) {
    this.currentStage = stage;

    // Update wrapper class for stage-specific styling
    this.elements.wrapper.classList.remove('stage-training', 'stage-coaching', 'stage-guardrail', 'stage-dormant');
    this.elements.wrapper.classList.add(`stage-${stage}`);

    // Update visibility based on stage
    switch (stage) {
      case UIStage.TRAINING:
        this.show();
        break;
      case UIStage.COACHING:
      case UIStage.GUARDRAIL:
      case UIStage.DORMANT:
        // Will show/hide based on drift
        break;
    }
  }

  /**
   * Show the Horizon Band
   */
  show() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.isVisible = true;
    this.elements.wrapper.classList.remove('hidden');
    this.elements.wrapper.classList.add('visible');
  }

  /**
   * Hide the Horizon Band
   */
  hide() {
    this.isVisible = false;
    this.elements.wrapper.classList.remove('visible');
    this.elements.wrapper.classList.add('hidden');
  }

  /**
   * Schedule auto-hide based on current stage
   */
  scheduleAutoHide() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    let delay;
    switch (this.currentStage) {
      case UIStage.TRAINING:
        // Never auto-hide in training
        return;
      case UIStage.COACHING:
        delay = COACHING_HIDE_DELAY_MS;
        break;
      case UIStage.GUARDRAIL:
        delay = GUARDRAIL_SHOW_DURATION_MS;
        break;
      case UIStage.DORMANT:
        delay = DORMANT_SHOW_DURATION_MS;
        break;
      default:
        return;
    }

    this.hideTimeout = setTimeout(() => {
      this.hide();
      this.clearDriftFeedback();
    }, delay);
  }

  /**
   * Get microcopy for calibration steps
   */
  static getCalibrationMicrocopy(step) {
    const copy = {
      silence: 'Stay quiet for a moment...',
      normal: 'Speak at your usual comfortable volume',
      loud: 'Now speak a bit louder, as if someone nearby should hear',
      confirm: 'This is your Horizon Band',
    };
    return copy[step] || '';
  }

  /**
   * Get microcopy for different UI stages and states
   */
  static getStageMicrocopy(stage, state) {
    const copy = {
      [UIStage.TRAINING]: {
        idle: 'Calibrating your voice',
        inRange: 'Nice, right in range',
        monitoring: 'Watching your voice level',
      },
      [UIStage.COACHING]: {
        idle: 'Voice check',
        inRange: '',
        monitoring: '',
      },
      [UIStage.GUARDRAIL]: {
        idle: 'Just a heads up',
        inRange: '',
        monitoring: '',
      },
      [UIStage.DORMANT]: {
        idle: '',
        inRange: '',
        monitoring: '',
      },
    };

    return copy[stage]?.[state] || '';
  }

  /**
   * Update the microcopy text
   */
  setMicrocopy(text) {
    this.elements.microcopy.textContent = text;
    if (text) {
      this.elements.microcopy.classList.add('visible');
    } else {
      this.elements.microcopy.classList.remove('visible');
    }
  }

  /**
   * Show calibration preview mode
   */
  showCalibrationPreview() {
    this.elements.wrapper.classList.add('calibration-preview');
    this.show();
  }

  /**
   * Exit calibration preview mode
   */
  hideCalibrationPreview() {
    this.elements.wrapper.classList.remove('calibration-preview');
  }

  /**
   * Destroy and clean up
   */
  destroy() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
    }
    this.container.innerHTML = '';
  }
}

export { HorizonBandUI };
