/**
 * Hero Companion Preview — a live, working instance of the Floating
 * Companion shown on the homepage hero. Reuses MezzoWaveVisualizer exactly
 * as monitoring.js's real Floating Companion does; the only difference is
 * that zone numbers are hand-fed on a timer here instead of coming from real
 * audio, the same technique monitoring.js's own startDemoMode() already
 * uses for the same reason (MezzoWaveVisualizer is a pure renderer and never
 * reads raw audio itself).
 *
 * Cycles through the product's real states — Quiet / Within Range /
 * Approaching Range / Outside Range, using the same strings monitoring.js's
 * zoneLabel() returns — so this never shows a state that doesn't exist in
 * the product.
 */

import { MezzoWaveVisualizer } from './wave-visualizer.js';

const CYCLE = [
  { zone: 1, holdMs: 3200 },
  { zone: 2, holdMs: 2600 },
  { zone: 3, holdMs: 4200 }, // sustained escalation kicks in after 1s, see below
  { zone: 2, holdMs: 2600 },
  { zone: 1, holdMs: 3200 },
];

const SUSTAINED_DELAY_MS = 1000;

function zoneLabel(zone) {
  if (zone === 0) return 'Quiet';
  if (zone === 1) return 'Within Range';
  if (zone === 2) return 'Approaching Range';
  return 'Outside Range';
}

export function initHeroCompanionPreview(container) {
  if (!container) return;

  container.innerHTML = '';
  container.setAttribute('data-surface', 'dark');
  container.classList.add('hero-companion-card');

  const chrome = document.createElement('div');
  chrome.className = 'hero-companion-chrome';
  chrome.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'hero-companion-dot';
    chrome.appendChild(dot);
  }

  const heading = document.createElement('span');
  heading.className = 'type-state-label hero-companion-label';

  const circleWrap = document.createElement('div');
  circleWrap.className = 'hero-companion-circle-wrap';

  container.appendChild(chrome);
  container.appendChild(heading);
  container.appendChild(circleWrap);

  const circle = new MezzoWaveVisualizer(circleWrap);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    heading.textContent = zoneLabel(1);
    circle.update(1, false);
    return;
  }

  let step = 0;
  let sustainedTimeout = null;
  let stepTimeout = null;

  function runStep() {
    const { zone, holdMs } = CYCLE[step];
    heading.textContent = zoneLabel(zone);
    circle.update(zone, false);

    if (zone === 3) {
      sustainedTimeout = setTimeout(() => circle.update(3, true), SUSTAINED_DELAY_MS);
    }

    stepTimeout = setTimeout(() => {
      if (sustainedTimeout) { clearTimeout(sustainedTimeout); sustainedTimeout = null; }
      step = (step + 1) % CYCLE.length;
      runStep();
    }, holdMs);
  }

  runStep();
}
