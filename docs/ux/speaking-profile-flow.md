# Speaking Profile Flow

## Purpose

The Speaking Profile page helps users choose how Mezzo should define the speaking range used during monitoring.

The page has two presentation states based on the user's currently saved custom speaking profiles:

- A guided choice when no custom speaking profiles are saved.
- A profile library when one or more custom speaking profiles are saved.

Across both states, the page allows users to:

- Select an existing speaking profile.
- Create a custom speaking profile.
- Delete a saved custom speaking profile.
- Start monitoring with the selected profile.

Profile creation should begin only when the user explicitly chooses the custom-profile path or selects **Create New Speaking Profile**.

---

# Mental Model

A **Speaking Profile** defines the **Speaking Range** Mezzo uses during monitoring.

The relationship is:

```text
Speaking Profile
        ↓
Defines a Speaking Range
        ↓
Monitoring compares live speech against that range
```

Users choose or create Speaking Profiles.

Mezzo derives and monitors the corresponding Speaking Range.

---

# Page States

The page state is determined by the number of saved custom speaking profiles.

```text
No saved custom profiles
        ↓
Guided choice

One or more saved custom profiles
        ↓
Profile library
```

The experience should depend on current profile data, not on whether the user has previously completed onboarding.

If a user deletes all saved custom speaking profiles, the page returns to the guided-choice state.

---

## No Saved Custom Profiles

When no custom speaking profiles are saved, Mezzo presents a guided choice between two paths:

- Everyday Conversation
- Custom Speaking Profile

Both options are shown as radio-button choices.

### Everyday Conversation

Everyday Conversation is selected by default.

When selected:

- The primary button label is **Start Monitoring**.
- Selecting the button opens the Mezzo Companion directly into Monitoring, using Everyday Conversation.
- Profile creation does not begin.

### Custom Speaking Profile

When selected:

- The primary button label is **Continue**.
- Selecting the button begins the custom profile creation flow.
- The Companion does not open.

The button uses **Continue** rather than repeating the selected option.

### Purpose of This State

This state introduces the concept of speaking profiles while giving users a clear choice between:

- Using Mezzo's built-in recommended speaking range.
- Teaching Mezzo a personalized speaking range.

---

## Saved Custom Profiles

When one or more custom speaking profiles are saved, the page becomes a profile library.

The interface contains:

- Everyday Conversation
- A Custom Profiles section
- The saved custom profile list
- A Create New Speaking Profile action
- The Start Monitoring button

In this state:

- Existing profiles use radio buttons.
- Selecting a profile changes the current selection only.
- **Create New Speaking Profile** immediately begins profile creation.
- The primary button label always remains **Start Monitoring**.
- Start Monitoring launches the Companion directly into Monitoring, using the currently selected profile.

---

# Interaction Model

## Everyday Conversation

Everyday Conversation is built into Mezzo.

It:

- Always exists.
- Cannot be renamed.
- Cannot be deleted.
- Appears before the custom profile list.
- Can be selected like any saved profile.
- Is selected by default when no other valid selection exists.

It represents a comfortable speaking range for everyday conversations.

The interface may identify it with the supporting label:

**Recommended**

---

## Custom Profiles

Saved custom profiles appear beneath the **Custom Profiles** heading.

Each custom profile:

- Can be selected.
- Can be deleted.
- Cannot be reordered.
- Cannot be changed while monitoring is active.

Selecting a custom profile:

- Updates the active selection.
- Updates the selected radio button.
- Does not navigate.
- Does not open the Companion.
- Does not begin monitoring.

---

## Profile Limit

Mezzo supports a maximum of **five saved custom speaking profiles**.

The current count appears beside the **Custom Profiles** heading.

Examples:

```text
CUSTOM PROFILES      3 / 5
```

```text
CUSTOM PROFILES      5 / 5
```

### Below the Limit

When fewer than five custom profiles are saved:

- Create New Speaking Profile is enabled.
- Selecting it immediately begins profile creation.
- No limit helper message is shown.

### At the Limit

When five custom profiles are saved:

- Create New Speaking Profile remains visible but disabled.
- The count displays **5 / 5**.
- A helper message explains what the user must do.

Example:

> Delete a profile to create another.

When a profile is deleted:

- The count updates immediately.
- Create New Speaking Profile becomes enabled.
- The helper message is removed.

---

## Create New Speaking Profile

The behavior of custom-profile creation depends on the page state.

### No Saved Custom Profiles

Custom Speaking Profile is presented as a radio-button choice.

Selecting it does not begin profile creation immediately.

The user begins profile creation by selecting **Continue**.

### Saved Custom Profiles

Create New Speaking Profile is an action, not a selectable profile.

It:

- Appears beneath the custom profile list.
- Does not use a radio button.
- Uses the dashed-circle-plus icon.
- Immediately begins the profile creation flow when selected.
- Does not require the user to press **Start Monitoring**.

### After Profile Creation

After a profile is created:

- Return to the Speaking Profile page.
- Add the new profile to the custom profile list.
- Automatically select the new profile.
- Preserve the rest of the page state.
- Show the profile-library presentation.

Calibration always ends in one of two outcomes: a saved Custom Profile, or a discarded result if the user cancels. There is no third "used once without saving" outcome, and no temporary profile is ever added to the list.

---

## Start Monitoring

Start Monitoring launches the Mezzo Companion directly into Monitoring, using the currently selected saved profile — there is no intermediate Companion Ready screen and no second Start Monitoring action inside the Companion for this first session.

### No Saved Custom Profiles

When **Everyday Conversation** is selected, the primary button is:

**Start Monitoring**

When **Custom Speaking Profile** is selected, the primary button changes to:

**Continue**

### Saved Custom Profiles

The primary button is always:

**Start Monitoring**

Its label does not change based on the selected saved profile.

Selecting **Start Monitoring**:

- Opens the Mezzo Companion directly into its Monitoring state.
- Passes the selected profile to the Companion, shown there as read-only metadata.
- Starts the monitoring engine immediately — this is the one action that both opens the Companion and begins monitoring, since Mezzo already confirmed the profile.

---

## Deleting Profiles

Only saved custom profiles can be deleted.

Everyday Conversation is never deletable.

Selecting a custom profile's delete action opens a confirmation dialog.

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

- Permanently removes the custom profile.
- Closes the confirmation dialog.
- Animates the deleted row collapsing.
- Updates the custom profile count.
- Enables Create New Speaking Profile when the count falls below five.
- Keeps the user on the same page.
- Does not reload the page.

### Deleting the Selected Profile

If the deleted profile was selected:

- Select Everyday Conversation automatically.
- Preserve the rest of the page state.
- Keep Start Monitoring available.

### Deleting the Final Custom Profile

If the final saved custom profile is deleted:

- Return to the **No Saved Custom Profiles** presentation.
- Select Everyday Conversation by default.
- Show Custom Speaking Profile as the second guided radio option.

No separate empty-library state is needed.

---

# Selection Behavior

## No Saved Custom Profiles

The two radio options represent different paths.

Selecting **Everyday Conversation**:

- Selects the built-in profile.
- Changes the primary button to **Start Monitoring**.

Selecting **Custom Speaking Profile**:

- Selects the creation path.
- Changes the primary button to **Continue**.

Neither radio option takes action immediately.

The primary button advances the selected path.

---

## Saved Custom Profiles

Radio buttons represent existing profiles only.

Selecting an existing profile:

- Changes the active selection.
- Does not navigate.
- Does not create a profile.
- Does not open the Companion.
- Does not begin monitoring.

Create New Speaking Profile remains a separate action.

The primary button remains **Start Monitoring**.

---

# Visual Hierarchy

## No Saved Custom Profiles

The page is organized into:

1. Page title and explanation
2. Everyday Conversation option
3. Custom Speaking Profile option
4. Dynamic primary action
5. Reassurance text

The two choices should feel parallel and mutually exclusive.

---

## Saved Custom Profiles

The page is organized into:

1. Page title and explanation
2. Everyday Conversation
3. Custom Profiles heading and count
4. Saved custom profile list
5. Create New Speaking Profile action
6. Start Monitoring
7. Reassurance text

Everyday Conversation remains visually distinct from the Custom Profiles section while still behaving like a normal selectable profile.

Create New Speaking Profile belongs visually to the custom profile collection but must clearly read as an action rather than a saved profile.

---

# Design Principles

## One Object

Everything revolves around the Speaking Profile.

Users:

- Choose profiles.
- Create profiles.
- Delete profiles.
- Start monitoring with a selected profile.

The page should not introduce a separate profile-management destination.

---

## Data-Driven Presentation

The page presentation is determined by saved profile data.

```text
customProfiles.length === 0
        ↓
Guided choice

customProfiles.length > 0
        ↓
Profile library
```

Do not use a persisted first-time-user or onboarding-complete flag to determine the page state.

---

## Progressive Guidance

The interface provides more guidance when no custom profiles exist and becomes more direct once saved profiles are available.

- No saved custom profiles: choose a path, then continue.
- Saved custom profiles: select, create, delete, or open.

This is progressive guidance based on current user needs, not user tenure.

---

## Predictability

Each control has one responsibility.

### No Saved Custom Profiles

- Radio button → Choose a path.
- Start Monitoring → Open the Companion directly into Monitoring, using Everyday Conversation.
- Continue → Begin custom profile creation.

### Saved Custom Profiles

- Radio button → Select an existing profile.
- Trash icon → Request profile deletion.
- Create New Speaking Profile → Begin profile creation.
- Start Monitoring → Open the Companion directly into Monitoring, using the selected profile.

---

## One Primary Action per State

The primary action reflects the next meaningful step.

### Guided Choice

- Everyday Conversation selected → **Start Monitoring**
- Custom Speaking Profile selected → **Continue**

### Profile Library

- Primary action → **Start Monitoring**

Create New Speaking Profile is a secondary action within the profile list.

---

## Progressive Disclosure

Only expose complexity when it becomes relevant.

Examples:

- Delete controls appear only for saved custom profiles.
- Delete confirmation appears only after a delete action.
- The profile limit message appears only at five saved profiles.
- The profile library appears only when saved custom profiles exist.
- Profile creation remains a dedicated flow.

---

# Product Responsibilities

The Speaking Profile page prepares Mezzo for use.

The Mezzo Companion provides the active monitoring experience.

## Speaking Profile Page

The Speaking Profile page owns:

- Selecting profiles.
- Creating profiles.
- Deleting profiles.
- Enforcing the saved-profile limit.
- Starting monitoring with the selected profile — opening the Mezzo Companion directly into Monitoring, with no separate Ready confirmation step.

## Mezzo Companion

The Mezzo Companion owns:

- Starting monitoring again for subsequent sessions, from its own Ready screen (reached by stopping — the first session each time is started directly from the Speaking Profile page).
- Stopping monitoring.
- Displaying the current monitoring state.
- Displaying the active profile.
- Visualizing the user's speaking level relative to the selected range.
- Providing ambient awareness during conversations.

This separation keeps preparation distinct from real-time use and supports Mezzo's goal of remaining calm, focused, and unobtrusive.