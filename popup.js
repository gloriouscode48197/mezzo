/**
 * Voice Compass - Main Popup Controller
 *
 * Integrates all modules to provide the full voice monitoring experience.
 */

import { AudioProcessor } from './src/audio.js';
import { CalibrationFlow, CalibrationStep } from './src/calibration.js';
import { StateManager, UIStage } from './src/state.js';
import { FeedbackManager, DriftLevel } from './src/feedback.js';
import { HorizonBandUI } from './src/ui.js';

// ============================================================================
// Application State
// ============================================================================

const app = {
  audio: null,
  calibration: null,
  state: null,
  feedback: null,
  ui: {
    calibration: null,
    confirm: null,
    monitor: null,
  },
  currentView: 'uncalibrated',
};

// ============================================================================
// DOM References
// ============================================================================

const views = {
  uncalibrated: document.getElementById('view-uncalibrated'),
  calibration: document.getElementById('view-calibration'),
  confirm: document.getElementById('view-confirm'),
  monitoring: document.getElementById('view-monitoring'),
  idle: document.getElementById('view-idle'),
};

const elements = {
  contextSelector: document.getElementById('context-selector'),

  // Calibration
  btnCalibrate: document.getElementById('btn-calibrate'),
  calibrationTitle: document.getElementById('calibration-title'),
  calibrationInstruction: document.getElementById('calibration-instruction'),
  calibrationProgress: document.getElementById('calibration-progress'),
  calibrationBand: document.getElementById('calibration-band'),
  btnCancelCalibration: document.getElementById('btn-cancel-calibration'),

  // Confirm
  confirmBand: document.getElementById('confirm-band'),
  btnConfirmCalibration: document.getElementById('btn-confirm-calibration'),
  btnRedoCalibration: document.getElementById('btn-redo-calibration'),

  // Monitoring
  monitorBand: document.getElementById('monitor-band'),
  monitoringLabel: document.getElementById('monitoring-label'),

  // Idle
  confidenceValue: document.getElementById('confidence-value'),

  // Footer controls
  btnToggleMonitoring: document.getElementById('btn-toggle-monitoring'),
  btnShowGuidance: document.getElementById('btn-show-guidance'),
  btnRecalibrate: document.getElementById('btn-recalibrate'),
};

// ============================================================================
// View Management
// ============================================================================

function showView(viewName) {
  Object.entries(views).forEach(([name, el]) => {
    el.classList.toggle('hidden', name !== viewName);
  });
  app.currentView = viewName;
  updateFooterControls();
}

function updateFooterControls() {
  const isCalibrated = app.state?.isCalibrated();
  const isMonitoring = app.state?.getMonitoring();

  // Toggle monitoring button
  elements.btnToggleMonitoring.disabled = !isCalibrated || app.currentView === 'calibration';

  if (isMonitoring) {
    elements.btnToggleMonitoring.classList.add('active');
    elements.btnToggleMonitoring.querySelector('.toggle-label').textContent = 'Pause Monitoring';
  } else {
    elements.btnToggleMonitoring.classList.remove('active');
    elements.btnToggleMonitoring.querySelector('.toggle-label').textContent = 'Start Monitoring';
  }

  // Secondary actions
  const showSecondary = isCalibrated && !isMonitoring && app.currentView !== 'calibration';
  elements.btnShowGuidance.classList.toggle('hidden', !showSecondary);
  elements.btnRecalibrate.classList.toggle('hidden', !showSecondary);
}

// ============================================================================
// Context Management
// ============================================================================

function updateContextSelector() {
  const contexts = app.state.getContexts();
  const currentContext = app.state.getCurrentContext();

  // Clear and repopulate (in case we want to show calibration status)
  elements.contextSelector.innerHTML = contexts.map(ctx => {
    const profile = app.state.getProfile(ctx);
    const calibrated = profile.calibratedTs !== null;
    const label = formatContextName(ctx) + (calibrated ? ' *' : '');
    return `<option value="${ctx}" ${ctx === currentContext ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function formatContextName(context) {
  return context
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function handleContextChange() {
  const newContext = elements.contextSelector.value;
  await app.state.setContext(newContext);

  // Stop monitoring when context changes
  if (app.state.getMonitoring()) {
    await stopMonitoring();
  }

  updateUIForCurrentState();
}

// ============================================================================
// Calibration Flow
// ============================================================================

async function startCalibration() {
  showView('calibration');

  // Initialize audio if needed
  if (!app.audio) {
    app.audio = new AudioProcessor();
  }

  try {
    await app.audio.initialize();
  } catch (error) {
    console.error('Microphone access denied:', error);
    elements.calibrationTitle.textContent = 'Microphone Access Needed';
    elements.calibrationInstruction.textContent = 'Please allow microphone access to calibrate.';
    return;
  }

  // Create calibration UI
  if (!app.ui.calibration) {
    app.ui.calibration = new HorizonBandUI(elements.calibrationBand);
  }

  // Initialize calibration flow
  app.calibration = new CalibrationFlow(app.audio);

  app.calibration.onStepChange = (step, info) => {
    elements.calibrationTitle.textContent = info.title;
    elements.calibrationInstruction.textContent = info.instruction;

    if (step === CalibrationStep.CONFIRM) {
      showCalibrationConfirm();
    }
  };

  app.calibration.onProgress = (progress, step) => {
    elements.calibrationProgress.style.width = `${progress * 100}%`;

    // Update dot position during calibration to show real-time level
    if (app.audio.isInitialized) {
      const db = app.audio.getCurrentDb();
      const noiseFloor = app.audio.getNoiseFloor();
      // Simple position mapping during calibration
      const normalizedPosition = Math.max(0, Math.min(1, (db - noiseFloor) / 40));
      app.ui.calibration.updatePosition(normalizedPosition);
    }
  };

  app.calibration.onError = (error) => {
    console.error('Calibration error:', error);
    elements.calibrationTitle.textContent = 'Calibration Error';
    elements.calibrationInstruction.textContent = error.message || 'Please try again.';
  };

  app.calibration.onComplete = async (profile) => {
    await app.state.saveProfile(profile);
    updateUIForCurrentState();
  };

  // Start calibration
  await app.calibration.start();
}

function showCalibrationConfirm() {
  showView('confirm');

  // Create confirm UI
  if (!app.ui.confirm) {
    app.ui.confirm = new HorizonBandUI(elements.confirmBand);
  }

  app.ui.confirm.showCalibrationPreview();

  // Show real-time voice level during confirmation
  app.audio.onLevelChange = (level) => {
    if (app.currentView === 'confirm' && app.calibration) {
      const profile = {
        bandLower: app.calibration.normalDb - 3,
        bandUpper: app.calibration.normalDb + (app.calibration.loudDb - app.calibration.normalDb) * 0.6,
      };
      const position = (level.db - profile.bandLower) / (profile.bandUpper - profile.bandLower);
      app.ui.confirm.updatePosition(position);
    }
  };

  app.audio.startMonitoring();
}

async function confirmCalibration() {
  app.audio.stopMonitoring();
  app.audio.onLevelChange = null;

  const profile = app.calibration.confirm();
  await app.state.saveProfile(profile);

  app.calibration = null;
  if (app.ui.confirm) {
    app.ui.confirm.hideCalibrationPreview();
  }

  updateUIForCurrentState();
}

function cancelCalibration() {
  if (app.calibration) {
    app.calibration.cancel();
    app.calibration = null;
  }

  if (app.audio) {
    app.audio.stopMonitoring();
    app.audio.onLevelChange = null;
  }

  updateUIForCurrentState();
}

// ============================================================================
// Monitoring
// ============================================================================

async function startMonitoring() {
  if (!app.audio) {
    app.audio = new AudioProcessor();
  }

  try {
    await app.audio.initialize();
  } catch (error) {
    console.error('Microphone access denied:', error);
    return;
  }

  // Create monitoring UI
  if (!app.ui.monitor) {
    app.ui.monitor = new HorizonBandUI(elements.monitorBand);
  }

  // Initialize feedback manager
  app.feedback = new FeedbackManager(app.state);

  app.feedback.onDriftDetected = (level, message) => {
    app.ui.monitor.showDriftFeedback(level, message);
    elements.monitoringLabel.textContent = message;
  };

  app.feedback.onReturnToRange = (quickCorrection) => {
    app.ui.monitor.clearDriftFeedback();
    elements.monitoringLabel.textContent = quickCorrection ? 'Nice adjustment' : '';
  };

  app.feedback.onConfidenceUpdate = (score) => {
    elements.confidenceValue.textContent = Math.round(score);
    app.ui.monitor.setStage(app.state.getUIStage());
  };

  // Set initial stage
  app.ui.monitor.setStage(app.state.getUIStage());

  // Start audio monitoring
  app.audio.onLevelChange = (level) => {
    if (!app.state.getMonitoring()) return;

    const result = app.feedback.processLevel(level.db, level.isAboveNoiseFloor);
    app.ui.monitor.updatePosition(result.position || 0);
  };

  app.audio.startMonitoring();
  await app.state.setMonitoring(true);

  showView('monitoring');
  updateFooterControls();
}

async function stopMonitoring() {
  if (app.audio) {
    app.audio.stopMonitoring();
    app.audio.onLevelChange = null;
  }

  if (app.feedback) {
    app.feedback.endSession();
    app.feedback = null;
  }

  await app.state.setMonitoring(false);

  showView('idle');
  updateFooterControls();
  updateConfidenceDisplay();
}

async function toggleMonitoring() {
  if (app.state.getMonitoring()) {
    await stopMonitoring();
  } else {
    await startMonitoring();
  }
}

// ============================================================================
// UI State Updates
// ============================================================================

function updateUIForCurrentState() {
  const isCalibrated = app.state.isCalibrated();
  const isMonitoring = app.state.getMonitoring();

  updateContextSelector();

  if (!isCalibrated) {
    showView('uncalibrated');
  } else if (isMonitoring) {
    showView('monitoring');
  } else {
    showView('idle');
    updateConfidenceDisplay();
  }

  updateFooterControls();
}

function updateConfidenceDisplay() {
  const profile = app.state.getCurrentProfile();
  elements.confidenceValue.textContent = Math.round(profile.confidenceScore || 0);
}

function showGuidance() {
  // Re-show the Horizon Band explanation
  if (app.ui.monitor) {
    app.ui.monitor.setStage(UIStage.TRAINING);
    app.ui.monitor.show();
    app.ui.monitor.setMicrocopy('Stay within the band for comfortable conversation');
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  // Initialize state manager
  app.state = new StateManager();
  await app.state.initialize();

  // Apply confidence decay for unused profiles
  await app.state.applyConfidenceDecay();

  // Bind event listeners
  elements.contextSelector.addEventListener('change', handleContextChange);
  elements.btnCalibrate.addEventListener('click', startCalibration);
  elements.btnCancelCalibration.addEventListener('click', cancelCalibration);
  elements.btnConfirmCalibration.addEventListener('click', confirmCalibration);
  elements.btnRedoCalibration.addEventListener('click', startCalibration);
  elements.btnToggleMonitoring.addEventListener('click', toggleMonitoring);
  elements.btnShowGuidance.addEventListener('click', showGuidance);
  elements.btnRecalibrate.addEventListener('click', startCalibration);

  // State change listener
  app.state.onStateChange = () => {
    updateFooterControls();
    updateConfidenceDisplay();
  };

  // Set initial UI state
  updateUIForCurrentState();
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
