# Mezzo — Microphone and Distance Mismatch After Calibration

## Product Requirements Document

**Status:** Proposed<br>
**Implementation status:** Not implemented. Nothing in this document describes shipped behavior. `docs/product-experience.md` must not be updated until it ships.<br>
**Milestone:** V2 (polish over new features). Scoped to the smallest change that prevents the common failure.<br>
**Product:** Mezzo<br>
**Feature area:** Calibration introduction (C1), Calibrating (C2), Ready screen, saved-profile data model

---

## 1. Overview

A speaking profile is only as good as the conditions it was measured in. Mezzo compares live input level to a calibrated speaking level (`speakingDb`/`spreadDb`), and that level depends on the microphone and how far the speaker sits from it. CLAUDE.md already says so: "microphone gain, distance, environment, and speaking level all differ across users and devices."

If a user calibrates on one microphone and monitors on another, or calibrates and then moves closer or farther, every reading after that is shifted. The visualization still behaves consistently, but it's measuring against the wrong reference, so the feedback feels arbitrary. Users usually blame Mezzo, not the setup.

This PRD proposes, in priority order:

1. **Remember which microphone a profile was calibrated with**, and on Ready show a calm, non-blocking note when the current microphone is different, offering **Recalibrate**.
2. **Show the microphone in use while calibrating**, so the user knows which device the profile is being measured on.
3. **One line of seating guidance on C1** ("sit where you'll be during the conversation"), with a help/FAQ entry deferred until Mezzo has a help surface.
4. **No mid-session mismatch heuristic** for V2. §9 explains why.

---

## 2. Problem

### The case this PRD designs for: inattention, not hardware events

Many people have several microphones within reach. The person who raised this has three in their office. A user saves a profile (e.g. "Office") on one mic, and on a later day ends up on another without paying attention to which one is active. Or they keep the same mic but sit closer to it or farther from it than when they calibrated. Mezzo keeps working as designed, but against a reference that no longer fits, so it *feels* less accurate. The user experiences that as Mezzo performing worse, not as a setup change.

Hardware events during a session (a mic unplugged, a Bluetooth device dropping, the OS default switching while monitoring) are **not** what this PRD designs for. They're rare and visible to the user when they happen, and §4.3 covers them only as background.

### Why it happens

- **Choosing a mic is easy and easy to forget.** It can happen in the OS sound settings, by connecting earbuds or a headset, in a meeting app, or in **Chrome's own microphone permission prompt, which includes a microphone picker** (it shows "Use available microphones" with a device dropdown). Mezzo always asks for whatever the browser gives it by default (§4.1), so whichever mic was chosen last, anywhere, is the one Mezzo hears.
- **Mezzo never shows which microphone it's using.** No screen names the device, so a change can't be seen.
- **Distance isn't measurable.** Nothing in the audio signal reliably separates "sat closer" from "spoke louder." Guidance is the only lever here.

### Why it matters for Mezzo specifically

Mezzo's promise is calm, trustworthy awareness. A reference that's quietly wrong produces either persistent Outside range (closer or more sensitive mic, so it feels like nagging) or persistent Listening (farther or less sensitive mic, so it feels broken). Both erode trust faster than any visual flaw.

---

## 3. Goals and Non-Goals

### Goals

- Make a microphone change since calibration **visible** at the one moment it can still be acted on: Ready, before Start monitoring.
- Make the microphone being calibrated **knowable** while calibrating.
- Prevent the distance variant through one line of guidance at the moment of calibrating.
- Add no controls to Monitoring and no blocking steps anywhere.

### Non-goals

- A microphone picker or device selection in Mezzo. Mezzo keeps using the browser and OS default.
- Automatically recalibrating, rescaling, or "correcting" a profile for a different microphone.
- Detecting distance changes.
- Any mid-session prompt, note, or change in Monitoring.
- A help or FAQ section (deferred; see §8.3).
- Per-microphone profiles or multiple calibrations per profile.

---

## 4. Research Findings

### 4.1 How the microphone is acquired today

`src/audio.js`'s `AudioProcessor.acquire()` calls:

```js
navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
```

There is no `deviceId` constraint, so the browser picks its default input. There is exactly one `AudioProcessor` instance per tab (`createMezzoSession()` in `src/mezzo-session.js`), shared by Home's permission probe (`requestMicrophoneAccess()`), calibration (`calibration-controller.js`'s `runCapture()`), and monitoring (`beginMonitoringSession()`). The microphone is acquired fresh for each listening period and fully released after it, so **no microphone is held while Ready is showing**. This is a trust-critical invariant (`audio.js` header) that this PRD must not weaken.

The `AudioProcessor` and its `navigator` belong to the **opener tab's** JS realm, not the Companion's. The Companion's Document Picture-in-Picture window is only rendered into; it never calls `getUserMedia` itself.

Nothing in the codebase currently reads `getSettings()`, `label`, `enumerateDevices()`, `devicechange`, or a track's `ended`/`mute` events.

### 4.2 What the browser exposes (probed)

Probe: headless Chromium 151 via Playwright with `--use-fake-device-for-media-stream`, using Mezzo's exact constraints, in both the opener page and a Document Picture-in-Picture window. Results:

| Question | Observed |
|---|---|
| Track `getSettings().deviceId` when no device is requested | **The literal string `"default"`**, not the physical device's id |
| Track `label` | The default entry's label (in real Chrome, of the form `Default - MacBook Pro Microphone`) |
| `enumerateDevices()` audio inputs | A `"default"` entry plus one entry per physical input, each with `label` and `groupId` |
| `deviceId`s for the same physical device across documents | **Different in every document**: a second page in the same context, a fresh context, and the PiP window each got new hashed ids |
| PiP window has its own `navigator.mediaDevices` | Yes. Its `enumerateDevices()` returns the same labels with *different* `deviceId`s from the opener |
| Opener's live track when the PiP window opens | Stays `live`; unaffected |
| `getUserMedia({deviceId: {exact}})` | Works, but out of scope (no picker) |

Conclusions:

- **`deviceId` cannot identify a microphone across sessions.** The track's own id is `"default"` for everyone. Physical ids are hashed per origin and storage partition, rotate when site data is cleared, and (as observed) differ between the opener and the Companion. A stored `deviceId` would either always match (`"default"`) or never match.
- **The label is the only usable identity.** It's stable across sessions and documents, readable from both the opener and the PiP window, and it's what a user recognizes.
- **The `"default"` label carries a prefix.** Chrome and Edge prefix the default entry's label (`Default - `, and on Windows also a `Communications - ` entry). It must be normalized before storing or comparing (§6.2).
- **Labels need permission.** Before microphone permission is granted, `enumerateDevices()` returns empty labels in real browsers. The probe returned labels before granting, but that's an artifact of `--use-fake-ui-for-media-stream`, not real behavior. In practice Home's permission gate guarantees permission before the Companion opens, so labels should be available on Ready. If they aren't, the state is **unknown** and Mezzo shows nothing.
- **The current default can be read without acquiring the mic.** `enumerateDevices()` needs no active capture. Reading the `"default"` entry's label on Ready tells Mezzo which device the next Start monitoring will get, without turning the mic indicator on.
- **Chrome's per-site mic choice may override the OS default.** Chrome's permission prompt and site settings let the user pick a mic for this site specifically. Unverified: whether an unconstrained `getUserMedia` then returns that chosen mic, and whether `enumerateDevices()`'s `"default"` entry (or first audio input) reflects it. If it doesn't, Ready would compare against the wrong device. Before building, verify which entry matches the track Mezzo actually gets after choosing a non-default mic in that prompt, and compare against that entry (§11 Q3). The picker itself is browser UI: Mezzo can't style, label, or pre-select it, only show the result afterwards.

### 4.3 Hardware events (background only, not designed for)

Mid-session hardware events are out of scope (§2). For the record: `devicechange` fires when inputs are added or removed, but browsers may delay it for hidden documents, and Mezzo's session runs in the opener tab, which is usually hidden. Whether a live `"default"` track follows an OS default change mid-session is unverified. Unplugging the active mic ends the track, and Mezzo has no `ended` listener. None of this is needed for the inattention case, which is settled before Start monitoring.

### 4.4 How profiles are stored

`src/profiles.js` stores the saved library in `localStorage` (`mezzoProfiles`) as a JSON array of `{ id, name, speakingDb, spreadDb, calibratedTs }`. Copies of whole profile objects also live in `mezzoSelectedProfile` (sessionStorage) and `mezzoLastUsedProfile` (localStorage). The unsaved profile is in memory only.

Every write path names its fields explicitly, so a new field must be threaded through each one:

| Function | Today | Change needed |
|---|---|---|
| `addSavedProfile()` | Destructures exactly `name, speakingDb, spreadDb, calibratedTs` | Accept and persist `calibratedMic` |
| `promoteTemporaryProfile()` | Copies only `speakingDb, spreadDb, calibratedTs` | Also copy `calibratedMic` |
| `updateSavedProfile()` | Updates only those three fields | Also update `calibratedMic` (a recalibration's mic replaces the old one, including replacing a known mic with "unknown") |
| `commitSavePromptName()` (update path) | Passes the three fields to `updateSavedProfile()` | Also pass `calibratedMic` |
| `saveSavedProfiles()` | Strips `temporary`, keeps every other field | No change |
| `getSavedProfiles()` | No per-field validation | No change; treats a missing field as unknown |

Upstream, `calibration-controller.js` builds `result: { speakingDb, spreadDb, calibratedTs }`, and `src/mezzo-session.js` builds the temporary shape and both commit paths from it. Those need the same field.

**Migration:** none needed in storage. The field is optional and additive. Existing profiles have no `calibratedMic`, which means "unknown," and Ready shows no note for them. **Do not backfill.** Stamping the current mic onto an old profile would assert a calibration microphone Mezzo never observed. The field fills in naturally the next time the profile is recalibrated or replaced. An older cached build (service worker) writing to the library preserves the field on update, since `updateSavedProfile()` spreads the existing record. It would drop the field only when creating a brand-new profile, which is harmless.

---

## 5. Terminology

No new canonical strings. This PRD reuses **Recalibrate**, **Speaking profile**, and **I'm ready** exactly as defined in CLAUDE.md. "Microphone" is used in copy as a plain word, not a product term. Internal-only: `calibratedMic` (data field), "mic note" (the Ready note below). Neither appears in UI.

---

## 6. Proposal 1 (highest priority): Remember the calibration microphone, note a change on Ready

### 6.1 Behavior

- When a calibration capture completes, Mezzo records the **normalized label** of the track it actually measured as `calibratedMic` on the result. That covers Create speaking profile, Create new profile, and Recalibrate of a saved or unsaved profile. The field carries through to the unsaved profile, and through save, replace, and recalibrate-Replace into the saved profile.
- On Ready, Mezzo reads the label of the browser's current default input (`"default"` entry of the Companion window's `enumerateDevices()`, normalized) **without acquiring the microphone**.
- If the selected profile has a known `calibratedMic` **and** the current label is known **and** the two differ, Ready shows the **mic note**. In every other case, including either side unknown, it shows nothing.
- The note re-evaluates when Ready is shown and when the selection changes. No live device-change listening: the inattention case is settled by checking each time the user arrives at Ready.
- The note is informational. **Start monitoring stays fully available** and unchanged. Nothing is blocked, confirmed, or defaulted differently.

### 6.2 Normalization and comparison (pure helpers in `src/profiles.js`)

- `normalizeMicLabel(label)`: trim; remove a leading `Default - ` or `Communications - `; collapse whitespace; cap at 128 characters; return `null` for an empty result.
- `micLabelsDiffer(a, b)`: `true` only when both are non-null and differ case-insensitively. A null on either side returns `false`, never "differs."
- Two identical-model microphones with the same label compare equal. That's an accepted false negative; silence is the safe failure.

### 6.3 Placement and layout

- The note sits in Ready's existing contextual-actions slot (`.pip-ready-contextual-actions`), between the selector trigger and **Start monitoring**. That keeps CLAUDE.md's fixed Ready order (heading, label, selector, contextual actions, Start monitoring, disclaimer). For a saved profile this slot is empty today, except for a profile saved before the speech-band filter, which shows "Recalibrate to use the improved sound filter."
- **If both notes apply, show only the filter note** ("Recalibrate to use the improved sound filter."). One fresh calibration fixes both, since it uses the new filter and the current mic, so a second note would only repeat the same remedy.
- The slot must reserve the note's height whenever a profile is selected, so the note appearing or disappearing **never moves Start monitoring** (the original Ready PRD's anchoring rule). Window size stays 380×364.
- Not a modal, banner, toast, or full-screen decision state. It's quiet inline text in muted Geist (`--color-text-muted`, like the existing "Recalibrate to use the improved sound filter." note in this slot), with the link in sage (`--color-link`), the Companion's text-link color.

### 6.4 Copy

Recommended (sentence case, descriptive, no judgment):

> Calibrated with {calibrated mic}. Now using {current mic}.
> **Recalibrate**

- **Recalibrate** is a text link using `.pip-ready-contextual-link` and the canonical string. It runs exactly the existing Recalibrate flow for the selected profile. For a saved profile that ends in the existing Replace / Keep temporarily / Discard decision state, so nothing is lost by tapping it. This adds a second entry point next to the selector panel's per-row Recalibrate icon. That's deliberate: the note is useless if the remedy is hidden inside a closed panel.
- Long labels truncate with an ellipsis in the visible text. The full sentence goes in the element's accessible text and `title`.
- Fallback if both names can't fit legibly at 380px (decide in design review):
  > Your microphone has changed since this profile was calibrated.
  > **Recalibrate**

Copy must never use: warning, alert, mismatch, wrong, incorrect, error, "for accurate results," "may be inaccurate," or any icon read as a warning (no ⚠, no red). No chartreuse: inside the Companion it is reserved for the over-range band (`docs/prd/range-ring-and-lantern-refresh.md` §4.2).

### 6.5 Privacy

- `calibratedMic` is a **device label**, not audio. It's stored **only in this browser's `localStorage`**, inside the saved profile record it describes, and goes wherever that record goes (deleted with the profile, cleared with site data). It's never uploaded, synced, or included in analytics events.
- Device labels can contain personal names (e.g. "Alex's AirPods Pro"). That's the main privacy cost of this proposal, and the PRD states it plainly instead of minimizing it. It's the same string the browser already exposes to the page, and it never leaves the device.
- Alternative considered: store a hash of the normalized label instead. That allows comparison without retaining the name, but Ready could only show the fallback copy. Recommended: plain label, because naming the calibration mic is what lets a three-microphone user act on the note. Flagged as an open question (§11).
- The current mic's label on Ready is read live and never stored.
- No change to the privacy disclaimer. CLAUDE.md says not to repeat privacy messaging indiscriminately; the profile-storage description in `docs/product-experience.md` gets one line at ship time.

### 6.6 Tradeoffs

- **Pro:** catches the common failure (the user is on a different mic than the one they calibrated with, without noticing) at the only point it can still be acted on, at near-zero UI cost, without acquiring the mic.
- **Con:** can't catch distance changes or same-label devices. The default seen on Ready could also change in the seconds before Start monitoring. Acceptable; the Calibrating line (Proposal 2) and C1 guidance (Proposal 3) cover the rest.
- **Con:** touches the canonical saved-profile shape. CLAUDE.md's "Canonical Runtime Profile Shapes" must be updated in the same change.

---

## 7. Proposal 2: Show the microphone in use while calibrating

### 7.1 Behavior

- On Calibrating (C2), once capture has started (the same `state.capturing` edge that reveals the meter), show one line of microcopy beneath the meter: **Using {mic}**. The label comes from the live track itself (normalized), which is ground truth for what's being measured.
- C2 is the one screen every calibration path shares: Create speaking profile, Create new profile, and Recalibrate (which skips C1).
- Hidden if the label is unknown. No action attached. Not shown on Monitoring, ever. Monitoring stays free of controls and extra text, per "Keep the product peripheral."

### 7.2 Why not always show the mic on Ready?

Ready is a fixed-size, deliberately sparse checkpoint. Showing the device permanently adds a line nobody needs on most days. Showing it **only when it differs** (Proposal 1) keeps Ready calm and makes the line mean something when it does appear.

### 7.3 Tradeoffs

- **Pro:** makes the measured device visible at the moment of measuring. Cheap. Reads the label from a track Mezzo already holds.
- **Con:** one more line on a screen where the user is speaking. Kept as microcopy below the meter, never animated.

---

## 8. Proposal 3: Seating and distance guidance

### 8.1 C1 (Calibration Introduction)

Add one sentence to C1's body, after the existing sentence:

> Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain. Sit where you'll be during the conversation.

- It's the only proactive lever for the distance variant, and C1 is where every new profile starts.
- Recalibrate skips C1, which is acceptable: those users have read it at least once.
- Must still fit C1 at the shared 380×364 size without wrapping the primary action off-screen. Verify in the existing Playwright sizing specs.

Alternative considered: also say "and with the microphone you'll use." Rejected for C1. It's longer, and Proposals 1 and 2 already handle the microphone case visibly instead of asking users to remember.

### 8.2 Recalibrating after moving

There's no in-product signal for "you moved," so the advice to recalibrate after moving closer or farther doesn't get its own UI. It fits a future help entry (below). The Ready note's **Recalibrate** link and the existing selector Recalibrate already cover the action itself.

### 8.3 Help or FAQ

Mezzo has **no help section today**. Creating one (a new Home section, a page, or something in the Companion) is a new surface, which V2 avoids, and the Companion must stay operational-only. Recommendation: **defer**. When a help surface exists, it should include an entry along these lines:

> **Readings feel off?** Mezzo measures against the speaking level you calibrated, with the microphone and seat you calibrated in. If you switch microphones or move closer or farther, Recalibrate the profile from Ready.

Until then, C1's sentence and the Ready note carry the guidance in-product, where it's actually seen.

---

## 9. Proposal 4: Mid-session heuristic. Not recommended for V2.

Considered: detecting during Monitoring that levels are "consistently far" from calibration and suggesting recalibration.

Recommendation: **don't build it.** Reasons:

- **Consistently above calibration** is exactly what Outside range already communicates, and it's indistinguishable from the user genuinely speaking loudly. A "maybe recalibrate?" suggestion there would undercut Mezzo's core feedback and give users a reason to dismiss it.
- **Consistently below** is indistinguishable from listening. Most of a meeting is other people talking, and Listening is the normal resting state.
- Any mid-session prompt adds text or controls to Monitoring, against "Keep the product peripheral" and "Preserve calm."
- False positives cost trust directly, and Mezzo has no real-world level data to tune against (see CLAUDE.md's "Validation status").

A conservative later candidate, only once real usage data exists: a passive, post-session observation on Ready after Stop (never during Monitoring) if a whole session's speech-segment levels sat far from calibration. It isn't proposed here.

---

## 10. Requirements

### 10.1 Functional

1. Every completed calibration records `calibratedMic` (normalized label of the measured track, or `null`).
2. `calibratedMic` carries through: temporary profile, then Save profile (create), Replace via a matching name, and saved-profile Recalibrate then Replace. Keep as unsaved keeps it on the new unsaved profile and leaves the saved profile's value untouched.
3. Profiles without the field load, display, monitor, recalibrate, save, and delete exactly as today.
4. Ready shows the mic note only when §6.2's comparison returns `true` for the selected profile.
5. The note updates when Ready is shown and on selection change.
6. Reading the current device on Ready never calls `getUserMedia` and never turns on the mic indicator.
7. The note's **Recalibrate** runs the existing Recalibrate flow for the selected profile. No new flow.
8. Start monitoring is never disabled, delayed, or changed by the note.
9. C2 shows **Using {mic}** after capture starts, when known.
10. C1's body gains the seating sentence (§8.1).
11. Monitoring is unchanged.

### 10.2 Accessibility

- The note is plain text in reading order between the selector and Start monitoring. It isn't a live region.
- The full, untruncated sentence is available to assistive tech.
- **Recalibrate** is keyboard-operable, with a specific accessible name, e.g. "Recalibrate {profile name}".
- Meaning doesn't depend on color; no icon is needed.
- C2's **Using {mic}** line isn't announced separately (the existing "Listening for 6 seconds." announcement stays the only one).

### 10.3 Implementation surface (for estimation)

- `src/audio.js`: a read-only getter for the active track's label. No change to acquisition, constraints, or level processing.
- `src/calibration-controller.js`: include `calibratedMic` in the result.
- `src/profiles.js`: thread the field through the functions in §4.4, and add `normalizeMicLabel()`/`micLabelsDiffer()`.
- `src/mezzo-session.js`: temporary shape, both commit paths, Ready note render (reading `pipWindow.navigator.mediaDevices.enumerateDevices()`; add any new DOM refs to `handlePipClose()`'s reset list), C2 line, C1 copy.
- `CLAUDE.md`: update "Canonical Runtime Profile Shapes" to `{ id, name, speakingDb, spreadDb, calibratedTs, calibratedMic? }` and the temporary shape to match.
- `docs/product-experience.md`: only at ship time.

---

## 11. Open Questions

1. **Plain label vs. hash** for `calibratedMic` (§6.5). Recommendation: plain label, local only. **On hold:** product owner leaning plain label, pending their confirmation.
2. **Two-name copy vs. fallback copy** at 380px (§6.4). **On hold:** product owner decides after the Q3 hardware test, using their real mic labels.
3. **Chrome's per-site mic choice** (§4.1–4.2): after picking a non-default mic in Chrome's permission prompt or site settings, which `enumerateDevices()` entry matches the track Mezzo actually gets? Ready must compare against that one. Blocking for implementation.
4. **Windows `Communications - ` entry:** confirm Chrome/Edge on Windows pick the `default`, not `communications`, device for an unconstrained `getUserMedia`, so Ready compares against the right entry.
5. **Unknown on Ready but known at Start monitoring:** if Ready couldn't read labels, should anything happen once the track's label becomes known? Recommendation: no. Monitoring stays untouched.

---

## 12. Related Follow-ups (out of scope)

- **Mid-session hardware events** (mic unplugged, Bluetooth drop): judged not worth designing for at this point; see §4.3.
- **Help/FAQ surface.** See §8.3.

---

## 13. Acceptance Criteria

- A profile calibrated on mic A, with mic A still default: no note on Ready.
- Same profile, default switched to mic B: note shows on Ready with both names (or the fallback copy), and **Start monitoring** sits at exactly the same position as without the note.
- Mic chosen in Chrome's permission prompt or site settings (not the OS default): the note compares against the mic Mezzo will actually use.
- Back on mic A and Ready shown again: no note.
- Profile saved before this change (no `calibratedMic`): no note, ever, until it's next recalibrated and replaced.
- Labels unavailable (empty): no note.
- The note's **Recalibrate**, on a saved profile, reaches the existing Replace / Keep temporarily / Discard decision state. Replace stores the new mic; Keep as unsaved leaves the saved profile's mic untouched.
- Saving an unsaved profile, and replacing via a matching name, both persist its `calibratedMic`.
- The mic indicator stays off throughout Ready, including while the note is evaluated.
- C2 shows **Using {mic}** once capture starts.
- C1 shows the seating sentence and still fits at 380×364.
- Monitoring's DOM, controls, and copy are unchanged.
- `calibratedMic` appears in `localStorage` only inside `mezzoProfiles` records (and the existing profile copies in `mezzoSelectedProfile`/`mezzoLastUsedProfile`), and in no analytics payload.

---

## 14. Testing

**Unit (`npm test`):** `normalizeMicLabel()` (prefixes, whitespace, empty, length cap); `micLabelsDiffer()` (null either side means false; case-insensitive); field round-trip through `addSavedProfile`, `promoteTemporaryProfile`, `updateSavedProfile`, and `commitSavePromptName` (create and update); legacy profiles without the field; analytics payloads never containing it.

**Playwright (`npm run test:pip`):** fake devices make the default `Fake Default Audio Input`, so calibrate normally, then stub the Companion window's `navigator.mediaDevices.enumerateDevices()` to simulate a different mic before Ready renders. Cover note shown/hidden, Start monitoring position unchanged (bounding box), the Recalibrate route, C2's line, and C1's fit. Run with `--workers=1` if flaky, per CLAUDE.md. Never use broad process-kill commands.

**Manual, real hardware (required before Implemented):** on Chrome and Edge, macOS and Windows, with built-in + USB + Bluetooth microphones:

1. Calibrate "Office" on the built-in mic. Switch to the USB mic in OS settings, reopen the Companion: note appears on Ready.
2. Switch instead via Chrome's site mic setting (the same picker the permission prompt shows): note appears and names the mic Mezzo actually hears (answers §11 Q3).
3. Switch back to the built-in mic: no note.
4. Inspect real label formats, including the `Default - ` prefix and USB vendor/product suffixes (input for §11 Q2).

**Before implementation (answers §11 Q3, no Mezzo code needed):** a throwaway test page, kept outside the repo at `~/Documents/mezzo-tools/mic-label-check/index.html` (serve it with `python3 -m http.server 8990` from that folder), opens the mic briefly with Mezzo's exact constraints and shows the live track's label next to every `enumerateDevices()` entry, both from the page and from a Document Picture-in-Picture window (the way Ready would read it). Run it after choosing a non-default mic in Chrome's prompt. Decision rule:

- Track label matches the chosen mic **and** the `default` entry → Ready compares against `default`, as written.
- Track matches the chosen mic but `default` shows the OS default → Ready must compare against whichever entry does match (e.g. the first entry). Revise §6.1 before building.
- Track doesn't match the chosen mic → Chrome's picker doesn't steer Mezzo. Drop the picker from §2's causes.

---

## 15. Guardrails

Do not:

- Add a microphone picker or `deviceId` constraint.
- Store or compare `deviceId`s.
- Acquire the microphone on Ready to check the device.
- Block, delay, or confirm Start monitoring because of the note.
- Use a modal, toast, banner, or full-screen decision state for the note.
- Add anything to Monitoring.
- Use warning, alert, error, or mismatch language, warning icons, or chartreuse in the note.
- Backfill `calibratedMic` on existing profiles.
- Send `calibratedMic` anywhere outside `localStorage`.
- Edit `docs/product-experience.md` before this ships.
