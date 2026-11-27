# Define Bot

**Mention the bot with `!define` and get a concise English Wikipedia summary in the thread.**

Define Bot is a [Reddit Devvit](https://developers.reddit.com/docs) app that listens for comments, looks up a term, and replies with the article title, a link to [English Wikipedia](https://en.wikipedia.org/), and a short introduction (up to about 600 characters).

<!-- SCREENSHOT: A comment thread where a user wrote "u/define-bot !define [renormalization]" and the bot replied with a bold title, Wikipedia link, and intro text. -->

> 📸 Screenshot coming soon: a `!define` command and the bot’s Wikipedia reply in a subreddit comment thread.

## Features

- **`!define` in comments** — Users ask for a definition without leaving the post.
- **Smart title matching** — Google Gemini picks the best Wikipedia article title for the term (with optional subject-category hints for your subreddit).
- **Readable replies** — Bold article title, markdown link to Wikipedia, and a trimmed lead paragraph.
- **Subreddit controls** — Turn the command on or off, set a subject category, toggle search grounding, and customize the bot signature.
- **One reply per command comment** — The app ignores duplicate deliveries for the same comment within about an hour.
- **English Wikipedia only** — Lookups use the public English Wikipedia API.

## Legal

- [Terms of Service](https://allhailseizure.github.io/define-bot/terms/)
- [Privacy Policy](https://allhailseizure.github.io/define-bot/privacy/)

## Install the app on your subreddit

Define Bot is a Devvit app named **`define-bot`**. A moderator with permission to add apps to the subreddit installs it through **Reddit’s Devvit app installation** for that community (Devvit “install” in the mod workflow).

After installation, open the app’s **settings** for your subreddit. At minimum, whoever manages the app must set the **global** Gemini API key (see below). Without it, the bot will not reply.

Developers and maintainers: see [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, testing, and releases.

## Settings

Settings come from the app configuration. Labels below match what you see in the Devvit settings UI.

### Global (app-wide)

| Setting | Purpose |
|--------|---------|
| **Gemini API key** (`geminiApiKey`, secret) | Google Gemini API key used to resolve search terms to Wikipedia titles. **Required** for any replies. |

### Subreddit

| Setting | Default | Purpose |
|--------|---------|---------|
| **Enable** (`defineCommandEnabled`) | On | Turn the `!define` command on or off for this subreddit. |
| **Subject category** (`defineCommandCategory`) | *(empty)* | Hint for disambiguation (e.g. `physics`). When set, Gemini prefers topic-specific articles and may treat off-topic terms as “not a {category} concept.” |
| **Search grounding** (`defineCommandSearchGrounding`) | On | When on, Gemini may use Google Search grounding while resolving the term. |
| **General — Bot signature** (`botSignature`) | Standard disclaimer | Text appended to every bot comment (Reddit superscript styling). Leave blank for no signature. |

## How to use it

There are **no mod menus or forms** in this app—only the comment command below.

### Command format

1. Post a **comment** on the subreddit (not a post title or body).
2. **Mention the app account** and include **`!define`** with the term in **square brackets**.

The app slug is `define-bot`, so the mention is:

```text
u/define-bot
```

**Example:**

```text
u/define-bot !define [renormalization]
```

Another example from tests:

```text
u/define-bot !define [spin]
```

**Rules (from how the app parses commands):**

- The mention `u/define-bot` is **required** (case-insensitive match).
- The term must be inside **brackets**: `!define [your term here]`.
- Only **`!define`** is registered; other `!commands` are ignored.
- `!define` without a `[term]` is ignored.
- Extra punctuation around the term inside the brackets is trimmed when possible.

### What you get back

On success, the bot comments under yours with:

1. **Article title** (bold)
2. A **[Wikipedia](…)** link to the English article
3. The article introduction, shortened to about 600 characters when needed
4. Your configured **bot signature** (if any)

**Example shape of a reply** (content will vary):

```text
**Spin (physics)**
[Wikipedia](https://en.wikipedia.org/wiki/Spin_(physics))

Spin is an intrinsic form of angular momentum.

---

^I ^am ^a ^bot.
```

### When the bot does not reply

- **`!define` is disabled** for the subreddit — no comment.
- **No Gemini API key** is configured — no comment.
- **No mention** of `u/define-bot` — ignored.
- **Missing `[term]`** or unknown command — ignored.
- **Gemini returns “none”** (especially with a subject category) — you may see: `"term" doesn't appear to be a {category} concept.` or `Couldn't find a Wikipedia article for "term".`
- **Wikipedia has no matching article** — `Couldn't find a Wikipedia article for "…".`
- **API errors** — `Failed to look up "term" — please try again later.`

The app responds at most **once per comment** even if Reddit delivers the trigger more than once.

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE). Copyright (c) 2026 Nate Bosma.