---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy — Define Bot

**Effective Date:** 2026-11-25

## 1. What the app does

**Define Bot** ("the app") runs on Reddit communities through Reddit's Devvit platform. When a new comment mentions the app's account (`u/define-bot`) and contains `!define [term]`, the app looks the term up and replies with the title, link, and opening paragraph of the matching English Wikipedia article.

## 2. Data the app processes

- **Comment text.** Every new comment in the community is checked in memory for a mention of the app and a `!define` command. Comment text is not stored.
- **The requested term.** It is the only piece of the comment sent outside Reddit (see §3).
- **Comment ID.** Used to reply, and to make sure each comment is answered only once.
- **The reply.** Posted publicly on Reddit under the app account.

The app does not send usernames or user IDs to any third party, and it does not build profiles.

## 3. Third parties

- **Google Gemini API** (generativelanguage.googleapis.com) receives the requested term and a short instruction. The instruction includes the moderator-configured subject category, if one is set. Gemini replies with the Wikipedia article title it thinks matches the term.
  - If the moderators enable **search grounding**, Google may run Google Search queries for the term to answer.
  - Google processes this data under the [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google's Privacy Policy](https://policies.google.com/privacy). On Gemini's unpaid tier, Google may use submitted content to improve its products. Which tier applies depends on the app operator's Google Cloud and Gemini account settings.
- **Wikipedia / Wikimedia Foundation** (en.wikipedia.org) receives the resolved article title, through a public API request that identifies the app by its user agent. It is covered by the [Wikimedia Privacy Policy](https://foundation.wikimedia.org/wiki/Policy:Privacy_policy).
- **Reddit** runs the app and stores its Redis data and replies.

The app does not use Supabase or any other database. Data is never sold or used for advertising, and the app itself does not use data to train models.

## 4. Retention

**Devvit Redis**, scoped to the installing subreddit:

| Key | Contents | Kept for |
| --- | --- | --- |
| `bot:cmd:{commentId}` | Marker that a comment was handled | 1 hour |
| `bot:log:{info, warn, error}` | Operational logs. These can include the requested term, the resolved title, and comment IDs | The last 500 entries per level |

- Devvit platform logs, whose retention Reddit controls, hold the same log lines.
- Uninstalling the app removes its Redis data for that subreddit.
- Replies are ordinary Reddit comments that moderators or the app's maintainers can remove.

## 5. Contact

For questions or removal requests, contact the subreddit's moderators, or open an issue at [github.com/AllHailSeizure/define-bot](https://github.com/AllHailSeizure/define-bot/issues).
