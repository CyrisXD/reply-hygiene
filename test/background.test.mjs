// Runs background.js against a fake chrome.* API and a fake x.com tab. No dependencies: `node test/background.test.mjs`
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setImmediate(r));

function load({ accounts, removed = [], done = {}, step }) {
  const store = { done: structuredClone(done) };
  const listeners = {};
  const on = name => ({ addListener: f => (listeners[name] = f) });
  const visited = [];
  const chrome = {
    storage: { local: {
      get: async keys => Object.fromEntries([keys].flat().filter(k => k in store).map(k => [k, structuredClone(store[k])])),
      set: async o => Object.assign(store, structuredClone(o)),
    } },
    alarms: { create() {}, clear: async () => true, get: async () => null, onAlarm: on('alarm') },
    runtime: { id: 'me', onStartup: on('startup'), onInstalled: on('installed'), onMessage: on('message') },
    action: { setBadgeText() {} },
    tabs: {
      get: async () => ({ id: 1, url: 'https://x.com/home' }),
      create: async () => ({ id: 1 }),
      update: async () => {},
      sendMessage: async (_, msg) => {
        if (msg.type === 'ping') return { loggedIn: true, english: true };
        visited.push(`${msg.mode}:${msg.id}`);
        return { result: await step(msg, store), rl: {} };
      },
    },
  };
  const json = body => ({ ok: true, json: async () => body });
  const fetch = async url => json(url.endsWith('accounts.json') ? { updated_at: 'now', accounts } : { accounts: removed });
  // Instant sleeps, so a whole run takes milliseconds.
  const ctx = { chrome, fetch, setTimeout: f => setImmediate(f), Date, Promise, String, Number, Array, Object, Math, JSON };
  vm.runInNewContext(src, ctx);
  const send = msg => new Promise(r => listeners.message(msg, { id: 'me' }, r));
  const settle = async () => { for (let i = 0; i < 200; i++) await tick(); };
  return { store, visited, send, settle };
}

// 1. Only numeric IDs from the list are ever visited, and a full run blocks, then undoes appeals.
{
  const t = load({
    accounts: [
      { id: '111', username: 'alpha', status: 'confirmed' },
      { id: '../settings/deactivate', username: 'evil', status: 'confirmed' },
      { id: '222"]', username: 'quote', status: 'confirmed' },
      { id: 333, username: 'beta', status: 'likely' },
      { id: '444', username: 'gamma', status: 'flagged' }, // not selected
    ],
    removed: [{ id: '900', username: 'appealed' }, { id: '901', username: 'mine' }],
    done: { 900: 'blocked', 901: 'already' }, // 901 was blocked by the user, not by us
    step: async msg => msg.mode === 'block' ? 'blocked' : 'unblocked',
  });
  assert.equal(await t.send({ cmd: 'start', statuses: ['confirmed', 'likely'] }), true);
  await t.settle();
  assert.deepEqual(t.visited, ['block:111', 'block:333', 'unblock:900']);
  assert.equal(t.store.st.phase, 'done');
  assert.deepEqual(t.store.st.counts, { blocked: 2, already: 0, gone: 0, failed: 0, unblocked: 1, notblocked: 0 });
  assert.equal(t.store.done[111], 'blocked');
  assert.equal(t.store.done[900], 'unblocked');
  assert.equal(t.store.done[901], 'already'); // the user's own block is left alone
}

// 2. Pausing while an account is being blocked still records that it was blocked.
{
  let t;
  t = load({
    accounts: [{ id: '1', username: 'a', status: 'confirmed' }, { id: '2', username: 'b', status: 'confirmed' }],
    step: async () => { await t.send({ cmd: 'pause' }); return 'blocked'; },
  });
  await t.send({ cmd: 'start', statuses: ['confirmed'] });
  await t.settle();
  assert.deepEqual(t.visited, ['block:1']);
  assert.equal(t.store.st.running, false);
  assert.equal(t.store.done[1], 'blocked');
}

// 3. Starting a new run while the old one is mid-step doesn't apply the old result to the new queue.
{
  let t, restarted = false;
  t = load({
    accounts: [{ id: '1', username: 'a', status: 'confirmed' }, { id: '2', username: 'b', status: 'confirmed' }],
    step: async msg => {
      if (!restarted) { restarted = true; await t.send({ cmd: 'pause' }); await t.send({ cmd: 'start', statuses: ['confirmed'] }); }
      return 'blocked';
    },
  });
  await t.send({ cmd: 'start', statuses: ['confirmed'] });
  await t.settle();
  assert.equal(t.store.st.phase, 'done');
  assert.ok(t.visited.includes('block:2'), 'account 2 must not be skipped');
}

// 4. X's security refusing a request stops the run instead of retrying.
{
  const t = load({
    accounts: [{ id: '1', username: 'a', status: 'confirmed' }, { id: '2', username: 'b', status: 'confirmed' }],
    step: async () => 'refused',
  });
  await t.send({ cmd: 'start', statuses: ['confirmed'] });
  await t.settle();
  assert.deepEqual(t.visited, ['block:1']);
  assert.equal(t.store.st.running, false);
  assert.match(t.store.st.note, /refused/);
}

console.log('background: 4 checks passed');
