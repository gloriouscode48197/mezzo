/**
 * Where the extension opens Mezzo: always the live site. (A developer
 * override for unpacked installs, and the "storage" permission it needed,
 * were removed for the Chrome Web Store, 2026-11-13. The test suite loads a
 * temporary copy of the extension with this address rewritten instead.)
 */

export const LIVE_BASE_URL = 'https://mezzo-one.vercel.app';

/** The Mezzo site's origin. Async, as callers already await it. */
export async function getBaseUrl() {
  return LIVE_BASE_URL;
}
