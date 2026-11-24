# Mezzo

Mezzo helps you notice how loud you're speaking during calls. It shows a calm ring in a small floating window that stays on top of your meeting, so you can glance at it the way you'd glance at a clock.

It isn't a coach and it doesn't score you. Most of the time it just says you're within your usual range. When you go past it, the ring glows.

**Try it:** [mezzo-one.vercel.app](https://mezzo-one.vercel.app)

## How it works

1. **Enable microphone.** Mezzo explains what it uses the microphone for before your browser asks.
2. **Open Mezzo Companion.** A small always-on-top window opens next to your meeting.
3. **Create a speaking profile.** Mezzo listens to the room for 3 seconds, then to your voice for 6. That sets your range for this microphone and this room. You can save up to five profiles (for example "Home office" or "Kitchen") and recalibrate any of them later.
4. **Start monitoring.** The ring shows where your voice sits in your range. It stays quiet while you're within range and glows when you go past it.

Keep the Mezzo page open while you use the Companion. You can minimize it or switch tabs.

## Requirements

Mezzo needs Chrome or Edge on a computer, because the Companion uses Document Picture-in-Picture. Other browsers see a message saying so.

## Privacy

Mezzo only measures volume. Nothing you say is recorded.

- Audio is processed in your browser and never leaves your device.
- Mezzo never records, stores or transcribes speech.
- Speaking profiles are stored in your browser only. There's no account.
- The homepage sends anonymous usage events (for example "Monitoring Started") with no audio, volume or profile data, no cookies and no location.

Full details: [privacy.html](privacy.html), or [mezzo-one.vercel.app/privacy.html](https://mezzo-one.vercel.app/privacy.html).

## Browser extension

**Mezzo: Meeting Volume Reminder** is an optional Chrome extension. It notices when you join a Google Meet, Zoom or Microsoft Teams call in Chrome and offers to open Mezzo. It doesn't read the meeting page beyond that check, and it doesn't store or send anything.

- [Chrome Web Store](https://chromewebstore.google.com/detail/mezzo-meeting-volume-remi/hnjokbmcagbbbcgipkgfjnkmlkmnohhl)
- Source: [`extension/`](extension/)

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `landing.js`, `landing.css` | The Mezzo page: introduction, microphone permission, and the running page while the Companion is open |
| `src/mezzo-session.js` | The Mezzo Companion window, monitoring session and calibration |
| `src/home-dock.js` | The page's state before and after the Companion opens |
| `src/engine.js`, `src/audio.js` | Volume measurement and zones |
| `src/range-ring.js` | The ring visualization |
| `src/profiles.js` | Speaking profiles, stored in the browser |
| `design-tokens/` | Colors, type and spacing |
| `extension/` | The Chrome extension |
| `study/` | The Round 4 user study page |
| `docs/` | Product and UX documentation |
| `tests/` | Browser tests (Playwright) |

There's no build step. The site is plain HTML, CSS and JavaScript modules, deployed on Vercel.

## Running locally

```bash
npm install
```

```bash
PORT=8975 node tests/support/static-server.mjs
```

Then open [localhost:8975](http://localhost:8975). Chrome allows the microphone on localhost.

## Tests

```bash
npm test
```

```bash
npx playwright install chromium
```

```bash
npm run test:pip
```

`npm test` runs the unit tests with Node. `npm run test:pip` runs the browser tests in Chromium with a fake microphone, including the Companion window.

## Documentation

- [`docs/product-experience.md`](docs/product-experience.md): how Mezzo behaves, screen by screen
- [`CLAUDE.md`](CLAUDE.md): working rules, terminology and architecture
- [`docs/ux/round4-study.md`](docs/ux/round4-study.md): the Round 4 study
