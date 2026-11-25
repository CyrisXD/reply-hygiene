const $ = s => document.querySelector(s);
const boxes = [...document.querySelectorAll('#statuses input')];
const ALL = ['confirmed', 'flagged', 'likely', 'unreviewed'];
const num = n => (n || 0).toLocaleString();
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const duration = ms => {
  const m = Math.max(1, Math.round(ms / 60e3));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim();
};

// One state for the whole popup, derived from the saved run.
function view(st, lifetime) {
  if (!st) return { tone: 'idle', pill: 'Ready', headline: 'Ready to start', button: 'Start',
    detail: 'Blocks the accounts on the public AI-reply list, one every few seconds, in a pinned x.com tab. You can keep using X as normal.' };
  const left = st.phase === 'block' ? st.queue.length - st.i + st.removed.length : st.removed.length - st.i;
  if (st.running && st.waitUntil > Date.now()) return { tone: 'warn', pill: 'Waiting', headline: 'Waiting for X',
    detail: `${WAIT_REASON[st.note] || 'X asked it to slow down.'} Carries on by itself at ${clock(st.waitUntil)}.` };
  if (st.running) return st.phase === 'unblock'
    ? { tone: 'active', pill: 'Running', headline: 'Checking removed accounts', detail: 'Unblocking accounts taken off the list after an appeal.' }
    : { tone: 'active', pill: 'Running', headline: 'Blocking accounts', detail: `About ${duration(left * 4000)} left if X doesn’t ask it to wait. Keep the pinned x.com tab open.` };
  if (st.phase === 'done') return { tone: 'active', pill: 'Done', headline: 'All caught up', button: 'Check again',
    detail: `${st.counts.blocked ? `Blocked ${num(st.counts.blocked)} new accounts this run` : 'No new accounts to block this run'}, ${num(lifetime)} in total since you installed it.` };
  if (st.note === 'Paused') return { tone: 'idle', pill: 'Paused', headline: 'Paused', button: 'Resume',
    detail: 'Resume picks up where it left off.' };
  return { tone: 'danger', pill: 'Stopped', headline: 'Stopped', button: 'Try again', detail: STOP_REASON(st.note) };
}

let firstRender = true;
let pending = null; // shown while Start is in flight, so the 1 s refresh can't overwrite it
const STOP_REASON = note =>
  /refused/i.test(note || '') ? 'X refused a request, so it stopped to keep your account safe. Use X normally for an hour before trying again.'
  : /log in/i.test(note || '') ? 'You’re not logged in to X in the pinned x.com tab. Log in there, then try again.'
  : note || 'The run stopped before it finished. Try again to carry on from where it left off.';
const WAIT_REASON = { 'X showed an error: waiting': 'X showed an error, so it’s giving X a break.', 'X rate limit: waiting': 'X’s rate limit ran out.', 'Pacing to X rate limit': 'Spacing blocks out to stay inside X’s rate limit.' };

async function render({ st, statuses = ALL, scheduleDays = 0, done = {} }) {
  const lifetime = Object.values(done).filter(v => v === 'blocked').length;
  const v = pending || view(st, lifetime);
  $('#state').textContent = v.pill;
  $('#state').dataset.tone = v.tone;
  $('.run').dataset.tone = v.tone;
  $('#headline').textContent = v.headline;
  $('#detail').textContent = v.detail;
  $('#start').hidden = !!st?.running;
  $('#start').textContent = v.button || 'Start';
  $('#pause').hidden = !st?.running;
  boxes.forEach(b => { b.checked = statuses.includes(b.value); b.disabled = !!st?.running; });
  // Open on first use; once a run exists it folds away, like Activity.
  if (firstRender) $('#statusGroup').open = !st;
  firstRender = false;
  const names = boxes.filter(b => b.checked).map(b => b.value);
  $('#statusSummary').textContent = '· ' + (names.length === ALL.length ? 'all' : names.length ? names.join(', ') : 'none');
  $('#start').disabled = pending?.pill === 'Starting' || !boxes.some(b => b.checked);
  if (document.activeElement !== $('#schedule')) $('#schedule').value = String(scheduleDays);

  const auto = await chrome.alarms.get('auto');
  $('#last').textContent = [st?.finishedAt && `Last run ${day(st.finishedAt)}`, auto && `Next ${day(auto.scheduledTime)}`].filter(Boolean).join(' · ');

  $('#progressBlock').hidden = $('#countsSection').hidden = $('#logSection').hidden = !st;
  if (!st) return;
  const total = st.queue.length + st.removed.length;
  const at = st.phase === 'done' ? total : (st.phase === 'unblock' ? st.queue.length : 0) + st.i;
  const pct = total ? Math.floor((at / total) * 100) : 100;
  $('#fill').style.transform = `scaleX(${pct / 100})`;
  $('#bar').setAttribute('aria-valuenow', pct);
  $('#progressText').textContent = `${num(at)} of ${num(total)} accounts this run`;
  $('#percent').textContent = pct + '%';

  const c = st.counts;
  $('#counts').replaceChildren(...[
    ['Blocked', c.blocked], ['Already blocked', c.already],
    ['Gone from X', c.gone], ['Couldn’t block', c.failed],
    ['Unblocked', c.unblocked], ['Blocked before', st.earlier],
  ].map(([k, n]) => {
    const row = document.createElement('div');
    if (!n) row.dataset.zero = '';
    row.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: num(n) }));
    return row;
  }));

  $('#logCount').textContent = st.log.length ? `· last ${st.log.length}` : '';
  $('#log').replaceChildren(...st.log.map(e => {
    const { t, text, tone } = typeof e === 'string' ? { text: e } : e;
    const li = document.createElement('li');
    if (tone) li.dataset.tone = tone;
    if (t) li.append(Object.assign(document.createElement('time'), { textContent: clock(t) }));
    li.append(Object.assign(document.createElement('span'), { textContent: text }));
    return li;
  }));
}

const refresh = () => chrome.storage.local.get(['st', 'statuses', 'scheduleDays', 'done']).then(render);
chrome.storage.onChanged.addListener(refresh);
setInterval(refresh, 1000); // keeps the wait time and estimate current
refresh();

boxes.forEach(b => b.onchange = () => chrome.storage.local.set({ statuses: boxes.filter(x => x.checked).map(x => x.value) }));
$('#schedule').onchange = e => chrome.runtime.sendMessage({ cmd: 'schedule', days: Number(e.target.value) });
$('#start').onclick = async () => {
  pending = { tone: 'active', pill: 'Starting', headline: 'Getting the latest list…', detail: 'Downloading the list from blockedforaireply.com.' };
  refresh();
  const r = await chrome.runtime.sendMessage({ cmd: 'start', statuses: boxes.filter(x => x.checked).map(x => x.value) });
  pending = r === true ? null : { tone: 'danger', pill: 'Error', headline: 'Couldn’t start', button: 'Try again',
    detail: `Couldn’t download the list (${r}). Check your connection and try again.` };
  if (pending) { const err = pending; refresh(); setTimeout(() => { if (pending === err) pending = null; }, 8000); }
  else refresh();
};
$('#pause').onclick = () => chrome.runtime.sendMessage({ cmd: 'pause' });
