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

    const shadow = bannerHost.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          min-width: 320px;
          max-width: 380px;
          padding: 18px 20px;
          background: #F0EBE2;
          border-radius: 14px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          color: #1A1A1A;
        }
        .ring {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 3px solid #C4593A;
          margin-top: 2px;
        }
        .body { flex: 1; min-width: 0; }
        .title {
          font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
          font-size: 16px;
          margin: 0 0 4px;
        }
        .subtitle {
          font-size: 13px;
          line-height: 145%;
          color: #6B6560;
          margin: 0 0 14px;
        }
        .actions { display: flex; align-items: center; gap: 14px; }
        .btn-start {
          font-size: 13px;
          font-weight: 600;
          color: #F0EBE2;
          background: #C4593A;
          padding: 9px 18px;
          border: none;
          border-radius: 100px;
          cursor: pointer;
        }
        .btn-start:hover { background: #AE4D31; }
        .btn-change {
          font-size: 13px;
          color: #6B6560;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
        }
        .btn-change:hover { text-decoration: underline; }
        .btn-dismiss {
          font-size: 13px;
          color: #8A827A;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
        }
        .btn-dismiss:hover { text-decoration: underline; }
        .btn-close {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border: none;
          background: none;
          color: #8A827A;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
        }
        .btn-close:hover { color: #1A1A1A; }
      </style>
      <div class="card">
        <div class="ring"></div>
        <div class="body">
          <p class="title">Meeting Detected</p>
          <p class="subtitle">Monitor with Mezzo?</p>
          <div class="actions">
            <button class="btn-start" type="button">Start</button>
            <button class="btn-change" type="button">Change...</button>
            <button class="btn-dismiss" type="button">Not Now</button>
          </div>
        </div>
        <button class="btn-close" type="button" aria-label="Dismiss">&times;</button>
      </div>
    `;

    shadow.querySelector('.btn-start').addEventListener('click', () => {
      // Open/reuse the companion window, use the last selected profile, and
      // begin monitoring — background.js clears the badge for us too.
      sendMessageSafely({ type: 'OPEN_MEZZO', mode: 'start', focused: false });
      removeBanner();
    });
    shadow.querySelector('.btn-change').addEventListener('click', () => {
      // Open/reuse the companion window and show profile selection first —
      // monitoring does not begin until the user confirms a profile there.
      sendMessageSafely({ type: 'OPEN_MEZZO', mode: 'choose', focused: false });
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
