# Mezzo

Mezzo helps you notice when you're talking louder than you mean to. It shows a small visual cue that only you can see, so you can lower your voice before anyone else notices.

It runs in your web browser. It measures how loud you are and never listens to what you say.

**Live app:** https://mezzo-one.vercel.app

## Who it's for

Anyone who gets loud without realizing it, for example:

- in open-office huddles
- on calls from a shared desk
- in cafés, lobbies and other shared spaces

## How it works

1. **Allow the microphone.** Mezzo only reads volume levels from it.
2. **Choose a profile.**
   - **Recommended:** uses a typical conversational speaking level.
   - **Custom:** talk at your normal volume for a few seconds so Mezzo learns your own baseline. You can save it under a name and reuse it later.
3. **Start monitoring.** A hand-drawn circle reacts to your voice:

   | You are… | The circle… |
   | --- | --- |
   | Quiet | Shows only the plain center circle |
   | Speaking at a comfortable level | Gains one or two soft gray rings |
   | Louder than your comfortable range | Turns orange and its rings begin to drift slightly |
   | Still too loud after a second | Drifts more noticeably |
   | Back in range | Fades to gray and settles |

Mezzo nudges you instead of sounding an alarm. Nothing flashes or beeps, and the background never changes.

### Pop-out window

You can pop the circle out into a small floating window (picture-in-picture) that stays on top of other apps, such as a video call. Mezzo runs either in the page or in the pop-out, never both at once. Closing the pop-out stops monitoring.

The pop-out uses the Document Picture-in-Picture API, which currently works only in Chromium browsers such as Chrome and Edge.

## Browser extension

The `extension/` folder holds an optional Chrome extension. When you join a Google Meet, Zoom or Microsoft Teams call, it shows a small banner offering to open Mezzo with one click. It only notices that a meeting page is open. It doesn't read, record or send anything from the meeting.

To install it from this repo:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/` folder.

The extension opens the live app at `https://mezzo-one.vercel.app`. To point it at a local copy, change `MEZZO_BASE_URL` in `extension/background.js` and `extension/popup/popup.js`.

## Privacy

- **Audio never leaves your device.** Mezzo processes volume levels in your browser and doesn't record, store, transcribe or send any audio.
- **Saved profiles stay in your browser.** A custom profile is saved only when you click **Save Profile**. It's stored in your browser's local storage and goes nowhere else.
- **Anonymous usage stats.** Mezzo sends four kinds of events to [Mixpanel](https://mixpanel.com): app opened, calibration completed, monitoring started, and a summary of each monitoring session (how long it lasted, whether you used the pop-out, and whether you went over your range). Each browser gets a random ID that isn't linked to you. No names, emails, audio or volume readings are sent.

The full policy is on the in-app privacy page (`privacy.html`).

## Running it locally

Mezzo is plain HTML, CSS and JavaScript with no build step and no dependencies to install. Browsers only allow microphone access over `https://` or on `localhost`, so serve the folder with a local server rather than opening the files directly:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

To keep your own visits out of the usage stats, open any page once with `?debug=true` (for example, `http://localhost:8000/?debug=true`). That browser is excluded from then on.

## Tests

The volume engine has unit tests that use Node's built-in test runner (Node 18 or newer):

```sh
node --test src/engine.test.js
```

`src/engine.browser-test.html` runs the same engine checks in a browser.

## Project layout

| Path | What's there |
| --- | --- |
| `index.html`, `landing.*` | Home page |
| `try-it.*` | Microphone permission, profile choice and calibration |
| `monitoring.*` | Live monitoring page and the pop-out window |
| `privacy.*` | Privacy policy |
| `src/audio.js` | Reads volume from the microphone |
| `src/engine.js` | Sorts volume into zones relative to your baseline (the thresholds are constants at the top) |
| `src/voice-circle.js` | Draws and animates the circle |
| `src/analytics.js` | Anonymous usage events |
| `src/theme.js` | Theme setting: light, dark or match your system |
| `design-tokens/` | Colors, fonts, spacing and component styles |
| `assets/` | Hand-drawn circle and ring artwork, plus icons |
| `design/screenshots/` | Design reference screenshots |
| `extension/` | Chrome meeting-detection extension |
| `sw.js`, `manifest.webmanifest` | Offline support and the files that let Mezzo be installed like an app |
