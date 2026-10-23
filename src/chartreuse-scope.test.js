/**
 * Where chartreuse may appear. Inside the product (the Companion and the
 * extension) it is only the Outside range nudge: the Range Ring's
 * over-range band. The website is deliberately out of scope: there it is
 * the brand accent (primary buttons, the "soft glow" highlight, the nav
 * underline, the selection color).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const CHARTREUSE = /#dede65|#e6e68a|--color-accent|--color-on-accent/i;

describe('chartreuse inside the product', () => {
  it('the Companion uses it only in the Range Ring\'s over-range band', () => {
    for (const file of ['src/mezzo-session.js', 'src/level-meter.js']) {
      assert.doesNotMatch(read(file), CHARTREUSE, `${file} uses no chartreuse`);
    }
    // In the ring, only the band's box-shadow references it.
    const ringLines = read('src/range-ring.js').split('\n').filter((l) => CHARTREUSE.test(l));
    assert.ok(ringLines.length > 0);
    for (const line of ringLines) assert.match(line, /var\(--band\)|calc\(var\(--band\)/, `only the band: ${line.trim()}`);
  });

  it('the extension uses none: the popup, the in-Meet banner, and the toolbar badge', () => {
    for (const file of ['extension/popup/popup.css', 'extension/popup/popup.html', 'extension/content-scripts/meeting-detect.js', 'extension/background.js']) {
      assert.doesNotMatch(read(file), CHARTREUSE, `${file} uses no chartreuse`);
    }
  });
});
