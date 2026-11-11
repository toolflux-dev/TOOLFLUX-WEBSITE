/* ═══════════════════════════════════════════════════════════════
   TOOLFLUX MACHINING LOG  v3
   Component-job-centric. Insert lifecycle per station. Offline.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── constants ────────────────────────────────────────────────────
const DB_KEY = 'toolflux.machlog.v3';

// ── sync config ───────────────────────────────────────────────────
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxasFuUZrrB79_1TN23yYRtjWoPvbz8FEWhKisv1racE_Q9zxXbqSQv5_UqhN6-v8rw/exec';
let _syncTimer = null;

// ── license / paywall ────────────────────────────────────────────
const TRIAL_DAYS = 14;

// Pricing tiers — they gate only how many operator devices may sync; every
// feature is in every tier. Mirrors TIER_DEVICE_LIMIT in machlog-sync.gs.
const TIERS = {
  solo:  { name: 'Solo',  price: 299,  devices: 1 },
  shop:  { name: 'Shop',  price: 799,  devices: 5 },
  works: { name: 'Works', price: 2499, devices: Infinity },
};
const TIER_ORDER = ['solo', 'shop', 'works'];

const OP_TYPES = [
  ['turning',         'Turning',          'op-turn'],
  ['face_milling',    'Face Milling',     'op-mill'],
  ['end_milling',     'End Milling',      'op-mill'],
  ['slot_milling',    'Slot Milling',     'op-mill'],
  ['udrill',          'U-Drill',          'op-drill'],
  ['twist_drill',     'Twist Drill',      'op-drill'],
  ['boring',          'Boring',           'op-bore'],
  ['reaming',         'Reaming',          'op-ream'],
  ['tapping',         'Tapping',          'op-tap'],
  ['threading',       'Threading',        'op-tap'],
  ['chamfering',      'Chamfering',       'op-drill'],
  ['counter_boring',  'Counter Boring',   'op-bore'],
  ['counter_sinking', 'Counter Sinking',  'op-bore'],
  ['grooving',        'Grooving',         'op-turn'],
  ['other',           'Other',            'op-other'],
];

const OP_MAP = Object.fromEntries(OP_TYPES.map(([k, label, cls]) => [k, { label, cls }]));
// 'solid'   = drill/tap: whole tool replaced, no corners
// 'milling' = face/end/slot mill etc: cutter body holds N inserts, each with corners
// 'turning' = single insert per tool, holder, corners
function toolCategory(opType) {
  if (opType === 'twist_drill' || opType === 'tapping') return 'solid';
  if (['face_milling','end_milling','slot_milling','chamfering','counter_boring','counter_sinking','udrill'].includes(opType)) return 'milling';
  return 'turning';
}
function isSolidTool(opType) { return toolCategory(opType) === 'solid'; }
const MACHINES = ['CNC-01', 'VMC-02', 'VMC-01', 'CNC-02', 'LT-01', 'LT-02'];

// ── helpers ───────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => Math.random().toString(36).slice(2, 10);
const isoNow = () => new Date().toISOString();
const fmtDate = iso => { const d = new Date(iso); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) };
const fmtTime = iso => { const d = new Date(iso); return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}).toUpperCase() };
const fmtDT = iso => `${fmtDate(iso)} ${fmtTime(iso)}`;
const fmtN = (n, d=0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtRs = (n, d=2) => n == null || isNaN(n) ? '—' : '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits:d, maximumFractionDigits:d});
const toast = (msg, type='', dur=2600) => {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type+'-t' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), dur);
};

// ── db ───────────────────────────────────────────────────────────
const REJECTION_REASONS = ['Dimensional','Surface finish','Burr / sharp edge','Chatter marks','Tool mark','Setup error','Material defect','Other'];

const blankDB = () => ({
  v: 4,
  jobs: [],
  inventory: [],
  settings: {
    company: '',
    defaultOperator: '',
    defaultMachine: 'VMC-02',
    email: '',
    trialStartedAt: null,
    license: null,
    rejectionReasons: [...REJECTION_REASONS],
    deviceRole: null,   // null/'owner' on the owner's device, 'operator' on a joined device
    shopId: null,       // shared shop identity (owner: = installId; operator: from invite link)
    operators: [],      // owner's team: [{ id, name, addedAt }]
  },
  history: {
    operators: [],
    machines: [...MACHINES],
    componentCodes: [],
    componentDescs: [],
    customers: [],
    insertDesigs: [],
    insertGrades: [],
    insertBrands: [],
    toolHolders: [],
    stationNames: [],
  },
});

// ── data helpers ──────────────────────────────────────────────────
// A part goes through every operation, so it is counted where it leaves the
// job: on the last operation. Entries without an operation (old data) and
// single-operation jobs always count.
function isFinalOpEntry(job, e) {
  const ops = (job && job.operations) || [];
  if (ops.length <= 1 || !e.operationId) return true;
  return e.operationId === ops[ops.length - 1].id;
}
// Returns ALL stations across all operations (for backward compat reads)
function jobAllStations(job) {
  if (job.operations && job.operations.length) return job.operations.flatMap(op => op.stations || []);
  return job.stations || [];
}
// Returns stations for a specific operation ID
function jobOpStations(job, opId) {
  if (!job.operations) return job.stations || [];
  const op = job.operations.find(o => o.id === opId);
  return op ? (op.stations || []) : [];
}
// Returns the currently active operation for UI context
function getActiveOp(job) {
  if (!job || !job.operations || !job.operations.length) return null;
  return job.operations.find(o => o.id === ui.activeOpId) || job.operations[0];
}
function getActiveOpStations(job) { const op = getActiveOp(job); return op ? (op.stations || []) : []; }

let db;

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) { db = JSON.parse(raw); }
    else { db = blankDB(); }
    if (!Array.isArray(db.jobs)) db.jobs = [];
    if (!Array.isArray(db.inventory)) db.inventory = [];
    if (!db.settings) db.settings = blankDB().settings;
    if (!db.history) db.history = blankDB().history;
    if (db.settings.email === undefined) db.settings.email = '';
    if (db.settings.license === undefined) db.settings.license = null;
    if (!db.settings.rejectionReasons) db.settings.rejectionReasons = [...REJECTION_REASONS];
    if (!db.settings.trialStartedAt && db.settings.company) db.settings.trialStartedAt = new Date().toISOString();
    if (!db.settings.installId) db.settings.installId = uid(); // permanent per-device ID, never changes
    if (db.settings.deviceRole === undefined) db.settings.deviceRole = null;
    if (!Array.isArray(db.settings.operators)) db.settings.operators = [];
    if (!Array.isArray(db.settings.appliedEvents)) db.settings.appliedEvents = []; // owner: event ids already reconciled
    if (!Array.isArray(db.outbox)) db.outbox = []; // operator: production events awaiting confirmation
    // Owner's shop identity defaults to their installId (existing owners keep their sync tabs)
    if (!db.settings.shopId && db.settings.deviceRole !== 'operator') db.settings.shopId = db.settings.installId;
    // v3→v4 migration: wrap flat stations into operations[]
    db.jobs.forEach(job => {
      if (!job.operations) {
        job.operations = [{ id: uid(), name: 'Op-1', sequence: 1, stations: job.stations || [] }];
        delete job.stations;
      }
      // Add qtyGood + rejections to old log entries
      (job.productionLog || []).forEach(e => {
        if (e.qtyGood === undefined) e.qtyGood = e.qty;
        if (!e.rejections) e.rejections = [];
        if (!e.operationId) e.operationId = job.operations[0].id;
      });
    });
  } catch(e) {
    console.error('DB load error', e);
    db = blankDB();
  }
}

function saveDB() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch(e) { console.error('DB save error', e); toast('Save failed — storage full?', 'bad'); return; }
  scheduleSyncDebounced();
}

function scheduleSyncDebounced() {
  if (!SYNC_URL) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(silentSync, 4000);
}

function buildSyncPayload() {
  const cid = getShopId() || db.settings.installId || 'unknown';
  return JSON.stringify({
    role: 'owner',
    customerId: cid,
    shopId: cid,
    syncedAt: new Date().toISOString(),
    jobs: db.jobs || [],
    inventory: db.inventory || [],
    operators: db.settings.operators || [],
    settings: {
      company: db.settings.company,
      defaultMachine: db.settings.defaultMachine,
      rejectionReasons: db.settings.rejectionReasons || [],
    },
  });
}

// Offline resilience: a pending flag survives browser restarts; retries use
// exponential backoff. Every push is a full snapshot, so the last successful
// push always carries every prior operation — no per-op queue needed.
const SYNC_PENDING_KEY = 'toolflux.machlog.syncPending';
let _syncRetryTimer = null;
let _syncBackoffMs = 5000;
let _lastSyncAttempt = 0;

function markSyncPending()  { try { localStorage.setItem(SYNC_PENDING_KEY, new Date().toISOString()); } catch (e) {} }
function clearSyncPending() { try { localStorage.removeItem(SYNC_PENDING_KEY); } catch (e) {} }
function hasSyncPending()   { try { return !!localStorage.getItem(SYNC_PENDING_KEY); } catch (e) { return false; } }

function attemptSync() {
  if (!SYNC_URL) return;
  // Operator devices must never push a full snapshot — it would overwrite the
  // owner's shop data. They upload append-only events instead (Phase 2).
  if (isOperatorDevice()) { clearSyncPending(); return; }
  if (Date.now() - _lastSyncAttempt < 2000) {
    // burst collapse — a snapshot push is already in flight; re-check shortly
    clearTimeout(_syncRetryTimer);
    _syncRetryTimer = setTimeout(attemptSync, 2500);
    return;
  }
  _lastSyncAttempt = Date.now();
  if (navigator.onLine === false) { scheduleSyncRetry(); return; }
  try {
    fetch(SYNC_URL, {
      method: 'POST',
      body: buildSyncPayload(),
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
    }).then(() => {
      clearSyncPending();
      _syncBackoffMs = 5000;
      try { localStorage.setItem('toolflux.machlog.lastSyncOk', new Date().toISOString()); } catch (e) {}
    }).catch(() => scheduleSyncRetry());
  } catch(_) { scheduleSyncRetry(); }
}

function scheduleSyncRetry() {
  clearTimeout(_syncRetryTimer);
  _syncRetryTimer = setTimeout(attemptSync, _syncBackoffMs);
  _syncBackoffMs = Math.min(_syncBackoffMs * 2, 5 * 60 * 1000);
}

// Immediate audit sync — call after audit-critical mutations (production log,
// insert index/replace, edits, deletes). Fire-and-forget, never blocks the UI.
function syncNow() {
  if (!SYNC_URL) return;
  markSyncPending();
  clearTimeout(_syncTimer); // debounced push would carry the same snapshot
  attemptSync();
}

function silentSync() { attemptSync(); } // existing scheduled callers preserved

// ── multi-device shop sync (Phase 2) ──────────────────────────────
// Owner device = authority: it pushes the full shop as the master document
// and pulls operators' production events, reconciling them in. Operator
// devices = append-only clients: they push production events and pull the
// master to see the shop. All applies are idempotent by event id, so the
// two sides converge without a full-snapshot push ever crossing devices.
let _opSyncTimer = null;

function operatorEnqueue(jobId, entry) {
  db.outbox = db.outbox || [];
  if (!db.outbox.some(o => o.id === entry.id)) {
    db.outbox.push({ id: entry.id, kind: 'production', jobId, entry });
    saveDB();
  }
}

function operatorSyncSoon() { clearTimeout(_opSyncTimer); _opSyncTimer = setTimeout(operatorSyncTick, 1200); }

function operatorSyncTick() {
  if (!SYNC_URL || !isOperatorDevice() || navigator.onLine === false) return;
  // 1) push any unconfirmed production events (fire-and-forget; confirmed via pull)
  if ((db.outbox || []).length) {
    try {
      fetch(SYNC_URL, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ role: 'operator', shopId: getShopId(), deviceId: db.settings.installId, events: db.outbox }),
      }).catch(() => {});
    } catch (_) {}
  }
  // 2) pull the master document and adopt the shop's current state
  fetch(SYNC_URL + '?action=pull&shop=' + encodeURIComponent(getShopId()) + '&device=' + encodeURIComponent(db.settings.installId || ''))
    .then(r => r.ok ? r.json() : null)
    .then(m => {
      if (!m) return;
      // Over the shop's tier limit: the server keeps refusing this phone's
      // uploads. Entries stay queued here and send once the owner upgrades.
      const over = !!m.overLimit;
      if (over !== !!db.settings.overLimit) { db.settings.overLimit = over; saveDB(); patchSyncStatus(); }
      if (!m.empty && Array.isArray(m.jobs)) adoptMaster(m);
    })
    .catch(() => {});
}

// Operator adopts the owner's master: replace shop structure, keep own identity,
// then re-apply any still-unconfirmed local events so nothing flickers away.
function adoptMaster(m) {
  if (ui.logOpen) return; // don't yank the ground out while the operator is typing an entry
  db.jobs = Array.isArray(m.jobs) ? m.jobs : [];
  if (Array.isArray(m.inventory)) db.inventory = m.inventory;
  const s = m.settings || {};
  if (s.company != null) db.settings.company = s.company;
  if (Array.isArray(s.rejectionReasons)) db.settings.rejectionReasons = s.rejectionReasons;
  if (s.defaultMachine) db.settings.defaultMachine = s.defaultMachine;
  if (Array.isArray(m.operators)) db.settings.operators = m.operators;

  const present = new Set();
  db.jobs.forEach(j => (j.productionLog || []).forEach(e => present.add(e.id)));
  db.outbox = (db.outbox || []).filter(o => !present.has(o.id)); // drop confirmed
  db.outbox.forEach(o => { const job = db.jobs.find(j => j.id === o.jobId); if (job) applyProductionEntry(job, o.entry); }); // keep unconfirmed visible

  try { localStorage.setItem('toolflux.machlog.lastSyncOk', new Date().toISOString()); } catch (e) {}
  saveDB();
  render();
}

// Owner pulls operators' production events and reconciles new ones into the
// master, then re-pushes so every device converges.
function ownerReconcileTick() {
  if (!SYNC_URL || isOperatorDevice() || navigator.onLine === false) return;
  fetch(SYNC_URL + '?action=events&shop=' + encodeURIComponent(getShopId()))
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !Array.isArray(data.events) || !data.events.length) return;
      const applied = db.settings.appliedEvents = db.settings.appliedEvents || [];
      const seen = new Set(applied);
      let changed = false;
      data.events.forEach(ev => {
        if (!ev || !ev.id || seen.has(ev.id)) return;
        if (ev.kind === 'production' && ev.entry) {
          const job = db.jobs.find(j => j.id === ev.jobId);
          if (!job) return; // owner doesn't have this job yet — retry next tick, don't mark done
          if (applyProductionEntry(job, ev.entry)) changed = true;
          applied.push(ev.id); seen.add(ev.id);
        } else { applied.push(ev.id); seen.add(ev.id); }
      });
      if (applied.length > 3000) applied.splice(0, applied.length - 3000);
      saveDB();
      if (changed) { syncNow(); render(); } // push the reconciled master out to operators
    })
    .catch(() => {});
}

function shopSyncTick() { if (isOperatorDevice()) operatorSyncTick(); else ownerReconcileTick(); }

// Live connection status for the operator's screen.
function syncStatusInfo() {
  let lastOk = null;
  try { lastOk = localStorage.getItem('toolflux.machlog.lastSyncOk'); } catch (e) {}
  const pending = (db.outbox || []).length;
  const online = navigator.onLine !== false;
  if (!online)   return { state: 'offline', label: 'Offline', detail: pending ? `${pending} to send when back online` : 'Will sync when back online' };
  if (db.settings.overLimit) return { state: 'blocked', label: 'Not syncing', detail: 'Phone limit reached — ask the owner to upgrade. Entries are kept on this phone.' };
  if (pending)   return { state: 'pending', label: 'Sending…', detail: `${pending} production ${pending === 1 ? 'entry' : 'entries'}` };
  if (lastOk)    return { state: 'ok', label: 'Synced', detail: 'Updated ' + fmtAgo(lastOk) };
  return { state: 'idle', label: 'Connecting…', detail: 'Reaching your shop' };
}

function syncStatusBar() {
  const s = syncStatusInfo();
  return `<div id="op-sync" class="op-sync ${s.state}">
    <span class="op-sync-dot"></span>
    <span class="op-sync-lbl">${esc(s.label)}</span>
    <span class="op-sync-detail">${esc(s.detail)}</span>
    <button class="op-sync-refresh" onclick="manualSync()" aria-label="Sync now">&#8635;</button>
  </div>`;
}

function manualSync() {
  toast('Syncing…');
  shopSyncTick();
  setTimeout(patchSyncStatus, 400);
}

function patchSyncStatus() {
  const el = document.getElementById('op-sync');
  if (!el || !isOperatorDevice()) return;
  const s = syncStatusInfo();
  el.className = 'op-sync ' + s.state;
  const l = el.querySelector('.op-sync-lbl'), d = el.querySelector('.op-sync-detail');
  if (l) l.textContent = s.label;
  if (d) d.textContent = s.detail;
}

function addHistory(key, val) {
  if (!val || !String(val).trim()) return;
  const v = String(val).trim();
  if (!db.history[key]) db.history[key] = [];
  const arr = db.history[key];
  const idx = arr.findIndex(x => String(x).toLowerCase() === v.toLowerCase());
  if (idx === 0) return;
  if (idx > 0) arr.splice(idx, 1);
  arr.unshift(v);
  if (arr.length > 60) arr.length = 60;
}

// ── license helpers ───────────────────────────────────────────────
// ── license validation ────────────────────────────────────────────
// Everything read from localStorage is untrusted until it passes shape,
// format and plausibility checks. Server (GAS) remains the source of truth;
// these checks only raise the bar against casual local tampering.

const LAST_SEEN_KEY = 'toolflux.machlog.lastSeen';
const MS_DAY = 86400000;

// Monotonic clock anchor: expiry math uses max(now, lastSeen), so rolling
// the device clock backwards gains nothing. A single write can never jump
// more than 45 days forward, so an accidentally future-set clock cannot
// poison the anchor permanently; successful server contact re-anchors it.
function touchLastSeen() {
  try {
    const prev = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0', 10) || 0;
    const next = Math.max(prev, Math.min(Date.now(), prev ? prev + 45 * MS_DAY : Date.now()));
    localStorage.setItem(LAST_SEEN_KEY, String(next));
  } catch (e) {}
}
function anchorLastSeen() { // called after confirmed server contact
  try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (e) {}
}
function effectiveNow() {
  let seen = 0;
  try { seen = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0', 10) || 0; } catch (e) {}
  return Math.max(Date.now(), seen);
}

// Server tokens are always 'TF' + 64 uppercase hex chars (HMAC-SHA256)
function isValidTokenFormat(t) { return typeof t === 'string' && /^TF[0-9A-F]{64}$/.test(t); }

// A past-or-missing timestamp, parsed defensively; future values are never trusted
function trustedPastTs(v) {
  const t = Date.parse(v || '');
  if (isNaN(t) || t > Date.now() + MS_DAY) return 0;
  return t;
}

// Returns a validated license view, or null when the stored object is
// missing, malformed, or carries impossible values. Never throws.
function sanitizeLicense(lic) {
  try {
    if (!lic || typeof lic !== 'object' || Array.isArray(lic)) return null;
    if (!isValidTokenFormat(lic.token)) return null;
    const email = (typeof lic.email === 'string' && lic.email.includes('@')) ? lic.email
      : (typeof db.settings.email === 'string' && db.settings.email.includes('@')) ? db.settings.email
      : null;
    if (!email) return null;
    let expiresAt = null;
    if (lic.expiresAt != null) {
      expiresAt = Date.parse(lic.expiresAt);
      if (isNaN(expiresAt)) return null;
      // The server never issues an expiry more than ~35 days out; anything
      // beyond 400 days is an impossible value, not a real license.
      if (expiresAt > Date.now() + 400 * MS_DAY) return null;
    }
    const tier = TIERS[lic.tier] ? lic.tier : null;
    return { token: lic.token, email, expiresAt, lastVerified: trustedPastTs(lic.lastVerified), tier };
  } catch (e) { return null; }
}

// 'fresh' | 'overdue' | 'stale' — how recently the server confirmed this license
function getVerificationState() {
  const lic = sanitizeLicense(db.settings.license);
  if (!lic) return null;
  const days = lic.lastVerified ? (Date.now() - lic.lastVerified) / MS_DAY : 999;
  return days < 7 ? 'fresh' : days < 30 ? 'overdue' : 'stale';
}

function getLicenseStatus() {
  const s = db.settings;
  const now = effectiveNow();

  const lic = sanitizeLicense(s.license);
  if (lic) {
    if (lic.expiresAt != null) {
      if (lic.expiresAt > now) return 'licensed';
      // expired — falls through to trial/paywall; online re-verification
      // refreshes expiry automatically after renewal
    } else {
      // No expiry from server: require proof-of-life within 60 days
      if (lic.lastVerified && now - lic.lastVerified < 60 * MS_DAY) return 'licensed';
    }
  }

  // Setup not finished yet: the trial starts when it is, so a brand-new
  // visitor must never be told their subscription has ended.
  if (!s.trialStartedAt && !s.company) return 'trial';

  if (s.trialStartedAt) {
    let ts = Date.parse(s.trialStartedAt);
    // Corrupt or future start date: self-heal to now rather than lock a
    // legitimate user (a wiped storage would grant a fresh trial anyway)
    if (isNaN(ts) || ts > Date.now() + MS_DAY) {
      s.trialStartedAt = new Date().toISOString();
      ts = Date.now();
      saveDB();
    }
    if (now < ts + TRIAL_DAYS * MS_DAY) return 'trial';
  }
  return 'expired';
}

function getTrialDaysLeft() {
  const s = db.settings;
  if (!s.trialStartedAt) return TRIAL_DAYS;
  const ts = trustedPastTs(s.trialStartedAt);
  if (!ts) return TRIAL_DAYS;
  return Math.max(0, Math.ceil((ts + TRIAL_DAYS * MS_DAY - effectiveNow()) / MS_DAY));
}

// ── pricing tier ──────────────────────────────────────────────────
// Trial runs at Works level so the shop sees multi-device sync before it
// chooses. Licences from before tiers carry none: they were bought on the
// ₹299 plan, which is Solo.
function getTier() {
  if (getLicenseStatus() === 'trial') return 'works';
  const lic = sanitizeLicense(db.settings.license);
  return (lic && lic.tier) || 'solo';
}
function getDeviceLimit() { return TIERS[getTier()].devices; }
function canAddOperator() { return (db.settings.operators || []).length < getDeviceLimit(); }
function nextTierFor(count) { return TIER_ORDER.find(t => TIERS[t].devices >= count) || 'works'; }
function tierPrice(t) { return '₹' + TIERS[t].price.toLocaleString('en-IN'); }
function subscribeLabel(t) { return `Subscribe — ${TIERS[t].name} ${tierPrice(t)} / month`; }

// ── read-only (lapsed subscription) ───────────────────────────────
// When the subscription ends the shop keeps ALL its data and can still read,
// print and export it — only new entries and edits are blocked. Locking an
// owner out of their own production history would be hostile and pointless.
function isReadOnly() {
  if (isOperatorDevice()) return false; // operators ride the owner's licence
  return getLicenseStatus() === 'expired';
}

// Gate for every user-initiated write. Returns false (and nudges) when lapsed.
function requireActive() {
  if (!isReadOnly()) return true;
  toast('Subscription ended — subscribe to add or change data', 'bad');
  return false;
}

function trialBanner() {
  if (!db.settings.company) return ''; // still on setup — nothing to sell yet
  if (hasOwnerPin() && !isOwner()) return ''; // operators don't see subscription info
  if (isOperatorDevice()) return '';
  if (isReadOnly()) {
    return `<div class="trial-bar ro-bar">
      <span class="trial-bar-txt"><strong>Read-only</strong> — subscription ended. Your data is safe and still viewable; subscribe to log production again.</span>
      <button class="btn-trial-sub" onclick="navigate('paywall')">Subscribe — from &#8377;299/mo</button>
    </div>`;
  }
  if (getLicenseStatus() !== 'trial') return '';
  const days = getTrialDaysLeft();
  return `<div class="trial-bar">
    <span class="trial-bar-txt"><strong>${days} day${days !== 1 ? 's' : ''} left</strong> in your free trial</span>
    <button class="btn-trial-sub" onclick="navigate('paywall')">Subscribe</button>
  </div>`;
}

function datalist(id, histKey) {
  const dl = document.getElementById(id);
  if (!dl) return;
  const items = db.history[histKey] || [];
  dl.innerHTML = items.map(v => `<option value="${esc(v)}">`).join('');
}

// ── owner / operator mode ─────────────────────────────────────────
// Client-side deterrence, not cryptographic security. The synced Google
// Sheet history remains the audit source of truth.
const OWNER_SESSION_KEY = 'toolflux.machlog.owner';
const PIN_ATTEMPT_KEY = 'toolflux.machlog.pinAttempts';
const OWNER_TIMEOUT_MS = 15 * 60 * 1000;
const OWNER_VIEWS = ['settings', 'inventory', 'report', 'newjob', 'paywall', 'dash', 'start'];

// Pure-JS synchronous SHA-256 — crypto.subtle is unavailable on some
// file:// contexts and old shop-PC browsers, so no async, no dependencies.
function sha256Hex(msg) {
  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = [];
  for (let i = 0; i < msg.length; i++) {
    let c = msg.codePointAt(i);
    if (c > 0xFFFF) i++;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i*4] << 24) | (bytes[off + i*4 + 1] << 16) | (bytes[off + i*4 + 2] << 8) | bytes[off + i*4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i-15]) ^ rotr(18, w[i-15]) ^ (w[i-15] >>> 3);
      const s1 = rotr(17, w[i-2]) ^ rotr(19, w[i-2]) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6,e) ^ rotr(11,e) ^ rotr(25,e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(2,a) ^ rotr(13,a) ^ rotr(22,a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// PIN is salted with installId so identical PINs hash differently per customer
function pinHash(pin) { return sha256Hex((db.settings.installId || 'tf') + ':' + String(pin)); }
function hasOwnerPin() { return !!(db.settings && db.settings.ownerPinHash); }

// ── shop / team (multi-device) ────────────────────────────────────
// The owner's device IS the shop. Operators join via an invite link and
// run as append-only clients. Phase 1: identity, invites, join & lock.
function isOperatorDevice() { return !!(db.settings && db.settings.deviceRole === 'operator'); }
function getShopId() { return (db.settings && (db.settings.shopId || db.settings.installId)) || ''; }

function buildInviteLink(opName) {
  const base = location.origin + location.pathname;
  const q = '?shop=' + encodeURIComponent(getShopId()) + (opName ? '&op=' + encodeURIComponent(opName) : '');
  return base + q;
}

function addOperatorToTeam(name) {
  const n = String(name || '').trim();
  if (!n) { toast('Enter an operator name', 'bad'); return null; }
  if (!Array.isArray(db.settings.operators)) db.settings.operators = [];
  if (db.settings.operators.some(o => o.name.toLowerCase() === n.toLowerCase())) { toast('That operator already exists', 'bad'); return null; }
  const op = { id: uid(), name: n, addedAt: isoNow() };
  db.settings.operators.push(op);
  addHistory('operators', n); // also feed the autocomplete list
  saveDB();
  return op;
}

function removeOperator(id) {
  if (!confirm('Remove this operator? Their existing link will stop working.')) return;
  db.settings.operators = (db.settings.operators || []).filter(o => o.id !== id);
  saveDB();
  toast('Operator removed');
  render();
}

function submitAddOperator(e) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  if (needsPinForOperator()) {
    const name = ((document.getElementById('team-op-name') || {}).value || '').trim();
    if (!name) { toast('Enter an operator name', 'bad'); return; }
    ui.pendingOperator = name;
    openPinSetup(false, 'operator');
    return;
  }
  if (!canAddOperator()) {
    const lim = getDeviceLimit();
    toast(`${TIERS[getTier()].name} includes ${lim} operator phone${lim === 1 ? '' : 's'} — upgrade to add more`, 'warn', 6000);
    navigate('paywall');
    return;
  }
  const inp = document.getElementById('team-op-name');
  const op = addOperatorToTeam(inp ? inp.value : '');
  if (op) { toast(`${op.name} added — send them the link`, 'ok'); render(); }
}

function copyInvite(opId) {
  const op = (db.settings.operators || []).find(o => o.id === opId);
  const link = buildInviteLink(op ? op.name : '');
  const done = () => toast('Invite link copied — paste in WhatsApp', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
  else fallbackCopy(link, done);
}

function shareInvite(opId) {
  const op = (db.settings.operators || []).find(o => o.id === opId);
  const link = buildInviteLink(op ? op.name : '');
  const msg = `${op ? op.name + ', here' : 'Here'}'s your ${db.settings.company || 'shop'} Machining Log link. Open it on your phone to log production:\n${link}`;
  if (window.innerWidth <= 860 && navigator.share) {
    navigator.share({ title: 'TOOLFLUX Machining Log', text: msg }).catch(() => {});
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}

// Parse an invite link on startup. A blank/unclaimed device that opens
// ?shop=... becomes an operator client; the owner's own device ignores it.
function handleJoinFromUrl() {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const shop = params.get('shop');
  if (!shop) return;
  const opName = params.get('op') ? decodeURIComponent(params.get('op')) : '';

  // Already the operator for this shop → just refresh the operator name.
  if (isOperatorDevice() && db.settings.shopId === shop) {
    if (opName && !db.settings.defaultOperator) { db.settings.defaultOperator = opName; saveDB(); }
    return;
  }
  // This device already belongs to an owner (has a shop of its own) → ignore
  // the link so an owner clicking their own invite isn't demoted to operator.
  if (db.settings.company && !isOperatorDevice()) return;

  // Fresh device → join as an operator client.
  db.settings.deviceRole = 'operator';
  db.settings.shopId = shop;
  if (opName) db.settings.defaultOperator = opName;
  db.settings.pinPromptShown = true;   // operators never set a PIN
  db.settings.tutorialSeen = db.settings.tutorialSeen || false;
  saveDB();
}

function ownerSession() {
  try { return JSON.parse(sessionStorage.getItem(OWNER_SESSION_KEY) || 'null'); } catch (e) { return null; }
}

function isOwner() {
  if (isOperatorDevice()) return false; // a device joined via invite link is always an operator
  if (!hasOwnerPin()) return true; // no PIN configured — legacy install keeps full access
  const s = ownerSession();
  if (!s || !s.la) return false;
  if (Date.now() - s.la > OWNER_TIMEOUT_MS) { sessionStorage.removeItem(OWNER_SESSION_KEY); return false; }
  return true;
}

function touchOwnerActivity() {
  const s = ownerSession();
  if (!s || !s.la) return;
  if (Date.now() - s.la > OWNER_TIMEOUT_MS) { sessionStorage.removeItem(OWNER_SESSION_KEY); return; }
  if (Date.now() - s.la < 30000) return; // throttle writes
  s.la = Date.now();
  sessionStorage.setItem(OWNER_SESSION_KEY, JSON.stringify(s));
}

function unlockOwner() { sessionStorage.setItem(OWNER_SESSION_KEY, JSON.stringify({ la: Date.now() })); }

function lockOwner(silent) {
  sessionStorage.removeItem(OWNER_SESSION_KEY);
  closePinModal();
  if (!silent) toast('Locked — Operator Mode');
  render();
}

function requireOwner() {
  if (isOwner()) return true;
  openPinDialog();
  return false;
}

// Brute-force damper: 5 wrong tries → 60 s cooldown (per browser session)
function pinAttemptsBlocked() {
  try {
    const a = JSON.parse(sessionStorage.getItem(PIN_ATTEMPT_KEY) || 'null');
    if (!a) return 0;
    if (a.n >= 5 && Date.now() - a.t < 60000) return Math.ceil((60000 - (Date.now() - a.t)) / 1000);
    if (Date.now() - a.t >= 60000) sessionStorage.removeItem(PIN_ATTEMPT_KEY);
    return 0;
  } catch (e) { return 0; }
}

function recordPinAttempt() {
  let a = null;
  try { a = JSON.parse(sessionStorage.getItem(PIN_ATTEMPT_KEY) || 'null'); } catch (e) {}
  if (!a || Date.now() - a.t >= 60000) a = { n: 0, t: Date.now() };
  a.n++;
  sessionStorage.setItem(PIN_ATTEMPT_KEY, JSON.stringify(a));
}

function closePinModal() { const m = document.getElementById('pin-modal'); if (m) m.remove(); }

let pinAfterUnlock = null;

function openPinDialog(afterUnlock) {
  closePinModal();
  pinAfterUnlock = typeof afterUnlock === 'function' ? afterUnlock : null;
  const modal = document.createElement('div');
  modal.id = 'pin-modal';
  modal.className = 'pin-overlay';
  modal.innerHTML = `
    <div class="pin-card">
      <div class="pin-title">Owner Unlock</div>
      <div class="pin-sub">Enter the owner PIN to continue.</div>
      <form onsubmit="submitPinUnlock(event)">
        <input id="pin-input" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" aria-label="Owner PIN">
        <div id="pin-err" class="pin-err"></div>
        <div class="pin-acts">
          <button type="submit" class="btn btn-pri" style="flex:1">Unlock</button>
          <button type="button" class="btn btn-ghost" style="flex:1" onclick="closePinModal()">Cancel</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  setTimeout(() => { const i = document.getElementById('pin-input'); if (i) i.focus(); }, 60);
}

function submitPinUnlock(e) {
  e.preventDefault();
  const err = document.getElementById('pin-err');
  const wait = pinAttemptsBlocked();
  if (wait) { if (err) err.textContent = `Too many attempts — wait ${wait}s`; return; }
  const pin = (document.getElementById('pin-input') || {}).value || '';
  if (hasOwnerPin() && pinHash(pin) === db.settings.ownerPinHash) {
    sessionStorage.removeItem(PIN_ATTEMPT_KEY);
    unlockOwner();
    closePinModal();
    toast('Owner Mode unlocked', 'ok');
    const cb = pinAfterUnlock; pinAfterUnlock = null;
    if (cb) { render(); cb(); }
    else navigate('dash'); // Owner Home — default landing on unlock
  } else {
    recordPinAttempt();
    if (err) err.textContent = 'Incorrect PIN';
    const inp = document.getElementById('pin-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

function openPinSetup(fromPrompt, reason) {
  closePinModal();
  const changing = hasOwnerPin();
  const modal = document.createElement('div');
  modal.id = 'pin-modal';
  modal.className = 'pin-overlay';
  modal.innerHTML = `
    <div class="pin-card">
      <div class="pin-title">${changing ? 'Change Owner PIN' : 'Create Owner PIN'}</div>
      <div class="pin-sub">${reason === 'operator'
        ? `Before ${esc(ui.pendingOperator || 'your operator')} joins, set an owner PIN. Operators log production but never see costs or prices. Your PIN unlocks them on this phone.`
        : fromPrompt
        ? 'This update adds Operator Mode: the app now opens restricted — no costs, no editing history. Your PIN unlocks full Owner access.'
        : changing ? 'Set a new 4–8 digit PIN.' : 'Once set, the app opens in restricted Operator Mode. This PIN unlocks costs, reports and editing.'}</div>
      <form onsubmit="submitPinSetup(event)">
        <label class="pin-lbl" for="pin-new">New PIN (4–8 digits)</label>
        <input id="pin-new" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" required>
        <label class="pin-lbl" for="pin-new2">Confirm PIN</label>
        <input id="pin-new2" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" required>
        <div id="pin-err" class="pin-err"></div>
        <div class="pin-acts">
          <button type="submit" class="btn btn-pri" style="flex:1">${changing ? 'Change PIN' : 'Set PIN'}</button>
          <button type="button" class="btn btn-ghost" style="flex:1" onclick="${fromPrompt ? 'dismissPinSetup()' : 'ui.pendingOperator=null;closePinModal()'}">${fromPrompt ? 'Not Now' : 'Cancel'}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => { const i = document.getElementById('pin-new'); if (i) i.focus(); }, 60);
}

function submitPinSetup(e) {
  e.preventDefault();
  const p1 = (document.getElementById('pin-new') || {}).value || '';
  const p2 = (document.getElementById('pin-new2') || {}).value || '';
  const err = document.getElementById('pin-err');
  if (!/^\d{4,8}$/.test(p1)) { if (err) err.textContent = 'PIN must be 4–8 digits'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'PINs do not match'; return; }
  db.settings.ownerPinHash = pinHash(p1);
  db.settings.pinPromptShown = true;
  saveDB();
  unlockOwner(); // whoever sets the PIN is the owner — stay unlocked this session
  closePinModal();
  toast('Owner PIN set', 'ok');
  const pending = ui.pendingOperator;
  ui.pendingOperator = null;
  if (pending) {
    const op = addOperatorToTeam(pending);
    if (op) toast(`${op.name} added — send them the link`, 'ok');
  }
  render();
}

function dismissPinSetup() {
  db.settings.pinPromptShown = true;
  saveDB();
  closePinModal();
  toast('You can set the PIN later in Settings');
  render(); // re-evaluate render()'s onboarding chain now that PIN prompt is resolved
}

function syncModeChip() {
  const el = document.getElementById('mode-chip');
  if (!el) return;
  if (isOperatorDevice() || !hasOwnerPin() || ui.view === 'setup') { el.style.display = 'none'; return; }
  el.style.display = '';
  const owner = isOwner();
  el.className = 'mode-chip ' + (owner ? 'owner' : 'operator');
  el.textContent = owner ? 'Owner mode · Lock' : 'Operator mode · Unlock';
  el.title = owner ? 'Tap to lock into Operator Mode' : 'Tap to unlock Owner Mode';
}

function modeChipClick() {
  if (!hasOwnerPin()) return;
  if (isOwner()) lockOwner();
  else openPinDialog();
}

function vOperatorLocked(licenseIssue) {
  setTabs(`<button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button>`);
  setBarCrumb('', false);
  return `
    <div style="max-width:380px;margin:4rem auto;text-align:center;padding:0 1rem">
      <div style="font-weight:800;color:var(--navy);margin-bottom:.4rem">${licenseIssue ? 'License needs attention' : 'Owner access required'}</div>
      <div style="font-size:.78rem;color:var(--mut);margin-bottom:1.2rem;line-height:1.5">${licenseIssue
        ? 'The subscription for this app needs to be renewed. Please ask the owner to unlock and handle it.'
        : 'This section is only available in Owner Mode.'}</div>
      <button class="btn btn-pri" onclick="openPinDialog()">Unlock Owner Mode</button>
    </div>`;
}

// ── owner dashboard ───────────────────────────────────────────────
// Single-pass aggregation: each job's log is walked once, calcStation runs
// exactly once per station, and every section reads from this one snapshot.
function computeDashData() {
  const now = new Date();
  const dayKey = d => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  const days = [];
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const b = { key: dayKey(d), label: d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2), qty: 0, rej: 0 };
    days.push(b); dayMap[b.key] = b;
  }
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
  const staleMs = Date.now() - 48 * 3600 * 1000;
  const d7 = Date.now() - 7 * 86400000, d14 = Date.now() - 14 * 86400000;

  const out = {
    activeJobs: 0, pausedJobs: 0, completedJobs: 0,
    totalProduced: 0, totalGood: 0, totalRejected: 0,
    prodToday: 0, prodWeek: 0, days,
    jobRows: [], anomalyStations: [], nearingStations: [], lowLifeStations: [],
    costliest: null, invAlerts: [], attention: [],
    lifeRecent: null, lifePrior: null,
    operatorBoard: [], topToday: null,
    spend7: 0, spend30: 0, good30: 0, rejWeek: 0, prodWeekAll: 0, prodYesterday: 0, topRejReason: null,
    unloaded: [],
  };
  const d30 = Date.now() - 30 * 86400000;
  const rejReasons = {};

  let lifeRs = 0, lifeRn = 0, lifePs = 0, lifePn = 0;
  const noLogToday = [];
  const opAgg = {}, opAggPrior = {}; // this-week / prior-week per-operator totals
  const opBucket = (map, name) => { if (!map[name]) map[name] = { name, good: 0, rejected: 0, produced: 0, entries: 0, todayGood: 0, todayRejected: 0 }; return map[name]; };

  (db.jobs || []).forEach(job => {
    const status = job.status || 'active';
    if (status === 'active') out.activeJobs++;
    else if (status === 'paused') out.pausedJobs++;
    else if (status === 'complete') out.completedJobs++;

    const ops = job.operations || [];
    const opGood = {}, opProd = {};
    let jobProduced = 0, jobRejected = 0, lastTs = null, lastOpId = null, todayQty = 0;

    (job.productionLog || []).forEach(e => {
      const q = Number(e.qty) || 0;
      const g = Number(e.qtyGood != null ? e.qtyGood : e.qty) || 0;
      jobProduced += q; jobRejected += (q - g);
      if (e.operationId) {
        opProd[e.operationId] = (opProd[e.operationId] || 0) + q;
        opGood[e.operationId] = (opGood[e.operationId] || 0) + g;
      }
      const ts = new Date(e.timestamp);
      if (!lastTs || ts > lastTs) { lastTs = ts; lastOpId = e.operationId; }
      const fin = isFinalOpEntry(job, e);
      const b = dayMap[dayKey(ts)];
      if (b && fin) { b.qty += q; b.rej += (q - g); }
      if (ts >= todayStart && fin) { out.prodToday += q; todayQty += q; }
      if (ts >= weekStart) {
        if (fin) out.prodWeek += q;
        out.prodWeekAll += q; out.rejWeek += (q - g);
        (e.rejections || []).forEach(r => { if (r && r.reason) rejReasons[r.reason] = (rejReasons[r.reason] || 0) + (Number(r.qty) || 0); });
      }
      if (ts.getTime() >= d30 && fin) out.good30 += g;

      // Per-operator performance: this week vs the prior week, for the leaderboard
      const opName = (e.operator || '').trim();
      if (opName) {
        if (ts >= weekStart) {
          const a = opBucket(opAgg, opName);
          a.good += g; a.rejected += (q - g); a.produced += q; a.entries++;
          if (ts >= todayStart) { a.todayGood += g; a.todayRejected += (q - g); }
        } else if (ts.getTime() >= d14) {
          const a = opBucket(opAggPrior, opName);
          a.good += g; a.produced += q;
        }
      }
    });

    out.totalProduced += jobProduced;
    out.totalRejected += jobRejected;
    const finalOp = ops.length ? ops[ops.length - 1] : null;
    const goodFinal = finalOp && Object.keys(opGood).length
      ? (opGood[finalOp.id] || 0)
      : Math.max(0, jobProduced - jobRejected);
    out.totalGood += goodFinal;

    // Stations: calcStation once each, collected for job-relative comparisons
    const scs = [];
    ops.forEach(op => (op.stations || []).forEach(st => scs.push({ st, sc: calcStation(st) })));
    const lives = scs.map(x => x.sc.avgCornerLife).filter(v => v != null && v > 0);
    const jobAvgLife = lives.length ? lives.reduce((a, b) => a + b, 0) / lives.length : null;

    scs.forEach(({ st, sc }) => {
      const ref = { jobId: job.id, stationId: st.id, code: job.componentCode, name: st.name };
      if (sc.anomalies.length) out.anomalyStations.push({ ...ref, n: sc.anomalies.length });
      else if (sc.lifeStatus === 'overdue' || sc.lifeStatus === 'warn') {
        out.nearingStations.push({ ...ref, status: sc.lifeStatus, remaining: sc.pcsRemainingOnCorner });
      } else if (jobAvgLife && sc.avgCornerLife != null && sc.spentSets.length >= 1 && sc.avgCornerLife < jobAvgLife * 0.55) {
        out.lowLifeStations.push({ ...ref, avg: sc.avgCornerLife, jobAvg: Math.round(jobAvgLife) });
      }
      sc.sets.forEach(set => {
        const t = Date.parse(set.loadedAt);
        if (t >= d7) out.spend7 += sc.setCost;
        if (t >= d30) out.spend30 += sc.setCost;
      });
      const spend = sc.sets.length * sc.setCost;
      if (spend > 0 && (!out.costliest || spend > out.costliest.spend)) out.costliest = { ...ref, spend };
      sc.sets.forEach(set => (set.corners || []).forEach(c => {
        if (c.endedAt && (c.componentsMade || 0) > 0) {
          const t = new Date(c.endedAt).getTime();
          if (t >= d7) { lifeRs += c.componentsMade; lifeRn++; }
          else if (t >= d14) { lifePs += c.componentsMade; lifePn++; }
        }
      }));
    });

    if (status === 'active') ops.forEach(op => {
      const running = (job.productionLog || []).some(e => (e.operationId === op.id || (!e.operationId && ops.length === 1)) && new Date(e.timestamp).getTime() >= d7);
      if (!running) return;
      (op.stations || []).forEach(st => {
        if (!(st.insertSets || []).some(s => s.status === 'active')) out.unloaded.push({ jobId: job.id, stationId: st.id, code: job.componentCode, name: st.name });
      });
    });

    if (status === 'active' || status === 'paused') {
      const batch = Number(job.batchQty) || 0;
      const remaining = batch > 0 ? Math.max(0, batch - goodFinal) : null;
      const behind = status === 'active' && jobProduced > 0 && lastTs && lastTs.getTime() < staleMs && (remaining == null || remaining > 0);
      const curOp = (lastOpId && ops.find(o => o.id === lastOpId)) || ops[0] || null;
      out.jobRows.push({
        pace: jobPace(job, remaining),
        jobId: job.id, code: job.componentCode, customer: job.customer || '',
        opName: curOp ? curOp.name : '—', good: goodFinal, batch, remaining,
        status, behind,
        priority: status === 'paused' ? 0 : behind ? 1 : 2,
      });
      if (status === 'active' && jobProduced > 0 && todayQty === 0) noLogToday.push({ jobId: job.id, code: job.componentCode });
    }
  });

  out.prodYesterday = days[5].qty;
  const topR = Object.entries(rejReasons).sort((a, b) => b[1] - a[1])[0];
  if (topR) out.topRejReason = { reason: topR[0], qty: topR[1] };
  out.jobRows.sort((a, b) => a.priority - b.priority || (b.good / (b.batch || Infinity)) - (a.good / (a.batch || Infinity)));
  if (lifeRn) out.lifeRecent = Math.round(lifeRs / lifeRn);
  if (lifePn) out.lifePrior = Math.round(lifePs / lifePn);

  // Operator leaderboard — ranked by good pieces this week (rolling), with a
  // week-over-week delta so the owner sees who's improving, not just totals.
  out.operatorBoard = Object.values(opAgg)
    .map(a => ({
      name: a.name, good: a.good, rejected: a.rejected, produced: a.produced, entries: a.entries,
      effPct: a.produced > 0 ? Math.round((a.good / a.produced) * 100) : null,
      todayGood: a.todayGood, todayRejected: a.todayRejected,
      priorGood: opAggPrior[a.name] ? opAggPrior[a.name].good : null,
    }))
    .sort((a, b) => b.good - a.good)
    .slice(0, 8);
  out.topToday = out.operatorBoard.reduce((best, o) => (o.todayGood > 0 && (!best || o.todayGood > best.todayGood)) ? o : best, null);

  // Inventory alerts — linked-station needs first, then generic
  const linkedNeed = {};
  (db.jobs || []).forEach(j => (j.operations || []).forEach(op => (op.stations || []).forEach(st => {
    if (st.inventoryItemId) linkedNeed[st.inventoryItemId] = Math.max(linkedNeed[st.inventoryItemId] || 0, stationLoadNeed(st));
  })));
  (db.inventory || []).forEach(item => {
    const qty = item.qtyInStock || 0;
    const need = linkedNeed[item.id] || 0;
    if (qty < 0) out.invAlerts.push({ kind: 'bad', label: 'Negative stock', item: item.designation, qty });
    else if (qty === 0 && need > 0) out.invAlerts.push({ kind: 'bad', label: 'Out of stock', item: item.designation, qty });
    else if (need > 0 && qty <= need) out.invAlerts.push({ kind: 'warn', label: 'Low stock', item: item.designation, qty });
    else if (qty === 0) out.invAlerts.push({ kind: 'warn', label: 'Out of stock', item: item.designation, qty });
    else if (Number(item.minQty) > 0 && qty <= Number(item.minQty)) out.invAlerts.push({ kind: 'warn', label: 'At reorder level', item: item.designation, qty });
    else if (item.createdAt && new Date(item.createdAt).getTime() >= d7) out.invAlerts.push({ kind: 'info', label: 'Recently added', item: item.designation, qty });
  });
  out.invAlerts.sort((a, b) => ({ bad: 0, warn: 1, info: 2 }[a.kind] - { bad: 0, warn: 1, info: 2 }[b.kind]));
  out.invAlerts = out.invAlerts.slice(0, 8);

  // Sync health
  let pendingSince = null, lastOk = null;
  try { pendingSince = localStorage.getItem(SYNC_PENDING_KEY); lastOk = localStorage.getItem('toolflux.machlog.lastSyncOk'); } catch (e) {}
  const online = navigator.onLine !== false;
  const pendingAgeMin = pendingSince ? Math.round((Date.now() - new Date(pendingSince).getTime()) / 60000) : 0;
  out.sync = {
    online, pendingSince, pendingAgeMin, lastOk,
    state: !SYNC_URL ? 'disabled'
      : pendingSince ? (online ? (pendingAgeMin > 60 ? 'failing' : 'pending') : 'offline')
      : (lastOk ? 'ok' : 'idle'),
  };

  // Attention Required — severity-ordered, capped
  const att = out.attention;
  if (out.sync.state === 'failing') att.push({ sev: 'bad', msg: `Cloud backup failing — changes pending for ${pendingAgeMin > 120 ? Math.round(pendingAgeMin / 60) + ' h' : pendingAgeMin + ' min'}`, go: null });
  if (getLicenseStatus() === 'trial' && getTrialDaysLeft() <= 3) att.push({ sev: 'bad', msg: `Trial ends in ${getTrialDaysLeft()} day${getTrialDaysLeft() === 1 ? '' : 's'} — subscribe to keep tracking`, go: `navigate('paywall')` });
  if (getLicenseStatus() === 'licensed' && getVerificationState() === 'stale') att.push({ sev: 'warn', msg: 'License not verified in 30+ days — connect to the internet once to re-verify', go: null });
  out.invAlerts.filter(a => a.kind === 'bad').slice(0, 2).forEach(a => att.push({ sev: 'bad', msg: `${a.label}: ${a.item}`, go: `navigate('inventory')` }));
  out.anomalyStations.slice(0, 3).forEach(s => att.push({ sev: 'bad', msg: `${s.code} · ${s.name} — abnormal insert failure${s.n > 1 ? 's (' + s.n + ')' : ''}`, go: `navigate('station',{jobId:'${s.jobId}',stationId:'${s.stationId}'})` }));
  out.jobRows.filter(r => r.status === 'paused').slice(0, 2).forEach(r => att.push({ sev: 'warn', msg: `${r.code} is paused`, go: `navigate('job',{jobId:'${r.jobId}'})` }));
  noLogToday.slice(0, 3).forEach(j => att.push({ sev: 'warn', msg: `${j.code} — no production logged today`, go: `navigate('job',{jobId:'${j.jobId}'})` }));
  out.unloaded.slice(0, 3).forEach(s => att.push({ sev: 'warn', msg: `${s.code} · ${s.name} — pieces are logged but nothing is recorded as loaded, so its life and cost are not counted`, go: `navigate('station',{jobId:'${s.jobId}',stationId:'${s.stationId}'})` }));
  out.invAlerts.filter(a => a.kind === 'warn').slice(0, 2).forEach(a => att.push({ sev: 'warn', msg: `${a.label}: ${a.item} (${a.qty} left)`, go: `navigate('inventory')` }));
  if (!hasOwnerPin() && (db.settings.operators || []).length) att.push({ sev: 'info', msg: 'Owner PIN not set — operators have full access', go: `openPinSetup()` });
  if (!(db.jobs || []).length) att.push({ sev: 'info', msg: 'No jobs yet — create your first component job', go: `navigate('newjob')` });
  out.attention = att.slice(0, 8);

  return out;
}

function fmtAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  if (mins < 1440) return Math.round(mins / 60) + ' h ago';
  return fmtDate(iso);
}

// ── the insert, corner by corner ──────────────────────────────────
// A ring with one segment per cutting corner: used corners in ink, the corner
// in the cut filled as far as its usual life, corners still to come in tint.
function cornerDial(st, size, sw) {
  size = size || 34; sw = sw || 4;
  const sc = calcStation(st);
  const n = Math.max(1, sc.totalCorners);
  const c = size / 2, r = c - sw / 2 - 1, circ = 2 * Math.PI * r;
  const gap = n > 1 ? Math.max(3, sw * .7) : 0, slot = circ / n, seg = slot - gap;
  const corners = sc.activeSet ? (sc.activeSet.corners || []) : [];
  let marks = '';
  for (let i = 0; i < n; i++) {
    const off = -(i * slot + gap / 2);
    marks += `<circle class="dial-t" cx="${c}" cy="${c}" r="${r}" stroke-dasharray="${seg.toFixed(2)} ${(circ - seg).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>`;
    const cn = corners.find(x => x.num === i + 1);
    if (!cn) continue;
    let cls = 'done', frac = 1;
    if (cn.status === 'broken') cls = 'brk';
    else if (cn.status === 'active') {
      cls = sc.lifeStatus === 'overdue' ? 'due' : 'cur';
      frac = sc.cornerLifePct != null ? Math.max(.14, Math.min(1, sc.cornerLifePct / 100)) : (cn.componentsMade ? .5 : .14);
    }
    const len = seg * frac;
    marks += `<circle class="dial-${cls}" cx="${c}" cy="${c}" r="${r}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>`;
  }
  return `<svg class="dial" style="--sw:${sw}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${marks}</svg>`;
}

// What a tool is doing right now, in one line.
function toolState(st) {
  const sc = calcStation(st);
  const solid = isSolidTool(st.opType);
  if (!(st.insertSets || []).length) return { cls: '', text: solid ? 'No tool loaded' : 'No inserts loaded' };
  if (!sc.activeSet) return { cls: 'warn', text: solid ? 'Worn — load a new tool' : 'Set used up — load new inserts' };
  const where = solid ? `Tool ${sc.currentSetNum}` : `Corner ${sc.currentCornerNum} of ${sc.totalCorners}`;
  if (sc.lifeStatus === 'overdue') return { cls: 'bad', text: `${where} · ${solid ? 'replace now' : 'index now'}` };
  if (sc.lifeStatus === 'warn' && sc.pcsRemainingOnCorner != null) return { cls: 'warn', text: `${where} · about ${sc.pcsRemainingOnCorner} pcs left` };
  return { cls: '', text: `${where} · ${fmtN(sc.currentCornerPcs)} pcs` };
}

function toolChip(st, size) {
  const s = toolState(st);
  return `<div class="tool">${cornerDial(st, size)}<div><div class="tool-t">${esc(st.name)}</div><div class="tool-s ${s.cls}">${esc(s.text)}</div></div></div>`;
}

// Order progress as a track with both ends named.
function orderTrack(good, batch, pace) {
  if (!(batch > 0)) return '';
  const pct = Math.min(100, Math.round(good / batch * 100));
  const left = Math.max(0, batch - good);
  return `<div class="track" role="img" aria-label="${pct}% of the order made"><i style="width:${pct}%"></i></div>
    <div class="track-l"><span>${fmtN(good)} of ${fmtN(batch)} good</span><span>${left > 0 ? `${fmtN(left)} left${pace && pace.daysLeft ? ` · about ${pace.daysLeft} working day${pace.daysLeft === 1 ? '' : 's'}` : ''}` : 'Order complete'}</span></div>`;
}

// Seven days of output as columns: good pieces in the one hue (today at full
// strength), rejected pieces stacked on top in the negative colour.
function weekChart(days) {
  const phone = typeof window !== 'undefined' && window.innerWidth <= 860;
  const W = phone ? Math.max(300, Math.min(520, window.innerWidth - 58)) : 720, H = phone ? 200 : 236, L = 36, R = 4, T = 22, B = 28;
  const max = Math.max(1, ...days.map(d => d.qty));
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => max / s <= 4) || 10000;
  const top = Math.ceil((max * 1.05) / step) * step;
  const ph = H - T - B, pw = W - L - R, slot = pw / days.length, bw = Math.min(64, slot * .6);
  const y = v => T + ph - (v / top) * ph;
  let g = '';
  for (let v = 0; v <= top; v += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--rule2)' : 'var(--rule)'}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmtN(v)}</text>`;
  }
  days.forEach((d, i) => {
    const x = L + i * slot + (slot - bw) / 2, now = i === days.length - 1;
    const good = d.qty - d.rej;
    if (d.qty > 0) {
      const yg = y(good), yq = y(d.qty);
      if (good > 0) g += `<rect x="${x}" y="${yg}" width="${bw}" height="${T + ph - yg}" rx="3" fill="${now ? 'var(--teal)' : 'var(--t200)'}"><title>${good} good</title></rect>`;
      if (d.rej > 0) g += `<rect x="${x}" y="${yq}" width="${bw}" height="${Math.max(2, yg - yq - 2)}" rx="2" fill="var(--bad)"><title>${d.rej} rejected</title></rect>`;
      g += `<text class="${now ? 'now' : 'v'}" x="${x + bw / 2}" y="${yq - 7}" text-anchor="middle">${fmtN(d.qty)}</text>`;
    }
    g += `<text class="${now ? 'now' : ''}" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${now ? 'Today' : esc(d.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:${phone ? W : 900}px" role="img" aria-label="Pieces made per day, last 7 days">${g}</svg>`;
}

function vDashboard() {
  const d = computeDashData();
  setTabs('');
  const owner = isOwner();

  // the finding: one sentence on today, read before anything else
  const dayDelta = d.prodYesterday > 0 && d.prodToday > 0 ? Math.round((d.prodToday - d.prodYesterday) / d.prodYesterday * 100) : null;
  const buy = invToBuy();
  const bad = d.attention.filter(a => a.sev === 'bad').length;
  ui._sub = [
    d.prodToday > 0
      ? `${fmtN(d.prodToday)} pieces logged today${dayDelta != null ? `, ${Math.abs(dayDelta)}% ${dayDelta >= 0 ? 'up' : 'down'} on yesterday` : ''}.`
      : 'Nothing logged yet today.',
    bad ? `${bad} thing${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} you now.` : '',
    buy.length ? `${buy.length} item${buy.length === 1 ? '' : 's'} to buy.` : '',
  ].filter(Boolean).join(' ');

  const rejWeekPct = d.prodWeekAll > 0 ? (d.rejWeek / d.prodWeekAll * 100) : 0;
  const perGood30 = d.good30 > 0 && d.spend30 > 0 ? d.spend30 / d.good30 : null;
  const deltaHtml = dayDelta == null ? '' : ` <span class="delta ${dayDelta >= 0 ? 'up' : 'down'}">${dayDelta >= 0 ? '+' : '−'}${Math.abs(dayDelta)}%</span>`;

  const kpiHtml = `
    <div class="panel">
      <div class="kpis">
        <div class="s-stat lead"><div class="lbl">Made today</div><div><span class="s-val">${fmtN(d.prodToday)}</span><span class="s-unit"> pcs</span></div><div class="s-sub">Yesterday ${fmtN(d.prodYesterday)}${deltaHtml}</div></div>
        <div class="s-stat"><div class="lbl">Made this week</div><div><span class="s-val">${fmtN(d.prodWeek)}</span><span class="s-unit"> pcs</span></div><div class="s-sub">Last 7 days, ${fmtN(d.activeJobs)} active job${d.activeJobs === 1 ? '' : 's'}</div></div>
        <div class="s-stat"><div class="lbl">Rejected this week</div><div><span class="s-val ${d.rejWeek > 0 ? 'bad-c' : ''}">${fmtN(d.rejWeek)}</span><span class="s-unit"> pcs</span></div><div class="s-sub">${rejWeekPct.toFixed(1)}% of pieces machined${d.topRejReason ? `, mostly ${esc(d.topRejReason.reason.toLowerCase())}` : ''}</div></div>
        <div class="s-stat"><div class="lbl">Tooling spend, 7 days</div><div><span class="s-val">${fmtRs(d.spend7, 0)}</span></div><div class="s-sub">Inserts and tools loaded</div></div>
        <div class="s-stat"><div class="lbl">Tooling spend, 30 days</div><div><span class="s-val">${fmtRs(d.spend30, 0)}</span></div><div class="s-sub">Inserts and tools loaded</div></div>
        <div class="s-stat"><div class="lbl">Tooling per good piece</div><div><span class="s-val">${perGood30 != null ? fmtRs(perGood30, 2) : '—'}</span></div><div class="s-sub">30-day spend ÷ good pieces</div></div>
      </div>
    </div>`;

  const lifeNote = d.lifeRecent != null
    ? `An insert corner lasted ${fmtN(d.lifeRecent)} pieces on average this week${d.lifePrior != null ? `, against ${fmtN(d.lifePrior)} the week before` : ''}.`
    : '';
  const chartHtml = `
    <div class="panel">
      <div class="chart-hd">
        <h2>Pieces made, last 7 days</h2>
        <span class="sum">${fmtN(d.prodWeek)} in all</span>
        <div class="legend"><span><i style="background:var(--teal)"></i>Good</span>${d.rejWeek > 0 ? '<span><i style="background:var(--bad)"></i>Rejected</span>' : ''}</div>
      </div>
      <div class="chart">${weekChart(d.days)}</div>
      ${lifeNote ? `<div class="chart-note">${lifeNote}</div>` : ''}
    </div>`;

  const rows = d.jobRows.slice(0, 8);
  const jobsHtml = `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">On the machines</span><div class="hr"></div>${d.jobRows.length > rows.length ? `<button class="btn btn-ghost btn-sm" onclick="navigate('jobs')">View all ${d.jobRows.length}</button>` : `<span class="lbl muted">${d.jobRows.length} job${d.jobRows.length === 1 ? '' : 's'}</span>`}</div>
      ${!rows.length ? `<div class="rail-empty">No job is running. <a href="#" onclick="event.preventDefault();navigate('newjob')">Add a job</a> to start logging.</div>` : rows.map(r => {
        const job = db.jobs.find(j => j.id === r.jobId);
        const tools = jobAllStations(job).slice(0, 4);
        const pill = r.status === 'paused' ? '<span class="pill pause">Paused</span>'
          : r.behind ? '<span class="pill stale">No log in 2 days</span>' : '<span class="pill run">Running</span>';
        return `
        <div class="run-row" role="button" tabindex="0" onclick="navigate('job',{jobId:'${r.jobId}'})" onkeydown="if(event.key==='Enter')navigate('job',{jobId:'${r.jobId}'})">
          <div><div class="run-code">${esc(r.code)} ${pill}</div><div class="run-sub">${esc(r.customer || 'No customer set')}</div></div>
          <div class="run-prog">${r.batch > 0 ? orderTrack(r.good, r.batch, r.pace) : `<span class="run-sub">${fmtN(r.good)} good so far · no order quantity set</span>`}</div>
          <div class="run-today"><b>${fmtN(jobTodayQty(job))}</b><span>today</span></div>
          ${tools.length ? `<div class="run-tools">${tools.map(st => toolChip(st, 30)).join('')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

  const maxOpGood = Math.max(1, ...d.operatorBoard.map(o => o.good));
  const perfHtml = `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Operators this week</span><div class="hr"></div><span class="lbl muted">Good pieces</span></div>
      ${d.operatorBoard.length ? d.operatorBoard.map((o, i) => {
        const effCls = o.effPct == null ? '' : o.effPct >= 95 ? 'good' : o.effPct >= 85 ? 'warn' : 'bad';
        let delta = '';
        if (o.priorGood != null && o.priorGood > 0) {
          const pct = Math.round(((o.good - o.priorGood) / o.priorGood) * 100);
          delta = pct === 0 ? '' : `<span class="perf-delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '+' : '−'}${Math.abs(pct)}%</span>`;
        }
        return `
        <div class="perf-row">
          <span class="perf-rank r${i < 3 ? i + 1 : ''}">${i + 1}</span>
          <span class="perf-name">${esc(o.name)}</span>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${Math.round(o.good / maxOpGood * 100)}%"></div></div>
          <span class="perf-good">${fmtN(o.good)}</span>
          ${o.effPct != null ? `<span class="perf-eff ${effCls}">${o.effPct}% good</span>` : ''}
          ${delta}
        </div>`;
      }).join('') + `<div class="perf-note">${d.topToday ? `${esc(d.topToday.name)} leads today with ${fmtN(d.topToday.todayGood)} pieces. ` : ''}Percent good is good pieces out of all pieces logged in 7 days.</div>`
      : `<div class="rail-empty">Once operators log under their own name, their week shows here.</div>`}
    </div>`;

  const attHtml = `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Needs you</span><div class="hr"></div>${d.attention.length ? `<span class="lbl muted">${d.attention.length}</span>` : ''}</div>
      ${d.attention.length ? d.attention.map(a => `
        <div class="att-row att-${a.sev}" ${a.go ? `role="button" tabindex="0" onclick="${esc(a.go)}"` : ''}>
          <span class="att-dot"></span>
          <span class="att-msg">${esc(a.msg)}</span>
          ${a.go ? '<span class="att-arrow">&#8594;</span>' : ''}
        </div>`).join('') : '<div class="rail-empty">All clear. Nothing needs you right now.</div>'}
    </div>`;

  const buyHtml = `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">To buy</span><div class="hr"></div>${buy.length ? `<span class="lbl muted">${buy.length} item${buy.length === 1 ? '' : 's'}</span>` : ''}</div>
      ${buy.length ? buy.slice(0, 4).map(x => `
        <div class="buy-mini"><div><b>${esc(x.item.designation)}</b><span>${esc(x.p.why)} · ${x.p.qty} in stock</span></div><div class="q">${x.p.suggest} nos</div></div>`).join('') + `
        <div class="rail-foot"><button class="btn btn-ghost btn-sm" onclick="navigate('inventory')">Open buying list</button></div>`
      : `<div class="rail-empty">${(db.inventory || []).length ? 'Every item is above its reorder level.' : 'Add your inserts to Inventory and this list tells you what to reorder.'}</div>`}
    </div>`;

  const healthRows = [
    ...d.anomalyStations.slice(0, 3).map(s => ({ sev: 'bad', msg: `${s.code} · ${s.name}: ${s.n} insert${s.n === 1 ? '' : 's'} failed early`, s })),
    ...d.lowLifeStations.slice(0, 3).map(s => ({ sev: 'warn', msg: `${s.code} · ${s.name}: ${s.avg} pcs a corner, the job averages ${s.jobAvg}`, s })),
    ...(d.costliest && owner ? [{ sev: 'info', msg: `Costliest tool: ${d.costliest.code} · ${d.costliest.name}, ${fmtRs(d.costliest.spend, 0)} so far`, s: d.costliest }] : []),
  ];
  const healthHtml = healthRows.length ? `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Tool watch</span><div class="hr"></div></div>
      ${healthRows.map(h => `
        <div class="att-row att-${h.sev}" role="button" tabindex="0" onclick="navigate('station',{jobId:'${h.s.jobId}',stationId:'${h.s.stationId}'})">
          <span class="att-dot"></span><span class="att-msg">${esc(h.msg)}</span><span class="att-arrow">&#8594;</span>
        </div>`).join('')}
    </div>` : '';

  const syncWords = {
    ok: ['ok', 'Backed up', 'last sync ' + fmtAgo(d.sync.lastOk)],
    pending: ['warn', 'Backing up', 'changes queued ' + (d.sync.pendingAgeMin || 0) + ' min ago'],
    failing: ['bad', 'Backup failing', 'retrying by itself; last good ' + fmtAgo(d.sync.lastOk)],
    offline: ['warn', 'Offline', 'changes will back up when the internet returns'],
    idle: ['info', 'Not backed up yet', 'no backup has finished on this device'],
    disabled: ['info', 'Backup off', ''],
  }[d.sync.state] || ['info', 'Not backed up yet', ''];
  const syncHtml = `<div class="sync-line"><span class="sync-dot ${syncWords[0]}"></span><span><b>${syncWords[1]}</b>${syncWords[2] ? ' · ' + esc(syncWords[2]) : ''}</span></div>`;

  return `
    <div class="dash">
      <div class="dash-main">
        ${kpiHtml}
        ${chartHtml}
        ${jobsHtml}
        ${perfHtml}
      </div>
      <div class="dash-rail">
        ${attHtml}
        ${buyHtml}
        ${healthHtml}
        ${syncHtml}
      </div>
    </div>`;
}

// ── shift proof ───────────────────────────────────────────────────
// One screenshot = proof of the shift. Derived entirely from today's
// production log entries; no stored shift entity, no financial data.
function computeShiftData() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const out = {
    jobs: [], totGood: 0, totRej: 0, totEntries: 0,
    operators: [], machines: [], minTs: null, maxTs: null,
    indexesToday: 0, insertChangesToday: 0, stationsUsed: 0,
  };
  const operators = new Set(), machines = new Set();

  (db.jobs || []).forEach(job => {
    const ops = job.operations || [];
    const entries = (job.productionLog || []).filter(e => new Date(e.timestamp) >= todayStart);

    // Insert activity today (covers quick-index too, which has no log entry)
    ops.forEach(o => (o.stations || []).forEach(st => {
      (st.insertSets || []).forEach(set => {
        if (new Date(set.loadedAt) >= todayStart) out.insertChangesToday++;
        (set.corners || []).forEach(c => {
          if (c.endedAt && c.status === 'indexed' && new Date(c.endedAt) >= todayStart) out.indexesToday++;
        });
      });
    }));

    if (!entries.length) return;
    const jb = { jobId: job.id, code: job.componentCode, desc: job.componentDesc || '',
      good: 0, rej: 0, reasons: {}, opNames: new Set(), entries: entries.length, stations: [] };

    entries.forEach(e => {
      const q = Number(e.qty) || 0;
      const g = Number(e.qtyGood != null ? e.qtyGood : e.qty) || 0;
      jb.good += g; jb.rej += (q - g);
      (e.rejections || []).forEach(r => { if (r.reason) jb.reasons[r.reason] = (jb.reasons[r.reason] || 0) + (Number(r.qty) || 0); });
      const op = ops.find(o => o.id === e.operationId);
      if (op) jb.opNames.add(op.name);
      if (e.operator) operators.add(e.operator);
      if (e.machine) machines.add(e.machine);
      const ts = new Date(e.timestamp);
      if (!out.minTs || ts < out.minTs) out.minTs = ts;
      if (!out.maxTs || ts > out.maxTs) out.maxTs = ts;
    });

    // Current corner state of the stations behind today's operations
    ops.forEach(o => {
      if (!jb.opNames.has(o.name)) return;
      (o.stations || []).forEach(st => {
        const sc = calcStation(st);
        if (!sc.activeSet) return;
        jb.stations.push({
          name: st.name,
          state: isSolidTool(st.opType)
            ? `Tool #${sc.currentSetNum} \xb7 ${fmtN(sc.currentCornerPcs)} pcs`
            : `C${sc.currentCornerNum || '?'}/${sc.totalCorners} \xb7 ${fmtN(sc.currentCornerPcs)} pcs on edge`,
        });
      });
    });

    out.totGood += jb.good; out.totRej += jb.rej; out.totEntries += jb.entries;
    out.jobs.push(jb);
  });

  out.operators = [...operators];
  out.machines = [...machines];
  out.stationsUsed = out.jobs.reduce((s, j) => s + j.stations.length, 0);

  // Sync state — same signals the dashboard uses
  let pendingSince = null, lastOk = null;
  try { pendingSince = localStorage.getItem(SYNC_PENDING_KEY); lastOk = localStorage.getItem('toolflux.machlog.lastSyncOk'); } catch (e) {}
  const online = navigator.onLine !== false;
  out.sync = pendingSince
    ? (online ? 'pending' : 'offline')
    : (lastOk ? 'synced' : 'idle');
  out.lastOk = lastOk;
  return out;
}

function vShiftProof() {
  setTabs(`
    <button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button>
    <button class="tab" aria-selected="true">Shift Proof</button>`);
  setBarCrumb('Shift Proof', true);

  const d = computeShiftData();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const range = d.minTs
    ? `${d.minTs.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} – ${d.maxTs.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : '—';

  const syncChip = {
    synced:  '<span class="proof-sync ok">&#10003; SYNCED</span>',
    pending: '<span class="proof-sync warn">&#8635; WAITING FOR SYNC</span>',
    offline: '<span class="proof-sync warn">OFFLINE — QUEUED</span>',
    idle:    '<span class="proof-sync idle">NOT SYNCED YET</span>',
  }[d.sync];

  const jobBlocks = d.jobs.map(jb => {
    const reasons = Object.entries(jb.reasons).map(([r, n]) => `${esc(r)} \xd7${n}`).join(', ');
    return `
      <div class="proof-job">
        <div class="proof-job-hd">
          <span class="proof-job-code">${esc(jb.code)}</span>
          <span class="proof-job-op">${esc([...jb.opNames].join(', ') || '—')}</span>
        </div>
        <div class="proof-job-nums">
          <span class="proof-good">${fmtN(jb.good)} <small>good</small></span>
          ${jb.rej > 0 ? `<span class="proof-rej">${fmtN(jb.rej)} <small>rejected</small></span>` : ''}
          <span class="proof-entries">${jb.entries} entr${jb.entries === 1 ? 'y' : 'ies'}</span>
        </div>
        ${reasons ? `<div class="proof-reasons">Rejection: ${reasons}</div>` : ''}
        ${jb.stations.map(s => `<div class="proof-station">${esc(s.name)} — ${esc(s.state)}</div>`).join('')}
      </div>`;
  }).join('');

  return `
    <div class="proof-wrap">
      <div class="proof" id="shift-proof">
        <div class="proof-hd">
          <div>
            <div class="proof-co">TOOLFLUX${db.settings.company ? ' — ' + esc(db.settings.company) : ''}</div>
            <div class="proof-title">PROOF OF PRODUCTION</div>
          </div>
          <div class="proof-date">
            <div class="d">${esc(dateStr)}</div>
            ${syncChip}
          </div>
        </div>
        <div class="proof-meta">
          <span><b>Shift</b> ${esc(range)}</span>
          <span><b>Operator</b> ${esc(d.operators.join(', ') || db.settings.defaultOperator || '—')}</span>
          <span><b>Machine</b> ${esc(d.machines.join(', ') || '—')}</span>
        </div>
        ${d.jobs.length ? jobBlocks : '<div class="proof-empty">No production logged today.</div>'}
        <div class="proof-totals">
          <div class="pt"><div class="pt-n">${fmtN(d.totGood)}</div><div class="pt-l">GOOD PCS</div></div>
          <div class="pt"><div class="pt-n ${d.totRej > 0 ? 'rej' : ''}">${fmtN(d.totRej)}</div><div class="pt-l">REJECTED</div></div>
          <div class="pt"><div class="pt-n">${d.totEntries}</div><div class="pt-l">ENTRIES</div></div>
          <div class="pt"><div class="pt-n">${d.indexesToday}</div><div class="pt-l">INDEXES</div></div>
          <div class="pt"><div class="pt-n">${d.insertChangesToday}</div><div class="pt-l">INSERTS</div></div>
        </div>
        <div class="proof-ft">
          Generated ${esc(timeStr)} &middot; ${d.stationsUsed} tool${d.stationsUsed === 1 ? '' : 's'}
          <span class="proof-install">${esc((db.settings.installId || '').slice(0, 10))}</span>
        </div>
      </div>
      <div class="proof-acts">
        <button class="btn btn-wa" onclick="whatsappShiftSummary()">Send on WhatsApp</button>
        <button class="btn btn-ghost" onclick="copyShiftSummary()">Copy</button>
        <button class="btn btn-ghost" onclick="printShiftProof()">Print / PDF</button>
      </div>
      <div class="proof-hint">Or take a screenshot of the card above and send the picture.</div>
    </div>`;
}

function buildShiftSummaryText() {
  const d = computeShiftData();
  const now = new Date();
  const range = d.minTs
    ? `${d.minTs.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}-${d.maxTs.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  const lines = [
    `*PRODUCTION PROOF — ${db.settings.company || 'TOOLFLUX'}*`,
    `${now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}${range ? ' · ' + range : ''}`,
    `Operator: ${d.operators.join(', ') || '—'} · Machine: ${d.machines.join(', ') || '—'}`,
    '',
    ...d.jobs.map(jb => {
      const reasons = Object.entries(jb.reasons).map(([r, n]) => `${r}×${n}`).join(', ');
      return `${jb.code} (${[...jb.opNames].join(',')}): ${jb.good} good${jb.rej ? `, ${jb.rej} rej (${reasons})` : ''}`;
    }),
    '',
    `TOTAL: ${d.totGood} good · ${d.totRej} rejected · ${d.totEntries} entries`,
    `Inserts: ${d.insertChangesToday} changed, ${d.indexesToday} corners indexed`,
    d.sync === 'synced' ? 'Synced to cloud ✓' : d.sync === 'pending' ? 'Sync pending…' : d.sync === 'offline' ? 'Offline — sync queued' : 'Not synced yet',
  ];
  return lines.join('\n');
}

// Opens WhatsApp directly with the summary pre-typed — the one share
// path every customer already knows how to finish.
function whatsappShiftSummary() {
  const text = buildShiftSummaryText();
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function copyShiftSummary() {
  const text = buildShiftSummaryText();
  const done = () => toast('Summary copied — paste in WhatsApp', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'bad'); }
  ta.remove();
}

function printShiftProof() {
  const el = $('#shift-proof');
  if (!el) return;
  $('#print-area').innerHTML = `<div class="report" style="max-width:420px;margin:0 auto">${el.outerHTML}</div>`;
  window.print();
}

// ── onboarding tutorial ────────────────────────────────────────────
// Tap-anywhere-to-advance overlay. Owner-only steps are filtered out for
// operators viewing an un-unlocked device; Settings replay always shows
// the full track since only owners reach Settings.
const TUT_STEPS = [
  { title: 'Welcome to Machlog', body: 'It replaces the sheet taped to your machine: pieces made, rejections and every insert change, kept per job. One minute to see how it works.' },
  { title: 'Plan the job once', owner: true, body: 'A new job opens on its Process plan. Add the operations in order and the tool each one uses: insert, corners and price. Operators never edit the plan.' },
  { title: 'Log at the machine', body: 'Tap "+ Log production", type the pieces made and tap Save entry. Your name and machine are remembered for next time.' },
  { title: 'Tap any tool change', body: 'In the same form, tap Indexed or Replaced for the tool you changed, or "Loaded new inserts" the first time a tool goes in. That is how Machlog learns how long each corner lasts.' },
  { title: 'Record rejections honestly', body: 'Type how many pieces were rejected and tap the reason. It protects you and shows the owner where the scrap comes from.' },
  { title: 'Prove your shift on WhatsApp', body: 'At the end of the shift open Shift proof and tap "Send on WhatsApp". The owner sees what was made, and whether it reached the cloud.' },
  { title: 'Costs stay with the owner', owner: true, body: 'Once you add an operator, you set an owner PIN. Costs, reports, the plan and edits to past entries stay behind it.' },
  { title: 'Production in rupees', owner: true, body: 'The Overview shows today against yesterday, rejections with their main reason, tooling spend and tooling cost per good piece. "Needs you" lists what to act on first.' },
  { title: 'Buy before it runs out', owner: true, body: 'Add your inserts in Inventory with a reorder level. Stock comes down each time inserts are loaded, and the buying list goes to your supplier on WhatsApp.' },
  { title: 'Your data is backed up', body: 'Every entry is saved on this device first and copied to the cloud when there is internet. Offline? It waits and sends by itself.' },
  { title: "You're ready", body: 'Replay this tour any time from Settings. Now go make some good parts.' },
];

let tutStepList = [];
let tutIndex = 0;

function startTutorial(auto) {
  if (document.getElementById('tut-overlay')) return;
  tutStepList = auto ? TUT_STEPS.filter(s => !s.owner || isOwner()) : TUT_STEPS;
  tutIndex = 0;
  renderTutorialStep();
}

function renderTutorialStep() {
  const existing = document.getElementById('tut-overlay');
  if (existing) existing.remove();
  const step = tutStepList[tutIndex];
  if (!step) { finishTutorial(); return; }
  const isLast = tutIndex === tutStepList.length - 1;
  const isFirst = tutIndex === 0;

  const overlay = document.createElement('div');
  overlay.id = 'tut-overlay';
  overlay.className = 'tut-overlay';
  overlay.innerHTML = `
    <div class="tut-card">
      <div class="tut-top">
        <span class="tut-step-n">${tutIndex + 1} / ${tutStepList.length}</span>
        <button class="tut-skip" onclick="event.stopPropagation();skipTutorial()">Skip</button>
      </div>
      <div class="tut-tap" onclick="tutNext()">
        <div class="tut-title">${esc(step.title)}</div>
        <div class="tut-body">${esc(step.body)}</div>
      </div>
      <div class="tut-dots">
        ${tutStepList.map((_, i) => `<span class="tut-dot${i === tutIndex ? ' on' : ''}"></span>`).join('')}
      </div>
      <div class="tut-nav">
        <button class="tut-arrow" style="visibility:${isFirst ? 'hidden' : 'visible'}" onclick="event.stopPropagation();tutPrev()" aria-label="Back">&#8592;</button>
        <span class="tut-hint">Tap card to continue</span>
        <button class="tut-arrow tut-arrow-next" onclick="event.stopPropagation();tutNext()" aria-label="Next">${isLast ? '&#10003;' : '&#8594;'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function tutNext() {
  if (tutIndex >= tutStepList.length - 1) { finishTutorial(); return; }
  tutIndex++;
  renderTutorialStep();
}
function tutPrev() {
  if (tutIndex <= 0) return;
  tutIndex--;
  renderTutorialStep();
}
function skipTutorial() { finishTutorial(); }

function finishTutorial() {
  const el = document.getElementById('tut-overlay');
  if (el) el.remove();
  db.settings.tutorialSeen = true;
  saveDB();
}

function replayTutorial() {
  db.settings.tutorialSeen = false; // so an interrupted replay still resumes on next open
  startTutorial(false);
}

// ── calculations ─────────────────────────────────────────────────

function calcStation(st) {
  const sets = st.insertSets || [];
  const insertsInCutter = Math.max(1, Number(st.insertsInCutter) || 1);
  const cornersPerInsert = Math.max(1, Number(st.cuttingCornersPerInsert) || 1);
  const costPer = Number(st.insertCostPer) || 0;
  const setCost = insertsInCutter * costPer;
  const totalCorners = cornersPerInsert;

  const activeSet = sets.find(s => s.status === 'active') || null;
  const spentSets = sets.filter(s => s.status !== 'active');

  const totalComponents = sets.reduce((s, set) =>
    s + (set.corners || []).reduce((cs, c) => cs + (c.componentsMade || 0), 0), 0);

  let currentSetNum = null, currentCornerNum = null, currentCornerPcs = null;
  if (activeSet) {
    currentSetNum = sets.indexOf(activeSet) + 1;
    const ac = (activeSet.corners || []).find(c => c.status === 'active');
    if (ac) { currentCornerNum = ac.num; currentCornerPcs = ac.componentsMade || 0; }
  }

  const allIndexed = sets.flatMap(s => (s.corners || []).filter(c => c.status === 'indexed' && (c.componentsMade || 0) > 0));
  const avgCornerLife = allIndexed.length > 0
    ? allIndexed.reduce((s, c) => s + c.componentsMade, 0) / allIndexed.length
    : null;

  const finishedSets = spentSets.filter(s => s.status === 'spent');
  const finishedPcs = finishedSets.reduce((s, set) =>
    s + (set.corners || []).reduce((cs, c) => cs + (c.componentsMade || 0), 0), 0);
  const finishedCost = finishedSets.length * setCost;
  const confirmedCpc = finishedPcs > 0 && finishedCost > 0 ? finishedCost / finishedPcs : null;

  // Proportional cost: spent/broken sets at full cost + active set only for corners already started
  // This avoids inflating CPC with unspent corners on the current set
  const nonActiveSetCost = spentSets.length * setCost;
  let activeCostAttributed = 0;
  if (activeSet && cornersPerInsert > 0) {
    const cornersStarted = (activeSet.corners || []).length;
    activeCostAttributed = Math.min(1, cornersStarted / cornersPerInsert) * setCost;
  }
  const proportionalCost = nonActiveSetCost + activeCostAttributed;
  const provisionalCpc = totalComponents > 0 && proportionalCost > 0
    ? proportionalCost / totalComponents : null;

  const totalCostCommitted = sets.length * setCost; // full committed spend for display

  // Insert life prediction for current active corner
  const cornerLifePct = avgCornerLife && currentCornerPcs != null
    ? Math.round((currentCornerPcs / avgCornerLife) * 100) : null;
  const pcsRemainingOnCorner = avgCornerLife && currentCornerPcs != null
    ? Math.max(0, Math.round(avgCornerLife - currentCornerPcs)) : null;
  const lifeStatus = cornerLifePct == null ? 'unknown'
    : cornerLifePct >= 100 ? 'overdue'
    : cornerLifePct >= 70  ? 'warn'
    : 'ok';

  const anomalies = [];
  if (avgCornerLife && avgCornerLife > 0) {
    sets.forEach((set, si) => {
      (set.corners || []).forEach(c => {
        if (c.status === 'broken' && (c.componentsMade || 0) / avgCornerLife < 0.55) {
          anomalies.push({ setNum: si + 1, cornerNum: c.num, pcs: c.componentsMade || 0, avgLife: Math.round(avgCornerLife) });
        }
      });
    });
  }

  return {
    sets, activeSet, spentSets,
    insertsInCutter, cornersPerInsert, totalCorners, costPer, setCost,
    totalComponents, currentSetNum, currentCornerNum, currentCornerPcs,
    avgCornerLife, confirmedCpc, provisionalCpc, proportionalCost,
    totalCostCommitted, finishedPcs, anomalies,
    cornerLifePct, pcsRemainingOnCorner, lifeStatus,
  };
}

function calcJob(job) {
  const log = job.productionLog || [];
  const ops = job.operations || [];
  const lastEntry = log.length > 0 ? log[log.length - 1] : null;

  // Per-operation stats
  const opStats = ops.map(op => {
    const opLog = log.filter(e => e.operationId === op.id);
    const produced = opLog.reduce((s, e) => s + (Number(e.qty) || 0), 0);
    const good = opLog.reduce((s, e) => s + (Number(e.qtyGood ?? e.qty) || 0), 0);
    const rejected = produced - good;
    const rejRate = produced > 0 ? (rejected / produced * 100) : 0;
    let insertCost = 0, proportional = 0, anomalies = 0, indexedCorners = [];
    (op.stations || []).forEach(st => {
      const sc = calcStation(st);
      insertCost += sc.totalCostCommitted;
      proportional += sc.proportionalCost;
      anomalies += sc.anomalies.length;
      sc.sets.forEach(s => (s.corners || []).filter(c => c.status === 'indexed' && c.componentsMade > 0).forEach(c => indexedCorners.push(c)));
    });
    const cpc = good > 0 && proportional > 0 ? proportional / good : null;
    return { op, produced, good, rejected, rejRate, insertCost, proportional, anomalies, indexedCorners, cpc };
  });

  const totalProduced = opStats.reduce((s, o) => s + o.produced, 0);
  const totalInsertCost = opStats.reduce((s, o) => s + o.insertCost, 0);
  const totalProportionalCost = opStats.reduce((s, o) => s + o.proportional, 0);
  const totalAnomalies = opStats.reduce((s, o) => s + o.anomalies, 0);
  const allIndexedCorners = opStats.flatMap(o => o.indexedCorners);

  // Total CPC = total cost / good pieces from LAST op (pieces that cleared everything)
  const lastOpGood = opStats.length ? opStats[opStats.length - 1].good : totalProduced;
  const totalCpc = lastOpGood > 0 && totalProportionalCost > 0 ? totalProportionalCost / lastOpGood : null;
  const totalGood = lastOpGood;

  const avgCornerLife = allIndexedCorners.length > 0
    ? Math.round(allIndexedCorners.reduce((s, c) => s + c.componentsMade, 0) / allIndexedCorners.length)
    : null;

  // pieces that came off the last operation; the total above counts each operation's run
  const finalProduced = opStats.length ? opStats[opStats.length - 1].produced : log.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  const totalRejected = opStats.length ? opStats.reduce((s, o) => s + o.rejected, 0)
    : log.reduce((s, e) => s + ((Number(e.qty) || 0) - (Number(e.qtyGood ?? e.qty) || 0)), 0);
  return { totalProduced, finalProduced, totalGood, totalRejected, totalInsertCost, totalCpc, totalAnomalies, lastEntry, avgCornerLife, opStats };
}

// ── router / ui state ─────────────────────────────────────────────
const ui = {
  view: 'jobs',
  jobId: null,
  stationId: null,
  activeOpId: null,
  logOpen: false,
  addStationOpen: false,
  editStationOpen: false,
  tab: 'active',
  inventoryOpen: false,
};

function navigate(view, params = {}) {
  if (OWNER_VIEWS.includes(view) && !isOwner()) {
    openPinDialog(() => navigate(view, params));
    return;
  }
  closeSheet();
  if (view !== 'settings') ui.teamFocus = false;
  ui.view = view;
  ui.jobId = params.jobId || null;
  ui.stationId = params.stationId || null;
  ui.logOpen = params.logOpen || false;
  ui.jobTab = params.plan ? 'plan' : 'run';
  ui.addStationOpen = false;
  ui.editStationOpen = false;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── op type utils ─────────────────────────────────────────────────
function opLabel(opType) { return (OP_MAP[opType] || OP_MAP.other).label; }
function opCls(opType) { return (OP_MAP[opType] || OP_MAP.other).cls; }
function opBadge(opType) {
  return `<span class="badge-op ${opCls(opType)}">${esc(opLabel(opType))}</span>`;
}
function opSelectOptions(selected) {
  return OP_TYPES.map(([v, lbl]) =>
    `<option value="${v}"${selected===v?' selected':''}>${lbl}</option>`
  ).join('');
}

// ── station tile ─────────────────────────────────────────────────
function stationTile(st, jobId) {
  const sc = calcStation(st);
  const hasInserts = (st.insertSets || []).length > 0;

  let tierClass = '';
  if (sc.anomalies.length || sc.lifeStatus === 'overdue') tierClass = 'bad-st';
  else if (sc.lifeStatus === 'warn') tierClass = 'warn-st';

  const cpcVal = sc.confirmedCpc != null ? sc.confirmedCpc : sc.provisionalCpc;
  const cpcHtml = isOwner() && cpcVal != null
    ? `<div class="st-cpc">${fmtRs(cpcVal, 2)}<span class="st-cpc-unit">/pc</span>${sc.confirmedCpc == null ? '<span class="st-cpc-prov"> so far</span>' : ''}</div>`
    : '';

  const cat = toolCategory(st.opType);
  const solid = cat === 'solid';
  let statusHtml = '';
  if (!hasInserts) {
    statusHtml = `<div class="no-insert-lbl">${solid ? 'No tool loaded — tap to set up' : 'No inserts loaded — tap to set up'}</div>`;
  } else if (!sc.activeSet) {
    statusHtml = `<div class="no-insert-lbl" style="color:var(--ok);font-weight:600">${solid ? 'Tool worn — load new' : 'Set spent — load new inserts'}</div>`;
  } else {
    const barColor = sc.lifeStatus === 'overdue' ? 'var(--bad)'
      : sc.lifeStatus === 'warn' ? 'var(--warn)' : 'var(--ok)';
    const barPct = Math.min(100, sc.cornerLifePct || 0);
    let lifeText = `${fmtN(sc.currentCornerPcs)} pcs`;
    if (sc.lifeStatus === 'overdue') lifeText = `${fmtN(sc.currentCornerPcs)} pcs — ${solid ? 'replace tool!' : 'index now!'}`;
    else if (sc.pcsRemainingOnCorner != null) lifeText = `~${sc.pcsRemainingOnCorner} left`;

    const cornerLabel = solid
      ? `Tool #${sc.currentSetNum}`
      : `C${sc.currentCornerNum}/${sc.totalCorners}`;

    statusHtml = `
      <div style="margin:.32rem 0 .1rem">
        <div style="background:var(--rule2);border-radius:2px;height:3px;overflow:hidden;margin-bottom:.22rem">
          <div style="height:100%;width:${barPct}%;background:${barColor}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="st-corner-lbl">${cornerLabel}</span>
          <span class="st-corner-sub" style="${sc.lifeStatus !== 'ok' ? 'color:'+barColor+';font-weight:600' : ''}">${esc(lifeText)}</span>
        </div>
      </div>`;
  }

  return `
    <div class="station-tile ${tierClass}" role="button" tabindex="0"
      onclick="navigate('station',{jobId:'${jobId}',stationId:'${st.id}'})"
      onkeydown="if(event.key==='Enter')navigate('station',{jobId:'${jobId}',stationId:'${st.id}'})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><span class="st-type badge-op ${opCls(st.opType)}">${esc(opLabel(st.opType))}</span>${hasInserts ? cornerDial(st, 36) : ''}</div>
      <div class="st-name">${esc(st.name)}</div>
      ${cat === 'milling' && st.cutterDiameter
        ? `<div class="st-sub">\xf8${st.cutterDiameter}mm \xb7 ${sc.insertsInCutter}\xd7${esc(st.insertDesig ? ' '+st.insertDesig : '')}</div>`
        : cat === 'turning' && (st.insertDesig || st.toolHolder)
          ? `<div class="st-sub">${esc(st.insertDesig||'')}${st.toolHolder ? ' \xb7 '+esc(st.toolHolder) : ''}</div>`
          : st.insertDesig ? `<div class="st-sub">${esc(st.insertDesig)}</div>` : ''}
      ${cpcHtml}
      ${statusHtml}
    </div>`;
}

// ── views ─────────────────────────────────────────────────────────

function vJobs() {
  const owner = isOwner();
  const filter = (ui.tab === 'cpc' && !owner) ? 'active' : ui.tab;

  const tabs = [
    ['active', 'Active'],
    ['paused', 'Paused'],
    ['complete', 'Complete'],
    ['all', 'All'],
  ];
  if (owner) tabs.push(['cpc', 'Cost per piece']);
  const tabHtml = tabs.map(([key, lbl]) => {
    const count = key === 'cpc' ? null : key === 'all' ? db.jobs.length : db.jobs.filter(j => (j.status||'active') === key).length;
    const sel = filter === key ? 'aria-selected="true"' : '';
    return `<button class="tab${key === 'cpc' ? ' tab-place' : ''}" ${sel} onclick="setJobFilter('${key}')">${lbl}${count ? `<span class="n">${count}</span>` : ''}</button>`;
  }).join('');
  setTabs((owner ? `<button class="tab tab-place" onclick="navigate('dash')">Dashboard</button>` : '') + tabHtml
    + `<button class="tab tab-place" onclick="navigate('shift')">Shift Proof</button>`
    + (owner
    ? `<button class="tab tab-place" onclick="navigate('inventory')">Inventory</button><button class="tab tab-place" onclick="navigate('settings')" style="margin-left:auto">Settings</button>`
    : ''));
  setBarCrumb('', false);

  const hd = `
    ${isOperatorDevice() ? syncStatusBar() : ''}
`;
  ui._acts = owner ? `<button class="btn btn-ghost" onclick="exportToExcel()" title="Export all data to Excel">Export to Excel</button>
    ${isReadOnly() ? '' : `<button class="btn btn-pri" onclick="navigate('newjob')">+ New job</button>`}` : '';

  // Operator device that hasn't received the shop's jobs yet
  if (isOperatorDevice() && !(db.jobs || []).length) {
    return hd + `
      <div class="panel"><div style="text-align:center;padding:3rem 1.2rem;color:var(--mut)">
        <div style="font-weight:800;color:var(--navy);margin-bottom:.4rem">Connected to your shop</div>
        <div style="font-size:.8rem;max-width:340px;margin:0 auto;line-height:1.55">You're set up as an operator${db.settings.defaultOperator ? ', ' + esc(db.settings.defaultOperator) : ''}. Your jobs will appear here once the owner's device syncs them to you.</div>
      </div></div>`;
  }

  if (filter === 'cpc') {
    return hd + vCPCContent();
  }

  const jobs = (db.jobs || []).filter(j => {
    if (filter === 'active') return (j.status||'active') === 'active';
    if (filter === 'complete') return j.status === 'complete';
    if (filter === 'paused') return j.status === 'paused';
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  let listHtml = '';
  if (!jobs.length) {
    listHtml = `
      <div style="text-align:center;padding:3.5rem 1rem;color:var(--mut)">
        <div style="font-weight:700;color:var(--navy);margin-bottom:.4rem">No ${filter === 'all' ? '' : filter + ' '}jobs</div>
        <div style="font-size:.78rem">${filter === 'all' ? 'Create your first component job to start tracking' : 'No jobs with this status'}</div>
      </div>`;
  } else {
    listHtml = jobs.map(j => {
      const jc = calcJob(j);
      const stations = jobAllStations(j);
      const healthDots = stations.map(st => {
        const sc = calcStation(st);
        let cls = '';
        if (sc.anomalies.length) cls = 'bad';
        else if (!(st.insertSets||[]).length) cls = 'empty';
        return `<span class="health-dot ${cls}" title="${esc(st.name)}"></span>`;
      }).join('');

      if ((j.status || 'active') === 'active' && filter === 'active') {
        return `
          <div class="job-card" role="button" tabindex="0"
            onclick="navigate('job',{jobId:'${j.id}'})"
            onkeydown="if(event.key==='Enter')navigate('job',{jobId:'${j.id}'})">
            <div class="jc-top">
              <div>
                <div class="jc-code">${esc(j.componentCode)}</div>
                <div class="jc-desc">${esc(j.componentDesc || '')}${j.customer ? ' — ' + esc(j.customer) : ''}</div>
              </div>
              <span class="job-status-badge active">Running</span>
            </div>
            <div class="jc-stats">
              <div>
                <div class="jc-stat-n">${fmtN(jobTodayQty(j))}</div>
                <div class="jc-stat-l">today</div>
              </div>
              <div>
                <div class="jc-stat-n">${fmtN(jc.finalProduced)}</div>
                <div class="jc-stat-l">made in all</div>
              </div>
              ${owner && jc.totalCpc != null ? `<div>
                <div class="jc-stat-n cpc">${fmtRs(jc.totalCpc, 2)}</div>
                <div class="jc-stat-l">tooling per piece</div>
              </div>` : ''}
            </div>
            ${Number(j.batchQty) > 0 ? `<div class="jc-prog">${orderTrack(jc.totalGood, Number(j.batchQty), jobPace(j, Math.max(0, j.batchQty - jc.totalGood)))}</div>` : ''}
            ${stations.length ? `<div class="jc-tools">${stations.slice(0, 4).map(st => toolChip(st, 30)).join('')}</div>` : `<div class="jc-tools"><span class="flag warn">No tools planned yet</span></div>`}
            <div class="jc-last">${jc.lastEntry ? `Last logged ${fmtAgo(jc.lastEntry.timestamp)}${jc.lastEntry.operator ? ' by ' + esc(jc.lastEntry.operator) : ''}` : 'Nothing logged yet'}</div>
            <div class="jc-acts">
              <button class="btn btn-teal" onclick="event.stopPropagation();quickLog('${j.id}')">+ Log production</button>
              <button class="btn btn-ghost" onclick="event.stopPropagation();navigate('job',{jobId:'${j.id}'})">Open job</button>
            </div>
          </div>`;
      }

      const statusBadge = `<span class="job-status-badge ${j.status||'active'}">${j.status||'active'}</span>`;
      return `
        <div class="job-row" onclick="navigate('job',{jobId:'${j.id}'})" role="button" tabindex="0"
          onkeydown="if(event.key==='Enter')navigate('job',{jobId:'${j.id}'})">
          <div>
            <div><span class="job-code">${esc(j.componentCode)}</span>${statusBadge}</div>
            <div class="job-desc">${esc(j.componentDesc || '')}${j.customer ? ' — ' + esc(j.customer) : ''}</div>
            <div class="job-meta">${fmtDate(j.createdAt)} &middot; ${stations.length} station${stations.length===1?'':'s'}
              ${jc.totalAnomalies ? ` &middot; <span style="color:var(--bad);font-weight:700">${jc.totalAnomalies} anomal${jc.totalAnomalies===1?'y':'ies'}</span>` : ''}
            </div>
            <div class="job-health" style="margin-top:.35rem">${healthDots}</div>
          </div>
          <div>
            <div class="job-count">${fmtN(jc.finalProduced)}</div>
            <div class="job-count-lbl">pcs made</div>
            ${owner && jc.totalCpc ? `<div style="font-family:var(--mono);font-size:.8rem;color:var(--teal);text-align:right;margin-top:.2rem;font-weight:700">${fmtRs(jc.totalCpc,2)}/pc</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  return hd + `<div class="panel"><div id="jobs-list">${listHtml}</div></div>`;
}

function vCPCContent() {
  const rows = [];
  (db.jobs || []).forEach(j => {
    jobAllStations(j).forEach(st => {
      const sc = calcStation(st);
      if (!sc.sets.length) return;
      rows.push({
        insert: st.insertDesig || '—',
        component: j.componentCode,
        station: st.name,
        opType: st.opType,
        sets: sc.sets.length,
        totalPcs: sc.totalComponents,
        cpc: sc.confirmedCpc != null ? sc.confirmedCpc : sc.provisionalCpc,
        confirmed: sc.confirmedCpc != null,
      });
    });
  });

  if (!rows.length) {
    return `<div class="panel"><div style="text-align:center;padding:3rem 1rem;color:var(--mut)">
      <div style="font-size:.85rem;margin-bottom:.4rem;font-weight:700;color:var(--navy)">No insert data yet</div>
      <div style="font-size:.75rem">Add tooling stations and log production to see CPC comparison here.</div>
    </div></div>`;
  }

  // Sort by CPC ascending: cheapest insert first, nulls last
  rows.sort((a, b) => {
    if (a.cpc == null && b.cpc == null) return a.insert.localeCompare(b.insert);
    if (a.cpc == null) return 1;
    if (b.cpc == null) return -1;
    return a.cpc - b.cpc;
  });

  const tableRows = rows.map(r => {
    const cpc = r.cpc != null
      ? `<span class="cpc-val">${fmtRs(r.cpc, 2)}</span>${!r.confirmed ? '<span style="color:var(--mut);font-size:.75rem"> so far</span>' : ''}`
      : '<span style="color:var(--mut)">—</span>';
    return `<tr>
      <td class="insert-name">${esc(r.insert)}</td>
      <td style="font-family:var(--mono);font-size:.8rem;font-weight:700">${esc(r.component)}</td>
      <td>${esc(r.station)}</td>
      <td>${opBadge(r.opType)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtN(r.sets)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtN(r.totalPcs)}</td>
      <td style="text-align:right">${cpc}</td>
    </tr>`;
  }).join('');

  return `<div class="panel">
    <div class="panel-hd"><span class="lbl">Cost per piece, by insert</span><div class="hr"></div><span class="lbl muted">${rows.length} tool${rows.length===1?'':'s'}, cheapest first</span></div>
    <div style="overflow-x:auto">
      <table class="cpc-tbl">
        <thead><tr>
          <th>Insert</th><th>Job</th><th>Tool</th><th>Kind</th>
          <th style="text-align:right">Sets used</th><th style="text-align:right">Pieces</th><th style="text-align:right">Per piece</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="padding:.5rem 1rem;font-size:.75rem;color:var(--mut)">"so far" means the set in the machine is not used up yet. Per piece = insert cost ÷ pieces made with that insert.</div>
  </div>`;
}

function vNewJob() {
  setTabs(`<button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button><button class="tab" aria-selected="true">New Job</button>`);
  setBarCrumb('New Job', true);
  setTimeout(buildDataLists, 0);
  return `
    <div class="panel">
      <div class="panel-hd">
        <span class="lbl">Component Job</span>
        <div class="hr"></div>
      </div>
      <div class="panel-bd">
        <form id="new-job-form" onsubmit="submitNewJob(event)">
          <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
            <div class="field" style="grid-column:1/-1">
              <label for="nj-code">Component Code <span class="req">*</span></label>
              <input id="nj-code" list="dl-codes" autocomplete="off" placeholder="e.g. FC-2041" required>
              <datalist id="dl-codes"></datalist>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label for="nj-desc">Description</label>
              <input id="nj-desc" list="dl-descs" autocomplete="off" placeholder="e.g. Gear Flange EN8">
              <datalist id="dl-descs"></datalist>
            </div>
            <div class="field">
              <label for="nj-cust">Customer / Job No.</label>
              <input id="nj-cust" list="dl-custs" autocomplete="off" placeholder="Optional">
              <datalist id="dl-custs"></datalist>
            </div>
            <div class="field">
              <label for="nj-batch">Order quantity <span class="opt">(optional)</span></label>
              <input id="nj-batch" type="number" inputmode="numeric" min="0" placeholder="e.g. 500">
              <div class="hint">Shows progress and the likely finish date.</div>
            </div>
            <div class="field">
              <label for="nj-op">Created By</label>
              <input id="nj-op" list="dl-ops" autocomplete="off" placeholder="Operator name" value="${esc(db.settings.defaultOperator||'')}">
              <datalist id="dl-ops"></datalist>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label for="nj-notes">Notes</label>
              <textarea id="nj-notes" placeholder="Any setup or material notes"></textarea>
            </div>
          </div>
          <div style="display:flex;gap:.55rem;margin-top:1.1rem;flex-wrap:wrap">
            <button type="submit" class="btn btn-pri btn-lg">Create Job &#8594;</button>
            <button type="button" class="btn btn-ghost" onclick="navigate('jobs')">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
}

function buildOpsPipeline(job, ops) {
  const opStats = (calcJob(job).opStats || []);
  const steps = ops.map((op, idx) => {
    const stat = opStats.find(s => s.op.id === op.id) || { produced: 0, good: 0, rejected: 0 };
    const isActive = op.id === ui.activeOpId;
    const nextOp = ops[idx + 1];
    const wip = nextOp ? Math.max(0, stat.good - ((opStats.find(s => s.op.id === nextOp.id) || {}).produced || 0)) : 0;
    const rejRate = stat.produced > 0 ? (stat.rejected / stat.produced * 100).toFixed(1) : null;
    return `
      <div class="op-step ${isActive ? 'active' : ''}" onclick="setActiveOp('${job.id}','${op.id}')">
        <div class="op-step-name">${esc(op.name)}</div>
        <div class="op-step-stat">${stat.produced > 0 ? `${fmtN(stat.good)} <span class="s-sub">good</span>${rejRate > 0 ? ` &middot; <span class="bad-c">${rejRate}% rej</span>` : ''}` : '<span class="s-sub muted">No log</span>'}</div>
        ${nextOp && wip > 0 ? `<div class="op-wip">${fmtN(wip)} WIP →</div>` : ''}
      </div>
      ${idx < ops.length - 1 ? '<div class="op-arrow">&#8594;</div>' : ''}`;
  }).join('');
  return `
    <div class="ops-pipeline">
      <div class="ops-steps">${steps}</div>
    </div>`;
}

// The process plan: every operation in order and the tools each one needs.
// Done by the owner when the job is taken on, before anything is logged.
function vJobPlan(job) {
  const ops = job.operations || [];
  const jc = calcJob(job);
  let toolCount = 0, loadCost = 0;
  const opCards = ops.map((op, idx) => {
    const stations = op.stations || [];
    toolCount += stations.length;
    const logged = (job.productionLog || []).some(e => e.operationId === op.id);
    const adding = ui.addStationOpen && ui.activeOpId === op.id;
    const rows = stations.map(st => {
      const sc = calcStation(st);
      const solid = isSolidTool(st.opType);
      loadCost += sc.setCost;
      const what = [st.insertDesig, st.toolHolder, st.machine].filter(Boolean).map(esc).join(' · ') || 'No insert or machine entered';
      const cost = sc.setCost > 0
        ? (solid ? `${fmtRs(sc.setCost, 0)} a tool` : `${fmtRs(sc.setCost, 0)} a set · ${sc.totalCorners} corner${sc.totalCorners === 1 ? '' : 's'}`)
        : 'No cost entered';
      const loaded = (st.insertSets || []).some(s => s.status === 'active');
      return `
        <div class="plan-tool" role="button" tabindex="0" onclick="navigate('station',{jobId:'${job.id}',stationId:'${st.id}'})" onkeydown="if(event.key==='Enter')navigate('station',{jobId:'${job.id}',stationId:'${st.id}'})">
          <div class="plan-tool-main"><b>${esc(st.name)}</b> ${opBadge(st.opType)}<span>${what}</span></div>
          <div class="plan-tool-cost">${cost}</div>
          <div class="plan-tool-state">${loaded ? '<span class="pill run">Loaded</span>' : '<span class="pill done">Not loaded yet</span>'}</div>
        </div>`;
    }).join('');
    return `
      <div class="panel plan-op">
        <div class="panel-hd">
          <span class="lbl">${esc(op.name)}</span>
          <span class="lbl muted">${idx === 0 ? 'First operation' : 'After ' + esc(ops[idx - 1].name)}</span>
          <div class="hr"></div>
          <button class="btn btn-ghost btn-sm" onclick="renameOperation('${job.id}','${op.id}')">Rename</button>
          ${!stations.length && !logged && ops.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="removeOperation('${job.id}','${op.id}')">Remove</button>` : ''}
        </div>
        ${rows || (adding ? '' : `<div class="rail-empty">No tool planned for this operation yet.</div>`)}
        ${adding
          ? `<div class="plan-add">${buildAddStationForm(job)}</div>`
          : `<div class="rail-foot"><button class="btn ${stations.length ? 'btn-ghost' : 'btn-pri'}" onclick="planAddTool('${op.id}')">+ Add a tool to ${esc(op.name)}</button></div>`}
      </div>`;
  }).join('');

  ui._sub = `Process plan${job.componentDesc ? ' for ' + job.componentDesc : ''}. Set the operations and the tool for each one before production starts.`;
  const batch = Number(job.batchQty) || 0;
  return `
    <div class="job-grid">
      <div class="job-main">
        ${opCards}
        <button class="btn btn-ghost plan-addop" onclick="addOperation('${job.id}')">+ Add another operation</button>
      </div>
      <aside class="job-rail">
        <div class="panel kv">
          <div class="panel-hd"><span class="lbl">The plan so far</span><div class="hr"></div></div>
          <div class="kv-row"><span>Operations<small>In the order the part is machined</small></span><b>${fmtN(ops.length)}</b></div>
          <div class="kv-row"><span>Tools<small>Across every operation</small></span><b>${fmtN(toolCount)}</b></div>
          <div class="kv-row"><span>One full load<small>Every tool loaded once</small></span><b>${loadCost > 0 ? fmtRs(loadCost, 0) : 'Not yet'}</b></div>
          <div class="kv-row"><span>Order quantity<small><button type="button" class="hero-link" onclick="setBatchQty('${job.id}')">${batch ? 'Change' : 'Set it'}</button></small></span><b>${batch ? fmtN(batch) + ' pcs' : 'Not set'}</b></div>
        </div>
        <button class="btn btn-pri btn-lg plan-go" onclick="navigate('job',{jobId:'${job.id}'})">${jc.totalProduced > 0 ? 'Back to production' : 'Plan done — go to production'}</button>
        <p class="plan-note">Operators only see the Production tab. They log pieces and tool changes against the tools planned here.</p>
      </aside>
    </div>`;
}

function planAddTool(opId) {
  if (!requireOwner() || !requireActive()) return;
  ui.activeOpId = opId;
  ui.addStationOpen = true;
  render();
  setTimeout(() => { const f = document.querySelector('.plan-add'); if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center' }); }, 40);
}

function renameOperation(jobId, opId) {
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  const op = job && (job.operations || []).find(o => o.id === opId);
  if (!op) return;
  const v = prompt('Name of this operation (for example: Turning, VMC first setup, Drilling)', op.name);
  if (v === null) return;
  const name = v.trim().slice(0, 40);
  if (!name) return;
  op.name = name;
  saveDB();
  render();
}

// Only an operation with no tools and nothing logged against it can go.
function removeOperation(jobId, opId) {
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job || (job.operations || []).length < 2) return;
  const op = job.operations.find(o => o.id === opId);
  if (!op || (op.stations || []).length || (job.productionLog || []).some(e => e.operationId === opId)) return;
  job.operations = job.operations.filter(o => o.id !== opId);
  job.operations.forEach((o, i) => { o.sequence = i + 1; });
  if (ui.activeOpId === opId) ui.activeOpId = job.operations[0].id;
  saveDB();
  toast(`${op.name} removed`);
  render();
}

function setActiveOp(jobId, opId) {
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  ui.activeOpId = opId;
  render();
}

function addOperation(jobId) {
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  const n = (job.operations || []).length + 1;
  const op = { id: uid(), name: `Op-${n}`, sequence: n, stations: [] };
  job.operations.push(op);
  ui.activeOpId = op.id;
  saveDB();
  toast(`${op.name} added`, 'ok');
  render();
}

function vJobDetail() {
  const job = db.jobs.find(j => j.id === ui.jobId);
  if (!job) { navigate('jobs'); return ''; }

  const jc = calcJob(job);
  const ops = job.operations || [];

  // Set active op from ui or default to first
  if (!ui.activeOpId || !ops.find(o => o.id === ui.activeOpId)) {
    ui.activeOpId = ops.length ? ops[0].id : null;
  }
  const activeOp = getActiveOp(job);
  const stations = activeOp ? (activeOp.stations || []) : [];
  const log = (job.productionLog || []).slice().reverse();

  const owner = isOwner();
  const planMode = ui.jobTab === 'plan' && owner && !isOperatorDevice();
  const tabHtml = `
    <button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button>
    <button class="tab" aria-selected="${!planMode}" onclick="navigate('job',{jobId:'${job.id}'})">Production</button>
    ${owner && !isOperatorDevice() ? `<button class="tab" aria-selected="${planMode}" onclick="navigate('job',{jobId:'${job.id}',plan:true})">Process plan</button>` : ''}
    ${owner ? `<button class="tab" onclick="navigate('report',{jobId:'${job.id}'})">Report</button>` : ''}
  `;
  setTabs(tabHtml);
  setBarCrumb(job.componentCode, true);
  setTimeout(buildDataLists, 0);
  if (planMode) return vJobPlan(job);
  const allTools = jobAllStations(job).length;

  // Operations pipeline bar + add/rename ops
  const opsPipeline = buildOpsPipeline(job, ops);

  const stationTiles = stations.map(st => stationTile(st, job.id)).join('');
  const statusOptions = ['active','paused','complete'].map(s =>
    `<option value="${s}"${(job.status||'active')===s?' selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
  ).join('');

  let logHtml = '';
  if (!log.length) {
    logHtml = `<div style="padding:.9rem 1rem;color:var(--mut);font-size:.78rem">No production logged yet.</div>`;
  } else {
    const rows = log.map(entry => {
      const evChips = (entry.events || []).map(ev => {
        const st = stations.find(s => s.id === ev.stationId);
        const stName = st ? st.name : '?';
        let cls = ev.eventType === 'corner_index' ? 'index' : ev.eventType === 'insert_replace' ? 'replace' : 'broken';
        let lbl = ev.eventType === 'corner_index' ? 'Idx' : ev.eventType === 'insert_replace' ? 'Rpl' : 'Brk';
        return `<span class="ev-chip ${cls}" title="${esc(stName)}: ${ev.eventType}">${esc(stName)} &middot; ${lbl}</span>`;
      }).join('');
      return `
        <tr>
          <td class="ts-cell">${fmtDate(entry.timestamp)}<br><span style="color:var(--mut)">${fmtTime(entry.timestamp)}</span></td>
          <td>${esc(entry.operator || '—')}</td>
          <td class="mono" style="color:var(--mut)">${esc(entry.machine || '—')}</td>
          <td class="qty-cell">${fmtN(entry.qty)}</td>
          <td class="n">${entry.cycleTimeMins > 0 ? fmtN(entry.cycleTimeMins,1)+' min' : '<span class="muted">—</span>'}</td>
          <td><div class="ev-chips">${evChips || '<span class="muted">None</span>'}</div></td>
          ${owner ? `<td><button class="btn-icon-sm" onclick="openLogEdit('${job.id}','${entry.id}')" title="Edit entry">Edit</button></td>` : ''}
        </tr>`;
    }).join('');

    logHtml = `
      <div class="log-tbl-wrap">
        <table class="log-tbl">
          <thead><tr>
            <th>Date and time</th><th>Operator</th><th>Machine</th><th class="n">Pieces</th><th class="n">Cycle</th><th>Tool changes</th>${owner ? '<th></th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const batch = Number(job.batchQty) || 0;
  const left = batch > 0 ? Math.max(0, batch - jc.totalGood) : null;
  const pace = jobPace(job, left);
  const orderHtml = batch > 0
    ? `<div class="hero-order">${pace.perDay ? `Running at ${fmtN(pace.perDay)} good pieces a working day.` : ''}${owner ? ` <button type="button" class="hero-link" onclick="setBatchQty('${job.id}')">Change order quantity</button>` : ''}</div>`
    : owner ? `<div class="hero-order"><button type="button" class="hero-link" onclick="setBatchQty('${job.id}')">Set order quantity</button></div>` : '';
  const cpcHtml = jc.totalCpc != null
    ? `<span class="s-val">${fmtRs(jc.totalCpc,2)}</span><span class="s-unit"> /pc</span>`
    : `<span class="s-val muted" style="font-size:1rem">Pending</span>`;
  const cornerLifeHtml = jc.avgCornerLife != null
    ? `<span class="s-val">${fmtN(jc.avgCornerLife)}</span><span class="s-unit"> pcs</span>`
    : `<span class="s-val muted" style="font-size:1rem">—</span>`;

  return `
    ${isOperatorDevice() ? syncStatusBar() : ''}
    <div class="job-grid"><div class="job-main">
    <div class="job-hero">
      <div class="hero-top">
        <div class="hero-main">
          <div class="hero-code">${esc(job.componentCode)}</div>
          <div class="hero-desc">${esc(job.componentDesc || '')}${job.customer ? ' — ' + esc(job.customer) : ''}</div>
          <div class="hero-meta">
            Started ${fmtDate(job.createdAt)}
            ${jc.lastEntry ? ' &middot; Last run ' + fmtDate(jc.lastEntry.timestamp) : ''}
            &middot; ${owner
              ? `<select aria-label="Job status"
                onchange="setJobStatus('${job.id}',this.value)">${statusOptions}</select>`
              : `<span style="text-transform:capitalize">${esc(job.status || 'active')}</span>`}
          </div>
        </div>
        <div class="hero-count-wrap">
          <div class="hero-num">${fmtN(jc.finalProduced)}</div>
          <div class="hero-num-lbl">pieces made in all · ${fmtN(jobTodayQty(job))} today</div>
        </div>
      </div>
      ${batch > 0 ? `<div class="jc-prog">${orderTrack(jc.totalGood, batch, pace)}</div>` : ''}
      ${orderHtml}
      <div class="hero-acts">
        ${isReadOnly() ? '' : `<button class="btn btn-teal btn-lg" onclick="toggleLogForm()">${ui.logOpen ? 'Close' : '+ Log production'}</button>`}
        <button class="btn btn-ghost" onclick="navigate('shift')">Shift proof</button>
        ${owner ? `<button class="btn btn-ghost" onclick="navigate('report',{jobId:'${job.id}'})">Report</button>` : ''}
      </div>
    </div>

    ${ui.logOpen && !isReadOnly() ? `<div id="log-form-container" style="margin-top:.85rem">${buildLogForm(job)}</div>` : ''}

    ${jc.totalAnomalies ? `
      <div class="anomaly-flag" style="margin-top:.85rem">
        
        <div>
          <div class="msg">${jc.totalAnomalies} insert${jc.totalAnomalies===1?'':'s'} failed early</div>
          <div class="detail">Replaced well before the usual life. The report shows which and when.</div>
        </div>
      </div>` : ''}

    ${ops.length > 1 ? opsPipeline : ''}
    <div class="panel" style="margin-top:.5rem;margin-bottom:.5rem">
      <div class="panel-hd">
        <span class="lbl">Tools${ops.length > 1 && activeOp ? ' on ' + esc(activeOp.name) : ' on this job'}</span>
        <div class="hr"></div>
        ${owner && !isOperatorDevice() && allTools ? `<button class="btn btn-ghost btn-sm" onclick="navigate('job',{jobId:'${job.id}',plan:true})">Change the plan</button>` : `<span class="lbl muted">${stations.length} tool${stations.length===1?'':'s'}</span>`}
      </div>
      ${stations.length === 0 ? `
        <div class="empty">
          <b>${allTools ? 'No tools planned for ' + esc(activeOp ? activeOp.name : 'this operation') : 'No tools planned yet'}</b>
          <p>${owner && !isOperatorDevice()
            ? 'Plan the operations and the tool for each one. Insert life and cost per piece are tracked from the first entry after that.'
            : 'The owner plans the tools for this job. You can log pieces in the meantime.'}</p>
          ${owner && !isOperatorDevice() ? `<button class="btn btn-pri" onclick="navigate('job',{jobId:'${job.id}',plan:true})">Plan the process</button>` : ''}
        </div>` : `
      <div class="station-scroll">
        ${stationTiles}
      </div>`}
    </div>
    <div class="panel">
      <div class="panel-hd">
        <span class="lbl">Production log</span>
        <div class="hr"></div>
        <span class="lbl muted">${log.length} entr${log.length===1?'y':'ies'}</span>
      </div>
      ${logHtml}
    </div>
    </div>
    <aside class="job-rail">
      <div class="panel kv">
        <div class="panel-hd"><span class="lbl">This job in numbers</span><div class="hr"></div></div>
        ${owner ? `<div class="kv-row"><span>Tooling per piece<small>Insert cost ÷ good pieces</small></span><b>${jc.totalCpc != null ? fmtRs(jc.totalCpc, 2) : 'Not yet'}</b></div>` : ''}
        ${owner ? `<div class="kv-row"><span>Tooling spend<small>Inserts and tools loaded so far</small></span><b>${fmtRs(jc.totalInsertCost, 0)}</b></div>` : ''}
        <div class="kv-row"><span>Corner life<small>Average pieces per insert corner</small></span><b>${jc.avgCornerLife != null ? fmtN(jc.avgCornerLife) + ' pcs' : 'Not yet'}</b></div>
        <div class="kv-row"><span>Rejected<small>${jc.totalProduced > 0 ? (jc.totalRejected / jc.totalProduced * 100).toFixed(1) + '% of pieces machined, every operation' : 'Nothing made yet'}</small></span><b class="${jc.totalRejected > 0 ? 'bad-c' : ''}">${fmtN(jc.totalRejected)}</b></div>
        <div class="kv-row"><span>Early insert failures<small>Broke well before the usual life</small></span><b class="${jc.totalAnomalies ? 'bad-c' : ''}">${fmtN(jc.totalAnomalies)}</b></div>
      </div>
    </aside></div>`;
}

// Pieces logged against a job since midnight (every operation).
function jobTodayQty(job, opId) {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const counts = e => opId ? (e.operationId === opId || (!e.operationId && (job.operations || []).length <= 1)) : isFinalOpEntry(job, e);
  return (job.productionLog || []).reduce((s, e) => s + (new Date(e.timestamp) >= t0 && counts(e) ? (Number(e.qty) || 0) : 0), 0);
}

// The usual size of one entry on this job. Used to catch a slipped digit
// (500 for 50) before it is saved — operators cannot edit an entry afterwards.
function typicalEntryQty(job) {
  const q = (job.productionLog || []).map(e => Number(e.qty) || 0).filter(v => v > 0).sort((a, b) => a - b);
  return q.length >= 3 ? q[Math.floor(q.length / 2)] : null;
}

// Good pieces per working day over the last week, and the days left at that pace.
function jobPace(job, remaining) {
  const since = Date.now() - 7 * 86400000;
  const days = new Set(); let qty = 0;
  const ops = job.operations || [];
  const finalOp = ops.length ? ops[ops.length - 1].id : null;
  (job.productionLog || []).forEach(e => {
    const t = new Date(e.timestamp);
    if (t.getTime() < since) return;
    if (finalOp && e.operationId && e.operationId !== finalOp) return;
    qty += Number(e.qtyGood != null ? e.qtyGood : e.qty) || 0;
    days.add(t.toDateString());
  });
  const perDay = days.size ? Math.round(qty / days.size) : 0;
  const daysLeft = perDay > 0 && remaining != null && remaining > 0 ? Math.ceil(remaining / perDay) : null;
  return { perDay, daysLeft };
}

// What a job's tools need from the person at the machine, in words.
function jobToolFlags(job) {
  const out = [];
  jobAllStations(job).forEach(st => {
    const sc = calcStation(st);
    const solid = isSolidTool(st.opType);
    if (!(st.insertSets || []).length) return;
    if (!sc.activeSet) out.push({ cls: 'warn', text: `${st.name}: ${solid ? 'load a new tool' : 'load new inserts'}` });
    else if (sc.lifeStatus === 'overdue') out.push({ cls: 'bad', text: `${st.name}: ${solid ? 'replace tool' : 'index now'}` });
    else if (sc.lifeStatus === 'warn' && sc.pcsRemainingOnCorner != null) out.push({ cls: 'warn', text: `${st.name}: ~${sc.pcsRemainingOnCorner} pcs left` });
  });
  return out;
}

// One choice out of a row of tap buttons; the value lands in a hidden input.
function pickSeg(btn, inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = btn.dataset.v || '';
  $$('.seg', btn.parentElement).forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
}

function rejQtyChanged() {
  const n = parseInt((($('#lp-rej-qty') || {}).value) || 0) || 0;
  const r = $('#lf-reasons');
  if (r) r.hidden = n <= 0;
}

function buildLogForm(job) {
  const ops = job.operations || [];
  const activeOp = getActiveOp(job) || ops[0];
  const stations = activeOp ? (activeOp.stations || []) : [];
  const opSelector = ops.length > 1
    ? `<div class="field" style="grid-column:1/-1;margin-bottom:.4rem">
        <label>Operation <span class="req">*</span></label>
        <select id="lp-opsel" onchange="render()" style="font-weight:600">
          ${ops.map(op => `<option value="${op.id}"${op.id === (activeOp && activeOp.id) ? ' selected' : ''}>${esc(op.name)}</option>`).join('')}
        </select>
      </div>` : `<input type="hidden" id="lp-opsel" value="${activeOp ? activeOp.id : ''}">`;

  const rejReasons = (db.settings.rejectionReasons || REJECTION_REASONS);
  const rejectionSection = `
    <div class="lf-sec">
      <label class="lf-sec-hd" for="lp-rej-qty">Rejected <span class="opt">— leave empty if all good</span></label>
      <input id="lp-rej-qty" type="number" inputmode="numeric" min="0" max="9999" class="lf-rej-inp" placeholder="0" oninput="rejQtyChanged()">
      <div id="lf-reasons" class="seg-wrap" role="group" aria-label="Rejection reason" hidden>
        ${rejReasons.map(r => `<button type="button" class="seg" aria-pressed="false" data-v="${esc(r)}" onclick="pickSeg(this,'lp-rej-reason')">${esc(r)}</button>`).join('')}
      </div>
      <input type="hidden" id="lp-rej-reason" value="">
    </div>`;

  const stRows = stations.map(st => {
    const sc = calcStation(st);
    const noInsert = !sc.activeSet;
    const stCat = toolCategory(st.opType);
    const solid = stCat === 'solid';
    const milling = stCat === 'milling';
    const loadChoices = [['none', 'Not loaded'], ['insert_load', solid ? 'Loaded a new tool' : 'Loaded new inserts']];
    const choices = solid
      ? [['none', 'No change'], ['insert_replace', 'Replaced — worn'], ['insert_replace_broken', 'Replaced — broke']]
      : [['none', 'No change'], ['corner_index', milling ? 'Indexed all' : 'Indexed'], ['insert_replace', 'Replaced — worn'], ['insert_replace_broken', 'Replaced — broke']];
    const setInfo = sc.currentSetNum
      ? solid
        ? `Tool #${sc.currentSetNum} \xb7 ${fmtN(sc.currentCornerPcs)} pcs`
        : milling && st.cutterDiameter
          ? `\xf8${st.cutterDiameter}mm \xb7 Set ${sc.currentSetNum} \xb7 corner ${sc.currentCornerNum||'?'} of ${sc.totalCorners} \xb7 ${fmtN(sc.currentCornerPcs)} pcs`
          : `Set ${sc.currentSetNum} \xb7 corner ${sc.currentCornerNum||'?'} of ${sc.totalCorners} \xb7 ${fmtN(sc.currentCornerPcs)} pcs`
      : solid ? 'No tool loaded' : 'No active insert';
    const due = sc.activeSet && sc.lifeStatus === 'overdue'
      ? `<span class="flag bad">${solid ? 'Replace due' : 'Index due'}</span>`
      : sc.activeSet && sc.lifeStatus === 'warn' && sc.pcsRemainingOnCorner != null
        ? `<span class="flag warn">~${sc.pcsRemainingOnCorner} pcs left</span>` : '';
    return `
      <div class="ev-station-row">
        <div>
          <div class="ev-st-name">${esc(st.name)} ${due}</div>
          <div class="ev-st-sub small muted">${esc(setInfo)}</div>
        </div>
        ${noInsert
          ? `<div class="seg-wrap" role="group" aria-label="${esc(st.name)} tool load">
               ${loadChoices.map(([v, l], i) => `<button type="button" class="seg" aria-pressed="${i === 0}" data-v="${v}" onclick="pickSeg(this,'ev_${st.id}')">${l}</button>`).join('')}
             </div>
             <input type="hidden" name="ev_${st.id}" id="ev_${st.id}" value="none">`
          : `<div class="seg-wrap" role="group" aria-label="${esc(st.name)} tool change">
               ${choices.map(([v, l], i) => `<button type="button" class="seg${v === 'insert_replace_broken' ? ' seg-bad' : ''}" aria-pressed="${i === 0}" data-v="${v}" onclick="pickSeg(this,'ev_${st.id}')">${l}</button>`).join('')}
             </div>
             <input type="hidden" name="ev_${st.id}" id="ev_${st.id}" value="none">`}
      </div>`;
  }).join('');

  const toolingSection = stations.length ? `
    <div class="lf-sec">
      <div class="lf-sec-hd">Tool change <span class="opt">— tap only if you indexed or replaced</span></div>
      <div class="ev-station-list">${stRows}</div>
    </div>
  ` : '';

  // An operator's own phone already knows who is logging.
  const who = db.settings.defaultOperator || '';
  const fixedWho = isOperatorDevice() && who;
  const operatorField = fixedWho
    ? `<input type="hidden" id="lp-op" value="${esc(who)}">`
    : `<div class="field">
        <label for="lp-op">Operator</label>
        <input id="lp-op" list="dl-ops-lp" autocomplete="off" placeholder="Name" value="${esc(who)}">
        <datalist id="dl-ops-lp"></datalist>
      </div>`;
  const today = jobTodayQty(job, activeOp && ops.length > 1 ? activeOp.id : null);

  return `
    <div class="log-form-wrap" id="log-form-wrap">
      <div class="log-form-hd">
        <span class="title">${esc(job.componentCode)}${ops.length > 1 && activeOp ? ' · ' + esc(activeOp.name) : ''} — pieces made</span>
        <span class="lf-today">Today so far <b>${fmtN(today)}</b></span>
      </div>
      <div class="log-form-bd">
        <form id="log-prod-form" onsubmit="submitLogProduction(event,'${job.id}')">
          ${opSelector}
          ${fixedWho ? `<div class="lf-who">Logging as <b>${esc(who)}</b></div>` : ''}
          <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:.55rem">
            <div class="field">
              <label for="lp-qty">Pieces made <span class="req">*</span></label>
              <div class="qty-row" style="flex-wrap:nowrap;gap:.3rem;margin-bottom:0">
                <input id="lp-qty" type="number" inputmode="numeric" min="1" max="9999" class="qty-inp" placeholder="0" required autofocus>
                <div style="display:flex;flex-direction:column;gap:.22rem">
                  <button type="button" class="qty-adj" onclick="adjQty(5)">+5</button>
                  <button type="button" class="qty-adj" onclick="adjQty(10)">+10</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:.22rem">
                  <button type="button" class="qty-adj" onclick="adjQty(25)">+25</button>
                  <button type="button" class="qty-adj" onclick="adjQty(100)">+100</button>
                </div>
              </div>
            </div>
            ${operatorField}
            <div class="field">
              <label for="lp-mach">Machine</label>
              <input id="lp-mach" list="dl-machs-lp" autocomplete="off" placeholder="Machine" value="${esc(db.settings.defaultMachine||'')}">
              <datalist id="dl-machs-lp"></datalist>
            </div>
          </div>
          ${rejectionSection}
          ${toolingSection}
          <div style="display:flex;gap:.5rem;margin-top:.85rem;flex-wrap:wrap">
            <button type="submit" class="btn btn-teal btn-lg lf-save">Save entry</button>
            <button type="button" class="btn btn-ghost" onclick="toggleLogForm()">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
}

// Shared fields for both add and edit forms. ex = existing station (null for add).
// Which inventory categories fit each tool category
function invCatsForTool(opType) {
  const cat = toolCategory(opType);
  if (cat === 'milling') return ['milling_insert', 'other'];
  if (cat === 'solid')   return ['drill', 'endmill', 'other'];
  return ['turning_insert', 'other'];
}

// Optional "pick from inventory" select — renders nothing when the
// inventory has no matching items, so unlinked workflows are untouched.
function invPickerHtml(opType, ex) {
  const cats = invCatsForTool(opType);
  const items = (db.inventory || []).filter(i => cats.includes(i.category));
  const selectedId = (ex && ex.inventoryItemId) || '';
  if (!items.length) return `<input type="hidden" id="sf-inv" value="${esc(selectedId)}">`;
  const opts = items.map(i =>
    `<option value="${i.id}"${i.id === selectedId ? ' selected' : ''}>${esc(i.designation)}${i.grade ? ' · ' + esc(i.grade) : ''} (${i.qtyInStock || 0} in stock)</option>`
  ).join('');
  return `
    <div class="field" style="grid-column:1/-1">
      <label for="sf-inv">Pick from Inventory</label>
      <select id="sf-inv" onchange="pickInventoryItem(this)">
        <option value="">— not linked —</option>
        ${opts}
      </select>
      <div class="hint">Linking auto-fills the fields below and deducts stock on every load.</div>
    </div>`;
}

function pickInventoryItem(sel) {
  const item = (db.inventory || []).find(i => i.id === sel.value);
  if (!item) return;
  const desigEl = $('#sf-insert') || $('#sf-tool-spec');
  if (desigEl) desigEl.value = [item.manufacturer, item.grade, item.designation].filter(Boolean).join(' ');
  const costEl = $('#sf-cost');
  if (costEl && item.unitPrice > 0) costEl.value = item.unitPrice;
  updateSetCostHint();
}

function buildStationFields(opType, ex) {
  const cat = toolCategory(opType);
  const fv = (field, def) => (ex != null && ex[field] != null) ? ex[field] : def;
  const inp = (field, def) => `value="${esc(String(fv(field, def)))}"`;
  const invPicker = invPickerHtml(opType, ex);

  if (cat === 'solid') {
    const isTap = opType === 'tapping';
    return `
      ${invPicker}
      <div class="field" style="grid-column:1/-1">
        <label for="sf-tool-spec">${isTap ? 'Tap Size' : 'Drill Diameter / Spec'}</label>
        <input id="sf-tool-spec" autocomplete="off"
          placeholder="${isTap ? 'e.g. M8\xd71.25' : 'e.g. \xf812 HSS-Co'}"
          ${inp('insertDesig','')}>
        <div class="hint">${isTap ? 'Thread size and pitch — used to identify this tap.' : 'Diameter and material (HSS, solid carbide, etc.)'}</div>
      </div>
      <div class="field">
        <label for="sf-cost">Cost per Tool (&#8377;) <span class="req">*</span></label>
        <input id="sf-cost" type="number" inputmode="decimal" min="0" step="0.01" ${inp('insertCostPer','')} placeholder="0.00">
        <div class="hint">Price of one ${isTap ? 'tap' : 'drill'}</div>
      </div>`;
  }

  if (cat === 'milling') {
    const nIns = fv('insertsInCutter', 1);
    const cPer = fv('insertCostPer', 0);
    const hint = (nIns && cPer) ? `${nIns} inserts \xd7 ₹${cPer} = ₹${(nIns * cPer).toFixed(2)} per full set` : 'Qty \xd7 this price = full set replacement cost';
    return `
      ${invPicker}
      <div class="field">
        <label for="sf-diam">Cutter Diameter (mm)</label>
        <input id="sf-diam" type="number" min="1" step="0.1" placeholder="e.g. 80" ${inp('cutterDiameter','')}>
        <div class="hint">Outside diameter of the cutter body</div>
      </div>
      <div class="field" style="grid-column:1/-1">
        <label for="sf-insert">Insert (Brand \xb7 Grade \xb7 Type)</label>
        <input id="sf-insert" list="dl-desigs" autocomplete="off" placeholder="e.g. TOOLFLUX TF425P SDMT09T308" ${inp('insertDesig','')}>
        <datalist id="dl-desigs"></datalist>
        <div class="hint">Brand, grade, geometry — used to compare cost per piece across brands.</div>
      </div>
      <div class="field">
        <label for="sf-qty">Inserts in Cutter</label>
        <input id="sf-qty" type="number" inputmode="numeric" min="1" max="32" ${inp('insertsInCutter',1)} oninput="updateSetCostHint()">
        <div class="hint">How many inserts the cutter body holds</div>
      </div>
      <div class="field">
        <label for="sf-corners">Corners per Insert</label>
        <input id="sf-corners" type="number" inputmode="numeric" min="1" max="16" ${inp('cuttingCornersPerInsert',4)} oninput="updateSetCostHint()">
        <div class="hint">Indexable edges before this insert is scrapped</div>
      </div>
      <div class="field">
        <label for="sf-cost">Cost per Insert (&#8377;) <span class="req">*</span></label>
        <input id="sf-cost" type="number" inputmode="decimal" min="0" step="0.01" ${inp('insertCostPer','')} placeholder="0.00" oninput="updateSetCostHint()">
        <div class="hint" id="sf-cost-hint">${esc(hint)}</div>
      </div>`;
  }

  // Turning-like: turning, boring, threading, grooving, reaming, other
  return `
    ${invPicker}
    <div class="field" style="grid-column:1/-1">
      <label for="sf-insert">Insert (Brand \xb7 Grade \xb7 Geometry)</label>
      <input id="sf-insert" list="dl-desigs" autocomplete="off" placeholder="e.g. TOOLFLUX TF425P CNMG120408" ${inp('insertDesig','')}>
      <datalist id="dl-desigs"></datalist>
      <div class="hint">Brand, grade, geometry — used to compare cost per piece across brands.</div>
    </div>
    <div class="field">
      <label for="sf-holder">Tool Holder</label>
      <input id="sf-holder" list="dl-holders" autocomplete="off" placeholder="e.g. PCLNR 2525M-12" ${inp('toolHolder','')}>
      <datalist id="dl-holders"></datalist>
      <div class="hint">Holder designation — for reference only.</div>
    </div>
    <div class="field">
      <label for="sf-cost">Cost per Insert (&#8377;) <span class="req">*</span></label>
      <input id="sf-cost" type="number" inputmode="decimal" min="0" step="0.01" ${inp('insertCostPer','')} placeholder="0.00">
      <div class="hint">Price of one insert (1 insert per tool for turning)</div>
    </div>
    <div class="field">
      <label for="sf-corners">Corners per Insert</label>
      <input id="sf-corners" type="number" inputmode="numeric" min="1" max="16" ${inp('cuttingCornersPerInsert',4)}>
      <div class="hint">Indexable edges before this insert is scrapped</div>
    </div>`;
}

function updateSetCostHint() {
  const qty  = parseInt(($('#sf-qty')  || {}).value) || 0;
  const cost = parseFloat(($('#sf-cost') || {}).value) || 0;
  const hint = $('#sf-cost-hint');
  if (!hint) return;
  hint.textContent = (qty && cost)
    ? `${qty} inserts \xd7 ₹${cost} = ₹${(qty * cost).toFixed(2)} per full set`
    : 'Qty \xd7 this price = full set replacement cost';
}

function buildAddStationForm(job) {
  const defaultOp = 'turning';
  return `
    <div class="panel-hd">
      <span class="lbl">Add a tool to the plan</span>
      <div class="hr"></div>
    </div>
    <div class="panel-bd">
      <form id="sf-form" onsubmit="submitAddStation(event,'${job.id}')">
        <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:.6rem">
          <div class="field">
            <label for="sf-name">Tool name <span class="req">*</span></label>
            <input id="sf-name" list="dl-stnames" autocomplete="off" placeholder="e.g. OD Turning" required>
            <datalist id="dl-stnames"></datalist>
          </div>
          <div class="field">
            <label for="sf-op">Operation</label>
            <select id="sf-op" onchange="updateStationForm()">${opSelectOptions(defaultOp)}</select>
          </div>
          <div class="field">
            <label for="sf-mach">Machine</label>
            <input id="sf-mach" list="dl-machs" autocomplete="off" placeholder="VMC-01" value="${esc(db.settings.defaultMachine||'')}">
            <datalist id="dl-machs"></datalist>
          </div>
        </div>
        <div id="sf-var" class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:.3rem">
          ${buildStationFields(defaultOp, null)}
        </div>
        <div style="display:flex;gap:1rem;align-items:center;margin-top:.6rem;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.78rem;cursor:pointer">
            <input type="checkbox" id="sf-load-now">
            <span id="sf-load-now-lbl">Already loaded in the machine</span>
          </label>
          <div class="field" style="margin:0;min-width:160px">
            <label for="sf-loaded-by" style="margin-bottom:.2rem">Loaded by</label>
            <input id="sf-loaded-by" list="dl-ops" autocomplete="off" placeholder="Operator" value="${esc(db.settings.defaultOperator||'')}">
          </div>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.85rem;flex-wrap:wrap">
          <button type="submit" class="btn btn-pri">Add to the plan</button>
          <button type="button" class="btn btn-ghost" onclick="toggleAddStation()">Cancel</button>
        </div>
      </form>
    </div>`;
}

function buildEditStationForm(job, st) {
  return `
    <div class="panel-hd">
      <span class="lbl">Edit this tool</span>
      <div class="hr"></div>
      <span class="muted small">${esc(st.name)}</span>
    </div>
    <div class="panel-bd">
      <form id="sf-form" onsubmit="submitEditStation(event,'${job.id}','${st.id}')">
        <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:.6rem">
          <div class="field">
            <label for="sf-name">Tool name <span class="req">*</span></label>
            <input id="sf-name" list="dl-stnames" autocomplete="off" value="${esc(st.name)}" required>
            <datalist id="dl-stnames"></datalist>
          </div>
          <div class="field">
            <label for="sf-op">Operation</label>
            <select id="sf-op" onchange="updateStationForm()">${opSelectOptions(st.opType)}</select>
          </div>
          <div class="field">
            <label for="sf-mach">Machine</label>
            <input id="sf-mach" list="dl-machs" autocomplete="off" value="${esc(st.machine||'')}">
            <datalist id="dl-machs"></datalist>
          </div>
        </div>
        <div id="sf-var" class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:.3rem">
          ${buildStationFields(st.opType, st)}
        </div>
        <div class="hint" style="color:var(--mut);font-size:.75rem;margin:.4rem 0 .7rem">
          Changes apply going forward. Existing corner records are preserved.
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button type="submit" class="btn btn-pri">Save Changes</button>
          <button type="button" class="btn btn-ghost" onclick="toggleEditStation()">Cancel</button>
        </div>
      </form>
    </div>`;
}

function updateStationForm() {
  const opSel = $('#sf-op');
  if (!opSel) return;
  const op = opSel.value;
  const cat = toolCategory(op);
  const varDiv = $('#sf-var');
  if (varDiv) {
    varDiv.innerHTML = buildStationFields(op, null);
    datalist('dl-desigs', 'insertDesigs');
    datalist('dl-holders', 'toolHolders');
  }
  const lbl = $('#sf-load-now-lbl');
  if (lbl) {
    lbl.textContent = 'Already loaded in the machine';
  }
}

function vStationDetail() {
  const job = db.jobs.find(j => j.id === ui.jobId);
  if (!job) { navigate('jobs'); return ''; }
  const st = jobAllStations(job).find(s => s.id === ui.stationId);
  if (!st) { navigate('job', { jobId: job.id }); return ''; }

  const sc = calcStation(st);
  const cat = toolCategory(st.opType);
  const solid = cat === 'solid';
  const owner = isOwner();
  setTabs(`
    <button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button>
    <button class="tab" onclick="navigate('job',{jobId:'${job.id}'})">${esc(job.componentCode)}</button>
    <button class="tab" aria-selected="true">${esc(st.name)}</button>`);
  setBarCrumb(`${job.componentCode} / ${st.name}`, true);

  const spec = [];
  if (st.machine) spec.push(esc(st.machine));
  if (cat === 'milling' && st.cutterDiameter) spec.push(`\xf8${st.cutterDiameter} mm cutter`);
  if (st.insertDesig) spec.push(esc(st.insertDesig) + (cat === 'milling' && sc.insertsInCutter > 1 ? ` × ${sc.insertsInCutter}` : ''));
  if (st.toolHolder) spec.push(esc(st.toolHolder));
  ui._sub = `${opLabel(st.opType)} on ${job.componentCode}${spec.length ? ' · ' + spec.join(' · ').replace(/&amp;/g, '&') : ''}`;

  // ── now: the tool in the machine ──
  const usual = sc.avgCornerLife ? Math.round(sc.avgCornerLife) : null;
  let nowTitle, nowMsg, nowCls = '';
  if (!sc.sets.length) {
    nowTitle = solid ? 'No tool loaded yet' : 'No inserts loaded yet';
    nowMsg = 'Load the first one and its life is tracked from the next entry.';
  } else if (!sc.activeSet) {
    nowTitle = solid ? 'The tool is worn out' : 'This set is used up';
    nowMsg = solid ? 'Load a new tool to carry on.' : 'Load a new set of inserts to carry on.'; nowCls = 'warn';
  } else {
    nowTitle = solid ? `Tool ${sc.currentSetNum}` : `Corner ${sc.currentCornerNum} of ${sc.totalCorners}, set ${sc.currentSetNum}`;
    if (sc.lifeStatus === 'overdue') { nowCls = 'bad'; nowMsg = `${fmtN(sc.currentCornerPcs)} pieces made — past the usual ${fmtN(usual)}. ${solid ? 'Replace it' : 'Index it'} when the machine stops.`; }
    else if (sc.pcsRemainingOnCorner != null) { nowCls = sc.lifeStatus === 'warn' ? 'warn' : ''; nowMsg = `${fmtN(sc.currentCornerPcs)} pieces made. About ${fmtN(sc.pcsRemainingOnCorner)} left before the usual ${fmtN(usual)}.`; }
    else nowMsg = `${fmtN(sc.currentCornerPcs)} pieces made. The usual life shows once ${solid ? 'a tool has' : 'a corner has'} been used up.`;
  }
  const lifePct = sc.activeSet && sc.cornerLifePct != null ? Math.min(100, sc.cornerLifePct) : null;
  const acts = [];
  if (owner && !isReadOnly()) {
    if (sc.activeSet && !solid) acts.push(`<button class="btn btn-pri" onclick="quickIndexCorner('${job.id}','${st.id}')">Index to the next corner</button>`);
    acts.push(sc.activeSet
      ? `<button class="btn btn-ghost" onclick="loadNewSet('${job.id}','${st.id}')">${solid ? 'Replace the tool' : 'Replace the inserts'}</button>`
      : `<button class="btn btn-pri" onclick="loadFirstSet('${job.id}','${st.id}')">${solid ? 'Load a tool' : 'Load inserts'}</button>`);
  }
  if (!isReadOnly()) acts.push(`<button class="btn btn-ghost" onclick="quickLog('${job.id}')">+ Log production</button>`);
  const nowHtml = `
    <div class="panel st-now ${nowCls}">
      <div class="st-now-top">
        ${cornerDial(st, 84, 9)}
        <div class="st-now-txt">
          <h2>${esc(nowTitle)}</h2>
          <p>${esc(nowMsg)}</p>
        </div>
      </div>
      ${lifePct != null ? `<div class="track st-life" role="img" aria-label="${lifePct}% of the usual life used"><i style="width:${lifePct}%"></i></div>
      <div class="track-l"><span>0</span><span>Usual life ${fmtN(usual)} pcs</span></div>` : ''}
      ${acts.length ? `<div class="st-now-acts">${acts.join('')}</div>` : ''}
    </div>`;

  // ── history: every set, each corner a bar against the usual life ──
  const longest = Math.max(1, usual || 0, ...sc.sets.flatMap(s => (s.corners || []).map(c => c.componentsMade || 0)));
  const setsHtml = !sc.sets.length ? '' : [...sc.sets].reverse().map((set, ri) => {
    const si = sc.sets.length - ri;
    const corners = set.corners || [];
    const totalPcs = corners.reduce((s, c) => s + (c.componentsMade || 0), 0);
    const cpc = totalPcs > 0 && sc.setCost > 0 ? sc.setCost / totalPcs : null;
    const state = set.status === 'active' ? '<span class="pill run">In the machine</span>'
      : set.status === 'broken' ? '<span class="flag bad">Broke</span>' : '<span class="pill done">Used up</span>';
    const rows = corners.map(c => {
      const made = c.componentsMade || 0;
      const early = usual && c.status === 'broken' && made < usual * 0.55;
      const verdict = c.status === 'active' ? 'Cutting now'
        : c.status === 'broken' ? (early ? 'Broke early' : 'Broke')
        : `Used${c.endedAt ? ', ' + fmtDate(c.endedAt) : ''}`;
      const cls = c.status === 'active' ? 'cur' : c.status === 'broken' ? 'brk' : 'done';
      return `
        <div class="cr-row">
          <span class="cr-name">${solid ? 'Life' : 'Corner ' + c.num}</span>
          <div class="cr-bar"><i class="${cls}" style="width:${Math.max(made > 0 ? 2 : 0, made / longest * 100).toFixed(1)}%"></i>${usual ? `<em style="left:${(usual / longest * 100).toFixed(1)}%"></em>` : ''}</div>
          <span class="cr-n">${fmtN(made)} pcs</span>
          <span class="cr-v ${c.status === 'broken' ? 'bad' : ''}">${esc(verdict)}</span>
        </div>`;
    }).join('');
    return `
      <div class="set-card">
        <div class="set-top">
          <b>${solid ? 'Tool' : 'Set'} ${si}</b> ${state}
          <span class="set-meta">Loaded ${fmtDate(set.loadedAt)}${set.loadedBy ? ' by ' + esc(set.loadedBy) : ''}</span>
          <span class="set-sum">${fmtN(totalPcs)} pcs${owner && cpc != null ? ` · ${fmtRs(cpc, 2)} a piece` : ''}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');
  const histHtml = sc.sets.length ? `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">${solid ? 'Every tool used here' : 'Every set, corner by corner'}</span><div class="hr"></div>${usual ? `<span class="lbl muted">The mark on each bar is the usual life, ${fmtN(usual)} pcs</span>` : ''}</div>
      <div class="set-list">${setsHtml}</div>
    </div>` : '';

  // ── rail: the tool in numbers, and what it is ──
  const inv = st.inventoryItemId ? (db.inventory || []).find(i => i.id === st.inventoryItemId) : null;
  const low = inv && (inv.qtyInStock || 0) <= stationLoadNeed(st);
  const kv = (label, small, val, cls) => `<div class="kv-row"><span>${label}${small ? `<small>${small}</small>` : ''}</span><b class="${cls || ''}">${val}</b></div>`;
  const railHtml = `
    <aside class="job-rail">
      <div class="panel kv">
        <div class="panel-hd"><span class="lbl">This tool in numbers</span><div class="hr"></div></div>
        ${owner ? kv('Cost per piece so far', solid ? 'Tool cost ÷ pieces made' : 'Counts the corners started so far', sc.provisionalCpc != null ? fmtRs(sc.provisionalCpc, 2) : 'Not yet') : ''}
        ${owner ? kv('Cost per piece, finished', solid ? 'From tools fully worn out' : 'From sets fully used up', sc.confirmedCpc != null ? fmtRs(sc.confirmedCpc, 2) : 'Not yet') : ''}
        ${kv('Pieces made', solid ? 'On every tool used here' : 'On every set used here', fmtN(sc.totalComponents))}
        ${kv(solid ? 'Usual tool life' : 'Usual corner life', 'Average of those already used', usual ? fmtN(usual) + ' pcs' : 'Not yet')}
        ${kv(solid ? 'Tools used' : 'Sets used', owner && sc.setCost > 0 ? `${fmtRs(sc.setCost, 0)} each` : '', fmtN(sc.sets.length))}
        ${sc.anomalies.length ? kv('Failed early', 'Broke well before the usual life', fmtN(sc.anomalies.length), 'bad-c') : ''}
        ${inv ? kv('In stock', esc(inv.designation), fmtN(inv.qtyInStock || 0), low ? 'bad-c' : '') : ''}
      </div>
      ${owner ? `<div class="st-rail-acts">
        <button class="btn btn-ghost" onclick="toggleEditStation()">${ui.editStationOpen ? 'Close editing' : 'Edit this station'}</button>
        <button class="btn btn-bad" onclick="confirmDeleteStation('${job.id}','${st.id}')">Delete this station</button>
      </div>` : ''}
    </aside>`;

  return `
    <div class="job-grid">
      <div class="job-main">
        ${nowHtml}
        ${ui.editStationOpen && owner ? `<div class="panel">${buildEditStationForm(job, st)}</div>` : ''}
        ${histHtml}
      </div>
      ${railHtml}
    </div>`;
}

function vReport() {
  const job = db.jobs.find(j => j.id === ui.jobId);
  if (!job) { navigate('jobs'); return ''; }

  const jc = calcJob(job);
  const tabHtml = `
    <button class="tab" onclick="navigate('job',{jobId:'${job.id}'})">&#8592; ${esc(job.componentCode)}</button>
    <button class="tab" aria-selected="true">Report</button>
  `;
  setTabs(tabHtml);
  setBarCrumb(`Report: ${job.componentCode}`, true);

  const log = job.productionLog || [];
  const dateRange = log.length > 0
    ? `${fmtDate(log[0].timestamp)} – ${fmtDate(log[log.length-1].timestamp)}`
    : 'No production logged';
  const operators = [...new Set(log.map(e => e.operator).filter(Boolean))].join(', ') || '—';
  const machines  = [...new Set(log.map(e => e.machine).filter(Boolean))].join(', ') || '—';

  const stationRows = jobAllStations(job).map(st => {
    const sc = calcStation(st);
    const anomalyNote = sc.anomalies.map(a =>
      `C${a.cornerNum} Set${a.setNum}: ${a.pcs}pc (avg ${a.avgLife})`
    ).join('; ');
    const cpcDisplay = sc.confirmedCpc != null
      ? fmtRs(sc.confirmedCpc,2)
      : (sc.provisionalCpc != null ? fmtRs(sc.provisionalCpc,2)+'*' : '—');
    return `
      <tr${sc.anomalies.length ? ' class="flag"' : ''}>
        <td>${esc(st.name)}<br><span style="font-size:7pt;color:#555">${opLabel(st.opType)}</span></td>
        <td class="n">${sc.sets.length}</td>
        <td class="n">${fmtRs(sc.setCost,0)}</td>
        <td class="n">${sc.avgCornerLife != null ? fmtN(sc.avgCornerLife,0) : '—'}</td>
        <td class="n">${fmtN(sc.totalComponents)}</td>
        <td class="n">${cpcDisplay}</td>
        <td>${sc.anomalies.length ? `<b style="color:#a00">${sc.anomalies.length}</b>` : 'OK'}</td>
        <td style="font-size:7pt">${esc(anomalyNote) || '—'}</td>
      </tr>`;
  }).join('');

  const logRows = log.slice().reverse().slice(0, 50).map(e => {
    const evText = (e.events||[]).map(ev => {
      const st = jobAllStations(job).find(s => s.id === ev.stationId);
      return `${st?st.name:'?'}: ${ev.eventType.replace(/_/g,' ')}`;
    }).join('; ');
    return `
      <tr>
        <td>${fmtDate(e.timestamp)}</td>
        <td>${esc(e.operator||'—')}</td>
        <td>${esc(e.machine||'—')}</td>
        <td class="n">${fmtN(e.qty)}</td>
        <td class="n">${e.cycleTimeMins > 0 ? fmtN(e.cycleTimeMins,1)+' min' : '—'}</td>
        <td>${esc(evText)||'—'}</td>
      </tr>`;
  }).join('');

  const reportId = `RPT-${job.componentCode}-${new Date().toISOString().slice(0,10)}`;

  const reportHtml = `
    <div class="report" id="report-inner">
      <div class="rpt-hd">
        <div class="rpt-hd-info">
          <div class="co">TOOLFLUX${db.settings.company ? ' — ' + db.settings.company : ''}</div>
          <div class="meta">Machining Efficiency Report &middot; ${fmtDT(new Date().toISOString())}</div>
        </div>
        <div class="rpt-hd-right">
          <div class="title">Production Report</div>
          <div class="sub">${esc(reportId)}</div>
        </div>
      </div>
      <div class="rpt-band" style="border-top:1px solid #333;margin-top:0">
        <div><div class="k">Component</div><div class="v">${esc(job.componentCode)}</div></div>
        <div><div class="k">Description</div><div class="v">${esc(job.componentDesc||'—')}</div></div>
        <div><div class="k">Pieces made</div><div class="v">${fmtN(jc.finalProduced)}</div></div>
        <div><div class="k">Date Range</div><div class="v">${esc(dateRange)}</div></div>
      </div>
      <div class="rpt-band" style="border-top:0;margin-bottom:3.5mm">
        <div><div class="k">Operator(s)</div><div class="v">${esc(operators)}</div></div>
        <div><div class="k">Machine(s)</div><div class="v">${esc(machines)}</div></div>
        <div><div class="k">Total Insert Cost</div><div class="v">${fmtRs(jc.totalInsertCost,0)}</div></div>
        <div><div class="k">Tooling per piece</div><div class="v">${jc.totalCpc != null ? fmtRs(jc.totalCpc,2) : '—'}</div></div>
      </div>

      <div class="rpt-sec">
        <div class="rpt-sec-hd"><span class="s">Inserts used, tool by tool</span><div class="r"></div></div>
        <table class="rt">
          <thead><tr>
            <th>Station</th><th>Sets Used</th><th>Set Cost</th><th>Avg Corner Life</th>
            <th>Total Pcs</th><th>CPC</th><th>Status</th><th>Anomaly Notes</th>
          </tr></thead>
          <tbody>${stationRows}</tbody>
          <tfoot><tr class="sub">
            <td><b>TOTAL</b></td>
            <td></td>
            <td class="n"><b>${fmtRs(jc.totalInsertCost,0)}</b></td>
            <td></td>
            <td class="n"><b>${fmtN(jc.finalProduced)}</b></td>
            <td class="n"><b>${jc.totalCpc != null ? fmtRs(jc.totalCpc,2) : '—'}</b></td>
            <td colspan="2"></td>
          </tr></tfoot>
        </table>
        <div style="font-size:6pt;color:#666;margin-top:1mm">* So far — the set in the machine is not used up yet; the figure is confirmed when it is replaced.</div>
      </div>

      ${jc.totalAnomalies ? `
      <div class="rpt-sec">
        <div class="rpt-sec-hd"><span class="s">Insert Anomalies</span><div class="r"></div></div>
        ${jobAllStations(job).flatMap(st => {
          const sc = calcStation(st);
          return sc.anomalies.map(a => `
            <div style="padding:1.5mm 2mm;background:#fff0ee;border:1px solid #c00;border-radius:1px;margin-bottom:1.5mm;font-size:7.5pt">
              <b>Early replacement — ${esc(st.name)}</b>: Set ${a.setNum}, Corner ${a.cornerNum} had only ${a.pcs} pcs before change (historical avg: ${a.avgLife} pcs). Possible insert break or premature replacement.
            </div>`);
        }).join('')}
      </div>` : ''}

      <div class="rpt-sec">
        <div class="rpt-sec-hd"><span class="s">Production Log${log.length > 50 ? ' (last 50 entries)' : ''}</span><div class="r"></div></div>
        <table class="rt">
          <thead><tr><th>Date</th><th>Operator</th><th>Machine</th><th>Qty</th><th>Cycle Time</th><th>Tooling Events</th></tr></thead>
          <tbody>${logRows}</tbody>
        </table>
      </div>

      <div class="rpt-foot">
        <div class="rpt-gen">Generated by TOOLFLUX Machining Log &middot; ${fmtDT(new Date().toISOString())}</div>
        <div class="rpt-sign">Reviewed By</div>
      </div>
    </div>`;

  return `
    <div style="display:flex;gap:.55rem;margin-bottom:.85rem;flex-wrap:wrap">
      <button class="btn btn-pri" onclick="printReport()">Print / Save PDF</button>
      <button class="btn btn-ghost" onclick="navigate('job',{jobId:'${job.id}'})">&#8592; Back to Job</button>
    </div>
    ${reportHtml}`;
}

function vPaywall() {
  setTabs('');
  setBarCrumb('', false);
  const expired = getLicenseStatus() === 'expired';
  // A stored license that failed validation or lapsed: guide re-verification,
  // never alarm. All app data stays intact — activation simply refreshes it.
  const licensed = getLicenseStatus() === 'licensed';
  const hadLicense = !licensed && !!(db.settings.license && db.settings.license.token);
  const title   = licensed ? 'Change your plan'
    : hadLicense ? 'License verification required'
    : expired ? 'Your free trial has ended' : 'Subscribe to TOOLFLUX';
  const subtext = licensed
    ? 'Plans differ only in how many operator phones can sync. Your current plan is cancelled automatically when the new one starts.'
    : hadLicense
    ? 'Your license needs a quick re-verification. Enter your subscription email below — your data is untouched.'
    : expired
    ? 'Activate a subscription to keep tracking production and tooling cost per piece.'
    : 'Unlock unlimited access. Your data stays on your device, always offline.';
  const cur = licensed ? getTier() : null;
  if (!TIERS[ui.pwTier]) ui.pwTier = cur || nextTierFor((db.settings.operators || []).length);
  const sel = ui.pwTier;
  const tierCards = TIER_ORDER.map(t => {
    const T = TIERS[t];
    const dev = T.devices === Infinity ? 'Unlimited operator phones' : `${T.devices} operator phone${T.devices === 1 ? '' : 's'}`;
    return `<button type="button" class="tier-opt${t === sel ? ' sel' : ''}" data-tier="${t}" onclick="pwSelectTier('${t}')" aria-pressed="${t === sel}">
      <span class="tier-name">${T.name}${t === cur ? ' <em>· current</em>' : ''}</span>
      <span class="tier-price">${tierPrice(t)}<small>/mo</small></span>
      <span class="tier-dev">${dev}</span>
    </button>`;
  }).join('');
  return `
    <div class="paywall-wrap">
      <div class="paywall-card">
        
        <div class="paywall-title">${esc(title)}</div>
        <p class="paywall-sub">${esc(subtext)}</p>
        <div class="tier-opts" role="group" aria-label="Choose a plan">${tierCards}</div>
        <div class="tier-note">Every plan includes every feature.</div>
        <div class="sub-benefits" style="margin-top:1.2rem">
          <div class="sub-benefit">Unlimited jobs and tooling stations</div>
          <div class="sub-benefit">Insert lifecycle tracking per corner</div>
          <div class="sub-benefit">Cost per component analytics</div>
          <div class="sub-benefit">Auto sync to Google Sheets</div>
          <div class="sub-benefit">Works fully offline, no cloud lock-in</div>
        </div>
        <div style="margin-top:1.3rem;text-align:left">
          <label class="paywall-activate-label" for="pw-email">Your email — used for billing and to unlock the app</label>
          <input id="pw-email" type="email" placeholder="you@workshop.com" style="width:100%;margin-top:.4rem" autocomplete="email" value="${esc(db.settings.email||'')}">
        </div>
        <button id="pw-sub-btn" class="btn btn-pri paywall-sub-btn" onclick="startSubscription()">${subscribeLabel(sel)}</button>
        <div class="paywall-activate">
          <div class="paywall-activate-label">Already paid? Unlock this device with the same email</div>
          <div style="margin-top:.5rem">
            <button id="pw-activate-btn" class="btn btn-ghost" style="width:100%" onclick="activateLicense()">Activate my subscription</button>
          </div>
        </div>
        ${!expired ? `<div style="margin-top:1.2rem;text-align:center"><button class="btn btn-ghost" onclick="navigate('jobs')">Back to the app</button></div>` : ''}
      </div>
    </div>`;
}

// Patch the DOM instead of re-rendering, so a half-typed email isn't lost
function pwSelectTier(t) {
  if (!TIERS[t]) return;
  ui.pwTier = t;
  document.querySelectorAll('.tier-opt').forEach(el => {
    const on = el.dataset.tier === t;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-pressed', String(on));
  });
  const btn = document.getElementById('pw-sub-btn');
  if (btn) btn.textContent = subscribeLabel(t);
}

function vSetup() {
  setTabs('');
  setBarCrumb('', false);
  return `
    <div class="setup-split">
      <div class="setup-brand">
        <div class="setup-wordmark"><svg width="44" height="44" viewBox="0 0 72 72" aria-hidden="true"><clipPath id="ml-a"><path d="M-4 -4H50L24 76H-4Z"/></clipPath><clipPath id="ml-b"><path d="M50 -4H76V76H24Z"/></clipPath><g clip-path="url(#ml-a)"><path d="M28.51 11.15L29.39 3.34L38.61 3.34L39.49 11.15A23.5 23.5 0 0 1 46.28 13.96L46.28 13.96L52.42 9.06L58.94 15.58L54.04 21.72A23.5 23.5 0 0 1 56.85 28.51L56.85 28.51L64.66 29.39L64.66 38.61L56.85 39.49A23.5 23.5 0 0 1 54.04 46.28L54.04 46.28L58.94 52.42L52.42 58.94L46.28 54.04A23.5 23.5 0 0 1 39.49 56.85L39.49 56.85L38.61 64.66L29.39 64.66L28.51 56.85A23.5 23.5 0 0 1 21.72 54.04L21.72 54.04L15.58 58.94L9.06 52.42L13.96 46.28A23.5 23.5 0 0 1 11.15 39.49L11.15 39.49L3.34 38.61L3.34 29.39L11.15 28.51A23.5 23.5 0 0 1 13.96 21.72L13.96 21.72L9.06 15.58L15.58 9.06L21.72 13.96A23.5 23.5 0 0 1 28.51 11.15Z" fill="#012B42"/></g><g clip-path="url(#ml-b)"><path d="M32.51 15.15L33.39 7.34L42.61 7.34L43.49 15.15A23.5 23.5 0 0 1 50.28 17.96L50.28 17.96L56.42 13.06L62.94 19.58L58.04 25.72A23.5 23.5 0 0 1 60.85 32.51L60.85 32.51L68.66 33.39L68.66 42.61L60.85 43.49A23.5 23.5 0 0 1 58.04 50.28L58.04 50.28L62.94 56.42L56.42 62.94L50.28 58.04A23.5 23.5 0 0 1 43.49 60.85L43.49 60.85L42.61 68.66L33.39 68.66L32.51 60.85A23.5 23.5 0 0 1 25.72 58.04L25.72 58.04L19.58 62.94L13.06 56.42L17.96 50.28A23.5 23.5 0 0 1 15.15 43.49L15.15 43.49L7.34 42.61L7.34 33.39L15.15 32.51A23.5 23.5 0 0 1 17.96 25.72L17.96 25.72L13.06 19.58L19.58 13.06L25.72 17.96A23.5 23.5 0 0 1 32.51 15.15Z" fill="#0097B2"/></g><circle cx="36" cy="36" r="17.5" fill="var(--mark-ground, #fff)"/><g transform="translate(36.6 36) skewX(-12)" fill="none" stroke-width="5.2" stroke-linejoin="miter" stroke-miterlimit="6"><path d="M-9 9.5V-9.5L0.4 4.5" stroke="#012B42"/><path d="M0.4 4.5L9 -9.5V9.5" stroke="#0097B2"/></g></svg><span>MACH<b>LOG</b></span></div>
        <div class="setup-product-tag">The machining log by TOOLFLUX</div>
        <div class="setup-divider"></div>
        <ol class="setup-specs">
          <li class="setup-spec">
            <span class="setup-spec-n">01</span>
            <div>
              <div class="setup-spec-lbl">Every insert, corner by corner</div>
              <div class="setup-spec-desc">Each index and each replacement is logged with the time and the operator.</div>
            </div>
          </li>
          <li class="setup-spec">
            <span class="setup-spec-n">02</span>
            <div>
              <div class="setup-spec-lbl">Tooling cost per piece</div>
              <div class="setup-spec-desc">What the inserts cost you on every good piece, for each tool on each job.</div>
            </div>
          </li>
          <li class="setup-spec">
            <span class="setup-spec-n">03</span>
            <div>
              <div class="setup-spec-lbl">Early failures caught</div>
              <div class="setup-spec-desc">An insert that breaks well before its usual life is flagged the same day.</div>
            </div>
          </li>
        </ol>
        <div class="setup-trial-badge">14-day free trial &middot; No card required</div>
        <div class="rood-line">A product of <span class="rood" role="img" aria-label="ROOD Dynamics"></span></div>
      </div>
      <div class="setup-form-side">
        <div class="setup-form-inner">
          <h1 class="setup-form-hd">Set up your workshop</h1>
          <p class="setup-form-sub">Two questions. Free for 14 days, no card needed.</p>
          <form id="setup-form" onsubmit="submitSetup(event)">
            <div class="field">
              <label for="setup-co">Workshop name <span class="req">*</span></label>
              <input id="setup-co" placeholder="e.g. Sharma Engineering Works" required autocomplete="organization">
            </div>
            <div class="field">
              <label for="setup-op">Your name</label>
              <input id="setup-op" placeholder="e.g. Raj" autocomplete="given-name">
            </div>
            <button type="submit" class="btn btn-pri btn-lg setup-submit">Continue &#8594;</button>
            <div class="setup-pin-note">Next you set up your first job. You add operators and an owner PIN later, when you need them.</div>
          </form>
        </div>
      </div>
    </div>`;
}

// ── First job (first run) ─────────────────────────────────────────
// A new owner's home until a job exists: one part, the tool cutting it,
// and optionally the pieces made so far — one screen instead of three.
function ownerHome() {
  if (isOperatorDevice()) return 'jobs';
  if (!db.settings.company) return 'setup';
  return (db.jobs || []).length ? 'dash' : 'start';
}

// Builds a job with one operation, one station with inserts loaded, and an
// optional first batch. Returns the job, or null when code or cost is missing.
function createFirstJob(f) {
  const code = String(f.code || '').trim().toUpperCase();
  const cost = parseFloat(f.cost) || 0;
  if (!code || cost <= 0) return null;
  const opType = OP_MAP[f.opType] ? f.opType : 'turning';
  const cat = toolCategory(opType);
  const corners = cat === 'solid' ? 1 : Math.max(1, parseInt(f.corners) || 4);
  const inCutter = cat === 'milling' ? Math.max(1, parseInt(f.inCutter) || 1) : 1;
  const operator = String(f.operator || db.settings.defaultOperator || '').trim();
  const machine = String(f.machine || '').trim();
  const now = isoNow();
  const opId = uid();
  const job = {
    id: uid(), componentCode: code, componentDesc: '', customer: String(f.customer || '').trim(),
    createdBy: operator, notes: '', createdAt: now, status: 'active',
    operations: [{ id: opId, name: 'Op-1', sequence: 1, stations: [{
      id: uid(), name: String(f.name || '').trim() || opLabel(opType), opType, machine,
      insertGrade: '', insertBrand: '', insertDesig: String(f.insert || '').trim(), toolHolder: '',
      insertsInCutter: inCutter, cuttingCornersPerInsert: corners, insertCostPer: cost,
      cutterDiameter: null, inventoryItemId: null,
      insertSets: [{ id: uid(), loadedAt: now, loadedBy: operator, status: 'active',
        corners: [{ num: 1, startedAt: now, endedAt: null, componentsMade: 0, status: 'active' }] }],
    }] }],
    productionLog: [],
  };
  db.jobs.push(job);
  const qty = Math.min(9999, Math.max(0, parseInt(f.firstQty) || 0));
  if (qty > 0) {
    applyProductionEntry(job, { id: uid(), timestamp: now, operationId: opId, operator, machine,
      cycleTimeMins: 0, qty, qtyGood: qty, rejections: [], notes: '', events: [], by: operator });
  }
  addHistory('componentCodes', code);
  addHistory('customers', job.customer);
  addHistory('insertDesigs', job.operations[0].stations[0].insertDesig);
  addHistory('machines', machine);
  if (machine) db.settings.defaultMachine = machine;
  saveDB();
  return job;
}

function startOpChanged() {
  const cat = toolCategory(($('#fs-op') || {}).value);
  const corners = $('#fs-corners-f'), cutter = $('#fs-incutter-f');
  if (corners) corners.style.display = cat === 'solid' ? 'none' : '';
  if (cutter) cutter.style.display = cat === 'milling' ? '' : 'none';
  const lbl = $('#fs-cost-lbl');
  if (lbl) lbl.textContent = cat === 'solid' ? 'Cost of the tool (₹)' : 'Cost of one insert (₹)';
}

function vStart() {
  setTabs('');
  setBarCrumb('First job', true);
  const who = esc(db.settings.defaultOperator || '');
  return `
    <div class="start-wrap">
      <h1 class="start-h">Set up your first job</h1>
      <p class="start-sub">One part and the tool cutting it. You can add more tools to it later.</p>
      <form id="start-form" class="start-form" onsubmit="submitStart(event)" novalidate>
        <fieldset class="start-sec">
          <legend>The part</legend>
          <div class="field">
            <label for="fs-code">Part or drawing number <span class="req">*</span></label>
            <input id="fs-code" list="dl-codes" placeholder="e.g. FLG-2210" autocapitalize="characters" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="fs-cust">Customer or PO <span class="opt">optional</span></label>
            <input id="fs-cust" list="dl-custs" placeholder="e.g. Kirloskar PO 4471" autocomplete="off">
          </div>
        </fieldset>
        <fieldset class="start-sec">
          <legend>The tool cutting it</legend>
          <div class="field">
            <label for="fs-op">Operation</label>
            <select id="fs-op" onchange="startOpChanged()">${opSelectOptions('turning')}</select>
          </div>
          <div class="field">
            <label for="fs-insert">Insert <span class="opt">optional</span></label>
            <input id="fs-insert" list="dl-desigs" placeholder="e.g. CNMG 120408 TFX-P25" autocomplete="off">
          </div>
          <div class="start-row">
            <div class="field">
              <label for="fs-cost" id="fs-cost-lbl">Cost of one insert (₹)</label>
              <input id="fs-cost" type="number" inputmode="decimal" min="1" step="any" placeholder="e.g. 420" required>
            </div>
            <div class="field" id="fs-corners-f">
              <label for="fs-corners">Corners per insert</label>
              <input id="fs-corners" type="number" inputmode="numeric" min="1" max="20" value="4">
            </div>
          </div>
          <div class="field" id="fs-incutter-f" style="display:none">
            <label for="fs-incutter">Inserts in the cutter</label>
            <input id="fs-incutter" type="number" inputmode="numeric" min="1" max="40" value="1">
          </div>
          <div class="field">
            <label for="fs-mach">Machine <span class="opt">optional</span></label>
            <input id="fs-mach" list="dl-machs" placeholder="e.g. LT-01" value="${esc(db.settings.defaultMachine || '')}" autocomplete="off">
          </div>
        </fieldset>
        <fieldset class="start-sec">
          <legend>Pieces made so far <span class="opt">optional</span></legend>
          <div class="field">
            <label for="fs-qty">Good pieces off this tool today</label>
            <input id="fs-qty" type="number" inputmode="numeric" min="0" max="9999" placeholder="0">
          </div>
          <input id="fs-who" type="hidden" value="${who}">
        </fieldset>
        <div id="fs-err" class="start-err" role="alert"></div>
        <button type="submit" class="btn btn-pri btn-lg start-go">Start tracking &#8594;</button>
        <button type="button" class="start-skip" onclick="skipStart()">Skip for now — look around first</button>
      </form>
    </div>`;
}

function submitStart(e) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const v = id => (($('#' + id) || {}).value || '');
  const err = $('#fs-err');
  if (!v('fs-code').trim()) { if (err) err.textContent = 'Enter the part or drawing number.'; $('#fs-code').focus(); return; }
  if (!(parseFloat(v('fs-cost')) > 0)) { if (err) err.textContent = 'Enter what one insert costs — cost per piece is worked out from it.'; $('#fs-cost').focus(); return; }
  const job = createFirstJob({
    code: v('fs-code'), customer: v('fs-cust'), opType: v('fs-op'), insert: v('fs-insert'),
    cost: v('fs-cost'), corners: v('fs-corners'), inCutter: v('fs-incutter'), machine: v('fs-mach'),
    firstQty: v('fs-qty'), operator: v('fs-who'),
  });
  if (!job) return;
  syncNow();
  toast(`${job.componentCode} is being tracked`, 'ok');
  navigate('job', { jobId: job.id });
}

function skipStart() { ui.skipStart = true; navigate('jobs'); }

// ── Inventory ─────────────────────────────────────────────────────
const INV_CATS = [
  { id: 'turning_insert', label: 'Turning Inserts' },
  { id: 'milling_insert', label: 'Milling Inserts' },
  { id: 'drill',          label: 'Drills' },
  { id: 'endmill',        label: 'End Mills' },
  { id: 'holder',         label: 'Tool Holders' },
  { id: 'adaptor',        label: 'Adaptors' },
  { id: 'other',          label: 'Other' },
];

function invCatLabel(id) { return (INV_CATS.find(c => c.id === id) || { label: id }).label; }

// Pieces of each inventory item loaded onto machines in the last `days` days.
// Counts every insert set (or solid tool) loaded on a station linked to the item.
function invUsage(days) {
  const since = Date.now() - days * 86400000;
  const used = {};
  (db.jobs || []).forEach(j => jobAllStations(j).forEach(st => {
    if (!st.inventoryItemId) return;
    const per = stationLoadNeed(st);
    (st.insertSets || []).forEach(set => {
      if (Date.parse(set.loadedAt) >= since) used[st.inventoryItemId] = (used[st.inventoryItemId] || 0) + per;
    });
  }));
  return used;
}

// What one load of each linked item needs — the least stock that keeps a machine running.
function invLinkedNeed() {
  const need = {};
  (db.jobs || []).forEach(j => { if ((j.status || 'active') === 'complete') return; jobAllStations(j).forEach(st => {
    if (st.inventoryItemId) need[st.inventoryItemId] = Math.max(need[st.inventoryItemId] || 0, stationLoadNeed(st));
  }); });
  return need;
}

// Stock position of one item: why it needs buying (if it does) and how many.
function invPosition(item, used, need) {
  const qty = item.qtyInStock || 0;
  const min = Number(item.minQty) || 0;
  const u = used[item.id] || 0;
  const n = need[item.id] || 0;
  const daysLeft = u > 0 ? Math.floor(qty / (u / 30)) : null;
  let why = '';
  if (qty <= 0) why = 'Out of stock';
  else if (min > 0 && qty <= min) why = `At reorder level (${min})`;
  else if (n > 0 && qty <= n) why = 'Only one load left';
  else if (daysLeft != null && daysLeft < 14) why = `About ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  let suggest = 0;
  if (why) {
    suggest = Math.max(1, Math.max(u, min * 2, n) - qty);
    if (/_insert$/.test(item.category)) suggest = Math.ceil(suggest / 10) * 10; // inserts come in boxes of 10
  }
  return { qty, min, used: u, need: n, daysLeft, why, suggest, out: qty <= 0 };
}

function invToBuy() {
  const used = invUsage(30), need = invLinkedNeed();
  return (db.inventory || [])
    .map(item => ({ item, p: invPosition(item, used, need) }))
    .filter(x => x.p.why)
    .sort((a, b) => (b.p.out - a.p.out) || ((a.p.daysLeft ?? 999) - (b.p.daysLeft ?? 999)));
}

// Plain text for a supplier: what and how many. No prices, no stock value.
function buildPurchaseText() {
  const list = invToBuy();
  const lines = list.map((x, i) => {
    const extra = [x.item.manufacturer, x.item.grade].filter(Boolean).join(' · ');
    return `${i + 1}. ${x.item.designation}${extra ? ' (' + extra + ')' : ''} — ${x.p.suggest} nos`;
  });
  return `*Purchase list — ${db.settings.company || 'Workshop'}*\n${fmtDate(isoNow())}\n\n${lines.join('\n')}\n\nPlease confirm price and delivery.`;
}

function sendPurchaseList() {
  if (!invToBuy().length) { toast('Nothing to buy right now'); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(buildPurchaseText()), '_blank');
}

function copyPurchaseList() {
  if (!invToBuy().length) { toast('Nothing to buy right now'); return; }
  const text = buildPurchaseText();
  const done = () => toast('Purchase list copied', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}

function vInventory() {
  const tabHtml = `
    <button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button>
    <button class="tab" aria-selected="true">Inventory</button>
    <button class="tab" onclick="navigate('settings')" style="margin-left:auto">Settings</button>`;
  setTabs(tabHtml);
  setBarCrumb('Inventory');

  const items = db.inventory || [];
  const used = invUsage(30), need = invLinkedNeed();
  const pos = {};
  items.forEach(i => { pos[i.id] = invPosition(i, used, need); });
  const byCat = {};
  INV_CATS.forEach(c => { byCat[c.id] = []; });
  // anything saved under an unknown category still shows, under Other
  items.forEach(item => { (byCat[item.category] || byCat.other).push(item); });

  const totalValue = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qtyInStock || 0), 0);
  const buy = invToBuy();
  const buyValue = buy.reduce((s, x) => s + (x.item.unitPrice || 0) * x.p.suggest, 0);
  const spend30 = items.reduce((s, i) => s + (i.unitPrice || 0) * (used[i.id] || 0), 0);

  const buyHtml = !items.length ? '' : buy.length ? `
    <div class="panel buy-panel">
      <div class="panel-hd"><span class="lbl">To buy</span><div class="hr"></div><span class="lbl muted">${buy.length} item${buy.length === 1 ? '' : 's'}${buyValue > 0 ? ' · about ' + fmtRs(buyValue, 0) : ''}</span></div>
      ${buy.map(x => `
        <div class="buy-row">
          <div class="buy-main">
            <div class="buy-name">${esc(x.item.designation)}</div>
            <div class="buy-why"><span class="flag ${x.p.out ? 'bad' : 'warn'}">${esc(x.p.why)}</span> ${x.p.qty} in stock${x.p.used ? ` · ${x.p.used} used in 30 days` : ''}</div>
          </div>
          <div class="buy-qty"><span class="buy-n">${x.p.suggest}</span><span class="buy-l">order</span></div>
        </div>`).join('')}
      <div class="buy-acts">
        <button class="btn btn-wa" onclick="sendPurchaseList()">Send list on WhatsApp</button>
        <button class="btn btn-ghost" onclick="copyPurchaseList()">Copy list</button>
      </div>
      <div class="buy-note">Order quantity covers about 30 days at the current rate of use; inserts are rounded up to boxes of 10. The message carries items and quantities only — no prices.</div>
    </div>` : `
    <div class="panel"><div class="buy-clear">Nothing to buy — every item is above its reorder level.</div></div>`;

  const catSections = INV_CATS.map(cat => {
    const catItems = byCat[cat.id] || [];
    if (!catItems.length) return '';
    const rows = catItems.map(item => {
      const p = pos[item.id];
      const sub = [item.manufacturer, item.grade].filter(Boolean).join(' · ');
      return `
      <tr>
        <td><div style="font-weight:600">${esc(item.designation)}</div>${sub ? `<div class="inv-sub">${esc(sub)}</div>` : ''}</td>
        <td class="n mono"><span class="inv-qty${p.out ? ' out' : p.why ? ' low' : ''}">${p.qty}</span>${p.out ? ' <span class="flag bad">Out</span>' : p.why ? ' <span class="flag warn">Low</span>' : ''}</td>
        <td class="n mono">${p.min > 0 ? p.min : '<span class="muted">—</span>'}</td>
        <td class="n mono">${p.used > 0 ? p.used : '<span class="muted">—</span>'}</td>
        <td class="n mono">${item.unitPrice > 0 ? fmtRs(item.unitPrice, 0) : '—'}</td>
        <td class="inv-acts"><button class="btn btn-ol btn-sm" onclick="openInvEdit('${item.id}')">Update</button></td>
      </tr>`;
    }).join('');
    return `
      <div class="panel" style="margin-bottom:.5rem">
        <div class="panel-hd">
          <span class="lbl">${cat.label}</span>
          <div class="hr"></div>
          <span class="lbl muted">${catItems.length} item${catItems.length !== 1 ? 's' : ''}</span>
        </div>
        <table class="inv-tbl">
          <thead><tr>
            <th>Item</th><th class="n">In stock</th><th class="n">Reorder at</th>
            <th class="n">Used 30 d</th><th class="n">Unit price</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const emptyState = !items.length ? `
    <div style="padding:2.5rem 1.2rem;text-align:center">
      <div style="font-size:.95rem;font-weight:700;color:var(--navy);margin-bottom:.35rem">No stock recorded yet</div>
      <div style="font-size:.82rem;color:var(--mut);margin-bottom:1.2rem;max-width:44ch;margin-left:auto;margin-right:auto;line-height:1.5">Add the inserts and tools you keep, with a reorder level. Link an item to a station and stock comes down by itself each time inserts are loaded — and this page tells you what to buy.</div>
    </div>` : '';

  return `
    <div>
      ${items.length ? `
      <div class="stat-strip panel" style="margin-bottom:.5rem">
        <div class="s-stat"><div class="lbl">Used in 30 days</div><div><span class="s-val">${fmtRs(spend30, 0)}</span></div><div class="s-sub">Loaded onto machines, at unit price</div></div>
        <div class="s-stat"><div class="lbl">Stock value</div><div><span class="s-val">${fmtRs(totalValue, 0)}</span></div><div class="s-sub">${items.length} item${items.length === 1 ? '' : 's'} at purchase price</div></div>
      </div>` : ''}
      ${buyHtml}
      ${emptyState}
      ${catSections}
      ${buildInvAddForm()}
      ${buildInvPasteImport()}
    </div>`;
}

// One sheet for everything a purchase entry needs: stock received, a new
// price, the reorder level, or a corrected count after a physical check.
function openInvEdit(id) {
  if (!requireOwner()) return;
  const item = (db.inventory || []).find(i => i.id === id);
  if (!item) return;
  openSheet(item.designation, `
    <form class="inv-edit" onsubmit="saveInvEdit(event,'${item.id}')">
      <div class="inv-edit-now">In stock now <b>${item.qtyInStock || 0}</b></div>
      <div class="field">
        <label for="ie-recv">Received now</label>
        <input id="ie-recv" type="number" inputmode="numeric" min="0" placeholder="e.g. 10">
        <div class="hint">Added to the stock above.</div>
      </div>
      <div class="start-row">
        <div class="field">
          <label for="ie-price">Unit price (₹)</label>
          <input id="ie-price" type="number" inputmode="decimal" min="0" step="0.01" value="${item.unitPrice || ''}">
        </div>
        <div class="field">
          <label for="ie-min">Reorder at</label>
          <input id="ie-min" type="number" inputmode="numeric" min="0" value="${item.minQty || ''}" placeholder="e.g. 10">
        </div>
      </div>
      <div class="field">
        <label for="ie-set">Counted stock <span class="opt">— only to correct a wrong count</span></label>
        <input id="ie-set" type="number" inputmode="numeric" min="0" placeholder="${item.qtyInStock || 0}">
      </div>
      <button type="submit" class="btn btn-pri btn-lg" style="width:100%;margin-top:.4rem">Save</button>
      <button type="button" class="start-skip" onclick="deleteInventoryItem('${item.id}')">Remove this item</button>
    </form>`);
}

function saveInvEdit(e, id) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const item = (db.inventory || []).find(i => i.id === id);
  if (!item) return;
  const num = sel => { const v = ($(sel) || {}).value; return v === '' || v == null ? null : Math.max(0, parseFloat(v) || 0); };
  const recv = num('#ie-recv'), price = num('#ie-price'), min = num('#ie-min'), set = num('#ie-set');
  let qty = item.qtyInStock || 0;
  if (set != null) qty = Math.round(set);
  if (recv) qty += Math.round(recv);
  item.qtyInStock = qty;
  if (price != null) item.unitPrice = price;
  item.minQty = min ? Math.round(min) : 0;
  if (recv) item.lastReceivedAt = isoNow();
  saveDB();
  closeSheet();
  toast(recv ? `${Math.round(recv)} received — ${item.designation} now ${qty}` : `${item.designation} updated`, 'ok');
  render();
}

function buildInvAddForm() {
  return `
    <details class="panel fold" style="margin-bottom:.5rem"${(db.inventory || []).length ? "" : " open"}>
      <summary class="panel-hd"><span class="lbl">+ Add item</span><div class="hr"></div></summary>
      <form onsubmit="submitAddInventory(event)" style="padding:.5rem">
        <div class="fgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin-bottom:.6rem">
          <div class="field" style="margin:0">
            <label>Category <span class="req">*</span></label>
            <select id="inv-cat" required>
              ${INV_CATS.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>Designation <span class="req">*</span></label>
            <input id="inv-desig" placeholder="e.g. CNMG120408-M" required>
          </div>
          <div class="field" style="margin:0">
            <label>Brand / Manufacturer</label>
            <input id="inv-brand" placeholder="e.g. Sandvik">
          </div>
          <div class="field" style="margin:0">
            <label>Grade</label>
            <input id="inv-grade" placeholder="e.g. GC4335">
          </div>
          <div class="field" style="margin:0">
            <label>Unit Price (₹)</label>
            <input id="inv-price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0">
          </div>
          <div class="field" style="margin:0">
            <label>Qty in Stock</label>
            <input id="inv-qty" type="number" inputmode="numeric" min="0" placeholder="0">
          </div>
          <div class="field" style="margin:0">
            <label>Reorder at <span class="opt">(optional)</span></label>
            <input id="inv-min" type="number" inputmode="numeric" min="0" placeholder="e.g. 10">
          </div>
        </div>
        <button type="submit" class="btn btn-pri">Add to inventory</button>
      </form>
    </details>`;
}

function buildInvPasteImport() {
  return `
    <details class="panel fold" style="margin-bottom:.5rem">
      <summary class="panel-hd">
        <span class="lbl">+ Import from Excel</span>
        <div class="hr"></div>
        <span class="lbl muted">Paste from clipboard</span>
      </summary>
      <div style="padding:.5rem">
        <div style="font-size:.75rem;color:var(--mut);margin-bottom:.5rem">
          Copy a table from Excel with headers like: <strong>Category, Designation/Product, Brand/Manufacturer, Grade, Price/Cost/Rate, Qty/Stock</strong> — then paste below.
        </div>
        <textarea id="inv-paste" rows="4" style="width:100%;font-family:var(--mono);font-size:.75rem;resize:vertical;border:1px solid var(--rule);border-radius:var(--r);padding:.5rem;background:var(--off)" placeholder="Paste Excel table here…"></textarea>
        <div style="display:flex;gap:.5rem;margin-top:.5rem;align-items:center">
          <button class="btn btn-teal" onclick="importInvPaste()">Import</button>
          <span id="inv-import-msg" style="font-size:.75rem;color:var(--mut)"></span>
        </div>
      </div>
    </details>`;
}

function submitAddInventory(e) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const desig = ($('#inv-desig') || {}).value.trim();
  if (!desig) return;
  const item = {
    id: uid(),
    category: ($('#inv-cat') || {}).value || 'other',
    designation: desig,
    manufacturer: (($('#inv-brand') || {}).value || '').trim(),
    grade: (($('#inv-grade') || {}).value || '').trim(),
    unitPrice: parseFloat(($('#inv-price') || {}).value) || 0,
    qtyInStock: parseInt(($('#inv-qty') || {}).value) || 0,
    minQty: Math.max(0, parseInt(($('#inv-min') || {}).value) || 0),
    createdAt: isoNow(),
  };
  db.inventory.push(item);
  saveDB();
  toast(`${desig} added to inventory`, 'ok');
  render();
}

function deleteInventoryItem(id) {
  if (!requireOwner() || !requireActive()) return;
  if (!confirm('Remove this item from inventory?')) return;
  db.inventory = db.inventory.filter(i => i.id !== id);
  closeSheet();
  saveDB();
  toast('Item removed');
  render();
}

function importInvPaste() {
  if (!requireOwner() || !requireActive()) return;
  const raw = ($('#inv-paste') || {}).value || '';
  if (!raw.trim()) { toast('Nothing to import', 'bad'); return; }
  const lines = raw.trim().split('\n').map(l => l.split('\t'));
  if (lines.length < 2) { toast('Need at least 2 rows (header + data)', 'bad'); return; }
  const headers = lines[0].map(h => h.trim().toLowerCase());
  const col = (keywords) => { const idx = headers.findIndex(h => keywords.some(k => h.includes(k))); return idx; };
  const cCat   = col(['category','cat','type']);
  const cDesig = col(['designation','product','item','desc','name','part']);
  const cBrand = col(['brand','manufacturer','make','supplier','vendor']);
  const cGrade = col(['grade']);
  const cPrice = col(['price','cost','rate','value','unit']);
  const cQty   = col(['qty','quantity','stock','balance','count']);
  if (cDesig < 0) { toast('Could not find Designation column', 'bad'); return; }

  const catMap = {
    'turning': 'turning_insert', 'milling': 'milling_insert', 'drill': 'drill',
    'endmill': 'endmill', 'end mill': 'endmill', 'holder': 'holder', 'adaptor': 'adaptor',
  };
  function guessCategory(str) {
    if (!str) return 'other';
    const s = str.toLowerCase();
    for (const [k, v] of Object.entries(catMap)) { if (s.includes(k)) return v; }
    return 'other';
  }

  let added = 0;
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const desig = (row[cDesig] || '').trim();
    if (!desig) continue;
    const rawCat = cCat >= 0 ? (row[cCat] || '') : '';
    db.inventory.push({
      id: uid(),
      category: guessCategory(rawCat) || 'other',
      designation: desig,
      manufacturer: cBrand >= 0 ? (row[cBrand] || '').trim() : '',
      grade: cGrade >= 0 ? (row[cGrade] || '').trim() : '',
      unitPrice: cPrice >= 0 ? (parseFloat(row[cPrice]) || 0) : 0,
      qtyInStock: cQty >= 0 ? (parseInt(row[cQty]) || 0) : 0,
      createdAt: isoNow(),
    });
    added++;
  }
  if (added > 0) { saveDB(); toast(`${added} items imported`, 'ok'); render(); }
  else toast('No valid rows found', 'bad');
}

function vSettings() {
  setTabs(`<button class="tab" onclick="navigate('jobs')">&#8592; Jobs</button><button class="tab" aria-selected="true">Settings</button>`);
  setBarCrumb('Settings', false);
  const s = db.settings;
  setTimeout(buildDataLists, 0);
  return `
    <div class="panel">
      <div class="panel-hd"><span class="lbl">General</span><div class="hr"></div></div>
      <div class="panel-bd">
        <form id="settings-form" onsubmit="submitSettings(event)">
          <div class="fgrid">
            <div class="field">
              <label for="st-co">Company Name</label>
              <input id="st-co" value="${esc(s.company||'')}">
            </div>
            <div class="field">
              <label for="st-op">Default Operator</label>
              <input id="st-op" value="${esc(s.defaultOperator||'')}" list="dl-ops-st" autocomplete="off">
              <datalist id="dl-ops-st"></datalist>
            </div>
            <div class="field">
              <label for="st-mach">Default Machine</label>
              <input id="st-mach" value="${esc(s.defaultMachine||'')}" list="dl-machs-st" autocomplete="off">
              <datalist id="dl-machs-st"></datalist>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label for="st-rej">Rejection reasons <span class="opt">— one per line, shown as buttons in the log form</span></label>
              <textarea id="st-rej" rows="5">${esc((s.rejectionReasons || REJECTION_REASONS).join(String.fromCharCode(10)))}</textarea>
            </div>
          </div>
          <div style="margin-top:1rem">
            <button type="submit" class="btn btn-pri">Save</button>
          </div>
        </form>
      </div>
    </div>
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Owner PIN</span><div class="hr"></div></div>
      <div class="panel-bd">
        <div style="font-size:.75rem;color:var(--mut);margin-bottom:.65rem;line-height:1.55">${hasOwnerPin()
          ? 'PIN is set. The app opens in Operator Mode — costs, reports, settings and history editing need this PIN. Owner Mode locks automatically after 15 minutes of inactivity.'
          : 'No PIN set — the app currently opens with full access. Set a PIN to enable restricted Operator Mode for the shop floor.'}</div>
        <button class="btn btn-ghost" onclick="openPinSetup()">${hasOwnerPin() ? 'Change Owner PIN' : 'Set Owner PIN'}</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-hd" id="team"><span class="lbl">Operators (Team)</span><div class="hr"></div><span class="lbl muted">${(db.settings.operators||[]).length}</span></div>
      <div class="panel-bd">
        <div style="font-size:.75rem;color:var(--mut);margin-bottom:.75rem;line-height:1.55">Add an operator, then send them their link on WhatsApp. They open it on their phone and it launches straight into the shop-floor screen — locked to Operator Mode, no PIN, no setup.</div>
        ${canAddOperator() ? `
        <form onsubmit="submitAddOperator(event)" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.85rem">
          <input id="team-op-name" placeholder="Operator name (e.g. Ravi)" autocomplete="off" style="flex:1;min-width:160px">
          <button type="submit" class="btn btn-pri">+ Add operator</button>
        </form>` : `
        <div class="tier-full">
          <span>Your <strong>${esc(TIERS[getTier()].name)}</strong> plan includes ${getDeviceLimit()} operator phone${getDeviceLimit() === 1 ? '' : 's'}.</span>
          <button class="btn btn-teal btn-sm" onclick="navigate('paywall')">Upgrade</button>
        </div>`}
        ${(db.settings.operators||[]).length ? `
        <div class="team-list">
          ${db.settings.operators.map(o => `
            <div class="team-row">
              <div class="team-name">${esc(o.name)}</div>
              <button class="btn btn-teal btn-sm" onclick="copyInvite('${o.id}')">Copy link</button>
              <button class="btn btn-ghost btn-sm" onclick="shareInvite('${o.id}')">Send</button>
              <button class="btn-icon-sm" onclick="removeOperator('${o.id}')" title="Remove">Remove</button>
            </div>`).join('')}
        </div>
        <div style="font-size:.75rem;color:var(--mut);margin-top:.7rem;line-height:1.5">The operator app is a live window into this shop. Full two-way syncing is rolling out — your device stays the master.</div>
        ` : ''}
      </div>
    </div>
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Help</span><div class="hr"></div></div>
      <div class="panel-bd">
        <div style="font-size:.75rem;color:var(--mut);margin-bottom:.65rem;line-height:1.55">A one-minute walkthrough: planning a job, logging, tool changes, the Overview, buying and shift proof.</div>
        <button class="btn btn-ghost" onclick="replayTutorial()">Replay tutorial</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-hd"><span class="lbl">Data Export</span><div class="hr"></div></div>
      <div class="panel-bd">
        <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:.65rem">
          <button class="btn btn-pri" onclick="exportToExcel()">&#8595; Export to Excel (.xls)</button>
          <button class="btn btn-ghost" onclick="exportData()">&#8595; Backup JSON</button>
          <button class="btn btn-ghost" onclick="importData()">&#8593; Restore JSON</button>
        </div>
        <div class="hint">Export to Excel: a 4-sheet workbook — jobs, production log, cost per piece by tool, early failures. Opens in Excel or LibreOffice. Works offline.</div>
      </div>
      <div class="panel-hd" style="margin-top:.5rem"><span class="lbl" style="color:var(--bad)">Danger Zone</span><div class="hr"></div></div>
      <div class="panel-bd">
        <button class="btn btn-bad" onclick="confirmClearAll()">Clear all data</button>
      </div>
    </div>
    <p class="made-by">Machlog is made by <span class="rood" role="img" aria-label="ROOD Dynamics"></span>, the technology branch of TOOLFLUX.</p>`;
}

// ── Phone navigation ──────────────────────────────────────────────
// Phones get a bottom bar of the few places people actually go; the top strip
// keeps only the current screen's own tabs (the job filters, a back link).
function bottomNavItems() {
  if (isOperatorDevice()) return [
    { key: 'jobs', label: 'Jobs', go: "navigate('jobs')" },
    { key: 'log', label: 'Log', go: 'openLogSheet()' },
    { key: 'shift', label: 'Shift proof', go: "navigate('shift')" },
  ];
  return [
    { key: 'jobs', label: 'Jobs', go: "navigate('jobs')" },
    { key: 'log', label: 'Log', go: 'openLogSheet()' },
    { key: 'dash', label: 'Overview', go: "navigate('dash')" },
    { key: 'team', label: 'Team', go: 'openTeam()' },
    { key: 'more', label: 'More', go: 'openMoreSheet()' },
  ];
}

function bottomNavKey() {
  const v = ui.view;
  if (v === 'jobs' || v === 'job' || v === 'station' || v === 'newjob') return 'jobs';
  if (v === 'dash') return 'dash';
  if (v === 'shift') return isOperatorDevice() ? 'shift' : 'more';
  if (v === 'settings' && ui.teamFocus) return 'team';
  return 'more';
}

function renderBottomNav() {
  if (window.__pendingNudge && ui.view !== 'setup' && ui.view !== 'start') {
    const k = window.__pendingNudge; window.__pendingNudge = null;
    setTimeout(() => showInstallNudge(k), 1200);
  }
  const el = document.getElementById('bnav');
  if (!el) return;
  const hide = ui.view === 'setup' || ui.view === 'start' || ui.view === 'paywall';
  el.hidden = hide;
  document.body.classList.toggle('has-bnav', !hide);
  if (hide) { el.innerHTML = ''; return; }
  const cur = bottomNavKey();
  el.innerHTML = bottomNavItems().map(i =>
    `<button type="button" class="bnav-i${i.key === 'log' ? ' log' : ''}" onclick="${i.go}"${i.key === cur ? ' aria-current="page"' : ''}>${navIcon(i.key)}<span>${esc(i.label)}</span></button>`
  ).join('');
}

// Jobs someone can log against right now, most recently worked first.
function logTargets() {
  const last = j => {
    const log = j.productionLog || [];
    const t = log.length ? Date.parse(log[log.length - 1].timestamp) : 0;
    return Math.max(t || 0, Date.parse(j.createdAt) || 0);
  };
  return (db.jobs || []).filter(j => (j.status || 'active') === 'active').sort((a, b) => last(b) - last(a));
}

function openLogSheet() {
  const jobs = logTargets();
  if (!jobs.length) {
    toast(isOperatorDevice() ? 'No active jobs yet — ask the owner to add one' : 'No active jobs — add one first', 'warn');
    if (!isOperatorDevice()) navigate(ownerHome() === 'start' ? 'start' : 'newjob');
    return;
  }
  if (jobs.length === 1) { navigate('job', { jobId: jobs[0].id, logOpen: true }); focusQtyMobile(); return; }
  openSheet('Log production for', jobs.map(j => `
    <button type="button" class="sheet-i" onclick="closeSheet();navigate('job',{jobId:'${j.id}',logOpen:true});focusQtyMobile()">
      <span class="sheet-i-t">${esc(j.componentCode)}</span>
      <span class="sheet-i-s">${esc([j.componentDesc, j.customer].filter(Boolean).join(' · ') || 'Active job')}</span>
    </button>`).join(''));
}

function openTeam() {
  if (!isOwner()) { openPinDialog(() => openTeam()); return; }
  ui.teamFocus = true;
  navigate('settings');
  setTimeout(() => { const t = document.getElementById('team'); if (t) t.scrollIntoView({ block: 'start' }); }, 30);
}

function openMoreSheet() {
  const owner = isOwner();
  const items = [
    ['Inventory', "navigate('inventory')"],
    ['Cost per piece', "ui.tab='cpc';navigate('jobs')"],
    ['Shift proof', "navigate('shift')"],
    ['Settings', "ui.teamFocus=false;navigate('settings')"],
    ['Plan & billing', "navigate('paywall')"],
  ];
  if (owner && hasOwnerPin()) items.push(['Lock — switch to Operator Mode', 'lockOwner()']);
  openSheet('More', items.map(([t, go]) =>
    `<button type="button" class="sheet-i" onclick="closeSheet();${go}"><span class="sheet-i-t">${t}</span></button>`).join(''));
}

function openSheet(title, body) {
  closeSheet();
  const o = document.createElement('div');
  o.id = 'sheet';
  o.className = 'sheet-overlay';
  o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-hd"><span>${esc(title)}</span><button type="button" class="sheet-x" onclick="closeSheet()" aria-label="Close">Close</button></div>
      <div class="sheet-bd">${body}</div>
    </div>`;
  o.addEventListener('click', e => { if (e.target === o) closeSheet(); });
  document.body.appendChild(o);
  const first = o.querySelector('.sheet-i');
  if (first) first.focus();
}

function closeSheet() { const o = document.getElementById('sheet'); if (o) o.remove(); }

// The on-screen keyboard pushes a fixed bottom bar up over the field being
// typed in; hide the bar while a field has focus.
document.addEventListener('focusin', e => {
  if (e.target && e.target.matches && e.target.matches('input, textarea, select')) document.body.classList.add('typing');
});
document.addEventListener('focusout', () => document.body.classList.remove('typing'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ── Operators need an owner PIN first ────────────────────────────
// The PIN is asked for when the first operator is added: that is when there
// is someone on the shop floor to keep costs and editing away from.
function needsPinForOperator() { return !isOperatorDevice() && !hasOwnerPin(); }

// ── render ─────────────────────────────────────────────────────────
// ── shell ──────────────────────────────────────────────────────────
// The sidebar (wide screens) and the screen's title are drawn from one place,
// so every view names itself the same way.
const NAV_ICONS = {
  dash: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',
  jobs: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  inventory: '<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>',
  cpc: '<path d="M4 12V5h7l9 9-7 7z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  shift: '<path d="M7 3h8l4 4v14H7zM10 12h6M10 16h6"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.2a3.2 3.2 0 010 5.6M21 20c0-2.6-1.4-4.7-3.6-5.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  plan: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};
const navIcon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[k] || ''}</svg>`;
const VIEW_TITLES = { dash: 'Overview', jobs: 'Jobs', newjob: 'New job', inventory: 'Inventory', settings: 'Settings', shift: 'Shift proof', report: 'Report', paywall: 'Plan & billing' };

function navKey() {
  const v = ui.view;
  if (v === 'jobs' && ui.tab === 'cpc') return 'cpc';
  if (v === 'jobs' || v === 'job' || v === 'station' || v === 'newjob' || v === 'report') return 'jobs';
  if (v === 'settings') return ui.teamFocus ? 'team' : 'settings';
  if (v === 'paywall') return 'plan';
  return v;
}

function sideNavItems() {
  if (isOperatorDevice()) return [
    { key: 'jobs', label: 'Jobs', go: "navigate('jobs')" },
    { key: 'shift', label: 'Shift proof', go: "navigate('shift')" },
  ];
  const toBuy = isOwner() ? invToBuy().length : 0;
  return [
    { key: 'dash', label: 'Overview', go: "navigate('dash')" },
    { key: 'jobs', label: 'Jobs', go: "ui.tab='active';navigate('jobs')" },
    { key: 'inventory', label: 'Inventory', go: "navigate('inventory')", badge: toBuy ? toBuy + ' to buy' : '' },
    { key: 'cpc', label: 'Cost per piece', go: "setJobFilter('cpc');if(ui.tab==='cpc')navigate('jobs')" },
    { key: 'shift', label: 'Shift proof', go: "navigate('shift')" },
    { group: 'Workshop' },
    { key: 'team', label: 'Team', go: 'openTeam()' },
    { key: 'settings', label: 'Settings', go: "ui.teamFocus=false;navigate('settings')" },
    { key: 'plan', label: 'Plan & billing', go: "navigate('paywall')" },
  ];
}

function renderShell() {
  document.body.dataset.view = ui.view;
  const job = ui.jobId ? (db.jobs || []).find(j => j.id === ui.jobId) : null;
  let title = VIEW_TITLES[ui.view] || 'Jobs';
  if (ui.view === 'jobs' && ui.tab === 'cpc' && isOwner()) title = 'Cost per piece';
  if (ui.view === 'job' && job) title = job.componentCode;
  if (ui.view === 'station' && job) { const st = jobAllStations(job).find(s => s.id === ui.stationId); title = st ? st.name : job.componentCode; }
  if (ui.view === 'report' && job) title = job.componentCode + ' report';
  if (ui.view === 'settings' && ui.teamFocus) title = 'Team';
  const h = $('#page-title'), sub = $('#page-sub'), shop = $('#brand-shop'), nav = $('#side-nav');
  if (h) h.textContent = title;
  if (sub) sub.textContent = ui._sub || '';
  const acts = $('#page-acts');
  if (acts) acts.innerHTML = ui._acts || '';
  if (shop) shop.textContent = db.settings.company || 'by TOOLFLUX';
  document.title = title + ' — Machlog';
  if (!nav) return;
  const cur = navKey();
  nav.innerHTML = sideNavItems().map(i => i.group
    ? `<div class="nav-grp">${esc(i.group)}</div>`
    : `<button type="button" class="nav-i" onclick="${i.go}"${i.key === cur ? ' aria-current="page"' : ''}>${navIcon(i.key)}<span>${esc(i.label)}</span>${i.badge ? `<span class="nav-n">${esc(i.badge)}</span>` : ''}</button>`
  ).join('');
}

function setTabs(html) {
  const el = $('#tabs');
  if (el) el.innerHTML = html;
}

function setBarCrumb(text, show) {
  const el = $('#bar-crumb');
  if (!el) return;
  if (show && text) { el.style.display = ''; el.textContent = text; }
  else el.style.display = 'none';
}

function buildDataLists() {
  const dlMap = {
    'dl-ops':       'operators',
    'dl-ops-lp':    'operators',
    'dl-ops-st':    'operators',
    'dl-machs':     'machines',
    'dl-machs-lp':  'machines',
    'dl-machs-st':  'machines',
    'dl-codes':     'componentCodes',
    'dl-descs':     'componentDescs',
    'dl-custs':     'customers',
    'dl-desigs':    'insertDesigs',
    'dl-grades':    'insertGrades',
    'dl-brands':    'insertBrands',
    'dl-holders':   'toolHolders',
    'dl-stnames':   'stationNames',
  };
  Object.entries(dlMap).forEach(([id, key]) => datalist(id, key));
}

function render() {
  const view = $('#view');
  if (!view) return;

  // Keep trial bar in sync
  const trialBarEl = $('#trial-bar');
  if (trialBarEl) trialBarEl.innerHTML = trialBanner();

  let html = '';
  ui._sub = ''; ui._acts = '';
  try {
    // A lapsed subscription no longer walls off the app — the shop keeps
    // reading its data and the paywall is only shown when explicitly opened.
    const showPaywall = ui.view === 'paywall' && !isOperatorDevice();

    // An owner with no jobs yet gets the first-job screen instead of an empty
    // dashboard — unless they chose to look around first.
    if ((ui.view === 'dash' || ui.view === 'jobs') && !isOperatorDevice() && isOwner()
        && db.settings.company && !(db.jobs || []).length && !ui.skipStart) ui.view = 'start';

    if (ui.view === 'setup')       html = vSetup();
    else if (ui.view === 'start')  html = vStart();
    else if (!isOwner() && OWNER_VIEWS.includes(ui.view)) html = vOperatorLocked(false);
    else if (showPaywall)          html = vPaywall();
    else if (ui.view === 'jobs')   html = vJobs();
    else if (ui.view === 'newjob') html = vNewJob();
    else if (ui.view === 'job')    html = vJobDetail();
    else if (ui.view === 'station')html = vStationDetail();
    else if (ui.view === 'report') html = vReport();
    else if (ui.view === 'settings')  html = vSettings();
    else if (ui.view === 'inventory') html = vInventory();
    else if (ui.view === 'dash')      html = vDashboard();
    else if (ui.view === 'shift')     html = vShiftProof();
    else html = vJobs();
  } catch(e) {
    console.error('Render error', e);
    html = `<div style="padding:2rem;color:var(--bad)">Render error: ${esc(e.message)}<br><pre style="font-size:.8rem;margin-top:.5rem">${esc(e.stack)}</pre></div>`;
  }
  view.innerHTML = html;
  renderShell();
  renderBottomNav();
  syncModeChip();
  // One-time migration prompt: existing installs get asked to create their PIN
  const needsPinPrompt = !isOperatorDevice() && ui.view !== 'setup' && db.settings.company && !hasOwnerPin() && !db.settings.pinPromptShown;
  if (needsPinPrompt && !document.getElementById('pin-modal')) {
    setTimeout(() => openPinSetup(true), 400);
  } else if (false) {
    // The 11-card walkthrough no longer opens by itself: new owners learn on
    // the first-job screen, and the tour stays one tap away in Settings.
    // First-run (or first-open-after-update) walkthrough — waits for the PIN
    // flow to resolve first so the two overlays never stack.
    window.__tutScheduled = true;
    setTimeout(() => {
      window.__tutScheduled = false;
      if (!document.getElementById('pin-modal')) startTutorial(true);
    }, 500);
  }
  setTimeout(buildDataLists, 0);
}

// ── event handlers ─────────────────────────────────────────────────
function setJobFilter(f) { if (f === 'cpc' && !requireOwner()) return; ui.tab = f; render(); }
function toggleLogForm()    { ui.logOpen = !ui.logOpen; render(); if (ui.logOpen) { revealLogForm(); focusQtyMobile(); } }

// On phones, land the cursor in the qty field the moment the form opens —
// the numeric keypad comes up and the operator types immediately. Desktop
// focus behavior is untouched.
function focusQtyMobile() {
  if (window.innerWidth > 640) return;
  setTimeout(() => { const q = document.getElementById('lp-qty'); if (q) q.focus(); }, 80);
}
function toggleAddStation() { if (!requireOwner() || !requireActive()) return; ui.addStationOpen = !ui.addStationOpen; render(); }

function adjQty(n) {
  const inp = $('#lp-qty');
  if (inp) inp.value = Math.max(1, (parseInt(inp.value)||0) + n);
}

function setJobStatus(jobId, status) {
  if (!requireOwner() || !requireActive()) { render(); return; }
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  job.status = status;
  saveDB();
  toast(`Job marked ${status}`);
}

function submitNewJob(e) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const code = $('#nj-code').value.trim();
  if (!code) { toast('Component code is required', 'bad'); return; }
  const job = {
    id: uid(),
    componentCode: code.toUpperCase(),
    componentDesc: $('#nj-desc').value.trim(),
    customer: $('#nj-cust').value.trim(),
    createdBy: $('#nj-op').value.trim(),
    notes: $('#nj-notes').value.trim(),
    batchQty: Math.max(0, parseInt(($('#nj-batch') || {}).value) || 0) || null,
    createdAt: isoNow(),
    status: 'active',
    operations: [{ id: uid(), name: 'Op-1', sequence: 1, stations: [] }],
    productionLog: [],
  };
  addHistory('componentCodes', code);
  addHistory('componentDescs', job.componentDesc);
  addHistory('customers', job.customer);
  addHistory('operators', job.createdBy);
  if (!db.settings.defaultOperator && job.createdBy) db.settings.defaultOperator = job.createdBy;
  db.jobs.push(job);
  saveDB();
  toast('Job created — now plan its operations and tools', 'ok', 3600);
  navigate('job', { jobId: job.id, plan: true });
}

function readStationFields(opType) {
  const cat = toolCategory(opType);
  const g = id => (($('#' + id) || {}).value || '');
  const invId = g('sf-inv') || null;
  if (cat === 'solid') {
    return {
      insertDesig: g('sf-tool-spec').trim(),
      insertsInCutter: 1, cuttingCornersPerInsert: 1,
      insertCostPer: parseFloat(g('sf-cost')) || 0,
      toolHolder: '', cutterDiameter: null,
      inventoryItemId: invId,
    };
  }
  if (cat === 'milling') {
    return {
      insertDesig: g('sf-insert').trim(),
      cutterDiameter: parseFloat(g('sf-diam')) || null,
      insertsInCutter: parseInt(g('sf-qty')) || 1,
      cuttingCornersPerInsert: parseInt(g('sf-corners')) || 4,
      insertCostPer: parseFloat(g('sf-cost')) || 0,
      toolHolder: '',
      inventoryItemId: invId,
    };
  }
  return {
    insertDesig: g('sf-insert').trim(),
    toolHolder: g('sf-holder').trim(),
    insertsInCutter: 1,
    cuttingCornersPerInsert: parseInt(g('sf-corners')) || 4,
    insertCostPer: parseFloat(g('sf-cost')) || 0,
    cutterDiameter: null,
    inventoryItemId: invId,
  };
}

function submitAddStation(e, jobId) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  const name = (g => g ? g.value.trim() : '')($('#sf-name'));
  if (!name) { toast('Give the tool a name', 'bad'); return; }
  const opType = ($('#sf-op') || {}).value || 'turning';
  const fields = readStationFields(opType);
  const st = {
    id: uid(), name, opType,
    machine: (($('#sf-mach') || {}).value || '').trim(),
    insertGrade: '', insertBrand: '',
    insertSets: [],
    ...fields,
  };
  const loadNow = ($('#sf-load-now') || {}).checked;
  const loadedBy = (($('#sf-loaded-by') || {}).value || '').trim();
  if (loadNow) {
    st.insertSets.push({
      id: uid(), loadedAt: isoNow(), loadedBy, status: 'active',
      corners: [{ num: 1, startedAt: isoNow(), endedAt: null, componentsMade: 0, status: 'active' }],
    });
  }
  addHistory('stationNames', name);
  addHistory('insertDesigs', st.insertDesig || '');
  addHistory('toolHolders', st.toolHolder || '');
  addHistory('machines', st.machine);
  addHistory('operators', loadedBy);
  const activeOp = getActiveOp(job);
  if (activeOp) activeOp.stations.push(st);
  saveDB();
  ui.addStationOpen = false;
  toast(`${name} added to the plan`, 'ok');
  render();
}

function submitEditStation(e, jobId, stationId) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  const st = job && jobAllStations(job).find(s => s.id === stationId);
  if (!st) return;
  const opType = ($('#sf-op') || {}).value || st.opType;
  const name = (($('#sf-name') || {}).value || '').trim() || st.name;
  st.name = name;
  st.opType = opType;
  st.machine = (($('#sf-mach') || {}).value || '').trim();
  Object.assign(st, readStationFields(opType));
  addHistory('insertDesigs', st.insertDesig || '');
  addHistory('toolHolders', st.toolHolder || '');
  saveDB();
  ui.editStationOpen = false;
  toast('Tool updated', 'ok');
  render();
}

function toggleEditStation() { if (!requireOwner() || !requireActive()) return; ui.editStationOpen = !ui.editStationOpen; render(); }

function submitLogProduction(e, jobId) {
  e.preventDefault();
  if (!requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  // The qty input's max="9999" is a UI hint only — a value set programmatically
  // or pasted can exceed it, so re-clamp here (a stray extra digit shouldn't be
  // able to distort CPC and dashboard totals with no correction path).
  const qty = Math.min(9999, Math.max(0, parseInt($('#lp-qty').value) || 0));
  if (qty < 1) { toast('Enter a quantity', 'bad'); return; }

  const opId = (($('#lp-opsel') || {}).value) || (job.operations && job.operations[0] && job.operations[0].id) || null;
  const operator = $('#lp-op').value.trim();
  const machine  = $('#lp-mach').value.trim();
  const cycleTimeMins = parseFloat((($('#lp-ct') || {}).value) || 0) || 0;
  const notes = (($('#lp-notes') || {}).value || '').trim();

  // Rejections — can never exceed the quantity just logged; a mistaken entry
  // like "999 rejected" on a 20-piece batch would otherwise show a nonsensical
  // rejection count on the dashboard and shift proof.
  const rejQtyRaw = parseInt((($('#lp-rej-qty') || {}).value) || 0) || 0;
  const rejQty = Math.min(qty, Math.max(0, rejQtyRaw));
  const rejReason = (($('#lp-rej-reason') || {}).value) || '';
  if (rejQty > 0 && !rejReason) { toast('Tap a reason for the rejected pieces', 'bad'); return; }
  const rejections = rejQty > 0 ? [{ qty: rejQty, reason: rejReason }] : [];
  const qtyGood = Math.max(0, qty - rejQty);

  const typical = typicalEntryQty(job);
  if (typical && qty > Math.max(typical * 3, typical + 50)
      && !confirm(`${qty} pieces is far more than usual for ${job.componentCode} (about ${typical} per entry).\n\nSave ${qty}?`)) return;

  const opStations = jobOpStations(job, opId);
  const events = [];
  opStations.forEach(st => {
    const sel = $(`#ev_${st.id}`);
    if (!sel || sel.disabled) return;
    const val = sel.value;
    if (val && val !== 'none') events.push({ stationId: st.id, eventType: val, timestamp: isoNow() });
  });

  const entry = { id: uid(), timestamp: isoNow(), operationId: opId, operator, machine, cycleTimeMins, qty, qtyGood, rejections, notes, events, by: db.settings.defaultOperator || operator };

  applyProductionEntry(job, entry);
  addHistory('operators', operator);
  addHistory('machines', machine);
  if (operator) db.settings.defaultOperator = operator;
  if (machine)  db.settings.defaultMachine = machine;
  saveDB();
  if (isOperatorDevice()) { operatorEnqueue(jobId, entry); operatorSyncSoon(); }
  else syncNow(); // owner: audit sync — original numbers reach the sheet immediately
  ui.logOpen = false;
  toast(`${qty} pcs saved${rejQty > 0 ? ` (${rejQty} rejected)` : ''} · ${fmtN(jobTodayQty(job, (job.operations || []).length > 1 ? opId : null))} today on ${job.componentCode}${(job.operations || []).length > 1 ? ' ' + esc(((job.operations || []).find(o => o.id === opId) || {}).name || '') : ''}`, rejQty > 0 ? 'warn' : 'ok', 3600);
  render();
}

// Deterministic, idempotent application of one production entry to a job.
// Used both when logging locally and when a device reconciles a peer's entry,
// so every device converges to the same insert state from the same events.
function applyProductionEntry(job, entry) {
  if (!job || !entry || !entry.id) return false;
  job.productionLog = job.productionLog || [];
  if (job.productionLog.some(e => e.id === entry.id)) return false; // already applied
  const qty = Number(entry.qty) || 0;
  const opStations = jobOpStations(job, entry.operationId);
  // A planned tool loaded for the first time, or after a used-up set.
  (entry.events || []).forEach(ev => {
    if (ev.eventType !== 'insert_load') return;
    const st = opStations.find(s => s.id === ev.stationId);
    if (!st) return;
    st.insertSets = st.insertSets || [];
    if (st.insertSets.some(s => s.status === 'active')) return;
    const ts = ev.timestamp || entry.timestamp || isoNow();
    consumeInventory(st, stationLoadNeed(st), false);
    st.insertSets.push({ id: uid(), loadedAt: ts, loadedBy: entry.operator || '', status: 'active',
      corners: [{ num: 1, startedAt: ts, endedAt: null, componentsMade: 0, status: 'active' }] });
  });
  opStations.forEach(st => {
    const activeSet = (st.insertSets || []).find(s => s.status === 'active');
    if (activeSet) {
      const ac = (activeSet.corners || []).find(c => c.status === 'active');
      if (ac) ac.componentsMade = (ac.componentsMade || 0) + qty;
    }
  });
  (entry.events || []).forEach(ev => {
    const st = opStations.find(s => s.id === ev.stationId);
    if (st) processStationEvent(st, ev);
  });
  job.productionLog.push(entry);
  return true;
}

function openLogEdit(jobId, entryId) {
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  const entry = (job.productionLog || []).find(e => e.id === entryId);
  if (!entry) return;

  const existing = document.getElementById('log-edit-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'log-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML = `
    <div style="background:var(--srf);border-radius:12px;padding:1.5rem;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem">
        <strong style="font-size:1rem">Edit Log Entry</strong>
        <button onclick="document.getElementById('log-edit-modal').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--mut)">Close</button>
      </div>
      <form onsubmit="saveLogEdit(event,'${jobId}','${entryId}')">
        <div class="form-row">
          <label class="lbl">Qty</label>
          <input class="inp" type="number" inputmode="numeric" id="le-qty" value="${entry.qty}" min="0" required>
        </div>
        <div class="form-row">
          <label class="lbl">Operator</label>
          <input class="inp" type="text" id="le-operator" value="${esc(entry.operator || '')}" list="dl-operators">
        </div>
        <div class="form-row">
          <label class="lbl">Machine</label>
          <input class="inp" type="text" id="le-machine" value="${esc(entry.machine || '')}" list="dl-machines">
        </div>
        <div class="form-row">
          <label class="lbl">Cycle Time (min)</label>
          <input class="inp" type="number" inputmode="decimal" id="le-cycle" value="${entry.cycleTimeMins || ''}" min="0" step="0.1">
        </div>
        <div class="form-row">
          <label class="lbl">Notes</label>
          <input class="inp" type="text" id="le-notes" value="${esc(entry.notes || '')}">
        </div>
        <div style="display:flex;gap:.75rem;margin-top:1.2rem">
          <button type="submit" class="btn btn-teal" style="flex:1">Save</button>
          <button type="button" class="btn" onclick="document.getElementById('log-edit-modal').remove()" style="flex:1">Cancel</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function saveLogEdit(e, jobId, entryId) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  const entry = (job.productionLog || []).find(en => en.id === entryId);
  if (!entry) return;

  const newQty = Math.min(9999, Math.max(0, parseInt(document.getElementById('le-qty').value) || 0));
  const diff = newQty - (entry.qty || 0);

  if (diff !== 0) {
    // Adjust the active corner on the first station that has one
    let adjusted = false;
    for (const st of jobAllStations(job)) {
      const activeSet = (st.insertSets || []).find(s => s.status === 'active');
      if (activeSet) {
        const ac = (activeSet.corners || []).find(c => c.status === 'active');
        if (ac) { ac.componentsMade = Math.max(0, (ac.componentsMade || 0) + diff); adjusted = true; break; }
      }
    }
    if (!adjusted && diff < 0) {
      // If no active corner, try to reduce from the last indexed corner
      for (const st of jobAllStations(job)) {
        const sets = (st.insertSets || []).slice().reverse();
        for (const set of sets) {
          const corners = (set.corners || []).slice().reverse();
          for (const c of corners) {
            if ((c.componentsMade || 0) > 0) { c.componentsMade = Math.max(0, c.componentsMade + diff); break; }
          }
        }
      }
    }
  }

  entry.qty          = newQty;
  entry.operator     = document.getElementById('le-operator').value.trim();
  entry.machine      = document.getElementById('le-machine').value.trim();
  entry.cycleTimeMins = parseFloat(document.getElementById('le-cycle').value) || 0;
  entry.notes        = document.getElementById('le-notes').value.trim();

  saveDB();
  syncNow(); // audit: edits reach the sheet immediately
  document.getElementById('log-edit-modal').remove();
  toast('Entry updated', 'ok');
  render();
}

// Deduct stock for a linked station when a set/tool is loaded.
// interactive=true → confirm() gate on insufficient stock (explicit load buttons);
// interactive=false → deduct + warn toast only (mid-log event processing).
// Unlinked stations and deleted inventory items pass through untouched.
function consumeInventory(st, need, interactive) {
  if (!st.inventoryItemId) return true;
  const item = (db.inventory || []).find(i => i.id === st.inventoryItemId);
  if (!item) return true;
  const have = item.qtyInStock || 0;
  if (have < need) {
    if (interactive) {
      if (!confirm(`Stock warning: only ${have} × ${item.designation} in inventory, this load needs ${need}. Load anyway?`)) return false;
    } else {
      toast(`Inventory low: ${item.designation} — needed ${need}, had ${have}`, 'warn');
    }
  }
  item.qtyInStock = Math.max(0, have - need);
  return true;
}

function stationLoadNeed(st) {
  return isSolidTool(st.opType) ? 1 : Math.max(1, Number(st.insertsInCutter) || 1);
}

function processStationEvent(st, ev) {
  const activeSet = (st.insertSets || []).find(s => s.status === 'active');
  if (!activeSet) return;
  const ac = (activeSet.corners || []).find(c => c.status === 'active');
  if (!ac) return;
  const totalCorners = Number(st.cuttingCornersPerInsert) || 1;
  const ts = ev.timestamp || isoNow();

  if (ev.eventType === 'corner_index') {
    ac.status = 'indexed';
    ac.endedAt = ts;
    const nextNum = ac.num + 1;
    if (nextNum <= totalCorners) {
      activeSet.corners.push({ num: nextNum, startedAt: ts, endedAt: null, componentsMade: 0, status: 'active' });
    } else {
      activeSet.status = 'spent';
    }
  } else if (ev.eventType === 'insert_replace' || ev.eventType === 'insert_replace_broken') {
    ac.status = ev.eventType === 'insert_replace_broken' ? 'broken' : 'indexed';
    ac.endedAt = ts;
    activeSet.status = ev.eventType === 'insert_replace_broken' ? 'broken' : 'spent';
    consumeInventory(st, stationLoadNeed(st), false);
    st.insertSets.push({
      id: uid(), loadedAt: ts, loadedBy: ev.loadedBy || '', status: 'active',
      corners: [{ num: 1, startedAt: ts, endedAt: null, componentsMade: 0, status: 'active' }],
    });
  }
}

function loadFirstSet(jobId, stationId) {
  if (!requireActive()) return;
  if (isOperatorDevice()) { toast('Record insert changes inside "+ Log production"', 'warn'); return; }
  const job = db.jobs.find(j => j.id === jobId);
  const st = job && jobAllStations(job).find(s => s.id === stationId);
  if (!st) return;
  const solid = isSolidTool(st.opType);
  if ((st.insertSets||[]).find(s => s.status === 'active')) { toast(solid ? 'A tool is already loaded' : 'A set is already active', 'bad'); return; }
  if (!consumeInventory(st, stationLoadNeed(st), true)) return;
  st.insertSets.push({
    id: uid(), loadedAt: isoNow(), loadedBy: db.settings.defaultOperator || '', status: 'active',
    corners: [{ num: 1, startedAt: isoNow(), endedAt: null, componentsMade: 0, status: 'active' }],
  });
  saveDB();
  syncNow(); // audit: insert load reaches the sheet immediately
  toast(solid ? 'Tool loaded' : 'Insert set loaded', 'ok');
  render();
}

function loadNewSet(jobId, stationId) {
  if (!requireActive()) return;
  if (isOperatorDevice()) { toast('Record insert changes inside "+ Log production"', 'warn'); return; }
  const job = db.jobs.find(j => j.id === jobId);
  const st = job && jobAllStations(job).find(s => s.id === stationId);
  if (!st) return;
  const solid = isSolidTool(st.opType);
  if (!confirm(solid ? 'Replace tool? This will log the current tool as spent.' : 'Load new insert set? This will close the current active set as spent.')) return;
  if (!consumeInventory(st, stationLoadNeed(st), true)) return;
  const activeSet = (st.insertSets || []).find(s => s.status === 'active');
  if (activeSet) {
    const ac = (activeSet.corners || []).find(c => c.status === 'active');
    if (ac) { ac.status = 'indexed'; ac.endedAt = isoNow(); }
    activeSet.status = 'spent';
  }
  st.insertSets.push({
    id: uid(), loadedAt: isoNow(), loadedBy: db.settings.defaultOperator || '', status: 'active',
    corners: [{ num: 1, startedAt: isoNow(), endedAt: null, componentsMade: 0, status: 'active' }],
  });
  saveDB();
  syncNow(); // audit: insert replacement reaches the sheet immediately
  toast(solid ? 'New tool loaded' : 'New insert set loaded', 'ok');
  render();
}

// One-tap corner index from the station screen — reuses the exact event
// processing the log-production tooling section uses.
function quickIndexCorner(jobId, stationId) {
  if (!requireActive()) return;
  if (isOperatorDevice()) { toast('Record insert changes inside "+ Log production"', 'warn'); return; }
  const job = db.jobs.find(j => j.id === jobId);
  const st = job && jobAllStations(job).find(s => s.id === stationId);
  if (!st) return;
  const sc = calcStation(st);
  if (!sc.activeSet) { toast('No active insert set', 'bad'); return; }
  if (!confirm(`Index corner on ${st.name}? Current corner closes at ${fmtN(sc.currentCornerPcs)} pcs.`)) return;
  processStationEvent(st, { stationId: st.id, eventType: 'corner_index', timestamp: isoNow() });
  saveDB();
  syncNow(); // audit: same immediate-sync path as other insert events
  toast('Corner indexed', 'ok');
  render();
}

function confirmDeleteStation(jobId, stationId) {
  if (!requireOwner() || !requireActive()) return;
  if (!confirm('Remove this tool from the plan, with all its insert history? This cannot be undone.')) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  (job.operations || []).forEach(op => { op.stations = (op.stations || []).filter(s => s.id !== stationId); });
  saveDB();
  syncNow(); // audit: deletion reaches the sheet immediately
  toast('Tool removed from the plan');
  navigate('job', { jobId, plan: true });
}

// Finish first-run setup. The owner PIN is no longer asked for here: it is
// set when the first operator is added (needsPinForOperator), which is the
// moment there is someone on the shop floor to keep costs away from.
function completeSetup({ company, owner }) {
  const co = String(company || '').trim();
  if (!co) return false;
  db.settings.company = co;
  db.settings.defaultOperator = String(owner || '').trim();
  db.settings.pinPromptShown = true; // no PIN prompt on top of the first job
  db.settings.tutorialSeen = true;   // the first-job screen teaches by doing
  if (!db.settings.trialStartedAt) db.settings.trialStartedAt = new Date().toISOString();
  addHistory('operators', db.settings.defaultOperator);
  saveDB();
  return true;
}

function submitSetup(e) {
  e.preventDefault();
  const ok = completeSetup({ company: ($('#setup-co') || {}).value, owner: ($('#setup-op') || {}).value });
  if (!ok) { toast('Enter your workshop name', 'bad'); return; }
  navigate(ownerHome());
}

// One reason per line; blanks and repeats dropped, at most 16, 40 characters each.
function parseReasons(text) {
  const seen = new Set();
  return String(text).split(/\r?\n/).map(r => r.trim().slice(0, 40))
    .filter(r => r && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase())).slice(0, 16);
}

function submitSettings(e) {
  e.preventDefault();
  if (!requireOwner() || !requireActive()) return;
  db.settings.company = $('#st-co').value.trim();
  db.settings.defaultOperator = $('#st-op').value.trim();
  db.settings.defaultMachine = $('#st-mach').value.trim();
  const reasons = parseReasons((($('#st-rej') || {}).value) || '');
  if (reasons.length) db.settings.rejectionReasons = reasons;
  addHistory('operators', db.settings.defaultOperator);
  addHistory('machines', db.settings.defaultMachine);
  saveDB();
  toast('Settings saved', 'ok');
}

function printReport() {
  if (!requireOwner()) return;
  const rptEl = $('#report-inner');
  if (!rptEl) return;
  $('#print-area').innerHTML = rptEl.outerHTML;
  window.print();
}

// On phones, downloads land in a folder most shop owners never open.
// Offer the OS share sheet (WhatsApp, Gmail, Drive…) first; fall back to a
// normal download. Desktop always downloads exactly as before.
function shareOrDownload(blob, filename, doneMsg) {
  if (window.innerWidth <= 860 && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: filename })
          .then(() => toast('Shared', 'ok'))
          .catch(err => { if (err && err.name !== 'AbortError') downloadBlob(blob, filename, doneMsg); });
        return;
      }
    } catch (e) { /* fall through to download */ }
  }
  downloadBlob(blob, filename, doneMsg);
}

function downloadBlob(blob, filename, doneMsg) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  if (doneMsg) toast(doneMsg, 'ok');
}

function exportData() {
  if (!requireOwner()) return;
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  shareOrDownload(blob, `machlog-backup-${new Date().toISOString().slice(0,10)}.json`, 'Backup saved');
}

function exportToExcel() {
  if (!requireOwner()) return;
  // SpreadsheetML — no library, works offline, opens in Excel & LibreOffice
  const xe = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Explicit ss:Type="String" already tells Excel to treat these as literal
  // text, not formulas — but a leading =/+/-/@ has caused real-world CSV
  // injection incidents in other apps' exports, so neutralize it anyway.
  const noFormula = s => /^[=+\-@]/.test(s) ? "'" + s : s;
  const sc = (v, t='String') => `<Cell><Data ss:Type="${t}">${xe(t === 'String' ? noFormula(String(v ?? '')) : v)}</Data></Cell>`;
  const nc = v => (v != null && !isNaN(v)) ? sc(Number(v).toFixed(4),'Number') : sc('');
  const hc = v => `<Cell ss:StyleID="h"><Data ss:Type="String">${xe(v)}</Data></Cell>`;
  const hr = (...vs) => '<Row>' + vs.map(hc).join('') + '</Row>';
  const row = (...cs) => '<Row>' + cs.join('') + '</Row>';

  // ── Sheet 1: Jobs Summary ──────────────────────────────────────
  let s1 = `<Worksheet ss:Name="Jobs Summary"><Table>`;
  s1 += hr('Component Code','Description','Customer','Status','Started','Pieces Made','Tooling Spend (Rs)','Tooling per Piece (Rs)','Tools','Early Failures');
  (db.jobs || []).forEach(j => {
    const jc = calcJob(j);
    s1 += row(
      sc(j.componentCode), sc(j.componentDesc||''), sc(j.customer||''),
      sc(j.status||'active'), sc(fmtDate(j.createdAt)),
      nc(jc.finalProduced), nc(jc.totalInsertCost), nc(jc.totalCpc),
      nc((j.stations||[]).length), nc(jc.totalAnomalies)
    );
  });
  s1 += '</Table></Worksheet>';

  // ── Sheet 2: Production Log ────────────────────────────────────
  let s2 = `<Worksheet ss:Name="Production Log"><Table>`;
  s2 += hr('Component Code','Description','Date','Time','Operator','Machine','Qty','Cycle Time (min)','Tooling Events','Notes');
  (db.jobs || []).forEach(j => {
    (j.productionLog || []).forEach(entry => {
      const evText = (entry.events||[]).map(ev => {
        const st = (j.stations||[]).find(s => s.id === ev.stationId);
        return `${st?st.name:'?'}: ${ev.eventType.replace(/_/g,' ')}`;
      }).join('; ');
      s2 += row(
        sc(j.componentCode), sc(j.componentDesc||''),
        sc(fmtDate(entry.timestamp)), sc(fmtTime(entry.timestamp)),
        sc(entry.operator||''), sc(entry.machine||''),
        nc(entry.qty),
        entry.cycleTimeMins > 0 ? nc(entry.cycleTimeMins) : sc(''),
        sc(evText), sc(entry.notes||'')
      );
    });
  });
  s2 += '</Table></Worksheet>';

  // ── Sheet 3: Insert CPC by Station ────────────────────────────
  let s3 = `<Worksheet ss:Name="Cost per Piece by Tool"><Table>`;
  s3 += hr('Component Code','Tool','Kind','Machine',
    'Insert Designation','Insert Grade','Insert Brand',
    'Inserts in Cutter','Corners per Insert','Cost per Insert (Rs)',
    'Set Cost (Rs)','Sets Used','Total Pcs','Avg Corner Life (pcs)',
    'Per Piece, Finished Sets (Rs)','Per Piece So Far (Rs)','Early Failures');
  (db.jobs || []).forEach(j => {
    (j.stations || []).forEach(st => {
      const sc2 = calcStation(st);
      s3 += row(
        sc(j.componentCode), sc(st.name), sc(opLabel(st.opType)), sc(st.machine||''),
        sc(st.insertDesig||''), sc(st.insertGrade||''), sc(st.insertBrand||''),
        nc(sc2.insertsInCutter), nc(sc2.cornersPerInsert), nc(sc2.costPer),
        nc(sc2.setCost), nc(sc2.sets.length), nc(sc2.totalComponents),
        sc2.avgCornerLife != null ? nc(Math.round(sc2.avgCornerLife)) : sc(''),
        sc2.confirmedCpc != null ? nc(sc2.confirmedCpc) : sc('—'),
        sc2.provisionalCpc != null ? nc(sc2.provisionalCpc) : sc(''),
        nc(sc2.anomalies.length)
      );
    });
  });
  s3 += '</Table></Worksheet>';

  // ── Sheet 4: Anomaly Log ───────────────────────────────────────
  let s4 = `<Worksheet ss:Name="Anomalies"><Table>`;
  s4 += hr('Component Code','Tool','Kind','Set #','Corner #','Pcs on Corner','Usual Corner Life (pcs)','% of Usual','Severity');
  (db.jobs || []).forEach(j => {
    (j.stations || []).forEach(st => {
      const sc2 = calcStation(st);
      sc2.anomalies.forEach(a => {
        const pct = sc2.avgCornerLife ? Math.round((a.pcs / sc2.avgCornerLife) * 100) : 0;
        const sev = pct < 30 ? 'CRITICAL' : pct < 55 ? 'WARNING' : 'NOTICE';
        s4 += row(
          sc(j.componentCode), sc(st.name), sc(opLabel(st.opType)),
          nc(a.setNum), nc(a.cornerNum), nc(a.pcs), nc(a.avgLife),
          nc(pct), sc(sev)
        );
      });
    });
  });
  s4 += '</Table></Worksheet>';

  // ── Assemble workbook ─────────────────────────────────────────
  const styles = `<Styles>
    <Style ss:ID="h">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#012B42" ss:Pattern="Solid"/>
    </Style>
  </Styles>`;

  const wb = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${styles}${s1}${s2}${s3}${s4}</Workbook>`;

  const blob = new Blob(['﻿' + wb], { type: 'application/vnd.ms-excel;charset=utf-8' });
  shareOrDownload(blob, `machlog-data-${new Date().toISOString().slice(0,10)}.xls`, 'Excel file ready');
}

function importData() {
  if (!requireOwner() || !requireActive()) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.v || !Array.isArray(imported.jobs)) { toast('Invalid format', 'bad'); return; }
        if (!confirm(`Import ${imported.jobs.length} jobs? This replaces all current data.`)) return;
        db = imported;
        if (!db.settings) db.settings = blankDB().settings;
        if (!db.history) db.history = blankDB().history;
        saveDB();
        toast('Data imported', 'ok');
        navigate('jobs');
      } catch(err) { toast('Could not parse file', 'bad'); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

// Owner sets how many pieces the order is for; progress and finish date follow.
function setBatchQty(jobId) {
  if (!requireOwner() || !requireActive()) return;
  const job = db.jobs.find(j => j.id === jobId);
  if (!job) return;
  const v = prompt(`Order quantity for ${job.componentCode} (pieces). Leave empty for none.`, job.batchQty || '');
  if (v === null) return;
  job.batchQty = Math.min(9999999, Math.max(0, parseInt(v) || 0)) || null;
  saveDB();
  render();
}

function quickLog(jobId) {
  navigate('job', { jobId, logOpen: true });
  focusQtyMobile();
}
function revealLogForm() {
  setTimeout(() => { const w = document.getElementById('log-form-wrap'); if (w && w.scrollIntoView) w.scrollIntoView({ block: 'start' }); }, 40);
}

function confirmClearAll() {
  if (!requireOwner() || !requireActive()) return;
  if (!confirm('Delete ALL jobs and history? This cannot be undone.')) return;
  db = blankDB();
  saveDB();
  toast('All data cleared');
  navigate('jobs');
}

// ── clock ─────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const ct = $('#clock-t'), cd = $('#clock-d');
  if (ct) ct.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  if (cd) cd.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

// ── keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (ui.logOpen) { ui.logOpen = false; render(); }
    else if (ui.addStationOpen) { ui.addStationOpen = false; render(); }
    else if (ui.editStationOpen) { ui.editStationOpen = false; render(); }
  }
});

// Query string for activate/verify. The shop id links this subscription to
// the shop so the server can count operator devices against its tier.
function licenseQuery(email) {
  return '&email=' + encodeURIComponent(email) + '&shop=' + encodeURIComponent(getShopId());
}

function licenseFromActivation(data, email) {
  return {
    token: data.token,
    email: email,
    expiresAt: data.expiresAt || null,
    plan: data.plan || 'monthly',
    tier: TIERS[data.tier] ? data.tier : 'solo',
    lastVerified: new Date().toISOString(),
  };
}

// ── license: background re-verification ──────────────────────────
// Silently re-verifies the stored token against the server every 7 days.
// On failure: if server says expired, clears the license and re-renders.
// On network error: keeps existing token (offline grace period).
function verifyLicenseIfNeeded(force) {
  const raw = db.settings.license;
  if (!raw || !raw.token) return;

  const lic = sanitizeLicense(raw);
  if (!lic) return; // malformed — status logic already treats it as unlicensed; paywall offers re-activation

  // lastVerified is untrusted: future or unparseable values mean "never verified"
  const lastVerified = trustedPastTs(raw.lastVerified);
  const daysSince = lastVerified ? (Date.now() - lastVerified) / MS_DAY : 999;
  if (!force && daysSince < 3) return;

  const url = SYNC_URL + '?action=verify' + licenseQuery(lic.email) + '&token=' + encodeURIComponent(lic.token);
  fetch(url)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return; // server unreachable/garbled — keep state, offline grace continues
      if (data.valid) {
        raw.lastVerified = new Date().toISOString();
        raw.verifyFails = 0;
        if (data.expiresAt) raw.expiresAt = data.expiresAt;
        if (TIERS[data.tier]) raw.tier = data.tier; // picks up a tier change made on another device
        anchorLastSeen(); // confirmed server contact — re-anchor the clock guard
        saveDB();
      } else if (data.expired) {
        db.settings.license = null;
        saveDB();
        render();
      } else {
        // Server reached us and rejected the token (not a network issue).
        // Tolerate transient server hiccups; three consecutive rejections
        // means this token is simply not valid — require re-activation.
        raw.verifyFails = (Number(raw.verifyFails) || 0) + 1;
        if (raw.verifyFails >= 3) {
          db.settings.license = null;
          saveDB();
          toast('License verification required — please re-activate with your email', 'warn');
          render();
        } else {
          saveDB();
        }
      }
    })
    .catch(() => {}); // offline — no action, grace period continues
}

// ── monthly subscription ──────────────────────────────────────────
// Razorpay issues one link per subscriber, so the server mints a
// subscription for this customer's email and returns their payment link.
// Never gated by requireActive() — a lapsed shop must always be able to
// resubscribe.
async function startSubscription() {
  if (!requireOwner()) return;
  const emailEl = $('#pw-email');
  const email = ((emailEl || {}).value || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    toast('Enter a valid email address', 'bad');
    if (emailEl) emailEl.focus();
    return;
  }
  const tier = TIERS[ui.pwTier] ? ui.pwTier : 'solo';
  const changing = getLicenseStatus() === 'licensed';
  if (changing && tier === getTier()) { toast(`You're already on ${TIERS[tier].name}`, 'warn'); return; }
  const btn = $('#pw-sub-btn');
  const restore = () => { if (btn) { btn.disabled = false; btn.textContent = subscribeLabel(tier); } };
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

  try {
    const res = await fetch(SYNC_URL + '?action=subscribe&email=' + encodeURIComponent(email) + '&tier=' + tier);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    if (data.ok && data.url) {
      db.settings.email = email;
      saveDB();
      window.open(data.url, '_blank');
      toast(changing
        ? 'Complete the payment, then tap Activate — your old plan is cancelled automatically'
        : 'Complete the payment, then tap Activate', 'ok', 7000);
    } else {
      toast(data.message || 'Could not start the subscription.', 'bad');
    }
  } catch (err) {
    toast('Could not reach the server. Check your connection and try again.', 'bad');
  }
  restore();
}

// ── license activation ────────────────────────────────────────────
async function activateLicense() {
  if (!requireOwner()) return;
  const emailEl = $('#pw-email');
  const email = ((emailEl || {}).value || '').trim().toLowerCase();
  if (!email) { toast('Enter your email address', 'bad'); return; }

  const btn = $('#pw-activate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }

  try {
    const url = SYNC_URL + '?action=activate' + licenseQuery(email);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();

    if (data.valid && data.token) {
      db.settings.license = licenseFromActivation(data, email);
      db.settings.email = email;
      saveDB();
      toast('License activated! Welcome to TOOLFLUX.', 'ok');
      navigate('jobs');
    } else {
      toast(data.message || 'No active subscription found for this email.', 'bad');
      if (btn) { btn.disabled = false; btn.textContent = 'Activate'; }
    }
  } catch(err) {
    toast('Could not reach server. Check your connection and try again.', 'bad');
    if (btn) { btn.disabled = false; btn.textContent = 'Activate'; }
  }
}

// ── expose globals ────────────────────────────────────────────────
Object.assign(window, {
  navigate, setJobFilter, toggleLogForm, toggleAddStation, adjQty,
  setJobStatus, submitNewJob, submitAddStation, submitLogProduction,
  loadFirstSet, loadNewSet, confirmDeleteStation,
  submitSetup, submitSettings, printReport, exportData, exportToExcel, importData, confirmClearAll,
  pickSeg, rejQtyChanged, setBatchQty, planAddTool, renameOperation, removeOperation, openInvEdit, saveInvEdit, sendPurchaseList, copyPurchaseList, quickLog, updateStationForm, updateSetCostHint,
  submitEditStation, toggleEditStation, activateLicense,
  setActiveOp, addOperation,
  submitAddInventory, deleteInventoryItem, importInvPaste,
  modeChipClick, openPinDialog, openPinSetup, closePinModal,
  submitPinUnlock, submitPinSetup, dismissPinSetup, openLogEdit, saveLogEdit,
  pickInventoryItem, quickIndexCorner,
  copyShiftSummary, printShiftProof, whatsappShiftSummary,
  installApp, dismissNudge,
  startTutorial, tutNext, tutPrev, skipTutorial, replayTutorial,
  submitAddOperator, copyInvite, shareInvite, removeOperator, manualSync, startSubscription, pwSelectTier,
});

// ── init ──────────────────────────────────────────────────────────
loadDB();
handleJoinFromUrl(); // adopt an invite link before the first render
if (isOperatorDevice()) ui.view = 'jobs';   // operator home — no setup, no paywall
else if (!db.settings.company) ui.view = 'setup';
else if (!(db.jobs || []).length && isOwner()) ui.view = 'start'; // first run: straight to the first job
else if (hasOwnerPin() && isOwner()) ui.view = 'dash'; // Owner Home when session still unlocked
render();

// Owner-mode auto-lock: any interaction refreshes the 15-min window;
// a background check locks the UI once it lapses.
['click', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, touchOwnerActivity, { passive: true }));

// Phones: keep the focused field visible above the on-screen keyboard.
// Desktop is excluded — no scroll behavior changes there.
document.addEventListener('focusin', e => {
  if (window.innerWidth > 640) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
    setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 250);
  }
});
setInterval(() => {
  if (!hasOwnerPin()) return;
  const s = ownerSession();
  if (s && s.la && Date.now() - s.la > OWNER_TIMEOUT_MS) lockOwner();
}, 30000);
// ── install & distribution ───────────────────────────────────────
// PWA install prompt, home-screen nudge, and in-app-browser guard.
// All additive: no effect on file:// copies or desktop workflows.
const NUDGE_KEY = 'toolflux.machlog.installNudge';

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
function nudgeDismissed() { try { return !!localStorage.getItem(NUDGE_KEY); } catch (e) { return true; } }
function dismissNudge() {
  try { localStorage.setItem(NUDGE_KEY, '1'); } catch (e) {}
  const el = document.getElementById('install-nudge');
  if (el) el.remove();
}

// Service worker gives true offline start + the browser install prompt
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  showInstallNudge('android');
});

function showInstallNudge(kind) {
  if (isStandalone() || nudgeDismissed() || document.getElementById('install-nudge')) return;
  // Never cover the setup or first-job form; offer it once they are done.
  if (ui.view === 'setup' || ui.view === 'start') { window.__pendingNudge = kind; return; }
  const card = document.createElement('div');
  card.id = 'install-nudge';
  card.className = 'install-nudge';
  card.innerHTML = kind === 'android'
    ? `<div class="in-txt"><b>Put TOOLFLUX on your phone</b><span>One tap — opens like an app, works without internet</span></div>
       <button class="btn btn-pri" onclick="installApp()">Install</button>
       <button class="in-x" onclick="dismissNudge()" aria-label="Dismiss">Close</button>`
    : kind === 'ios'
    ? `<div class="in-txt"><b>Put TOOLFLUX on your phone</b><span>Tap the Share button <span style="font-size:1rem">&#8963;</span> then &ldquo;Add to Home Screen&rdquo;</span></div>
       <button class="in-x" onclick="dismissNudge()" aria-label="Dismiss">Close</button>`
    : `<div class="in-txt"><b>Open in Chrome for safe storage</b><span>This chat browser may not keep your data. Tap &#8942; and choose &ldquo;Open in Chrome / browser&rdquo;.</span></div>
       <button class="in-x" onclick="dismissNudge()" aria-label="Dismiss">Close</button>`;
  document.body.appendChild(card);
}

function installApp() {
  if (!deferredInstall) { dismissNudge(); return; }
  deferredInstall.prompt();
  deferredInstall.userChoice.then(() => { deferredInstall = null; dismissNudge(); });
}

// In-app browsers (WhatsApp/Facebook/Instagram webviews) can silo storage —
// steer the user to a real browser before they build up data there.
(function detectBrowserContext() {
  const ua = navigator.userAgent || '';
  const inApp = /; wv\)/.test(ua) || /FBAN|FBAV|Instagram|Line\//i.test(ua);
  const iOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  if (inApp) setTimeout(() => showInstallNudge('inapp'), 1500);
  else if (iOS && !isStandalone()) setTimeout(() => showInstallNudge('ios'), 2500);
  // Android Chrome case is handled by beforeinstallprompt above
})();

touchLastSeen(); // clock-rollback guard anchor
setInterval(touchLastSeen, 10 * 60 * 1000);
verifyLicenseIfNeeded(); // background, non-blocking
updateClock();
setInterval(updateClock, 30000);
// Sync on load (catches up after offline periods) + every 15 min
setTimeout(silentSync, 8000);
setInterval(silentSync, 15 * 60 * 1000);
// Retry queued audit sync as soon as connectivity returns, or right away
// if a previous session ended with an unsynced mutation
window.addEventListener('online', () => { if (hasSyncPending()) attemptSync(); shopSyncTick(); });
if (hasSyncPending()) setTimeout(attemptSync, 3000);

// Multi-device shop sync: operators push events + pull the master; the owner
// pulls operators' events + reconciles. ~25 s cadence keeps devices in step.
setTimeout(shopSyncTick, 3500);
setInterval(shopSyncTick, 25000);
// Keep the operator's connection pill fresh (offline/online, "updated X ago")
// between full renders.
setInterval(patchSyncStatus, 8000);
window.addEventListener('online', patchSyncStatus);
window.addEventListener('offline', patchSyncStatus);

// Logo fallback for file:// with missing SVG
(function() {
  const img = document.querySelector('.bar-logo img');
  if (!img) return;
  img.onerror = () => {
    const link = img.closest('a');
    if (link) link.innerHTML = '<span style="font-family:var(--mono);font-size:.82rem;font-weight:800;color:var(--navy);">TOOLFLUX</span>';
  };
})();
