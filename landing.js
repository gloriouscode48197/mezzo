/**
 * Mezzo — Landing Page Controller
 *
 * Static marketing page — no permission or calibration logic.
 * Handles scroll-triggered reveals and nav transparency only.
 */

import { trackAppOpened } from './src/analytics.js';
import { pageEnter } from './src/page-transition.js';

// =============================================================================
// Scroll-triggered Reveal
// =============================================================================

const revealEls = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15 },
);

revealEls.forEach((el) => {
  // Hero is already in viewport — reveal immediately on load
  if (el.classList.contains('hero')) {
    requestAnimationFrame(() => el.classList.add('visible'));
  } else {
    revealObserver.observe(el);
  }
});

// =============================================================================
// Init
// =============================================================================

pageEnter();

requestAnimationFrame(() => {
  document.querySelectorAll('.page').forEach((page) => {
    page.classList.add('is-visible');
  });
});

trackAppOpened(false);
