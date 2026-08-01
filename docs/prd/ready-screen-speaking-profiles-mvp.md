# Mezzo — Calibration & Speaking Profiles (Ready Screen)

## Product Requirements Document

**Status:** Approved for implementation<br>
**Implementation status:** Not yet implemented<br>
**Product:** Mezzo<br>
**Feature area:** Calibration, Ready screen, speaking-profile selection, saving, replacement, deletion, and the five-profile cap

---

## 1. Overview

This PRD defines the Mezzo Companion experience from first-time calibration through ongoing Ready-state use.

It covers:

- First-time setup
- Microphone-permission failure
- Voice calibration
- Unsaved speaking profiles
- Saved speaking profiles
- Speaking-profile selection
- Recalibration
- Saving
- Replacement
- Discard
- Deletion
- The five-profile cap
- Post-save and post-replacement confirmation

Once any usable speaking profile exists, Mezzo uses one consistent Ready-screen layout:

1. Ready heading
2. Selected speaking profile directly beneath it
3. Contextual actions beneath the selector
4. **Start monitoring** anchored at the bottom
5. Privacy disclaimer directly beneath the primary action

The layout should remain stable as profile selection changes.

---

## 2. Product Goal

Help users reach monitoring quickly while keeping profile creation and management understandable.

The MVP supports two behaviors:

- Reuse one or more saved profiles.
- Calibrate an unsaved profile for the current Companion session without committing it to a name.

The interface should make the selected profile clear, keep the next monitoring action obvious, and avoid dead ends at the five-profile limit.

---

## 3. Terminology

### Speaking profile

The umbrella term for a voice calibration Mezzo can use as the reference for monitoring.

A speaking profile may be saved or unsaved.

### Saved profile

A named speaking profile stored for reuse.

Examples:

- Kitchen
- Home office
- Coffee shop

A user may save a maximum of five profiles.

### Unsaved profile

A just-calibrated speaking profile that has not been committed to a name.

An unsaved profile:

- Exists only for the current Companion session
- Can be used for monitoring
- Can be recalibrated
- Can be saved
- Can be discarded
- Appears in the same selector as saved profiles
- Disappears when Mezzo closes unless saved

Only one unsaved profile may exist at a time.

### Recalibrate

Run the calibration flow again for the selected profile.

- For an unsaved profile, recalibration replaces the current unsaved calibration.
- For a saved profile, recalibration creates a new calibration and then asks whether to replace the saved one or keep the new result as unsaved.

### Replace

Overwrite an existing saved profile with a newly completed calibration.

### Discard

Remove the unsaved profile from the current Companion session.

---

## 4. Core Product Rules

### Rule 1: Monitoring requires a speaking profile

The user cannot begin monitoring until either:

- An unsaved profile exists, or
- A saved profile exists and is selected

### Rule 2: The selected profile controls monitoring

Monitoring always uses the profile shown in the selector.

Changing the selector updates the contextual actions shown beneath it.

### Rule 3: Unsaved profiles are session-bound

The unsaved profile remains available while the Companion stays open.

It disappears when:

- The user discards it
- The user replaces it by calibrating again
- The Companion closes
- The user saves or replaces a saved profile with it

### Rule 4: Saving is optional

A user may monitor with an unsaved profile without naming or saving it.

### Rule 5: Five saved profiles is the maximum

The cap applies only to saved profiles.

The user may still create and use an unsaved profile when five saved profiles already exist.

### Rule 6: Saved profiles change only after explicit confirmation

Recalibration, replacement, and deletion must not silently alter saved data.

### Rule 7: Completed calibration work should not be discarded unnecessarily

When recalibrating a saved profile, the user may keep the newly completed calibration as the unsaved profile instead of replacing the saved one.

### Rule 8: The Ready layout remains consistent

Once any speaking profile exists:

- The selector stays in the same position
- Contextual actions stay directly below the selector
- **Start monitoring** stays anchored at the bottom
- The privacy disclaimer remains beneath the primary action

---

## 5. Button and Action System

### Primary and secondary buttons

Primary and secondary buttons share:

- Size
- Shape
- Sentence-case labels

Only fill, stroke, and color differ.

### Text links

Text links are:

- Uppercase
- Medium-dark gray
- Shown without button chrome
- Used for lower-emphasis actions

Examples:

- Recalibrate
- Create new profile
- Save profile
- Cancel, where appropriate

### Decision-language rule

Affirmative actions must name their actual consequence:

- **Save** creates a new saved profile
- **Replace** overwrites an existing saved profile
- **Delete** removes a saved profile
- **Keep as unsaved** preserves the new calibration without changing the saved profile

### Privacy disclaimer

Use:

> Mezzo doesn't record audio or transcribe speech.

Placement:

- Directly beneath the primary action
- Center aligned
- Maximum wrap width: 260px

---

## 6. First-Time Experience

### State 01 — No Reference Profile

#### Purpose

Introduce Mezzo and direct a first-time user into calibration.

#### Content

**Heading:** Welcome

**Body:**<br>
Mezzo listens in the background and gently lets you know if you're talking louder than you'd like. We'll start with a quick voice calibration.

**Primary action:** Create speaking profile

Include a microphone icon.

**Disclaimer:**<br>
Mezzo doesn't record audio or transcribe speech.

#### Behavior

Selecting **Create speaking profile** opens C1.

Monitoring is unavailable from this state.

---

### State C1 — Calibration Introduction

#### Content

**Heading:** Create speaking profile

**Body:**<br>
Talk for a few seconds so Mezzo can learn the speaking level you'd like to maintain.

**Primary action:** I'm ready

#### Behavior

Selecting **I'm ready** begins C2.

---

### State C2 — Active Calibration

#### Content

**Heading:** Keep speaking at the level you want to maintain

**Status:** Listening… 6s

#### Visualization

Display:

- A six-second countdown
- An orange horizontal volume bar
- Live fill proportional to detected vocal input
- A scale sized to a realistic vocal range

The visualization should communicate active measurement without implying recording or transcription.

#### Behavior

- Calibration lasts six seconds.
- When calibration completes, Mezzo creates an unsaved profile unless this is a saved-profile recalibration flow.
- A newly created unsaved profile becomes selected.

---

### State C0 — Microphone Access Blocked

#### Trigger

This state may occur before or during calibration when microphone access is denied or unavailable.

#### Content

**Heading:** Your browser has blocked microphone access.

**Body:**<br>
Click the icon in your address bar and change the microphone setting to “Allow,” then reload this page.

#### Visual support

Show an annotated browser-address-bar illustration identifying where the user should restore microphone access.

#### Behavior

- Calibration cannot continue.
- The user must restore access and reload.
- Chrome-style guidance is acceptable for the MVP.
- Browser-specific guidance remains an open implementation item.

---

## 7. Ready-Screen Structure

The Ready screen is used whenever at least one usable profile exists.

### Layout order

1. Ready heading
2. “Speaking profile” label
3. Always-visible selector
4. Contextual actions for the selected profile
5. **Start monitoring**
6. Privacy disclaimer

### First-conversation rule

Show:

**Ready for your first conversation**

until the user starts monitoring for the first time.

Do not change this copy merely because the user:

- Saves a profile
- Recalibrates
- Switches profiles
- Opens or closes a decision state
- Closes and reopens Mezzo before starting monitoring

After monitoring has started for the first time, all future Ready states use:

**Ready for your next conversation**

This condition should persist across Companion restarts.

### Anchoring rule

**Start monitoring** remains anchored at the bottom regardless of:

- Selected profile type
- Selector state
- Number of saved profiles
- Presence of an unsaved profile

---

## 8. Unsaved-Profile Ready States

### State 03 — First Unsaved Profile

#### Trigger

- The user has completed their first calibration.
- No saved profiles exist.
- Monitoring has never been started.

#### Heading

Ready for your first conversation

#### Selector

Unsaved profile

#### Contextual actions

- Recalibrate
- Save profile

#### Primary action

Start monitoring

#### Behavior

- **Recalibrate** runs calibration again and replaces the unsaved profile.
- **Save profile** opens M2.
- **Start monitoring** begins monitoring with the unsaved profile.

---

### State 04 — Unsaved Profile Below the Cap

#### Trigger

- An unsaved profile exists and is selected.
- Fewer than five saved profiles exist.
- First-conversation copy no longer applies.

#### Heading

Ready for your next conversation

#### Contextual actions

- Recalibrate
- Save profile

#### Behavior

- Recalibration replaces the unsaved profile.
- Saving opens M2.
- Switching to a saved profile does not remove the unsaved profile.

---

### State 04a — Unsaved Profile at the Cap

#### Trigger

- An unsaved profile exists and is selected.
- Five saved profiles already exist.

#### Contextual actions

- Recalibrate
- Save profile

#### Behavior

- **Save profile** remains visible.
- Selecting it opens M3.
- The unsaved profile remains available for monitoring.
- M3 does not provide replacement or management controls.

---

## 9. Saved-Profile Ready States

### State 02 — Saved Profile Selected

#### Trigger

- A saved profile is selected.
- Fewer than five saved profiles exist.

#### Contextual actions

- Recalibrate
- Create new profile

#### Behavior

- **Recalibrate** begins calibration for the selected saved profile.
- **Create new profile** begins calibration and produces an unsaved profile.
- **Start monitoring** uses the selected saved profile.

**Create new profile** describes the user’s goal. The intermediate calibration result remains unsaved until named and saved.

---

### State 02a — Post-Save Confirmation

#### Trigger

A user successfully creates a new saved profile from M2.

#### Behavior

1. Show a brief processing state on the Save action.
2. Prevent duplicate submission.
3. Create the saved profile.
4. Remove the unsaved profile.
5. Return to Ready with the new saved profile selected.
6. Show a transient toast.

#### Toast

Profile “[Name]” saved

#### Placeholder timing

- Processing: approximately 1 second
- Toast: approximately 2 seconds

The toast must not shift the layout or block Ready controls.

---

### State 02b — Post-Replacement Confirmation

#### Trigger

A user successfully replaces an existing profile through M2a.

#### Behavior

1. Show the same processing treatment as a normal save.
2. Replace the matching saved profile’s calibration.
3. Remove the unsaved profile.
4. Return to Ready with the replaced saved profile selected.
5. Show a transient toast.

#### Toast

Profile “[Name]” replaced

Use the same timing and visual treatment as the post-save toast.

---

### State 07 — Five Saved Profiles, No Unsaved Profile

#### Contextual action

- Recalibrate

#### Removed action

Do not show **Create new profile**.

#### Rationale

At the cap, beginning a new profile from this state would immediately lead to a save dead end.

---

### State 07c — Five Saved Profiles, Unsaved Profile Exists but Is Not Selected

The visible Ready screen matches state 07.

The selector also includes the unsaved profile.

Selecting it changes the screen to state 04a.

---

## 10. Selector and Profile Management

### State 05 — Selector Expanded, Saved Profiles Only

#### Dropdown

Section:

**Saved profiles**

Each row includes:

- Profile name
- Selected indicator where applicable
- Delete icon

#### Behavior

- Selecting a row changes the selected profile.
- The dropdown closes after selection.
- Monitoring does not begin automatically.
- Delete opens 06b.

---

### State 06 — Selector Expanded, Unsaved and Saved Profiles

#### Dropdown structure

**Unsaved**

- Unsaved profile
- Selected indicator where applicable
- Discard action

Supporting note:

**Disappears when you close Mezzo**

Divider

**Saved profiles**

- Saved-profile rows
- Selected indicator where applicable
- Delete action

#### Behavior

Selecting a row:

- Changes the selected profile
- Closes the dropdown
- Updates contextual actions
- Does not start monitoring

#### Discard behavior

No confirmation is required for the MVP.

If saved profiles remain:

- Remove the unsaved profile.
- Select the most recently used saved profile.
- Return to the saved-profile Ready state.

If no saved profiles remain:

- Remove the unsaved profile.
- Return to state 01.

The discard control must have an accessible label such as:

**Discard unsaved profile**

---

### State 06b — Delete Confirmation

#### Presentation

Use a dedicated full-screen dark decision state.

Do not use:

- An in-dropdown confirmation
- A floating dialog over the dropdown
- A browser-native confirmation

#### Content

**Heading:** Delete “[Name]”?

**Body:**<br>
This permanently removes the saved speaking profile. This can't be undone.

**Actions:**

- Cancel
- Delete

#### Behavior

- **Cancel** returns with no changes.
- **Delete** permanently removes the saved profile.
- If the deleted profile was selected, select:
  1. The unsaved profile, if one exists
  2. The most recently used remaining saved profile
  3. State 01, if no profiles remain

---

## 11. Save and Replace States

These states use a full-bleed dark decision surface.

### State M1 — Confirm Saved-Profile Recalibration

#### Trigger

A user recalibrates a saved profile and completes calibration.

#### Content

**Heading:** Replace existing “[Name]” profile?

**Body:**<br>
Replace the saved calibration with the one you just created?

**Actions:**

- Keep as unsaved
- Replace

#### Behavior

**Replace:**

- Overwrite the selected saved profile.
- Keep its name.
- Remove any previous unsaved profile.
- Return to Ready with the saved profile selected.

**Keep as unsaved:**

- Leave the saved profile unchanged.
- Preserve the newly completed calibration as the unsaved profile.
- Select the unsaved profile on return.
- Keep the saved profile available in the selector.

Nothing is discarded.

---

### State M2 — Name New Profile

#### Trigger

The user selects **Save profile** while fewer than five saved profiles exist.

#### Content

**Heading:** Name this profile

**Input placeholder:** e.g. Coffee Shop

**Actions:**

- Cancel
- Save

#### Behavior

- **Cancel** preserves the unsaved profile.
- **Save** is unavailable until a valid name is entered.
- A unique valid name creates a saved profile.
- The new saved profile becomes selected.
- The unsaved profile is removed.
- State 02a appears.

---

### State M2a — Name Already Exists

#### Trigger

The user enters a name matching an existing saved profile.

#### Content

**Heading:** Name this profile

**Warning:**<br>
A profile named “[Name]” already exists.

**Actions:**

- Cancel
- Replace

#### Behavior

- The primary action changes from **Save** to **Replace**.
- Changing the input to a unique name restores **Save** and removes the warning.
- **Replace** overwrites the matching saved profile with the unsaved calibration.
- The unsaved profile is removed.
- The matching saved profile becomes selected.
- State 02b appears.
- M2a does not route through M1 because replacement is already explicit here.

---

### State M3 — Five-Profile Limit Reached

#### Trigger

The user selects **Save profile** while five saved profiles already exist.

#### Content

**Heading:** 5 of 5 profiles saved

**Body:**<br>
Delete a saved profile before saving this one.

**Action:**

- Close icon only

#### Behavior

- No management controls appear inside M3.
- Closing returns to Ready with the unsaved profile selected and preserved.
- The user must:
  1. Open the selector
  2. Delete a saved profile
  3. Return to the unsaved profile
  4. Select **Save profile** again
  5. Complete M2

M3 must not mention replacement because it does not offer a replacement path.

---

## 12. State Transitions

### First-time path

01 → C1 → C2 → 03 → Monitoring

### Create a new profile from a saved state

02 → C1 → C2 → 04

### Save below the cap

Unsaved profile → Save profile → M2 → Save → processing → saved-profile Ready state + saved toast

### Save at the cap

Unsaved profile → Save profile → M3 → close → selector → delete saved profile → return to unsaved profile → Save profile → M2

### Recalibrate and replace a saved profile

Saved profile → Recalibrate → calibration → M1 → Replace → saved-profile Ready state

### Recalibrate without replacing

Saved profile → Recalibrate → calibration → M1 → Keep as unsaved → unsaved-profile Ready state

### Replace through an existing name

Unsaved profile → Save profile → M2 → enter existing name → M2a → Replace → saved-profile Ready state + replacement toast

### Discard with saved profiles available

Unsaved profile → selector → Discard → most recently used saved profile selected

### Discard with no saved profiles

Unsaved profile → selector → Discard → state 01

### Delete a saved profile

Selector → Delete → 06b → Ready with fallback selection

---

## 13. Functional Requirements

### Calibration

- Runs for six seconds.
- Displays a countdown.
- Shows live proportional volume feedback.
- Creates or replaces one unsaved profile.
- Routes permission failures to C0.

### Unsaved profile

- Zero or one may exist.
- It persists while Mezzo remains open.
- It appears above saved profiles.
- It can be selected, monitored, recalibrated, saved, or discarded.
- It is not counted toward the five-profile cap.
- It is preserved when switching to a saved profile.

### Saved profiles

- Zero to five may exist.
- Each has a unique name.
- Each can be selected, recalibrated, replaced, or deleted.
- Matching an existing name triggers M2a.

### Selector

- The selected profile is always visible.
- Unsaved and saved profiles are grouped separately.
- The Unsaved section is omitted when none exists.
- Delete and discard actions are available in-row.
- Selecting a row updates contextual actions.
- **Start monitoring** remains anchored at the bottom.

### First-conversation state

- Persists until the first monitoring session starts.
- Is not cleared by saving, recalibrating, switching profiles, opening decision states, or restarting Mezzo before monitoring.

### Saving and replacement

- Save requires a valid unique name.
- Existing-name detection changes **Save** to **Replace**.
- Replacement shows an inline warning.
- Canceling preserves the unsaved profile.
- Successful save or replacement removes the unsaved profile.
- Save and replacement use consistent processing and toast feedback.

### Deletion and discard

- Saved-profile deletion requires 06b.
- Unsaved-profile discard requires no confirmation.
- Both routes define a valid fallback selection.

### Post-session acknowledgments

Approved conceptually but deferred from this implementation phase.

Do not:

- Add rotating messages
- Reserve layout space for them
- Include them in implementation acceptance criteria

They will be designed as a separate Ready-state enhancement.

---

## 14. Acceptance Criteria

### First-time experience

- With no profile, Mezzo opens in state 01.
- Calibration creates an unsaved profile.
- The first Ready state says **Ready for your first conversation**.
- That copy persists until monitoring starts for the first time.

### Ready layout

- The selector remains directly beneath the heading.
- Contextual actions remain below the selector.
- **Start monitoring** remains anchored at the bottom.
- Profile switching does not restructure the screen.

### Unsaved profiles

- The user can monitor without saving.
- The unsaved profile persists across monitoring stops and profile switching.
- It disappears when Mezzo closes.
- Discard immediately removes it.
- Discard routes to a saved profile or state 01.

### Saved profiles

- A saved profile shows **Recalibrate**.
- **Create new profile** appears only below the cap.
- At the cap, it is absent.

### Saving

- A unique name creates a new saved profile.
- Duplicate submission is prevented.
- The saved profile becomes selected.
- The saved toast displays and auto-dismisses.

### Existing name

- A matching name shows the inline warning.
- **Save** becomes **Replace**.
- Replacement updates the matching profile.
- The replaced profile becomes selected.
- The replacement toast displays and auto-dismisses.

### Recalibration

- Recalibrating an unsaved profile replaces it.
- Recalibrating a saved profile opens M1 after calibration.
- **Replace** updates the saved profile.
- **Keep as unsaved** preserves the saved profile and selects the new unsaved profile.

### Five-profile limit

- A sixth saved profile cannot be created.
- The unsaved profile remains usable.
- **Save profile** opens M3.
- M3 says only that a saved profile must be deleted.
- Closing M3 preserves the unsaved profile.

### Deletion

- Delete opens a full-screen dark confirmation.
- Cancel preserves the profile.
- Delete removes it and selects a valid fallback.

---

## 15. Accessibility Requirements

- All buttons and links must be keyboard operable.
- The selector must expose its accessible name, selected value, and expanded state.
- Dropdown groups must be programmatically distinguishable.
- Delete and discard actions require specific accessible labels.
- Focus must move into full-screen decision states when opened.
- Focus must return logically when closed.
- Countdown announcements must not be disruptive.
- Live volume feedback must not rely on color alone.
- Input warnings must be associated with the name field.
- Toasts must use polite announcements and must not steal focus.
- Reduced-motion preferences must be respected.

---

## 16. Data and State Model

### Saved profiles

Each saved profile includes:

- Unique identifier
- Display name
- Calibration data
- Last-used information, if already supported

### Unsaved profile

- Zero or one
- Calibration data
- Session-bound
- No committed display name

### Selected profile

References either:

- The unsaved profile, or
- One saved profile

### First-conversation flag

Persisted condition indicating whether the user has ever started monitoring.

### Decision state

One of:

- None
- C0
- M1
- M2
- M2a
- M3
- 06b

---

## 17. Testing Requirements

Add or update tests covering:

1. First-time flow from 01 through 03
2. Six-second calibration completion
3. Microphone-permission failure
4. First-conversation copy persisting until monitoring starts
5. Unsaved-profile persistence within the Companion session
6. Unsaved-profile removal when the Companion closes
7. Selector with saved profiles only
8. Selector with unsaved and saved profiles
9. Profile switching
10. Contextual actions by profile type
11. **Create new profile** hidden at five saved profiles
12. **Save profile** opening M3 at the cap
13. M3 preserving the unsaved profile
14. Saving a unique profile
15. Existing-name detection
16. Replacement flow and replacement toast
17. Saved-profile recalibration through M1
18. **Keep as unsaved** behavior
19. Delete confirmation and fallback selection
20. Unsaved discard with and without saved profiles
21. Processing and toast behavior
22. Keyboard and focus behavior
23. Start monitoring remaining anchored across Ready states
24. Existing monitoring behavior continuing to pass

---

## 18. Implementation Guardrails

Do not:

- Reintroduce “range” terminology in user-facing copy
- Count the unsaved profile toward the five-profile cap
- Force saving before monitoring
- Remove the unsaved profile when selecting a saved profile
- Put management controls inside M3
- Mention replacement in M3
- Use a floating modal for saved-profile deletion
- Require confirmation to discard the unsaved profile
- Show **Create new profile** at the cap
- Automatically replace saved data
- Discard completed saved-profile recalibration when **Keep as unsaved** is chosen
- Move **Start monitoring** based on selector state
- Add post-session acknowledgment messages in this phase
- Add recording, transcription, or audio storage
- Redesign unrelated monitoring states

---

## 19. Open Items for Handoff

### Timing

Confirm exact durations for:

- Save and replacement processing
- Toast auto-dismiss

Current placeholders:

- Approximately 1 second
- Approximately 2 seconds

### Browser-specific microphone guidance

Confirm behavior and copy for:

- Chrome
- Edge
- Safari
- Firefox

### Recalibration entry

Confirm whether **Recalibrate** opens:

- C1 first, or
- C2 directly

Use one consistent rule for saved and unsaved profiles unless there is a documented reason to differ.

### Replacement completion

Confirm whether M1 replacement should also show a toast and, if so, whether the message is:

**Profile “[Name]” replaced**

---

## 20. Final MVP Summary

The Ready screen uses one stable layout centered on the selected speaking profile.

- An unsaved profile can be monitored, recalibrated, saved, or discarded.
- A saved profile can be monitored, recalibrated, replaced, or deleted.
- Recalibrating a saved profile never forces the new calibration to be lost.
- Five saved profiles is the maximum, but an unsaved profile may still be used.
- Saving at the cap requires deleting a saved profile first.
- **Start monitoring** remains the anchored primary action.
- Consequential changes require clear confirmation.
- Post-session acknowledgment messages are deferred to a later enhancement.
- Mezzo does not record audio or transcribe speech.
