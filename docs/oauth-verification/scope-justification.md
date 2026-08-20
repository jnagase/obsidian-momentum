# Scope justification — Momentum Life

> Submitted verbatim in the Verification Center justification field. This file is the source;
> the field receives an identical copy. English, under 4,000 characters.

---

## Scope and feature

Momentum Life requests exactly one sensitive scope:

`https://www.googleapis.com/auth/tasks`

It supports a single feature: **two-way synchronisation of tasks between the user's local
Obsidian vault and their Google Tasks lists**. Momentum Life is an open-source plugin for
Obsidian, a local Markdown note-taking app. Each board in the plugin is paired with one Google
Tasks list, and each task is a Markdown note in the user's vault. The sync is optional and off by
default: it does nothing until the user enables it and connects their account.

No other sensitive or restricted scope is requested. The plugin does not access Gmail, Drive,
Calendar, Contacts or the user's profile.

## Why read-only access is not sufficient

The feature is bidirectional, so the plugin performs four write operations against the user's
Google Tasks data:

1. **Create a task** — when the user creates a task note in their vault, the matching task is
   created in the paired Google Tasks list.
2. **Update a task** — when the user edits a task's title, notes or due date on either side, the
   change is applied to the other.
3. **Mark a task completed** — completing a task in the vault completes it in Google Tasks (and
   the reverse).
4. **Delete a task** — deleting a task in the vault removes it from the paired list.

The narrower alternative, `https://www.googleapis.com/auth/tasks.readonly`, permits none of
these four operations. With it the plugin could only import from Google Tasks and would silently
fail to propagate any change made in Obsidian, which is the core of the feature. Read-only access
is therefore insufficient, and `.../auth/tasks` is the least-privileged scope that works.

## Where the data goes

Task data obtained through this scope is written **only to Markdown files inside the user's own
local Obsidian vault**, on their own device.

The author operates **no storage server**: no account system, no database, no copy of user task
data anywhere outside the user's device. All Google Tasks API requests are made from the user's
device directly to `tasks.googleapis.com`.

Because a confidential client secret must not ship inside a public open-source plugin, the OAuth
sign-in step passes through a small stateless service operated by the author (a Cloudflare
Worker). It takes part **exclusively in the OAuth handshake**: exchanging the authorization code
for tokens and renewing an expired access token. It does **not** receive, process or persist task
content, tokens, authorization codes or user identifiers.

Access and refresh tokens are stored only in the plugin's local configuration file on the user's
device. Disconnecting in the plugin deletes them and asks Google to revoke the grant.

## Limited Use compliance

Momentum Life's use of data obtained through `https://www.googleapis.com/auth/tasks` complies
with the Google API Services User Data Policy, including the Limited Use requirements:

- The data is **not sold**.
- The data is **not transferred to third parties**. Here that means no transfer at all: it moves
  only between the user's device and Google.
- The data is **not used for advertising** of any kind.
- The data is **not used to train** artificial intelligence or machine learning models.
- The data is used **solely to perform the synchronisation the user explicitly enabled**, and the
  plugin collects no telemetry or analytics.

## Consistency with the published privacy policy

The published privacy policy makes the same statements about storage, sharing and retention: task
data lives only in the user's local vault; the OAuth broker sees only the handshake and persists
nothing; tokens live only in the local configuration file until the user disconnects or deletes
the file; nothing is sold, transferred, used for advertising or used to train models.

- Homepage: https://momentumlife.jnagase.com/
- Privacy policy: https://momentumlife.jnagase.com/privacy
- Source code: https://github.com/jnagase/obsidian-momentum
