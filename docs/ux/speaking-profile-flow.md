# Speaking Profile Flow

## Purpose

The Speaking Profile page helps users choose how Mezzo should define the speaking range used during monitoring.

The page has two presentation states based on the user's currently saved speaking profiles:

- A calibrate-first state when no speaking profiles are saved yet.
- A profile library when one or more speaking profiles are saved.

Across both states, the page allows users to:

- Select an existing speaking profile and start monitoring with it as-is.
- Calibrate a new speaking profile for this session, optionally saving it as a new profile.
- Recalibrate an existing saved speaking profile in place.
- Delete a saved speaking profile.
- Start monitoring with the selected profile.

There is no built-in, uncalibrated default profile — useful monitoring requires calibration, since microphone gain, distance, environment, and speaking level all differ across users and devices. Calibration begins only when the user explicitly chooses Calibrate for this session or Recalibrate — never automatically, and never as a side effect of simply opening the page.

---

# Mental Model

A **Speaking Profile** is a persistent, reusable identity for an environment or situation — "Kitchen," "Home Office," "Coffee Shop" — not a single-use calibration. It defines the **Speaking Range** Mezzo uses during monitoring.

The relationship is:

```text
Speaking Profile
        ↓
Defines a Speaking Range, from its current calibration
        ↓
Monitoring compares live speech against that range
```

A profile's calibration can be refreshed at any time via **Recalibrate**, without changing the profile's identity — same id, same name, same position in the library. Recalibrating "Kitchen" updates "Kitchen"; it never creates "Kitchen 2," never requires renaming, and never requires deleting the profile it replaces.

A **temporary calibration**, from **Calibrate for this session**, is not a Speaking Profile until the user explicitly saves it as one. It exists only for the current session and is discarded if never saved.

Users choose existing Speaking Profiles, calibrate new ones, or recalibrate existing ones. Mezzo derives and monitors the corresponding Speaking Range from whichever calibration is current.

---

# Page States

The page state is determined by the number of saved speaking profiles.

```text
No saved profiles
        ↓
Calibrate-first state

One or more saved profiles
        ↓
Profile library
```

The experience should depend on current profile data, not on whether the user has previously completed onboarding.

If a user deletes all saved profiles, the page returns to the calibrate-first state.

---

## No Saved Profiles

When no speaking profiles are saved, Mezzo presents exactly one path in:

- Calibrate for this session

There is no guided choice between a built-in default and a custom option — there is no built-in default. The primary button label is **Calibrate**. Selecting it begins calibration directly (see "Calibration" in `docs/product-experience.md`); it does not itself start monitoring.

### Purpose of This State

This state gets a genuinely new user into a working Speaking Range as quickly as possible, without asking them to choose between options they don't yet have context to evaluate. The choice that matters — save this as a reusable profile, or use it once — comes after calibration completes, not before it starts.

---

## Saved Profiles

When one or more speaking profiles are saved, the page becomes a profile library.

The interface contains:

- Saved Profiles heading and count
- The saved profile list
- A Calibrate for this session action
- The Start Monitoring button

In this state:

- Existing profiles use radio buttons for selection.
- Selecting a profile changes the current selection only.
- Each profile also exposes a **Recalibrate** action, independent of selection — see "Recalibrate an Existing Profile" below.
- **Calibrate for this session** immediately begins calibration for a new, temporary range.
- The primary button label always remains **Start Monitoring**, active whenever an existing profile is selected.
- Start Monitoring launches the Companion directly into Monitoring, using the currently selected profile as-is.

---

# Interaction Model

## Saved Profiles

Saved profiles appear beneath the **Saved Profiles** heading.

Each saved profile:

- Can be selected.
- Can be recalibrated.
- Can be deleted.
- Cannot be reordered.
- Cannot be changed while monitoring is active.

Selecting a saved profile:

- Updates the active selection.
- Updates the selected radio button.
- Does not navigate.
- Does not open the Companion.
- Does not begin monitoring.
- Does not begin calibration.

---

## Recalibrate an Existing Profile

Recalibrate refreshes a profile's calibration without changing its identity.

Selecting Recalibrate on a saved profile:

- Does not require first selecting that profile via its radio button — it acts directly on the row it's chosen from.
- Begins calibration in recalibrate mode, targeting that specific profile (see "Calibration" in `docs/product-experience.md`).
- Does not change or delete the profile until the resulting calibration is explicitly committed.

On successful calibration, the resulting decision screen offers:

- **Update "{name}" & Start Monitoring** — writes the new measurement to the profile and starts monitoring immediately.
- **Update "{name}"** — writes the new measurement to the profile, returns to this page, does not start monitoring.
- **Try Again** — discards this take, restarts calibration capture directly.
- **Discard** — abandons the result entirely; the profile is left exactly as it was.

Nothing about the profile — its calibration, its name, its position in the list — changes unless one of the two Update actions is explicitly selected. Recalibrating "Kitchen" always updates "Kitchen" in place: never a duplicate, never a rename, never a delete-and-recreate.

The Companion is validating a per-row control against a select-then-"Recalibrate Kitchen" pattern at its real 320px width (see `docs/product-experience.md`'s "Companion States → Ready") — a select-first pattern is the likely stronger default there. This page is under no obligation to match whatever the Companion settles on: it shares terminology, state transitions, storage semantics, and calibration logic with the Companion, not literal control placement, and its available width and interaction model are different. A visible Recalibrate action per row remains a reasonable default here regardless of what the Companion chooses.

---

## Calibrate for this Session

Calibrate for this session begins a fresh, temporary calibration, unconnected to any existing profile.

Selecting it:

- Begins calibration in session mode (see "Calibration" in `docs/product-experience.md`).
- Does not require any existing profile to be selected first.

On successful calibration, the resulting decision screen offers:

- **Start Monitoring** — uses the resulting temporary Speaking Range immediately, without saving.
- **Save as New Profile** — names and persists it as a new saved profile; does not by itself start monitoring.
- **Try Again** — discards this take, restarts calibration capture directly.
- **Discard** — abandons the result entirely, returns to this page with nothing created.

A session-only calibration never overwrites an existing saved profile. Its only two possible outcomes are staying temporary until discarded, or becoming a brand-new profile via Save as New Profile — never a replacement of something that already exists.

If the user starts monitoring without saving, and later stops monitoring, they are asked once more whether to save it (see "Monitoring Lifecycle" in `docs/product-experience.md`) — Calibrate for this session always eventually resolves to either "saved as new" or "discarded," never left ambiguous.

---

## Profile Limit

Mezzo supports a maximum of **five saved speaking profiles**.

The current count appears beside the **Saved Profiles** heading.

Examples:

```text
SAVED PROFILES      3 / 5
```

```text
SAVED PROFILES      5 / 5
```

### Below the Limit

When fewer than five profiles are saved:

- Calibrate for this session is enabled, and its resulting Save as New Profile action is available.
- No limit helper message is shown.

### At the Limit

When five profiles are saved:

- Calibrate for this session remains available — a temporary calibration can still be used for the session — but its Save as New Profile action is disabled, with a helper message explaining what the user must do.
- Recalibrate remains fully available on every existing profile: refreshing a profile in place never increases the count, so it's never blocked by the limit.
- The count displays **5 / 5**.

Example:

> Delete a profile to save a new one.

When a profile is deleted:

- The count updates immediately.
- Save as New Profile becomes enabled again.
- The helper message is removed.

---

## Start Monitoring

Start Monitoring launches the Mezzo Companion directly into Monitoring, using the currently selected saved profile as-is — there is no intermediate Companion Ready screen and no second Start Monitoring action inside the Companion for this first session.

### No Saved Profiles

The only path in is Calibrate for this session; there is nothing to select and no Start Monitoring button until a calibration completes and the user chooses Start Monitoring (or Update "{name}" & Start Monitoring, in recalibrate mode) from that calibration's own decision screen.

### Saved Profiles

The primary button is always:

**Start Monitoring**

Its label does not change based on which saved profile is selected.

Selecting **Start Monitoring**:

- Opens the Mezzo Companion directly into its Monitoring state.
- Passes the selected profile to the Companion, shown there as read-only metadata.
- Starts the monitoring engine immediately — this is the one action that both opens the Companion and begins monitoring, since Mezzo already confirmed the profile.

---

## Deleting Profiles

Selecting a saved profile's delete action opens a confirmation dialog.

Example:

**Delete "Coffee Shop"?**

> This profile will be permanently deleted.

Actions:

- Cancel
- Delete

### Cancel

Selecting Cancel:

- Closes the dialog.
- Preserves the profile.
- Preserves the current selection.
- Returns focus to the delete control that opened the dialog.

### Confirm Delete

Selecting Delete:

- Permanently removes the saved profile.
- Closes the confirmation dialog.
- Animates the deleted row collapsing.
- Updates the saved profile count.
- Enables Save as New Profile when the count falls below five.
- Keeps the user on the same page.
- Does not reload the page.

### Deleting the Selected Profile

If the deleted profile was selected:

- If other saved profiles remain, select one of them automatically (the next one in the list).
- If no saved profiles remain, the page returns to the No Saved Profiles state — see below.
- Preserve the rest of the page state.

### Deleting the Final Profile

If the final saved profile is deleted:

- Return to the **No Saved Profiles** presentation.
- Calibrate for this session is the only path in, exactly as for a genuinely new user.

No separate empty-library state is needed.

---

# Selection Behavior

## No Saved Profiles

There is only one path, so there is no selection to make — Calibrate is the sole primary action.

## Saved Profiles

Radio buttons represent existing profiles only.

Selecting an existing profile:

- Changes the active selection.
- Does not navigate.
- Does not calibrate or recalibrate.
- Does not open the Companion.
- Does not begin monitoring.

Recalibrate and Calibrate for this session remain separate actions, reachable independently of the radio selection.

The primary button remains **Start Monitoring**.

---

# Visual Hierarchy

## No Saved Profiles

The page is organized into:

1. Page title and explanation
2. Calibrate for this session — the sole primary action
3. Reassurance text

## Saved Profiles

The page is organized into:

1. Page title and explanation
2. Saved Profiles heading and count
3. Saved profile list, each row offering select and Recalibrate
4. Calibrate for this session action
5. Start Monitoring
6. Reassurance text

Calibrate for this session belongs visually near the saved profile collection but must clearly read as an action rather than a saved profile — the same treatment the retired Create New Speaking Profile control used.

---

# Design Principles

## One Object

Everything revolves around the Speaking Profile — and, for a session that hasn't been saved as one yet, the temporary calibration standing in for it.

Users:

- Choose profiles.
- Calibrate new profiles.
- Recalibrate existing profiles.
- Delete profiles.
- Start monitoring with a selected profile.

The page should not introduce a separate profile-management destination.

---

## Data-Driven Presentation

The page presentation is determined by saved profile data.

```text
savedProfiles.length === 0
        ↓
Calibrate-first state

savedProfiles.length > 0
        ↓
Profile library
```

Do not use a persisted first-time-user or onboarding-complete flag to determine the page state.

---

## Progressive Guidance

The interface provides more guidance when no profiles exist and becomes more direct once saved profiles are available.

- No saved profiles: calibrate, then decide whether to save.
- Saved profiles: select, calibrate fresh, recalibrate, delete, or start.

This is progressive guidance based on current user needs, not user tenure.

---

## Predictability

Each control has one responsibility.

### No Saved Profiles

- Calibrate → Begin calibration for this session.

### Saved Profiles

- Radio button → Select an existing profile.
- Recalibrate → Refresh that profile's calibration in place.
- Trash icon → Request profile deletion.
- Calibrate for this session → Begin a fresh, temporary calibration.
- Start Monitoring → Open the Companion directly into Monitoring, using the selected profile.

---

## One Primary Action per State

### No Saved Profiles

- Primary action → **Calibrate**

### Saved Profiles

- Primary action → **Start Monitoring**

Calibrate for this session and Recalibrate are secondary actions available alongside the primary one, not competing with it.

---

## Progressive Disclosure

Only expose complexity when it becomes relevant.

Examples:

- Delete and Recalibrate controls appear only for saved profiles.
- Delete confirmation appears only after a delete action.
- The profile limit message appears only at five saved profiles.
- The profile library appears only when saved profiles exist.
- The Start Monitoring / Save as New Profile / Try Again / Discard decision appears only after a calibration attempt completes.

---

# Product Responsibilities

The Speaking Profile page prepares Mezzo for use.

The Mezzo Companion provides the active monitoring experience. Calibration and recalibration are available in both, through the same underlying flow — see `CLAUDE.md`'s Profile Model and `docs/product-experience.md`'s "Profile Model" for the full shared-flow rationale.

## Speaking Profile Page

The Speaking Profile page owns:

- Selecting profiles.
- Calibrating new profiles.
- Recalibrating existing profiles.
- Deleting profiles.
- Enforcing the saved-profile limit.
- Starting monitoring with the selected profile — opening the Mezzo Companion directly into Monitoring, with no separate Ready confirmation step, when an existing profile is used as-is.

## Mezzo Companion

The Mezzo Companion owns:

- Calibrating new profiles and recalibrating existing ones, for in-the-moment use right before a meeting.
- Starting monitoring again for subsequent sessions, from its own Ready screen (reached by stopping — the first session each time is started directly from the Speaking Profile page, or from the Companion's own Calibrating state when no saved profile is used as-is).
- Stopping monitoring.
- Displaying the current monitoring state.
- Displaying the active profile, including whether it's a saved profile or a temporary, unsaved calibration.
- Visualizing the user's speaking level relative to the selected range.
- Providing ambient awareness during conversations.

This separation keeps preparation distinct from real-time use and supports Mezzo's goal of remaining calm, focused, and unobtrusive — while letting both surfaces reach the same calibration flow, since time pressure before a meeting is exactly the situation this model exists to serve.
