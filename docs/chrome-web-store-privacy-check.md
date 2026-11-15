# Chrome Web Store privacy check (extension 1.0.6, branch v4)

Checked against the code on branch `v4` on 2026-11-13, then the gaps were fixed the same day (see "Fixed since the check", below). Sections 1 to 6 describe the code as first checked; where a fix changed the answer, a **Now:** note says so. Line numbers refer to the code as first checked.

## Fixed since the check (2026-11-13)

- **Mixpanel** (`index.html`):
  - `autocapture: false` and `track_pageview: false`, so the only events are `src/analytics.js`'s four, plus Mixpanel's own `$identify`:
    - `App Opened` (`returning_user`)
    - `Calibration Completed`
    - `Monitoring Started`
    - `Monitoring Session` (`duration_seconds`, `used_pip`, `alert_triggered`)
  - `persistence: 'localStorage'`, so there's no cookie. The `analytics.js` comment now says this and is true.
  - `ip: false`: Mixpanel doesn't estimate location from the IP. It still receives the IP with each request, as any server does.
  - `record_sessions_percent: 0` stays.
  - Verified in a browser with Mixpanel's servers intercepted: requests carry `ip=0`, the only events are `$identify` and `App Opened`, the page address has no `study=`, and no cookie is set.
- **Study parameters:** Home's first script, before the Mixpanel snippet, moves `?study=` and `&start=` out of the address (into `window.mezzoStudySearch`, read by `applyStudyFromLocation()`). Mixpanel never sees them.
- **Privacy page:** Mixpanel removed. It sent no events there, so it only loaded the library.
- **Fonts:** Geist and Geist Mono are self-hosted under `/fonts` (the files the extension already bundles, SIL Open Font License). No product page or the Companion loads Google Fonts. Only old design prototypes in `design/` still link Google Fonts; they aren't product pages.
- **`privacy.html`:**
  - names Mixpanel and its events
  - says there are no cookies and no location from the IP
  - says study fields reach Tally when the survey opens, and that the same ID links check-ins to usage events
  - adds a Chrome extension section
  - names Vercel as the host
- **Extension:**
  - The `storage` permission is removed, and with it the developer address override and the popup's Settings link and panel. The manifest now has no `permissions` key, only `host_permissions` for the Mezzo site.
  - The version stays **1.0.6**: nothing at 1.0.6 has been published to the store, so no bump is required.
- **Tests:** `src/privacy-settings.test.js`, `tests/privacy-settings.spec.js`, and updated extension and privacy-page tests.

## Fixed since the check (2026-11-15)

- **Referrers:** Mixpanel records the page that linked to Home as `$referrer` (each event) and `$initial_referrer` (saved, then sent with every event). A link from a page whose address still held `?study=` or `&start=` would have carried the code there. Home's first script now cleans `document.referrer` the same way it cleans the address, before the Mixpanel snippet, so both properties lose `study` and `start` (other parameters stay). Mixpanel's `loaded` callback also cleans a `$initial_referrer` saved before this fix.
  - `/study` already removes its own `?study=` from the address when it loads, so going from `/study?study=CODE` to Home sent a clean referrer even before this fix. The leak was possible from other pages, such as a study link to `privacy.html`.
  - Tests: `tests/privacy-settings.spec.js` runs Mixpanel's real library (a saved copy of 2.86.0 in `tests/support/`, with every request to Mixpanel answered locally) and checks every property it keeps or sends. It covers `/study?study=TEST-99` then Home, a referrer with `?study=` and `&start=`, and an old saved `$initial_referrer`. Without the fix, the last two fail.
- **`privacy.html`:**
  - Research participants: "Your study code lets me match your check-ins to your sign-up, so I can send your gift card. Anything I quote in my case study stays anonymous."
  - Your control: "If you took part in a study and want your answers deleted, reply to any study email." (No separate contact address: the study emails are the way to reach the researcher.)

Still for you to check (not code):

- ~~The contact email on the privacy page (`[email]` in Your control).~~ Closed: the line now points to the study emails, with no placeholder.

- Mixpanel for `study=` URLs already recorded.
- ~~Whether the Tally forms ask for email or other personal details.~~ Answered: the sign-up screener (`tally.so/r/KpejzD`) asks for first name and email; the check-ins and wrap-up don't. `privacy.html` now says so.
- Vercel's log retention, if you want to state it.
- Returning visitors may still have the old Mixpanel cookie (`mp_…_mixpanel`) from before this change, until it expires or they clear site data.

Two things are separate here, and the store treats them separately:

- **The extension** (`extension/`): what the store's privacy tab is about.
- **The Mezzo web app** (`https://mezzo-one.vercel.app`): what the extension opens. It uses the microphone and analytics. Its data handling belongs in the privacy policy, because the policy covers the whole product.

---

## Summary

- The extension sends nothing anywhere: it makes no network requests and has no analytics. It stores nothing in a store install. It never touches the microphone.
- The web app measures volume in the browser and never records, saves or transcribes audio.
- Two kinds of data do leave the device from the web app:
  1. **Mixpanel analytics**, with `autocapture: true`. It sets a first-party cookie, and the privacy page doesn't name Mixpanel or mention cookies.
  2. **Study check-ins through Tally.** Session figures, including a glow count, ride in the form link. Tally's server receives the link as soon as the form opens, even if it's never submitted.
- One sent field comes from volume: Mixpanel's `alert_triggered` (whether Outside range was reached in a session). The Tally glow count does too. Neither is audio or a volume level, but both come from volume.
- The `storage` permission is only used in unpacked developer installs. A store install never calls it, so you can remove it.
- The privacy page needs updating before you submit, mainly for Mixpanel, cookies, and when Tally receives the link. A draft is in section 4.

---

## 1. Permissions (`extension/manifest.json`)

The manifest is version **1.0.6** (`manifest.json:4`), Manifest V3 (`:2`).

### `permissions: ["storage"]` (`manifest.json:29`)

- **What uses it:** `extension/lib/mezzo-url.js:33-53`. `getBaseUrl()` reads a saved developer address (`mezzoDevBaseUrl`) from `chrome.storage.local`, and `setBaseUrlOverride()`/`clearBaseUrlOverride()` write or remove it.
- **When:** only in an unpacked install. `getBaseUrl()` returns the live site before touching storage when `isUnpacked()` is false (`mezzo-url.js:12-15, 34`). The popup builds its Settings panel only when unpacked (`popup/popup.js:102`). A store install has an `update_url`, so `isUnpacked()` is false there.
- **Now: removed**, with the developer override and the popup's Settings.
- **⚠ Unused in a store install. You can remove it.** Without the permission, `chrome.storage` is undefined. `getBaseUrl()` never reaches it in a store install, and its `try/catch` falls back to the live site anyway (`mezzo-url.js:35-40`). The cost: your unpacked developer copy loses its "point at a preview" setting, unless you keep a separate developer manifest. If you keep it, paste this:
  > Used only to remember a developer-chosen test address in unpacked development builds. Store installs never read or write it.

### `host_permissions: ["https://mezzo-one.vercel.app/*"]` (`manifest.json:31-33`)

- **What uses it:** `extension/lib/mezzo-tabs.js:40-57`. `chrome.tabs.query({ url })` and `tab.url` find a Mezzo tab that's already open, so the extension focuses it instead of opening a second copy (`lib/window-manager.js:46-53`). Chrome only returns tab URLs for sites the extension has host permission for.
- **Justification:**
  > Lets the extension find a Mezzo tab you already have open, so clicking Open Mezzo brings that tab forward instead of opening a duplicate. It only matches Mezzo's own site.

### Content script: `meeting-detect.js` on Meet, Zoom and Teams (`manifest.json:48-58`)

Matches: `https://meet.google.com/*`, `https://*.zoom.us/*`, `https://teams.microsoft.com/*`, `https://teams.live.com/*`, in all frames.

- **What it does** (`content-scripts/meeting-detect.js`):
  - Checks whether a "Leave call" or "Hang up" button exists on the page (`:34-57`, `:252-268`).
  - When one appears, shows an in-page banner, "Meeting detected / Monitor with Mezzo?" (`:75-204`).
  - Asks the background to set a toolbar badge (`:261`).
  - When you click Open Mezzo, sends `OPEN_MEZZO` with your screen's available area (`:190`, `:222-225`), so the window opens on that screen.
- **What it doesn't do:** read meeting content, names, chat, audio or video.
- `all_frames: true` is there because some platforms put their in-call controls inside an iframe (`:28-30`).
- **Justification:**
  > On Google Meet, Zoom and Microsoft Teams web pages, checks whether a "leave call" button is present to tell that you're in a call, then shows a small banner offering to open Mezzo. It doesn't read or send any meeting content.

### Content script: `mezzo-page-bridge.js` on the Mezzo site (`manifest.json:59-63`)

- **What it does** (`content-scripts/mezzo-page-bridge.js:26-60`):
  - Relays two true/false values, `companionOpen` and `monitoring`, from the Mezzo page to the toolbar popup, so the popup can say what's open.
  - Relays `/study`'s "Open Mezzo" request (`MEZZO_OPEN_REQUEST` → `OPEN_MEZZO`), with only the screen area.
- **Justification:**
  > On Mezzo's own site only, passes whether the Mezzo Companion is open and monitoring to the toolbar popup, and lets the Mezzo page ask the extension to open Mezzo in its own window. No volume, audio or profile data is passed.

### `web_accessible_resources`: `popup/fonts/geist-latin.woff2` (`manifest.json:35-45`)

- **What uses it:** `meeting-detect.js:211-220`. It loads the bundled Geist font so the banner matches Mezzo's style. The banner falls back to the system font if loading fails.
- **Justification (if asked):**
  > A bundled font file for the in-page banner's text on the meeting sites.

### Chrome APIs used without a listed permission

No action needed:

- `chrome.action` (badge): `background.js:56-63`
- `chrome.windows.create`, `chrome.windows.update`, `chrome.windows.get`, `chrome.windows.getLastFocused`: `lib/window-manager.js:24`, `lib/mezzo-tabs.js:28-34, 66-74`, `lib/positioning.js:47-50`
- `chrome.tabs.update`/`get`/`create`/`sendMessage`: `lib/mezzo-tabs.js:67`, `positioning.js:47`, `popup/popup.js:90`, `lib/popup-state.js:64`
- runtime messaging

None of these require a manifest permission. The extension doesn't request `tabs`, `scripting`, `notifications` or any `<all_urls>` access.

### Unused permissions

- `storage`, in store installs (see above).
- **Nothing else is unused.**

---

## 2. Microphone

**The extension never uses the microphone.** The `extension/` folder has no `getUserMedia`, `AudioContext` or `mediaDevices` call, and the manifest doesn't request microphone access. `background.js:4-9` says the extension is a launcher only.

**Only the web app uses it:**

- `src/audio.js:136` calls `navigator.mediaDevices.getUserMedia(...)`.
- `src/audio.js:160-170` connects the microphone through a speech-band filter to an `AnalyserNode`, which gives only the current level.
- There is no `MediaRecorder`, speech recognition or audio upload anywhere in `src/`, `landing.js` or the pages.

---

## 3. Data leaving the device

### 3a. Audio and volume

- **Audio is never sent, saved or logged.** Audio samples are only read from the analyser to compute a level (`src/audio.js`). Nothing writes them anywhere.
- **No raw volume level is ever sent.**
- **Derived from volume, and sent:**
  - **Mixpanel `alert_triggered`** (true/false). It's true if the zone reached Outside range at least once in a session. It's set at `src/mezzo-session.js:1023` and sent at `:1124-1128` (`src/analytics.js:116-122`).
  - **Tally `mezzo_glows`, `mezzo_speech_minutes` and `mezzo_session_minutes`**. These are a count of moves into Outside range, the minutes the noise gate counted as speech, and the session length. They go only in study check-in links (`src/study.js:482-498`). See 3b.
- **Saved locally, never sent:** each speaking profile stores calibration numbers (`speakingDb`, `spreadDb`, `peakDb`, `roomNoiseDb`) in `localStorage['mezzoProfiles']` (`src/profiles.js:46`). These are derived values, not recordings.

### 3b. Study mode (v4)

Study mode is only active once a tester code is saved through `?study=CODE` (`src/study.js:34-36, 108-125`). Without a code, nothing below is stored or shown.

**Stored in `localStorage`, on the device only.** All study data except the tester code and browser ID is stored per code, as `key:CODE`.

| Key | What it holds | Where in the code |
| --- | --- | --- |
| `mezzoStudyTesterCode` | the code, e.g. `R4-01` | `study-config.js` storage keys; `study.js:122` |
| `mezzoStudyLastSession:CODE` | the last session only: `{ id, startedAt, endedAt, glows, speechMs, view, window, handled }` | `study.js:283-295` |
| `mezzoStudyFirstSession:CODE` | start time of the first session | |
| `mezzoStudyMezzoStage:CODE` | when `?start=1` unlocked Part 2 | |
| `mezzoStudyBaselineChecks:CODE` | Part 1's two checkboxes; never sent | |
| `mezzo_anonymous_id` | the browser ID, which is the same ID Mixpanel uses (see 3d) | `study.js:160-171`, `analytics.js:15, 44-60` |

`?study=clear` removes all of these except the browser ID (`study.js:68-77`).

**How it leaves:** only as query parameters on a Tally form link, when the tester clicks a check-in or baseline link:

- **Check-in link** (`https://tally.so/r/gber54`, `study-config.js:10`; built at `study.js:482-498`) carries:
  - `mezzo_tester` and `mezzo_browser_id`
  - `mezzo_source`
  - for a recent session: `mezzo_session_date`, `mezzo_session_minutes`, `mezzo_speech_minutes`, `mezzo_glows`, `mezzo_view`, `mezzo_window` and `mezzo_minutes_after`
- **Baseline link** (`tally.so/r/zEN6jg`) carries only `mezzo_tester` (`buildBaselineUrl()`). The wrap-up form (`tally.so/r/q5alaO`) is no longer linked from Mezzo: the researcher emails it (2026-11-14).
- **Who receives it:** Tally, a third-party survey service.
- **⚠ When:** the parameters are in the URL, so Tally's server receives them as soon as the form page loads, even if the tester never submits. The privacy page currently says the survey "records" them only if submitted, which is likely true of the stored response but not of the request. Whether Tally keeps unsubmitted visits is **unverified**: check Tally's documentation or settings.
- **⚠ Unverified:** whether the Tally forms themselves ask for an email address or other personal details. That's form content, not code.

### 3c. What the extension reads from web pages

- **Meeting pages:** only whether certain buttons exist (`meeting-detect.js:37-56`) and the page's hostname, to pick the platform (`:59`).
  - It logs the frame URL to that page's own DevTools console (`:66`), plus a heartbeat every 8 seconds (`:280-283`). Console logs stay on the device. You may want to remove these debug logs before publishing, but they're not data collection.
  - It sends the background only `MEETING_ACTIVE` true/false and, on click, the screen area (`:190, 196, 261, 266`). Nothing is stored or sent off the device.
- **Mezzo site:** tab URLs, only to find Mezzo's Home page (`mezzo-tabs.js:15-25, 40-57`), and the two status values (`mezzo-page-bridge.js:39-45`, see section 1). Nothing is stored or sent.
- **Extension storage:** only the developer address, in unpacked installs (section 1).

### 3d. Analytics, cookies, localStorage and third parties (web app)

**Mixpanel** (third party, analytics)

- **Loaded on:** `index.html:17-26` and `privacy.html:18-27`, from `cdn.mxpnl.com`, with token `022d42ad…`.
- **Not loaded on:** `/study`, or the Companion (the Companion is a separate document).
- **Options:** `autocapture: true`, `record_sessions_percent: 0` (no session replay).
- **Our events** (`src/analytics.js:94-122`):
  - `App Opened` (`returning_user`), from `landing.js:90`
  - `Calibration Completed` (`mezzo-session.js:645`)
  - `Monitoring Started` (`:1109`)
  - `Monitoring Session` (`duration_seconds`, `used_pip`, `alert_triggered`; `:1124-1128`)
- **ID:** `mixpanel.identify()` with `mezzo_anonymous_id` (`analytics.js:72-77`).
- **Opt-out:** `?debug=true` permanently opts a browser out (`analytics.js:22-38`).
- **⚠ Autocapture** also sends Mixpanel's own events. From Mixpanel's documentation, not verified in this code: page views, clicks with element text, and possibly scroll and form events. It also sends default properties: current URL, referrer, browser, OS, screen size, and location (city/country) estimated from the IP address.
- **⚠ Tester code may reach Mixpanel.** If a tester opens Home as `index.html?study=R4-01`, the code is removed from the address bar by `applyStudyFromLocation()` (`src/home-dock.js:153`). But that runs in a module script after the Mixpanel snippet starts loading, so Mixpanel's page view may already carry the code in its current URL. This is a timing race and is **unverified**: check Mixpanel for `study=` in `$current_url`.
- **⚠ Cookie.** The snippet doesn't set `persistence`, so Mixpanel uses its default, a first-party cookie (`mp_<token>_mixpanel`). `analytics.js:5` says "no cookies", and the privacy page doesn't mention cookies. Confirm by checking the browser's cookies on the live site.

**The same ID goes to Mixpanel and Tally.** `mezzo_browser_id` in Tally links is the Mixpanel ID, so a submitted check-in can be matched to that browser's Mixpanel events. The privacy page partly says this ("not shared with other websites, except in a study check-in").

**Google Fonts** (third party)

- Loaded on Home, Privacy and `/study` (`index.html:7-9`, `privacy.html:7-9`, `study/index.html:14-16`), and inside the Companion (`src/mezzo-session.js:1529`).
- Google receives the visitor's IP address and the page as referrer. No cookies.
- The extension bundles its own fonts, so it doesn't use Google Fonts.

**Vercel** (host)

- Serves the static files. There are no serverless functions (no `api/` folder, no `vercel.json`).
- Standard hosting request logs (IP, URL, user agent) are Vercel's. Their retention is **not checked here**.

**Service worker**

- `sw.js` exists but is never registered. No page calls `serviceWorker.register`.

**Other `localStorage` keys (web app)**

| Key | What it holds | Where |
| --- | --- | --- |
| `mezzoProfiles` | saved speaking profiles | `src/profiles.js:46` |
| `mezzoSelectedProfile`, `mezzoLastUsedProfile` | which profile is selected or was last used | `src/profiles.js:47-48` |
| `mezzoHasStartedMonitoring` | whether monitoring has ever started | `src/profiles.js:49` |
| `mezzoCalibrationLock` | `{tabId, acquiredAt}`, so two tabs don't calibrate at once | `src/calibration-lock.js:53` |
| `mezzoTheme` | theme choice | `src/theme.js:14` |
| `mezzo_anonymous_id`, `mezzo_debug_user` | analytics ID and opt-out flag | `src/analytics.js:15-16` |
| study keys | see 3b | |

None of these are sent anywhere except `mezzo_anonymous_id` (Mixpanel, and Tally links).

---

## 4. Store answers

### Privacy tab

**Now:** the extension requests no permissions, so only the host permission and the two content scripts need justifications.

**Single purpose (draft):**
> Mezzo reminds you to keep an eye on your speaking volume in calls. The extension notices when you join a Google Meet, Zoom or Microsoft Teams call and offers to open Mezzo, a web app that shows your volume while you talk.

**Permission justifications:** use the text in section 1.

**Remote code:** **No.** The extension runs only its own packaged files. It doesn't load scripts from anywhere; Mixpanel runs on the website, not in the extension.

**Data usage checkboxes.** Based on the extension's code, **tick none**:

| Category | Tick? | Why |
| --- | --- | --- |
| Personally identifiable information | No | Never read or stored. |
| Health information | No | Never read or stored. |
| Financial and payment information | No | Never read or stored. |
| Authentication information | No | Never read or stored. |
| Personal communications | No | Never read. The script checks only for buttons, never chat, names, audio or video. |
| Location | No | The screen's available area is used to position a window. It's not a location. |
| Web history | No | Only the current tab's hostname, to pick the platform. Nothing is kept or sent. |
| User activity | No | Whether you're in a call is checked from the page and used on the spot (badge, banner). Nothing is kept or sent. |
| Website content | No | Only whether certain buttons exist. Nothing is kept or sent. |

- **⚠ Not certain:** whether Google expects you to declare data that's read and used only on the device. My reading of the store's data policy is that "collection" means data sent off the device or kept, so none applies. If you'd rather be cautious, **User activity** (in-call state) is the most defensible one to tick, described as "used only on the device to show a reminder; never sent or stored."

**The three certifications:**

- **"I do not sell or transfer user data to third parties, outside of the approved use cases."** True for the extension.
- **"I do not use or transfer user data for purposes that are unrelated to my item's single purpose."** True.
- **"I do not use or transfer user data to determine creditworthiness or for lending purposes."** True.

### Privacy policy

- **The extension itself:** probably not strictly required, since it collects no user data. But the store has a privacy policy URL field and reviewers look at it.
- **Recommendation:** link the existing page, `https://mezzo-one.vercel.app/privacy.html`, after updating it. The extension's whole job is to open the web app, which does use the microphone, Mixpanel and Tally, and the page currently doesn't name Mixpanel, cookies, or Google Fonts.

**Now: done.** `privacy.html` has these, with the points to confirm resolved by the fixes above.

**Draft additions and corrections to `privacy.html`** (as first proposed): Plain language; ⚠ marks what you should confirm first.

> **Chrome extension.** The Mezzo extension checks Google Meet, Zoom and Microsoft Teams pages for a "leave call" button to tell when you're in a call, then offers to open Mezzo. It doesn't use your microphone, read meeting content, or send or store any data.
>
> **Anonymous usage data.** Mezzo's website uses Mixpanel, an analytics service, to count visits and a few events: opening Mezzo, finishing calibration, and starting and ending monitoring. For a session, it sends how long it lasted and whether the glow appeared, never audio or volume levels. Mixpanel also records pages viewed and clicks on the website, your browser and device type, and an approximate location (city or country) from your IP address. ⚠ It stores a cookie and a random ID in your browser. Adding `?debug=true` to a Mezzo address turns this off for that browser.
>
> **Fonts.** Mezzo loads its fonts from Google Fonts, so Google receives your IP address when a page loads.
>
> **Research participants** (replacing "If you submit one, the survey also records…"). Opening a check-in sends your study code, your anonymous ID and that session's figures to Tally in the link itself. ⚠ Tally receives them when the form opens. They're saved as a response only if you submit it.

Also fix two existing lines that contradict the above:

- "Data is never shared with third parties, except study check-ins…" should name Mixpanel and Google Fonts too.
- The `analytics.js` comment "no cookies" (comment only).

Optional, outside this report's scope:

- Turn off Mixpanel autocapture, and the race that may send a tester code, which would make the policy simpler.
- Set `persistence: 'localStorage'` to avoid the cookie.

---

## 5. The claim

> "Mezzo measures volume on your device. It never records, saves or transcribes what you say."

**True as written** for the web app:

- **On the device:** volume is measured in the browser, through an `AnalyserNode` (`src/audio.js:160-170`).
- **Never recorded:** there is no recording (`MediaRecorder`), transcription or speech recognition anywhere in the code.
- **Never saved:** only derived numbers are saved: calibration values in profiles, and speaking minutes and glow counts in study mode. These aren't what you say.

Two suggestions:

- **For the extension listing, say what the extension does**, since the extension itself measures nothing:
  > "The Mezzo extension spots when your call starts and opens Mezzo. Mezzo measures your volume in your browser and never records, saves or transcribes what you say."
- **Don't add "nothing leaves your device".** That would be false: Mixpanel's session event includes whether the glow appeared, and study check-ins send glow counts and speaking minutes.

---

## 6. Packaging

The manifest version is **1.0.6** (`extension/manifest.json:4`).

The `extension/` folder has 19 files: the manifest, the background script, 2 content scripts, 5 `lib/` modules, the popup's HTML, CSS and JS, 2 fonts with their license, and 4 icons. There are no tests or developer files inside it.

To build the zip with `manifest.json` at the top level, zip the folder's **contents**, not the folder:

```bash
cd extension && zip -r ../mezzo-extension-1.0.6.zip . -x '.*' && cd ..
```

To check it before uploading (the first line of the listing should show `manifest.json` with no folder prefix):

```bash
unzip -l mezzo-extension-1.0.6.zip
```

Not created yet, as you asked.
