<div align="center">

<img src="docs/assets/icon128.png" width="96" height="96" alt="">

# Reply Hygiene

**Clear AI reply accounts out of X, without babysitting it.**

A Chrome extension that blocks every account on the public [blockedforaireply.com](https://blockedforaireply.com) list, one at a time, slowly and within X's rate limits.

[![Chrome Web Store: in review](https://img.shields.io/badge/Chrome_Web_Store-in_review-1f8a6f?logo=googlechrome&logoColor=white)](https://cyrisxd.github.io/reply-hygiene/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1f8a6f)](extension/manifest.json)
[![MIT license](https://img.shields.io/badge/license-MIT-1f8a6f)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-❤-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CyrisXD)

[Website](https://cyrisxd.github.io/reply-hygiene/) · [Privacy](https://cyrisxd.github.io/reply-hygiene/privacy.html) · [Report a bug](https://github.com/CyrisXD/reply-hygiene/issues)

<br>

<img src="docs/assets/screenshot-1.png" width="820" alt="Reply Hygiene blocking accounts while you use X">

</div>

## Why

Replies on X fill up with accounts that post AI-written or spam replies. [blockedforaireply.com](https://blockedforaireply.com) keeps a reviewed, public list of them. Reply Hygiene blocks that whole list from your own account, in a pinned tab you never have to look at, and keeps up as the list grows.

## Features

<table>
<tr>
<td width="50%" valign="top">

### Careful with your account
- One account every 3 to 5 seconds, never faster
- Reads X's own rate limits and waits until X says it can carry on
- Stops instead of retrying if X's security refuses a request
- Only blocks. Never follows, likes, replies, reports or messages

</td>
<td width="50%" valign="top">

### Set it and forget it
- Progress is saved and survives browser restarts
- Checks the list every day or week, or only when you press Start
- Only visits accounts it hasn't handled yet
- Pick which review levels to block: Confirmed, Flagged, Likely, Unreviewed

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Fair to people who appeal
When an account is taken off the list after an appeal, Reply Hygiene unblocks it, but only if Reply Hygiene blocked it. Blocks you made yourself are never undone.

</td>
<td width="50%" valign="top">

### Private
No server, no account, no analytics. Settings and progress stay in your browser. It only talks to x.com and to blockedforaireply.com to download the list.

</td>
</tr>
</table>

## Screenshots

<table>
<tr>
<td><img src="docs/assets/screenshot-2.png" alt="Waiting for X's rate limit to reset"></td>
<td><img src="docs/assets/screenshot-3.png" alt="A finished run with a daily schedule"></td>
</tr>
<tr>
<td><img src="docs/assets/screenshot-4.png" alt="Choosing which review levels to block"></td>
<td><img src="docs/assets/screenshot-5.png" alt="Unblocking accounts removed from the list after an appeal, in dark mode"></td>
</tr>
</table>

## Install

**Chrome Web Store:** in review. The [website](https://cyrisxd.github.io/reply-hygiene/) will link to it as soon as it's live.

**From source:**

1. Clone this repo, open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. Be logged in to x.com, click the extension icon, choose which review levels to block, and press **Start**.

It opens a pinned x.com tab and works there. Leave that tab alone and use X in other tabs as normal.

## How it works

Every account goes through the same loop, one at a time:

```mermaid
flowchart LR
  list["Download the list"] --> next{"Next account?"}
  next -- "yes" --> open["Open x.com/i/user/ID<br>in the pinned tab"]
  open --> match{"@username<br>matches?"}
  match -- "yes" --> block["··· → Block"]
  match -- "no" --> skip["Skip and log it"]
  block --> limit{"X's rate limit<br>left?"}
  skip --> limit
  limit -- "yes" --> pace["Wait 3–5 s"] --> next
  limit -- "no" --> reset["Wait for X's reset"] --> next
  open -- "X refuses (403)" --> stop(["Stop"])
  next -- "list done" --> unblock["Unblock accounts removed<br>after an appeal"] --> done(["Done"])
```

<table>
<tr>
<td width="300" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/popup-running-dark.png">
  <img width="300" src="docs/assets/popup-running.png" alt="The popup during a run">
</picture>
</td>
<td valign="top">

**`background.js`** runs the queue. It downloads `accounts.json` and `removed.json`, saves progress in `chrome.storage.local`, and paces each step.

**`content.js`** works the pinned tab. It opens `x.com/i/user/ID`, checks the @username, and clicks ··· → Block @username → Block, the same as you would.

**`hook.js`** runs in the page and reads only the rate-limit headers on X's own API responses, so the extension waits exactly as long as X asks.

**`popup.*`** is what you see: run state, progress, counts, settings and activity.

**Remembering what it's done:** blocked accounts are skipped for good, including any you unblocked yourself since. Suspended or deleted accounts are checked again after 30 days. On an error it waits 15 minutes and retries twice.

</td>
</tr>
</table>

## Repository

```
extension/   the Chrome extension (load unpacked, or zip for the store)
docs/        the website, served by GitHub Pages
```

Package for the Chrome Web Store:

```bash
cd extension && zip -r ../reply-hygiene.zip . -x '.*'
```

## Know before you run it

> [!WARNING]
> X treats fast automated browsing as unusual activity. In testing, X's Cloudflare security started refusing profile lookups after about a dozen fast automated profile opens. Reply Hygiene goes slowly and stops when X refuses, but it can still get your session or IP temporarily blocked by X. Use it at your own risk.

## Support the project

Reply Hygiene is free, with no ads and no paid tier. If it saves you some scrolling, you can [sponsor it on GitHub](https://github.com/sponsors/CyrisXD) to help cover the time spent keeping it working as X changes.

## License

[MIT](LICENSE). Reply Hygiene is independent of X Corp. and of the authors of blockedforaireply.com.
