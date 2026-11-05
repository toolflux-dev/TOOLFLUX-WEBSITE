#!/usr/bin/env node
/* Drawing to STEP — desk app for Roo's PC.  Run: node dts-desk.js  (or double-click DRAWING-TO-STEP.cmd)
 *
 * Pulls orders from the Apps Script backend every 2 minutes into  Documents\Drawing to STEP\<order>\ :
 *   drawing\     the customer's files
 *   model\       Claude's output: CHECK.md, the .step, preview.png, VERDICT.json, claude-run.log
 *   order.json   everything the customer typed
 *   BRIEF.md     the modelling brief Claude works from
 * Automatic mode (default on): each queued order is modelled by Claude Code in Fusion, one at a time
 * (dts-auto.js). A PASS verdict emails the STEP to the customer; anything else holds the order and
 * emails Roo. Dashboard at http://localhost:7781.
 *
 *   node dts-desk.js --check-fusion   health check only
 *
 * No dependencies. Listens on 127.0.0.1 only; every API call needs the per-run token
 * embedded in the page, so no other website can drive it. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const auto = require('./dts-auto.js');

const PORT = Number(process.env.DTS_PORT || 7781);
const BASE = process.env.DTS_DIR || path.join(os.homedir(), 'Documents', 'Drawing to STEP');
const CONFIG = path.join(BASE, 'desk.json');
const TOKEN = crypto.randomBytes(18).toString('hex');
const STEP_RE = /\.(step|stp)$/i;

fs.mkdirSync(BASE, { recursive: true });
let config = Object.assign({ url: '', key: '', auto: true }, readJson(CONFIG, {}));
let lastPull = { at: null, error: '', orders: [], delivered: [] };
let autoState = { job: null, waiting: '', last: null, blocked: '' }; // job: { orderId, part, startedAt }
const SIGN_IN_FIX = 'Claude Code on this PC is signed out. In a terminal run: "' + auto.findClaude() + '" setup-token, then follow DRAWING-TO-STEP-SETUP.md (Claude sign-in), then press Retry automatic.';

// ───────── backend ─────────
async function api(body) {
  if (!config.url || !config.key) throw new Error('Not set up: add the Apps Script URL and desk key.');
  const r = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: config.key }, body)) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error('Backend did not answer with JSON (check the URL): ' + text.slice(0, 120)); }
  if (!j.ok) throw new Error(j.message || j.error || 'backend error');
  return j;
}

function folderFor(o) { return path.join(BASE, safe(o.orderId + ' ' + o.part).slice(0, 90)); }

async function pull() {
  try {
    const q = await api({ action: 'queue' });
    for (const o of q.orders) {
      const dir = folderFor(o);
      fs.mkdirSync(path.join(dir, 'drawing'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'model'), { recursive: true });
      for (const f of o.files) {
        const dest = path.join(dir, 'drawing', safe(f.name));
        if (fs.existsSync(dest)) continue;
        const got = await api({ action: 'file', orderId: o.orderId, fileId: f.id });
        fs.writeFileSync(dest, Buffer.from(got.b64, 'base64'));
      }
      fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify(o, null, 2));
      const brief = path.join(dir, 'BRIEF.md');
      if (!fs.existsSync(brief)) fs.writeFileSync(brief, briefText(o, dir));
    }
    lastPull = { at: new Date().toISOString(), error: '', orders: q.orders, delivered: q.delivered || [] };
  } catch (e) {
    lastPull.error = e.message; lastPull.at = new Date().toISOString();
  }
  return lastPull;
}

function briefText(o, dir) {
  return `# ${o.orderId}: ${o.part}

Customer: ${o.name}${o.company ? ' (' + o.company + ')' : ''} · ${o.email} · ${o.phone}
Units on the drawing: **${o.units}**${o.material ? ' · Material: ' + o.material : ''}
Received: ${o.created || '?'}

Customer notes:
${o.notes ? o.notes.split('\n').map(l => '> ' + l).join('\n') : '> (none)'}

Files in drawing\\: ${o.files.map(f => f.name).join(', ')}

## Claude
Follow .claude/skills/drawing-to-step/SKILL.md.
Export to: ${path.join(dir, 'model', safe(o.part) + '.step')}
Preview:   ${path.join(dir, 'model', 'preview.png')}
Check sheet: model\\CHECK.md · Verdict: model\\VERDICT.json (the desk sends on PASS, holds otherwise).
`;
}

function orderState(o) {
  const dir = folderFor(o);
  const model = path.join(dir, 'model');
  const list = fs.existsSync(model) ? fs.readdirSync(model) : [];
  return {
    dir, steps: list.filter(n => STEP_RE.test(n)),
    preview: list.includes('preview.png'), check: fs.existsSync(path.join(model, 'CHECK.md')) ? fs.readFileSync(path.join(model, 'CHECK.md'), 'utf8').slice(0, 4000) : '',
    drawings: fs.existsSync(path.join(dir, 'drawing')) ? fs.readdirSync(path.join(dir, 'drawing')) : [],
    verdict: readJson(path.join(model, 'VERDICT.json'), null),
  };
}

async function deliver(orderId, message) {
  const o = lastPull.orders.find(x => x.orderId === orderId);
  if (!o) throw new Error('Order not in the queue. Refresh first.');
  const st = orderState(o);
  if (!st.steps.length) throw new Error('No .step file in ' + path.join(st.dir, 'model'));
  const files = st.steps.map(n => ({ name: n, b64: fs.readFileSync(path.join(st.dir, 'model', n)).toString('base64') }));
  const res = await api({ action: 'deliver', orderId, message, files });
  const doneDir = path.join(BASE, '_delivered');
  fs.mkdirSync(doneDir, { recursive: true });
  try { fs.renameSync(st.dir, path.join(doneDir, path.basename(st.dir))); } catch (e) { /* folder open in Explorer: leave it */ }
  await pull();
  return res;
}

// ───────── automatic modelling ─────────
// One job at a time (Fusion is one app). Oldest queued order first.
async function autoTick() {
  if (!config.auto || autoState.job || autoState.blocked) return;
  const next = lastPull.orders.filter(o => o.status === 'queued')
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))[0];
  if (!next) { autoState.waiting = ''; return; }
  const h = await fusionHealth();
  if (!h.ok) { autoState.waiting = 'Waiting: ' + h.checks.filter(c => !c.ok).map(c => c.name + ' (' + c.fix + ')').join('; '); return; }
  autoState.waiting = '';
  await runAuto(next);
}

async function runAuto(o) {
  const dir = folderFor(o);
  autoState.job = { orderId: o.orderId, part: o.part, startedAt: new Date().toISOString() };
  let outcome;
  try {
    await api({ action: 'mark', orderId: o.orderId, status: 'modelling', note: 'automatic run started' });
    try { fs.unlinkSync(path.join(dir, 'model', 'VERDICT.json')); } catch (e) { /* none yet */ }
    const run = await auto.runJob(o, dir, BASE, __dirname);
    if (run.signedOut) {
      // Not the order's fault: put it back in the queue, pause, and tell Roo once.
      autoState.blocked = SIGN_IN_FIX;
      await api({ action: 'mark', orderId: o.orderId, status: 'queued', note: 'Automatic modelling paused: ' + SIGN_IN_FIX, notify: true });
      autoState.job = null;
      autoState.last = { at: new Date().toISOString(), orderId: o.orderId, result: 'paused', reason: 'Claude Code is signed out' };
      console.log('[auto] paused: Claude Code is signed out');
      await pull();
      return;
    }
    const verdictPath = path.join(dir, 'model', 'VERDICT.json');
    const verdictText = fs.existsSync(verdictPath) ? fs.readFileSync(verdictPath, 'utf8') : '';
    let d = auto.decide(verdictText, orderState(o).steps);
    if (run.timedOut) d = { action: 'hold', reason: 'Modelling took longer than ' + (auto.JOB_TIMEOUT_MS / 60000) + ' minutes and was stopped.' };
    else if (run.code !== 0 && d.action === 'deliver') d = { action: 'hold', reason: 'Claude exited with code ' + run.code + ' after writing a PASS verdict.' };
    if (d.action === 'deliver') {
      await pull();
      await deliver(o.orderId, d.message);
      outcome = { orderId: o.orderId, result: 'sent', checks: d.checks };
    } else {
      await api({ action: 'mark', orderId: o.orderId, status: 'held', note: d.reason + ' Log: ' + path.join(dir, 'model', 'claude-run.log'), notify: true });
      outcome = { orderId: o.orderId, result: 'held', reason: d.reason };
    }
  } catch (e) {
    outcome = { orderId: o.orderId, result: 'error', reason: e.message };
    try { await api({ action: 'mark', orderId: o.orderId, status: 'held', note: 'Desk error: ' + e.message, notify: true }); } catch (e2) { /* backend down: shows in the dashboard */ }
  }
  autoState.job = null;
  autoState.last = Object.assign({ at: new Date().toISOString() }, outcome);
  console.log('[auto]', JSON.stringify(autoState.last));
  await pull();
  setTimeout(autoTick, 1000); // next order, if any
}

// ───────── Fusion connection health ─────────
// The four things that break the Claude ↔ Fusion link, each with its fix.
async function fusionHealth() {
  const checks = [];
  const running = await new Promise(ok => execFile('tasklist', ['/FI', 'IMAGENAME eq Fusion360.exe', '/NH'], (e, out) => ok(!e && /Fusion360\.exe/i.test(out || ''))));
  checks.push({ name: 'Fusion is running', ok: running, fix: 'Start Fusion and sign in as toolflux@gmail.com.' });
  let opt = null;
  try {
    const raw = fs.readFileSync(path.join(process.env.APPDATA || '', 'Autodesk', 'Neutron Platform', 'Options', 'NMachineSpecificOptions.xml'));
    const xml = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8'); // Fusion writes UTF-16
    const m = /<MCPServerEnabled\b[^>]*\bValue="(\d)"/.exec(xml); opt = m ? m[1] === '1' : false;
  } catch (e) { opt = false; }
  checks.push({ name: 'Fusion MCP Server switched on', ok: opt, fix: 'In Fusion: Preferences > General > API > tick "Fusion MCP Server", then restart Fusion.' });
  let server = false;
  try {
    const r = await fetch('http://127.0.0.1:27182/mcp', { method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dts-desk', version: '1' } } }) });
    server = r.ok && /MCP Server/.test(await r.text());
  } catch (e) { server = false; }
  checks.push({ name: 'Fusion answers on port 27182', ok: server, fix: running ? 'Fusion is open but not answering. If it was just launched, wait a minute and check again; otherwise restart Fusion.' : 'Start Fusion first.' });
  let claude = false;
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')); claude = !!(c.mcpServers && c.mcpServers.fusion && /27182/.test(c.mcpServers.fusion.url || '')); } catch (e) { claude = false; }
  checks.push({ name: 'Claude Code knows the Fusion server', ok: claude, fix: 'Run: claude mcp add --transport http --scope user fusion http://127.0.0.1:27182/mcp (see DRAWING-TO-STEP-SETUP.md).' });
  // The standalone Claude Code that models orders signs in separately from the Claude app.
  let signedIn = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!signedIn) signedIn = await new Promise(ok => execFile(auto.findClaude(), ['auth', 'status'], { timeout: 30000, windowsHide: true }, (e, out) => {
    try { ok(!!JSON.parse(out).loggedIn); } catch (x) { ok(false); }
  }));
  checks.push({ name: 'Claude Code is signed in', ok: signedIn, fix: 'In a terminal run: "' + auto.findClaude() + '" auth login (see DRAWING-TO-STEP-SETUP.md, Claude sign-in).' });
  return { ok: checks.every(c => c.ok), checks };
}

// ───────── server ─────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', page());
    if (req.method === 'GET' && url.pathname === '/preview') {
      const o = lastPull.orders.find(x => x.orderId === url.searchParams.get('o'));
      if (!o) return send(res, 404, 'text/plain', 'no');
      const p = path.join(folderFor(o), 'model', 'preview.png');
      return fs.existsSync(p) ? send(res, 200, 'image/png', fs.readFileSync(p)) : send(res, 404, 'text/plain', 'no');
    }
    if (req.method !== 'POST') return send(res, 404, 'text/plain', 'not found');
    if (req.headers['x-desk-token'] !== TOKEN) return send(res, 403, 'text/plain', 'forbidden');
    const body = JSON.parse(await readBody(req) || '{}');
    let out;
    switch (url.pathname) {
      case '/api/state': out = { config: { url: config.url, hasKey: !!config.key, auto: config.auto }, auto: autoState, pull: lastPull, base: BASE, states: Object.fromEntries(lastPull.orders.map(o => [o.orderId, orderState(o)])) }; break;
      case '/api/auto':
        config.auto = !!body.on; fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
        if (config.auto) setTimeout(autoTick, 100);
        out = { ok: true, auto: config.auto }; break;
      case '/api/unblock': autoState.blocked = ''; setTimeout(autoTick, 100); out = { ok: true }; break;
      case '/api/run': // put a held order back in the automatic queue
        out = await api({ action: 'mark', orderId: body.orderId, status: 'queued', note: 'sent back to automatic modelling' });
        await pull(); setTimeout(autoTick, 100); break;
      case '/api/pull': await pull(); out = { ok: !lastPull.error, error: lastPull.error }; break;
      case '/api/fusion': out = await fusionHealth(); break;
      case '/api/config':
        config = { url: String(body.url || '').trim(), key: String(body.key || '').trim() || config.key };
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.url)) throw new Error('That is not an Apps Script /exec URL.');
        fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2)); await pull(); out = { ok: !lastPull.error, error: lastPull.error }; break;
      case '/api/mark': out = await api({ action: 'mark', orderId: body.orderId, status: body.status, note: body.note || '' }); await pull(); break;
      case '/api/deliver': out = await deliver(body.orderId, String(body.message || '')); break;
      case '/api/open': {
        const o = lastPull.orders.find(x => x.orderId === body.orderId);
        if (!o) throw new Error('unknown order');
        execFile('explorer.exe', [folderFor(o)]); out = { ok: true }; break;
      }
      default: return send(res, 404, 'text/plain', 'not found');
    }
    send(res, 200, 'application/json', JSON.stringify(out));
  } catch (e) {
    send(res, 200, 'application/json', JSON.stringify({ ok: false, error: e.message }));
  }
});

if (require.main === module && process.argv.includes('--check-fusion')) {
  fusionHealth().then(h => { for (const c of h.checks) console.log((c.ok ? 'OK   ' : 'FIX  ') + c.name + (c.ok ? '' : '\n     ' + c.fix)); process.exit(h.ok ? 0 : 1); });
} else if (require.main === module) {
  server.listen(PORT, '127.0.0.1', async () => {
    console.log('Drawing to STEP desk: http://localhost:' + PORT + '   folder: ' + BASE);
    console.log('Automatic modelling: ' + (config.auto ? 'ON' : 'off') + ' · Claude: ' + auto.findClaude());
    if (config.url) { await pull(); autoTick(); }
    setInterval(async () => { if (config.url && !autoState.job) { await pull(); autoTick(); } }, 2 * 60 * 1000);
    if (!process.env.DTS_NO_BROWSER) execFile('cmd.exe', ['/c', 'start', '', 'http://localhost:' + PORT]);
  });
}
module.exports = { server, pull, orderState, folderFor, briefText, fusionHealth, autoTick, runAuto, TOKEN, BASE,
  _setConfig: c => { config = Object.assign({ auto: false }, c); }, _autoState: () => autoState };

// ───────── helpers ─────────
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }
function safe(s) { return String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim(); }
function readBody(req) { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => ok(b)); req.on('error', no); }); }
function send(res, code, type, body) { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); res.end(body); }

function page() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drawing to STEP · desk</title>
<style>
:root{--bg:#f4f7f8;--card:#fefffe;--ink:#0d1e26;--muted:#2f4858;--accent:#007a91;--deep:#012B42;--bad:#b3261e;--ok:#1d7a52;--warn:#8a5a00}
*{box-sizing:border-box;margin:0;padding:0}body{font:15px/1.5 Inter,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;align-items:center;gap:16px;padding:14px 24px;background:var(--deep);color:#fefffe}
header h1{font-size:17px;font-weight:600}header .s{margin-left:auto;font-size:13px;color:#cfe3ea}
button{font:500 14px Inter,'Segoe UI',sans-serif;border:0;background:var(--accent);color:#fff;padding:9px 14px;cursor:pointer;min-height:38px}
button.q{background:#dfe8eb;color:var(--ink)}button:disabled{background:#c9d4d8;color:#5b707a;cursor:not-allowed}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{max-width:1180px;margin:0 auto;padding:24px}
.err{background:#fdf3f2;color:var(--bad);padding:10px 14px;margin-bottom:16px}
.o{background:var(--card);margin-bottom:16px;display:grid;grid-template-columns:260px 1fr;min-height:200px}
.pv{background:#e7eef0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;text-align:center;padding:12px}
.pv img{max-width:100%;max-height:240px}
.b{padding:16px 20px;display:grid;gap:8px}
.top{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.top h2{font-size:18px;font-weight:600}
.st{font-size:13px;font-weight:600;padding:2px 8px;background:#e7eef0}.st.paid{background:#fff0d6;color:var(--warn)}.st.review{background:#dff3ea;color:var(--ok)}.st.query,.st.held{background:#fdf3f2;color:var(--bad)}.st.modelling{background:#e3f1f5;color:var(--accent)}.st.queued{background:#fff0d6;color:var(--warn)}
#ab{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 24px;background:#e7eef0;font-size:14px}#ab b{font-weight:600}#ab .w{color:var(--warn)}
.reason{background:#fdf3f2;color:var(--bad);padding:8px 10px;font-size:14px;white-space:pre-wrap}
.meta{color:var(--muted);font-size:14px}.notes{background:#f4f7f8;padding:8px 10px;white-space:pre-wrap;font-size:14px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}textarea{width:100%;font:14px Inter,'Segoe UI',sans-serif;padding:8px;border:1px solid #9fb3bb;min-height:54px}
details{font-size:14px}pre{white-space:pre-wrap;font:13px/1.45 Consolas,monospace;background:#f4f7f8;padding:8px;max-height:260px;overflow:auto}
.setup{background:var(--card);padding:20px;display:grid;gap:10px;max-width:640px}.setup input{font:14px Inter,'Segoe UI',sans-serif;padding:9px;border:1px solid #9fb3bb;width:100%}
.empty{background:var(--card);padding:28px;color:var(--muted)}h3{font-size:15px;font-weight:600;margin:24px 0 8px}
.done{font-size:14px;color:var(--muted)}
#fx .bad{background:#fdf3f2;color:var(--bad);padding:10px 24px;font-size:14px}#fx .bad b{display:block;margin-bottom:4px}#fx .good{background:#dff3ea;color:var(--ok);padding:6px 24px;font-size:13px}
@media(max-width:760px){.o{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Drawing to STEP · desk</h1><span class="s" id="s"></span><button class="q" id="refresh">Check for orders</button></header>
<div id="fx"></div><div id="ab"></div>
<main id="m"></main>
<script>
const T=${JSON.stringify(TOKEN)};
const call=(p,b)=>fetch(p,{method:'POST',headers:{'X-Desk-Token':T},body:JSON.stringify(b||{})}).then(r=>r.json());
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function render(){
  const s=await call('/api/state');const m=document.getElementById('m');
  document.getElementById('s').textContent=s.pull.at?'Checked '+new Date(s.pull.at).toLocaleTimeString()+' · '+s.base:s.base;
  let h='';
  if(!s.config.url||!s.config.hasKey){h+='<form class="setup" id="cfg"><h2>Connect to the order backend</h2><label>Apps Script web-app URL<input name="url" placeholder="https://script.google.com/macros/s/…/exec" value="'+esc(s.config.url)+'"></label><label>Desk key (from setup() in Apps Script)<input name="key" type="password"></label><button>Save and check</button></form>';}
  if(s.pull.error)h+='<p class="err">'+esc(s.pull.error)+'</p>';
  const os=s.pull.orders||[];
  if(s.config.url&&!os.length&&!s.pull.error)h+='<p class="empty">No orders waiting.</p>';
  const a=s.auto||{},ab=document.getElementById('ab');
  ab.innerHTML='<span>Automatic modelling: <b>'+(s.config.auto?'ON':'OFF')+'</b></span>'+(a.job?'<span>Modelling <b>'+esc(a.job.orderId)+'</b> '+esc(a.job.part)+' since '+new Date(a.job.startedAt).toLocaleTimeString()+'</span>':'')+(a.waiting?'<span class="w">'+esc(a.waiting)+'</span>':'')+(a.blocked?'<span class="w"><b>Paused:</b> '+esc(a.blocked)+'</span><button class="q" id="unblock">Retry automatic</button>':'')+(a.last?'<span>Last: '+esc(a.last.orderId)+' '+esc(a.last.result)+(a.last.reason?' ('+esc(a.last.reason).slice(0,140)+')':'')+'</span>':'')+'<button class="q" id="autot" data-on="'+(s.config.auto?'0':'1')+'">'+(s.config.auto?'Pause automatic':'Turn automatic on')+'</button>';
  for(const o of os){const st=s.states[o.orderId]||{steps:[],drawings:[]};
    h+='<article class="o"><div class="pv">'+(st.preview?'<img alt="Model preview" src="/preview?o='+encodeURIComponent(o.orderId)+'&t='+Date.now()+'">':(o.status==='queued'?'Queued for automatic modelling':o.status==='modelling'?'Claude is modelling this in Fusion…':'No model yet'))+'</div><div class="b">'+
    '<div class="top"><h2>'+esc(o.part)+'</h2><span class="st '+esc(o.status)+'">'+esc(o.status)+'</span><span class="meta">'+esc(o.orderId)+' · '+esc(o.units)+(o.material?' · '+esc(o.material):'')+'</span></div>'+
    '<div class="meta">'+esc(o.name)+(o.company?' · '+esc(o.company):'')+' · <a href="mailto:'+esc(o.email)+'">'+esc(o.email)+'</a> · '+esc(o.phone)+' · received '+esc(String(o.created).slice(0,16))+'</div>'+
    (o.status==='held'&&st.verdict&&st.verdict.reason?'<div class="reason">Held: '+esc(st.verdict.reason)+'</div>':'')+
    (o.notes?'<div class="notes">'+esc(o.notes)+'</div>':'')+
    '<div class="meta">Drawing: '+esc(st.drawings.join(', ')||'downloading…')+' · STEP: '+(st.steps.length?'<b>'+esc(st.steps.join(', '))+'</b>':'none yet')+'</div>'+
    (st.check?'<details><summary>Claude\\'s dimension check</summary><pre>'+esc(st.check)+'</pre></details>':'')+
    '<textarea data-msg="'+esc(o.orderId)+'" placeholder="Optional note in the delivery email (e.g. threads modelled at tap-drill size)"></textarea>'+
    '<div class="row"><button class="q" data-open="'+esc(o.orderId)+'">Open folder</button>'+
    '<button class="q" data-run="'+esc(o.orderId)+'" '+(o.status==='modelling'?'disabled':'')+'>Model automatically again</button>'+
    '<button class="q" data-ask="'+esc(o.orderId)+'" data-email="'+esc(o.email)+'" data-part="'+esc(o.part)+'">Ask customer</button>'+
    '<button data-send="'+esc(o.orderId)+'" '+(st.steps.length?'':'disabled')+'>Approve and send STEP</button></div></div></article>';}
  if((s.pull.delivered||[]).length){h+='<h3>Recently delivered</h3>'+s.pull.delivered.slice().reverse().map(d=>'<p class="done">'+esc(d.orderId)+' · '+esc(d.part)+' · '+esc(d.name)+'</p>').join('');}
  m.innerHTML=h;
}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  let r;
  if(b.id==='refresh'){b.disabled=true;r=await call('/api/pull');b.disabled=false;}
  else if(b.id==='unblock'){r=await call('/api/unblock');}
  else if(b.id==='autot'){r=await call('/api/auto',{on:b.dataset.on==='1'});}
  else if(b.dataset.run){if(!confirm('Send '+b.dataset.run+' back to automatic modelling?'))return;r=await call('/api/run',{orderId:b.dataset.run});}
  else if(b.dataset.open){r=await call('/api/open',{orderId:b.dataset.open});}
  else if(b.dataset.mark){r=await call('/api/mark',{orderId:b.dataset.mark,status:b.dataset.status});}
  else if(b.dataset.ask){const q=prompt('Question for the customer (also saved on the order):');if(!q)return;
    r=await call('/api/mark',{orderId:b.dataset.ask,status:'query',note:q});
    location.href='mailto:'+b.dataset.email+'?subject='+encodeURIComponent('Question on your drawing: '+b.dataset.part+' ('+b.dataset.ask+')')+'&body='+encodeURIComponent(q+'\\n\\nTOOLFLUX Drawing to STEP');}
  else if(b.dataset.send){const id=b.dataset.send;if(!confirm('Email the STEP for '+id+' to the customer now?'))return;
    b.disabled=true;b.textContent='Sending…';r=await call('/api/deliver',{orderId:id,message:document.querySelector('[data-msg="'+id+'"]').value});}
  if(r&&r.ok===false)alert(r.error||'Failed');render();});
document.addEventListener('submit',async e=>{if(e.target.id!=='cfg')return;e.preventDefault();const f=new FormData(e.target);
  const r=await call('/api/config',{url:f.get('url'),key:f.get('key')});if(r.ok===false)alert(r.error);render();});
async function fusion(){const h=await call('/api/fusion');const el=document.getElementById('fx');
  el.innerHTML=h.ok?'<div class="good">Fusion connected</div>':'<div class="bad"><b>Fusion is not reachable for modelling</b>'+h.checks.filter(c=>!c.ok).map(c=>esc(c.name)+': '+esc(c.fix)).join('<br>')+'</div>';}
render();fusion();setInterval(render,15000);setInterval(fusion,120000);
</script></body></html>`;
}
