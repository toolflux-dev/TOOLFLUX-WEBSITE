/**
 * TOOLFLUX Machining Log — Google Apps Script Sync Receiver
 *
 * SETUP (one-time, takes ~5 minutes):
 * ─────────────────────────────────────────────────────────
 * 1. Go to https://sheets.google.com → create a new spreadsheet
 *    Name it "TOOLFLUX — Customer Data"
 *
 * 2. Copy the spreadsheet ID from the URL:
 *    https://docs.google.com/spreadsheets/d/  <<<THIS PART>>>  /edit
 *    Paste it into SPREADSHEET_ID below.
 *
 * 3. Go to https://script.google.com → New Project
 *    Paste this entire file into the editor. Save.
 *
 * 4. Click Deploy → New Deployment
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    → Copy the Web App URL (looks like https://script.google.com/macros/s/.../exec)
 *
 * 5. Run build-share.ps1 with that URL:
 *    .\build-share.ps1 -Customer "acme-tools" -SyncUrl "https://script.google.com/..."
 *
 * 6. For each new customer, run build-share.ps1 with a different -Customer name.
 *    All data lands in the SAME spreadsheet, in separate tab groups.
 *
 * To give a customer VIEW access to their own data:
 *    Open the spreadsheet → Share → paste their email → Viewer role.
 *    They can see their own tabs. They cannot see other customers' tabs
 *    unless you share those too.
 * ─────────────────────────────────────────────────────────────────────
 */

const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

// ─── Secrets — NEVER hardcode these. Set them once in:
//     Apps Script editor → Project Settings → Script Properties
//
//   TOKEN_HMAC_SECRET    32+ char random string. Used to derive license tokens via
//                        HMAC-SHA256. Changing this invalidates all active tokens —
//                        users would need to re-activate. Keep it forever.
//
//   WEBHOOK_SECRET       32+ char random string. Paste into your Razorpay webhook
//                        URL as ?wh_secret=<value>. Rotate if ever leaked.
//
//   RAZORPAY_KEY_ID      Your Razorpay API key ID (optional). Enables live
//   RAZORPAY_KEY_SECRET  subscription verification at activation time.
// ──────────────────────────────────────────────────────────────────

function getSecret(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

// ─── Crypto primitives ────────────────────────────────────────────

// Derive a 64-char hex token from an email using HMAC-SHA256.
// Tokens are never stored — always re-derived on demand.
function deriveToken(email) {
  var secret = getSecret('TOKEN_HMAC_SECRET');
  if (!secret) throw new Error('TOKEN_HMAC_SECRET not configured in Script Properties');
  var sig = Utilities.computeHmacSha256Signature(email.toLowerCase().trim(), secret);
  return 'TF' + sig.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('').toUpperCase();
}

// Constant-time string comparison to prevent timing oracle attacks.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Pad to same length so loop always runs the same number of iterations.
  var maxLen = Math.max(a.length, b.length);
  var diff = a.length !== b.length ? 1 : 0;
  for (var i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Verify Razorpay webhook signature.
// Razorpay sends X-Razorpay-Signature: HMAC-SHA256(rawBody, webhookSecret).
// GAS may or may not expose e.headers — we try it, then fall back to URL param
// verified with safeEqual (prevents timing oracle on the URL param comparison).
function verifyWebhookSecret(e, rawBody) {
  var secret = getSecret('WEBHOOK_SECRET');
  if (!secret) return false;

  // Best path: HMAC over raw body using the header Razorpay sends
  var headerSig = (e.headers && e.headers['X-Razorpay-Signature']) || '';
  if (headerSig) {
    var computed = Utilities.computeHmacSha256Signature(rawBody, secret)
      .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
    return safeEqual(computed, headerSig);
  }

  // Fallback: URL param secret (acceptable when header is unavailable)
  return safeEqual(e.parameter.wh_secret || '', secret);
}

// ─── Input validation ─────────────────────────────────────────────

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length >= 5
    && email.length <= 254
    && /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
}

// ─── Rate limiting ────────────────────────────────────────────────
// Stores per-email attempt counts in _RateLimits sheet.
// Max 5 activation attempts per 15-minute window per email.

var RATE_MAX   = 5;
var RATE_MS    = 15 * 60 * 1000;

function checkRateLimit(ss, email) {
  var sheet = getSheet(ss, '_RateLimits');
  if (sheet.getLastRow() === 0) {
    header(sheet, ['Email', 'WindowStart', 'AttemptCount'], NAVY);
  }
  var now = Date.now();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() !== email) continue;
    var windowStart = new Date(data[i][1]).getTime();
    var count       = Number(data[i][2]) || 0;
    if (now - windowStart < RATE_MS) {
      if (count >= RATE_MAX) return false;           // blocked
      sheet.getRange(i + 1, 3).setValue(count + 1); // increment
    } else {
      sheet.getRange(i + 1, 2).setValue(new Date().toISOString()); // reset window
      sheet.getRange(i + 1, 3).setValue(1);
    }
    return true;
  }
  // First attempt for this email
  sheet.appendRow([email, new Date().toISOString(), 1]);
  return true;
}

// ─── Replay protection ────────────────────────────────────────────
// Stores processed Razorpay payment IDs to reject duplicate webhooks.

function isPaymentSeen(ss, paymentId) {
  if (!paymentId) return false;
  var sheet = getSheet(ss, '_ProcessedPayments');
  if (sheet.getLastRow() === 0) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === paymentId) return true;
  }
  return false;
}

function recordPayment(ss, paymentId, email, event) {
  var sheet = getSheet(ss, '_ProcessedPayments');
  if (sheet.getLastRow() === 0) {
    header(sheet, ['PaymentId', 'Email', 'Event', 'ProcessedAt'], NAVY);
  }
  sheet.appendRow([paymentId, email, event, new Date().toISOString()]);
}

// ─── Live Razorpay API verification ──────────────────────────────
// If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set, activation calls
// the Razorpay REST API to confirm the subscription is actually active,
// preventing sheet-only fraud (e.g. someone edits the sheet directly).

function fetchRazorpaySubStatus(subId) {
  var keyId     = getSecret('RAZORPAY_KEY_ID');
  var keySecret = getSecret('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret || !subId) return null; // skip — not configured

  try {
    var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/subscriptions/' + encodeURIComponent(subId), {
      method: 'get',
      headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(keyId + ':' + keySecret) },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText()).status || null; // 'active','cancelled','completed',...
  } catch(_) { return null; }
}

// ─── GET: license activation & verification ───────────────────────
function doGet(e) {
  try {
    var action = (e.parameter.action || '').toLowerCase();
    var email  = (e.parameter.email  || '').toLowerCase().trim();
    var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (action === 'activate') return jsonOk(handleActivation(ss, email));
    if (action === 'verify')   return jsonOk(handleVerification(ss, email, e.parameter.token || ''));

    // ── multi-device shop sync ──
    if (action === 'pull') { // operator fetches the shop's master document
      var shop = cleanShopId(e.parameter.shop);
      var master = readMaster(ss, shop);
      if (!master) return jsonOk({ empty: true });
      return ContentService.createTextOutput(master).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'events') { // owner fetches operators' pending production events
      return jsonOk({ events: readEvents(ss, cleanShopId(e.parameter.shop)) });
    }

    return jsonOk({ error: 'Unknown action' });
  } catch(err) {
    // Never expose raw error messages to clients
    Logger.log('doGet error: ' + err.message);
    return jsonOk({ error: 'Internal error' });
  }
}

// ─── POST: data sync + Razorpay webhooks ─────────────────────────
function doPost(e) {
  try {
    var raw  = e.postData.contents;
    var data = JSON.parse(raw);

    // Detect Razorpay webhook by top-level 'event' field
    if (data.event && data.payload) {
      if (!verifyWebhookSecret(e, raw)) {
        Logger.log('Webhook rejected: bad secret');
        return ok('unauthorized');
      }
      var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      return ok(handleRazorpayWebhook(ss, data));
    }

    // Operator device uploading append-only production events
    if (data.role === 'operator' && data.events) {
      var oshop = cleanShopId(data.shopId);
      if (oshop) appendEvents(SpreadsheetApp.openById(SPREADSHEET_ID), oshop, data.events);
      return ok('events-received');
    }

    // Regular machlog data sync (owner) — validate customerId before using it
    var cid = String(data.customerId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 30);
    if (!cid) cid = 'unknown';
    var ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
    writeJobs(ss2, cid, data.jobs || []);
    writeLog(ss2, cid, data.jobs || []);
    writeCPC(ss2, cid, data.jobs || []);
    writeAnomalies(ss2, cid, data.jobs || []);
    updateMeta(ss2, cid, data);
    // Stash a COST-REDACTED master for operators. The sheet tabs above keep the
    // owner's full figures; operators must never receive insert costs or prices,
    // even in their local storage — that's the point of Operator Mode.
    writeMaster(ss2, cleanShopId(data.shopId || cid), JSON.stringify(redactMasterCosts(data)));

    return ok('synced');
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return ok('error');
  }
}

// ─── License: activation ─────────────────────────────────────────

function handleActivation(ss, email) {
  // Validate format before touching any data
  if (!isValidEmail(email)) {
    return { valid: false, message: 'Invalid email address.' };
  }

  // Rate-limit before doing any sheet reads
  if (!checkRateLimit(ss, email)) {
    return { valid: false, message: 'Too many attempts. Try again in 15 minutes.' };
  }

  var sheet = getSheet(ss, '_Subscriptions');
  initSubscriptionsSheet(ss, sheet);

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() !== email) continue;

    var status  = String(data[i][1]).toLowerCase();
    var subId   = String(data[i][3]);
    var expiry  = data[i][2];
    var plan    = String(data[i][4]) || 'monthly';

    if (status !== 'active') {
      // Don't distinguish "cancelled" from "not found" at the response level
      // to avoid leaking subscriber status to enumeration attacks.
      return { valid: false, message: 'No active subscription found for this email.' };
    }

    // Live verification via Razorpay API if keys are configured
    if (subId) {
      var liveStatus = fetchRazorpaySubStatus(subId);
      if (liveStatus !== null && liveStatus !== 'active' && liveStatus !== 'authenticated') {
        sheet.getRange(i + 1, 2).setValue('cancelled');
        return { valid: false, message: 'No active subscription found for this email.' };
      }
    }

    // Token is derived on-demand — never stored in the sheet
    var token = deriveToken(email);

    // Update last-verified timestamp only (never write the token to the sheet)
    sheet.getRange(i + 1, 6).setValue(new Date().toISOString());

    return { valid: true, token: token, expiresAt: expiry ? new Date(expiry).toISOString() : null, plan: plan };
  }

  // Email not found — same message as inactive subscription (no enumeration)
  return { valid: false, message: 'No active subscription found for this email.' };
}

// ─── License: periodic re-verification ──────────────────────────

function handleVerification(ss, email, token) {
  if (!isValidEmail(email) || !token) return { valid: false };

  // Re-derive expected token and compare in constant time
  var expected;
  try { expected = deriveToken(email); } catch(_) { return { valid: false }; }
  if (!safeEqual(expected, token)) return { valid: false };

  var sheet = getSheet(ss, '_Subscriptions');
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() !== email) continue;
    var status = String(data[i][1]).toLowerCase();
    var expiry = data[i][2];
    if (status !== 'active') return { valid: false, expired: true };
    return { valid: true, expiresAt: expiry ? new Date(expiry).toISOString() : null };
  }
  return { valid: false };
}

// ─── License: Razorpay webhook handler ───────────────────────────

var HANDLED_EVENTS = ['subscription.charged', 'subscription.activated', 'subscription.halted', 'subscription.completed', 'subscription.cancelled', 'payment.captured'];

function handleRazorpayWebhook(ss, data) {
  var event = data.event;
  if (HANDLED_EVENTS.indexOf(event) === -1) return 'ignored: ' + event;

  var email     = '';
  var subId     = '';
  var planId    = '';
  var paymentId = '';

  try { email     = (data.payload.payment.entity.email || '').toLowerCase().trim(); } catch(_) {}
  try { subId     = data.payload.subscription.entity.id || ''; } catch(_) {}
  try { planId    = data.payload.subscription.entity.plan_id || ''; } catch(_) {}
  try { paymentId = data.payload.payment.entity.id || ''; } catch(_) {}

  if (!email) return 'no email in payload';

  // Replay protection — reject if we've seen this payment before
  if (paymentId && isPaymentSeen(ss, paymentId)) {
    Logger.log('Duplicate webhook rejected: ' + paymentId);
    return 'duplicate';
  }

  var isActive    = (event === 'subscription.charged' || event === 'subscription.activated' || event === 'payment.captured');
  var isCancelled = (event === 'subscription.completed' || event === 'subscription.cancelled' || event === 'subscription.halted');
  var status  = isActive ? 'active' : isCancelled ? 'cancelled' : 'halted';
  var expiry  = null;

  if (isActive) {
    var d = new Date();
    d.setDate(d.getDate() + 32); // 32 days buffer above 30-day cycle
    expiry = d.toISOString();
  }

  var sheet = getSheet(ss, '_Subscriptions');
  initSubscriptionsSheet(ss, sheet);

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() !== email) continue;
    // Columns: Email | Status | ExpiresAt | RazorpaySubId | Plan | LastVerified
    sheet.getRange(i + 1, 2).setValue(status);
    if (expiry)   sheet.getRange(i + 1, 3).setValue(expiry);
    if (subId)    sheet.getRange(i + 1, 4).setValue(subId);
    if (planId)   sheet.getRange(i + 1, 5).setValue(planId);
    if (paymentId) recordPayment(ss, paymentId, email, event);
    return 'updated: ' + status;
  }

  // New subscriber
  sheet.appendRow([email, status, expiry, subId, planId, new Date().toISOString()]);
  if (paymentId) recordPayment(ss, paymentId, email, event);
  return 'created';
}

function initSubscriptionsSheet(ss, sheet) {
  if (sheet.getLastRow() > 0) return;
  // Token column is intentionally absent — tokens are derived from HMAC, never stored
  header(sheet, ['Email', 'Status', 'ExpiresAt', 'RazorpaySubId', 'Plan', 'LastVerified'], TEAL);
}

function jsonOk(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Sheet helpers ────────────────────────────────────────────────
const NAVY  = '#012B42';
const TEAL  = '#0097B2';
const WHITE = '#FFFFFF';
const OFF   = '#f2f5f7';

function getSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ─── multi-device shop sync storage ──────────────────────────────
// Master document (owner → operators) and append-only event log
// (operators → owner). Both live in hidden sheets; the master is chunked
// across cells because one cell holds at most 50k chars.
function cleanShopId(v) { return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40); }

// Strip every cost/price figure before a master reaches operators. Operators
// need designations, corner counts and stock quantities to log against — never
// the money. Deep-cloned so the owner's own sheet write is untouched.
function redactMasterCosts(data) {
  var d;
  try { d = JSON.parse(JSON.stringify(data)); } catch (e) { return { empty: true }; }
  (d.jobs || []).forEach(function (j) {
    var stns = [];
    (j.operations || []).forEach(function (op) { (op.stations || []).forEach(function (st) { stns.push(st); }); });
    (j.stations || []).forEach(function (st) { stns.push(st); }); // legacy shape
    stns.forEach(function (st) { delete st.insertCostPer; delete st.setCost; });
  });
  (d.inventory || []).forEach(function (it) { delete it.unitPrice; });
  return d;
}

function writeMaster(ss, shopId, jsonStr) {
  if (!shopId || !jsonStr) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try {
    var sh = ss.getSheetByName('_ShopMaster');
    if (!sh) { sh = ss.insertSheet('_ShopMaster'); sh.appendRow(['ShopId', 'UpdatedAt', 'ChunkIndex', 'ChunkData']); }
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) { if (String(data[i][0]) === shopId) sh.deleteRow(i + 1); }
    var now = new Date().toISOString(), CH = 45000, rows = [];
    for (var p = 0, idx = 0; p < jsonStr.length; p += CH, idx++) rows.push([shopId, now, idx, jsonStr.substr(p, CH)]);
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  } finally { lock.releaseLock(); }
}

function readMaster(ss, shopId) {
  if (!shopId) return '';
  var sh = ss.getSheetByName('_ShopMaster');
  if (!sh) return '';
  var data = sh.getDataRange().getValues(), chunks = [];
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === shopId) chunks.push([Number(data[i][2]), String(data[i][3])]);
  if (!chunks.length) return '';
  chunks.sort(function (a, b) { return a[0] - b[0]; });
  return chunks.map(function (c) { return c[1]; }).join('');
}

function appendEvents(ss, shopId, events) {
  if (!shopId || !events || !events.length) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try {
    var sh = ss.getSheetByName('_ShopEvents');
    if (!sh) { sh = ss.insertSheet('_ShopEvents'); sh.appendRow(['ShopId', 'EventId', 'Kind', 'Payload', 'CreatedAt']); }
    var data = sh.getDataRange().getValues(), seen = {}, gc = [], cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === shopId) seen[String(data[i][1])] = true;
      var t = Date.parse(data[i][4]);
      if (!isNaN(t) && t < cutoff) gc.push(i + 1);
    }
    var add = [];
    events.forEach(function (ev) {
      if (!ev || !ev.id || seen[String(ev.id)]) return;
      add.push([shopId, String(ev.id), String(ev.kind || ''), JSON.stringify(ev), new Date().toISOString()]);
      seen[String(ev.id)] = true;
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 5).setValues(add);
    gc.sort(function (a, b) { return b - a; }).forEach(function (r) { try { sh.deleteRow(r); } catch (e) {} });
  } finally { lock.releaseLock(); }
}

function readEvents(ss, shopId) {
  if (!shopId) return [];
  var sh = ss.getSheetByName('_ShopEvents');
  if (!sh) return [];
  var data = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== shopId) continue;
    try { out.push(JSON.parse(data[i][3])); } catch (e) {}
  }
  return out;
}

// Google Sheets evaluates any cell whose value starts with =, +, -, or @ as a
// live formula — including values written via appendRow, not just typed by a
// human. Every string here (operator, machine, component code, notes...)
// originates from a customer's device and must be treated as untrusted before
// it reaches the sheet. Prefixing a neutralizing apostrophe forces Sheets to
// render it as literal text, the standard mitigation for CSV/formula
// injection. Never skip this when adding a new user-controlled column.
function safeCell(v) {
  var s = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function header(sheet, values, color) {
  sheet.clearContents();
  sheet.appendRow(values);
  const r = sheet.getRange(1, 1, 1, values.length);
  r.setBackground(color || NAVY).setFontColor(WHITE).setFontWeight('bold').setFontSize(9);
  sheet.setFrozenRows(1);
}

function fmt(sheet) {
  sheet.autoResizeColumns(1, sheet.getLastColumn());
}

function ok(msg) {
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}); }
  catch(_) { return iso; }
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}); }
  catch(_) { return ''; }
}

function opLabel(t) {
  const m = {
    turning:'Turning', face_milling:'Face Milling', end_milling:'End Milling',
    slot_milling:'Slot Milling', udrill:'U-Drill', twist_drill:'Twist Drill',
    boring:'Boring', reaming:'Reaming', tapping:'Tapping', threading:'Threading',
    chamfering:'Chamfering', counter_boring:'Counter Boring',
    counter_sinking:'Counter Sinking', grooving:'Grooving', other:'Other'
  };
  return m[t] || t;
}

// ─── calcStation (mirrors machlog.js logic) ───────────────────────
function calcStation(st) {
  const sets           = st.insertSets || [];
  const insertsInCutter = Math.max(1, Number(st.insertsInCutter) || 1);
  const cornersPerInsert = Math.max(1, Number(st.cuttingCornersPerInsert) || 1);
  const costPer        = Number(st.insertCostPer) || 0;
  const setCost        = insertsInCutter * costPer;

  const totalComponents = sets.reduce(function(s, set) {
    return s + (set.corners || []).reduce(function(cs, c) { return cs + (c.componentsMade || 0); }, 0);
  }, 0);

  const allIndexed = [];
  sets.forEach(function(s) {
    (s.corners || []).forEach(function(c) {
      if (c.status === 'indexed' && (c.componentsMade || 0) > 0) allIndexed.push(c);
    });
  });
  const avgCornerLife = allIndexed.length > 0
    ? allIndexed.reduce(function(s,c){return s+c.componentsMade;},0) / allIndexed.length
    : null;

  const finishedSets = sets.filter(function(s){return s.status==='spent';});
  const finishedPcs  = finishedSets.reduce(function(s,set){
    return s+(set.corners||[]).reduce(function(cs,c){return cs+(c.componentsMade||0);},0);
  },0);
  const confirmedCpc = finishedPcs > 0 && finishedSets.length * setCost > 0
    ? (finishedSets.length * setCost) / finishedPcs : null;

  const totalCost    = sets.length * setCost;
  const provisionalCpc = totalComponents > 0 && totalCost > 0 ? totalCost / totalComponents : null;

  const anomalies = [];
  if (avgCornerLife && avgCornerLife > 0) {
    sets.forEach(function(set, si) {
      (set.corners||[]).forEach(function(c) {
        if (c.status === 'broken' && (c.componentsMade||0) / avgCornerLife < 0.55) {
          anomalies.push({setNum:si+1, cornerNum:c.num, pcs:c.componentsMade||0, avgLife:Math.round(avgCornerLife)});
        }
      });
    });
  }

  return { sets:sets, insertsInCutter:insertsInCutter, cornersPerInsert:cornersPerInsert,
    costPer:costPer, setCost:setCost, totalComponents:totalComponents,
    avgCornerLife:avgCornerLife, confirmedCpc:confirmedCpc, provisionalCpc:provisionalCpc,
    totalCost:totalCost, anomalies:anomalies };
}

// ─── Sheet writers ────────────────────────────────────────────────

function writeJobs(ss, cid, jobs) {
  const sheet = getSheet(ss, cid + ' | Jobs');
  header(sheet, ['Component Code','Description','Customer','Status','Started',
    'Total Pcs Made','Total Insert Cost (Rs)','Insert CPC (Rs/pc)','Stations','Anomalies','Last Synced']);

  jobs.forEach(function(j) {
    const totalPcs = (j.productionLog||[]).reduce(function(s,e){return s+(Number(e.qty)||0);},0);
    var totalCost = 0; var totalAnom = 0;
    (j.stations||[]).forEach(function(st) {
      var sc = calcStation(st);
      totalCost += sc.totalCost;
      totalAnom += sc.anomalies.length;
    });
    const cpc = totalPcs > 0 && totalCost > 0 ? (totalCost/totalPcs).toFixed(2) : '';
    sheet.appendRow([
      safeCell(j.componentCode), safeCell(j.componentDesc||''), safeCell(j.customer||''),
      j.status||'active', fmtDate(j.createdAt),
      totalPcs, totalCost||'', cpc,
      (j.stations||[]).length, totalAnom,
      fmtDate(new Date().toISOString())
    ]);
  });
  fmt(sheet);
}

function writeLog(ss, cid, jobs) {
  const sheet = getSheet(ss, cid + ' | Log');
  header(sheet, ['Component','Description','Date','Time','Operator','Machine',
    'Qty','Cycle Time (min)','Tooling Events','Notes']);

  jobs.forEach(function(j) {
    (j.productionLog||[]).forEach(function(e) {
      var evText = (e.events||[]).map(function(ev) {
        var st = (j.stations||[]).find(function(s){return s.id===ev.stationId;});
        return (st?st.name:'?') + ': ' + ev.eventType.replace(/_/g,' ');
      }).join('; ');
      sheet.appendRow([
        safeCell(j.componentCode), safeCell(j.componentDesc||''),
        fmtDate(e.timestamp), fmtTime(e.timestamp),
        safeCell(e.operator||''), safeCell(e.machine||''),
        e.qty||0, e.cycleTimeMins||'',
        safeCell(evText), safeCell(e.notes||'')
      ]);
    });
  });
  fmt(sheet);
}

function writeCPC(ss, cid, jobs) {
  const sheet = getSheet(ss, cid + ' | CPC');
  header(sheet, ['Component','Station','Operation','Machine','Insert Desig','Insert Grade',
    'Inserts in Cutter','Corners/Insert','Cost/Insert (Rs)','Set Cost (Rs)',
    'Sets Used','Total Pcs','Avg Corner Life','Confirmed CPC','Provisional CPC'], TEAL);

  jobs.forEach(function(j) {
    (j.stations||[]).forEach(function(st) {
      var sc = calcStation(st);
      sheet.appendRow([
        safeCell(j.componentCode), safeCell(st.name), opLabel(st.opType), safeCell(st.machine||''),
        safeCell(st.insertDesig||''), safeCell(st.insertGrade||''),
        sc.insertsInCutter, sc.cornersPerInsert, sc.costPer, sc.setCost,
        sc.sets.length, sc.totalComponents,
        sc.avgCornerLife ? Math.round(sc.avgCornerLife) : '',
        sc.confirmedCpc ? sc.confirmedCpc.toFixed(2) : '',
        sc.provisionalCpc ? sc.provisionalCpc.toFixed(2) : ''
      ]);
    });
  });
  fmt(sheet);
}

function writeAnomalies(ss, cid, jobs) {
  const rows = [];
  jobs.forEach(function(j) {
    (j.stations||[]).forEach(function(st) {
      calcStation(st).anomalies.forEach(function(a) {
        const pct = a.avgLife ? Math.round((a.pcs/a.avgLife)*100) : 0;
        rows.push([
          safeCell(j.componentCode), safeCell(st.name), opLabel(st.opType),
          a.setNum, a.cornerNum, a.pcs, a.avgLife, pct+'%',
          pct < 30 ? 'CRITICAL' : pct < 55 ? 'WARNING' : 'NOTICE'
        ]);
      });
    });
  });

  if (rows.length === 0) return; // No anomalies - skip tab

  const sheet = getSheet(ss, cid + ' | Anomalies');
  header(sheet, ['Component','Station','Operation','Set #','Corner #',
    'Pcs on Corner','Avg Corner Life','% of Avg','Severity'], '#A62D1E');
  rows.forEach(function(r) { sheet.appendRow(r); });

  // Red-highlight critical rows
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][8] === 'CRITICAL') {
      sheet.getRange(i+2, 1, 1, rows[i].length).setBackground('#fdf0ee');
    }
  }
  fmt(sheet);
}

function updateMeta(ss, cid, data) {
  var sheet = getSheet(ss, '_Sync Log');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Customer ID','Last Sync','Jobs','Log Entries','Company']);
    sheet.getRange(1,1,1,5).setBackground(NAVY).setFontColor(WHITE).setFontWeight('bold');
  }
  // Find existing row for this customer or append
  var data2 = sheet.getDataRange().getValues();
  var found = -1;
  for (var i = 1; i < data2.length; i++) {
    if (data2[i][0] === cid) { found = i+1; break; }
  }
  const logCount = (data.jobs||[]).reduce(function(s,j){return s+(j.productionLog||[]).length;},0);
  const row = [cid, new Date().toLocaleString('en-IN'), (data.jobs||[]).length, logCount, safeCell((data.settings||{}).company||'')];
  if (found > 0) {
    sheet.getRange(found, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}
