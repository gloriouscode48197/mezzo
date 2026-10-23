/**
 * Where the extension opens Mezzo. Always the live site, except in a
 * locally loaded (unpacked) copy, where a developer can point it at another
 * deployment, such as a Vercel preview, from the popup's Settings. A store
 * install never reads the override.
 */

export const LIVE_BASE_URL = 'https://mezzo-one.vercel.app';
const OVERRIDE_KEY = 'mezzoDevBaseUrl';

/** True for an unpacked (developer) install: store installs have an update_url. */
export function isUnpacked(chromeApi = globalThis.chrome) {
  const manifest = chromeApi?.runtime?.getManifest?.();
  return !!manifest && !('update_url' in manifest);
}

/**
 * A typed address to a base URL (origin only), or null if it isn't one
 * Mezzo can run on: https anywhere, or http on this machine.
 */
export function normalizeBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input ?? '').trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.origin;
}

export async function getBaseUrl(chromeApi = globalThis.chrome) {
  if (!isUnpacked(chromeApi)) return LIVE_BASE_URL;
  try {
    const stored = await chromeApi.storage.local.get(OVERRIDE_KEY);
    return normalizeBaseUrl(stored[OVERRIDE_KEY]) ?? LIVE_BASE_URL;
  } catch {
    return LIVE_BASE_URL;
  }
}

/** Saves an override (unpacked only). Returns the saved origin, or null if invalid. */
export async function setBaseUrlOverride(input, chromeApi = globalThis.chrome) {
  const origin = normalizeBaseUrl(input);
  if (!origin || !isUnpacked(chromeApi)) return null;
  await chromeApi.storage.local.set({ [OVERRIDE_KEY]: origin });
  return origin;
}

export async function clearBaseUrlOverride(chromeApi = globalThis.chrome) {
  await chromeApi.storage.local.remove(OVERRIDE_KEY);
}
