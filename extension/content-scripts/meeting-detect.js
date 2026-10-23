/**
 * Mezzo — Meeting Detection Content Script
 *
 * Detects when the user is actively in a call on a supported platform and
 * shows a banner, injected directly into the page, offering to launch
 * Mezzo. This script does no monitoring, calibration, or audio processing
 * of any kind — it only looks at the page's own DOM to guess "is a call
 * active right now", the same way any visitor to the page could by looking
 * at the screen. Nothing here reads or transmits meeting content.
 *
 * The banner (not a native OS notification) is deliberate: a real-world
 * test showed the native chrome.notifications banner is too easy to miss
 * (a few seconds, easy to look away from) for something meant to help
 * people remember to use Mezzo. Rendered in a closed Shadow DOM so it
 * can't be affected by — or accidentally affect — the host page's own
 * styles.
 *
 * NOTE ON SELECTORS: these are best-effort heuristics based on publicly
 * documented/observable in-call controls (a "leave/hang up" button).
 * Meet/Zoom/Teams are SPAs that change their own DOM over time — if
 * detection stops firing on a given platform, this is the file to update.
 * Each platform's detectInCall() is isolated so one can be fixed without
 * touching the others.
 *
 * DEBUGGING: this script logs to the console of whichever page/frame it's
 * running in — prefixed "[Mezzo]" so it's easy to filter. Open DevTools on
 * the actual meeting tab (F12, or Cmd+Option+I on Mac) and check the
 * Console tab. Runs in every frame (manifest's all_frames: true), since
 * some platforms nest their in-call UI inside an iframe — expect to see
 * one "[Mezzo] loaded" line per frame.
 */

(() => {
  const PLATFORMS = [
    {
      name: 'Google Meet',
      hostTest: (host) => host === 'meet.google.com',
      detectInCall: () =>
        !!document.querySelector('[aria-label="Leave call"]'),
    },
    {
      name: 'Zoom',
      hostTest: (host) => host.endsWith('.zoom.us') || host === 'zoom.us',
      detectInCall: () =>
        !!document.querySelector(
          '[aria-label="Leave"], [aria-label="Leave Meeting"], [aria-label="End"], .footer__leave-btn, .footer-button__leave-btn'
        ),
    },
    {
      name: 'Microsoft Teams',
      hostTest: (host) => host === 'teams.microsoft.com' || host === 'teams.live.com',
      detectInCall: () =>
        !!document.querySelector(
          '[aria-label="Leave"], [aria-label="Hang up"], #hangup-button'
        ),
    },
  ];

  const platform = PLATFORMS.find((p) => p.hostTest(window.location.hostname));

  if (!platform) {
    console.log(`[Mezzo] no platform match for host "${window.location.hostname}" — script exiting`);
    return;
  }

  console.log(`[Mezzo] loaded for ${platform.name} — frame url: ${window.location.href}`);

  // ===========================================================================
  // Banner
  // ===========================================================================

  const BANNER_HOST_ID = 'mezzo-meeting-banner-host';
  let bannerHost = null;

  function showBanner() {
    if (bannerHost) return; // already showing

    bannerHost = document.createElement('div');
    bannerHost.id = BANNER_HOST_ID;
    bannerHost.style.cssText = 'all: initial; position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';

    loadBannerFonts();
    const shadow = bannerHost.attachShadow({ mode: 'closed' });
    // Lantern, matching the extension popup: a charcoal card, the
    // chartreuse ring from Mezzo's icon, a chartreuse primary button with
    // 3px corners, and a sage text link.
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          width: 340px;
          box-sizing: border-box;
          padding: 16px 16px 18px 18px;
          background: #2D2E31;
          border: 1px solid rgba(243, 235, 222, 0.12);
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
          font-family: "Mezzo Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #F3EBDE;
          -webkit-font-smoothing: antialiased;
        }
        .ring {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          box-sizing: border-box;
          border-radius: 50%;
          border: 3px solid #DEDE65;
          margin-top: 1px;
        }
        .body { flex: 1; min-width: 0; }
        .title {
          margin: 0 0 4px;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.35;
          letter-spacing: -0.01em;
        }
        .subtitle {
          margin: 0 0 14px;
          font-size: 13px;
          line-height: 1.45;
          color: #B0AB9E;
        }
        .actions { display: flex; align-items: center; gap: 16px; }
        button { font-family: inherit; cursor: pointer; }
        .btn-start {
          padding: 9px 16px;
          border: none;
          border-radius: 3px;
          background: #DEDE65;
          color: #2D2E31;
          font-size: 13px;
          font-weight: 500;
        }
        .btn-start:hover { background: #E6E68A; }
        .btn-dismiss {
          padding: 0;
          border: none;
          background: none;
          color: #CEE2C4;
          font-size: 13px;
        }
        .btn-dismiss:hover { text-decoration: underline; }
        .btn-close {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          margin: -4px -4px 0 0;
          padding: 0;
          border: none;
          border-radius: 3px;
          background: none;
          color: #B0AB9E;
        }
        .btn-close:hover { color: #F3EBDE; background: rgba(243, 235, 222, 0.08); }
        button:focus-visible {
          outline: 2px solid #CEE2C4;
          outline-offset: 2px;
        }
      </style>
      <div class="card" role="region" aria-label="Mezzo">
        <div class="ring" aria-hidden="true"></div>
        <div class="body">
          <p class="title">Meeting detected</p>
          <p class="subtitle">Monitor with Mezzo?</p>
          <div class="actions">
            <button class="btn-start" type="button">Open Mezzo</button>
            <button class="btn-dismiss" type="button">Not now</button>
          </div>
        </div>
        <button class="btn-close" type="button" aria-label="Dismiss">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;

    shadow.querySelector('.btn-start').addEventListener('click', () => {
      // Open/reuse the Companion Window at its Ready state — it never
      // auto-starts monitoring, so there's no meaningful distinction left
      // between "start with last profile" and "let me pick a profile"
      // (both land in the same place); background.js clears the badge too.
      // platform: lets Mezzo show its one-time Meet tip (see background.js).
      sendMessageSafely({ type: 'OPEN_MEZZO', focused: false, platform: platform.name });
      removeBanner();
    });
    const dismiss = () => {
      sendMessageSafely({ type: 'MEETING_ACTIVE', active: false });
      removeBanner();
    };
    shadow.querySelector('.btn-dismiss').addEventListener('click', dismiss);
    shadow.querySelector('.btn-close').addEventListener('click', dismiss);

    (document.body || document.documentElement).appendChild(bannerHost);
    console.log(`[Mezzo] banner shown for ${platform.name}`);
  }

  // Geist for the banner. @font-face inside a shadow root isn't applied, so
  // the font is registered on the page itself, under a family name only the
  // banner uses (the page's own fonts are untouched). Falls back to the
  // system font if it can't load.
  let bannerFontsLoaded = false;
  function loadBannerFonts() {
    if (bannerFontsLoaded || typeof FontFace === 'undefined') return;
    bannerFontsLoaded = true;
    try {
      const url = chrome.runtime.getURL('popup/fonts/geist-latin.woff2');
      const face = new FontFace('Mezzo Geist', `url("${url}") format("woff2")`, { weight: '400 600' });
      document.fonts.add(face);
      face.load().catch(() => {});
    } catch { /* system font */ }
  }

  function removeBanner() {
    if (bannerHost) {
      bannerHost.remove();
      bannerHost = null;
    }
  }

  // ===========================================================================
  // Detection
  // ===========================================================================

  function sendMessageSafely(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // Extension context invalidated (e.g. reload mid-call) — nothing to recover.
    }
  }

  // Module-scoped, not persisted anywhere — a fresh script injection (new
  // tab, or a real navigation) naturally means a fresh "meeting", and
  // toggling back to false on leave re-arms the prompt for a rejoin within
  // the same SPA session without needing chrome.storage or any permission.
  let notified = false;

  function checkAndNotify() {
    const inCall = platform.detectInCall();

    if (inCall && !notified) {
      notified = true;
      console.log(`[Mezzo] in-call detected on ${platform.name} — showing banner`);
      showBanner();
      // Ambient cue on the toolbar icon — visible even if the banner itself
      // (or its dismissal) goes unnoticed.
      sendMessageSafely({ type: 'MEETING_ACTIVE', active: true });
    } else if (!inCall && notified) {
      console.log(`[Mezzo] left call on ${platform.name} — re-arming`);
      notified = false;
      removeBanner();
      sendMessageSafely({ type: 'MEETING_ACTIVE', active: false });
    }
  }

  // Meeting platforms are SPAs — the in-call UI can appear well after the
  // initial page load without a full navigation, so watch for DOM changes
  // rather than checking once.
  checkAndNotify();
  new MutationObserver(checkAndNotify).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Heartbeat so it's obvious the script is still alive and what it
  // currently sees, without spamming the console on every DOM mutation.
  setInterval(() => {
    console.log(`[Mezzo] heartbeat — currently in call: ${platform.detectInCall()}`);
  }, 8000);
})();
