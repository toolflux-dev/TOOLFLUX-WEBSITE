// Automatic modelling: the deliver-or-hold decision, and a full desk run with a stand-in for Claude.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dts-auto-'));
process.env.DTS_DIR = tmp;
process.env.DTS_NO_BROWSER = '1';
const auto = require('../dts-auto.js');
const desk = require('../dts-desk.js');

test('decide: only a clean PASS with every check passed and a STEP file is sent', () => {
  const pass = JSON.stringify({ verdict: 'PASS', checks: '12/12', customerNote: 'Threads at tap-drill size.' });
  assert.deepEqual(auto.decide(pass, ['p.step']), { action: 'deliver', message: 'Threads at tap-drill size.', checks: '12/12' });
  assert.equal(auto.decide(pass, []).action, 'hold', 'no STEP file');
  assert.equal(auto.decide(JSON.stringify({ verdict: 'PASS', checks: '11/12' }), ['p.step']).action, 'hold', 'a failed check');
  assert.equal(auto.decide(JSON.stringify({ verdict: 'PASS', checks: 'all good' }), ['p.step']).action, 'hold', 'checks not counted');
  assert.equal(auto.decide(JSON.stringify({ verdict: 'PASS', checks: '0/0' }), ['p.step']).action, 'hold');
  const hold = auto.decide(JSON.stringify({ verdict: 'HOLD', reason: 'Bore depth missing in section A-A' }), ['p.step']);
  assert.deepEqual(hold, { action: 'hold', reason: 'Bore depth missing in section A-A' });
  assert.match(auto.decide('', ['p.step']).reason, /without writing VERDICT/);
  assert.match(auto.decide('{not json', ['p.step']).reason, /not valid JSON/);
});

test('Claude is started unattended with only the tools modelling needs', () => {
  const args = auto.buildArgs({ orderId: 'DTS-1', part: 'Flange' }, 'C:/x/DTS-1 Flange', 'C:/x');
  assert.equal(args[0], '-p');
  assert.match(args[1], /Order folder: C:\/x\/DTS-1 Flange/);
  assert.match(args[1], /do not ask questions/);
  assert.ok(args.includes('--add-dir'));
  const tools = args.slice(args.indexOf('--allowedTools') + 1);
  assert.deepEqual(tools, auto.ALLOWED_TOOLS);
  assert.ok(!tools.some(t => t === 'Bash' || t === 'Bash(*)'), 'no unrestricted shell');
  assert.ok(typeof auto.findClaude() === 'string');
});

function fakeClaude(verdict, withStep) {
  const f = path.join(tmp, 'fake-claude-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(f, `
const fs = require('fs'), path = require('path');
const m = path.join(process.env.DTS_ORDER_DIR, 'model');
fs.mkdirSync(m, { recursive: true });
${withStep ? "fs.writeFileSync(path.join(m, 'Part.step'), 'ISO-10303-21;');" : ''}
fs.writeFileSync(path.join(m, 'VERDICT.json'), ${JSON.stringify(JSON.stringify(verdict))});
console.log('fake claude done', process.argv.length);`);
  return f;
}

async function withBackend(orders, fn) {
  const calls = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      const body = JSON.parse(b); calls.push(body);
      let out = { ok: true };
      if (body.action === 'queue') out = { ok: true, orders: orders.filter(o => !o.done), delivered: [] };
      else if (body.action === 'file') out = { ok: true, name: 'd.pdf', b64: Buffer.from('%PDF').toString('base64') };
      else if (body.action === 'deliver') { orders.find(o => o.orderId === body.orderId).done = true; out = { ok: true, status: 'delivered' }; }
      else if (body.action === 'mark') { orders.find(o => o.orderId === body.orderId).status = body.status; out = { ok: true, status: body.status }; }
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  desk._setConfig({ url: 'http://127.0.0.1:' + fake.address().port + '/exec', key: 'K', auto: true });
  try { await fn(calls); } finally { fake.close(); }
}

const mk = id => ({ orderId: id, status: 'queued', part: 'Bush ' + id, units: 'mm', name: 'R', email: 'r@shop.in', phone: '9845012345', notes: '', created: '2026-11-06T10:00:00Z', files: [{ id: 'f1', name: 'd.pdf' }] });

test('automatic run: PASS sends the STEP to the customer with the note, no human step', async () => {
  const orders = [mk('DTS-A1')];
  process.env.DTS_FAKE_CLAUDE = fakeClaude({ verdict: 'PASS', checks: '9/9', customerNote: 'Modelled at nominal sizes.' }, true);
  await withBackend(orders, async calls => {
    await desk.pull();
    await desk.runAuto(orders[0]);
    assert.equal(calls.find(c => c.action === 'mark').status, 'modelling');
    const d = calls.find(c => c.action === 'deliver');
    assert.ok(d, 'delivered');
    assert.equal(d.message, 'Modelled at nominal sizes.');
    assert.equal(d.files[0].name, 'Part.step');
    assert.equal(desk._autoState().last.result, 'sent');
    assert.equal(desk._autoState().job, null);
  });
});

test('automatic run: HOLD (or a missing STEP) holds the order and emails Roo, nothing goes to the customer', async () => {
  const orders = [mk('DTS-B2')];
  process.env.DTS_FAKE_CLAUDE = fakeClaude({ verdict: 'HOLD', reason: 'Thread callout unreadable on sheet 2' }, true);
  await withBackend(orders, async calls => {
    await desk.pull();
    await desk.runAuto(orders[0]);
    assert.equal(calls.filter(c => c.action === 'deliver').length, 0);
    const held = calls.filter(c => c.action === 'mark').pop();
    assert.equal(held.status, 'held');
    assert.equal(held.notify, true);
    assert.match(held.note, /Thread callout unreadable/);
    assert.equal(desk._autoState().last.result, 'held');
  });
  const orders2 = [mk('DTS-C3')];
  process.env.DTS_FAKE_CLAUDE = fakeClaude({ verdict: 'PASS', checks: '5/5' }, false);
  await withBackend(orders2, async calls => {
    await desk.pull();
    await desk.runAuto(orders2[0]);
    assert.equal(calls.filter(c => c.action === 'deliver').length, 0);
    assert.match(calls.filter(c => c.action === 'mark').pop().note, /no \.step file/);
  });
});

test('autoTick waits for Fusion instead of starting a job that cannot work', async () => {
  // Only meaningful when Fusion is not answering; when it is, the job path is covered above.
  const h = await desk.fusionHealth();
  if (h.ok) return;
  const orders = [mk('DTS-D4')];
  await withBackend(orders, async calls => {
    await desk.pull();
    await desk.autoTick();
    assert.equal(calls.filter(c => c.action === 'mark').length, 0);
    assert.match(desk._autoState().waiting, /Waiting for Fusion/);
  });
});
