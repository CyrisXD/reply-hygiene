// Runs the queue: one account every 3-5 s in a pinned x.com tab, pausing whenever X's rate limit says so.
// Progress lives in chrome.storage, so a restarted browser or service worker carries on where it stopped.
const API = 'https://blockedforaireply.com/api/';
const ERROR_WAIT = 15 * 60e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getSt = async () => (await chrome.storage.local.get('st')).st;
const setSt = st => chrome.storage.local.set({ st });
let busy = false;

const ALL_STATUSES = ['confirmed', 'flagged', 'likely', 'unreviewed'];
const GONE_RECHECK = 30 * 864e5; // suspended accounts can come back, so look again after 30 days

// 'tick' runs every minute during a run (resumes after waits and restarts); 'auto' is the user's schedule.
chrome.alarms.onAlarm.addListener(a => a.name === 'auto' ? autoStart() : run());
chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const handlers = { start: () => start(msg.statuses), pause, schedule: () => schedule(msg.days) };
  const handler = handlers[msg.cmd];
  if (!handler) return;
  handler().then(() => reply(true), e => reply(String(e?.message || e)));
  return true;
});

// Chrome doesn't promise to keep alarms across browser restarts or extension updates, so put them back.
async function restore() {
  const { st, scheduleDays = 0 } = await chrome.storage.local.get(['st', 'scheduleDays']);
  if (scheduleDays && !await chrome.alarms.get('auto')) await schedule(scheduleDays);
  if (st?.running) { chrome.alarms.create('tick', { periodInMinutes: 1 }); run(); }
}

async function schedule(days) {
  await chrome.storage.local.set({ scheduleDays: days });
  await chrome.alarms.clear('auto');
  if (days) chrome.alarms.create('auto', { delayInMinutes: days * 1440, periodInMinutes: days * 1440 });
}

async function autoStart() {
  const { st, statuses = ALL_STATUSES } = await chrome.storage.local.get(['st', 'statuses']);
  if (!st?.running) await start(statuses); // if a run is going, or paused waiting on X, leave it be
}

// IDs come from a third-party list and end up in URLs and selectors, so only accept plain numeric X IDs.
const validIds = list => (Array.isArray(list) ? list : []).filter(a => /^\d{1,20}$/.test(String(a?.id)))
  .map(a => ({ ...a, id: String(a.id), username: String(a.username ?? '').replace(/[^\w]/g, '').slice(0, 15) || a.id }));

const isBlocked = v => v === 'blocked' || v === 'already';
const skipBlock = v => isBlocked(v) || (v?.startsWith('gone:') && Date.now() - Number(v.slice(5)) < GONE_RECHECK);

async function start(statuses) {
  const [acc, rem] = await Promise.all(['accounts.json', 'removed.json'].map(f =>
    fetch(API + f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); })));
  const { done = {} } = await chrome.storage.local.get('done');
  const wanted = validIds(acc.accounts).filter(a => statuses.includes(a.status));
  const st = {
    running: true, phase: 'block', i: 0, tries: 0, waitUntil: 0, note: '', log: [],
    listUpdated: acc.updated_at, startedAt: Date.now(),
    // Blocked in an earlier run: skip. You may have unblocked some on purpose since.
    queue: wanted.filter(a => !skipBlock(done[a.id])).map(a => [a.id, a.username]),
    // Removed after an appeal: undo only blocks this extension made. Blocks you made yourself stay.
    removed: validIds(rem.accounts).filter(a => done[a.id] === 'blocked').map(a => [a.id, a.username]),
    earlier: wanted.filter(a => isBlocked(done[a.id])).length,
    counts: { blocked: 0, already: 0, gone: 0, failed: 0, unblocked: 0, notblocked: 0 },
  };
  await setSt(st);
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  run();
}

async function pause() {
  const st = await getSt();
  if (st) { st.running = false; st.note = 'Paused'; await setSt(st); }
  chrome.alarms.clear('tick');
}

async function workerTab() {
  const { tabId } = await chrome.storage.local.get('tabId');
  const t = tabId && await chrome.tabs.get(tabId).catch(() => null);
  if (t?.url?.startsWith('https://x.com/')) return t.id;
  const n = await chrome.tabs.create({ url: 'https://x.com/home', active: false, pinned: true });
  await chrome.tabs.update(n.id, { autoDiscardable: false });
  await chrome.storage.local.set({ tabId: n.id });
  return n.id;
}

// Returns X's state in the worker tab: { loggedIn, english }, or null if the page never answered.
async function ready(tabId) {
  for (let k = 0; k < 20; k++) {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
    if (r) return r;
    await sleep(1500); // content script not loaded yet
  }
  return null;
}

// If X says a lookup or block budget is used up, wait until its reset time.
function rateLimitWait(rl = {}) {
  let wait = 0;
  for (const [ep, r] of Object.entries(rl)) {
    if (!/UserBy|blocks\//.test(ep) || r.remaining == null || Number(r.remaining) > 1) continue;
    wait = Math.max(wait, Number(r.reset) * 1000 - Date.now() + 5000);
  }
  return wait;
}

const OUTCOME = { blocked: 'blocked', already: 'already', gone: 'gone', unblocked: 'unblocked', notblocked: 'notblocked' };
async function remember(id, outcome) {
  const { done = {} } = await chrome.storage.local.get('done');
  done[id] = outcome === 'gone' ? 'gone:' + Date.now() : outcome;
  await chrome.storage.local.set({ done });
}

const log = (st, text, tone) => { st.log = [{ t: Date.now(), text, tone }, ...st.log].slice(0, 40); };
const SAID = {
  blocked: n => `Blocked @${n}`, already: n => `@${n} was already blocked`, gone: n => `@${n} is suspended or deleted`,
  unblocked: n => `Unblocked @${n} (removed from the list)`, notblocked: n => `@${n} wasn’t blocked`,
};

async function run() {
  if (busy) return;
  busy = true;
  try {
    for (let st = await getSt(); st?.running; st = await getSt()) {
      if (st.waitUntil > Date.now()) return; // the minute alarm calls run() again
      const list = st.phase === 'block' ? st.queue : st.removed;
      if (st.i >= list.length) {
        if (st.phase === 'block') { st.phase = 'unblock'; st.i = 0; await setSt(st); continue; }
        st.running = false; st.phase = 'done'; st.note = 'Finished'; st.finishedAt = Date.now();
        await setSt(st); chrome.alarms.clear('tick'); return;
      }
      const tab = await workerTab();
      const x = await ready(tab);
      if (!x?.loggedIn || !x.english) {
        st.running = false;
        st.note = !x ? 'x.com didn’t load in the pinned tab. Check your connection, then try again.'
          : !x.loggedIn ? 'Log in to x.com in the pinned tab, then press Start'
          : 'Reply Hygiene reads X’s English menus. Set X’s display language to English (Settings › Accessibility, display and languages), then try again.';
        await setSt(st); chrome.alarms.clear('tick'); return;
      }
      const [id, name] = list[st.i];
      const runId = st.startedAt;
      const { result, rl } = await chrome.tabs.sendMessage(tab, { type: 'step', id, mode: st.phase }).catch(() => ({ result: 'error' }));
      const limitWait = rateLimitWait(rl);
      st = await getSt();
      if (st?.startedAt !== runId) return; // a new run started meanwhile: this result belongs to the old one
      if (!st.running) { // paused mid-step: still remember what happened to this account
        if (OUTCOME[result]) await remember(id, OUTCOME[result]);
        return;
      }

      if (result === 'refused') { // X's security (Cloudflare) refused the request: that is a no, not a wait
        st.running = false;
        st.note = 'X refused the request (security block). Stopped. Use X normally for a while before trying again.';
        log(st, `X refused the request for @${name}. Stopped.`, 'danger');
        await setSt(st); chrome.alarms.clear('tick'); return;
      }
      if (result === 'ratelimited') { // not the account's fault: wait and retry it, however long that takes
        st.waitUntil = Date.now() + (limitWait || ERROR_WAIT);
        st.note = 'X rate limit: waiting';
        log(st, `X rate limit reached at @${name}. Waiting.`, 'warn');
        await setSt(st); return;
      }
      if (['error', 'timeout'].includes(result) && ++st.tries <= 2) {
        st.waitUntil = Date.now() + (limitWait || ERROR_WAIT);
        st.note = 'X showed an error: waiting';
        log(st, `X showed an error at @${name}. Retry ${st.tries} of 2 later.`, 'warn');
        await setSt(st); return;
      }
      const outcome = OUTCOME[result] || 'failed';
      st.counts[outcome]++;
      if (outcome !== 'failed') await remember(id, outcome);
      if (outcome === 'failed') log(st, `Couldn’t block @${name} (${result === 'mismatch' ? 'username didn’t match' : result})`, 'danger');
      else log(st, SAID[outcome](name));
      st.i++; st.tries = 0; st.note = '';
      if (limitWait > 0) { st.waitUntil = Date.now() + limitWait; st.note = 'Pacing to X rate limit'; }
      await setSt(st);
      chrome.action.setBadgeText({ text: String(st.counts.blocked || '') });
      await sleep(3000 + Math.random() * 2000);
    }
  } finally {
    busy = false;
  }
}
