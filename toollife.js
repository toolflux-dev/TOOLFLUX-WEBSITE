/* ════════════════════════════════════════════════════════════════════
   TOOLFLUX TOOL LIFE REGISTER
   Insert life tracking · shift production log · printable tool cards.
   Plain JS, no build step. Data in localStorage (export/import JSON).
   The store API is async-shaped nowhere on purpose: swap save()/load()
   for fetch() calls when the backend is deployed.
   ════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── helpers ─────────────────────────────────────────────────────── */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
const pad2 = n => String(n).padStart(2, '0');
const todayStr = (d) => { const t = d || new Date(); return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate()); };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtD(iso) {            // '2026-06-11' or ISO ts → '11 Jun'
  const d = new Date(iso.length === 10 ? iso + 'T00:00' : iso);
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function fmtDY(iso) { const d = new Date(iso.length === 10 ? iso + 'T00:00' : iso); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtT(ts) { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtTS(ts) { return fmtD(ts) + ', ' + fmtT(ts); }
function ago(ts) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  const dd = Math.floor(h / 24);
  return dd + (dd === 1 ? ' day ago' : ' days ago');
}
const fmtN = n => Number(n || 0).toLocaleString('en-IN');
function dl(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ── store ───────────────────────────────────────────────────────── */
const DB_KEY = 'toolflux.toollife.v1';
const blank = () => ({
  v: 1,
  settings: {
    shopName: 'TOOLFLUX Works',
    warnPct: 80,
    ownerPin: '',
    operators: [],
    shifts: [
      { id: 'day',   name: 'Day',   start: '08:00', end: '20:00' },
      { id: 'night', name: 'Night', start: '20:00', end: '08:00' },
    ],
  },
  machines: [], tools: [], events: [], production: [],
});
let db;
function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) { const d = JSON.parse(raw); if (d && d.v === 1) return d; }
  } catch (e) { /* corrupted → start clean */ }
  return blank();
}
function save() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

/* ── derived ─────────────────────────────────────────────────────── */
const machById = id => db.machines.find(m => m.id === id);
const toolById = id => db.tools.find(t => t.id === id);
const toolsOf = mid => db.tools.filter(t => t.machineId === mid);
const lifePct = t => t.lifePerEdge > 0 ? Math.round(t.countOnEdge / t.lifePerEdge * 100) : 0;
const lifeState = t => { const p = lifePct(t); return p >= 100 ? 'over' : (p >= (db.settings.warnPct || 80) ? 'warn' : 'ok'); };

function guessShift(d) {
  const now = d || new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toM = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const sh of db.settings.shifts) {
    const a = toM(sh.start), b = toM(sh.end);
    if (a < b ? (mins >= a && mins < b) : (mins >= a || mins < b)) return sh.id;
  }
  return db.settings.shifts[0] ? db.settings.shifts[0].id : '';
}
const shiftById = id => db.settings.shifts.find(s => s.id === id);

function prodOn(date, mid) {
  return db.production.filter(p => p.date === date && (!mid || p.machineId === mid))
    .reduce((s, p) => s + (p.qty || 0), 0);
}
function logEvent(type, tool, extra) {
  const m = machById(tool.machineId);
  db.events.push(Object.assign({
    id: uid(), ts: new Date().toISOString(), type,
    machineId: tool.machineId, mLabel: m ? m.code : '?',
    toolId: tool.id, tLabel: tool.station, insert: tool.insert,
    operator: ui.opName || '',
  }, extra));
}

/* ── ISO insert shape glyphs ─────────────────────────────────────── */
/* corner positions per shape letter, in a 64×64 box; cps = corners/side */
const GLYPHS = {
  C: { pts: [[5,32],[32,17],[59,32],[32,47]], corners: [0, 2], cps: 2 },          // rhombic 80°
  E: { pts: [[5,32],[32,18],[59,32],[32,46]], corners: [0, 2], cps: 2 },
  M: { pts: [[6,32],[32,15],[58,32],[32,49]], corners: [0, 2], cps: 2 },
  D: { pts: [[3,32],[32,21],[61,32],[32,43]], corners: [0, 2], cps: 2 },          // 55°
  V: { pts: [[2,32],[32,24],[62,32],[32,40]], corners: [0, 2], cps: 2 },          // 35°
  T: { pts: [[32,8],[7,51],[57,51]], corners: [0, 1, 2], cps: 3 },                // triangle
  W: { pts: [[32,7],[40,21],[55,46],[40,51],[24,51],[9,46],[24,21]], corners: [0, 2, 5], cps: 3 }, // trigon-ish
  S: { pts: [[13,13],[51,13],[51,51],[13,51]], corners: [0, 1, 2, 3], cps: 4 },   // square
  P: { pts: [[32,8],[55,25],[46,53],[18,53],[9,25]], corners: [0,1,2,3,4], cps: 5 },
  O: { pts: 'oct', corners: [0,1,2,3,4,5,6,7], cps: 8 },
  R: { pts: 'round', corners: [0,1,2,3], cps: 4 },                                // index positions
  A: { pts: [[6,20],[50,13],[58,44],[14,51]], corners: [1, 3], cps: 2 },          // parallelogram
};
GLYPHS.K = GLYPHS.L = GLYPHS.X = GLYPHS.A;
function glyphMeta(insert) {
  const letter = String(insert || '').trim().toUpperCase()[0] || 'S';
  return GLYPHS[letter] || GLYPHS.S;
}
/* suggested edge count from ISO designation: corners/side × 2 if 0° clearance (double-sided) */
function suggestEdges(insert) {
  const code = String(insert || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 2) return null;
  const g = GLYPHS[code[0]];
  if (!g) return null;
  return g.cps * (code[1] === 'N' ? 2 : 1);
}
function glyphSVG(tool, size) {
  const g = glyphMeta(tool.insert);
  const s = size || 56;
  let shape = '', cornerPts = [];
  if (g.pts === 'round') {
    shape = '<circle class="gshape" cx="32" cy="32" r="23"/>';
    cornerPts = [[32,9],[55,32],[32,55],[9,32]];
  } else if (g.pts === 'oct') {
    const pts = [];
    for (let i = 0; i < 8; i++) { const a = (Math.PI / 8) + i * Math.PI / 4; pts.push([32 + 24 * Math.cos(a), 32 + 24 * Math.sin(a)]); }
    shape = '<polygon class="gshape" points="' + pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ') + '"/>';
    cornerPts = pts;
  } else {
    shape = '<polygon class="gshape" points="' + g.pts.map(p => p.join(',')).join(' ') + '"/>';
    cornerPts = g.corners.map(i => g.pts[i]);
  }
  const cps = g.cps;
  const curIdx = (tool.edge - 1) % cps;          // corner index of current edge
  const sideNo = Math.floor((tool.edge - 1) / cps); // 0 = side A, 1 = side B
  const spentOnSide = curIdx;                     // corners spent on the current side
  const marks = cornerPts.map((p, i) => {
    // pull marker toward centre so it sits on the corner
    const cx = p[0] + (32 - p[0]) * 0.12, cy = p[1] + (32 - p[1]) * 0.12;
    let cls = 'gc-next';
    if (i < spentOnSide || sideNo > 0 && i < spentOnSide) cls = 'gc-done';
    if (i < spentOnSide) cls = 'gc-done';
    if (i === curIdx) cls = 'gc-cur';
    const num = i + 1 + sideNo * cps;
    const txt = i === curIdx ? '<text x="' + cx + '" y="' + (cy + 2.6) + '" text-anchor="middle" font-size="7.5" fill="#fff">' + num + '</text>' : '';
    return '<circle class="' + cls + '" cx="' + cx + '" cy="' + cy + '" r="7" stroke-width="1.5"/>' + txt;
  }).join('');
  return '<span class="glyph" title="' + esc(tool.insert) + ' — edge ' + tool.edge + ' of ' + tool.edges + '">' +
    '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" role="img" aria-label="Insert shape, edge ' + tool.edge + ' of ' + tool.edges + '">' +
    shape + marks + '</svg></span>';
}
const edgeSide = t => {
  const g = glyphMeta(t.insert);
  if (t.edges <= g.cps) return '';
  return Math.floor((t.edge - 1) / g.cps) > 0 ? 'B' : 'A';
};

/* ── UI state ────────────────────────────────────────────────────── */
const ui = {
  route: (location.hash || '#floor').slice(1),
  opName: sessionStorage.getItem('tlf.op') || '',
  drawer: null,          // {toolId, kind:'count'|'rotate'|'new'}
  prodOpen: false,
  addOp: false,
  logFilter: { range: '7d', mach: '', shift: '' },
  cards: { machId: '', blanks: 8, hist: 10 },
  machForm: null,        // 'new' | machineId
  toolForm: null,        // {machineId, toolId|null}
  pinBuf: '',
  pinErr: '',
};
const unlocked = () => !db.settings.ownerPin || sessionStorage.getItem('tlf.unlocked') === '1';

/* ── toasts ──────────────────────────────────────────────────────── */
function toast(html, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad-t' : '');
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 260); }, 3400);
}

/* ── router / render ─────────────────────────────────────────────── */
const ROUTES = [
  ['floor',    'Floor'],
  ['log',      'Shift Log'],
  ['dash',     'Dashboard'],
  ['cards',    'Tool Cards'],
  ['settings', 'Settings'],
];
function renderTabs() {
  const alerts = db.tools.filter(t => t.active && lifeState(t) !== 'ok').length;
  $('#tabs').innerHTML = ROUTES.map(([r, label]) =>
    '<button class="tab" role="tab" aria-selected="' + (ui.route === r) + '" data-a="nav" data-r="' + r + '">' +
    label + (r === 'dash' && alerts ? '<span class="tag">' + alerts + '</span>' : '') + '</button>'
  ).join('');
}
function render() {
  renderTabs();
  const v = $('#view');
  if ((ui.route === 'dash' || ui.route === 'settings') && !unlocked()) { v.innerHTML = vPin(); return; }
  switch (ui.route) {
    case 'log':      v.innerHTML = vLog(); break;
    case 'dash':     v.innerHTML = vDash(); break;
    case 'cards':    v.innerHTML = vCards(); break;
    case 'settings': v.innerHTML = vSettings(); break;
    default:         v.innerHTML = vFloor();
  }
}
window.addEventListener('hashchange', () => {
  ui.route = (location.hash || '#floor').slice(1);
  ui.drawer = null; ui.pinBuf = ''; ui.pinErr = '';
  render();
  window.scrollTo(0, 0);
});

/* ════════ FLOOR ════════ */
function vFloor() {
  if (!db.machines.length) return vOnboard();
  const ops = db.settings.operators;
  const opstrip =
    '<div class="panel"><div class="opstrip">' +
    '<span class="lbl">On duty</span>' +
    ops.map(o => '<button class="opchip" aria-pressed="' + (ui.opName === o) + '" data-a="op-pick" data-op="' + esc(o) + '">' + esc(o) + '</button>').join('') +
    (ui.addOp
      ? '<form data-f="op-add" style="display:flex;gap:.45rem"><input name="op" required placeholder="Name" style="border:1px solid var(--rule);border-radius:2px;padding:.5rem .6rem;min-height:42px" autofocus><button class="btn btn-pri" type="submit">Add</button></form>'
      : '<button class="opchip" data-a="op-addtoggle" style="color:var(--teal)">+ Add name</button>') +
    (!ui.opName ? '<span class="small muted" style="margin-left:auto">Select your name — every entry is stamped with it.</span>' : '') +
    '</div></div>';

  const prodBtn =
    '<div class="panel"><div class="panel-bd" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">' +
    '<div><div class="lbl lbl-teal">Shift production</div>' +
    '<div class="small muted" style="margin-top:.2rem">File the component count for a shift — today: <b class="mono">' + fmtN(prodOn(todayStr())) + '</b> pcs across all machines.</div></div>' +
    '<button class="btn btn-ink btn-big" data-a="prod-toggle" style="margin-left:auto">' + (ui.prodOpen ? 'Close' : 'Log shift production') + '</button>' +
    '</div>' + (ui.prodOpen ? prodForm() : '') + '</div>';

  return opstrip + prodBtn + db.machines.filter(m => m.active !== false).map(m => machSection(m)).join('');
}

function prodForm() {
  const today = todayStr();
  const curShift = guessShift();
  return '<form class="panel-bd" data-f="prod" style="border-top:1px solid var(--rule)">' +
    '<div class="fgrid">' +
    '<div class="field"><label for="p-date">Date</label><input id="p-date" name="date" type="date" value="' + today + '" required></div>' +
    '<div class="field"><label for="p-shift">Shift</label><select id="p-shift" name="shift">' +
      db.settings.shifts.map(s => '<option value="' + esc(s.id) + '"' + (s.id === curShift ? ' selected' : '') + '>' + esc(s.name) + ' (' + s.start + '–' + s.end + ')</option>').join('') + '</select></div>' +
    '<div class="field"><label for="p-mach">Machine</label><select id="p-mach" name="mach">' +
      db.machines.filter(m => m.active !== false).map(m => '<option value="' + m.id + '">' + esc(m.code) + ' — ' + esc(m.name) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="p-part">Component / part</label><input id="p-part" name="part" placeholder="e.g. Flange housing" required></div>' +
    '<div class="field"><label for="p-qty">Qty OK</label><input id="p-qty" name="qty" type="number" inputmode="numeric" min="0" required placeholder="0"></div>' +
    '<div class="field"><label for="p-rej">Rejects</label><input id="p-rej" name="rej" type="number" inputmode="numeric" min="0" value="0"></div>' +
    '<div class="field"><label for="p-dt">Downtime (min)</label><input id="p-dt" name="dt" type="number" inputmode="numeric" min="0" value="0"></div>' +
    '<div class="field"><label for="p-notes">Notes</label><input id="p-notes" name="notes" placeholder="Optional"></div>' +
    '</div>' +
    '<div style="margin-top:.9rem;display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap">' +
    '<label class="check"><input type="checkbox" name="roll" checked> Add qty to every active tool counter on this machine</label>' +
    '<button class="btn btn-pri btn-big" type="submit" style="margin-left:auto">Save shift entry</button>' +
    '</div></form>';
}

function machSection(m) {
  const tools = toolsOf(m.id).filter(t => t.active !== false);
  const today = prodOn(todayStr(), m.id);
  return '<section class="panel">' +
    '<div class="mach-hd">' +
    '<span class="mach-code">' + esc(m.code) + '</span>' +
    '<span class="mach-name">' + esc(m.name) + '</span>' +
    '<span class="mach-type">' + esc(m.type) + '</span>' +
    '<span class="mach-today">Today <b class="num">' + fmtN(today) + '</b> pcs</span>' +
    '</div>' +
    (tools.length ? tools.map(t => toolRow(t)).join('')
      : '<div class="empty">No tool stations on this machine yet — add them in <a href="#settings">Settings</a>.</div>') +
    '</section>';
}

function toolRow(t) {
  const st = lifeState(t);
  const pct = lifePct(t);
  const side = edgeSide(t);
  const open = ui.drawer && ui.drawer.toolId === t.id;
  return '<div class="trow ' + (st === 'over' ? 'over' : st === 'warn' ? 'warn' : '') + '">' +
    '<div class="t-station-cell"><div class="t-station">' + esc(t.station) + '</div><div class="t-op">' + esc(t.operation || '') + '</div></div>' +
    '<div class="t-spec">' + glyphSVG(t) + '<div><div class="t-ins">' + esc(t.insert) + '</div><div class="t-grade">' + esc(t.grade || '') + (t.grade ? ' · ' : '') + 'insert #' + (t.insertNo || 1) + '</div></div></div>' +
    '<div class="t-edge"><div class="e">EDGE ' + t.edge + ' / ' + t.edges + (side ? '<span class="side">SIDE ' + side + '</span>' : '') + '</div>' +
      '<div class="t-since">on edge since ' + fmtTS(t.edgeAt) + ' · ' + ago(t.edgeAt) + '</div></div>' +
    '<div class="t-life"><div class="life-top"><span class="life-count num">' + fmtN(t.countOnEdge) + ' <small>/ ' + fmtN(t.lifePerEdge) + ' pcs</small></span>' +
      '<span class="life-pct ' + (st === 'over' ? 'o' : st === 'warn' ? 'w' : '') + '">' + pct + '%' + (st === 'over' ? ' OVERDUE' : '') + '</span></div>' +
      '<div class="lifebar ' + (st === 'over' ? 'o' : st === 'warn' ? 'w' : '') + '"><i style="width:' + Math.min(100, pct) + '%"></i></div></div>' +
    '<div class="t-act">' +
    '<button class="btn btn-ol" data-a="drawer" data-t="' + t.id + '" data-k="count">+ Count</button>' +
    '<button class="btn ' + (st === 'ok' ? 'btn-ghost' : 'btn-pri') + '" data-a="drawer" data-t="' + t.id + '" data-k="rotate"' + (t.edge >= t.edges ? ' disabled title="Last edge in use — fit a new insert"' : '') + '>Rotate edge</button>' +
    '<button class="btn btn-ghost" data-a="drawer" data-t="' + t.id + '" data-k="new">New insert</button>' +
    '</div>' +
    (open ? drawer(t) : '') +
    '</div>';
}

function drawer(t) {
  const k = ui.drawer.kind;
  const cancel = '<button class="btn btn-ghost" type="button" data-a="drawer-close">Cancel</button>';
  if (k === 'count') {
    return '<div class="drawer"><form data-f="count" data-t="' + t.id + '">' +
      '<div class="drawer-hd"><span class="lbl lbl-teal">Add components — ' + esc(t.station) + ' ' + esc(t.insert) + '</span>' +
      '<span class="kv">on edge now: <b>' + fmtN(t.countOnEdge) + '</b></span></div>' +
      '<div class="stepper">' +
      '<button type="button" data-a="step" data-d="-10">−10</button>' +
      '<button type="button" data-a="step" data-d="-1">−1</button>' +
      '<input name="qty" type="number" inputmode="numeric" value="10" min="1" required aria-label="Quantity">' +
      '<button type="button" data-a="step" data-d="1">+1</button>' +
      '<button type="button" data-a="step" data-d="10">+10</button>' +
      '<button type="button" data-a="step" data-d="25">+25</button>' +
      '</div>' +
      '<div class="drawer-acts"><button class="btn btn-pri btn-big" type="submit">Confirm count</button>' + cancel +
      '<span class="kv" style="margin-left:auto;align-self:center">or set exact: <input name="exact" type="number" inputmode="numeric" min="0" placeholder="—" style="width:90px;border:1px solid var(--rule);border-radius:2px;padding:.45rem;min-height:40px"> <button class="btn btn-ghost" type="submit" name="setexact" value="1">Set</button></span>' +
      '</div></form></div>';
  }
  if (k === 'rotate') {
    return '<div class="drawer"><form data-f="rotate" data-t="' + t.id + '">' +
      '<div class="drawer-hd"><span class="lbl lbl-teal">Rotate to next edge — ' + esc(t.station) + ' ' + esc(t.insert) + '</span></div>' +
      '<div class="kv">Edge <b>' + t.edge + '</b> → <b>' + (t.edge + 1) + '</b> of ' + t.edges + ' · this edge made <b>' + fmtN(t.countOnEdge) + '</b> pcs (' + lifePct(t) + '% of expected ' + fmtN(t.lifePerEdge) + ')</div>' +
      '<div class="field" style="margin-top:.7rem;max-width:420px"><label for="r-note">Note (optional)</label><input id="r-note" name="note" placeholder="e.g. edge chipped early"></div>' +
      '<div class="drawer-acts"><button class="btn btn-pri btn-big" type="submit">Confirm rotation</button>' + cancel + '</div>' +
      '</form></div>';
  }
  return '<div class="drawer warn-d"><form data-f="newins" data-t="' + t.id + '">' +
    '<div class="drawer-hd"><span class="lbl" style="color:var(--warn)">Fit new insert — ' + esc(t.station) + ' ' + esc(t.insert) + '</span></div>' +
    '<div class="kv">Discards insert #' + (t.insertNo || 1) + ' after <b>' + t.edge + '</b> of ' + t.edges + ' edges and <b>' + fmtN((t.totalOnInsert || 0)) + '</b> total pcs. Counter restarts at edge 1.</div>' +
    '<div class="field" style="margin-top:.7rem;max-width:420px"><label for="n-note">Batch / note (optional)</label><input id="n-note" name="note" placeholder="e.g. new box, batch B2245"></div>' +
    '<div class="drawer-acts"><button class="btn btn-ink btn-big" type="submit">Confirm new insert</button>' + cancel + '</div>' +
    '</form></div>';
}

function vOnboard() {
  return '<div class="panel onboard">' +
    '<div class="lbl lbl-teal">First run</div>' +
    '<h2>Set up your shop register</h2>' +
    '<p>Track every insert edge, every rotation, every shift count — stamped with time and name.</p>' +
    '<div class="steps">' +
    '<div class="step"><span class="n">01</span><b>Add machines</b><span>Your CNC lathes and VMCs, in Settings.</span></div>' +
    '<div class="step"><span class="n">02</span><b>Add tool stations</b><span>Insert designation, grade, expected life per edge.</span></div>' +
    '<div class="step"><span class="n">03</span><b>Work the floor</b><span>Operators log counts, rotations and shift totals here.</span></div>' +
    '</div>' +
    '<div class="acts">' +
    '<a class="btn btn-pri btn-big" href="#settings">Open settings</a>' +
    '<button class="btn btn-ol btn-big" data-a="demo">Load demo data</button>' +
    '</div></div>';
}

/* ════════ SHIFT LOG ════════ */
function inRange(dateStr, range) {
  if (range === 'all') return true;
  const t = new Date(dateStr + 'T00:00').getTime();
  const today = new Date(todayStr() + 'T00:00').getTime();
  if (range === 'today') return dateStr === todayStr();
  const days = range === '7d' ? 7 : 30;
  return t > today - days * 864e5 && t <= today;
}
function vLog() {
  const f = ui.logFilter;
  const rows = db.production
    .filter(p => inRange(p.date, f.range) && (!f.mach || p.machineId === f.mach) && (!f.shift || p.shiftId === f.shift))
    .sort((a, b) => b.date.localeCompare(a.date) || b.ts.localeCompare(a.ts));
  const byDate = {};
  rows.forEach(p => { (byDate[p.date] = byDate[p.date] || []).push(p); });
  const dates = Object.keys(byDate).sort().reverse();
  let totQ = 0, totR = 0, totD = 0;
  const body = dates.map(d => {
    const list = byDate[d];
    let sq = 0, sr = 0;
    const trs = list.map(p => {
      sq += p.qty || 0; sr += p.rejects || 0; totD += p.downtimeMin || 0;
      const sh = shiftById(p.shiftId);
      const m = machById(p.machineId);
      return '<tr>' +
        '<td class="mono">' + fmtD(p.date) + '</td>' +
        '<td>' + esc(sh ? sh.name : p.shiftId) + '</td>' +
        '<td class="mono">' + esc(m ? m.code : (p.mLabel || '?')) + '</td>' +
        '<td>' + esc(p.part) + '</td>' +
        '<td>' + esc(p.operator) + '</td>' +
        '<td class="n">' + fmtN(p.qty) + '</td>' +
        '<td class="n">' + (p.rejects ? fmtN(p.rejects) : '—') + '</td>' +
        '<td class="n">' + (p.downtimeMin ? p.downtimeMin + 'm' : '—') + '</td>' +
        '<td class="small muted">' + esc(p.notes || '') + '</td>' +
        '<td><button class="del" data-a="prod-del" data-id="' + p.id + '" title="Delete entry" aria-label="Delete entry">✕</button></td>' +
        '</tr>';
    }).join('');
    totQ += sq; totR += sr;
    return trs + '<tr class="sub"><td colspan="5">' + fmtDY(d) + ' — ' + list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + '</td><td class="n">' + fmtN(sq) + '</td><td class="n">' + (sr ? fmtN(sr) : '—') + '</td><td colspan="3"></td></tr>';
  }).join('');
  return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Shift production log</span><span class="rule"></span>' +
    '<button class="btn btn-ghost" data-a="csv-prod">Export CSV</button></div>' +
    '<div class="panel-bd" style="display:flex;gap:1.4rem;flex-wrap:wrap;align-items:center">' +
    '<div class="chips" role="group" aria-label="Date range">' +
    [['today','Today'],['7d','7 days'],['30d','30 days'],['all','All']].map(([k, l]) =>
      '<button class="chip" aria-pressed="' + (f.range === k) + '" data-a="logf" data-k="range" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
    '<select data-set-log="mach" style="border:1px solid var(--rule);border-radius:2px;padding:.45rem;min-height:34px"><option value="">All machines</option>' +
    db.machines.map(m => '<option value="' + m.id + '"' + (f.mach === m.id ? ' selected' : '') + '>' + esc(m.code) + '</option>').join('') + '</select>' +
    '<select data-set-log="shift" style="border:1px solid var(--rule);border-radius:2px;padding:.45rem;min-height:34px"><option value="">All shifts</option>' +
    db.settings.shifts.map(s => '<option value="' + esc(s.id) + '"' + (f.shift === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>' +
    '</div>' +
    '<div class="tblwrap"><table class="reg"><thead><tr>' +
    '<th>Date</th><th>Shift</th><th>Machine</th><th>Part</th><th>Operator</th><th class="n">Qty OK</th><th class="n">Rej</th><th class="n">Down</th><th>Notes</th><th></th>' +
    '</tr></thead><tbody>' +
    (rows.length ? body +
      '<tr class="tot"><td colspan="5"><span class="lbl">Total · ' + rows.length + ' entries</span></td><td class="n">' + fmtN(totQ) + '</td><td class="n">' + fmtN(totR) + '</td><td class="n">' + (totD ? Math.round(totD / 60 * 10) / 10 + 'h' : '—') + '</td><td colspan="2"></td></tr>'
      : '<tr><td colspan="10"><div class="empty">No entries in this range. Operators file them from the Floor tab.</div></td></tr>') +
    '</tbody></table></div></div>';
}

/* ════════ DASHBOARD ════════ */
function vDash() {
  const today = todayStr();
  const todayQ = prodOn(today);
  // 7-day average excluding today
  let avg = 0, days = 0;
  for (let i = 1; i <= 7; i++) {
    const d = todayStr(new Date(Date.now() - i * 864e5));
    const q = prodOn(d);
    if (q > 0) { avg += q; days++; }
  }
  avg = days ? Math.round(avg / days) : 0;
  const delta = avg ? Math.round((todayQ - avg) / avg * 100) : 0;
  const rejToday = db.production.filter(p => p.date === today).reduce((s, p) => s + (p.rejects || 0), 0);
  const act = db.tools.filter(t => t.active !== false);
  const warns = act.filter(t => lifeState(t) === 'warn');
  const overs = act.filter(t => lifeState(t) === 'over');

  const band = '<div class="panel"><div class="statband">' +
    '<div class="stat"><div class="v">' + fmtN(todayQ) + ' <span class="u">pcs</span></div><div class="lbl">Today</div>' +
    '<div class="sub">' + (avg ? '7-day avg ' + fmtN(avg) + ' · <span class="' + (delta >= 0 ? 'delta-up' : 'delta-dn') + '">' + (delta >= 0 ? '+' : '') + delta + '%</span>' : 'no history yet') + '</div></div>' +
    '<div class="stat"><div class="v">' + db.machines.filter(m => m.active !== false).length + '</div><div class="lbl">Machines</div><div class="sub">' + act.length + ' tool stations tracked</div></div>' +
    '<div class="stat"><div class="v' + (warns.length ? ' warn-c' : '') + '">' + warns.length + '</div><div class="lbl">Edges near end</div><div class="sub">≥ ' + (db.settings.warnPct || 80) + '% of expected life</div></div>' +
    '<div class="stat"><div class="v' + (overs.length ? ' bad-c' : '') + '">' + overs.length + '</div><div class="lbl">Overdue</div><div class="sub">past expected edge life</div></div>' +
    '<div class="stat"><div class="v">' + fmtN(rejToday) + '</div><div class="lbl">Rejects today</div><div class="sub">' + (todayQ ? (Math.round(rejToday / (todayQ + rejToday) * 1000) / 10) + '% of output' : '—') + '</div></div>' +
    '</div></div>';

  const attention = '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Needs attention</span><span class="rule"></span>' +
    '<button class="btn btn-ghost" data-a="digest">Copy daily digest</button></div>' +
    (warns.length + overs.length === 0
      ? '<div class="empty">All edges within expected life. Nothing waiting.</div>'
      : '<div class="attn">' + overs.concat(warns).map(t => {
          const m = machById(t.machineId);
          return '<div class="attn-row">' +
            '<span class="attn-flag ' + (lifeState(t) === 'over' ? 'o' : 'w') + '">' + (lifeState(t) === 'over' ? 'Overdue' : lifePct(t) + '%') + '</span>' +
            '<span><b class="mono">' + esc(m ? m.code : '?') + ' · ' + esc(t.station) + '</b> ' + esc(t.insert) + ' — edge ' + t.edge + '/' + t.edges + ', <b class="num">' + fmtN(t.countOnEdge) + '</b>/' + fmtN(t.lifePerEdge) + ' pcs · on edge ' + ago(t.edgeAt) + '</span>' +
            '<span class="small muted">' + (t.edge >= t.edges ? 'fit new insert' : 'rotate edge') + '</span>' +
            '</div>';
        }).join('') + '</div>') + '</div>';

  return band + attention + chartPanel() + econPanel() + machBoard() + timeline();
}

function chartPanel() {
  const N = 14;
  const shifts = db.settings.shifts;
  const palette = ['#0097B2', '#012B42', '#ff6b1a', '#64737c'];
  const data = [];
  let maxV = 0;
  for (let i = N - 1; i >= 0; i--) {
    const d = todayStr(new Date(Date.now() - i * 864e5));
    const per = shifts.map(s => db.production.filter(p => p.date === d && p.shiftId === s.id).reduce((a, p) => a + (p.qty || 0), 0));
    const other = db.production.filter(p => p.date === d && !shifts.some(s => s.id === p.shiftId)).reduce((a, p) => a + (p.qty || 0), 0);
    if (other) per.push(other);
    const tot = per.reduce((a, b) => a + b, 0);
    maxV = Math.max(maxV, tot);
    data.push({ d, per, tot });
  }
  if (!maxV) return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Production — last 14 days</span><span class="rule"></span></div><div class="empty">No production logged yet.</div></div>';
  const nice = Math.ceil(maxV / 100) * 100;
  const W = 700, H = 190, padL = 46, padB = 30, padT = 12;
  const bw = (W - padL - 10) / N;
  const y = v => padT + (H - padB - padT) * (1 - v / nice);
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="min-width:560px" role="img" aria-label="Stacked bar chart of daily production by shift">';
  for (let g = 0; g <= 2; g++) {
    const v = Math.round(nice * g / 2);
    svg += '<line x1="' + padL + '" x2="' + (W - 6) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e2e8eb" stroke-width="1"/>' +
      '<text x="' + (padL - 7) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="#64737c" font-family="ui-monospace,Consolas,monospace">' + fmtN(v) + '</text>';
  }
  data.forEach((day, i) => {
    let acc = 0;
    const x = padL + i * bw + bw * 0.16, w = bw * 0.68;
    const dt = new Date(day.d + 'T00:00');
    day.per.forEach((v, si) => {
      if (!v) return;
      const y1 = y(acc + v), y2 = y(acc);
      svg += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="' + palette[si % palette.length] + '"><title>' + fmtDY(day.d) + ' · ' + esc(shifts[si] ? shifts[si].name : 'Other') + ': ' + fmtN(v) + ' pcs</title></rect>';
      acc += v;
    });
    if (day.tot) svg += '<text x="' + (x + w / 2) + '" y="' + (y(acc) - 4) + '" text-anchor="middle" font-size="9" fill="#64737c" font-family="ui-monospace,Consolas,monospace">' + (day.tot >= 1000 ? (day.tot / 1000).toFixed(1) + 'k' : day.tot) + '</text>';
    svg += '<text x="' + (x + w / 2) + '" y="' + (H - 16) + '" text-anchor="middle" font-size="9.5" fill="' + (day.d === todayStr() ? '#004455' : '#64737c') + '" font-weight="' + (day.d === todayStr() ? '700' : '400') + '">' + dt.getDate() + '</text>' +
      '<text x="' + (x + w / 2) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="8" fill="#9aa7ae">' + DAYS[dt.getDay()][0] + '</text>';
  });
  svg += '</svg>';
  const legend = '<div class="chart-legend">' + db.settings.shifts.map((s, i) =>
    '<span class="li"><span class="sw" style="background:' + palette[i % palette.length] + '"></span>' + esc(s.name) + ' shift</span>').join('') + '</div>';
  return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Production — last 14 days</span><span class="rule"></span></div>' +
    '<div class="panel-bd"><div class="chart-wrap">' + svg + '</div>' + legend + '</div></div>';
}

function econPanel() {
  const cut = Date.now() - 30 * 864e5;
  const consumed = db.events.filter(e => (e.type === 'rotate' || e.type === 'new') && new Date(e.ts).getTime() > cut && (e.countAtChange || 0) >= 0);
  if (!consumed.length) return '';
  const by = {};
  consumed.forEach(e => {
    const k = e.insert || '?';
    const edges = e.type === 'new' ? 1 : 1; // each rotate/new event = one edge retired
    const b = by[k] = by[k] || { edges: 0, pcs: 0 };
    b.edges += edges; b.pcs += e.countAtChange || 0;
  });
  const rows = Object.keys(by).map(k => {
    const b = by[k];
    const expected = (() => {
      const ts = db.tools.filter(t => t.insert === k);
      return ts.length ? Math.round(ts.reduce((a, t) => a + t.lifePerEdge, 0) / ts.length) : 0;
    })();
    const avg = b.edges ? Math.round(b.pcs / b.edges) : 0;
    const perf = expected ? Math.round(avg / expected * 100) : null;
    return { k, edges: b.edges, avg, expected, perf };
  }).sort((a, b) => b.edges - a.edges);
  return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Insert economics — last 30 days</span><span class="rule"></span></div>' +
    '<div class="tblwrap"><table class="reg"><thead><tr><th>Insert</th><th class="n">Edges retired</th><th class="n">Avg pcs / edge</th><th class="n">Expected</th><th class="n">Performance</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td class="mono">' + esc(r.k) + '</td><td class="n">' + r.edges + '</td><td class="n">' + fmtN(r.avg) + '</td><td class="n">' + (r.expected ? fmtN(r.expected) : '—') + '</td>' +
      '<td class="n" style="' + (r.perf != null && r.perf < 70 ? 'color:var(--bad);font-weight:700' : r.perf != null && r.perf >= 100 ? 'color:var(--ok);font-weight:600' : '') + '">' + (r.perf != null ? r.perf + '%' : '—') + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<div class="panel-bd small muted" style="padding-top:.6rem">Performance under 70% of expected life is flagged — review grade, parameters or supplier batch before reordering.</div></div>';
}

function machBoard() {
  return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Machine board</span><span class="rule"></span></div>' +
    db.machines.filter(m => m.active !== false).map(m => {
      const tools = toolsOf(m.id).filter(t => t.active !== false);
      const today = prodOn(todayStr(), m.id);
      let week = 0;
      for (let i = 0; i < 7; i++) week += prodOn(todayStr(new Date(Date.now() - i * 864e5)), m.id);
      const lastEv = db.events.filter(e => e.machineId === m.id).sort((a, b) => b.ts.localeCompare(a.ts))[0];
      return '<div class="mach-hd" style="background:var(--W);border-bottom:1px solid var(--rule)">' +
        '<span class="mach-code" style="font-size:.9rem">' + esc(m.code) + '</span>' +
        '<span class="mach-name">' + esc(m.name) + '</span>' +
        '<span class="small muted">' + tools.map(t => {
          const st = lifeState(t);
          const col = st === 'over' ? 'var(--bad)' : st === 'warn' ? 'var(--warn)' : 'var(--ok)';
          return '<span class="mono" style="margin-right:.7rem"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:' + col + ';margin-right:.25rem"></span>' + esc(t.station) + ' ' + lifePct(t) + '%</span>';
        }).join('') + '</span>' +
        '<span class="mach-today">Today <b class="num">' + fmtN(today) + '</b> · 7d <b class="num">' + fmtN(week) + '</b>' +
        (lastEv ? ' · last event ' + ago(lastEv.ts) : '') + '</span>' +
        '</div>';
    }).join('') + '</div>';
}

function timeline() {
  const evs = db.events.map(e => ({
    ts: e.ts, tag: e.type,
    what: '<b class="mono">' + esc(e.mLabel) + ' · ' + esc(e.tLabel) + '</b> ' + esc(e.insert || '') + ' — ' + evText(e),
    who: e.operator,
  }));
  const prods = db.production.map(p => {
    const sh = shiftById(p.shiftId);
    return {
      ts: p.ts, tag: 'shift',
      what: '<b class="mono">' + esc((machById(p.machineId) || { code: p.mLabel || '?' }).code) + '</b> ' + esc(sh ? sh.name : '') + ' shift — <b class="num">' + fmtN(p.qty) + '</b> pcs ' + esc(p.part) + (p.rejects ? ' · ' + p.rejects + ' rej' : ''),
      who: p.operator,
    };
  });
  const all = evs.concat(prods).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 30);
  const TAGS = { new: ['tag-new', 'New insert'], rotate: ['tag-rotate', 'Rotated'], count: ['tag-count', 'Count'], adj: ['tag-count', 'Adjusted'], shift: ['tag-shift', 'Shift log'] };
  return '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Activity</span><span class="rule"></span><span class="small muted">latest 30</span></div>' +
    (all.length ? '<ul class="tl">' + all.map(e => {
      const tg = TAGS[e.tag] || ['tag-count', e.tag];
      return '<li><span class="ts">' + fmtTS(e.ts) + '</span><span class="tag ' + tg[0] + '">' + tg[1] + '</span><span class="what">' + e.what + (e.who ? ' <span class="who">· ' + esc(e.who) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul>' : '<div class="empty">No activity yet.</div>') + '</div>';
}
function evText(e) {
  if (e.type === 'rotate') return 'edge ' + e.edgeFrom + ' → ' + e.edgeTo + ' after <b class="num">' + fmtN(e.countAtChange || 0) + '</b> pcs' + (e.note ? ' · “' + esc(e.note) + '”' : '');
  if (e.type === 'new') return 'new insert fitted; old one retired after ' + (e.edgeFrom || '?') + ' edges, <b class="num">' + fmtN(e.countAtChange || 0) + '</b> pcs' + (e.note ? ' · “' + esc(e.note) + '”' : '');
  if (e.type === 'adj') return 'count set to <b class="num">' + fmtN(e.qty || 0) + '</b>' + (e.note ? ' · “' + esc(e.note) + '”' : '');
  return '+<b class="num">' + fmtN(e.qty || 0) + '</b> pcs' + (e.note ? ' · ' + esc(e.note) : '');
}

/* digest for WhatsApp / clipboard */
function digestText() {
  const today = todayStr();
  const lines = [];
  lines.push('TOOLFLUX · ' + esc(db.settings.shopName) + ' · ' + fmtDY(today) + ', ' + fmtT(new Date().toISOString()));
  const tot = prodOn(today);
  const perShift = db.settings.shifts.map(s => s.name + ' ' + fmtN(db.production.filter(p => p.date === today && p.shiftId === s.id).reduce((a, p) => a + (p.qty || 0), 0))).join(' / ');
  lines.push('Production today: ' + fmtN(tot) + ' pcs (' + perShift + ')');
  db.machines.filter(m => m.active !== false).forEach(m => {
    lines.push('· ' + m.code + ': ' + fmtN(prodOn(today, m.id)) + ' pcs');
  });
  const alerts = db.tools.filter(t => t.active !== false && lifeState(t) !== 'ok');
  if (alerts.length) {
    lines.push('Attention:');
    alerts.forEach(t => {
      const m = machById(t.machineId);
      lines.push('! ' + (m ? m.code : '?') + ' ' + t.station + ' ' + t.insert + ' — edge ' + t.edge + '/' + t.edges + ' at ' + lifePct(t) + '% (' + fmtN(t.countOnEdge) + '/' + fmtN(t.lifePerEdge) + ')');
    });
  } else lines.push('All edges within life.');
  return lines.join('\n');
}

/* ════════ TOOL CARDS (printable) ════════ */
function vCards() {
  if (!db.machines.length) return '<div class="panel"><div class="empty">Add machines in <a href="#settings">Settings</a> first — then print a tool card for each one.</div></div>';
  if (!ui.cards.machId || !machById(ui.cards.machId)) ui.cards.machId = db.machines[0].id;
  const m = machById(ui.cards.machId);
  const tools = toolsOf(m.id).filter(t => t.active !== false);
  const ctrl = '<div class="sheet-tools">' +
    '<div class="field"><label for="c-mach">Machine</label><select id="c-mach" data-set-card="machId">' +
    db.machines.map(x => '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.code) + ' — ' + esc(x.name) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="c-hist">History rows</label><input id="c-hist" type="number" min="0" max="40" value="' + ui.cards.hist + '" data-set-card="hist" style="width:90px"></div>' +
    '<div class="field"><label for="c-blank">Blank rows</label><input id="c-blank" type="number" min="0" max="30" value="' + ui.cards.blanks + '" data-set-card="blanks" style="width:90px"></div>' +
    '<button class="btn btn-pri btn-big" data-a="print" style="margin-left:auto">Print card</button>' +
    '</div>' +
    '<p class="small muted" style="margin:-.5rem 0 1rem">Tape this to the machine. Operators tick corners and write rows by hand between data entries; key them in later.</p>';
  return ctrl + sheet(m, tools);
}

function sheet(m, tools) {
  const now = new Date();
  const cardNo = m.code.replace(/\s+/g, '') + '-' + String(now.getFullYear()).slice(2) + pad2(now.getMonth() + 1);
  const meta = '<div class="sh-meta">' +
    '<div><div class="k">Machine</div><div class="v">' + esc(m.code) + '</div></div>' +
    '<div><div class="k">Description</div><div class="v" style="font-size:8.6pt">' + esc(m.name) + ' · ' + esc(m.type) + '</div></div>' +
    '<div><div class="k">Card no.</div><div class="v">' + cardNo + '</div></div>' +
    '<div><div class="k">Issued</div><div class="v" style="font-size:8.6pt">' + fmtDY(now.toISOString()) + '</div></div>' +
    '</div>';
  const secs = tools.map(t => {
    const g = glyphMeta(t.insert);
    const corners = Array.from({ length: t.edges }, (_, i) => {
      const n = i + 1;
      const cls = n < t.edge ? ' x' : (n === t.edge ? ' cur' : '');
      return '<span class="sh-corner' + cls + '">' + n + '</span>';
    }).join('');
    const hist = db.events
      .filter(e => e.toolId === t.id && (e.type === 'rotate' || e.type === 'new'))
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-ui.cards.hist)
      .map(e => '<tr>' +
        '<td class="c">' + fmtD(e.ts) + ' ' + fmtT(e.ts) + '</td>' +
        '<td>' + (e.type === 'new' ? 'NEW INSERT' : 'Rotate ' + e.edgeFrom + '→' + e.edgeTo) + '</td>' +
        '<td class="c">' + (e.type === 'new' ? '1' : e.edgeTo) + '</td>' +
        '<td class="c">' + fmtN(e.countAtChange || 0) + '</td>' +
        '<td>' + esc(e.operator || '') + '</td><td></td></tr>').join('');
    const blanks = Array.from({ length: ui.cards.blanks }, () =>
      '<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
    return '<div class="sh-sec">' +
      '<div class="sh-sec-hd"><span class="s">' + esc(t.station) + ' — ' + esc(t.insert) + (t.grade ? ' · ' + esc(t.grade) : '') + '</span><span class="r"></span>' +
      '<span style="font-size:6.6pt">' + esc(t.operation || '') + ' · expected <b>' + fmtN(t.lifePerEdge) + '</b> pcs/edge · ' + t.edges + ' edges (' + esc((parseInsertCode(t.insert) || { shape: g.cps + '-corner' }).shape) + ')</span></div>' +
      '<div style="margin:1.2mm 0 1.6mm">Corners: ' + corners + ' <span style="font-size:6.4pt;color:#555">(✕ = used &nbsp;·&nbsp; bold = in use — tick by hand as you rotate)</span></div>' +
      '<table class="sh-tbl"><thead><tr>' +
      '<th style="width:17%">Date / time</th><th style="width:21%">Action</th><th style="width:8%">Edge</th><th style="width:13%">Pcs on edge</th><th style="width:22%">Operator</th><th>Sign</th>' +
      '</tr></thead><tbody>' + hist + blanks + '</tbody></table></div>';
  }).join('');
  return '<div class="sheet">' +
    '<div class="sh-hd"><img src="assets/toolflux-logo.svg" alt="TOOLFLUX">' +
    '<div class="sh-title"><div class="t1">TOOL LIFE CARD</div><div class="t2">' + esc(db.settings.shopName) + ' · insert change &amp; rotation record</div></div></div>' +
    meta +
    (tools.length ? secs : '<div class="sh-sec"><p>No active tool stations on this machine.</p></div>') +
    '<div class="sh-foot">' +
    '<div class="sh-sign">Operator</div><div class="sh-sign">Supervisor</div>' +
    '<div class="sh-gen">Generated ' + fmtDY(now.toISOString()) + ' ' + fmtT(now.toISOString()) + ' · TOOLFLUX Tool Life Register</div>' +
    '</div></div>';
}

/* ════════ SETTINGS ════════ */
function vSettings() {
  const s = db.settings;
  const shop = '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Shop</span><span class="rule"></span></div>' +
    '<div class="panel-bd fgrid">' +
    '<div class="field"><label for="s-name">Shop name</label><input id="s-name" value="' + esc(s.shopName) + '" data-set="shopName"></div>' +
    '<div class="field"><label for="s-warn">Warn at % of edge life</label><input id="s-warn" type="number" min="50" max="99" value="' + (s.warnPct || 80) + '" data-set="warnPct"></div>' +
    '</div>' +
    '<div class="panel-hd" style="border-top:1px solid var(--rule)"><span class="lbl">Shifts</span><span class="rule"></span>' +
    '<button class="btn btn-ghost" data-a="shift-add">+ Add shift</button></div>' +
    db.settings.shifts.map(sh => '<div class="setrow">' +
      '<input value="' + esc(sh.name) + '" data-shift="' + esc(sh.id) + '" data-fld="name" aria-label="Shift name" style="border:1px solid var(--rule);border-radius:2px;padding:.5rem;width:130px;min-height:38px">' +
      '<input type="time" value="' + esc(sh.start) + '" data-shift="' + esc(sh.id) + '" data-fld="start" aria-label="Start" style="border:1px solid var(--rule);border-radius:2px;padding:.45rem;min-height:38px">' +
      '<span class="muted">to</span>' +
      '<input type="time" value="' + esc(sh.end) + '" data-shift="' + esc(sh.id) + '" data-fld="end" aria-label="End" style="border:1px solid var(--rule);border-radius:2px;padding:.45rem;min-height:38px">' +
      '<span class="grow"></span>' +
      (db.settings.shifts.length > 1 ? '<button class="mini danger" data-a="shift-del" data-id="' + esc(sh.id) + '">Remove</button>' : '') +
      '</div>').join('') +
    '<div class="panel-hd" style="border-top:1px solid var(--rule)"><span class="lbl">Operators</span><span class="rule"></span></div>' +
    '<div class="setrow" style="flex-wrap:wrap">' +
    (s.operators.length ? s.operators.map(o => '<span class="opchip" style="display:inline-flex;align-items:center;gap:.5rem">' + esc(o) +
      '<button class="mini danger" data-a="op-del" data-op="' + esc(o) + '" style="padding:0 .2rem" aria-label="Remove ' + esc(o) + '">✕</button></span>').join('') : '<span class="muted small">No names yet — operators can also add themselves on the Floor tab.</span>') +
    '<form data-f="op-add" style="display:flex;gap:.45rem;margin-left:auto"><input name="op" required placeholder="Add name" style="border:1px solid var(--rule);border-radius:2px;padding:.5rem .6rem;min-height:38px"><button class="btn btn-ghost" type="submit">Add</button></form>' +
    '</div></div>';

  const machines = '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Machines &amp; tool stations</span><span class="rule"></span>' +
    '<button class="btn btn-pri" data-a="mach-form" data-id="new">+ Add machine</button></div>' +
    (ui.machForm === 'new' ? machFormHTML(null) : '') +
    (db.machines.length ? db.machines.map(m => {
      const tools = toolsOf(m.id);
      return '<div class="' + (m.active === false ? 'inactive-row' : '') + '">' +
        '<div class="setrow" style="background:var(--off)">' +
        '<b class="mono" style="font-size:.9rem;color:var(--navy)">' + esc(m.code) + '</b>' +
        '<span>' + esc(m.name) + '</span><span class="mach-type">' + esc(m.type) + '</span>' +
        (m.active === false ? '<span class="small muted">(inactive)</span>' : '') +
        '<span class="grow"></span>' +
        '<button class="mini" data-a="tool-form" data-m="' + m.id + '" data-id="new">+ Tool</button>' +
        '<button class="mini" data-a="mach-form" data-id="' + m.id + '">Edit</button>' +
        '<button class="mini" data-a="mach-toggle" data-id="' + m.id + '">' + (m.active === false ? 'Activate' : 'Deactivate') + '</button>' +
        '<button class="mini danger" data-a="mach-del" data-id="' + m.id + '">Delete</button>' +
        '</div>' +
        (ui.machForm === m.id ? machFormHTML(m) : '') +
        (ui.toolForm && ui.toolForm.machineId === m.id && ui.toolForm.toolId === null ? toolFormHTML(m, null) : '') +
        tools.map(t => (ui.toolForm && ui.toolForm.toolId === t.id ? toolFormHTML(m, t) :
          '<div class="setrow' + (t.active === false ? ' inactive-row' : '') + '">' +
          '<span class="mono" style="width:46px;font-weight:700">' + esc(t.station) + '</span>' +
          glyphSVG(t, 30) +
          '<span class="mono">' + esc(t.insert) + '</span>' +
          '<span class="small muted">' + esc(t.grade || '') + (t.grade ? ' · ' : '') + esc(t.operation || '') + '</span>' +
          '<span class="small muted">' + t.edges + ' edges · ' + fmtN(t.lifePerEdge) + ' pcs/edge</span>' +
          '<span class="grow"></span>' +
          '<button class="mini" data-a="tool-form" data-m="' + m.id + '" data-id="' + t.id + '">Edit</button>' +
          '<button class="mini" data-a="tool-toggle" data-id="' + t.id + '">' + (t.active === false ? 'Activate' : 'Deactivate') + '</button>' +
          '<button class="mini danger" data-a="tool-del" data-id="' + t.id + '">Delete</button>' +
          '</div>')).join('') +
        '</div>';
    }).join('') : '<div class="empty">No machines yet.</div>') + '</div>';

  const owner = '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Owner area lock</span><span class="rule"></span></div>' +
    '<div class="panel-bd" style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap">' +
    '<form data-f="pin" style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap">' +
    '<div class="field"><label for="s-pin">' + (s.ownerPin ? 'Change PIN (4–6 digits)' : 'Set PIN (4–6 digits)') + '</label>' +
    '<input id="s-pin" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="••••" style="width:120px;font-family:var(--mono)"></div>' +
    '<button class="btn btn-ol" type="submit">' + (s.ownerPin ? 'Change' : 'Set PIN') + '</button>' +
    (s.ownerPin ? '<button class="btn btn-ghost" type="button" data-a="pin-clear">Remove lock</button>' : '') +
    '</form>' +
    '<p class="small muted" style="max-width:42ch">Locks Dashboard and Settings on this device. A deterrent for casual fingers, not encryption — data export still backs everything up.</p>' +
    '</div></div>';

  const data = '<div class="panel"><div class="panel-hd"><span class="lbl lbl-teal">Data</span><span class="rule"></span></div>' +
    '<div class="panel-bd" style="display:flex;gap:.7rem;flex-wrap:wrap;align-items:center">' +
    '<button class="btn btn-ol" data-a="exp-json">Export backup (JSON)</button>' +
    '<label class="btn btn-ol" style="cursor:pointer">Import backup<input type="file" id="imp-file" accept=".json,application/json" style="display:none"></label>' +
    '<button class="btn btn-ghost" data-a="csv-prod">Production CSV</button>' +
    '<button class="btn btn-ghost" data-a="csv-ev">Events CSV</button>' +
    '<span class="grow" style="flex:1"></span>' +
    '<button class="btn btn-ghost" data-a="demo">Load demo data</button>' +
    '<button class="btn btn-bad" data-a="wipe">Erase everything</button>' +
    '</div>' +
    '<div class="panel-bd small muted" style="border-top:1px solid var(--rule)">Data lives in this browser. Export a JSON backup to move it to another computer (or send it to the owner on WhatsApp) and import it there. ' +
    db.events.length + ' events · ' + db.production.length + ' production entries stored.</div></div>';

  return shop + machines + owner + data;
}

function machFormHTML(m) {
  return '<form class="panel-bd" data-f="mach" data-id="' + (m ? m.id : 'new') + '" style="border-bottom:1px solid var(--rule);background:var(--teal-tint)">' +
    '<div class="fgrid">' +
    '<div class="field"><label>Machine code</label><input name="code" required placeholder="VMC-01" value="' + esc(m ? m.code : '') + '"></div>' +
    '<div class="field"><label>Make / model</label><input name="name" required placeholder="HAAS VF-2" value="' + esc(m ? m.name : '') + '"></div>' +
    '<div class="field"><label>Type</label><select name="type">' +
    ['CNC Lathe', 'VMC', 'HMC', 'Drill/Tap', 'Other'].map(t => '<option' + (m && m.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
    '</div>' +
    '<div class="drawer-acts"><button class="btn btn-pri" type="submit">' + (m ? 'Save machine' : 'Add machine') + '</button>' +
    '<button class="btn btn-ghost" type="button" data-a="form-close">Cancel</button></div></form>';
}

function toolFormHTML(m, t) {
  const parse = t ? parseInsertCode(t.insert) : null;
  return '<form class="panel-bd" data-f="tool" data-m="' + m.id + '" data-id="' + (t ? t.id : 'new') + '" style="border-bottom:1px solid var(--rule);background:var(--teal-tint)">' +
    '<div class="fgrid">' +
    '<div class="field"><label>Station</label><input name="station" required placeholder="T01" value="' + esc(t ? t.station : '') + '"></div>' +
    '<div class="field" style="grid-column:span 2;min-width:220px"><label>Insert designation (ISO)</label>' +
    '<input name="insert" required placeholder="CNMG 120408" value="' + esc(t ? t.insert : '') + '" data-parse autocomplete="off">' +
    '<div class="hint" data-parse-hint>' + (parse && parse.recognized ? esc(parse.family + ' · ' + parse.shape) : 'Type a designation — shape and edge count are suggested.') + '</div></div>' +
    '<div class="field"><label>Grade</label><input name="grade" placeholder="TF425" value="' + esc(t ? t.grade : '') + '"></div>' +
    '<div class="field"><label>Operation</label><input name="operation" placeholder="OD Roughing" value="' + esc(t ? t.operation : '') + '"></div>' +
    '<div class="field"><label>Cutting edges</label><input name="edges" type="number" min="1" max="16" required value="' + (t ? t.edges : '') + '" placeholder="4"></div>' +
    '<div class="field"><label>Expected pcs / edge</label><input name="life" type="number" min="1" required value="' + (t ? t.lifePerEdge : '') + '" placeholder="250"></div>' +
    '</div>' +
    '<div class="drawer-acts"><button class="btn btn-pri" type="submit">' + (t ? 'Save tool' : 'Add tool') + '</button>' +
    '<button class="btn btn-ghost" type="button" data-a="form-close">Cancel</button>' +
    (t ? '<span class="kv" style="margin-left:auto;align-self:center">Edge/count state is kept when editing.</span>' : '') +
    '</div></form>';
}

/* ════════ PIN PAD ════════ */
function vPin() {
  const dots = Array.from({ length: (db.settings.ownerPin || '').length }, (_, i) =>
    '<i class="' + (i < ui.pinBuf.length ? 'f' : '') + '"></i>').join('');
  return '<div class="pinwrap">' +
    '<div class="lbl lbl-teal">Owner area</div>' +
    '<h2 style="font-size:1.1rem;font-weight:800;color:var(--navy);margin-top:.5rem">Enter PIN</h2>' +
    '<div class="pindots">' + dots + '</div>' +
    '<div class="pinpad">' +
    [1,2,3,4,5,6,7,8,9].map(n => '<button data-a="pin-d" data-d="' + n + '">' + n + '</button>').join('') +
    '<button data-a="pin-clear-buf" aria-label="Clear">C</button>' +
    '<button data-a="pin-d" data-d="0">0</button>' +
    '<button data-a="pin-back" aria-label="Backspace">⌫</button>' +
    '</div>' +
    '<div class="pin-err">' + esc(ui.pinErr) + '</div></div>';
}

/* ════════ DEMO DATA ════════ */
function loadDemo() {
  const d = blank();
  d.settings.shopName = 'TOOLFLUX Works';
  d.settings.operators = ['Ramesh', 'Arif', 'Manoj', 'Suresh'];
  const mk = (code, name, type) => { const m = { id: uid(), code, name, type, active: true }; d.machines.push(m); return m; };
  const m1 = mk('CNC-01', 'ACE Jobber XL', 'CNC Lathe');
  const m2 = mk('VMC-01', 'BFW Chandra 30', 'VMC');
  const m3 = mk('VMC-02', 'HAAS VF-2', 'VMC');
  const now = Date.now();
  const tk = (m, station, insert, grade, operation, edges, life, edge, count, daysAgoFit) => {
    const t = {
      id: uid(), machineId: m.id, station, insert, grade, operation, edges,
      lifePerEdge: life, edge, countOnEdge: count,
      totalOnInsert: (edge - 1) * Math.round(life * 0.95) + count,
      insertNo: 2 + Math.floor(Math.random() * 3),
      fittedAt: new Date(now - daysAgoFit * 864e5).toISOString(),
      edgeAt: new Date(now - Math.min(daysAgoFit, 1 + Math.random() * 2) * 864e5).toISOString(),
      active: true,
    };
    d.tools.push(t); return t;
  };
  const t1 = tk(m1, 'T01', 'CNMG 120408', 'TF425P', 'OD Roughing',      4, 250, 3, 232, 6);  // 93% warn
  const t2 = tk(m1, 'T03', 'DNMG 110404', 'TF420',  'Profile Finishing', 4, 400, 2, 318, 5);
  const t3 = tk(m1, 'T05', 'TNMG 160404', 'TF425P', 'Facing',            6, 300, 6, 312, 9);  // 104% overdue, last edge
  const t4 = tk(m2, 'T02', 'APKT 1003PDFR', 'TF610','Shoulder Milling',  2, 180, 1, 64, 2);
  const t5 = tk(m2, 'T06', 'SEKN 1203AFTN', 'TF615','Face Milling',      4, 350, 2, 141, 4);
  const t6 = tk(m3, 'T04', 'APMT 1604PDER', 'TF610','Face/Shoulder',     2, 200, 2, 117, 3);
  const t7 = tk(m3, 'T08', 'RCMT 1606MO',  'TF620', 'Copy Milling',      4, 320, 1, 89, 1);

  const ops = d.settings.operators;
  const rnd = a => a[Math.floor(Math.random() * a.length)];
  const parts = { [m1.id]: ['Shaft EN8', 'Gear blank', 'Valve spindle'], [m2.id]: ['Flange housing', 'Pump body'], [m3.id]: ['Bearing cap', 'Bracket LH'] };
  // 14 days of production
  for (let i = 13; i >= 0; i--) {
    const date = todayStr(new Date(now - i * 864e5));
    d.machines.forEach(m => {
      d.settings.shifts.forEach((sh, si) => {
        if (i === 0 && si === 1) return; // tonight not run yet
        if (Math.random() < 0.06) return; // odd idle shift
        const qty = 120 + Math.floor(Math.random() * 140);
        const endH = si === 0 ? 20 : 8;
        const ts = new Date(now - i * 864e5);
        ts.setHours(endH - (si === 1 && i === 0 ? 0 : 0), 5 + Math.floor(Math.random() * 40), 0, 0);
        if (si === 1) ts.setTime(ts.getTime() + (endH === 8 ? 0 : 0)); // night entry filed at morning end
        d.production.push({
          id: uid(), ts: ts.toISOString(), date, shiftId: sh.id, machineId: m.id,
          operator: rnd(ops), part: rnd(parts[m.id]), qty,
          rejects: Math.random() < 0.3 ? Math.floor(Math.random() * 5) : 0,
          downtimeMin: Math.random() < 0.2 ? 10 + Math.floor(Math.random() * 40) : 0,
          notes: Math.random() < 0.08 ? 'Coolant top-up' : '',
        });
      });
    });
  }
  // edge-change events over the past 14 days
  const evFor = (t, daysAgo, type, edgeFrom, edgeTo, count) => {
    const m = d.machines.find(x => x.id === t.machineId);
    const ts = new Date(now - daysAgo * 864e5);
    ts.setHours(6 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60), 0, 0);
    d.events.push({
      id: uid(), ts: ts.toISOString(), type, machineId: t.machineId, mLabel: m.code,
      toolId: t.id, tLabel: t.station, insert: t.insert,
      edgeFrom, edgeTo, countAtChange: count, operator: rnd(ops), note: '',
    });
  };
  [t1, t2, t3, t4, t5, t6, t7].forEach(t => {
    let day = 13;
    for (let e = 1; e < t.edge; e++) {
      evFor(t, day, 'rotate', e, e + 1, Math.round(t.lifePerEdge * (0.82 + Math.random() * 0.3)));
      day -= 1.5 + Math.random() * 2;
    }
    evFor(t, 13.5, 'new', t.edges, 1, Math.round(t.lifePerEdge * (0.85 + Math.random() * 0.25)));
  });
  d.events.sort((a, b) => a.ts.localeCompare(b.ts));
  db = d;
  save();
  toast('Demo data loaded — explore the Floor, Dashboard and a printable Tool Card.');
  render();
}

/* ════════ ACTIONS ════════ */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;

  if (a === 'nav') { location.hash = '#' + el.dataset.r; return; }

  if (a === 'op-pick') { ui.opName = el.dataset.op; sessionStorage.setItem('tlf.op', ui.opName); render(); return; }
  if (a === 'op-addtoggle') { ui.addOp = true; render(); const i = $('input[name=op]'); if (i) i.focus(); return; }
  if (a === 'op-del') {
    if (!confirm('Remove ' + el.dataset.op + ' from the operator list?')) return;
    db.settings.operators = db.settings.operators.filter(o => o !== el.dataset.op);
    if (ui.opName === el.dataset.op) { ui.opName = ''; sessionStorage.removeItem('tlf.op'); }
    save(); render(); return;
  }

  if (a === 'drawer') {
    if (!ui.opName) { toast('Select who\'s on duty first — tap your name at the top.', true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const t = el.dataset.t, k = el.dataset.k;
    ui.drawer = (ui.drawer && ui.drawer.toolId === t && ui.drawer.kind === k) ? null : { toolId: t, kind: k };
    render(); return;
  }
  if (a === 'drawer-close') { ui.drawer = null; render(); return; }
  if (a === 'step') {
    const inp = el.closest('form').querySelector('input[name=qty]');
    inp.value = Math.max(1, (parseInt(inp.value, 10) || 0) + parseInt(el.dataset.d, 10));
    return;
  }
  if (a === 'prod-toggle') { ui.prodOpen = !ui.prodOpen; render(); return; }

  if (a === 'demo') {
    if (db.machines.length || db.production.length) { if (!confirm('Replace ALL current data with demo data?')) return; }
    loadDemo(); return;
  }

  if (a === 'logf') { ui.logFilter[el.dataset.k] = el.dataset.v; render(); return; }
  if (a === 'csv-prod') { exportProdCSV(); return; }
  if (a === 'csv-ev') { exportEventsCSV(); return; }
  if (a === 'prod-del') {
    if (!confirm('Delete this production entry?')) return;
    db.production = db.production.filter(p => p.id !== el.dataset.id);
    save(); render(); toast('Entry deleted.');
    return;
  }

  if (a === 'digest') {
    const txt = digestText();
    const done = () => toast('Daily digest copied — paste it into WhatsApp.');
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      navigator.share({ text: txt }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(done).catch(() => { dl('digest.txt', txt); });
    } else dl('digest.txt', txt);
    return;
  }

  if (a === 'print') { window.print(); return; }

  if (a === 'mach-form') { ui.machForm = el.dataset.id; ui.toolForm = null; render(); return; }
  if (a === 'tool-form') { ui.toolForm = { machineId: el.dataset.m, toolId: el.dataset.id === 'new' ? null : el.dataset.id }; ui.machForm = null; render(); return; }
  if (a === 'form-close') { ui.machForm = null; ui.toolForm = null; render(); return; }
  if (a === 'mach-toggle') { const m = machById(el.dataset.id); m.active = m.active === false ? true : false; save(); render(); return; }
  if (a === 'tool-toggle') { const t = toolById(el.dataset.id); t.active = t.active === false ? true : false; save(); render(); return; }
  if (a === 'mach-del') {
    const m = machById(el.dataset.id);
    if (!confirm('Delete ' + m.code + ' and its ' + toolsOf(m.id).length + ' tool station(s)? History stays in the log.')) return;
    db.tools = db.tools.filter(t => t.machineId !== m.id);
    db.machines = db.machines.filter(x => x.id !== m.id);
    save(); render(); toast(m.code + ' deleted.');
    return;
  }
  if (a === 'tool-del') {
    const t = toolById(el.dataset.id);
    if (!confirm('Delete station ' + t.station + ' (' + t.insert + ')? History stays in the log.')) return;
    db.tools = db.tools.filter(x => x.id !== t.id);
    save(); render(); toast('Tool deleted.');
    return;
  }
  if (a === 'shift-add') {
    db.settings.shifts.push({ id: uid(), name: 'Shift ' + String.fromCharCode(65 + db.settings.shifts.length), start: '06:00', end: '14:00' });
    save(); render(); return;
  }
  if (a === 'shift-del') {
    db.settings.shifts = db.settings.shifts.filter(s => s.id !== el.dataset.id);
    save(); render(); return;
  }

  if (a === 'pin-clear') {
    if (!confirm('Remove the owner PIN lock?')) return;
    db.settings.ownerPin = ''; save(); render(); toast('Owner lock removed.');
    return;
  }
  if (a === 'pin-d') {
    ui.pinBuf += el.dataset.d; ui.pinErr = '';
    if (ui.pinBuf.length >= db.settings.ownerPin.length) {
      if (ui.pinBuf === db.settings.ownerPin) { sessionStorage.setItem('tlf.unlocked', '1'); ui.pinBuf = ''; render(); return; }
      ui.pinErr = 'Wrong PIN — try again.'; ui.pinBuf = '';
    }
    render(); return;
  }
  if (a === 'pin-back') { ui.pinBuf = ui.pinBuf.slice(0, -1); render(); return; }
  if (a === 'pin-clear-buf') { ui.pinBuf = ''; ui.pinErr = ''; render(); return; }

  if (a === 'exp-json') {
    dl('toollife-backup-' + todayStr().replace(/-/g, '') + '.json', JSON.stringify(db, null, 1), 'application/json');
    toast('Backup downloaded.');
    return;
  }
  if (a === 'wipe') {
    const word = prompt('This erases ALL machines, tools, events and production entries on this device.\nType ERASE to confirm:');
    if (word !== 'ERASE') { if (word !== null) toast('Not erased — confirmation text didn\'t match.', true); return; }
    db = blank(); save(); sessionStorage.removeItem('tlf.unlocked'); render(); toast('All data erased.');
    return;
  }
});

/* form submits */
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-f]');
  if (!f) return;
  e.preventDefault();
  const kind = f.dataset.f;
  const v = n => { const i = f.querySelector('[name=' + n + ']'); return i ? i.value.trim() : ''; };
  const num = n => parseInt(v(n), 10) || 0;

  if (kind === 'op-add') {
    const name = v('op');
    if (name && !db.settings.operators.includes(name)) db.settings.operators.push(name);
    ui.opName = name; sessionStorage.setItem('tlf.op', name);
    ui.addOp = false; save(); render(); return;
  }

  if (kind === 'count') {
    const t = toolById(f.dataset.t);
    if (!t) return;
    const exact = v('exact');
    const setexact = e.submitter && e.submitter.name === 'setexact';
    if (setexact && exact !== '') {
      const n = Math.max(0, parseInt(exact, 10) || 0);
      const delta = n - t.countOnEdge;
      t.countOnEdge = n; t.totalOnInsert = Math.max(0, (t.totalOnInsert || 0) + delta);
      logEvent('adj', t, { qty: n, note: 'count corrected' });
      toast('<b class="mono">' + esc(t.station) + '</b> count set to ' + fmtN(n) + ' · ' + fmtT(new Date().toISOString()));
    } else {
      const qty = Math.max(1, num('qty'));
      t.countOnEdge += qty; t.totalOnInsert = (t.totalOnInsert || 0) + qty;
      logEvent('count', t, { qty });
      toast('+' + fmtN(qty) + ' pcs on <b class="mono">' + esc(t.station) + '</b> — edge at ' + lifePct(t) + '%');
    }
    ui.drawer = null; save(); render(); return;
  }

  if (kind === 'rotate') {
    const t = toolById(f.dataset.t);
    if (!t || t.edge >= t.edges) return;
    const from = t.edge, count = t.countOnEdge;
    logEvent('rotate', t, { edgeFrom: from, edgeTo: from + 1, countAtChange: count, note: v('note') });
    t.edge += 1; t.countOnEdge = 0; t.edgeAt = new Date().toISOString();
    ui.drawer = null; save(); render();
    toast('<b class="mono">' + esc(t.station) + '</b> rotated to edge ' + t.edge + '/' + t.edges + ' · stamped ' + fmtT(t.edgeAt) + ', ' + esc(ui.opName));
    return;
  }

  if (kind === 'newins') {
    const t = toolById(f.dataset.t);
    if (!t) return;
    logEvent('new', t, { edgeFrom: t.edge, edgeTo: 1, countAtChange: t.countOnEdge, note: v('note') });
    t.edge = 1; t.countOnEdge = 0; t.totalOnInsert = 0;
    t.insertNo = (t.insertNo || 1) + 1;
    t.fittedAt = t.edgeAt = new Date().toISOString();
    ui.drawer = null; save(); render();
    toast('New insert on <b class="mono">' + esc(t.station) + '</b> · #' + t.insertNo + ' · stamped ' + fmtT(t.fittedAt) + ', ' + esc(ui.opName));
    return;
  }

  if (kind === 'prod') {
    if (!ui.opName) { toast('Select who\'s on duty first.', true); return; }
    const machineId = v('mach');
    const qty = num('qty');
    const entry = {
      id: uid(), ts: new Date().toISOString(),
      date: v('date') || todayStr(), shiftId: v('shift'), machineId,
      mLabel: (machById(machineId) || {}).code,
      operator: ui.opName, part: v('part'), qty,
      rejects: num('rej'), downtimeMin: num('dt'), notes: v('notes'),
    };
    db.production.push(entry);
    const roll = f.querySelector('[name=roll]');
    let rolled = 0;
    if (roll && roll.checked && qty > 0) {
      toolsOf(machineId).filter(t => t.active !== false).forEach(t => {
        t.countOnEdge += qty; t.totalOnInsert = (t.totalOnInsert || 0) + qty; rolled++;
      });
    }
    ui.prodOpen = false; save(); render();
    toast('Shift entry saved — ' + fmtN(qty) + ' pcs' + (rolled ? ' · ' + rolled + ' tool counters updated' : ''));
    return;
  }

  if (kind === 'mach') {
    const id = f.dataset.id;
    if (id === 'new') db.machines.push({ id: uid(), code: v('code'), name: v('name'), type: v('type'), active: true });
    else { const m = machById(id); m.code = v('code'); m.name = v('name'); m.type = v('type'); }
    ui.machForm = null; save(); render(); return;
  }

  if (kind === 'tool') {
    const id = f.dataset.id, mId = f.dataset.m;
    const edges = Math.max(1, num('edges'));
    if (id === 'new') {
      const nowIso = new Date().toISOString();
      db.tools.push({
        id: uid(), machineId: mId, station: v('station'), insert: v('insert'),
        grade: v('grade'), operation: v('operation'), edges,
        lifePerEdge: Math.max(1, num('life')),
        edge: 1, countOnEdge: 0, totalOnInsert: 0, insertNo: 1,
        fittedAt: nowIso, edgeAt: nowIso, active: true,
      });
    } else {
      const t = toolById(id);
      t.station = v('station'); t.insert = v('insert'); t.grade = v('grade');
      t.operation = v('operation'); t.edges = edges; t.lifePerEdge = Math.max(1, num('life'));
      if (t.edge > t.edges) t.edge = t.edges;
    }
    ui.toolForm = null; save(); render(); return;
  }

  if (kind === 'pin') {
    const pin = v('pin');
    if (!/^[0-9]{4,6}$/.test(pin)) { toast('PIN must be 4–6 digits.', true); return; }
    db.settings.ownerPin = pin;
    sessionStorage.setItem('tlf.unlocked', '1');
    save(); render(); toast('Owner PIN set.');
    return;
  }
});

/* live changes: settings fields, shift editor, filters, card options, insert parse hint */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) {
    const k = t.dataset.set;
    db.settings[k] = k === 'warnPct' ? Math.min(99, Math.max(50, parseInt(t.value, 10) || 80)) : t.value.trim();
    save(); renderTabs();
    return;
  }
  if (t.dataset.shift) {
    const sh = shiftById(t.dataset.shift);
    if (sh) { sh[t.dataset.fld] = t.value; save(); }
    return;
  }
  if (t.dataset.setLog !== undefined) { ui.logFilter[t.dataset.setLog] = t.value; render(); return; }
  if (t.dataset.setCard !== undefined) {
    const k = t.dataset.setCard;
    ui.cards[k] = k === 'machId' ? t.value : Math.max(0, parseInt(t.value, 10) || 0);
    render(); return;
  }
  if (t.id === 'imp-file' && t.files && t.files[0]) {
    const file = t.files[0];
    file.text().then(txt => {
      let d;
      try { d = JSON.parse(txt); } catch (err) { toast('Not a valid backup file.', true); return; }
      if (!d || d.v !== 1 || !Array.isArray(d.machines) || !Array.isArray(d.production) || !d.settings) {
        toast('Not a TOOLFLUX Tool Life backup.', true); return;
      }
      if (!confirm('Replace ALL data on this device with the backup "' + file.name + '"?')) return;
      db = d; save(); render();
      toast('Backup imported — ' + d.machines.length + ' machines, ' + d.production.length + ' production entries.');
    });
  }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.parse === undefined) return;
  const form = e.target.closest('form');
  const hint = form.querySelector('[data-parse-hint]');
  const p = parseInsertCode(e.target.value);
  const sug = suggestEdges(e.target.value);
  if (p && p.recognized) {
    hint.textContent = p.family + ' · ' + p.shape + (sug ? ' · suggested ' + sug + ' edges' : '');
    hint.className = 'hint good';
    const edges = form.querySelector('[name=edges]');
    if (edges && !edges.value && sug) edges.value = sug;
  } else {
    hint.textContent = e.target.value.trim() ? 'Designation not recognized — shape unknown, set edges manually.' : 'Type a designation — shape and edge count are suggested.';
    hint.className = 'hint';
  }
});

/* ── CSV exports ─────────────────────────────────────────────────── */
function exportProdCSV() {
  const head = ['Date', 'Shift', 'Machine', 'Part', 'Operator', 'Qty OK', 'Rejects', 'Downtime min', 'Notes', 'Logged at'];
  const rows = db.production.slice().sort((a, b) => a.date.localeCompare(b.date)).map(p => [
    p.date, (shiftById(p.shiftId) || { name: p.shiftId }).name,
    (machById(p.machineId) || { code: p.mLabel || '?' }).code,
    p.part, p.operator, p.qty, p.rejects || 0, p.downtimeMin || 0, p.notes || '', p.ts,
  ]);
  dl('toolflux-production-' + todayStr().replace(/-/g, '') + '.csv',
    [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('Production CSV downloaded.');
}
function exportEventsCSV() {
  const head = ['Timestamp', 'Type', 'Machine', 'Station', 'Insert', 'Edge from', 'Edge to', 'Qty', 'Pcs at change', 'Operator', 'Note'];
  const rows = db.events.map(ev => [
    ev.ts, ev.type, ev.mLabel, ev.tLabel, ev.insert || '',
    ev.edgeFrom || '', ev.edgeTo || '', ev.qty || '', ev.countAtChange != null ? ev.countAtChange : '',
    ev.operator || '', ev.note || '',
  ]);
  dl('toolflux-events-' + todayStr().replace(/-/g, '') + '.csv',
    [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('Events CSV downloaded.');
}

/* ── clock ───────────────────────────────────────────────────────── */
function tickClock() {
  const n = new Date();
  $('#clock-t').textContent = pad2(n.getHours()) + ':' + pad2(n.getMinutes());
  $('#clock-d').textContent = DAYS[n.getDay()] + ' ' + n.getDate() + ' ' + MONTHS[n.getMonth()] + ' ' + n.getFullYear();
}

/* ── init ────────────────────────────────────────────────────────── */
db = load();
tickClock();
setInterval(tickClock, 15000);
render();
