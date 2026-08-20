# Demo video script — Momentum Life OAuth verification

Recording plan for the video the sensitive-scope review requires. Four takes.

**"Continuous" means no cut _within_ a take.** Cuts between takes are fine, with one exception:
the consent screen and the return to Obsidian must be in the **same** take, so the reviewer can
see they are the same session.

## Before you record

- [ ] Sign in to the **test Google account**, not the personal one. This consumes 1 of the 100
      lifetime slots of the unverified app — record it in the submission checklist.
- [ ] Use a clean vault with **fictional** task titles ("Buy printer paper", "Draft Q3 summary").
- [ ] Close every other browser tab. Tab titles are readable in frame and count as visible data.
- [ ] Turn off system notifications (macOS: Do Not Disturb). A notification banner mid-take means
      re-recording.
- [ ] Close any other Obsidian note that shows real information.
- [ ] Record at **1280×720 or higher**. Every string called out below must be legible when the
      video is paused.
- [ ] Target length: **2 to 10 minutes** total.

## Take 1 — Setup and consent (continuous, no cut)

Start recording with Obsidian already open on the plugin settings.

1. Show the **Momentum Life** settings tab, with the plugin name visible on screen.
2. Show the **Google tasks** section and its toggle, stating that it is off by default.
3. Click **Connect Google account**.
4. The browser opens Google's consent screen. Hold here and make sure the frame shows:
   - the app name **Momentum Life**, exactly as configured on the consent screen;
   - the full list of requested permissions, including the Google Tasks permission.
5. **Expand the browser address bar** and hold long enough to read:
   - `client_id=8btbj3o6…`
   - `redirect_uri=https%3A%2F%2Fmomentumlife-auth.jnagase.com%2Fcallback`
6. Approve the consent.
7. The browser hands off to `obsidian://momentum-google` and Obsidian comes to the front.
8. Show the settings confirming **Connected.**

> Do not cut anywhere between step 3 and step 8.

Note: while the app is unverified you will also pass the "Google hasn't verified this app"
screen. Leave it in the video — it is the reviewer's own current state, and hiding it looks like
editing. Click **Advanced**, then **Go to momentumlife.jnagase.com (unsafe)**.

## Take 2 — Obsidian → Google (continuous)

1. Create a task in a board — for example "Buy printer paper" in **My Tasks**.
2. Trigger **Sync now** on screen (the sync is manual by default, so the trigger must be visible).
3. Switch to Google Tasks in the browser and show the **same title** in the **matching list**.

Keep the board name and the Google list name in frame, so the pairing is visible.

## Take 3 — Google → Obsidian (continuous)

1. Create a task in Google Tasks — for example "Draft Q3 summary".
2. Switch to Obsidian and trigger **Sync now**.
3. Show the new note appearing in the corresponding board, with the same title.

## Take 4 — Close

Restate, on camera or in narration:

- Momentum Life is an Obsidian plugin that keeps tasks in local Markdown files.
- It requests the Google Tasks scope only, and uses it only for this two-way sync.
- Task data stays on the user's device; the author operates no storage server.

## Narration and captions

- English narration, **or** English captions you upload yourself.
- **Do not rely on YouTube's automatic captions** — auto-generated or auto-translated captions do
  not satisfy the requirement.
- The narration must cover every step above, naming what is on screen at each point.

## Publishing

- [ ] Upload to YouTube as **public** or **unlisted** (not private — the reviewer must be able to
      open it without being added).
- [ ] No age restriction.
- [ ] The URL must stay reachable, unchanged, from submission until the final decision.
- [ ] Record in the submission checklist: video URL, publication date, the test account used, and
      the 1 slot consumed of the 100-account lifetime cap.

## Review the recording before submitting

Watch it frame by frame and confirm:

- [ ] No real personal data of anyone: names, emails, phone numbers, addresses — including
      browser tabs, notifications and other vault notes.
- [ ] The app name shown matches the consent screen **exactly**.
- [ ] `client_id`, `redirect_uri`, permission list and both task titles are legible when paused.
- [ ] No cut between the consent screen and the return to Obsidian.

Any of these failing blocks the submission until a corrected recording is published at the
registered URL.
