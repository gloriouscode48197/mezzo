/**
 * User-facing copy rules (CLAUDE.md, "Copy rules"):
 * - no em dashes ("—") in anything a person sees;
 * - "speaking profile(s)" in sentence case, never "Speaking Profile";
 * - the one privacy line under primary actions.
 *
 * Scanned: the visible text and attributes of the site's and extension's
 * HTML pages (comments, scripts and styles removed), and the string
 * literals of the modules that put copy on screen (comments removed, and
 * developer-only console tags like "[Mezzo] …" skipped). CSS inside a
 * string is skipped too.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const HTML_PAGES = ['index.html', 'privacy.html', 'study/index.html', 'extension/popup/popup.html'];
const COPY_MODULES = [
  'src/mezzo-session.js',
  'src/home-dock.js',
  'src/profiles.js',
  'landing.js',
  'extension/popup/popup.js',
  'extension/lib/popup-state.js',
  'extension/content-scripts/meeting-detect.js',
];

function visibleHtml(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '');
}

/** String literals outside comments, as [line, text]. */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out.push([src.slice(0, i).split('\n').length, src.slice(i + 1, j)]);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** The parts of a string literal a person could see. */
function copyOf(text) {
  if (/^\[[A-Za-z]+\]/.test(text)) return ''; // a console tag: developer-only
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments inside CSS/HTML templates
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/[.#\w-]+[^{}]*\{[^{}]*\}/g, ''); // CSS rules
}

function* everyPieceOfCopy() {
  for (const file of HTML_PAGES) {
    const lines = visibleHtml(read(file)).split('\n');
    for (const [i, text] of lines.entries()) yield [`${file}:${i + 1}`, text];
  }
  for (const file of COPY_MODULES) {
    for (const [line, text] of stringLiterals(read(file))) yield [`${file}:${line}`, copyOf(text)];
  }
}

describe('user-facing copy', () => {
  it('has no em dashes', () => {
    const found = [];
    for (const [where, text] of everyPieceOfCopy()) if (text.includes('—')) found.push(`${where}: ${text.trim().slice(0, 80)}`);
    assert.deepEqual(found, []);
  });

  it('writes "speaking profile(s)" in sentence case, never "Speaking Profile"', () => {
    const found = [];
    for (const [where, text] of everyPieceOfCopy()) if (/Speaking Profile|Temporary Profile|Saved Profile/.test(text)) found.push(`${where}: ${text.trim().slice(0, 80)}`);
    assert.deepEqual(found, []);
  });

  it('uses the one privacy line under the Companion\'s primary actions, and no other phrasing', () => {
    const session = read('src/mezzo-session.js');
    const line = 'Mezzo only measures volume. Nothing you say is recorded.';
    assert.equal(session.split(line).length - 1, 2, 'Welcome and Ready');
    assert.doesNotMatch(session, /record audio or transcribe speech/);
    const home = read('index.html');
    assert.ok(home.split(line).length - 1 >= 3, 'Home, granted, and the running page');
  });

  it('catches what it should (the scanner itself)', () => {
    assert.equal(copyOf('Try again — later'), 'Try again — later');
    assert.equal(copyOf('[Mezzo] loaded — frame'), '');
    const css = copyOf('.x { color: red; } /* a — b */ Visible');
    assert.ok(!css.includes('—') && css.includes('Visible'));
    assert.deepEqual(stringLiterals("// no — here\nconst a = 'yes — here';").map(([, t]) => t), ['yes — here']);
  });
});
