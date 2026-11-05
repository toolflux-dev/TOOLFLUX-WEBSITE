// Drawing to STEP backend: loads the REAL dts-sync.gs into a Node vm with stubbed
// Apps Script services. Run: node --test tests/dts-sync.test.js tests/dts-order.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'dts-sync.gs'), 'utf8');
const SECRET = 'rzp_secret_test_123';
const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b)); // Apps Script bytes are signed

function load(opts = {}) {
  const props = Object.assign({ RZP_KEY_ID: 'rzp_test_KEY', RZP_KEY_SECRET: SECRET, DESK_KEY: 'desk-key-xyz', ROOT_FOLDER_ID: 'root', SHEET_ID: 'sheet', FREE_LIMIT: '0' }, opts.props);
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
const sig = (o, p) => crypto.createHmac('sha256', SECRET).update(o + '|' + p).digest('hex');
const col = name => ['created', 'orderId', 'status', 'name', 'email', 'phone', 'company', 'part', 'units', 'material', 'notes', 'files', 'folderId', 'rzpOrderId', 'paymentId', 'paidAt', 'deliveredAt', 'amount', 'log', 'free'].indexOf(name);

test('create saves files, opens a ₹79 Razorpay order, records awaiting_payment', () => {
  const g = load();
  const r = g.call(order());
  assert.equal(r.ok, true);
  assert.match(r.orderId, /^DTS-261105-[2-9A-Z]{4}$/);
  assert.equal(r.amount, 7900);
  assert.equal(r.keyId, 'rzp_test_KEY');
  const rz = JSON.parse(g.fetches[0].o.payload);
  assert.equal(rz.amount, 7900); assert.equal(rz.currency, 'INR'); assert.equal(rz.receipt, r.orderId);
  assert.equal(g.rows.length, 2);
  const row = g.rows[1];
  assert.equal(row[col('status')], 'awaiting_payment');
  assert.equal(row[col('email')], 'ravi@shop.in');
  assert.equal(row[col('phone')], '9845012345');
  const folder = g.folders[row[col('folderId')]];
  assert.deepEqual(folder.files.map(f => f.name).sort(), ['flange.dxf', 'flange.pdf', 'order.txt']);
  assert.equal(folder.files.find(f => f.name === 'flange.pdf').bytes.toString(), '%PDF-1.4 test');
});

test('create refuses CAD-only uploads, wrong types, too many files and bad contact details', () => {
  const g = load();
  const cases = [
    [{ files: [{ name: 'a.dwg', b64: b64('x') }] }, /PDF or photo/],
    [{ files: [{ name: 'a.exe', b64: b64('x') }] }, /not a PDF/],
    [{ files: [1, 2, 3, 4].map(i => ({ name: i + '.pdf', b64: b64('x') })) }, /at most 3/],
    [{ email: 'nope@' }, /valid email/],
    [{ phone: '12345' }, /10-digit/],
    [{ part: '  ' }, /part name/],
    [{ files: [] }, /Attach the drawing/],
  ];
  for (const [over, re] of cases) {
    const r = g.call(order(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.message, re);
  }
  assert.equal(g.rows.length, 0 + (g.rows.length ? 1 : 0)); // header at most, no orders
  assert.equal(g.fetches.length, 0, 'Razorpay never called for a rejected order');
});

test('verify: a correct signature marks the order paid once and sends two emails', () => {
  const g = load();
  const c = g.call(order());
  const v = { action: 'verify', orderId: c.orderId, razorpay_order_id: c.rzpOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sig(c.rzpOrderId, 'pay_1') };
  assert.equal(g.call(v).ok, true);
  assert.equal(g.rows[1][col('status')], 'paid');
  assert.equal(g.rows[1][col('paymentId')], 'pay_1');
  assert.equal(g.mails.length, 2);
  assert.equal(g.mails[0].to, 'ravi@shop.in');
  assert.equal(g.mails[1].to, 'toolflux@gmail.com');
  assert.equal(g.call(v).ok, true, 'second verify is harmless');
  assert.equal(g.mails.length, 2, 'no duplicate emails');
});

test('verify: a forged signature or another order\'s payment is refused', () => {
  const g = load();
  const c = g.call(order());
  const bad = g.call({ action: 'verify', orderId: c.orderId, razorpay_order_id: c.rzpOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sig(c.rzpOrderId, 'pay_2') });
  assert.equal(bad.ok, false);
  const other = g.call({ action: 'verify', orderId: c.orderId, razorpay_order_id: 'order_other', razorpay_payment_id: 'pay_1', razorpay_signature: sig('order_other', 'pay_1') });
  assert.equal(other.ok, false);
  assert.match(other.message, /different order/);
  assert.equal(g.rows[1][col('status')], 'awaiting_payment');
  assert.equal(g.mails.length, 0);
});

test('status: only the order\'s own email sees it; a captured payment is picked up from Razorpay', () => {
  const g = load();
  const c = g.call(order());
  assert.equal(g.call({ action: 'status', orderId: c.orderId, email: 'someone@else.in' }).ok, false);
  assert.equal(g.call({ action: 'status', orderId: c.orderId, email: 'ravi@shop.in' }).status, 'awaiting_payment');
  const g2 = load({ rzpPayments: { order_1: [{ id: 'pay_9', status: 'captured' }] } });
  const c2 = g2.call(order());
  const s = g2.call({ action: 'status', orderId: c2.orderId, email: 'RAVI@shop.in' });
  assert.equal(s.status, 'in_progress');
  assert.equal(g2.rows[1][col('paymentId')], 'pay_9');
});

test('desk: needs the key; queue lists paid orders; deliver emails the STEP and closes the order', () => {
  const g = load();
  const c = g.call(order());
  assert.equal(g.call({ action: 'queue', key: 'wrong' }).error, 'forbidden');
  assert.equal(g.call({ action: 'queue' }).error, 'forbidden');
  assert.equal(g.call({ action: 'queue', key: 'desk-key-xyz' }).orders.length, 0, 'unpaid orders are not work');
  g.call({ action: 'verify', orderId: c.orderId, razorpay_order_id: c.rzpOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sig(c.rzpOrderId, 'pay_1') });
  const q = g.call({ action: 'queue', key: 'desk-key-xyz' });
  assert.equal(q.orders.length, 1);
  assert.equal(q.orders[0].files.length, 2);
  const f = g.call({ action: 'file', key: 'desk-key-xyz', orderId: c.orderId, fileId: q.orders[0].files[0].id });
  assert.equal(Buffer.from(f.b64, 'base64').toString(), '%PDF-1.4 test');
  assert.equal(g.call({ action: 'file', key: 'desk-key-xyz', orderId: c.orderId, fileId: 'file-not-ours' }).ok, false);
  assert.equal(g.call({ action: 'mark', key: 'desk-key-xyz', orderId: c.orderId, status: 'review' }).status, 'review');
  assert.equal(g.call({ action: 'mark', key: 'desk-key-xyz', orderId: c.orderId, status: 'delivered' }).ok, false, 'desk cannot fake delivery');
  assert.match(g.call({ action: 'deliver', key: 'desk-key-xyz', orderId: c.orderId, files: [{ name: 'x.png', b64: b64('png') }] }).message, /No STEP/);
  const before = g.mails.length;
  const d = g.call({ action: 'deliver', key: 'desk-key-xyz', orderId: c.orderId, message: 'Bore modelled at mid-tolerance.', files: [{ name: 'Flange 014.step', b64: b64('ISO-10303-21;') }] });
  assert.equal(d.ok, true);
  assert.equal(g.rows[1][col('status')], 'delivered');
  const m = g.mails[before];
  assert.equal(m.to, 'ravi@shop.in');
  assert.equal(m.attachments[0].name, 'Flange 014.step');
  assert.match(m.htmlBody, /mid-tolerance/);
  assert.equal(g.call({ action: 'deliver', key: 'desk-key-xyz', orderId: c.orderId, files: [{ name: 'a.step', b64: b64('x') }] }).ok, false, 'no second delivery');
});

test('cleanup expires unpaid orders older than 3 days and bins their drawings', () => {
  const g = load();
  const c = g.call(order());
  g.rows[1][col('created')] = new Date(Date.now() - 4 * 864e5);
  g.sandbox.cleanup();
  assert.equal(g.rows[1][col('status')], 'expired');
  assert.equal(g.folders[g.rows[1][col('folderId')]].trashed, true);
});

test('one email can open at most 6 orders an hour', () => {
  const g = load();
  for (let i = 0; i < 6; i++) assert.equal(g.call(order()).ok, true);
  const r = g.call(order());
  assert.equal(r.ok, false);
  assert.match(r.message, /Too many/);
});

test('free launch: first parts are free, one per customer, then paid', () => {
  const g = load({ props: { FREE_LIMIT: '2' } });
  assert.deepEqual(g.call({ action: 'info' }), { ok: true, freeLeft: 2, freeLimit: 2, paid: true });
  const a = g.call(order());
  assert.equal(a.free, true);
  assert.equal(g.fetches.length, 0, 'no Razorpay order for a free part');
  const rowA = g.rows.find(r => r[col('orderId')] === a.orderId);
  assert.equal(rowA[col('status')], 'paid');
  assert.equal(rowA[col('free')], 'yes');
  assert.equal(rowA[col('amount')], 0);
  assert.equal(g.mails.length, 2);
  assert.match(g.mails[0].htmlBody, /free/);
  assert.doesNotMatch(g.mails[0].htmlBody, /Fusion/);
  assert.match(g.mails[1].subject, /^FREE order \(1 free left\)/);

  const again = g.call(order({ email: 'other@shop.in' })); // same phone, new email
  assert.equal(again.free, undefined, 'same phone does not get a second free part');
  assert.ok(again.rzpOrderId);

  const b = g.call(order({ email: 'b@works.in', phone: '9000000001' }));
  assert.equal(b.free, true);
  assert.equal(g.call({ action: 'info' }).freeLeft, 0);
  const c = g.call(order({ email: 'c@works.in', phone: '9000000002' }));
  assert.equal(c.free, undefined, 'after the limit everyone pays');

  // free orders are work in the desk, and their delivery asks for feedback
  const q = g.call({ action: 'queue', key: 'desk-key-xyz' });
  assert.deepEqual(q.orders.map(o => o.orderId).sort(), [a.orderId, b.orderId].sort());
  g.call({ action: 'deliver', key: 'desk-key-xyz', orderId: a.orderId, files: [{ name: 'p.step', b64: b64('ISO-10303-21;') }] });
  assert.match(g.mails[g.mails.length - 1].htmlBody, /feedback/);
});

test('free launch without Razorpay keys: a second part is refused before anything is stored', () => {
  const g = load({ props: { FREE_LIMIT: '5', RZP_KEY_ID: undefined, RZP_KEY_SECRET: undefined } });
  assert.equal(g.call({ action: 'info' }).paid, false);
  assert.equal(g.call(order()).free, true);
  const folders = Object.keys(g.folders).length;
  const r = g.call(order());
  assert.equal(r.ok, false);
  assert.match(r.message, /free part is already used/);
  assert.equal(Object.keys(g.folders).length, folders, 'no Drive folder for a refused order');
});
