/**
 * The Privacy page's outline (src/page-outline.js): ids, nesting, and which
 * section counts as "in view".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { slugify, assignHeadingIds, buildOutlineList, activeIndex } from './page-outline.js';

describe('page outline', () => {
  it('slugs are readable and URL-safe', () => {
    assert.equal(slugify('What Mezzo does not do'), 'what-mezzo-does-not-do');
    assert.equal(slugify('Privacy & Data Use'), 'privacy-and-data-use');
    assert.equal(slugify('  Café — résumé!  '), 'cafe-resume');
    assert.equal(slugify('!!!'), 'section');
  });

  it('keeps existing ids, adds the rest, and never duplicates', () => {
    const { document } = parseHTML('<main><h2 id="audio">Audio</h2><h2>Your control</h2><h3>Your control</h3><h2>Audio</h2></main>');
    const ids = assignHeadingIds([...document.querySelectorAll('h2, h3')], document).map((h) => h.id);
    assert.deepEqual(ids, ['audio', 'your-control', 'your-control-2', 'audio-2']);
  });

  it('lists every H2, with its H3s nested beneath, linking to the anchors', () => {
    const { document } = parseHTML('<main><h2>One</h2><h3>One A</h3><h3>One B</h3><h2>Two</h2><h2>Three</h2><h3>Three A</h3></main>');
    const headings = assignHeadingIds([...document.querySelectorAll('h2, h3')], document);
    const list = buildOutlineList(document, headings);
    const top = [...list.children];
    assert.deepEqual(top.map((li) => li.querySelector(':scope > a').textContent), ['One', 'Two', 'Three']);
    assert.deepEqual([...top[0].querySelectorAll('.outline-sublist a')].map((a) => a.getAttribute('href')), ['#one-a', '#one-b']);
    assert.equal(top[1].querySelector('.outline-sublist'), null);
    assert.deepEqual([...top[2].querySelectorAll('.outline-sublist a')].map((a) => a.textContent), ['Three A']);
  });

  it('the section in view is the last heading scrolled past the header; the first before any; the last at the bottom', () => {
    assert.equal(activeIndex([300, 900, 1500], 120, false), 0);
    assert.equal(activeIndex([-400, 100, 700], 120, false), 1);
    assert.equal(activeIndex([-900, -300, 400], 120, true), 2);
    assert.equal(activeIndex([], 120, false), -1);
  });
});
