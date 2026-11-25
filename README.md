# Reply Hygiene

A Chrome extension that blocks the AI and spam reply accounts on the public [blockedforaireply.com](https://blockedforaireply.com) list, slowly and within X's rate limits. It also unblocks accounts it blocked that were later removed from the list after an appeal. Blocks you made yourself are never undone.

- Website: https://cyrisxd.github.io/reply-hygiene/
- Privacy policy: https://cyrisxd.github.io/reply-hygiene/privacy.html
- Questions and bugs: [open an issue](https://github.com/CyrisXD/reply-hygiene/issues)
- Sponsor: https://github.com/sponsors/CyrisXD

## Repository

| Folder | What's in it |
|---|---|
| `extension/` | The extension. Load this folder unpacked, or zip its contents for the Chrome Web Store. |
| `docs/` | The website, served by GitHub Pages. |

## Run it from source

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.
3. Be logged in to x.com, click the extension icon, choose which review levels to block, and press **Start**.

It opens a pinned x.com tab and works there. Leave that tab alone and use X in other tabs as normal.

## How it works

- `background.js` runs the queue. It downloads `accounts.json` and `removed.json` from blockedforaireply.com, and saves progress in `chrome.storage.local`, so a run carries on after a browser restart.
- For each ID, `content.js` opens `x.com/i/user/ID` in the pinned tab and clicks ··· → Block @username → Block, the same as you would. It only blocks if the menu's @username matches the profile that ID opened.
- `hook.js` runs in the page and reads only the rate-limit headers on X's own API responses, so the extension can wait exactly as long as X asks.
- One account every 3 to 5 seconds. When a limit runs out it waits until X's reset time. On an error it waits 15 minutes and retries twice. If X's security refuses a request (HTTP 403), it stops.
- Each run only visits accounts it hasn't handled. Blocked accounts are skipped for good, including any you unblocked yourself since. Suspended or deleted accounts are checked again after 30 days.
- **Check for new accounts** can run it every day or every week while Chrome is open.

## Package for the Chrome Web Store

```bash
cd extension && zip -r ../reply-hygiene.zip . -x '.*'
```

## Know before you run it

X treats fast automated browsing as unusual activity. In testing, X's Cloudflare security started refusing profile lookups after about a dozen fast automated profile opens. Running this can get your session or IP temporarily blocked by X. Use it at your own risk.

## License

[MIT](LICENSE). Reply Hygiene is independent of X Corp. and of the authors of blockedforaireply.com.
