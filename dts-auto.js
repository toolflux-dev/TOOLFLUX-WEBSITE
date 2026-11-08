/* Drawing to STEP — automatic modelling (used by dts-desk.js).
 *
 * For each queued order the desk app starts Claude Code unattended (`claude -p`) in this folder.
 * Claude follows .claude/skills/drawing-to-step/SKILL.md: reads the drawing, models it in Fusion,
 * measures it, exports the STEP, files it in the Fusion library and writes model/VERDICT.json.
 *
 *   PASS + a STEP file  -> the desk emails the STEP to the customer, no human step
 *   anything else       -> the order is HELD and Roo gets an email with the reason
 *
 * Roo chose fully automatic (2026-11-06); holding on a failed check is the one safeguard, so a
 * misread drawing never reaches a customer silently. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const JOB_TIMEOUT_MS = Number(process.env.DTS_JOB_TIMEOUT_MIN || 45) * 60 * 1000;

// The bundled Claude Code CLI moves with every app update, so look for the newest one each time.
function findClaude() {
  if (process.env.DTS_CLAUDE && fs.existsSync(process.env.DTS_CLAUDE)) return process.env.DTS_CLAUDE;
  const roots = [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data')];
  const found = [];
  for (const r of roots) {
    let data = []; try { data = fs.readdirSync(r); } catch (e) { continue; }
    for (const d of data) {
      const cc = path.join(r, d, 'claude-code');
      let vers = []; try { vers = fs.readdirSync(cc); } catch (e) { continue; }
      for (const v of vers) {
        let hashes = []; try { hashes = fs.readdirSync(path.join(cc, v)); } catch (e) { continue; }
        for (const h of hashes) {
          const exe = path.join(cc, v, h, 'claude.exe');
          try { found.push({ exe, t: fs.statSync(exe).mtimeMs }); } catch (e) { /* not there */ }
        }
      }
    }
  }
  found.sort((a, b) => b.t - a.t);
  if (found.length) return found[0].exe;
  return 'claude'; // on PATH, if installed that way
}

const ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'Bash(node fusion/fx.js:*)', 'Bash(node dts-desk.js --check-fusion)',
  'mcp__fusion',
];

function prompt(order, dir) {
  return [
    'Unattended run for TOOLFLUX Drawing to STEP. Nobody is watching: do not ask questions.',
    'Model order ' + order.orderId + ' (' + order.part + ').',
    'Order folder: ' + dir,
    'Read the drawing from the images in drawing\\_pages (overview + close-ups). If order.json notes contain a "Customer answer", use it.',
    'Follow .claude/skills/drawing-to-step/SKILL.md from step 0 to the end, including the Automatic runs section.',
    'Your last action must be writing ' + path.join(dir, 'model', 'VERDICT.json') + '.',
    'Never email anyone and never call the backend; the desk app reads VERDICT.json and does the rest.',
  ].join('\n');
}

function buildArgs(order, dir, base) {
  return ['-p', prompt(order, dir), '--output-format', 'text', '--permission-mode', 'acceptEdits',
    '--add-dir', base, '--allowedTools', ...ALLOWED_TOOLS];
}

// Read VERDICT.json and decide. Pure: tested in tests/dts-auto.test.js.
function decide(verdictText, stepFiles) {
  let v = null;
  try { v = JSON.parse(verdictText); } catch (e) { return { action: 'hold', reason: verdictText ? 'VERDICT.json is not valid JSON.' : 'Claude finished without writing VERDICT.json.' }; }
  const verdict = String(v.verdict || '').toUpperCase();
  if (verdict === 'QUESTION') {
    const q = String(v.question || '').trim();
    if (q.length >= 10) return { action: 'ask', question: q.slice(0, 3000) };
    return { action: 'hold', reason: 'Verdict was QUESTION but no question was written.' };
  }
  if (verdict !== 'PASS') return { action: 'hold', reason: String(v.reason || 'Claude held the order without a reason.').slice(0, 1500) };
  if (!stepFiles.length) return { action: 'hold', reason: 'Verdict was PASS but there is no .step file in model\\.' };
  const checks = String(v.checks || '');
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(checks.trim());
  if (!m || m[1] !== m[2] || Number(m[2]) === 0) return { action: 'hold', reason: 'Verdict was PASS but the checks were "' + checks + '", not all passed.' };
  const note = typeof v.customerNote === 'string' ? v.customerNote.trim().slice(0, 1500) : '';
  return { action: 'deliver', message: note, checks };
}

// The standalone Claude Code CLI keeps its own sign-in, separate from the Claude app. When it has
// expired, every job fails the same way: that is not the order's fault, so the desk pauses instead.
function signedOut(text) {
  return /Failed to authenticate|OAuth (session|token) (has )?expired|not (logged|signed) in|Invalid API key|Please run \/login|authentication_error/i.test(String(text || ''));
}

// The Claude plan's usage limit ("You've hit your 5-hour limit · resets 5:10am"). Also not the order's
// fault: the desk puts the order back and waits until the limit resets, then carries on by itself.
function usageLimit(text) {
  return /hit your .{0,30}limit|usage limit reached|rate.?limit(ed)?|resets \d{1,2}(:\d\d)?\s?(am|pm)/i.test(String(text || ''));
}

// When the limit resets, from "resets 5:10am" (local time); else 30 minutes from now. Pure: tested.
function resumeAt(text, now) {
  now = now || new Date();
  const m = /resets\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)/i.exec(String(text || ''));
  if (!m) return new Date(now.getTime() + 30 * 60 * 1000);
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  const t = new Date(now); t.setHours(h, Number(m[2] || 0), 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return new Date(t.getTime() + 2 * 60 * 1000); // two minutes' margin
}

// Start one modelling job. Resolves with { code, timedOut, log } when Claude exits.
function runJob(order, dir, base, cwd) {
  return new Promise(resolve => {
    const exe = findClaude();
    const logPath = path.join(dir, 'model', 'claude-run.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    log.write('\n=== ' + new Date().toISOString() + ' ' + exe + '\n');
    let child;
    // Tests set DTS_FAKE_CLAUDE to a node script that stands in for Claude Code.
    const fake = process.env.DTS_FAKE_CLAUDE;
    const cmd = fake ? process.execPath : exe;
    const args = fake ? [fake].concat(buildArgs(order, dir, base)) : buildArgs(order, dir, base);
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DTS_ORDER: order.orderId, DTS_ORDER_DIR: dir }) });
    } catch (e) { log.end('spawn failed: ' + e.message + '\n'); return resolve({ code: -1, timedOut: false, error: e.message }); }
    let tail = '';
    const keep = d => { log.write(d); tail = (tail + d).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; try { child.kill(); } catch (e) { /* gone */ } }, JOB_TIMEOUT_MS);
    child.on('error', e => { clearTimeout(t); log.end('error: ' + e.message + '\n'); resolve({ code: -1, timedOut, error: e.message, signedOut: false, tail }); });
    child.on('close', code => { clearTimeout(t); log.end('exit ' + code + (timedOut ? ' (timed out)' : '') + '\n'); resolve({ code, timedOut, signedOut: code !== 0 && signedOut(tail), usageLimit: code !== 0 && usageLimit(tail), tail }); });
  });
}

// Render every drawing into drawing\_pages (fusion/render_drawings.py, PyMuPDF) so Claude can zoom
// without a shell. Re-renders only when the set of drawing files changes (e.g. a customer answer added one).
function renderDrawings(dir) {
  const drawing = path.join(dir, 'drawing'), pages = path.join(drawing, '_pages'), mark = path.join(pages, '.rendered');
  let names = [];
  try { names = fs.readdirSync(drawing).filter(n => n !== '_pages').sort(); } catch (e) { return Promise.resolve({ ok: false, error: 'no drawing folder' }); }
  const sig = names.join('|');
  try { if (fs.readFileSync(mark, 'utf8') === sig) return Promise.resolve({ ok: true, skipped: true }); } catch (e) { /* not rendered yet */ }
  const script = path.join(__dirname, 'fusion', 'render_drawings.py');
  return new Promise(resolve => {
    require('child_process').execFile(process.env.DTS_PYTHON || 'python', ['-I', script, dir], { timeout: 5 * 60 * 1000, windowsHide: true }, (e, out, err) => {
      if (e) return resolve({ ok: false, error: String(err || e.message).slice(-500) });
      try { fs.mkdirSync(pages, { recursive: true }); fs.writeFileSync(mark, sig); } catch (x) { /* next pull retries */ }
      resolve({ ok: true, out: String(out).trim() });
    });
  });
}

module.exports = { findClaude, buildArgs, decide, runJob, signedOut, usageLimit, resumeAt, renderDrawings, ALLOWED_TOOLS, JOB_TIMEOUT_MS };
