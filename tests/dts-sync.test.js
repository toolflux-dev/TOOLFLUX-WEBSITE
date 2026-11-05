// Drawing to STEP backend (open for all): loads the REAL dts-sync.gs into a Node vm with stubbed
// Apps Script services. Run: node --test tests/dts-*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'dts-sync.gs'), 'utf8');
const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b)); // Apps Script bytes are signed

function load(opts = {}) {
  const props = Object.assign({ DESK_KEY: 'desk-key-xyz', ROOT_FOLDER_ID: 'root', SHEET_ID: 'sheet' }, opts.props);
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  const rows = [];
  const sheet = {
    appendRow: r => rows.push(r.slice()), setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (r, c) => ({ setValue: v => { rows[r - 1][c - 1] = v; } }),
  };
  let ssSheet = null;
  const folders = {}; let fid = 0;
  const mkFolder = name => {
    const id = 'f' + (++fid);
    const f = { id, name, files: [], trashed: false, getId: () => id,
      createFolder: n => mkFolder(n), setTrashed: t => { f.trashed = t; },
      createFile: (a, b, c) => { const blob = typeof a === 'string' ? { name: a, bytes: Buffer.from(b), mime: c } : a; const fileId = 'file' + (++fid); f.files.push(Object.assign({ id: fileId }, blob)); return { getId: () => fileId }; } };
    folders[id] = f; return f;
  };
  folders.root = Object.assign(mkFolder('root'), {}); folders.root.getId = () => 'root'; folders['root'] = folders.root;
  const mails = [], fetches = [];
  const cache = {};
  const rzpPayments = opts.rzpPayments || {};
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => ssSheet, insertSheet: () => (ssSheet = sheet) }) },
    DriveApp: {
      getFolderById: id => folders[id],
      getFileById: id => { for (const f of Object.values(folders)) { const hit = f.files.find(x => x.id === id); if (hit) return { getBlob: () => ({ getContentType: () => hit.mime, getBytes: () => signed(hit.bytes) }) }; } throw new Error('no file'); },
    },
    UrlFetchApp: { fetch: (url, o) => {
      fetches.push({ url, o });
      if (/\/v1\/orders$/.test(url)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'order_' + fetches.length }) };
      const m = /\/v1\/orders\/([^/]+)\/payments$/.exec(url);
      if (m) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ items: rzpPayments[m[1]] || [] }) };
      return { getResponseCode: () => 404, getContentText: () => '{}' };
    } },
    MailApp: { sendEmail: m => mails.push(m) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ body: JSON.parse(s) }) }) },
    Logger: { log() {} },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
    Utilities: {
      base64Decode: s => signed(Buffer.from(s, 'base64')),
      base64Encode: x => Buffer.from(typeof x === 'string' ? x : x.map(b => b & 255)).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes: Buffer.from(bytes.map(b => b & 255)), mime, name }),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', k).update(v).digest()),
      computeDigest: (_a, v) => signed(crypto.createHash('md5').update(v).digest()),
      DigestAlgorithm: { MD5: 'md5' },
      formatDate: (d, _tz, f) => (f === 'yyMMdd' ? '261105' : '2026-11-05 10:00'),
      getUuid: () => crypto.randomUUID(),
    },
    Date, JSON, Math, String, Number, Array, Object, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const call = body => sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).body;
  return { call, rows, mails, fetches, folders, sandbox, cache };
}

const b64 = s => Buffer.from(s).toString('base64');
const order = (over = {}) => Object.assign({ action: 'create', name: 'Ravi', email: 'Ravi@Shop.in', phone: '98450 12345', part: 'Flange 014', units: 'mm',
  files: [{ name: 'flange.pdf', b64: b64('%PDF-1.4 test') }, { name: 'flange.dxf', b64: b64('0\nSECTION') }] }, over);
const COLS = ['created', 'orderId', 'status', 'name', 'email', 'phone', 'company', 'part', 'units', 'material', 'notes', 'files', 'folderId', 'rzpOrderId', 'paymentId', 'paidAt', 'deliveredAt', 'amount', 'log', 'free'];
const col = n => COLS.indexOf(n);
const K = 'desk-key-xyz';

test('create queues the order at once: no payment, files on Drive, receipt + owner email', () => {
  const g = load();
  const r = g.call(order());
  assert.equal(r.ok, true);
  assert.match(r.orderId, /^DTS-261105-[2-9A-Z]{4}$/);
  assert.equal(r.rzpOrderId, undefined);
  assert.equal(g.fetches.length, 0, 'no payment provider is ever called');
  const row = g.rows[1];
  assert.equal(row[col('status')], 'queued');
  assert.equal(row[col('email')], 'ravi@shop.in');
  const folder = g.folders[row[col('folderId')]];
  assert.deepEqual(folder.files.map(f => f.name).sort(), ['flange.dxf', 'flange.pdf', 'order.txt']);
  assert.equal(g.mails.length, 2);
  assert.equal(g.mails[0].to, 'ravi@shop.in');
  assert.match(g.mails[0].htmlBody, /Sit tight/);
  assert.doesNotMatch(g.mails[0].htmlBody, /₹|Fusion|free|paid|payment/i);
  assert.match(g.mails[1].subject, /^New order · DTS-/);
  assert.equal(g.call({ action: 'info' }).open, true);
});

test('create accepts any drawing up to 10 files, and still refuses junk', () => {
  const g = load();
  const ten = Array.from({ length: 10 }, (_, i) => ({ name: 'sheet' + i + '.pdf', b64: b64('%PDF ' + i) }));
  assert.equal(g.call(order({ files: ten, part: 'Gearbox housing assembly' })).ok, true);
  const cases = [
    [{ files: [{ name: 'a.dwg', b64: b64('x') }] }, /PDF or photo/],
    [{ files: [{ name: 'a.exe', b64: b64('x') }] }, /not a PDF/],
    [{ files: Array.from({ length: 11 }, (_, i) => ({ name: i + '.pdf', b64: b64('x') })) }, /at most 10/],
    [{ email: 'nope@' }, /valid email/],
    [{ phone: '12345' }, /10-digit/],
    [{ part: '  ' }, /part name/],
    [{ files: [] }, /Attach the drawing/],
  ];
  for (const [over, re] of cases) {
    const r = g.call(order(Object.assign({ email: 'x' + Math.random() + '@a.in' }, over)));
    assert.equal(r.ok, false, JSON.stringify(over).slice(0, 60));
    assert.match(r.message, re);
  }
});

test("status: only the order's own email sees it", () => {
  const g = load();
  const c = g.call(order());
  assert.equal(g.call({ action: 'status', orderId: c.orderId, email: 'x@y.in' }).ok, false);
  assert.equal(g.call({ action: 'status', orderId: c.orderId, email: 'RAVI@shop.in' }).status, 'in_progress');
});

test('desk: key required; queue, file, hold with a note emails Roo, deliver emails the STEP with a feedback ask', () => {
  const g = load();
  const c = g.call(order());
  assert.equal(g.call({ action: 'queue', key: 'wrong' }).error, 'forbidden');
  const q = g.call({ action: 'queue', key: K });
  assert.equal(q.orders.length, 1);
  assert.equal(q.orders[0].status, 'queued');
  const f = g.call({ action: 'file', key: K, orderId: c.orderId, fileId: q.orders[0].files[0].id });
  assert.equal(Buffer.from(f.b64, 'base64').toString(), '%PDF-1.4 test');
  assert.equal(g.call({ action: 'mark', key: K, orderId: c.orderId, status: 'modelling' }).status, 'modelling');
  const before = g.mails.length;
  assert.equal(g.call({ action: 'mark', key: K, orderId: c.orderId, status: 'held', note: 'Bore depth missing on section A-A', notify: true }).status, 'held');
  assert.equal(g.mails.length, before + 1);
  assert.match(g.mails[before].subject, /^Needs you · held · DTS-/);
  assert.match(g.mails[before].body, /Bore depth missing/);
  assert.equal(g.call({ action: 'queue', key: K }).orders.length, 1, 'held orders stay on the list');
  assert.equal(g.call({ action: 'mark', key: K, orderId: c.orderId, status: 'delivered' }).ok, false, 'desk cannot fake delivery');
  assert.match(g.call({ action: 'deliver', key: K, orderId: c.orderId, files: [{ name: 'x.png', b64: b64('png') }] }).message, /No STEP/);
  const d = g.call({ action: 'deliver', key: K, orderId: c.orderId, message: 'Threads modelled at tap-drill size.', files: [{ name: 'Flange 014.step', b64: b64('ISO-10303-21;') }] });
  assert.equal(d.ok, true);
  const m = g.mails[g.mails.length - 1];
  assert.equal(m.attachments[0].name, 'Flange 014.step');
  assert.match(m.htmlBody, /feedback/);
  assert.match(m.htmlBody, /tap-drill/);
  assert.equal(g.rows[1][col('status')], 'delivered');
  assert.equal(g.call({ action: 'deliver', key: K, orderId: c.orderId, files: [{ name: 'a.step', b64: b64('x') }] }).ok, false, 'no second delivery');
  assert.equal(g.call({ action: 'queue', key: K }).orders.length, 0);
});

test('rows left over from the paid launch still show up as work', () => {
  const g = load();
  const c = g.call(order());
  g.rows[1][col('status')] = 'paid';
  const q = g.call({ action: 'queue', key: K });
  assert.equal(q.orders[0].status, 'queued');
  assert.equal(g.call({ action: 'deliver', key: K, orderId: c.orderId, files: [{ name: 'a.step', b64: b64('x') }] }).ok, true);
});

test('spam guard: 6 uploads an hour per email', () => {
  const g = load();
  for (let i = 0; i < 6; i++) assert.equal(g.call(order()).ok, true);
  const r = g.call(order());
  assert.equal(r.ok, false);
  assert.match(r.message, /Too many/);
});
