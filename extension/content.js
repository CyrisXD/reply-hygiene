// Does one block/unblock at a time in the worker tab, through X's normal profile page:
// open x.com/i/user/ID, then ··· → "Block @username" → Block. Never touches any other account.
const rl = {};      // latest rate-limit info per X endpoint
const lookups = {}; // latest profile lookup per user ID
addEventListener('message', e => {
  const d = e.source === window && e.data?.bfarRL;
  if (!d) return;
  rl[d.ep] = d;
  if (d.userId) lookups[d.userId] = d;
});

const col = () => document.querySelector('[data-testid="primaryColumn"]');
const q = s => col()?.querySelector(s);
const btn = (id, kinds) => kinds.map(k => q(`[data-testid="${id}-${k}"]`)).find(Boolean);
const closeMenu = r => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return r; };

// Re-checks fn() on every DOM change. Timers are throttled in background tabs, DOM changes are not.
function waitFor(fn, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; obs.disconnect(); clearTimeout(timer); resolve(v); };
    const obs = new MutationObserver(() => { const v = fn(); if (v) finish(v); });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const timer = setTimeout(() => finish(fn() || null), ms);
    const v = fn(); if (v) finish(v);
  });
}

async function openProfile(id) {
  const t0 = Date.now();
  let settled = false;
  history.pushState({}, '', '/i/user/' + id); // X's own router, same as visiting x.com/i/user/ID
  dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  setTimeout(() => { settled = true; document.documentElement.dataset.bfarTick = t0; }, 2500); // nudge the observer
  return (await waitFor(() => {
    if (location.pathname === '/404') return 'gone';
    const gate = [...(col()?.querySelectorAll('[role="button"],button') || [])].find(b => /view profile/i.test(b.innerText));
    if (gate) { gate.click(); return null; } // "This account is temporarily restricted" interstitial
    if (btn(id, ['unblock'])) return 'blocked';
    if (q('[data-testid="userActions"]')) return btn(id, ['follow', 'unfollow', 'cancel']) ? 'ok' : null;
    const look = lookups[id]?.at >= t0 ? lookups[id] : null;
    if (look?.status === 429) return 'ratelimited';
    if (look?.status === 403) return 'refused'; // X's security turned the lookup away: stop, don't push on
    if (!look && !settled) return null; // old page may still be showing
    const text = document.querySelector('main')?.innerText || '';
    if (/account suspended|doesn.t exist|isn.t available/i.test(text)) return 'gone';
    // X shows "Something went wrong" both for deleted accounts and for errors; the lookup status tells them apart.
    if (/something went wrong|try reloading/i.test(text)) return look?.status === 200 ? 'gone' : 'error';
    return null;
  }, 20000)) || 'timeout';
}

async function block(id) {
  const handle = q('[data-testid="UserName"]')?.innerText.match(/@(\w+)/)?.[1];
  const more = q('[data-testid="userActions"]');
  if (!more) return 'error';
  more.click();
  const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')].find(m => /^(un)?block @\w+/i.test(m.innerText.trim())), 5000);
  if (!item) return closeMenu('error');
  const [, un, menuHandle] = item.innerText.trim().match(/^(un)?block @(\w+)/i);
  if (un) return closeMenu('already');
  if (!handle || menuHandle.toLowerCase() !== handle.toLowerCase()) return closeMenu('mismatch'); // never block anyone else
  item.click();
  const confirm = await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'), 5000);
  if (!confirm) return closeMenu('error');
  const t0 = Date.now();
  confirm.click();
  return (await waitFor(() => btn(id, ['unblock']) ? 'blocked' : apiResult('blocks/create.json', t0), 10000)) || 'error';
}

// 'ratelimited' or 'refused' if X answered this request with 429 or 403 after t0.
function apiResult(ep, t0) {
  const r = rl[ep]?.at >= t0 ? rl[ep].status : 0;
  return r === 429 ? 'ratelimited' : r === 403 ? 'refused' : null;
}

async function unblock(id) {
  const t0 = Date.now();
  const unblockButton = btn(id, ['unblock']);
  if (!unblockButton) return 'error';
  unblockButton.click();
  (await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'), 5000))?.click();
  return (await waitFor(() => btn(id, ['follow', 'unfollow', 'cancel']) ? 'unblocked' : apiResult('blocks/destroy.json', t0), 10000)) || 'error';
}

async function step(id, mode) {
  const s = await openProfile(id);
  if (s !== 'ok' && s !== 'blocked') return s; // gone | ratelimited | error | timeout
  if (mode === 'block') return s === 'blocked' ? 'already' : block(id);
  return s === 'blocked' ? unblock(id) : 'notblocked';
}

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === 'ping') {
    waitFor(() => document.querySelector('[data-testid="AppTabBar_Profile_Link"]'), 15000)
      .then(v => reply({ loggedIn: !!v, english: /^en\b/i.test(document.documentElement.lang || 'en') }));
    return true;
  }
  if (msg.type === 'step' && /^\d{1,20}$/.test(msg.id)) {
    step(msg.id, msg.mode).then(result => reply({ result, rl }), () => reply({ result: 'error', rl }));
    return true;
  }
});
