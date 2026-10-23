/**
 * Normalizes a computed CSS color to Chrome's legacy rgb()/rgba() form, so
 * assertions compare color values rather than serialization.
 *
 * Colors built with color-mix() (design-tokens/mezzo-tokens.css's
 * translucent role uses) compute as `color(srgb r g b / a)` with 0–1
 * channels, even when they render identically to the old rgba() literal.
 * Anything already in rgb()/rgba() form passes through unchanged.
 *
 * @param {string} computed - a getComputedStyle() color value
 * @returns {string} e.g. 'rgb(220, 156, 137)' or 'rgba(222, 210, 194, 0.92)'
 */
export function normalizeColor(computed) {
  const m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(computed.trim());
  if (!m) return computed;
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => Math.round(Number(c) * 255));
  const a = m[4] === undefined ? 1 : Math.round(Number(m[4]) * 1000) / 1000;
  return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}
