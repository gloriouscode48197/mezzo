# Round 4 Study: User Experience

**Status:** Built on branch `v4` (2026-11-09 to 2026-11-12). Production stays on v3 until the owner switches it in Vercel.
**Settings:** `src/study-config.js`. **Logic:** `src/study.js`. **Surfaces:** `study/index.html`, `src/mezzo-session.js` (`renderStudyCard()`), `src/home-dock.js` (`renderPageCheckIns()`), `index.html` (`.page-checkin`).
**One part since 2026-11-23:** the baseline (Part 1, usual calls without Mezzo) is dropped, and the With Mezzo part is the whole study. Part 1's code and copy stay, off behind `STUDY_CONFIG.includeBaseline: false`; with it off, every tester code is in the With Mezzo stage from the start (`studyStage()`). Sections below describe the study as it runs now; Part 1's own copy and rules are kept, marked "(Part 1, off)", for when the flag is turned back on.
**Canonical behavior:** `docs/product-experience.md`'s "Study Check-In (Round 4)". This doc is the study's own guide: the journey, every surface, the rules, the data and the reasoning, in one place. If the two disagree, the code and product-experience.md win; fix this doc.

---

## 1. The study journey

### From the tester's point of view

1. **Sign-up and screener.** The tester fills in a Tally sign-up and screener. This happens outside Mezzo, and Mezzo has no code for it.
2. **Personal study link.** The researcher sends a link with the tester's code, for example `https://mezzo-one.vercel.app/study?study=R4-01`. Opening it saves the code in this browser and shows `/study`.
3. **"Try Mezzo on your calls".** `/study` opens straight on the one part, with no baseline and no unlock link (2026-11-23). An older link with `&start=1` still works and starts the study's 14 days at that moment.
4. *(Part 1, off.)* With `includeBaseline` on, `/study` would first ask for 2 ordinary calls without Mezzo (the baseline form), and the researcher would then send the unlock link, `/study?study=R4-01&start=1`.
5. **Using Mezzo.** The tester opens Mezzo from `/study` (**Open Mezzo**) or from the extension, calibrates, and monitors on real calls. After each call with enough speech, Mezzo asks "How did your call go?" wherever it's visible. If the tester misses that, they can check in from `/study`.
6. **Wrap-up.** After the tester's 2nd Mezzo check-in, the researcher emails the wrap-up form. It isn't on `/study` (2026-11-14). 14 days after the With Mezzo stage began (the first monitoring session, or `&start=1` if the link had it), Mezzo stops offering the after-call check-in card; `/study`'s **Check in** stays for late check-ins.
7. **After the study.** Mezzo keeps working as usual. The code stays saved but does nothing visible, apart from `/study`, which still shows "Try Mezzo on your calls" and its check-in button. `?study=clear` removes the code and all study data from this browser.

### From the system's point of view

| Step | What Mezzo stores (localStorage, this browser, this site address) | What changes on screen |
| --- | --- | --- |
| `?study=CODE` on any Mezzo page | `mezzoStudyTesterCode` = CODE; the parameter leaves the address bar | `/study` shows the participant view; check-in cards become possible |
| A code, before any session | nothing more | `/study` shows "Try Mezzo on your calls" (Part 1 off). *(Part 1, off: "Part 1: Check in after your usual calls".)* |
| Tester ticks a "Your progress" box | `mezzoStudyMezzoChecks:CODE`, `[check-in 1, check-in 2]` (booleans). Never sent. *(Part 1, off: `mezzoStudyBaselineChecks:CODE`; both ticked shows "You’re done with Part 1. Thank you! I’ll email you Mezzo soon.")* | The box stays ticked for that code |
| `?start=1` (with a code) | `mezzoStudyMezzoStage:CODE` = now | Starts the 14 days now. *(Part 1, off: switches `/study` to "With Mezzo".)* |
| First monitoring session with a code | `mezzoStudyFirstSession:CODE` = its start time, saved when it ends (only if not already set) | Starts the 14 days, if `?start=1` didn't. *(Part 1, off: also switches `/study` to "With Mezzo".)* |
| Each monitoring session | `mezzoStudyLastSession:CODE` = `{ id, startedAt, endedAt, speechMs, glows, view?, window?, handled? }`; the latest one replaces the one before | A check-in card, if the session qualifies |
| Open check-in or Skip this one | `handled: 'opened'` or `'skipped'` on the last session | Every card clears, in this tab and others |
| Day 14 of the With Mezzo stage | nothing | Cards stop; `/study` is unchanged |
| `?study=clear` | every study key, for every code, removed | Back to a non-participant |

The With Mezzo stage's start is whichever is earlier: `?start=1` or the first monitoring session (`getMezzoStageStartAt()`). With Part 1 off, `/study` shows the With Mezzo part before either; the start only matters for the card's 14 days, which count from that moment's **local date**.

---

## 2. Every study surface, state by state

Nothing study-related shows without a tester code, on any surface.

### `/study`

Not linked from anywhere in Mezzo. It has its own look so it's never mistaken for the app (see §6).

| State | What it shows |
| --- | --- |
| No code | "This page is for study participants", how to get in, and links to Mezzo and Privacy |
| Code (the study now) | "Your Mezzo study", the code, the "Before you start" callout, and only "Try Mezzo on your calls": the intro, the count-these box with **Open Mezzo** (outlined) above **Check in** (filled), the same width, "Your progress", "What’s next". Part 1 isn't on the page. The same for the rest of the study, after day 14 too; there is no wrap-up section (it's emailed). |
| *(Part 1, off)* Code, baseline | "Your Mezzo study", the code, the bookmark line, and only "Part 1: Check in after your usual calls": the intro, the count-these box with **Check in** (baseline form), "Your progress" with two boxes, "What’s next". No link into the app. Once With Mezzo began, Part 1 was removed from the page. |

Every participant view ends with a footer: "Questions? Reply to any study email. · **How study data is handled**", the link going to the Privacy page's "Research participants" section.

**Check in** (the With Mezzo part's button) sends the last session's data whenever that session ended within 2 hours, whatever its speaking time. Otherwise it sends only the code and browser ID. Using it marks that session as answered, so no card asks again.

**Open Mezzo** asks the extension (1.0.6+) to open Mezzo. The extension uses its own normal 800×720 window, or brings an open Mezzo forward. Without the extension, the page opens its own 800×720 window at the screen's right edge, or uses this tab if the browser blocks the window.

### The Companion's Ready card

Shown below Ready's privacy line when a check-in is pending (§3). It never covers or disables Start monitoring, and Ready's layout order above it is unchanged. It sits on a panel slightly lighter than the window. **Open check-in** is filled with translucent cream, lighter than Start monitoring, with no chartreuse. **Skip this one** moves focus to Start monitoring. A session ended by closing the window gets its card the next time the Companion opens to Ready. Source: `companion`.

### The "Companion closed" page

Shown after any close other than Close Companion (Meet's mini window, the native ✕). The card sits below **Reopen Companion** and **Done**. **Open check-in** here also ends the call, like Stop, so Reopen then opens to Ready. While a Reopen is continuing the call, the card waits. Source: `companion_closed`.

### The "Keep this page open" page

The card sits below Close Companion, only while the Companion isn't monitoring. It's hidden mid-call, including while Reopen is resuming one. Source: `companion_open`.

### The page after Done or Close Companion

The granted Home, "You're ready to use Mezzo". The card sits below Open Mezzo Companion and the privacy line. It also shows on a later visit while a check-in is still pending. Source: `home`.

All four card surfaces show the same pending check-in, one card per view. Answering it anywhere clears it everywhere.

---

## 3. The rules

| Rule | Value (`src/study-config.js`) | Behavior |
| --- | --- | --- |
| Tester code | `urlParam: 'study'`, `storageKeys.testerCode` | `?study=CODE` on any Mezzo page saves it for the whole site in this browser. Study data is kept per code (`${key}:${code}`), so a new code starts fresh and an old code finds its own data again. |
| Clear | `clearValue: 'clear'` | `?study=clear` removes the code and every code's study data. |
| Part 1 | `includeBaseline: false` (2026-11-23) | Off: every tester code is in the With Mezzo stage from the start. `true` brings back Part 1 and the unlock below. |
| Unlock | `startParam: 'start'`, `startValue: '1'` | With a code, starts the With Mezzo stage now (the 14 days) and remembers it; with Part 1 on, it's also what moves the tester out of Part 1. Without a code it does nothing. |
| Speech minimum | `minSpeechMs: 60000` (1 minute) | A session needs at least 1 minute of speech for a card. There is no minimum session length (removed 2026-11-11). Applies to cards only, not `/study`. |
| Check-in window | `checkInWindowMs: 7200000` (2 hours) | A card shows for 2 hours after the session ends, then leaves on its own, even with the page left open. |
| Once per session | `handled` on the last session | Open or Skip anywhere, including `/study`'s check-in, clears it everywhere, in this tab and other tabs (storage event plus `onCheckInChange()`). |
| Reopen continues the session | `reopenOffer.studySession` | Reopen Companion after an involuntary close continues the same session: it keeps its start time, glows and speaking time, and any check-in answer it already had. |
| Study length | `studyDays: 14` | From the local date the With Mezzo stage began: cards stop. |
| Hidden during monitoring | | The Ready card can't show (Ready isn't visible), and the open page hides its card while monitoring. |
| Hidden without a code | | No card, no `/study` participant view, and nothing stored. |

**What a session is.** It runs from Start monitoring to Stop, a Companion close, or the page closing (`finishStudySession()`, from `teardownMonitoringEngine()` and the page's `pagehide`).

**Speaking time.** The time the circle's noise gate counted the level as voice (`createGlowCounter()`, the same gate verdict monitoring passes the engine). Each frame counts at most 1s, so a stalled tab can't inflate it.

**Glows.** One per move into Outside range, from the zone the engine already committed.

**View and window (2026-11-13).** Each audio frame's time also counts toward the Companion's current view (Expanded, Compact or Mini, its size band) at its current window size, capped at 1s per frame like speaking time. The view with the most time wins, then that view's most-used size. Only read; nothing visible changes. Reopen Companion continues the tally. Kept and sent like the other session data, only with a tester code. Sessions saved before this have neither field.

---

## 4. The data sent to Tally

Mezzo sends nothing itself. The values ride in the form link's query string, and Tally records them only if the tester submits the form.

| Parameter | Meaning | On which forms |
| --- | --- | --- |
| `mezzo_tester` | The tester code | All three |
| `mezzo_browser_id` | The existing anonymous analytics ID (`mezzo_anonymous_id` in localStorage), so sessions from one browser can be grouped | Check-in |
| `mezzo_source` | Where the link was opened from: `companion` (Ready card), `companion_closed` ("Companion closed" page), `companion_open` ("Keep this page open" page), `home` (page after Done or Close Companion), `study_page` (`/study`) | Check-in |
| `mezzo_session_date` | Local date the session started, `YYYY-MM-DD` | Check-in, with a session |
| `mezzo_session_minutes` | Session length, Start to end, in minutes to one decimal (40s is `0.7`) | Check-in, with a session |
| `mezzo_speech_minutes` | Speaking time in minutes, one decimal | Check-in, with a session that recorded it |
| `mezzo_glows` | Moves into Outside range during the session | Check-in, with a session |
| `mezzo_view` | The Companion view used most during the session, by time spent in each: `Expanded`, `Compact` or `Mini` (the size band, from the window's short side) | Check-in, with a session that recorded it |
| `mezzo_window` | That view's window size for most of that time, `WIDTHxHEIGHT` in pixels (e.g. `240x186`) | Check-in, with a session that recorded it |
| `mezzo_minutes_after` | Whole minutes from the session's end to the click on Open check-in (recomputed at the click) | Check-in, with a session |

"With a session" means a card's session, or, from `/study`, the last session if it ended within 2 hours. Otherwise only the first three parameters are sent. The baseline form (`zEN6jg`, Part 1, off) gets `mezzo_tester` only. The wrap-up form (`q5alaO`) is emailed by the researcher, not linked from Mezzo. The check-in form is `gber54`.

**Known quirks**

- **Speech time runs a little long.** The gate stays open about a second after each phrase while the circle eases down, and that tail counts. Many short phrases add up to more than the time actually spoken.
- **Codes are stored per site address and per browser.** The live site and a Vercel preview are different addresses with separate storage, and so are two browsers or profiles. A tester needs their link opened once in each. Each browser also gets its own `mezzo_browser_id` and its own stage dates.
- **Only the last session is kept.** A second call before the first is answered replaces it, so the first can no longer get a card.

---

## 5. Key copy, exactly

**Ready card (Companion)**
- "How did your call go?"
- "2-minute check-in"
- **Open check-in** · **Skip this one**

**Page cards ("Companion closed", "Keep this page open", the page after Done or Close Companion)**
- "Call over? How did your call go?"
- **Open check-in** · **Skip this one**

**"Companion closed" page**
- Status line: "Monitoring is not active"
- "The Companion closed"
- "If you didn't close it, another mini window like Meet's may have. Reopen it to pick up where you left off."
- **Reopen Companion** · **Done**
- "Mezzo only measures volume. Nothing you say is recorded."

**"Keep this page open" page**
- Status line: "Monitoring is not active" / "Monitoring is active"
- "Keep this page open while you use Mezzo"
- "It runs your Companion. You can minimize this window or switch tabs, but closing this page closes the Companion. When you're done, click Close Companion."
- **Close Companion**

**Page after Done or Close Companion**
- "You're ready to use Mezzo"
- "Microphone access is on. Open the Companion to pick a speaking profile and start monitoring."
- **Open Mezzo Companion**
- "Mezzo only measures volume. Nothing you say is recorded."

**`/study`**
- Header: "Mezzo study" · Privacy
- Page heading: "Your Mezzo study", the same in every stage (2026-11-15; was "Thanks for joining the Mezzo study" in Part 1 and "Great, you’re ready for Part 2" in Part 2)
- "Your study code: {code}"
- Under the code: a pale slate-blue callout (the page's one callout, 10% of the header color): "**Before you start:** install the Mezzo Chrome extension. The setup steps are in my “Set up Mezzo” email." (was "“Part 2: set up Mezzo” email" until 2026-11-23). *(Part 1, off: in its place, "Bookmark this page. You’ll come back here after each call.")*
- Every stage shows only the tester's own stage, in one 560px column. The other sections are removed from the page: nothing collapsed, "Completed" or grayed out. The study code, the line under it (bookmark line or callout) and the footer are on every stage.
- *(Part 1, off)* Baseline:
  - "Part 1: Check in after your usual calls"
  - "Take your calls as you normally would, without Mezzo. Check in after at least 2 of them. Come back here after each call. It takes about a minute."
  - In a bordered box: "Only give feedback on calls where:" "you’re wearing headphones" / "people are nearby" / "you speak, even a little", with **Check in** (filled; the same size and style as Part 2's, at least 9rem wide) to the right (below the list on a phone)
  - "Your progress" (small heading), "Check these off to keep track. Your answers already reach me when you submit the form.", two boxes the tester ticks, "Check-in 1" / "Check-in 2" (no submit button). Both ticked: "You’re done with Part 1. Thank you! I’ll email you Mezzo soon." in a pale slate box, led by a small slate check
  - "**What’s next:** after your 2nd check-in, I’ll email you Part 2 with Mezzo." (always visible, ticked or not)
- With Mezzo, the study now (the same after day 14):
  - "Try Mezzo on your calls" (was "Part 2: Check in after a call with Mezzo" until 2026-11-23): "Try Mezzo on your calls over the next week or two. Check in after at least 2 of them."
  - A bordered box, the same list and position as Part 1's ("you’re wearing headphones" / "people are nearby" / "you speak, even a little"). Under the list, in the box, in muted text: "When you stop monitoring, Mezzo asks how your call went. If you miss it, check in here within 2 hours of your call." Where Part 1 has its one button, two of the same width and height, stacked, to the right of the list (below it on a phone): **Open Mezzo** (outlined; the same behavior: the extension's launcher when installed, otherwise its own window), then **Check in** (filled).
  - "Your progress" (small heading), "Check these off to keep track. Your answers already reach me when you submit the form.", two boxes the tester ticks, "Check-in 1" / "Check-in 2" (no submit button), kept apart from Part 1's (off)
  - "**What’s next:** after your 2nd check-in, I’ll email you a short wrap-up form." No thank-you when both boxes are ticked.
- Footer, every participant stage, after a thin divider, in small muted text: "Questions? Reply to any study email. · How study data is handled" (the link goes to the Privacy page's Research participants section)
- No code: "This page is for study participants" / "If you’re in a Mezzo study, open the personal study link you were given." / "Go to Mezzo · Privacy"

---

## 6. Design decisions

- **One part, Part 1 behind a flag (2026-11-23):** the study dropped the baseline, so `/study` opens straight on the With Mezzo part, with a heading that has no number ("Try Mezzo on your calls"), since there's only one part. Part 1 is hidden with `includeBaseline: false` rather than deleted, so it can come back unchanged. The setup callout names the "Set up Mezzo" email without "Part 2". The 14 days now count from the first monitoring session unless the link has `&start=1`. The decisions below about Part 1, Part 2 and the unlock are history from the two-part study.
- **One card wherever Mezzo is visible:** testers look at whichever view they're on after a call, so the check-in follows them instead of living in one place.
- **Cleared everywhere at once:** answering in one place and seeing the card again elsewhere would feel like a bug and invite double submissions.
- **1 minute of speech, no length minimum:** a listen-only call gives nothing to reflect on about one's own volume, but a short call with real speaking does.
- **2-hour window:** recall of a call's volume fades fast. Data from a call hours earlier wouldn't match the tester's memory.
- **Only the last session kept:** testers answer about the call they just had, and it keeps local storage small.
- **Nothing sent unless submitted:** the values ride in a link, so Mezzo itself never transmits session data, which matches its privacy promise.
- **Data per tester code:** a shared or reused browser starting a new code shouldn't inherit someone else's stage or session.
- **Baseline has no way into the app:** baseline calls must be without Mezzo, so the page doesn't tempt the tester.
- **Unlock by link, or the first session:** the researcher controls the switch, and a tester who starts Mezzo anyway is still counted correctly.
- **`/study` has its own look** (white page, slate-blue band and buttons, no cream, charcoal or chartreuse): it's a research page, never to be mistaken for the product.
- **`/study` header scrolls away, no Home link:** it's a short page, and a Home link would lead baseline testers into the app.
- **What counts and what's next, close to the action:** testers asked what counts and when they'd get Mezzo. The bordered box says what counts right by the button, and "What's next" under the tracker says when Mezzo comes, which prevents uncounted calls.
- **"Part 1" and "Part 2" headings:** the numbers tell testers which stage they're in. The page heading, "Your Mezzo study", stays the same on both stages (2026-11-15), so the part heading is the one thing that changes.
- **"Your progress" boxes, never sent (both parts):** (heading renamed from "Your check-ins", 2026-11-14) the forms don't report back to the page, so testers track their own two check-ins; the helper line says the answers already arrive on submit, so nobody waits for the boxes to send anything. The researcher counts real submissions in Tally. "What's next" stays visible whatever is ticked, so the next step is always clear, and there's no submit button because there's nothing to submit.
- **Only the current stage on the page (2026-11-14):** an earlier version showed all three parts, with finished ones collapsed and upcoming ones grayed out. It made the page busier than the one thing testers need to do now. Sections for other stages aren't on the page at all, so Part 1 has no way into Mezzo.
- **Wrap-up by email, not on `/study` (2026-11-14):** it's sent right after the 2nd Mezzo check-in instead of waiting for day 14, so the page no longer needs a wrap-up section, its date rule or a heading change. Part 2 stays as it is for the rest of the study, its check-in there for calls the tester hasn't checked in on yet.
- **Part 1's check-in removed once Part 2 unlocks:** a baseline check-in after someone has used Mezzo would no longer be a baseline.
- **Part 2 in one column, like Part 1 (2026-11-14):** the side-by-side steps made Part 2 look like a different page. One column reads in order, and Part 2 reuses Part 1's box, button and tracker, so testers already know them.
- **Setup callout in Part 2 instead of the bookmark line (2026-11-15):** the setup steps live in the "Set up Mezzo" email (named "Part 2: set up Mezzo" until 2026-11-23), so the page points there once, right under the code, and names the one step that matters before the first call: installing the extension.
- **Part 1 worded like Part 2 (2026-11-14):** both headings say what to do ("Check in after…"), the intro says "without Mezzo" plainly, and both parts share one **Check in** button, the same size and style, so the two stages read as one pattern.
- **Part 2 laid out like Part 1, setup in the email (2026-11-14):** the extension install, the ways to open Mezzo and the card picture moved into the study email, where testers read them once. The page keeps only what repeats after every call, in the same box and place as Part 1, so it's the page they already know. The intro says when the card appears and that `/study` is the fallback within 2 hours. Open Mezzo sits in the box above the check-in, outlined and the same width, so both actions are in one place and the filled check-in stays the main one. The heading, "Part 2: Check in after a call with Mezzo" (now "Try Mezzo on your calls"), named the task, so the button can be a short verb, **Check in** (2026-11-14). `extensionUrl` stays in the config, unused on the page (the store link since 2026-11-23); `study/checkin-card.png` and `tests/capture-study-card.spec.js` stay for the email.
- **"within 2 hours of your call":** it says when the page's check-in still carries the call's data, as a plain rule.
- **Footer with "Reply to any study email":** questions go to the person running the study, without a separate contact address on the page.
- **Check-in card is filled but lighter than Start monitoring:** it should be noticed after a call without competing with the main action, and chartreuse stays reserved for the over-range band.
- **Open check-in on the "Companion closed" page ends the call:** choosing to check in means the call is over, so Reopen shouldn't resume a finished session.
- **Open Mezzo uses the extension's launcher when installed:** the same window size and placement, and never a second Mezzo tab.
- **Extension host permission narrowed to the Mezzo site (1.0.6):** detection runs from the content script's own matches, so broader host access wasn't needed. Less access means a shorter install warning.

---

## 7. Edge cases

- **Closing mid-call (Meet's mini window, or the ✕).** The session ends and is stored; the "Companion closed" page offers Reopen, Done and, if the session qualifies, the card. Reopen continues the same session, and the card waits while it runs. Open check-in there ends the call.
- **Closing the main page mid-call.** `pagehide` records the session. The next time the Companion opens to Ready within 2 hours, its card is there, and so is the card on Home.
- **Ignoring the card.** It stays in every view for 2 hours, then leaves on its own. `/study`'s check-in still works afterward, without session data once 2 hours have passed.
- **Listen-only calls (under 1 minute of speech).** No card. The tester can still check in from `/study`, and if the call ended within 2 hours its data is attached.
- **Two calls in a row before answering.** The second replaces the first as the last session; only the second can get a card.
- **Two browsers.** Each needs the study link opened once. Each has its own `mezzo_browser_id`, stage dates and last session, so the day the cards stop can differ if the browsers started at different times. Opening a link with `&start=1` in both keeps them in step.
- **Live site vs. preview.** Different addresses mean different storage. A code saved on a preview isn't on the live site.
- **A new code in the same browser.** It starts fresh, with no last session (at the baseline, if Part 1 is on); switching back to the old code finds that code's data again.
- **No extension.** Open Mezzo opens a popup window, or this tab if popups are blocked. The page cards and Ready card don't depend on the extension.
- **After day 14.** Cards stop. `/study` is unchanged: "Try Mezzo on your calls" and its check-in button stay.

---

## 8. Open items and the future list

- **Real Meet call with extension 1.0.6** on the v4 preview, before switching production.
- **A "Try again" button when the noisy-room tip shows**, so a tester can recalibrate on the spot after moving closer to the mic instead of finding Recalibrate later.
- **Per-mic calibrations:** profiles measured with one microphone drift when used with another. See `docs/prd/mic-and-distance-mismatch.md` (Proposed, not built).
- **Narrow the extension's content-script matches** (`meet.google.com`, `*.zoom.us`, `teams.microsoft.com`, `teams.live.com`) once real Zoom and Teams calls confirm which hosts the meeting pages actually use.
