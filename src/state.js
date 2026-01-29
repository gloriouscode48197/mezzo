/**
 * State Management Module
 *
 * Manages context profiles, confidence scores, UI stages,
 * and persistence to chrome.storage.local.
 */

const CONTEXTS = ['focused-office', 'open-office', 'home', 'on-call'];

const UIStage = {
  TRAINING: 'training',     // < 30 confidence
  COACHING: 'coaching',     // 30-59 confidence
  GUARDRAIL: 'guardrail',   // 60-84 confidence
  DORMANT: 'dormant',       // >= 85 confidence
};

const DEFAULT_PROFILE = {
  noiseFloorDb: -60,
  normalDb: -30,
  loudDb: -20,
  bandLower: -33,
  bandUpper: -24,
  thresholds: {
    slight: -25,
    significant: -22,
    extreme: -17,
  },
  confidenceScore: 0,
  lastUsedTs: null,
  calibratedTs: null,
};

class StateManager {
  constructor() {
    this.currentContext = 'focused-office';
    this.profiles = {};
    this.isMonitoring = false;
    this.sessionStartTs = null;

    this.onStateChange = null;
  }

  /**
   * Initialize state from storage
   */
  async initialize() {
    await this.loadFromStorage();
    return this;
  }

  /**
   * Load state from chrome.storage.local
   */
  async loadFromStorage() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['voiceCompassState'], (result) => {
          if (result.voiceCompassState) {
            const state = result.voiceCompassState;
            this.currentContext = state.currentContext || 'focused-office';
            this.profiles = state.profiles || {};
            this.isMonitoring = state.isMonitoring || false;
          }
          resolve();
        });
      } else {
        // Fallback for development
        const stored = localStorage.getItem('voiceCompassState');
        if (stored) {
          const state = JSON.parse(stored);
          this.currentContext = state.currentContext || 'focused-office';
          this.profiles = state.profiles || {};
          this.isMonitoring = state.isMonitoring || false;
        }
        resolve();
      }
    });
  }

  /**
   * Save state to storage
   */
  async saveToStorage() {
    const state = {
      currentContext: this.currentContext,
      profiles: this.profiles,
      isMonitoring: this.isMonitoring,
    };

    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ voiceCompassState: state }, resolve);
      } else {
        localStorage.setItem('voiceCompassState', JSON.stringify(state));
        resolve();
      }
    });
  }

  /**
   * Get available contexts
   */
  getContexts() {
    return CONTEXTS;
  }

  /**
   * Get current context
   */
  getCurrentContext() {
    return this.currentContext;
  }

  /**
   * Set current context
   */
  async setContext(context) {
    if (!CONTEXTS.includes(context)) {
      throw new Error(`Invalid context: ${context}`);
    }

    this.currentContext = context;
    await this.saveToStorage();
    this.notifyStateChange();
  }

  /**
   * Get profile for current context
   */
  getCurrentProfile() {
    return this.profiles[this.currentContext] || { ...DEFAULT_PROFILE };
  }

  /**
   * Get profile for a specific context
   */
  getProfile(context) {
    return this.profiles[context] || { ...DEFAULT_PROFILE };
  }

  /**
   * Save profile for current context
   */
  async saveProfile(profile) {
    this.profiles[this.currentContext] = {
      ...profile,
      lastUsedTs: Date.now(),
    };
    await this.saveToStorage();
    this.notifyStateChange();
  }

  /**
   * Check if current context has been calibrated
   */
  isCalibrated() {
    const profile = this.getCurrentProfile();
    return profile.calibratedTs !== null;
  }

  /**
   * Get UI stage based on confidence score
   */
  getUIStage() {
    const profile = this.getCurrentProfile();
    const confidence = profile.confidenceScore || 0;

    if (confidence < 30) return UIStage.TRAINING;
    if (confidence < 60) return UIStage.COACHING;
    if (confidence < 85) return UIStage.GUARDRAIL;
    return UIStage.DORMANT;
  }

  /**
   * Update confidence score based on behavior
   */
  async updateConfidence(delta) {
    const profile = this.getCurrentProfile();
    const newScore = Math.max(0, Math.min(100, profile.confidenceScore + delta));

    await this.saveProfile({
      ...profile,
      confidenceScore: newScore,
    });

    return newScore;
  }

  /**
   * Increase confidence (good behavior)
   * - Time spent in range
   * - Quick self-corrections
   */
  async increaseConfidence(amount = 1) {
    return this.updateConfidence(amount);
  }

  /**
   * Decrease confidence (drift detected)
   * - Sustained drift
   * - Long drift duration
   */
  async decreaseConfidence(amount = 2) {
    return this.updateConfidence(-amount);
  }

  /**
   * Apply daily decay to confidence (when unused)
   */
  async applyConfidenceDecay() {
    const profile = this.getCurrentProfile();

    if (!profile.lastUsedTs) return;

    const daysSinceLastUse = (Date.now() - profile.lastUsedTs) / (1000 * 60 * 60 * 24);

    if (daysSinceLastUse > 1) {
      // Decay 1 point per day, up to 5 points
      const decay = Math.min(5, Math.floor(daysSinceLastUse));
      await this.updateConfidence(-decay);
    }
  }

  /**
   * Set monitoring state
   */
  async setMonitoring(isMonitoring) {
    this.isMonitoring = isMonitoring;

    if (isMonitoring) {
      this.sessionStartTs = Date.now();
      // Update lastUsedTs
      const profile = this.getCurrentProfile();
      await this.saveProfile(profile);
    } else {
      this.sessionStartTs = null;
    }

    await this.saveToStorage();
    this.notifyStateChange();
  }

  /**
   * Get monitoring state
   */
  getMonitoring() {
    return this.isMonitoring;
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration() {
    if (!this.sessionStartTs) return 0;
    return Date.now() - this.sessionStartTs;
  }

  /**
   * Get full state snapshot
   */
  getState() {
    return {
      currentContext: this.currentContext,
      profile: this.getCurrentProfile(),
      uiStage: this.getUIStage(),
      isMonitoring: this.isMonitoring,
      isCalibrated: this.isCalibrated(),
      sessionDuration: this.getSessionDuration(),
    };
  }

  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }
}

export { StateManager, UIStage, CONTEXTS, DEFAULT_PROFILE };
