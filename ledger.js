/* ============================================================
   FLUX LEDGER — TOOLFLUX cash & GST desk
   Everything client-side. No server, no account, no upload.
   Money is ALWAYS integer paise. Never a float rupee.
   ============================================================ */
(function () {
'use strict';

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';

/* ═══ 1. utilities ═══════════════════════════════════════ */

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function grp(s) {                       // Indian digit grouping: 1,23,456
  if (s.length <= 3) return s;
  const last = s.slice(-3);
  return s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last;
}
function fmtP(p) {                      // paise -> "1,23,456.78"
  const neg = p < 0; p = Math.abs(Math.round(p));
  return (neg ? '-' : '') + grp(String(Math.floor(p / 100))) + '.' + String(p % 100).padStart(2, '0');
}
const R = p => '₹' + fmtP(p);
function Rk(p) {                        // compact, for axes and chips
  const sg = p < 0 ? '-' : '', a = Math.abs(p) / 100;
  if (a >= 1e7) return sg + '₹' + (a / 1e7).toFixed(a / 1e7 >= 10 ? 0 : 1) + 'Cr';
  if (a >= 1e5) return sg + '₹' + (a / 1e5).toFixed(a / 1e5 >= 10 ? 0 : 1) + 'L';
  if (a >= 1e3) return sg + '₹' + Math.round(a / 1e3) + 'K';
  return sg + '₹' + Math.round(a);
}
function toPaise(s) {                   // "1,23,456.78" / "(123.45)" -> paise int
  if (s == null || s === '') return null;
  let t = String(s).trim(), neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/(^-|-$)/.test(t)) neg = true;
  if (/\bDr\b/i.test(t)) neg = false;
  t = t.replace(/[₹,\s+\-]/g, '').replace(/(Cr|Dr)$/i, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0);
  return neg ? -v : v;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(tok) {               // -> 'YYYY-MM-DD' or null
  if (!tok) return null;
  let m = /^(\d{1,2})[-\/\s.]([A-Za-z]{3,9})[-\/\s.](\d{2,4})$/.exec(tok.trim());
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    return iso(+m[1], mo, yr(m[3]));
  }
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(tok.trim());
  if (m) return iso(+m[1], +m[2], yr(m[3]));           // dd/mm/yyyy — Indian order
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tok.trim());
  if (m) return tok.trim();
  return null;
}
function yr(s) { const n = +s; return n < 100 ? (n > 70 ? 1900 + n : 2000 + n) : n; }
function iso(d, m, y) {
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1990 && y <= 2100)) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
const DATE_LEAD = /^\s*(\d{1,2}[-\/\s.](?:[A-Za-z]{3,9}|\d{1,2})[-\/\s.]\d{2,4})/;
function dShort(d) { const p = d.split('-'); return p[2] + ' ' + MN[+p[1]] + " '" + p[0].slice(2); }
function mKey(d) { return d.slice(0, 7); }
function mLabel(k) { const p = k.split('-'); return MN[+p[1]] + " '" + p[0].slice(2); }
function today() { return new Date().toISOString().slice(0, 10); }

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}
function download(name, text, mime) {
  downloadBlob(name, new Blob([text], { type: mime || 'text/csv;charset=utf-8' }));
}
function downloadBlob(name, b) {
  const u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500);
}
function csv(rows) {
  return rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/* ═══ 2. storage ═════════════════════════════════════════ */

const DBN = 'fluxledger';
let _db = null;
function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readonly').objectStore('kv').get(k);
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    });
  } catch (e) { try { return JSON.parse(localStorage.getItem(DBN + ':' + k)); } catch (_) { return null; } }
}
async function kvSet(k, v) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
      t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
  } catch (e) { try { localStorage.setItem(DBN + ':' + k, JSON.stringify(v)); } catch (_) {} }
}

/* ═══ 3. state ═══════════════════════════════════════════ */

const S = {
  txns: [],
  splits: [],
  notSale: [],        // receipts ruled out as customer payments — decisions, so they sync
  sources: [],
  set: { rate: 18, fyStart: 4, open: null },
  period: 'all',
  custom: null,
  f: { q: '', dir: '', cat: '', bank: '' },
  sort: { k: 'date', d: -1 },
  limit: 250,
  sepView: 'pending',
  shareErr: '',
  calc: { gross: null, rate: 18, mode: 'incl', note: '', txnId: null }
};

async function load() {
  S.txns   = (await kvGet('txns'))    || [];
  S.splits = (await kvGet('splits'))  || [];
  S.notSale= (await kvGet('notsale')) || [];
  S.sources= (await kvGet('sources')) || [];
  const st = await kvGet('settings');
  if (st) Object.assign(S.set, st);
  S.calc.rate = S.set.rate;
}
const saveTxns   = () => kvSet('txns', S.txns);
const saveSplits = () => kvSet('splits', S.splits);
const saveNotSale= () => kvSet('notsale', S.notSale);
const saveSrc    = () => kvSet('sources', S.sources);
const saveSet    = () => kvSet('settings', S.set);

/* ═══ 3b. keeping the original PDFs ══════════════════════
   The statement PDF is the source of truth — the ledger can always be
   rebuilt from it. We hold the original bytes so the phone can hand them
   to the PC later, and track which ones have already gone across. */

const savePdf = (name, file) => kvSet('pdf:' + name, file);
const getPdf  = name => kvGet('pdf:' + name);
const dropPdf = name => kvSet('pdf:' + name, undefined);

function canShareFiles(files) {
  try { return !!(navigator.canShare && navigator.canShare({ files })); } catch (e) { return false; }
}

/* One way out to the share sheet, used by both Send buttons.
   Must be called straight from the tap — no await in front of it. */
let sharing = false;
function shareOut(files, title, onSent) {
  if (sharing) { toast('The share sheet is already open'); return; }

  // Vet each file on its own: one type Android dislikes rejects the whole share.
  const ok = files.filter(f => canShareFiles([f]));
  const dropped = files.length - ok.length;

  if (!ok.length) { saveInstead(files, 'This phone will not share these file types'); return; }
  if (dropped) toast(dropped + ' file could not be shared and was left behind', 'r');

  sharing = true;
  navigator.share({ files: ok, title: title }).then(() => {
    sharing = false; S.shareErr = ''; onSent();
  }).catch(e => {
    sharing = false;
    if (e && e.name === 'AbortError') return;                 // backed out — not sent
    S.shareErr = (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : e);
    renderData();
    saveInstead(ok, 'Android refused the share sheet');
  });
}

/* Guaranteed way out. The files land in Downloads; they are NOT marked as
   sent, because they still have to be moved into OneDrive by hand. */
function saveInstead(files, why) {
  files.forEach(f => downloadBlob(f.name, f));
  toast(why + ' — saved to Downloads instead. Move them into OneDrive / FLUX-LEDGER / statements.', 'r');
}

/* Android grants navigator.share() only while the tap's activation is still
   live, and an await spends it — reading the PDF out of IndexedDB first got
   the share refused with "Permission denied". So the originals are held ready
   in memory and share() is called synchronously on the tap. */
const pdfReady = new Map();

async function warmPdfs() {
  for (const s of S.sources) {
    if (!s.kept || pdfReady.has(s.name)) continue;
    try {
      const b = await getPdf(s.name);
      if (b) pdfReady.set(s.name, new File([b], s.name, { type: 'application/pdf' }));
    } catch (e) { /* a missing original just means that row can't be sent */ }
  }
}

function sendToPc(idxs, opts) {                            // deliberately NOT async
  // Statements go on their own. Bundling the GST list meant one file Android
  // disliked took the whole share down with it; the list has its own button.
  const withGst = !!(opts && opts.gst === true);
  const list = idxs.map(i => S.sources[i]).filter(Boolean);
  const files = [];
  for (const s of list) { const f = pdfReady.get(s.name); if (f) files.push(f); }
  const pdfCount = files.length;

  const notYetLoaded = list.filter(s => s.kept && !pdfReady.has(s.name));
  if (!pdfCount && notYetLoaded.length) {
    toast('Still loading that statement — tap Send again in a moment');
    warmPdfs();
    return;
  }
  if (withGst && S.splits.length) files.push(splitsFile());   // decisions ride along
  if (!files.length) {
    toast(list.length ? 'The original PDFs for these are no longer stored' : 'Nothing to send yet', 'r');
    return;
  }

  const done = () => {
    const stamp = today();
    list.forEach(s => { if (pdfReady.has(s.name)) s.sentAt = stamp; });
    if (files.length > pdfCount) { S.set.gstSent = stamp; saveSet(); }
    saveSrc(); renderData(); renderSep();
    const bits = [];
    if (pdfCount) bits.push(pdfCount + ' statement' + (pdfCount === 1 ? '' : 's'));
    if (files.length > pdfCount) bits.push('the GST list');
    toast(bits.join(' + ') + ' handed over', 'g');
  };

  if (navigator.share) shareOut(files, 'FLUX LEDGER statements', done);
  else { files.forEach(f => downloadBlob(f.name, f)); done(); }   // desktop: straight to Downloads
}

/* ── the GST list travels as a small JSON alongside the PDFs ───────
   It holds decisions, not bank data, so it is MERGED on arrival, never
   restored over the top. "Separated" beats "pending" in both directions:
   the money really did move, and a sync must not undo that. */

const SPLIT_FILE = /^flux-ledger-gst-.*\.json$/i;

/* Android's share sheet only accepts files from a fixed allowlist, and
   application/json is not on it — a single disallowed file gets the whole
   share rejected. The content is still JSON; only the wrapper is text. */
function splitsFile() {
  const body = JSON.stringify({
    app: 'flux-ledger', kind: 'splits', v: 1, at: new Date().toISOString(),
    splits: S.splits, notSale: S.notSale
  });
  return new File([body], 'flux-ledger-gst-' + today() + '.txt', { type: 'text/plain' });
}

function cleanSplit(s) {
  const int = v => Number.isFinite(v) ? Math.round(v) : 0;
  return {
    id: String(s.id), added: /^\d{4}-\d{2}-\d{2}$/.test(s.added) ? s.added : today(),
    gross: int(s.gross), base: int(s.base), gst: int(s.gst),
    rate: Number.isFinite(s.rate) ? s.rate : S.set.rate,
    note: String(s.note || '').slice(0, 120), txnId: s.txnId || null,
    status: s.status === 'done' ? 'done' : 'pending',
    settled: /^\d{4}-\d{2}-\d{2}$/.test(s.settled) ? s.settled : null
  };
}

function mergeSplits(incoming) {
  const by = new Map(S.splits.map(s => [s.id, s]));
  let added = 0, marked = 0, same = 0, bad = 0;
  for (const raw of incoming) {
    if (!raw || !raw.id || !Number.isFinite(raw.gst)) { bad++; continue; }
    const inc = cleanSplit(raw);
    const cur = by.get(inc.id);
    if (!cur) { S.splits.push(inc); by.set(inc.id, inc); added++; continue; }
    if (cur.status !== 'done' && inc.status === 'done') {
      cur.status = 'done'; cur.settled = inc.settled || today(); marked++;
    } else same++;
  }
  S.splits.sort((a, b) => a.added < b.added ? 1 : a.added > b.added ? -1 : 0);
  return { added, marked, same, bad };
}

async function importSplitsFile(f, row) {
  const say = (cls, msg) => { if (row) { row.className = 'logrow ' + cls; row.innerHTML = '<span class="fn">' + esc(f.name) + '</span><span class="ms">' + msg + '</span>'; } };
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { say('err', 'Not readable JSON'); return; }
  if (j && Array.isArray(j.txns) && !Array.isArray(j.splits)) {
    say('err', 'That is a full backup — use <b>Restore backup</b> on the Data tab, it replaces rather than merges.');
    return;
  }
  if (!j || !Array.isArray(j.splits)) { say('err', 'Not a FLUX LEDGER GST list'); return; }
  const r = mergeSplits(j.splits);
  let ruled = 0;
  if (Array.isArray(j.notSale)) {                 // union — ruling out is one-way too
    const have = new Set(S.notSale);
    for (const id of j.notSale) if (id && !have.has(id)) { S.notSale.push(String(id)); have.add(id); ruled++; }
    if (ruled) await saveNotSale();
  }
  await saveSplits(); renderSep(); renderDash(); renderData();
  say('ok', '<b>' + r.added + '</b> new, <b>' + r.marked + '</b> newly separated, ' +
      r.same + ' already matched' + (ruled ? ', ' + ruled + ' newly ruled out' : '') +
      (r.bad ? ', ' + r.bad + ' skipped as malformed' : ''));
  toast('GST list merged — ' + r.added + ' new, ' + r.marked + ' marked separated', 'g');
}

/* A PDF shared into the installed app lands in a cache by the service
   worker, which then reloads us with ?shared=1. Pick it up and import it. */
async function collectShared() {
  if (!/[?&]shared=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('flux-ledger-share');
    const keys = await c.keys();
    const files = [];
    for (const k of keys) {
      const res = await c.match(k);
      if (!res) continue;
      const name = decodeURIComponent(k.url.split('/').pop()) || 'shared.pdf';
      files.push(new File([await res.blob()], name, { type: 'application/pdf' }));
      await c.delete(k);
    }
    if (files.length) { go('import'); await handleFiles(files); }
  } catch (e) { /* sharing is a bonus path — never let it break startup */ }
}

/* ═══ 4. PDF -> transactions ═════════════════════════════ */

async function pdfLines(file, password) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf, password: password || undefined, isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(i => i.str && i.str.trim() !== '')
      .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
    // cluster into visual lines by y
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let cur = [], lastY = null;
    const lines = [];
    for (const it of items) {
      if (lastY === null || Math.abs(it.y - lastY) <= 2.6) { cur.push(it); if (lastY === null) lastY = it.y; }
      else { lines.push(cur); cur = [it]; lastY = it.y; }
    }
    if (cur.length) lines.push(cur);
    for (const ln of lines) { ln.sort((a, b) => a.x - b.x); out.push(buildLine(ln, p)); }
  }
  await doc.destroy();
  return out;
}

const AMT = /\d{1,3}(?:,\d{2,3})+\.\d{1,2}|\d+\.\d{2}/g;

function buildLine(items, page) {
  let text = ''; const map = [];
  items.forEach((it, i) => {
    if (i > 0) {
      const pv = items[i - 1];
      if (it.x - (pv.x + pv.w) > 0.9) text += ' ';
    }
    const st = text.length; text += it.s;
    map.push({ s: st, e: text.length, x: it.x, xe: it.x + (it.w || 0) });
  });
  const xAt = idx => { for (const m of map) if (idx >= m.s && idx < m.e) return m.x; return map.length ? map[map.length - 1].x : 0; };
  const monies = [];
  let m; AMT.lastIndex = 0;
  while ((m = AMT.exec(text))) {
    const v = toPaise(m[0]);
    if (v == null) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
    const sfx = /^\s*(Cr|Dr)/i.exec(after);
    monies.push({ v: Math.abs(v), x: xAt(m.index), s: m.index, e: m.index + m[0].length, sfx: sfx ? sfx[1].toLowerCase() : null });
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(), raw: text, monies, page, map,
    y: items.length ? items[0].y : 0,
    x: items.length ? Math.min.apply(null, items.map(i => i.x)) : 0
  };
}
function xOfIdx(line, idx) {
  for (const m of line.map) if (idx >= m.s && idx < m.e) return m.x;
  return -1;
}

const JUNK = /^(page\s*\d+(\s*of\s*\d+)?|.*computer\s*generated.*|.*registered\s*office.*|.*ifsc.*micr.*|.*continued.*|statement\s*of\s*account|customer\s*id\b.*|account\s*(no|number)\b.*|statement\s*period\b.*|(opening|closing)\s*balance.*|total\s*(debit|credit).*|transaction\s*(cheque)?|value\s*date.*|date|no|cheque)$/i;
const HDR  = /(date).{0,40}(particular|description|narration|remark|transaction)/i;

function detectBank(all) {
  if (/IDFC/i.test(all)) return 'IDFC FIRST';
  if (/State Bank of India|\bSBIN\b|\bSBI\b/i.test(all)) return 'SBI';
  const m = /([A-Z][A-Za-z ]{3,28}(?:Bank|BANK))/.exec(all);
  return m ? m[1].trim() : 'Bank';
}
function detectAcct(all) {
  const m = /(?:A\/c|Account)\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([Xx*\d]{6,20})/i.exec(all);
  if (!m) return '';
  const d = m[1].replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

function parseStatement(lines, fname) {
  const all = lines.map(l => l.text).join('\n');
  const bank = detectBank(all), acct = detectAcct(all);

  // column hints from a header row, if one exists — kept in x space, not character space
  let cols = null;
  for (const l of lines) {
    if (!HDR.test(l.text)) continue;
    const xOf = re => { const m = re.exec(l.raw); return m ? xOfIdx(l, m.index) : -1; };
    const c = { dr: xOf(/debit|withdrawal|withdrawl|paid/i), cr: xOf(/credit|deposit|received/i), bal: xOf(/balance/i) };
    if (c.dr > -1 && c.cr > -1) { cols = c; break; }
  }

  // Opening balance. Some statements print the label and the figure on the
  // same line, others (IDFC) put a row of labels above a row of figures.
  let opening = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/opening\s*balance|balance\s*b\/?f|b\/f balance/i.test(l.text)) continue;
    if (l.monies.length) { opening = l.monies[l.monies.length - 1].v; break; }
    const next = lines[i + 1];
    if (next && next.monies.length) { opening = next.monies[0].v; break; }   // figures row beneath the labels
  }

  // ── dated rows ────────────────────────────────────────────────────
  const raw = [];
  for (const l of lines) {
    if (!l.text || JUNK.test(l.text) || HDR.test(l.text)) continue;
    const dm = DATE_LEAD.exec(l.text);
    if (!dm) continue;
    const d = parseDate(dm[1]);
    if (!d || !l.monies.length) continue;
    let narStart = dm[0].length;
    const vd = DATE_LEAD.exec(l.text.slice(narStart));
    if (vd && parseDate(vd[1])) narStart += vd[0].length;      // drop the value date
    raw.push({
      date: d, nar: l.text.slice(narStart), monies: l.monies.slice(),
      page: l.page, y: l.y, line: l, narStart: narStart, above: [], below: []
    });
  }
  if (!raw.length) return { rows: [], bank, acct, opening, err: 'No dated transaction rows found. Is this a scanned image PDF?' };

  attachWrapped(lines, raw);

  // clean narration: drop the money tokens themselves
  for (const r of raw) {
    r.nar = r.nar.replace(AMT, ' ').replace(/\s*(Cr|Dr)\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
    if (r.nar.length > 180) r.nar = r.nar.slice(0, 180);
  }

  // statements printed newest-first get flipped
  if (raw.length > 2 && raw[0].date > raw[raw.length - 1].date) raw.reverse();

  const res = assign(raw, opening, cols);
  const rows = res.rows.map(r => {
    const t = {
      date: r.date, nar: r.nar, debit: r.debit, credit: r.credit, balance: r.balance,
      bank: bank, acct: acct, src: fname, flag: r.flag || ''
    };
    t.cat = categorise(t); t.party = party(t.nar);
    t.id = hash([t.date, t.nar.slice(0, 70), t.debit, t.credit, t.balance].join('|'));
    return t;
  });
  return { rows, bank, acct, opening, mode: res.mode, breaks: res.breaks, score: res.score };
}

/* Statements wrap a long narration over several lines, and IDFC centres that
   block on the dated line — so fragments sit both ABOVE and BELOW the row they
   belong to. Each wrapped line is claimed by the nearest dated row on its page.
   Page headers and footers are excluded by x: they never sit in the narration
   column. */
function attachWrapped(lines, raw) {
  const narX = narrationColumn(raw);
  if (narX == null) return;

  const firstOnPage = new Map();
  raw.forEach((r, i) => { if (!firstOnPage.has(r.page)) firstOnPage.set(r.page, i); });

  for (const l of lines) {
    if (!l.text || JUNK.test(l.text) || HDR.test(l.text)) continue;
    if (l.monies.length || !l.map.length) continue;
    const dm = DATE_LEAD.exec(l.text);
    if (dm && parseDate(dm[1])) continue;
    if (Math.abs(l.x - narX) > 22) continue;          // not in the narration column

    let best = -1, bd = Infinity;
    for (let k = 0; k < raw.length; k++) {
      if (raw[k].page !== l.page) continue;
      const d = Math.abs(raw[k].y - l.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) continue;
    (l.y > raw[best].y ? raw[best].above : raw[best].below).push(l);
  }

  // The block is centred, so the first row on a page keeps only as many lines
  // above it as it has below. The rest are the tail of the previous page's
  // last transaction.
  firstOnPage.forEach(fi => {
    const r = raw[fi];
    if (!r.above.length) return;
    r.above.sort((a, b) => a.y - b.y);                // nearest to the row first
    const spill = r.above.slice(r.below.length);
    r.above = r.above.slice(0, r.below.length);
    // Before the very first transaction there is only the statement header and
    // the account holder's address — that is not narration, so drop it.
    if (fi > 0) spill.forEach(l => raw[fi - 1].below.push(l));
  });

  const order = l => l.page * 100000 - l.y;           // page order, then top-down
  for (const r of raw) {
    r.above.sort((a, b) => order(a) - order(b));
    r.below.sort((a, b) => order(a) - order(b));
    r.nar = r.above.map(l => l.text).concat(r.nar ? [r.nar] : [], r.below.map(l => l.text)).join(' ');
  }
}

/* Where the narration column starts, learned from the dated rows themselves —
   the text between the date columns and the first money on each row. */
function narrationColumn(raw) {
  const xs = [];
  for (const r of raw) {
    if (!r.line || !r.line.map.length || !r.monies.length) continue;
    const firstMoneyX = Math.min.apply(null, r.monies.map(m => m.x));
    const toks = r.line.map.filter(m => m.s >= r.narStart && m.x < firstMoneyX);
    if (toks.length) xs.push(Math.min.apply(null, toks.map(m => m.x)));
  }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];               // median
}

function assign(raw, opening, cols) {
  // Pass A — rightmost money is the running balance; direction follows the balance delta.
  const A = run(true), B = run(false);
  const pick = (A.score >= 0.55 || A.score >= B.score) ? A : B;
  return pick;

  function run(hasBal) {
    const rows = []; let prev = opening, matched = 0, scored = 0, breaks = 0;
    for (const r of raw) {
      const ms = r.monies.slice().sort((a, b) => a.x - b.x);
      let bal = null, cands = ms;
      if (hasBal && ms.length >= 2) { bal = ms[ms.length - 1].v; cands = ms.slice(0, -1); }

      let dr = 0, cr = 0, flag = '', how = '', pick = null;
      const delta = (bal != null && prev != null) ? bal - prev : null;

      if (delta != null) {
        scored++;
        let hit = null;
        for (const c of cands) if (Math.abs(c.v - Math.abs(delta)) <= 1) { hit = c; break; }
        if (hit && delta !== 0) { matched++; pick = hit; how = 'chain'; if (delta > 0) cr = hit.v; else dr = hit.v; }
        else if (delta !== 0) {
          const nz = cands.filter(c => c.v > 0);
          const c = nz.length === 1 ? nz[0] : cands[cands.length - 1];
          if (c) {
            matched++; pick = c; how = 'chain-loose';
            if (delta > 0) cr = c.v; else dr = c.v;
            if (Math.abs(c.v - Math.abs(delta)) > 1) flag = 'amount does not match the balance movement';
          }
        } else { flag = 'no balance movement on this row'; }
      } else {
        // no balance to lean on — Cr/Dr suffix, then header columns, then narration wording
        const c = cands[cands.length - 1] || ms[0];
        if (!c) continue;
        pick = c;
        if (c.sfx === 'cr') { cr = c.v; how = 'suffix'; }
        else if (c.sfx === 'dr') { dr = c.v; how = 'suffix'; }
        else if (cols) { how = 'column'; if (Math.abs(c.x - cols.cr) < Math.abs(c.x - cols.dr)) cr = c.v; else dr = c.v; }
        else {
          how = 'guess';
          if (/deposit|credit|received|refund|interest|by transfer|\bcr\b/i.test(r.nar)) cr = c.v; else dr = c.v;
          flag = 'direction inferred — no balance column and no Cr/Dr marker';
        }
      }

      if (bal != null && prev != null && Math.abs(prev + cr - dr - bal) > 1) {
        breaks++; if (!flag) flag = 'breaks the balance chain';
      }
      if (bal != null) prev = bal;
      if (dr === 0 && cr === 0) continue;
      rows.push({ date: r.date, nar: r.nar, debit: dr, credit: cr, balance: bal, flag, how, x: pick ? pick.x : -1 });
    }
    relearn(rows);
    return { rows, breaks, score: scored ? matched / scored : 0, mode: hasBal ? 'balance-chain' : 'column/suffix' };
  }

  // Rows the chain resolved teach us where the debit and credit columns sit.
  // Anything decided by guesswork or header-position is then re-read against that.
  function relearn(rows) {
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const crX = rows.filter(r => r.how === 'chain' && r.credit && r.x > -1).map(r => r.x);
    const drX = rows.filter(r => r.how === 'chain' && r.debit  && r.x > -1).map(r => r.x);
    if (crX.length < 2 || drX.length < 2) return;
    const c = avg(crX), d = avg(drX);
    if (Math.abs(c - d) < 4) return;                       // single amount column — nothing to learn
    for (const r of rows) {
      if (r.how !== 'guess' && r.how !== 'column') continue;
      if (r.x < 0) continue;
      const v = r.credit || r.debit;
      const isCr = Math.abs(r.x - c) < Math.abs(r.x - d);
      r.credit = isCr ? v : 0; r.debit = isCr ? 0 : v;
      r.how = 'column-learned';
      if (/^direction inferred/.test(r.flag)) r.flag = '';
    }
  }
}

const CATS = [
  [/\b(cgst|sgst|igst|gst\b|gstn|tds|income\s*tax|advance\s*tax)/i, 'Tax'],
  [/\b(int\.?\s?(pd|cr)|interest\s*(paid|credit|earned)?)\b/i, 'Interest'],
  [/(chrg|charge|\bfee\b|commission|\bcomm\b|sms\s*ch|amb\s|penalty|\bnwd\b|min\s*bal)/i, 'Bank charges'],
  [/\b(salary|sal\s*cr|payroll|wages)\b/i, 'Salary'],
  [/\b(emi|loan|od\s*int|overdraft|repayment)\b/i, 'Loan'],
  [/\b(atm|atw|cash\s*(wdl|dep|withdraw|deposit)|cwdr|csw)\b/i, 'Cash'],
  [/\b(chq|cheque|cts|clg)\b/i, 'Cheque'],
  [/\bupi\b/i, 'UPI'],
  [/\brtgs\b/i, 'RTGS'],
  [/\bneft\b/i, 'NEFT'],
  [/\bimps\b/i, 'IMPS'],
  [/\b(ach|nach|si\s|ecs|mandate)\b/i, 'Auto debit']
];
function categorise(t) {
  for (const [re, c] of CATS) if (re.test(t.nar)) return c;
  return t.credit > 0 ? 'Receipts' : 'Payments';
}
const NOISE = /^(upi|neft|rtgs|imps|cr|dr|mb|ib|nb|to|from|payment|pay|paid|transfer|txn|ref|by|cash|chq|online|ft|si|ach|nach|cms|inf|mmt|othpg|collect|p2m|p2a|bank|ltd|pvt|the|and|for|acc|account|india|indian|limited|nil|na|no)$/i;
const BANKCODE = /^(yesb|hdfc|icic|sbin|idfb|utib|punb|kkbk|barb|cnrb|ioba|ubin|pytm|paytm|okaxis|okicici|okhdfcbank|oksbi|ybl|ibl|axl|apl|upi|airtel|fbl|jupiteraxis|slice|naviaxis)$/i;
function party(nar) {
  const parts = String(nar).split(/[\/|\\\-–—:;,]+/).map(s => s.trim()).filter(Boolean);
  let best = '';
  for (const p0 of parts) {
    if (/@/.test(p0)) continue;
    // reference numbers cling to either end of the name — shed them, but leave
    // a leading digit or two alone so names like "3M INDIA" survive
    const p = p0.replace(/^\d{4,}\s*/, '').replace(/\s+[\d\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
    const letters = (p.match(/[A-Za-z]/g) || []).length;
    if (letters < 4) continue;
    const words = p.split(/\s+/).filter(Boolean).map(w => w.replace(/[^A-Za-z]/g, ''));
    if (words.every(w => !w || NOISE.test(w))) continue;      // "Payment NEFT" and friends
    if (BANKCODE.test(p.replace(/[^A-Za-z]/g, ''))) continue;
    if (letters / p.length < 0.55) continue;
    if (p.length > best.length) best = p;
  }
  return best ? best.toUpperCase().slice(0, 42) : '—';
}

/* ═══ 5. periods & filtering ═════════════════════════════ */

function fyOf(d) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  return m >= S.set.fyStart ? y : y - 1;
}
function fyRange(y) {
  const a = iso(1, S.set.fyStart, y);
  const em = S.set.fyStart === 1 ? 12 : S.set.fyStart - 1;
  const ey = S.set.fyStart === 1 ? y : y + 1;
  const last = new Date(ey, em, 0).getDate();
  return [a, iso(last, em, ey)];
}
function periodRange() {
  const p = S.period;
  if (p === 'all') return null;
  if (p === 'custom' && S.custom) return S.custom;
  if (/^\d{4}-\d{2}$/.test(p)) {
    const y = +p.slice(0, 4), m = +p.slice(5, 7);
    return [p + '-01', iso(new Date(y, m, 0).getDate(), m, y)];
  }
  const now = today();
  if (p === 'fy')   return fyRange(fyOf(now));
  if (p === 'lfy')  return fyRange(fyOf(now) - 1);
  if (p === 'd90' || p === 'd30') {
    const n = p === 'd90' ? 90 : 30;
    const dt = new Date(); dt.setDate(dt.getDate() - n);
    return [dt.toISOString().slice(0, 10), now];
  }
  return null;
}
function inPeriod(t) { const r = periodRange(); return !r || (t.date >= r[0] && t.date <= r[1]); }

function scoped() { return S.txns.filter(inPeriod); }
function filtered() {
  const q = S.f.q.trim().toLowerCase();
  return scoped().filter(t => {
    if (S.f.dir === 'cr' && !t.credit) return false;
    if (S.f.dir === 'dr' && !t.debit) return false;
    if (S.f.cat && t.cat !== S.f.cat) return false;
    if (S.f.bank && (t.bank + ' ' + t.acct).trim() !== S.f.bank) return false;
    if (q && !((t.nar + ' ' + t.party + ' ' + t.cat).toLowerCase().indexOf(q) > -1)) return false;
    return true;
  }).sort((a, b) => {
    const k = S.sort.k, d = S.sort.d;
    if (k === 'date') return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * d;
    return ((a[k] || 0) - (b[k] || 0)) * d;
  });
}

/* ═══ 6. charts ══════════════════════════════════════════ */

const tip = $('#tip');
function showTip(html, ev) {
  tip.innerHTML = html; tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y < 8) y = ev.clientY + 18;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => tip.classList.remove('on');

function balChart(el, pts) {
  const W = Math.max(320, el.parentNode.clientWidth - 16), H = 236;
  el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  el.setAttribute('height', H);
  if (pts.length < 2) { el.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="axl">Not enough data for a trail</text>'; return; }
  const P = { l: 62, r: 14, t: 14, b: 26 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const t0 = +new Date(pts[0].d), t1 = +new Date(pts[pts.length - 1].d) || t0 + 1;
  let lo = Math.min.apply(null, pts.map(p => p.v)), hi = Math.max.apply(null, pts.map(p => p.v));
  if (lo === hi) { lo -= 100; hi += 100; }
  const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
  const X = d => P.l + ((+new Date(d) - t0) / (t1 - t0 || 1)) * iw;
  const Y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;

  let g = '', gl = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    gl += '<line class="gl" x1="' + P.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - P.r) + '" y2="' + y.toFixed(1) + '"/>';
    gl += '<text class="axl" x="' + (P.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + Rk(v) + '</text>';
  }
  const dpts = pts.map(p => X(p.d).toFixed(1) + ',' + Y(p.v).toFixed(1));
  const line = 'M' + dpts.join(' L');
  const area = line + ' L' + X(pts[pts.length - 1].d).toFixed(1) + ',' + (P.t + ih) + ' L' + X(pts[0].d).toFixed(1) + ',' + (P.t + ih) + ' Z';
  // Date labels are spaced by PIXELS, not by index — statement dates are irregular,
  // so index sampling piles several labels on top of each other.
  const sameYear = pts[0].d.slice(0, 4) === pts[pts.length - 1].d.slice(0, 4);
  const lab = p => sameYear ? dShort(p.d).replace(/ '\d\d$/, '') : dShort(p.d);
  const minGap = sameYear ? 50 : 68;
  const picks = [];
  let lastX = -1e9;
  pts.forEach(p => { const x = X(p.d); if (x - lastX >= minGap) { picks.push({ x, p }); lastX = x; } });
  const endP = pts[pts.length - 1];
  if (picks.length && X(endP.d) - picks[picks.length - 1].x >= minGap) picks.push({ x: X(endP.d), p: endP });
  picks.forEach((q, i) => {
    const anchor = i === 0 ? 'start' : (i === picks.length - 1 ? 'end' : 'middle');
    g += '<text class="axl" x="' + q.x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + lab(q.p) + '</text>';
  });
  el.innerHTML =
    '<defs><linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#0097B2" stop-opacity=".22"/><stop offset="100%" stop-color="#0097B2" stop-opacity="0"/>' +
    '</linearGradient></defs>' + gl +
    '<path d="' + area + '" fill="url(#tf)"/><path class="line" d="' + line + '"/>' + g +
    '<line class="cross" id="bx" x1="0" y1="' + P.t + '" x2="0" y2="' + (P.t + ih) + '" style="display:none"/>' +
    '<circle class="dot" id="bd" r="4" style="display:none"/>' +
    '<rect class="hit" x="' + P.l + '" y="' + P.t + '" width="' + iw + '" height="' + ih + '"/>';

  const hit = el.querySelector('.hit'), cx = el.querySelector('#bx'), dot = el.querySelector('#bd');
  hit.addEventListener('mousemove', ev => {
    const bb = el.getBoundingClientRect();
    const px = (ev.clientX - bb.left) * (W / bb.width);
    let bi = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(X(p.d) - px); if (d < bd) { bd = d; bi = i; } });
    const p = pts[bi], x = X(p.d), y = Y(p.v);
    cx.setAttribute('x1', x); cx.setAttribute('x2', x); cx.style.display = '';
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = '';
    showTip('<div class="t">' + dShort(p.d) + '</div><b>' + R(p.v) + '</b>' +
      (p.inn || p.out ? '<div class="l"><span>In</span><span>' + R(p.inn) + '</span></div><div class="l"><span>Out</span><span>' + R(p.out) + '</span></div>' : ''), ev);
  });
  hit.addEventListener('mouseleave', () => { hideTip(); cx.style.display = 'none'; dot.style.display = 'none'; });
}

function monChart(el, ms) {
  const W = Math.max(320, el.parentNode.clientWidth - 16), H = 250;
  el.setAttribute('viewBox', '0 0 ' + W + ' ' + H); el.setAttribute('height', H);
  if (!ms.length) { el.innerHTML = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" class="axl">No months in range</text>'; return; }
  const P = { l: 62, r: 14, t: 12, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b, band = iw / ms.length;
  const bw = Math.max(4, Math.min(26, band * 0.32));
  let hi = 0, lo = 0;
  ms.forEach(m => { hi = Math.max(hi, m.inn, m.out, m.net); lo = Math.min(lo, m.net); });
  if (hi === 0) hi = 100;
  const Y = v => P.t + ih - ((v - lo) / ((hi - lo) || 1)) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    g += '<line class="gl" x1="' + P.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - P.r) + '" y2="' + y.toFixed(1) + '"/>' +
         '<text class="axl" x="' + (P.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + Rk(v) + '</text>';
  }
  const y0 = Y(0);
  g += '<line class="zero" x1="' + P.l + '" y1="' + y0.toFixed(1) + '" x2="' + (W - P.r) + '" y2="' + y0.toFixed(1) + '"/>';
  const netpts = [];
  ms.forEach((m, i) => {
    const c = P.l + band * i + band / 2;
    netpts.push(c.toFixed(1) + ',' + Y(m.net).toFixed(1));
    g += '<rect class="bar-in"  x="' + (c - bw - 1).toFixed(1) + '" y="' + Y(m.inn).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, y0 - Y(m.inn)).toFixed(1) + '" rx="1"/>';
    g += '<rect class="bar-out" x="' + (c + 1).toFixed(1) + '" y="' + Y(m.out).toFixed(1) + '" width="' + bw + '" height="' + Math.max(0, y0 - Y(m.out)).toFixed(1) + '" rx="1"/>';
    if (ms.length <= 18 || i % 2 === 0)
      g += '<text class="axl" x="' + c.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + mLabel(m.k) + '</text>';
  });
  g += '<polyline fill="none" stroke="#0097B2" stroke-width="1.6" stroke-dasharray="4 3" points="' + netpts.join(' ') + '"/>';
  ms.forEach((m, i) => {
    g += '<rect class="hit clickable" data-i="' + i + '" x="' + (P.l + band * i).toFixed(1) + '" y="' + P.t + '" width="' + band.toFixed(1) + '" height="' + ih + '"/>';
  });
  el.innerHTML = g;
  $$('.hit', el).forEach(h => {
    h.addEventListener('mousemove', ev => {
      const m = ms[+h.dataset.i];
      showTip('<div class="t">' + mLabel(m.k) + '</div>' +
        '<div class="l"><span>Received</span><span>' + R(m.inn) + '</span></div>' +
        '<div class="l"><span>Paid out</span><span>' + R(m.out) + '</span></div>' +
        '<div class="l"><span>Net</span><span>' + R(m.net) + '</span></div>' +
        '<div class="l"><span>Rows</span><span>' + m.n + '</span></div>', ev);
    });
    h.addEventListener('mouseleave', hideTip);
    h.addEventListener('click', () => { S.period = ms[+h.dataset.i].k; hideTip(); renderAll(); });
  });
}

/* ═══ 7. dashboard ═══════════════════════════════════════ */

function renderDash() {
  const has = S.txns.length > 0;
  $('#dashEmpty').hidden = has; $('#dashBody').hidden = !has;
  if (!has) { $('#dashSub').textContent = 'No statements imported yet.'; return; }

  const rows = scoped();
  const r = periodRange();
  $('#dashSub').textContent = rows.length + ' transactions' +
    (r ? ' · ' + dShort(r[0]) + ' to ' + dShort(r[1]) : ' · all time') +
    ' · ' + S.sources.length + ' statement' + (S.sources.length === 1 ? '' : 's');

  const inn = rows.reduce((a, t) => a + t.credit, 0);
  const out = rows.reduce((a, t) => a + t.debit, 0);
  const withBal = S.txns.filter(t => t.balance != null).sort((a, b) => a.date < b.date ? -1 : 1);
  const closing = withBal.length ? withBal[withBal.length - 1].balance : null;
  const pend = S.splits.filter(s => s.status === 'pending').reduce((a, s) => a + s.gst, 0);
  const pendN = S.splits.filter(s => s.status === 'pending').length;
  const ruledOut = new Set(S.notSale);
  const unsplitN = rows.filter(t => t.credit > 0 && t.cat !== 'Interest' && t.cat !== 'Tax' && t.cat !== 'Loan'
    && !ruledOut.has(t.id) && !S.splits.some(s => s.txnId === t.id)).length;

  const avgIn = rows.filter(t => t.credit > 0);
  $('#kpis').innerHTML = [
    kpi('bal', 'Closing balance', closing == null ? '—' : R(closing),
        closing == null ? 'no balance column found' : 'as of ' + dShort(withBal[withBal.length - 1].date)),
    kpi('in',  'Received', R(inn), avgIn.length + ' receipts · avg ' + Rk(avgIn.length ? inn / avgIn.length : 0)),
    kpi('out', 'Paid out', R(out), rows.filter(t => t.debit > 0).length + ' payments'),
    kpi(inn - out >= 0 ? '' : 'out', 'Net movement', R(inn - out), inn - out >= 0 ? 'money grew in this period' : 'money shrank in this period'),
    kpi('gst', 'GST to separate', R(pend), pendN ? pendN + ' pending · ' + unsplitN + ' receipts not split' : (unsplitN + ' receipts not split yet'))
  ].join('');

  // balance trail — one point per day
  const byDay = {};
  rows.forEach(t => {
    const d = byDay[t.date] || (byDay[t.date] = { d: t.date, v: null, inn: 0, out: 0 });
    d.inn += t.credit; d.out += t.debit;
    if (t.balance != null) d.v = t.balance;
  });
  let pts = Object.keys(byDay).sort().map(k => byDay[k]);
  let run = null;
  pts.forEach(p => { if (p.v == null) { p.v = run == null ? 0 : run + p.inn - p.out; } run = p.v; });
  balChart($('#chBal'), pts);
  $('#balSub').textContent = pts.length + ' days';

  // months
  const mm = {};
  rows.forEach(t => {
    const k = mKey(t.date), m = mm[k] || (mm[k] = { k, inn: 0, out: 0, n: 0 });
    m.inn += t.credit; m.out += t.debit; m.n++;
  });
  const ms = Object.keys(mm).sort().map(k => { mm[k].net = mm[k].inn - mm[k].out; return mm[k]; });
  monChart($('#chMon'), ms.slice(-24));

  // categories — outflow
  const cc = {};
  rows.forEach(t => { const c = cc[t.cat] || (cc[t.cat] = { k: t.cat, v: 0, n: 0, inn: 0 }); c.v += t.debit; c.inn += t.credit; c.n++; });
  const cats = Object.keys(cc).map(k => cc[k]).sort((a, b) => (b.v + b.inn) - (a.v + a.inn)).slice(0, 9);
  const cmax = Math.max.apply(null, cats.map(c => c.v + c.inn).concat([1]));
  $('#catRank').innerHTML = cats.map(c =>
    '<li class="' + (c.v >= c.inn ? 'o' : 'i') + (S.f.cat === c.k ? ' sel' : '') + '" data-cat="' + esc(c.k) + '">' +
    '<span class="fill" style="width:' + ((c.v + c.inn) / cmax * 100).toFixed(1) + '%"></span>' +
    '<span class="row"><span class="nm">' + esc(c.k) + '</span><span class="ct">' + c.n + '</span>' +
    '<span class="am" style="color:' + (c.v >= c.inn ? 'var(--out)' : 'var(--in)') + '">' + Rk(c.v >= c.inn ? c.v : c.inn) + '</span></span></li>'
  ).join('') || '<li class="empty">Nothing here</li>';

  // parties
  const pp = {};
  rows.forEach(t => {
    if (t.party === '—') return;
    const p = pp[t.party] || (pp[t.party] = { k: t.party, inn: 0, out: 0, n: 0 });
    p.inn += t.credit; p.out += t.debit; p.n++;
  });
  const ps = Object.keys(pp).map(k => pp[k]).sort((a, b) => (b.inn + b.out) - (a.inn + a.out)).slice(0, 9);
  const pmax = Math.max.apply(null, ps.map(p => p.inn + p.out).concat([1]));
  $('#partyRank').innerHTML = ps.map(p =>
    '<li class="' + (p.inn >= p.out ? 'i' : 'o') + '" data-party="' + esc(p.k) + '">' +
    '<span class="fill" style="width:' + ((p.inn + p.out) / pmax * 100).toFixed(1) + '%"></span>' +
    '<span class="row"><span class="nm">' + esc(p.k) + '</span><span class="ct">' + p.n + '</span>' +
    '<span class="am" style="color:' + (p.inn >= p.out ? 'var(--in)' : 'var(--out)') + '">' + Rk(p.inn >= p.out ? p.inn : p.out) + '</span></span></li>'
  ).join('') || '<li class="empty">No named counterparties found</li>';

  // top movers
  const ti = rows.filter(t => t.credit > 0).sort((a, b) => b.credit - a.credit).slice(0, 7);
  const to = rows.filter(t => t.debit > 0).sort((a, b) => b.debit - a.debit).slice(0, 7);
  $('#topIn').innerHTML = ti.map(t =>
    '<tr><td class="dt">' + dShort(t.date) + '</td><td class="nar">' + esc(t.party === '—' ? t.nar.slice(0, 46) : t.party) + '</td>' +
    '<td class="num r cr">' + R(t.credit) + '</td>' +
    '<td class="r"><button class="btn sm p" data-split="' + t.id + '">Split</button></td></tr>').join('') ||
    '<tr><td class="empty" colspan="4">No receipts in this period</td></tr>';
  $('#topOut').innerHTML = to.map(t =>
    '<tr><td class="dt">' + dShort(t.date) + '</td><td class="nar">' + esc(t.party === '—' ? t.nar.slice(0, 46) : t.party) + '</td>' +
    '<td class="num r dr">' + R(t.debit) + '</td></tr>').join('') ||
    '<tr><td class="empty" colspan="3">No payments in this period</td></tr>';
}
function kpi(cls, k, v, s) {
  return '<div class="kpi ' + cls + '"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + esc(s) + '</span></div>';
}

/* ═══ 8. transactions ════════════════════════════════════ */

function renderTxn() {
  const rows = filtered();
  const shown = rows.slice(0, S.limit);
  $('#txnRows').innerHTML = shown.map((t, i) =>
    '<tr class="' + (i % 2 ? 'zebra' : '') + '">' +
    '<td class="dt">' + dShort(t.date) + '</td>' +
    '<td class="nar">' + esc(t.nar || '—') +
      (t.flag ? '<small style="color:var(--warn)">⚠ ' + esc(t.flag) + '</small>' : (t.party !== '—' ? '<small>' + esc(t.party) + '</small>' : '')) + '</td>' +
    '<td class="opt"><span class="chip n">' + esc(t.cat) + '</span></td>' +
    '<td class="num r ' + (t.credit ? 'cr' : '') + '">' + (t.credit ? R(t.credit) : '') + '</td>' +
    '<td class="num r ' + (t.debit ? 'dr' : '') + '">' + (t.debit ? R(t.debit) : '') + '</td>' +
    '<td class="num r opt" style="color:var(--mut)">' + (t.balance != null ? fmtP(t.balance) : '') + '</td>' +
    '<td class="r">' + (t.credit ? '<button class="btn sm" data-split="' + t.id + '">Split</button>' : '') + '</td></tr>'
  ).join('') || '<tr><td class="empty" colspan="7"><b>No transactions match</b>Try clearing the filters or widening the period.</td></tr>';

  const inn = rows.reduce((a, t) => a + t.credit, 0), out = rows.reduce((a, t) => a + t.debit, 0);
  $('#txnFoot').innerHTML =
    'Showing <b>' + shown.length + '</b> of <b>' + rows.length + '</b>' +
    ' &nbsp; Received <b style="color:var(--in)">' + R(inn) + '</b>' +
    ' &nbsp; Paid <b style="color:var(--out)">' + R(out) + '</b>' +
    ' &nbsp; Net <b>' + R(inn - out) + '</b>';
  $('#moreWrap').hidden = rows.length <= S.limit;
  $('#txnSub').textContent = S.txns.length + ' transactions stored from ' + S.sources.length + ' statement' + (S.sources.length === 1 ? '' : 's');

  const cats = Array.from(new Set(S.txns.map(t => t.cat))).sort();
  const banks = Array.from(new Set(S.txns.map(t => (t.bank + ' ' + t.acct).trim()))).sort();
  fillSel($('#fCat'), cats, S.f.cat, 'All categories');
  fillSel($('#fBank'), banks, S.f.bank, 'All accounts');
  $$('.tbl thead th.s').forEach(th => {
    th.querySelector('.ar').textContent = S.sort.k === th.dataset.sort ? (S.sort.d < 0 ? '▾' : '▴') : '';
  });
}
function fillSel(sel, opts, val, allLbl) {
  if (sel.dataset.sig === opts.join('|')) { sel.value = val; return; }
  sel.dataset.sig = opts.join('|');
  sel.innerHTML = '<option value="">' + allLbl + '</option>' + opts.map(o => '<option>' + esc(o) + '</option>').join('');
  sel.value = val;
}

/* ═══ 9. GST separator ═══════════════════════════════════ */

const RATES = [5, 12, 18, 28];

function calcSplit(gross, rate, mode) {
  if (gross == null || gross <= 0) return { gross: 0, base: 0, gst: 0 };
  if (mode === 'excl') {
    const gst = Math.round(gross * rate / 100);
    return { gross: gross + gst, base: gross, gst };
  }
  const base = Math.round(gross * 100 / (100 + rate));
  return { gross, base, gst: gross - base };
}

function renderCalc() {
  $('#rates').innerHTML = RATES.map(r =>
    '<button data-rate="' + r + '" aria-pressed="' + (S.calc.rate === r) + '">' + r + '%</button>').join('');
  $$('#modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.calc.mode)));
  $('#calcMode2').textContent = S.calc.mode === 'incl'
    ? 'Amount the customer paid you, GST included.'
    : 'Your taxable value — GST will be added on top.';

  const r = calcSplit(S.calc.gross, S.calc.rate, S.calc.mode);
  const half = (S.calc.rate / 2);
  $('#oGross').textContent = R(r.gross);
  $('#oBase').textContent  = R(r.base);
  $('#oGst').textContent   = R(r.gst);
  $('#oCgst').textContent  = R(Math.floor(r.gst / 2));
  $('#oSgst').textContent  = R(r.gst - Math.floor(r.gst / 2));
  $('#oIgst').textContent  = R(r.gst);
  $('#oHalfRate').textContent = half + '%';
  $('#oHalfRate2').textContent = half + '%';
  $('#oFullRate').textContent = S.calc.rate + '%';
  $('#addSplit').disabled = !(r.gst > 0);
}

function renderSep() {
  const pend = S.splits.filter(s => s.status === 'pending');
  const pendTot = pend.reduce((a, s) => a + s.gst, 0);
  const doneTot = S.splits.filter(s => s.status === 'done').reduce((a, s) => a + s.gst, 0);
  $('#duePend').textContent = R(pendTot);
  $('#dueSub').textContent = pend.length
    ? pend.length + ' amount' + (pend.length === 1 ? '' : 's') + ' waiting · ' + R(doneTot) + ' already moved'
    : (S.splits.length ? 'All clear — ' + R(doneTot) + ' moved so far.' : 'Nothing pending.');
  $('#markAll').disabled = !pend.length;

  const view = S.sepView;
  const list = S.splits.filter(s => !view || s.status === view);
  $('#sepRows').innerHTML = list.map(s =>
    '<tr class="' + (s.status === 'done' ? 'done' : '') + '">' +
    '<td class="dt opt">' + dShort(s.added) + '</td>' +
    '<td class="nar">' + esc(s.note || '—') + (s.txnId ? '<small>from statement</small>' : '') + '</td>' +
    '<td class="num r">' + R(s.gross) + '</td>' +
    '<td class="num r opt">' + s.rate + '%</td>' +
    '<td class="num r opt">' + R(s.base) + '</td>' +
    '<td class="num r" style="color:var(--gold);font-weight:600">' + R(s.gst) + '</td>' +
    '<td>' + (s.status === 'done'
      ? '<span class="chip g">Separated ' + (s.settled ? dShort(s.settled) : '') + '</span>'
      : '<span class="chip y">Pending</span>') + '</td>' +
    '<td class="r" style="white-space:nowrap">' +
      (s.status === 'done'
        ? '<button class="btn sm" data-undo="' + s.id + '">Undo</button>'
        : '<button class="btn sm p" data-done="' + s.id + '">Mark separated</button>') +
      ' <button class="btn sm d" data-del="' + s.id + '">✕</button>' +
    '</td></tr>'
  ).join('') || '<tr><td class="empty" colspan="8"><b>Nothing in this view</b>Split a payment above and it lands here.</td></tr>';

  const lt = list.reduce((a, s) => a + s.gst, 0), lg = list.reduce((a, s) => a + s.gross, 0);
  $('#sepFoot').innerHTML = '<span>Rows <b>' + list.length + '</b></span>' +
    '<span>Payments <b>' + R(lg) + '</b></span>' +
    '<span>GST in view <b style="color:var(--gold)">' + R(lt) + '</b></span>' +
    '<span>Taxable <b>' + R(lg - lt) + '</b></span>';
  $('#sepSub').textContent = S.splits.length + ' total' + (S.set.gstSent ? ' · sent to PC ' + dShort(S.set.gstSent) : '');
  $('#sendGst').disabled = !S.splits.length;
  $('#fSep').value = view;

  // unsplit receipts
  const done = new Set(S.splits.map(s => s.txnId).filter(Boolean));
  // Bank interest and tax refunds are not customer payments — never invite a
  // GST split on them.
  const NOT_A_SALE = { Interest: 1, Tax: 1, Loan: 1 };
  const ruled = new Set(S.notSale);
  const pending = scoped().filter(t => t.credit > 0 && !done.has(t.id) && !NOT_A_SALE[t.cat] && !ruled.has(t.id));
  const un = pending.slice().sort((a, b) => b.date < a.date ? -1 : 1).slice(0, 12);
  $('#unsplit').innerHTML = un.map(t =>
    '<tr><td class="dt">' + dShort(t.date) + '</td>' +
    '<td class="nar">' + esc(t.party === '—' ? t.nar.slice(0, 40) : t.party) + '</td>' +
    '<td class="num r cr">' + R(t.credit) + '</td>' +
    '<td class="r" style="white-space:nowrap">' +
      '<button class="btn sm p" data-split="' + t.id + '">Split</button> ' +
      '<button class="btn sm" data-nosale="' + t.id + '" title="Not a customer payment">Not a sale</button>' +
    '</td></tr>').join('') ||
    '<tr><td class="empty" colspan="4">Nothing left to split in this period.</td></tr>';

  const ruledHere = scoped().filter(t => t.credit > 0 && ruled.has(t.id)).length;
  $('#unsplitFoot').innerHTML =
    '<span>Waiting <b>' + pending.length + '</b></span>' +
    (pending.length > un.length ? '<span>showing the latest ' + un.length + '</span>' : '') +
    (ruledHere ? '<span>Ruled out <b>' + ruledHere + '</b> ' +
      '<button class="btn sm" id="restoreNoSale" style="margin-left:6px">Restore</button></span>' : '');

  const p = $('#pipGst');
  p.hidden = !pend.length; p.textContent = pend.length;
  const pt = $('#pipTxn');
  pt.hidden = !S.txns.length; pt.textContent = S.txns.length > 999 ? '999+' : S.txns.length;
}

function loadIntoCalc(id) {
  const t = S.txns.find(x => x.id === id);
  if (!t) return;
  S.calc.gross = t.credit; S.calc.mode = 'incl'; S.calc.txnId = t.id;
  S.calc.note = (t.party !== '—' ? t.party : t.nar.slice(0, 40)) + ' · ' + dShort(t.date);
  $('#gross').value = fmtP(t.credit);
  $('#note').value = S.calc.note;
  go('gst'); renderCalc();
  $('#gross').focus();
  toast('Loaded ' + R(t.credit) + ' into the separator');
}

/* ═══ 10. import flow ════════════════════════════════════ */

let pending = null;

/* Bank e-statements are nearly always password protected (IDFC and SBI both
   ship them locked). Ask, retry, and never keep the password anywhere. */
async function openWithPassword(f, row) {
  let pw = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await pdfLines(f, pw);
    } catch (err) {
      const locked = err && (err.name === 'PasswordException' || /password/i.test(err.message || ''));
      if (!locked) throw err;
      if (row) row.querySelector('.ms').textContent = attempt ? 'password rejected — try again' : 'password protected';
      pw = window.prompt('"' + f.name + '" is password protected.\n\n' +
        (attempt ? 'That password did not work. Try again:' : 'Enter the PDF password:'));
      if (pw === null) throw new Error('skipped — no password given');
      if (row) row.querySelector('.ms').textContent = 'reading…';
    }
  }
  throw new Error('could not unlock after 4 attempts');
}

async function handleFiles(files) {
  const all = Array.prototype.slice.call(files);
  const list = all.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  // the GST list travels as .txt so Android will share it — accept either
  const jsons = all.filter(f => /\.(json|txt)$/i.test(f.name) ||
                                f.type === 'application/json' || f.type === 'text/plain');
  if (!list.length && !jsons.length) { toast('Drop statement PDFs, or a GST list from the phone', 'r'); return; }
  $('#log').innerHTML = '';

  for (const f of jsons) {                       // the GST list coming back from the phone
    const row = document.createElement('div');
    row.className = 'logrow';
    row.innerHTML = '<span class="spin"></span><span class="fn">' + esc(f.name) + '</span><span class="ms">merging…</span>';
    $('#log').appendChild(row);
    await importSplitsFile(f, row);
  }
  if (!list.length) return;

  const collected = [];
  for (const f of list) {
    const row = document.createElement('div');
    row.className = 'logrow';
    row.innerHTML = '<span class="spin"></span><span class="fn">' + esc(f.name) + '</span><span class="ms">reading…</span>';
    $('#log').appendChild(row);
    try {
      const lines = await openWithPassword(f, row);
      const res = parseStatement(lines, f.name);
      if (!res.rows.length) {
        row.className = 'logrow err';
        row.innerHTML = '<span class="fn">' + esc(f.name) + '</span><span class="ms">' + esc(res.err || 'No transactions found') + '</span>';
        continue;
      }
      res.file = f;                                   // keep the original for the PC handover
      collected.push(res);
      const bad = res.rows.filter(r => r.flag).length;
      row.className = 'logrow ' + (bad ? 'warn' : 'ok');
      row.innerHTML = '<span class="fn">' + esc(f.name) + '</span><span class="ms">' +
        res.bank + (res.acct ? ' ··' + res.acct : '') + ' — <b>' + res.rows.length + '</b> rows, ' +
        dShort(res.rows[0].date) + ' to ' + dShort(res.rows[res.rows.length - 1].date) +
        (bad ? ' · <span style="color:var(--warn)">' + bad + ' flagged</span>' : ' · chain clean') + '</span>';
    } catch (e) {
      row.className = 'logrow err';
      row.innerHTML = '<span class="fn">' + esc(f.name) + '</span><span class="ms">Could not read: ' + esc(e.message || e) + '</span>';
    }
  }
  if (!collected.length) { $('#reviewWrap').hidden = true; pending = null; return; }
  review(collected);
}

function review(results) {
  const seen = new Set(S.txns.map(t => t.id));
  const all = [], dups = [];
  results.forEach(res => res.rows.forEach(r => { if (seen.has(r.id)) dups.push(r); else { seen.add(r.id); all.push(r); } }));
  pending = { rows: all, results };

  const inn = all.reduce((a, t) => a + t.credit, 0), out = all.reduce((a, t) => a + t.debit, 0);
  const flagged = all.filter(t => t.flag);
  const dates = all.map(t => t.date).sort();
  $('#revSub').textContent = all.length + ' new rows';
  $('#revStats').innerHTML =
    dl('New transactions', all.length) +
    dl('Already imported (skipped)', dups.length) +
    dl('Period', dates.length ? dShort(dates[0]) + ' → ' + dShort(dates[dates.length - 1]) : '—') +
    dl('Received', R(inn)) + dl('Paid out', R(out)) + dl('Net', R(inn - out)) +
    dl('Read method', results.map(r => r.mode).join(', ')) +
    dl('Balance-chain match', results.map(r => Math.round(r.score * 100) + '%').join(', '));
  $('#revWarn').innerHTML = flagged.length
    ? '<b style="color:var(--warn)">⚠ ' + flagged.length + ' row' + (flagged.length === 1 ? '' : 's') + ' need a look.</b> ' +
      'They are marked in the table below. The most common cause is a multi-line narration that swallowed a number, ' +
      'or a statement that omits the running balance. You can still import — flagged rows stay tagged so you can find them later.'
    : '<b style="color:var(--in)">✓ Every row reconciles.</b> Previous balance + received − paid equals the printed balance on all ' + all.length + ' rows.';
  $('#dupNote').textContent = dups.length ? dups.length + ' duplicate rows will be skipped' : '';

  $('#revRows').innerHTML = all.slice(0, 400).map(t =>
    '<tr' + (t.flag ? ' style="background:var(--warn-bg)"' : '') + '>' +
    '<td class="dt">' + dShort(t.date) + '</td>' +
    '<td class="nar">' + esc(t.nar) + (t.flag ? '<small style="color:var(--warn)">⚠ ' + esc(t.flag) + '</small>' : '') + '</td>' +
    '<td class="num r cr">' + (t.credit ? R(t.credit) : '') + '</td>' +
    '<td class="num r dr">' + (t.debit ? R(t.debit) : '') + '</td>' +
    '<td class="num r opt" style="color:var(--mut)">' + (t.balance != null ? fmtP(t.balance) : '—') + '</td>' +
    '<td class="opt">' + (t.flag ? '<span class="chip y">check</span>' : '<span class="chip g">ok</span>') + '</td></tr>').join('');
  $('#reviewWrap').hidden = false;
  $('#confirmImp').disabled = !all.length;
  $('#reviewWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
const dl = (k, v) => '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>';

async function commitImport() {
  if (!pending || !pending.rows.length) return;
  S.txns = S.txns.concat(pending.rows).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const r of pending.results) {
    let kept = false;
    if (r.file) {
      try {
        await savePdf(r.rows[0].src, r.file);
        pdfReady.set(r.rows[0].src, new File([r.file], r.rows[0].src, { type: 'application/pdf' }));
        kept = true;
      } catch (e) { kept = false; }
    }
    S.sources.push({
      name: r.rows[0].src, bank: r.bank, acct: r.acct, n: r.rows.length,
      from: r.rows[0].date, to: r.rows[r.rows.length - 1].date, at: today(),
      size: r.file ? r.file.size : 0, kept: kept, sentAt: null
    });
  }
  const n = pending.rows.length;
  pending = null;
  $('#reviewWrap').hidden = true;
  await saveTxns(); await saveSrc();
  toast(n + ' transactions imported', 'g');
  go('dash'); renderAll();
}

/* ═══ 11. data tab ═══════════════════════════════════════ */

function renderData() {
  const inn = S.txns.reduce((a, t) => a + t.credit, 0), out = S.txns.reduce((a, t) => a + t.debit, 0);
  const dates = S.txns.map(t => t.date).sort();
  $('#dataStats').innerHTML =
    dl('Transactions', S.txns.length) +
    dl('Statements', S.sources.length) +
    dl('Span', dates.length ? dShort(dates[0]) + ' → ' + dShort(dates[dates.length - 1]) : '—') +
    dl('Total received', R(inn)) + dl('Total paid out', R(out)) +
    dl('Split entries', S.splits.length) +
    dl('GST pending', R(S.splits.filter(s => s.status === 'pending').reduce((a, s) => a + s.gst, 0))) +
    dl('Flagged rows', S.txns.filter(t => t.flag).length);

  const unsent = S.sources.filter(s => s.kept && !s.sentAt).length;
  $('#sendAll').disabled = !unsent;
  $('#sendAll').textContent = unsent ? 'Send ' + unsent + ' to PC' : 'All sent';
  $('#sendSub').textContent = S.sources.length
    ? (unsent ? unsent + ' statement' + (unsent === 1 ? '' : 's') + ' not yet on the PC'
              : 'Every stored statement has been handed over.')
    : 'Nothing imported yet.';

  // What this phone will actually accept — so a refusal can be diagnosed
  // instead of guessed at.
  const probePdf = new File([new Uint8Array([37, 80, 68, 70])], 'probe.pdf', { type: 'application/pdf' });
  const probeTxt = new File(['{}'], 'probe.txt', { type: 'text/plain' });
  const bits = [
    'share ' + (navigator.share ? 'yes' : 'no'),
    'pdf ' + (canShareFiles([probePdf]) ? 'ok' : 'no'),
    'list ' + (canShareFiles([probeTxt]) ? 'ok' : 'no'),
    'both ' + (canShareFiles([probePdf, probeTxt]) ? 'ok' : 'no'),
    'held ' + pdfReady.size
  ];
  $('#shareDiag').innerHTML = '<code>' + esc(bits.join(' · ')) + '</code>' +
    (S.shareErr ? '<br><b style="color:var(--out)">last refusal — ' + esc(S.shareErr) + '</b>' : '');

  $('#srcRows').innerHTML = S.sources.map((s, i) =>
    '<tr><td class="nar">' + esc(s.name) +
      '<small>' + esc(s.bank) + (s.acct ? ' ··' + s.acct : '') + ' · ' + dShort(s.from) + ' → ' + dShort(s.to) + '</small></td>' +
    '<td class="num r opt">' + s.n + '</td>' +
    '<td>' + (!s.kept ? '<span class="chip n">not stored</span>'
              : s.sentAt ? '<span class="chip g">on PC ' + dShort(s.sentAt) + '</span>'
                         : '<span class="chip y">on phone only</span>') + '</td>' +
    '<td class="r" style="white-space:nowrap">' +
      (s.kept ? '<button class="btn sm ' + (s.sentAt ? '' : 'p') + '" data-send="' + i + '">Send</button> ' : '') +
      '<button class="btn sm d" data-rmsrc="' + i + '">✕</button></td></tr>').join('') ||
    '<tr><td class="empty" colspan="4">No statements imported</td></tr>';

  $('#setRate').value = String(S.set.rate);
  $('#setFy').value = String(S.set.fyStart);
  $('#setOpen').value = S.set.open == null ? '' : fmtP(S.set.open);
}

/* ═══ 12. shell wiring ═══════════════════════════════════ */

function go(tab) {
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + tab));
  scrollTo({ top: 0, behavior: 'smooth' });
}

function periodBtns() {
  const months = Array.from(new Set(S.txns.map(t => mKey(t.date)))).sort().slice(-6);
  const opts = [['all', 'All'], ['fy', 'This FY'], ['lfy', 'Last FY'], ['d90', '90 days'], ['d30', '30 days']]
    .concat(months.map(m => [m, mLabel(m)]));
  const html = opts.map(([v, l]) => '<button data-p="' + v + '" aria-pressed="' + (S.period === v) + '">' + l + '</button>').join('');
  $('#periodBar').innerHTML = html; $('#periodBar2').innerHTML = html;
}

function renderAll() { periodBtns(); renderDash(); renderTxn(); renderCalc(); renderSep(); renderData(); }

function wire() {
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-p],[data-goto],[data-split],[data-cat],[data-party],[data-done],[data-undo],[data-del],[data-rmsrc],[data-send],[data-nosale],#restoreNoSale,[data-rate],[data-mode]');
    if (!t) return;
    if (t.dataset.p !== undefined) { S.period = t.dataset.p; renderAll(); }
    else if (t.dataset.goto) go(t.dataset.goto);
    else if (t.dataset.split) loadIntoCalc(t.dataset.split);
    else if (t.dataset.cat !== undefined) { S.f.cat = S.f.cat === t.dataset.cat ? '' : t.dataset.cat; go('txn'); renderTxn(); renderDash(); }
    else if (t.dataset.party !== undefined) { S.f.q = t.dataset.party; $('#q').value = t.dataset.party; go('txn'); renderTxn(); }
    else if (t.dataset.rate) { S.calc.rate = +t.dataset.rate; renderCalc(); }
    else if (t.dataset.mode) { S.calc.mode = t.dataset.mode; renderCalc(); }
    else if (t.dataset.done) markSplit(t.dataset.done, 'done');
    else if (t.dataset.undo) markSplit(t.dataset.undo, 'pending');
    else if (t.dataset.del) { S.splits = S.splits.filter(s => s.id !== t.dataset.del); saveSplits(); renderSep(); renderDash(); }
    else if (t.dataset.nosale) {
      if (S.notSale.indexOf(t.dataset.nosale) < 0) S.notSale.push(t.dataset.nosale);
      saveNotSale(); renderSep(); renderDash();
    }
    else if (t.id === 'restoreNoSale') {
      const here = new Set(scoped().filter(x => x.credit > 0).map(x => x.id));
      S.notSale = S.notSale.filter(id => !here.has(id));
      saveNotSale(); renderSep(); renderDash();
      toast('Restored to the unsplit list');
    }
    else if (t.dataset.send !== undefined) sendToPc([+t.dataset.send]);
    else if (t.dataset.rmsrc !== undefined) removeSource(+t.dataset.rmsrc);
  });

  $('#sendAll').addEventListener('click', () =>
    sendToPc(S.sources.map((s, i) => (s.kept && !s.sentAt) ? i : -1).filter(i => i >= 0)));

  /* The share sheet can be refused by the phone; writing a file never is.
     Everything lands in Downloads, ready to be put into OneDrive by hand. */
  $('#saveLocal').addEventListener('click', () => {
    const out = [];
    S.sources.forEach(s => { const f = pdfReady.get(s.name); if (f && !s.sentAt) out.push(f); });
    if (!out.length) S.sources.forEach(s => { const f = pdfReady.get(s.name); if (f) out.push(f); });
    if (S.splits.length) out.push(splitsFile());
    if (!out.length) { toast('Nothing stored to save yet', 'r'); return; }
    out.forEach(f => downloadBlob(f.name, f));
    toast(out.length + ' file' + (out.length === 1 ? '' : 's') +
      ' saved to Downloads — put them in OneDrive / FLUX-LEDGER / statements', 'g');
  });

  // ── import
  const drop = $('#drop'), file = $('#file');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { handleFiles(file.files); file.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => {
    if (e.target.closest('#drop')) return;
    e.preventDefault();
    if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) { go('import'); handleFiles(e.dataTransfer.files); }
  }));
  $('#confirmImp').addEventListener('click', commitImport);
  $('#cancelImp').addEventListener('click', () => { pending = null; $('#reviewWrap').hidden = true; $('#log').innerHTML = ''; });

  // ── transactions
  let qt;
  $('#q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { S.f.q = $('#q').value; S.limit = 250; renderTxn(); }, 160); });
  $('#fDir').addEventListener('change', e => { S.f.dir = e.target.value; renderTxn(); });
  $('#fCat').addEventListener('change', e => { S.f.cat = e.target.value; renderTxn(); });
  $('#fBank').addEventListener('change', e => { S.f.bank = e.target.value; renderTxn(); });
  $('#clearF').addEventListener('click', () => { S.f = { q: '', dir: '', cat: '', bank: '' }; $('#q').value = ''; renderTxn(); renderDash(); });
  $('#moreBtn').addEventListener('click', () => { S.limit += 250; renderTxn(); });
  $$('.tbl thead th.s').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (S.sort.k === k) S.sort.d *= -1; else { S.sort.k = k; S.sort.d = -1; }
    renderTxn();
  }));
  $('#expTxn').addEventListener('click', () => {
    const rows = [['Date', 'Narration', 'Party', 'Category', 'Received', 'Paid', 'Balance', 'Bank', 'Account', 'Source', 'Flag']];
    filtered().forEach(t => rows.push([t.date, t.nar, t.party, t.cat, t.credit ? (t.credit / 100).toFixed(2) : '',
      t.debit ? (t.debit / 100).toFixed(2) : '', t.balance != null ? (t.balance / 100).toFixed(2) : '', t.bank, t.acct, t.src, t.flag]));
    download('flux-ledger-transactions-' + today() + '.csv', csv(rows));
  });

  // ── calculator
  const gi = $('#gross');
  gi.addEventListener('input', () => {
    const v = toPaise(gi.value.replace(/[^\d.,]/g, ''));
    S.calc.gross = v; S.calc.txnId = S.calc.txnId && v === S.calc.gross ? S.calc.txnId : S.calc.txnId;
    renderCalc();
  });
  gi.addEventListener('blur', () => { if (S.calc.gross) gi.value = fmtP(S.calc.gross); });
  gi.addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#addSplit').disabled) $('#addSplit').click(); });
  $('#note').addEventListener('input', () => { S.calc.note = $('#note').value; });
  $('#resetCalc').addEventListener('click', clearCalc);
  $('#addSplit').addEventListener('click', addSplit);

  // ── separation list
  $('#fSep').addEventListener('change', e => { S.sepView = e.target.value; renderSep(); });
  $('#sendGst').addEventListener('click', () => {          // no await before share()
    if (!S.splits.length) { toast('The GST list is empty'); return; }
    const f = splitsFile();
    const done = () => {
      S.set.gstSent = today(); saveSet(); renderSep();
      toast('GST list handed over — drop it on the PC to merge', 'g');
    };
    if (navigator.share) shareOut([f], 'FLUX LEDGER GST list', done);
    else { downloadBlob(f.name, f); done(); }
  });

  $('#markAll').addEventListener('click', () => {
    const n = S.splits.filter(s => s.status === 'pending').length;
    if (!n) return;
    if (!confirm('Mark all ' + n + ' pending amounts as separated?')) return;
    S.splits.forEach(s => { if (s.status === 'pending') { s.status = 'done'; s.settled = today(); } });
    saveSplits(); renderSep(); renderDash(); toast(n + ' marked separated', 'g');
  });
  $('#clearDone').addEventListener('click', () => {
    const n = S.splits.filter(s => s.status === 'done').length;
    if (!n) { toast('Nothing separated yet'); return; }
    if (!confirm('Remove ' + n + ' separated rows from the list? Export first if you want a record.')) return;
    S.splits = S.splits.filter(s => s.status !== 'done'); saveSplits(); renderSep();
  });
  $('#expGst').addEventListener('click', () => {
    const rows = [['Added', 'Label', 'Payment received', 'GST rate %', 'Taxable value', 'GST to transfer', 'CGST', 'SGST', 'Status', 'Separated on']];
    S.splits.forEach(s => rows.push([s.added, s.note, (s.gross / 100).toFixed(2), s.rate, (s.base / 100).toFixed(2),
      (s.gst / 100).toFixed(2), (Math.floor(s.gst / 2) / 100).toFixed(2), ((s.gst - Math.floor(s.gst / 2)) / 100).toFixed(2),
      s.status, s.settled || '']));
    download('flux-ledger-gst-separation-' + today() + '.csv', csv(rows));
  });

  // ── data tab
  $('#setRate').addEventListener('change', e => { S.set.rate = +e.target.value; S.calc.rate = +e.target.value; saveSet(); renderCalc(); });
  $('#setFy').addEventListener('change', e => { S.set.fyStart = +e.target.value; saveSet(); renderAll(); });
  $('#setOpen').addEventListener('change', e => { S.set.open = toPaise(e.target.value); saveSet(); renderAll(); });
  $('#backup').addEventListener('click', () => {
    download('flux-ledger-backup-' + today() + '.json',
      JSON.stringify({ v: 1, at: new Date().toISOString(), txns: S.txns, splits: S.splits, notSale: S.notSale, sources: S.sources, settings: S.set }, null, 1),
      'application/json');
  });
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.txns)) throw new Error('not a FLUX LEDGER backup');
      if (!confirm('Replace everything in this browser with the backup (' + j.txns.length + ' transactions)?')) return;
      S.txns = j.txns; S.splits = j.splits || []; S.notSale = j.notSale || []; S.sources = j.sources || [];
      if (j.settings) Object.assign(S.set, j.settings);
      await saveTxns(); await saveSplits(); await saveNotSale(); await saveSrc(); await saveSet();
      renderAll(); toast('Backup restored', 'g');
    } catch (err) { toast('Could not restore: ' + err.message, 'r'); }
    e.target.value = '';
  });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('Erase all transactions and the separation list from this browser?')) return;
    if (!confirm('Really erase? This cannot be undone without a backup.')) return;
    S.txns = []; S.splits = []; S.notSale = []; S.sources = [];
    await saveTxns(); await saveSplits(); await saveNotSale(); await saveSrc();
    renderAll(); toast('Everything erased');
  });

  addEventListener('resize', debounce(() => { if ($('#p-dash').classList.contains('on')) renderDash(); }, 220));
  // Charts measure their container. The brand font is a large embedded payload,
  // so re-render once after it lands — a one-shot, deliberately NOT a
  // ResizeObserver, which feeds back into its own re-layout and never settles.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (S.txns.length && $('#p-dash').classList.contains('on')) renderDash();
    });
  }
}
function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

function addSplit() {
  const r = calcSplit(S.calc.gross, S.calc.rate, S.calc.mode);
  if (!(r.gst > 0)) return;
  S.splits.unshift({
    id: hash(Date.now() + ':' + r.gross + ':' + Math.random()),
    added: today(), gross: r.gross, base: r.base, gst: r.gst, rate: S.calc.rate,
    note: S.calc.note || '', txnId: S.calc.txnId, status: 'pending', settled: null
  });
  saveSplits(); clearCalc(); renderSep(); renderDash();
  toast(R(r.gst) + ' added to the separation list', 'g');
}
function clearCalc() {
  S.calc.gross = null; S.calc.note = ''; S.calc.txnId = null;
  $('#gross').value = ''; $('#note').value = ''; renderCalc(); $('#gross').focus();
}
function markSplit(id, status) {
  const s = S.splits.find(x => x.id === id); if (!s) return;
  s.status = status; s.settled = status === 'done' ? today() : null;
  saveSplits(); renderSep(); renderDash();
}
async function removeSource(i) {
  const s = S.sources[i]; if (!s) return;
  if (!confirm('Remove "' + s.name + '" and its ' + s.n + ' transactions?' +
      (s.kept && !s.sentAt ? '\n\nThis copy has NOT been sent to the PC yet — it will be gone.' : ''))) return;
  S.txns = S.txns.filter(t => t.src !== s.name);
  S.sources.splice(i, 1);
  pdfReady.delete(s.name);
  try { await dropPdf(s.name); } catch (e) {}
  await saveTxns(); await saveSrc();
  renderAll(); toast('Removed ' + s.name);
}

/* ═══ boot ═══════════════════════════════════════════════ */

(async function () {
  await load();
  wire();
  renderAll();
  warmPdfs();                       // ready before the first tap on Send
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('ledger-sw.js').catch(() => {});
  collectShared();
})();

})();
