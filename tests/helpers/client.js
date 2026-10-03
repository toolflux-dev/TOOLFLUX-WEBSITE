// Loads machlog.js into a Node vm with minimal browser stubs. Only the code
// BEFORE the "expose globals" marker is evaluated — everything after it is
// boot code (render, timers, service worker) that needs a real DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'machlog.js');
const MARKER = '// ── expose globals';

function loadClient() {
  const src = fs.readFileSync(SRC, 'utf8');
  const cut = src.indexOf(MARKER);
  if (cut < 0) throw new Error('expose-globals marker not found in machlog.js');
  const store = {};
  const fetchCalls = [];
  // Inert element: enough for toast() ($('#toasts').appendChild) and friends
  const sink = () => ({ appendChild() {}, remove() {}, setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const ctx = {
    // Timers are no-ops INSIDE the sandbox: saveDB() schedules a background
    // sync and toast() schedules its removal — neither may fire after a test.
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console, Date, JSON, Math, Promise,
    window: {},
    navigator: { onLine: true },
    location: { origin: 'http://localhost', pathname: '/machlog.html', search: '', protocol: 'http:', hostname: 'localhost' },
    // $ / $$ in machlog.js are consts over document.querySelector(All); tests
    // provide specific elements through ctx.__els instead of reassigning them.
    document: {
      addEventListener() {},
      createElement: sink,
      getElementById: () => null,
      querySelector: sel => ctx.__els[sel] || (sel === '#toasts' ? sink() : null),
      querySelectorAll: () => [],
    },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __nextJson: {},
    __els: {},
  };
  ctx.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(ctx.__nextJson) });
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(0, cut), ctx, { filename: 'machlog.js' });
  vm.runInContext('loadDB(); db.settings.company = "Test Works";', ctx);
  return {
    run: code => vm.runInContext(code, ctx),
    ctx,
    fetchCalls,
    flush: () => new Promise(r => setImmediate(r)), // Node's own scheduler, not the sandbox's
  };
}

// A syntactically valid licence token: 'TF' + 64 hex chars
const TOKEN = 'TF' + 'A'.repeat(64);

module.exports = { loadClient, TOKEN };
