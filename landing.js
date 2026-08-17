/**
 * Mezzo — Home / Dock Controller (index.html)
 *
 * index.html is Mezzo, PiP-first: the marketing homepage doubles as Home
 * (before a Companion exists) and the Dock (once one is open) — the same
 * two-state model try-it.html used to own on its own page, now consolidated
 * here so there is exactly one Home/Dock implementation, not two. See
 * src/home-dock.js for the actual state machine (session creation, direct
 * Companion launch, Dock status mapping); this file owns only what's
 * specific to this page's own marketing presentation — scroll-triggered
 * reveals and the initial page fade-in.
 */

import { trackAppOpened } from './src/analytics.js';
import { pageEnter } from './src/page-transition.js';
import { initHomeDock } from './src/home-dock.js';
import { getSavedProfiles } from './src/profiles.js';

// =============================================================================
// Home / Dock
// =============================================================================

initHomeDock({
  stateHome: document.getElementById('state-home'),
  stateUnsupported: document.getElementById('state-unsupported'),
  stateDock: document.getElementById('state-dock'),
  micRequestEl: document.getElementById('mic-request'),
  micGrantedEl: document.getElementById('mic-granted'),
  micDeniedEl: document.getElementById('mic-denied'),
  micDeniedHeadingEl: document.getElementById('mic-denied-heading'),
  btnEnableMicrophone: document.getElementById('btn-enable-microphone'),
  btnOpenCompanion: document.getElementById('btn-open-companion'),
  btnCloseCompanion: document.getElementById('btn-close-companion'),
  dockStatusText: document.getElementById('dock-status-text'),
  baseUrl: new URL('.', window.location.href).href,
});

// =============================================================================
// Blocked-state address-bar illustration — the hostname shown is always the
// real, current runtime host (2026-08-17 redesign), never a hard-coded
// production value: window.location.host is already correct in production,
// every Vercel preview deployment, and local dev alike, with nothing to keep
// in sync by hand. Set once at load, not re-derived per mic-state transition
// — the host cannot change without a full page navigation, so there's
// nothing to react to.
// =============================================================================

const heroAddressBarHost = document.getElementById('hero-address-bar-host');
if (heroAddressBarHost) heroAddressBarHost.textContent = window.location.host;

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

trackAppOpened(getSavedProfiles().length > 0);
