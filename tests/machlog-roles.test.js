const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./helpers/client');

// A shop with one turning job: ₹400 insert, 4 corners, linked to a stocked item.
function shop() {
  const c = loadClient();
  c.run(`
    db.inventory.push({ id: 'inv1', category: 'turning_insert', designation: 'CNMG 120408', manufacturer: 'TOOLFLUX', grade: 'P25', unitPrice: 400, qtyInStock: 12, minQty: 0, createdAt: isoNow() });
    var J = createFirstJob({ code: 'flg-1', cost: 400, opType: 'turning', corners: 4, operator: 'Raj', machine: 'LT-01' });
    var ST = J.operations[0].stations[0];
    ST.inventoryItemId = 'inv1';
    var OP = J.operations[0].id;
    function logQty(q, daysAgo, extra) {
      applyProductionEntry(J, Object.assign({ id: uid(), timestamp: new Date(Date.now() - (daysAgo || 0) * 86400000).toISOString(),
        operationId: OP, operator: 'Raj', machine: 'LT-01', qty: q, qtyGood: q, rejections: [], events: [] }, extra || {}));
    }`);
  return c;
}

// ── operator ───────────────────────────────────────────────────────
test('the usual entry size needs three entries before it is trusted', () => {
  const c = shop();
  c.run('logQty(50); logQty(40)');
  assert.equal(c.run('typicalEntryQty(J)'), null);
  c.run('logQty(60)');
  assert.equal(c.run('typicalEntryQty(J)'), 50);
});

test("today's count ignores earlier days", () => {
  const c = shop();
  c.run('logQty(50, 2); logQty(30); logQty(12)');
  assert.equal(c.run('jobTodayQty(J)'), 42);
});

test('a tool past its usual life is flagged in words', () => {
  const c = shop();
  // two corners indexed at 100 pcs each, then 120 on the third
  c.run(`logQty(100, 3, { events: [{ stationId: ST.id, eventType: 'corner_index' }] });
         logQty(100, 2, { events: [{ stationId: ST.id, eventType: 'corner_index' }] });
         logQty(120, 1);`);
  const flags = JSON.parse(c.run('JSON.stringify(jobToolFlags(J))'));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].cls, 'bad');
  assert.match(flags[0].text, /index now/);
});

// ── owner ──────────────────────────────────────────────────────────
test('order quantity gives days left at the recent pace', () => {
  const c = shop();
  c.run('logQty(50, 2); logQty(50, 1); logQty(50, 0)');
  const pace = JSON.parse(c.run('JSON.stringify(jobPace(J, 200))'));
  assert.equal(pace.perDay, 50);
  assert.equal(pace.daysLeft, 4);
  assert.equal(c.run('jobPace(J, 0).daysLeft'), null, 'a finished order has no days left');
});

test('the dashboard reports tooling spend and the main rejection reason', () => {
  const c = shop();
  c.run(`logQty(100, 1, { qtyGood: 94, rejections: [{ qty: 6, reason: 'Dimensional' }], events: [{ stationId: ST.id, eventType: 'insert_replace' }] });
         logQty(50, 0, { qtyGood: 48, rejections: [{ qty: 2, reason: 'Tool mark' }] });`);
  const d = JSON.parse(c.run('JSON.stringify(computeDashData())'));
  assert.equal(d.spend7, 800, 'two sets of one ₹400 insert loaded this week');
  assert.equal(d.spend30, 800);
  assert.equal(d.rejWeek, 8);
  assert.equal(d.topRejReason.reason, 'Dimensional');
  assert.equal(d.good30, 142);
});

// ── purchase ───────────────────────────────────────────────────────
test('replacing an insert uses stock and counts as usage', () => {
  const c = shop();
  c.run(`logQty(100, 1, { events: [{ stationId: ST.id, eventType: 'insert_replace' }] })`);
  assert.equal(c.run('db.inventory[0].qtyInStock'), 11);
  // the first set was loaded at job creation (not from stock); both count as used
  assert.equal(c.run(`invUsage(30)['inv1']`), 2);
});

test('an item above its reorder level is not on the buying list', () => {
  const c = shop();
  c.run('db.inventory[0].minQty = 5');
  assert.equal(c.run('invToBuy().length'), 0);
});

test('an item at its reorder level is listed, rounded to a box of ten', () => {
  const c = shop();
  c.run('db.inventory[0].minQty = 12');
  const buy = JSON.parse(c.run('JSON.stringify(invToBuy())'));
  assert.equal(buy.length, 1);
  assert.match(buy[0].p.why, /reorder level/);
  assert.equal(buy[0].p.suggest, 20, '2 × reorder level minus stock = 12, rounded up to 20');
});

test('out-of-stock items come first and the supplier message has no prices', () => {
  const c = shop();
  c.run(`db.inventory[0].minQty = 12;
         db.inventory.push({ id: 'inv2', category: 'drill', designation: 'D12 drill', manufacturer: '', grade: '', unitPrice: 2800, qtyInStock: 0, createdAt: isoNow() });`);
  const names = JSON.parse(c.run('JSON.stringify(invToBuy().map(x => x.item.designation))'));
  assert.deepEqual(names, ['D12 drill', 'CNMG 120408']);
  const text = c.run('buildPurchaseText()');
  assert.match(text, /1\. D12 drill — 1 nos/);
  assert.match(text, /2\. CNMG 120408 \(TOOLFLUX · P25\) — 20 nos/);
  assert.doesNotMatch(text, /₹|2800|400/);
});

test('the dashboard warns when stock reaches the reorder level', () => {
  const c = shop();
  c.run('db.inventory[0].minQty = 12');
  const alerts = JSON.parse(c.run('JSON.stringify(computeDashData().invAlerts)'));
  assert.ok(alerts.some(a => a.label === 'At reorder level' && a.item === 'CNMG 120408'));
});

// ── planning first, loading later ──────────────────────────────────
test('a planned tool is loaded from the log, and that entry counts on it', () => {
  const c = shop();
  c.run('ST.insertSets = [];');
  c.run("logQty(40, 0, { events: [{ stationId: ST.id, eventType: 'insert_load' }] })");
  assert.equal(c.run('ST.insertSets.length'), 1);
  assert.equal(c.run('ST.insertSets[0].corners[0].componentsMade'), 40);
  assert.equal(c.run('ST.insertSets[0].loadedBy'), 'Raj');
  assert.equal(c.run('db.inventory[0].qtyInStock'), 11, 'the load comes out of stock');
});

test('a load is ignored when inserts are already in the machine', () => {
  const c = shop();
  c.run("logQty(40, 0, { events: [{ stationId: ST.id, eventType: 'insert_load' }] })");
  assert.equal(c.run('ST.insertSets.length'), 1);
  assert.equal(c.run('db.inventory[0].qtyInStock'), 12);
});

test('an operation can be removed only while it is empty', () => {
  const c = shop();
  c.run('db.settings.trialStartedAt = isoNow();'); // owner edits need a live trial or plan
  c.run('addOperation(J.id); var OP2 = J.operations[1].id;');
  c.run('removeOperation(J.id, OP)');
  assert.equal(c.run('J.operations.length'), 2, 'the operation with a tool stays');
  c.run('removeOperation(J.id, OP2)');
  assert.equal(c.run('J.operations.length'), 1);
});

// ── a part is counted once on a multi-operation job ────────────────
function twoOps() {
  const c = shop();
  c.run(`db.settings.trialStartedAt = isoNow();
         addOperation(J.id); var OP2 = J.operations[1].id;
         logQty(50, 0);                                             // Op-1 turned 50
         logQty(48, 0, { operationId: OP2, qtyGood: 46,             // Op-2 finished 48, 2 scrapped
           rejections: [{ qty: 2, reason: 'Dimensional' }] });`);
  return c;
}

test('today and this week count the parts that left the last operation', () => {
  const c = twoOps();
  const d = JSON.parse(c.run('JSON.stringify(computeDashData())'));
  assert.equal(d.prodToday, 48, 'not 98: the same parts went through both operations');
  assert.equal(d.prodWeek, 48);
  assert.equal(d.days[6].qty, 48);
  assert.equal(c.run('jobTodayQty(J)'), 48);
  assert.equal(c.run('jobTodayQty(J, OP)'), 50, 'the log form for Op-1 shows Op-1');
});

test('rejections still add up across every operation', () => {
  const c = twoOps();
  c.run(`logQty(10, 0, { qtyGood: 9, rejections: [{ qty: 1, reason: 'Burr' }] })`); // Op-1 scrap
  const d = JSON.parse(c.run('JSON.stringify(computeDashData())'));
  assert.equal(d.rejWeek, 3);
  assert.equal(d.prodWeekAll, 108);
  const jc = JSON.parse(c.run('JSON.stringify(calcJob(J))'));
  assert.equal(jc.finalProduced, 48);
  assert.equal(jc.totalRejected, 3);
});

test('a tool being produced against with nothing loaded needs the owner', () => {
  const c = shop();
  c.run('db.settings.trialStartedAt = isoNow(); ST.insertSets = []; logQty(30, 0);');
  const att = JSON.parse(c.run('JSON.stringify(computeDashData().attention)'));
  assert.ok(att.some(a => /nothing is recorded as loaded/.test(a.msg)));
  c.run("logQty(5, 0, { events: [{ stationId: ST.id, eventType: 'insert_load' }] })");
  const after = JSON.parse(c.run('JSON.stringify(computeDashData().attention)'));
  assert.ok(!after.some(a => /nothing is recorded as loaded/.test(a.msg)), 'gone once a load is logged');
});

test('rejection reasons from Settings: one per line, blanks and repeats dropped', () => {
  const c = shop();
  c.ctx.__text = 'Dimensional\n\n  Chatter \ndimensional\nOversize bore';
  const r = JSON.parse(c.run('JSON.stringify(parseReasons(__text))'));
  assert.deepEqual(r, ['Dimensional', 'Chatter', 'Oversize bore']);
});
