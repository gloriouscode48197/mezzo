/**
 * Mezzo — Theme Preference
 *
 * Light / Dark / Follow System, applied via the existing `data-surface`
 * attribute on <body> (already defined in design-tokens/mezzo-tokens.css —
 * this module doesn't introduce any new theming mechanism, just drives the
 * one that's already there).
 *
 * Persisted to localStorage (app-wide, survives across tabs/sessions) since
 * a theme preference is exactly the kind of thing a user expects to stick,
 * unlike the ephemeral per-session profile-selection state.
 */

const THEME_STORAGE_KEY = 'mezzoTheme';
const VALID_THEMES = ['light', 'dark', 'system'];

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

// Other contexts this document creates (namely the PiP window, which has its
// own separate `document` and doesn't share <body> with the main page) need
// to know when the resolved surface changes so they can stay in sync — see
// onThemeChange() below.
const changeListeners = new Set();

/**
 * Get the user's stored preference — 'light', 'dark', or 'system' (default).
 */
export function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Resolve the preference to an actual applied surface ('light' or 'dark').
 */
function resolveSurface(theme) {
  if (theme === 'system') {
    return systemDarkQuery.matches ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Get the currently resolved surface ('light' or 'dark') without applying
 * anything — useful for a newly-created context (e.g. a PiP window) to set
 * its own initial state before subscribing to future changes.
 */
export function getResolvedSurface() {
  return resolveSurface(getTheme());
}

/**
 * Apply the current preference to the document and notify subscribers.
 */
function applyTheme() {
  const surface = resolveSurface(getTheme());
  document.body.setAttribute('data-surface', surface);
  for (const listener of changeListeners) listener(surface);
}

/**
 * Set the user's preference and apply it immediately.
 * @param {'light'|'dark'|'system'} theme
 */
export function setTheme(theme) {
  if (!VALID_THEMES.includes(theme)) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (e.g. private browsing) — still apply for this load.
  }
  applyTheme();
}

/**
 * Subscribe to resolved-surface changes (explicit theme switches, or the OS
 * preference changing while following 'system'). Returns an unsubscribe
 * function.
 * @param {(surface: 'light'|'dark') => void} callback
 * @returns {() => void}
 */
export function onThemeChange(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

// Apply immediately on import.
applyTheme();

// Live-update if the user is following the system preference and it changes.
systemDarkQuery.addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme();
});

// =============================================================================
// Toggle UI
// =============================================================================

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'Auto' };

/**
 * Build a 3-option Light/Dark/Auto segmented toggle inside `container`
 * (an empty element already placed in the page's nav) and keep it in sync
 * with the current preference.
 * @param {HTMLElement} container
 */
export function mountThemeToggle(container) {
  if (!container) return;
  container.classList.add('theme-toggle');
  container.innerHTML = '';

  const buttons = {};
  for (const theme of VALID_THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle-btn';
    btn.textContent = THEME_LABELS[theme];
    btn.setAttribute('aria-label', `${THEME_LABELS[theme]} theme`);
    btn.addEventListener('click', () => {
      setTheme(theme);
      render();
    });
    container.appendChild(btn);
    buttons[theme] = btn;
  }

  function render() {
    const current = getTheme();
    for (const theme of VALID_THEMES) {
      buttons[theme].classList.toggle('active', theme === current);
    }
  }

  render();
}
