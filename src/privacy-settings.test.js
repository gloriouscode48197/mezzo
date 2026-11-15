/**
 * The privacy settings behind privacy.html (2026-11-13): Mixpanel only on
 * Home, with only Mezzo's own events, no cookie and no location from the
 * IP; study parameters out of the address before Mixpanel starts; fonts
 * served from Mezzo's own site, never Google Fonts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Mixpanel', () => {
  const index = read('index.html');

  it('Home: no autocapture or automatic page views, localStorage (no cookie), no IP location, no session replay', () => {
    const init = index.slice(index.indexOf('mixpanel.init('), index.indexOf('})', index.indexOf('mixpanel.init(')));
    assert.match(init, /autocapture: false/);
    assert.match(init, /track_pageview: false/);
    assert.match(init, /persistence: 'localStorage'/);
    assert.match(init, /ip: false/);
    assert.match(init, /record_sessions_percent: 0/);
  });

  it('Home: the study parameters leave the address in a script before the Mixpanel snippet', () => {
    const strip = index.indexOf('window.mezzoStudySearch = url.search');
    const snippet = index.indexOf('window.mixpanel=c');
    assert.ok(strip > 0 && snippet > 0 && strip < snippet);
    assert.match(index, /url\.searchParams\.delete\('study'\);\s*url\.searchParams\.delete\('start'\);/);
  });

  it('Home: the referrer loses its study parameters too, before the Mixpanel snippet; a saved first referrer is cleaned on load', () => {
    const clean = index.indexOf("Object.defineProperty(document, 'referrer'");
    const snippet = index.indexOf('window.mixpanel=c');
    assert.ok(clean > 0 && clean < snippet);
    assert.match(index, /loaded: function \(mp\)/);
    assert.match(index, /mp\.register\(\{ \$initial_referrer: window\.mezzoWithoutStudyParams\(initial\) \}\)/);
  });

  it('Home: off the live site, every event carries $ignore (registered right after init)', () => {
    const init = index.indexOf('mixpanel.init(');
    const ignore = index.indexOf("if (window.location.hostname !== 'mezzo-one.vercel.app') {");
    assert.ok(init > 0 && ignore > init);
    assert.match(index.slice(ignore, ignore + 200), /mixpanel\.register\(\{ \$ignore: true \}\)/);
  });

  it('only Home loads Mixpanel', () => {
    for (const page of ['privacy.html', 'study/index.html', 'try-it.html', 'monitoring.html']) {
      assert.doesNotMatch(read(page), /mxpnl|mixpanel\.init|window\.mixpanel/, page);
    }
  });

  it('src/analytics.js sends only its four events', () => {
    const src = read('src/analytics.js');
    const events = [...src.matchAll(/track\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(events, ['App Opened', 'Calibration Completed', 'Monitoring Started', 'Monitoring Session']);
    assert.match(src, /no cookies/);
  });
});

describe('fonts', () => {
  it('product pages and the Companion never load Google Fonts', () => {
    for (const file of ['index.html', 'privacy.html', 'study/index.html', 'playground/index.html', 'src/mezzo-session.js']) {
      assert.doesNotMatch(read(file), /fonts\.googleapis|fonts\.gstatic/, file);
    }
  });

  it('Geist and Geist Mono are served from /fonts by the tokens stylesheets', () => {
    for (const file of ['fonts/geist-latin.woff2', 'fonts/geist-mono-latin.woff2', 'fonts/OFL.txt']) {
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
    }
    assert.match(read('design-tokens/mezzo-tokens.css'), /url\('\.\.\/fonts\/geist-latin\.woff2'\)/);
    assert.match(read('playground/design-tokens/mezzo-tokens.css'), /url\('\.\.\/\.\.\/fonts\/geist-latin\.woff2'\)/);
  });
});
