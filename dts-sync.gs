/**
 * Drawing to STEP — order backend (Google Apps Script web app).
 *
 * The customer page (drawing-to-step.html) and the desk app on Roo's PC
 * (dts-desk.js) both talk to this one script.
 *
 *   create   customer  saves the drawing to Drive, opens a Razorpay order (₹79)
 *   verify   customer  checks the Razorpay checkout signature, marks the order paid
 *   status   customer  re-checks an order (asks Razorpay if the browser lost the reply)
 *   queue    desk      lists paid / in-progress orders
 *   file     desk      returns one drawing file (base64)
 *   mark     desk      sets an order's status (modelling, review, query, refunded)
 *   deliver  desk      saves the STEP to Drive and emails it to the customer
 *
 * Why no webhook: Apps Script cannot read request headers, so a Razorpay webhook
 * signature can't be checked here (see MACHLOG notes). The checkout handler's
 * signature arrives in the request BODY, which we can check, and `status` /
 * `queue` ask Razorpay directly for any order still waiting, so a payment is
 * never lost if the customer's browser closes before `verify` reaches us.
 *
 * Script Properties (set by setup() and by hand — see DRAWING-TO-STEP-SETUP.md):
 *   RZP_KEY_ID, RZP_KEY_SECRET   Razorpay API keys (live or test)
 *   DESK_KEY                     shared secret for the desk app (setup() makes it)
 *   ROOT_FOLDER_ID, SHEET_ID     made by setup()
 *   OWNER_EMAIL                  optional, defaults to toolflux@gmail.com
 */

var PRICE_PAISE = 7900;          // ₹79
var MAX_FILES = 3;
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var MAX_TOTAL_BYTES = 15 * 1024 * 1024;
var DRAWING_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
var CAD_EXT = ['dxf', 'dwg'];
var DELIVER_EXT = ['step', 'stp', 'pdf', 'png', 'jpg'];
var STATUSES = ['awaiting_payment', 'paid', 'modelling', 'review', 'query', 'delivered', 'refunded', 'expired'];
var DESK_STATUSES = ['modelling', 'review', 'query', 'refunded', 'paid'];
var COLS = ['created', 'orderId', 'status', 'name', 'email', 'phone', 'company', 'part', 'units',
  'material', 'notes', 'files', 'folderId', 'rzpOrderId', 'paymentId', 'paidAt', 'deliveredAt', 'amount', 'log'];
var SHEET_NAME = 'Orders';

// ───────────────────────────── entry points ─────────────────────────────

function doGet(e) {
  return json_({ ok: true, service: 'drawing-to-step' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    switch (body.action) {
      case 'create':  return json_(createOrder_(body));
      case 'verify':  return json_(verifyPayment_(body));
      case 'status':  return json_(orderStatus_(body));
      case 'queue':   requireDesk_(body); return json_(deskQueue_());
      case 'file':    requireDesk_(body); return json_(deskFile_(body));
      case 'mark':    requireDesk_(body); return json_(deskMark_(body));
      case 'deliver': requireDesk_(body); return json_(deskDeliver_(body));
      default:        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    var msg = String(err && err.message || err);
    if (msg === 'forbidden') return json_({ ok: false, error: 'forbidden' });
    if (msg.indexOf('user:') === 0) return json_({ ok: false, error: 'invalid', message: msg.slice(5) });
    Logger.log(err && err.stack || msg);
    return json_({ ok: false, error: 'server', message: 'Something went wrong on our side. Nothing was charged.' });
  }
}

// ───────────────────────────── customer ─────────────────────────────

function createOrder_(b) {
  var o = cleanOrder_(b);
  var files = checkFiles_(b.files);
  throttle_(o.email);

  var orderId = newOrderId_();
  var root = DriveApp.getFolderById(prop_('ROOT_FOLDER_ID'));
  var folder = root.createFolder(orderId + ' · ' + o.part.slice(0, 40));
  var saved = files.map(function (f) {
    var blob = Utilities.newBlob(f.bytes, f.mime, f.name);
    var df = folder.createFile(blob);
    return { id: df.getId(), name: f.name, size: f.bytes.length };
  });
  folder.createFile('order.txt', orderText_(orderId, o), 'text/plain');

  var rzp = razorpay_('post', '/v1/orders', {
    amount: PRICE_PAISE, currency: 'INR', receipt: orderId,
    notes: { order: orderId, part: o.part.slice(0, 200) }
  });

  withLock_(function () {
    sheet_().appendRow(rowFrom_({
      created: new Date(), orderId: orderId, status: 'awaiting_payment', name: o.name, email: o.email,
      phone: o.phone, company: o.company, part: o.part, units: o.units, material: o.material, notes: o.notes,
      files: JSON.stringify(saved), folderId: folder.getId(), rzpOrderId: rzp.id, paymentId: '',
      paidAt: '', deliveredAt: '', amount: PRICE_PAISE / 100, log: stamp_('created')
    }));
  });

  return { ok: true, orderId: orderId, rzpOrderId: rzp.id, keyId: prop_('RZP_KEY_ID'), amount: PRICE_PAISE,
    name: o.name, email: o.email, phone: o.phone };
}

function verifyPayment_(b) {
  var orderId = str_(b.orderId, 40);
  var rOrder = str_(b.razorpay_order_id, 60);
  var rPay = str_(b.razorpay_payment_id, 60);
  var sig = str_(b.razorpay_signature, 200);
  if (!orderId || !rOrder || !rPay || !sig) throw new Error('user:Payment details are missing.');

  var expected = hex_(Utilities.computeHmacSha256Signature(rOrder + '|' + rPay, prop_('RZP_KEY_SECRET')));
  if (!safeEqual_(expected, sig)) throw new Error('user:The payment could not be confirmed. If money left your account, WhatsApp us your order number.');

  var row = findOrder_(orderId);
  if (!row) throw new Error('user:Order not found.');
  if (row.data.rzpOrderId !== rOrder) throw new Error('user:That payment belongs to a different order.');
  markPaid_(row, rPay);
  return { ok: true, orderId: orderId, status: 'paid' };
}

function orderStatus_(b) {
  var orderId = str_(b.orderId, 40);
  var email = str_(b.email, 120).toLowerCase();
  var row = findOrder_(orderId);
  if (!row || row.data.email.toLowerCase() !== email) return { ok: false, error: 'not_found' };
  if (row.data.status === 'awaiting_payment') reconcile_(row);
  row = findOrder_(orderId);
  return { ok: true, orderId: orderId, status: publicStatus_(row.data.status) };
}

// ───────────────────────────── desk ─────────────────────────────

function deskQueue_() {
  var rows = allOrders_();
  var cutoff = Date.now() - 3 * 864e5;
  rows.forEach(function (r) {
    if (r.data.status === 'awaiting_payment' && new Date(r.data.created).getTime() > cutoff) reconcile_(r);
  });
  var open = allOrders_().filter(function (r) {
    return ['paid', 'modelling', 'review', 'query'].indexOf(r.data.status) >= 0;
  }).map(function (r) {
    var d = r.data;
    return { orderId: d.orderId, status: d.status, created: d.created, paidAt: d.paidAt, name: d.name,
      email: d.email, phone: d.phone, company: d.company, part: d.part, units: d.units, material: d.material,
      notes: d.notes, files: safeJson_(d.files, []), folderUrl: 'https://drive.google.com/drive/folders/' + d.folderId };
  });
  var recent = allOrders_().filter(function (r) { return r.data.status === 'delivered'; })
    .slice(-15).map(function (r) { return { orderId: r.data.orderId, part: r.data.part, name: r.data.name, deliveredAt: r.data.deliveredAt }; });
  return { ok: true, orders: open, delivered: recent };
}

function deskFile_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row) throw new Error('user:Order not found.');
  var files = safeJson_(row.data.files, []);
  var hit = files.filter(function (f) { return f.id === b.fileId; })[0];
  if (!hit) throw new Error('user:File is not part of this order.');
  var blob = DriveApp.getFileById(hit.id).getBlob();
  return { ok: true, name: hit.name, mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

function deskMark_(b) {
  var status = str_(b.status, 20);
  if (DESK_STATUSES.indexOf(status) < 0) throw new Error('user:Unknown status.');
  return withLock_(function () {
    var row = findOrder_(str_(b.orderId, 40));
    if (!row) throw new Error('user:Order not found.');
    if (row.data.status === 'awaiting_payment' || row.data.status === 'delivered') throw new Error('user:Order is ' + row.data.status + '.');
    setCells_(row, { status: status, log: row.data.log + '\n' + stamp_(status + (b.note ? ': ' + str_(b.note, 300) : '')) });
    return { ok: true, orderId: row.data.orderId, status: status };
  });
}

function deskDeliver_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row) throw new Error('user:Order not found.');
  if (['paid', 'modelling', 'review', 'query'].indexOf(row.data.status) < 0) throw new Error('user:Order is ' + row.data.status + '.');
  var files = (b.files || []).map(function (f) {
    var name = String(f.name || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    var ext = name.split('.').pop().toLowerCase();
    if (DELIVER_EXT.indexOf(ext) < 0) throw new Error('user:Cannot send .' + ext + ' files.');
    var bytes = Utilities.base64Decode(String(f.b64 || ''));
    return { name: name, ext: ext, bytes: bytes };
  });
  if (!files.some(function (f) { return f.ext === 'step' || f.ext === 'stp'; })) throw new Error('user:No STEP file to send.');
  var total = files.reduce(function (s, f) { return s + f.bytes.length; }, 0);
  if (total > 20 * 1024 * 1024) throw new Error('user:Files are over 20 MB together; email them by hand.');

  var folder = DriveApp.getFolderById(row.data.folderId);
  var out = folder.createFolder('delivered');
  var blobs = files.map(function (f) {
    var mime = (f.ext === 'step' || f.ext === 'stp') ? 'application/step' : (f.ext === 'pdf' ? 'application/pdf' : 'image/' + (f.ext === 'jpg' ? 'jpeg' : f.ext));
    var blob = Utilities.newBlob(f.bytes, mime, f.name);
    out.createFile(blob);
    return blob;
  });

  var d = row.data;
  MailApp.sendEmail({
    to: d.email,
    replyTo: ownerEmail_(),
    name: 'TOOLFLUX Drawing to STEP',
    subject: 'Your STEP model: ' + d.part + ' (' + d.orderId + ')',
    htmlBody: deliveryMail_(d, files.map(function (f) { return f.name; }), str_(b.message, 2000)),
    attachments: blobs
  });

  withLock_(function () {
    var fresh = findOrder_(d.orderId);
    setCells_(fresh, { status: 'delivered', deliveredAt: new Date(), log: fresh.data.log + '\n' + stamp_('delivered: ' + files.map(function (f) { return f.name; }).join(', ')) });
  });
  return { ok: true, orderId: d.orderId, status: 'delivered' };
}

// ───────────────────────────── payment ─────────────────────────────

function markPaid_(row, paymentId) {
  var first = withLock_(function () {
    var fresh = findOrder_(row.data.orderId);
    if (fresh.data.status !== 'awaiting_payment' && fresh.data.status !== 'expired') return false; // already paid: idempotent
    setCells_(fresh, { status: 'paid', paymentId: paymentId, paidAt: new Date(), log: fresh.data.log + '\n' + stamp_('paid ' + paymentId) });
    return true;
  });
  if (!first) return;
  var d = findOrder_(row.data.orderId).data;
  try {
    MailApp.sendEmail({
      to: d.email, replyTo: ownerEmail_(), name: 'TOOLFLUX Drawing to STEP',
      subject: 'Order received: ' + d.part + ' (' + d.orderId + ')',
      htmlBody: receiptMail_(d)
    });
    MailApp.sendEmail({
      to: ownerEmail_(), name: 'Drawing to STEP',
      subject: '₹79 paid · ' + d.orderId + ' · ' + d.part,
      body: orderText_(d.orderId, d) + '\nPayment: ' + paymentId + '\nDrive: https://drive.google.com/drive/folders/' + d.folderId
    });
  } catch (err) { Logger.log('mail failed: ' + err); }
}

// Ask Razorpay whether a waiting order was in fact paid.
function reconcile_(row) {
  if (!row.data.rzpOrderId) return;
  var res;
  try { res = razorpay_('get', '/v1/orders/' + row.data.rzpOrderId + '/payments'); }
  catch (err) { Logger.log('reconcile failed: ' + err); return; }
  var captured = (res.items || []).filter(function (p) { return p.status === 'captured'; })[0];
  if (captured) markPaid_(row, captured.id);
}

function razorpay_(method, path, payload) {
  var opts = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(prop_('RZP_KEY_ID') + ':' + prop_('RZP_KEY_SECRET')) }
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var r = UrlFetchApp.fetch('https://api.razorpay.com' + path, opts);
  var code = r.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('razorpay ' + code + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText());
}

// ───────────────────────────── validation ─────────────────────────────

function cleanOrder_(b) {
  var o = {
    name: str_(b.name, 80), email: str_(b.email, 120).toLowerCase(), phone: str_(b.phone, 20).replace(/[^\d+]/g, ''),
    company: str_(b.company, 120), part: str_(b.part, 120), units: b.units === 'inch' ? 'inch' : 'mm',
    material: str_(b.material, 80), notes: str_(b.notes, 1500)
  };
  if (!o.name) throw new Error('user:Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email)) throw new Error('user:Enter a valid email address.');
  if (o.phone.replace(/\D/g, '').length < 10) throw new Error('user:Enter a 10-digit phone number.');
  if (!o.part) throw new Error('user:Enter the part name or drawing number.');
  return o;
}

function checkFiles_(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('user:Attach the drawing.');
  if (list.length > MAX_FILES) throw new Error('user:Attach at most ' + MAX_FILES + ' files.');
  var total = 0, hasDrawing = false;
  var files = list.map(function (f) {
    var name = String(f.name || 'drawing').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    var ext = name.split('.').pop().toLowerCase();
    if (DRAWING_EXT.indexOf(ext) < 0 && CAD_EXT.indexOf(ext) < 0) throw new Error('user:' + name + ' is not a PDF, image, DXF or DWG.');
    if (DRAWING_EXT.indexOf(ext) >= 0) hasDrawing = true;
    var bytes = Utilities.base64Decode(String(f.b64 || ''));
    if (!bytes.length) throw new Error('user:' + name + ' is empty.');
    if (bytes.length > MAX_FILE_BYTES) throw new Error('user:' + name + ' is over 10 MB.');
    total += bytes.length;
    return { name: name, bytes: bytes, mime: mimeFor_(ext) };
  });
  if (!hasDrawing) throw new Error('user:Include a PDF or photo of the drawing, not only a CAD file.');
  if (total > MAX_TOTAL_BYTES) throw new Error('user:Files are over 15 MB together.');
  return files;
}

// At most 6 orders an hour from one email, so nobody can fill the Drive.
function throttle_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'dts_' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email)).slice(0, 20);
  var n = Number(cache.get(key) || 0);
  if (n >= 6) throw new Error('user:Too many orders from this email in the last hour. WhatsApp us instead.');
  cache.put(key, String(n + 1), 3600);
}

function requireDesk_(b) {
  var key = prop_('DESK_KEY');
  if (!key || !b || !safeEqual_(String(b.key || ''), key)) throw new Error('forbidden');
}

// ───────────────────────────── sheet ─────────────────────────────

function sheet_() {
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function allOrders_() {
  var values = sheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var data = {};
    COLS.forEach(function (c, j) { data[c] = values[i][j] === undefined ? '' : values[i][j]; });
    data.email = String(data.email); data.log = String(data.log || '');
    out.push({ index: i + 1, data: data });
  }
  return out;
}

function findOrder_(orderId) {
  if (!orderId) return null;
  return allOrders_().filter(function (r) { return r.data.orderId === orderId; })[0] || null;
}

function setCells_(row, patch) {
  var sh = sheet_();
  Object.keys(patch).forEach(function (k) {
    var c = COLS.indexOf(k);
    if (c >= 0) sh.getRange(row.index, c + 1).setValue(patch[k]);
  });
}

function rowFrom_(o) { return COLS.map(function (c) { return o[c] === undefined ? '' : o[c]; }); }

// ───────────────────────────── mail text ─────────────────────────────

function orderText_(orderId, o) {
  return 'Order ' + orderId + '\n' +
    'Part: ' + o.part + '\nUnits: ' + o.units + (o.material ? '\nMaterial: ' + o.material : '') + '\n' +
    'Customer: ' + o.name + (o.company ? ' (' + o.company + ')' : '') + '\nEmail: ' + o.email + '\nPhone: ' + o.phone + '\n' +
    (o.notes ? '\nNotes:\n' + o.notes + '\n' : '');
}

function receiptMail_(d) {
  return mailShell_(
    '<p>Hello ' + esc_(d.name) + ',</p>' +
    '<p>We have your drawing for <b>' + esc_(d.part) + '</b> and your payment of ₹79. ' +
    'Your order number is <b>' + esc_(d.orderId) + '</b>.</p>' +
    '<p>We model the part in Fusion 360, check it against your drawing, and email the STEP file to this address. ' +
    'If anything on the drawing is unclear, we will ask before we model it.</p>' +
    '<p>Questions: reply to this email or WhatsApp +91 86602 34766.</p>');
}

function deliveryMail_(d, names, message) {
  return mailShell_(
    '<p>Hello ' + esc_(d.name) + ',</p>' +
    '<p>Your 3D model of <b>' + esc_(d.part) + '</b> is attached (' + esc_(names.join(', ')) + '). ' +
    'It is modelled in ' + esc_(d.units) + ' from the drawing you sent, order <b>' + esc_(d.orderId) + '</b>.</p>' +
    (message ? '<p>' + esc_(message).replace(/\n/g, '<br>') + '</p>' : '') +
    '<p>In Mastercam: File › Open, set the file type to STEP, and pick the attachment. ' +
    'Please check the critical dimensions against your drawing before you cut metal. ' +
    'If something does not match, reply to this email with the dimension and we will correct it.</p>');
}

function mailShell_(inner) {
  return '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0d1e26;max-width:560px">' +
    inner + '<p style="color:#2a4354">TOOLFLUX · Vidyanagar, Hubli · <a href="https://www.toolflux.co.in/drawing-to-step.html">toolflux.co.in</a></p></div>';
}

// ───────────────────────────── setup & upkeep ─────────────────────────────

/** Run once from the editor. Creates the Drive folder, the order sheet, the desk key and the cleanup trigger. */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ROOT_FOLDER_ID')) p.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('Drawing to STEP orders').getId());
  if (!p.getProperty('SHEET_ID')) p.setProperty('SHEET_ID', SpreadsheetApp.create('Drawing to STEP orders').getId());
  if (!p.getProperty('DESK_KEY')) p.setProperty('DESK_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cleanup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(3).create();
  Logger.log('DESK_KEY (paste into the desk app): ' + p.getProperty('DESK_KEY'));
  Logger.log('Orders sheet: https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID'));
  if (!p.getProperty('RZP_KEY_ID') || !p.getProperty('RZP_KEY_SECRET')) Logger.log('Still needed: RZP_KEY_ID and RZP_KEY_SECRET in Script Properties.');
}

/** Daily: unpaid orders older than 3 days are checked once more, then expired and their drawings binned. */
function cleanup() {
  var cutoff = Date.now() - 3 * 864e5;
  allOrders_().forEach(function (r) {
    if (r.data.status !== 'awaiting_payment' || new Date(r.data.created).getTime() > cutoff) return;
    reconcile_(r);
    var fresh = findOrder_(r.data.orderId);
    if (fresh.data.status !== 'awaiting_payment') return;
    try { DriveApp.getFolderById(fresh.data.folderId).setTrashed(true); } catch (err) { Logger.log(err); }
    setCells_(fresh, { status: 'expired', log: fresh.data.log + '\n' + stamp_('expired unpaid, drawing deleted') });
  });
}

// ───────────────────────────── helpers ─────────────────────────────

function publicStatus_(s) {
  return { awaiting_payment: 'awaiting_payment', paid: 'in_progress', modelling: 'in_progress', review: 'in_progress',
    query: 'question_sent', delivered: 'delivered', refunded: 'refunded', expired: 'expired' }[s] || s;
}

function newOrderId_() {
  var d = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd');
  var abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', s = '';
  for (var i = 0; i < 4; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return 'DTS-' + d + '-' + s;
}

function mimeFor_(ext) {
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    dxf: 'application/dxf', dwg: 'application/acad' }[ext] || 'application/octet-stream';
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && k !== 'OWNER_EMAIL') throw new Error('missing script property ' + k);
  return v;
}
function ownerEmail_() { return PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || 'toolflux@gmail.com'; }
function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function esc_(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function stamp_(msg) { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' ' + msg; }
function safeJson_(s, dflt) { try { return JSON.parse(s); } catch (e) { return dflt; } }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var x = 0;
  for (var i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
