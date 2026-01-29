/**
 * Feedback / Drift Detection Module
 *
 * Detects when voice drifts outside the Horizon Band and triggers
 * appropriate feedback based on drift level and duration.
 */

const DriftLevel = {
  NONE: 'none',
  SLIGHT: 'slight',
  SIGNIFICANT: 'significant',
  EXTREME: 'extreme',
};

// Timing thresholds (milliseconds)
const SLIGHT_DRIFT_DELAY_MS = 1500;    // Trigger after 1.5s of slight drift
const SIGNIFICANT_DRIFT_DELAY_MS = 800; // Trigger after 0.8s of significant drift
const EXTREME_DRIFT_DELAY_MS = 300;     // Trigger almost immediately for extreme
const SPIKE_IGNORE_MS = 500;            // Ignore spikes shorter than this

// Confidence adjustments
const CONFIDENCE_INCREASE_IN_RANGE = 0.5;      // Per 10 seconds in range
const CONFIDENCE_DECREASE_SLIGHT = 1;          // Per drift event
const CONFIDENCE_DECREASE_SIGNIFICANT = 2;     // Per drift event
const CONFIDENCE_DECREASE_EXTREME = 3;         // Per drift event
const CONFIDENCE_INCREASE_SELF_CORRECT = 2;    // Quick self-correction bonus

class FeedbackManager {
  constructor(stateManager) {
    this.state = stateManager;

    // Drift tracking
    this.currentDriftLevel = DriftLevel.NONE;
    this.driftStartTs = null;
    this.lastDriftLevel = DriftLevel.NONE;
    this.lastFeedbackTs = null;

    // In-range tracking
    this.inRangeStartTs = null;
    this.lastConfidenceUpdateTs = null;

    // Callbacks
    this.onDriftDetected = null;
    this.onReturnToRange = null;
    this.onConfidenceUpdate = null;
  }

  /**
   * Process a new audio level reading
   */
  processLevel(db, isSpeaking) {
    const profile = this.state.getCurrentProfile();

    // Only process when user is speaking
    if (!isSpeaking) {
      this.resetDrift();
      return { driftLevel: DriftLevel.NONE, shouldTrigger: false };
    }

    const driftLevel = this.calculateDriftLevel(db, profile);
    const now = Date.now();

    // Track drift timing
    if (driftLevel !== DriftLevel.NONE) {
      if (this.currentDriftLevel !== driftLevel) {
        // Drift level changed
        this.driftStartTs = now;
        this.currentDriftLevel = driftLevel;
      }

      const driftDuration = now - this.driftStartTs;
      const shouldTrigger = this.shouldTriggerFeedback(driftLevel, driftDuration);

      if (shouldTrigger) {
        this.handleDriftTrigger(driftLevel);
      }

      // Reset in-range tracking
      this.inRangeStartTs = null;

      return {
        driftLevel,
        driftDuration,
        shouldTrigger,
        position: this.calculatePosition(db, profile),
      };
    } else {
      // In range
      const wasInDrift = this.currentDriftLevel !== DriftLevel.NONE;
      const quickCorrection = wasInDrift && (now - this.driftStartTs) < 3000;

      if (wasInDrift) {
        this.handleReturnToRange(quickCorrection);
      }

      this.currentDriftLevel = DriftLevel.NONE;
      this.driftStartTs = null;

      // Track time in range for confidence building
      if (!this.inRangeStartTs) {
        this.inRangeStartTs = now;
      }

      this.updateInRangeConfidence(now);

      return {
        driftLevel: DriftLevel.NONE,
        shouldTrigger: false,
        position: this.calculatePosition(db, profile),
      };
    }
  }

  /**
   * Calculate drift level based on thresholds
   */
  calculateDriftLevel(db, profile) {
    const { thresholds } = profile;

    if (db >= thresholds.extreme) {
      return DriftLevel.EXTREME;
    } else if (db >= thresholds.significant) {
      return DriftLevel.SIGNIFICANT;
    } else if (db >= thresholds.slight) {
      return DriftLevel.SLIGHT;
    }

    return DriftLevel.NONE;
  }

  /**
   * Calculate position within the Horizon Band (0-1, can exceed)
   */
  calculatePosition(db, profile) {
    const { bandLower, bandUpper } = profile;
    const range = bandUpper - bandLower;

    if (range === 0) return 0.5;

    // 0 = at/below lower band, 1 = at upper band, >1 = above band
    return (db - bandLower) / range;
  }

  /**
   * Determine if feedback should be triggered
   */
  shouldTriggerFeedback(driftLevel, driftDuration) {
    // Ignore short spikes
    if (driftDuration < SPIKE_IGNORE_MS) {
      return false;
    }

    switch (driftLevel) {
      case DriftLevel.SLIGHT:
        return driftDuration >= SLIGHT_DRIFT_DELAY_MS;
      case DriftLevel.SIGNIFICANT:
        return driftDuration >= SIGNIFICANT_DRIFT_DELAY_MS;
      case DriftLevel.EXTREME:
        return driftDuration >= EXTREME_DRIFT_DELAY_MS;
      default:
        return false;
    }
  }

  /**
   * Handle drift trigger
   */
  handleDriftTrigger(driftLevel) {
    // Avoid spamming feedback
    const now = Date.now();
    if (this.lastFeedbackTs && now - this.lastFeedbackTs < 2000) {
      return;
    }

    this.lastFeedbackTs = now;
    this.lastDriftLevel = driftLevel;

    // Decrease confidence
    let decrease = CONFIDENCE_DECREASE_SLIGHT;
    if (driftLevel === DriftLevel.SIGNIFICANT) {
      decrease = CONFIDENCE_DECREASE_SIGNIFICANT;
    } else if (driftLevel === DriftLevel.EXTREME) {
      decrease = CONFIDENCE_DECREASE_EXTREME;
    }

    this.state.decreaseConfidence(decrease);

    if (this.onConfidenceUpdate) {
      this.onConfidenceUpdate(this.state.getCurrentProfile().confidenceScore);
    }

    if (this.onDriftDetected) {
      this.onDriftDetected(driftLevel, this.getDriftMessage(driftLevel));
    }
  }

  /**
   * Handle return to range
   */
  handleReturnToRange(quickCorrection) {
    if (quickCorrection) {
      // Bonus for quick self-correction
      this.state.increaseConfidence(CONFIDENCE_INCREASE_SELF_CORRECT);

      if (this.onConfidenceUpdate) {
        this.onConfidenceUpdate(this.state.getCurrentProfile().confidenceScore);
      }
    }

    if (this.onReturnToRange) {
      this.onReturnToRange(quickCorrection);
    }
  }

  /**
   * Update confidence for time spent in range
   */
  updateInRangeConfidence(now) {
    if (!this.lastConfidenceUpdateTs) {
      this.lastConfidenceUpdateTs = now;
      return;
    }

    // Increase confidence every 10 seconds in range
    const elapsed = now - this.lastConfidenceUpdateTs;
    if (elapsed >= 10000) {
      const increments = Math.floor(elapsed / 10000);
      this.state.increaseConfidence(CONFIDENCE_INCREASE_IN_RANGE * increments);
      this.lastConfidenceUpdateTs = now;

      if (this.onConfidenceUpdate) {
        this.onConfidenceUpdate(this.state.getCurrentProfile().confidenceScore);
      }
    }
  }

  /**
   * Reset drift tracking
   */
  resetDrift() {
    this.currentDriftLevel = DriftLevel.NONE;
    this.driftStartTs = null;
  }

  /**
   * Get appropriate message for drift level and UI stage
   */
  getDriftMessage(driftLevel) {
    const uiStage = this.state.getUIStage();

    const messages = {
      training: {
        [DriftLevel.SLIGHT]: 'A bit louder than your usual range',
        [DriftLevel.SIGNIFICANT]: 'Getting quite loud',
        [DriftLevel.EXTREME]: 'Much louder than usual',
      },
      coaching: {
        [DriftLevel.SLIGHT]: 'Voice check',
        [DriftLevel.SIGNIFICANT]: 'You might be louder than you need to be',
        [DriftLevel.EXTREME]: 'Louder than usual for this space',
      },
      guardrail: {
        [DriftLevel.SLIGHT]: 'Just a heads up',
        [DriftLevel.SIGNIFICANT]: 'Just a heads up',
        [DriftLevel.EXTREME]: 'Just a heads up',
      },
      dormant: {
        [DriftLevel.SLIGHT]: "Volume's higher than usual for this space",
        [DriftLevel.SIGNIFICANT]: "Volume's higher than usual for this space",
        [DriftLevel.EXTREME]: "Volume's higher than usual for this space",
      },
    };

    return messages[uiStage]?.[driftLevel] || 'Voice check';
  }

  /**
   * Get current drift state
   */
  getDriftState() {
    return {
      level: this.currentDriftLevel,
      duration: this.driftStartTs ? Date.now() - this.driftStartTs : 0,
      lastFeedback: this.lastFeedbackTs,
    };
  }

  /**
   * End monitoring session and finalize confidence updates
   */
  endSession() {
    // Final in-range confidence update
    if (this.inRangeStartTs) {
      this.updateInRangeConfidence(Date.now());
    }

    this.resetDrift();
    this.inRangeStartTs = null;
    this.lastConfidenceUpdateTs = null;
  }
}

export { FeedbackManager, DriftLevel };
