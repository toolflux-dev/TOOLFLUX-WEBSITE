// Loads the REAL machlog-sync.gs into a Node vm with stubbed Apps Script
// globals, so webhook / licensing / device logic can be tested offline.
// Set GS_SRC to point at another copy (e.g. `git show HEAD:machlog-sync.gs`).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const GS_PATH = process.env.GS_SRC || path.join(__dirname, '..', '..', 'machlog-sync.gs');
const SOLO = 'plan_T1e4VFqtRs0qPR';

function makeSheet() {
  const rows = [];
  const api = {
    _rows: rows,
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    appendRow: r => { rows.push(r.slice()); },
    clearContents: () => { rows.length = 0; },
    setFrozenRows: () => api,
    deleteRows: (start, count) => { rows.splice(start - 1, count); },
    deleteRow: i => { rows.splice(i - 1, 1); },
    getRange: (r, c) => {
      const range = {
        getValue: () => ((rows[r - 1] || [])[c - 1] ?? ''),
        setValue: v => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return range; },
        setValues: vals => {
          vals.forEach((row, i) => { while (rows.length <= r - 1 + i) rows.push([]); rows[r - 1 + i] = row.slice(); });
          return range;
        },
      };
      // header() chains style setters, so each must return the range
      ['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setNumberFormat', 'setWrap']
        .forEach(m => { range[m] = () => range; });
      return range;
    },
  };
  return api;
}

function okResponse(body) {
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body || {}) };
}

// opts.props  — extra Script Properties
// opts.fetch  — (url, options) => { getResponseCode, getContentText }
function loadGas(opts = {}) {
  const props = Object.assign({
    WEBHOOK_SECRET: 'test-webhook-secret-0123456789abcdef',
    TOKEN_HMAC_SECRET: 'test-token-hmac-secret-0123456789',
  }, opts.props || {});
  const sheets = {};
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()) };
  const fetchCalls = [];
  const fetchImpl = opts.fetch || (() => okResponse({}));
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    SpreadsheetApp: { openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: t => ({ setMimeType: () => t }),
    },
    Utilities: {
      computeHmacSha256Signature: (data, key) =>
        Array.from(crypto.createHmac('sha256', key).update(data).digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: s => Buffer.from(s).toString('base64'),
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        fetchCalls.push({ url, method: (o && o.method) || 'get', payload: o && o.payload });
        return fetchImpl(url, o);
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(GS_PATH, 'utf8'), sandbox, { filename: 'machlog-sync.gs' });
  return {
    gs: sandbox,
    ss,
    fetchCalls,
    secret: props.WEBHOOK_SECRET,
    rows: name => (sheets[name] ? sheets[name]._rows.slice(1) : []), // data rows, no header
    header: name => (sheets[name] ? sheets[name]._rows[0] : null),
  };
}

const nowSec = () => Math.floor(Date.now() / 1000);

// A subscription.* event. payId: undefined → random payment id, null → no payment entity.
function subEvent(event, { email, planId = SOLO, subId = 'sub_A', payId, currentEnd } = {}) {
  const payload = {
    subscription: { entity: { id: subId, plan_id: planId, current_end: currentEnd || nowSec() + 30 * 86400, notes: { email } } },
  };
  if (payId !== null) payload.payment = { entity: { id: payId || 'pay_' + crypto.randomBytes(5).toString('hex'), email } };
  return { event, payload };
}

// A Wix-storefront-style sale: payment.captured with NO subscription entity.
function standalonePayment(email) {
  return { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wix_' + crypto.randomBytes(4).toString('hex'), email } } } };
}

function post(env, obj, secret = env.secret) {
  return env.gs.doPost({ postData: { contents: JSON.stringify(obj) }, parameter: { wh_secret: secret } });
}

function get(env, params) {
  const out = env.gs.doGet({ parameter: params });
  return typeof out === 'string' && out.charAt(0) === '{' ? JSON.parse(out) : out;
}

module.exports = { loadGas, subEvent, standalonePayment, post, get, okResponse, SOLO };
