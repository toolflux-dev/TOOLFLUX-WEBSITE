// Desk app against a fake backend: pull → folders + brief, token guard, approve-and-send.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dts-desk-'));
process.env.DTS_DIR = tmp;
process.env.DTS_NO_BROWSER = '1';
const desk = require('../dts-desk.js');

test('pull, guard, deliver', async () => {
  const calls = [];
  const order = { orderId: 'DTS-261105-AB12', status: 'paid', part: 'Flange 014', units: 'mm', material: 'EN8', name: 'Ravi', email: 'ravi@shop.in', phone: '9845012345', notes: 'mid-tol bore', paidAt: '2026-11-05', files: [{ id: 'file1', name: 'flange.pdf', size: 13 }] };
  let delivered = false;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      const body = JSON.parse(b); calls.push(body);
      let out;
      if (body.key !== 'K') out = { ok: false, error: 'forbidden' };
      else if (body.action === 'queue') out = { ok: true, orders: delivered ? [] : [order], delivered: delivered ? [{ orderId: order.orderId, part: order.part, name: 'Ravi' }] : [] };
      else if (body.action === 'file') out = { ok: true, name: 'flange.pdf', b64: Buffer.from('%PDF-1.4 x').toString('base64') };
      else if (body.action === 'deliver') { delivered = true; out = { ok: true, status: 'delivered' }; }
      else out = { ok: false };
      res.end(JSON.stringify(out));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  desk._setConfig({ url: 'http://127.0.0.1:' + fake.address().port + '/exec', key: 'K' });
  await new Promise(r => desk.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + desk.server.address().port;
  const post = (p, b, tok = desk.TOKEN) => fetch(base + p, { method: 'POST', headers: { 'X-Desk-Token': tok }, body: JSON.stringify(b || {}) });

  try {
    assert.equal((await post('/api/pull', {}, 'wrong')).status, 403, 'token required');
    assert.equal((await (await post('/api/pull')).json()).ok, true);
    const dir = desk.folderFor(order);
    assert.equal(fs.readFileSync(path.join(dir, 'drawing', 'flange.pdf'), 'utf8'), '%PDF-1.4 x');
    const brief = fs.readFileSync(path.join(dir, 'BRIEF.md'), 'utf8');
    assert.match(brief, /Units on the drawing: \*\*mm\*\*/);
    assert.match(brief, /mid-tol bore/);
    assert.ok(fs.existsSync(path.join(dir, 'order.json')));

    // the page carries the token and its inline script parses
    const html = await (await fetch(base + '/')).text();
    assert.ok(html.includes(desk.TOKEN));
    const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(js));

    // nothing to send until a STEP exists
    let r = await (await post('/api/deliver', { orderId: order.orderId })).json();
    assert.equal(r.ok, false);
    assert.match(r.error, /No \.step/);
    fs.writeFileSync(path.join(dir, 'model', 'Flange 014.step'), 'ISO-10303-21;');
    const st = await (await post('/api/state')).json();
    assert.deepEqual(st.states[order.orderId].steps, ['Flange 014.step']);
    r = await (await post('/api/deliver', { orderId: order.orderId, message: 'ok' })).json();
    assert.equal(r.ok, true);
    const d = calls.find(c => c.action === 'deliver');
    assert.equal(d.files[0].name, 'Flange 014.step');
    assert.equal(Buffer.from(d.files[0].b64, 'base64').toString(), 'ISO-10303-21;');
    assert.ok(fs.existsSync(path.join(tmp, '_delivered', path.basename(dir))), 'folder moved to _delivered');
    assert.equal(calls.filter(c => c.action === 'file').length, 1, 'drawing downloaded once');
  } finally {
    desk.server.close(); fake.close();
  }
});
