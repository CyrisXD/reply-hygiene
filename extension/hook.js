// Runs in X's page. Passes on the status and rate-limit headers of X's own API responses
// (never request headers, tokens or bodies), so the extension can wait exactly as long as X asks.
(() => {
  const isApi = url => /\/i\/api\/|\/\/api\.(x|twitter)\.com\//.test(url);
  function post(url, status, header) {
    const u = new URL(url, location.href);
    const ep = u.pathname.match(/\/graphql\/[^/]+\/(\w+)/)?.[1] || u.pathname.replace(/^.*\/1\.1\//, '');
    let userId = null;
    try { userId = JSON.parse(u.searchParams.get('variables') || '{}').userId || null; } catch {}
    window.postMessage({ bfarRL: { ep, userId, status, remaining: header('x-rate-limit-remaining'), reset: header('x-rate-limit-reset'), at: Date.now() } }, location.origin);
  }
  const realFetch = window.fetch;
  window.fetch = async function (...args) {
    const r = await realFetch.apply(window, args);
    try { if (isApi(r.url)) post(r.url, r.status, k => r.headers.get(k)); } catch {}
    return r;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('loadend', () => {
      try { if (isApi(this.responseURL)) post(this.responseURL, this.status, k => this.getResponseHeader(k)); } catch {}
    });
    return open.apply(this, args);
  };
})();
