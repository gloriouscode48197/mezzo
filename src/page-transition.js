/**
 * Mezzo — Page Transition Utility
 *
 * Smooth fade transitions for cross-page navigation and internal view switching.
 * Uses inline styles to avoid CSS specificity conflicts.
 *
 * Fade-only (no translateY) to avoid triggering scrollbar
 * appearance/disappearance which causes horizontal layout shifts.
 *
 * Setup: Add style="opacity: 0" to each <body> tag, then call pageEnter()
 * from each page's module script.
 */

const FADE_OUT_MS = 300;
const FADE_IN_MS = 350;

let isNavigating = false;

/**
 * Fade in the page on load.
 * Expects body to start with opacity: 0 (set via inline style in HTML).
 * Also sets up the nav scroll behavior (transparent at top, frosted on scroll).
 */
export function pageEnter() {
  requestAnimationFrame(() => {
    document.body.style.transition = `opacity ${FADE_IN_MS}ms ease`;
    requestAnimationFrame(() => {
      document.body.style.opacity = '';

      setTimeout(() => {
        document.body.style.transition = '';
      }, FADE_IN_MS + 50);
    });
  });

  // Nav: transparent at top, frosted background on scroll
  const nav = document.querySelector('.nav');
  if (nav) {
    const SCROLL_THRESHOLD = 16;
    const onScroll = () => {
      nav.classList.toggle('nav-scrolled', window.scrollY > SCROLL_THRESHOLD);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}

/**
 * Navigate to another page with a fade-out transition.
 * @param {string} url — Destination URL
 */
export function navigateTo(url) {
  if (isNavigating) return;
  isNavigating = true;

  document.body.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  document.body.style.opacity = '0';

  setTimeout(() => {
    window.location.href = url;
  }, FADE_OUT_MS);
}

/**
 * Transition between internal views (fade out current, fade in next).
 * @param {Object<string, HTMLElement>} views — Map of view name → element
 * @param {string} nextName — Name of the view to show
 */
export function transitionView(views, nextName) {
  const entries = Object.entries(views);
  const currentEntry = entries.find(([, el]) => !el.classList.contains('hidden'));
  const nextEl = views[nextName];

  if (!currentEntry || currentEntry[1] === nextEl) {
    entries.forEach(([k, el]) => el.classList.toggle('hidden', k !== nextName));
    return;
  }

  const currentEl = currentEntry[1];

  // Fade out current view
  currentEl.style.transition = `opacity ${FADE_OUT_MS}ms ease`;
  currentEl.style.opacity = '0';

  setTimeout(() => {
    currentEl.classList.add('hidden');
    currentEl.style.transition = '';
    currentEl.style.opacity = '';

    // Prepare incoming view (transparent, in final position)
    nextEl.style.opacity = '0';
    nextEl.classList.remove('hidden');

    requestAnimationFrame(() => {
      nextEl.style.transition = `opacity ${FADE_IN_MS}ms ease`;
      requestAnimationFrame(() => {
        nextEl.style.opacity = '';

        setTimeout(() => {
          nextEl.style.transition = '';
        }, FADE_IN_MS + 50);
      });
    });
  }, FADE_OUT_MS);
}
