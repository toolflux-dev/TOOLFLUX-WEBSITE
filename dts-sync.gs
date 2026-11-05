/**
 * Drawing to STEP — order backend (Google Apps Script web app). Free for everyone.
 *
 * The customer page (drawing-to-step.html) and the desk app on Roo's PC
 * (dts-desk.js) both talk to this one script.
 *
 *   create   customer  saves the drawing to Drive, queues the order, emails a receipt
 *   status   customer  where an order is (by order id + email)
 *   queue    desk      lists orders still to be done
 *   file     desk      returns one drawing file (base64)
 *   mark     desk      sets an order's status (modelling, held, query, queued); notify:true emails Roo
 *   deliver  desk      saves the STEP to Drive and emails it to the customer
 *
 * Script Properties (setup() makes them):
 *   DESK_KEY                     shared secret for the desk app
 *   ROOT_FOLDER_ID, SHEET_ID     Drive folder and order sheet
 *   OWNER_EMAIL                  optional, defaults to toolflux@gmail.com
 */

var MAX_FILES = 10;
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var MAX_TOTAL_BYTES = 25 * 1024 * 1024;
var DRAWING_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
var CAD_EXT = ['dxf', 'dwg'];
var DELIVER_EXT = ['step', 'stp', 'pdf', 'png', 'jpg'];
var OPEN = ['queued', 'paid', 'modelling', 'held', 'query', 'review'];   // 'paid'/'review' = rows from the old paid launch
var DESK_STATUSES = ['queued', 'modelling', 'held', 'query'];
// Column order is fixed: the live sheet already uses it. rzpOrderId/paymentId/amount/free are no longer filled.
var COLS = ['created', 'orderId', 'status', 'name', 'email', 'phone', 'company', 'part', 'units',
  'material', 'notes', 'files', 'folderId', 'rzpOrderId', 'paymentId', 'paidAt', 'deliveredAt', 'amount', 'log', 'free', 'question'];
var PAGE_URL = 'https://www.toolflux.co.in/drawing-to-step.html';
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
      case 'info':    return json_({ ok: true, open: true });
      case 'create':  return json_(createOrder_(body));
      case 'status':  return json_(orderStatus_(body));
      case 'question': return json_(getQuestion_(body));
      case 'answer':  return json_(answerQuestion_(body));
      case 'ask':     requireDesk_(body); return json_(deskAsk_(body));
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
    return json_({ ok: false, error: 'server', message: 'Something went wrong on our side. Please try again, or WhatsApp us the drawing.' });
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
    var df = folder.createFile(Utilities.newBlob(f.bytes, f.mime, f.name));
    return { id: df.getId(), name: f.name, size: f.bytes.length };
  });
  folder.createFile('order.txt', orderText_(orderId, o), 'text/plain');

  withLock_(function () {
    sheet_().appendRow(rowFrom_({
      created: new Date(), orderId: orderId, status: 'queued', name: o.name, email: o.email, phone: o.phone,
      company: o.company, part: o.part, units: o.units, material: o.material, notes: o.notes,
      files: JSON.stringify(saved), folderId: folder.getId(), log: stamp_('received')
    }));
  });

  var d = findOrder_(orderId).data;
  try {
    MailApp.sendEmail({ to: d.email, replyTo: ownerEmail_(), name: 'TOOLFLUX Drawing to STEP',
      subject: 'Drawing received: ' + d.part + ' (' + d.orderId + ')', htmlBody: receiptMail_(d) });
    MailApp.sendEmail({ to: ownerEmail_(), name: 'Drawing to STEP',
      subject: 'New order · ' + d.orderId + ' · ' + d.part,
      body: orderText_(d.orderId, d) + '\nDrive: https://drive.google.com/drive/folders/' + d.folderId });
  } catch (err) { Logger.log('mail failed: ' + err); }

  return { ok: true, orderId: orderId, email: o.email };
}

function orderStatus_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row || row.data.email.toLowerCase() !== str_(b.email, 120).toLowerCase()) return { ok: false, error: 'not_found' };
  var s = row.data.status;
  return { ok: true, orderId: row.data.orderId, status: s === 'delivered' ? 'delivered' : 'in_progress' };
}

// ───────────────────────────── desk ─────────────────────────────

function deskQueue_() {
  var rows = allOrders_();
  var open = rows.filter(function (r) { return OPEN.indexOf(r.data.status) >= 0; }).map(function (r) {
    var d = r.data;
    return { orderId: d.orderId, status: d.status === 'paid' ? 'queued' : d.status, created: d.created, name: d.name,
      email: d.email, phone: d.phone, company: d.company, part: d.part, units: d.units, material: d.material,
      notes: d.notes, files: safeJson_(d.files, []), folderUrl: 'https://drive.google.com/drive/folders/' + d.folderId };
  });
  var recent = rows.filter(function (r) { return r.data.status === 'delivered'; })
    .slice(-15).map(function (r) { return { orderId: r.data.orderId, part: r.data.part, name: r.data.name, deliveredAt: r.data.deliveredAt }; });
  return { ok: true, orders: open, delivered: recent };
}

function deskFile_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row) throw new Error('user:Order not found.');
  var hit = safeJson_(row.data.files, []).filter(function (f) { return f.id === b.fileId; })[0];
  if (!hit) throw new Error('user:File is not part of this order.');
  var blob = DriveApp.getFileById(hit.id).getBlob();
  return { ok: true, name: hit.name, mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

// ── asking the customer (Roo, 2026-11-06: missing dimensions => email the customer, their answer re-queues) ──

// Answer links carry a token so only the person who got the email can answer.
function answerToken_(orderId) {
  return hex_(Utilities.computeHmacSha256Signature('answer|' + orderId, prop_('DESK_KEY'))).slice(0, 20);
}

function deskAsk_(b) {
  var question = str_(b.question, 3000);
  if (!question) throw new Error('user:No question to ask.');
  var d = withLock_(function () {
    var row = findOrder_(str_(b.orderId, 40));
    if (!row) throw new Error('user:Order not found.');
    if (row.data.status === 'delivered') throw new Error('user:Order is already delivered.');
    setCells_(row, { status: 'query', question: question, log: row.data.log + '\n' + stamp_('asked customer: ' + question.slice(0, 300)) });
    return findOrder_(row.data.orderId).data;
  });
  var link = PAGE_URL + '?answer=' + encodeURIComponent(d.orderId) + '&t=' + answerToken_(d.orderId) + '#order';
  MailApp.sendEmail({ to: d.email, replyTo: ownerEmail_(), name: 'TOOLFLUX Drawing to STEP',
    subject: 'A question about your drawing: ' + d.part + ' (' + d.orderId + ')', htmlBody: questionMail_(d, question, link) });
  try {
    MailApp.sendEmail({ to: ownerEmail_(), name: 'Drawing to STEP', subject: 'Asked the customer · ' + d.orderId + ' · ' + d.part,
      body: 'The customer was asked:\n\n' + question + '\n\n' + orderText_(d.orderId, d) });
  } catch (err) { Logger.log('mail failed: ' + err); }
  return { ok: true, orderId: d.orderId, status: 'query' };
}

function openQuestion_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row || !safeEqual_(str_(b.t, 40), answerToken_(row.data.orderId))) throw new Error('user:This answer link is not valid. Reply to the email instead.');
  if (row.data.status !== 'query') throw new Error('user:This question has already been answered. Sit tight: the STEP file is on its way.');
  return row;
}

function getQuestion_(b) {
  var d = openQuestion_(b).data;
  return { ok: true, orderId: d.orderId, part: d.part, question: String(d.question || '') };
}

function answerQuestion_(b) {
  var row = openQuestion_(b);
  var text = str_(b.text, 3000);
  var files = (b.files && b.files.length) ? checkAnswerFiles_(b.files) : [];
  if (!text && !files.length) throw new Error('user:Write an answer or attach a file.');
  var folder = DriveApp.getFolderById(row.data.folderId);
  var saved = files.map(function (f) {
    var df = folder.createFile(Utilities.newBlob(f.bytes, f.mime, f.name));
    return { id: df.getId(), name: f.name, size: f.bytes.length };
  });
  var d = withLock_(function () {
    var fresh = findOrder_(row.data.orderId);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
    var notes = String(fresh.data.notes || '') + '\n\nQuestion (' + stamp + '): ' + fresh.data.question + '\nCustomer answer: ' + (text || '(see attached files)') +
      (saved.length ? '\nNew files: ' + saved.map(function (f) { return f.name; }).join(', ') : '');
    setCells_(fresh, { status: 'queued', notes: notes.trim().slice(0, 45000), question: '',
      files: JSON.stringify(safeJson_(fresh.data.files, []).concat(saved)),
      log: fresh.data.log + '\n' + stamp_('customer answered; queued again') });
    return findOrder_(fresh.data.orderId).data;
  });
  try {
    MailApp.sendEmail({ to: ownerEmail_(), name: 'Drawing to STEP', subject: 'Customer answered · ' + d.orderId + ' · ' + d.part,
      body: 'Answer: ' + (text || '(files only)') + (saved.length ? '\nFiles: ' + saved.map(function (f) { return f.name; }).join(', ') : '') + '\n\nThe order is queued for modelling again.' });
  } catch (err) { Logger.log('mail failed: ' + err); }
  return { ok: true, orderId: d.orderId, email: d.email };
}

// Answers may be a sketch, a clearer scan or a CAD file; same types and size limits as orders.
function checkAnswerFiles_(list) {
  if (list.length > MAX_FILES) throw new Error('user:Attach at most ' + MAX_FILES + ' files.');
  var total = 0;
  return list.map(function (f) {
    var name = String(f.name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    var ext = name.split('.').pop().toLowerCase();
    if (DRAWING_EXT.indexOf(ext) < 0 && CAD_EXT.indexOf(ext) < 0) throw new Error('user:' + name + ' is not a PDF, image, DXF or DWG.');
    var bytes = Utilities.base64Decode(String(f.b64 || ''));
    if (!bytes.length) throw new Error('user:' + name + ' is empty.');
    if (bytes.length > MAX_FILE_BYTES) throw new Error('user:' + name + ' is over 10 MB.');
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('user:Files are over 25 MB together.');
    return { name: name, bytes: bytes, mime: mimeFor_(ext) };
  });
}

function deskMark_(b) {
  var status = str_(b.status, 20);
  if (DESK_STATUSES.indexOf(status) < 0) throw new Error('user:Unknown status.');
  var note = str_(b.note, 2000);
  var d = withLock_(function () {
    var row = findOrder_(str_(b.orderId, 40));
    if (!row) throw new Error('user:Order not found.');
    if (row.data.status === 'delivered') throw new Error('user:Order is already delivered.');
    setCells_(row, { status: status, log: row.data.log + '\n' + stamp_(status + (note ? ': ' + note : '')) });
    return row.data;
  });
  if (b.notify) {
    try {
      MailApp.sendEmail({ to: ownerEmail_(), name: 'Drawing to STEP',
        subject: 'Needs you · ' + status + ' · ' + d.orderId + ' · ' + d.part,
        body: (note || '(no note)') + '\n\n' + orderText_(d.orderId, d) + '\nDrive: https://drive.google.com/drive/folders/' + d.folderId });
    } catch (err) { Logger.log('mail failed: ' + err); }
  }
  return { ok: true, orderId: d.orderId, status: status };
}

function deskDeliver_(b) {
  var row = findOrder_(str_(b.orderId, 40));
  if (!row) throw new Error('user:Order not found.');
  if (OPEN.indexOf(row.data.status) < 0) throw new Error('user:Order is ' + row.data.status + '.');
  var files = (b.files || []).map(function (f) {
    var name = String(f.name || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
    var ext = name.split('.').pop().toLowerCase();
    if (DELIVER_EXT.indexOf(ext) < 0) throw new Error('user:Cannot send .' + ext + ' files.');
    return { name: name, ext: ext, bytes: Utilities.base64Decode(String(f.b64 || '')) };
  });
  if (!files.some(function (f) { return f.ext === 'step' || f.ext === 'stp'; })) throw new Error('user:No STEP file to send.');
  var total = files.reduce(function (s, f) { return s + f.bytes.length; }, 0);
  if (total > 20 * 1024 * 1024) throw new Error('user:Files are over 20 MB together; email them by hand.');

  var out = DriveApp.getFolderById(row.data.folderId).createFolder('delivered');
  var blobs = files.map(function (f) {
    var mime = (f.ext === 'step' || f.ext === 'stp') ? 'application/step' : (f.ext === 'pdf' ? 'application/pdf' : 'image/' + (f.ext === 'jpg' ? 'jpeg' : f.ext));
    var blob = Utilities.newBlob(f.bytes, mime, f.name);
    out.createFile(blob);
    return blob;
  });

  var d = row.data;
  MailApp.sendEmail({ to: d.email, replyTo: ownerEmail_(), name: 'TOOLFLUX Drawing to STEP',
    subject: 'Your STEP model: ' + d.part + ' (' + d.orderId + ')',
    htmlBody: deliveryMail_(d, files.map(function (f) { return f.name; }), str_(b.message, 2000)), attachments: blobs });

  withLock_(function () {
    var fresh = findOrder_(d.orderId);
    setCells_(fresh, { status: 'delivered', deliveredAt: new Date(), log: fresh.data.log + '\n' + stamp_('delivered: ' + files.map(function (f) { return f.name; }).join(', ')) });
  });
  return { ok: true, orderId: d.orderId, status: 'delivered' };
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
  if (total > MAX_TOTAL_BYTES) throw new Error('user:Files are over 25 MB together.');
  return files;
}

// Spam guard only (Roo chose no customer limit): 6 uploads an hour per email.
function throttle_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'dts_' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, email)).slice(0, 20);
  var n = Number(cache.get(key) || 0);
  if (n >= 6) throw new Error('user:Too many uploads from this email in the last hour. Please wait a little, or WhatsApp us.');
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
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(COLS); sh.setFrozenRows(1); }
  // Columns added after launch get their header title the first time they are needed.
  var last = COLS.length;
  if (sh.getRange(1, last).getValue() !== COLS[last - 1]) sh.getRange(1, last).setValue(COLS[last - 1]);
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

function questionMail_(d, question, link) {
  return mailShell_(
    '<p>Hello ' + esc_(d.name) + ',</p>' +
    '<p>We are modelling <b>' + esc_(d.part) + '</b> (order ' + esc_(d.orderId) + ') and need one thing from you before the STEP file can be exact:</p>' +
    '<blockquote style="margin:16px 0;padding:12px 16px;background:#f1f5f6;border-left:3px solid #007a91">' + esc_(question).replace(/\n/g, '<br>') + '</blockquote>' +
    '<p><a href="' + link + '" style="display:inline-block;background:#007a91;color:#fff;padding:10px 18px;text-decoration:none">Answer the question</a></p>' +
    '<p>You can write the answer and attach a clearer drawing or a sketch there. As soon as you send it, we model the part and email the STEP file. You can also simply reply to this email.</p>');
}

function receiptMail_(d) {
  return mailShell_(
    '<p>Hello ' + esc_(d.name) + ',</p>' +
    '<p>We have your drawing for <b>' + esc_(d.part) + '</b>. Your order number is <b>' + esc_(d.orderId) + '</b>.</p>' +
    '<p>Sit tight: the STEP file will come to this address. If anything on the drawing is unclear, we will ask first.</p>' +
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
    'If something does not match, reply to this email with the dimension and we will correct it.</p>' +
    '<p>Two lines of feedback would help us a lot: did the model open and work in Mastercam, and what should we do better?</p>');
}

function mailShell_(inner) {
  return '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0d1e26;max-width:560px">' +
    inner + '<p style="color:#2a4354">TOOLFLUX · Vidyanagar, Hubli · <a href="https://www.toolflux.co.in/drawing-to-step.html">toolflux.co.in</a></p></div>';
}

// ───────────────────────────── setup ─────────────────────────────

/** Run once from the editor. Creates the Drive folder, the order sheet and the desk key; removes old triggers. */
function setup() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ROOT_FOLDER_ID')) p.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('Drawing to STEP orders').getId());
  if (!p.getProperty('SHEET_ID')) p.setProperty('SHEET_ID', SpreadsheetApp.create('Drawing to STEP orders').getId());
  if (!p.getProperty('DESK_KEY')) p.setProperty('DESK_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cleanup') ScriptApp.deleteTrigger(t); });
  Logger.log('DESK_KEY (paste into the desk app): ' + p.getProperty('DESK_KEY'));
  Logger.log('Orders sheet: https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID'));
}

/** Kept so the old daily trigger (from the paid launch) does nothing harmful if it still fires. */
function cleanup() {}

// ───────────────────────────── helpers ─────────────────────────────

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
