const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./helpers/client');

// loadClient() sets a company name; a brand-new install has none.
function fresh() {
  const c = loadClient();
  c.run(`db.settings.company = ''; db.settings.trialStartedAt = null; db.settings.license = null;`);
  return c;
}

// ── 1. a new visitor is not told their subscription ended ──────────
test('before setup the app is in trial, not expired', () => {
  const c = fresh();
  assert.equal(c.run('getLicenseStatus()'), 'trial');
  assert.equal(c.run('isReadOnly()'), false);
});

test('no trial banner before setup', () => {
  const c = fresh();
  assert.equal(c.run('trialBanner()'), '');
});

test('a shop that really lapsed is still read-only', () => {
  const c = loadClient();
  c.run(`db.settings.trialStartedAt = new Date(Date.now() - 40 * 86400000).toISOString(); db.settings.license = null;`);
  assert.equal(c.run('getLicenseStatus()'), 'expired');
  assert.equal(c.run('isReadOnly()'), true);
});

test('setup needs only the shop name and starts the trial without a PIN', () => {
  const c = fresh();
  c.run(`completeSetup({ company: 'Sharma Engineering Works', owner: 'Raj' })`);
  assert.equal(c.run('db.settings.company'), 'Sharma Engineering Works');
  assert.equal(c.run('db.settings.defaultOperator'), 'Raj');
  assert.equal(c.run('getLicenseStatus()'), 'trial');
  assert.equal(c.run('hasOwnerPin()'), false);
  assert.equal(c.run('db.settings.pinPromptShown'), true, 'no PIN prompt straight after setup');
});

test('setup without a shop name is refused', () => {
  const c = fresh();
  assert.equal(c.run(`completeSetup({ company: '   ', owner: 'Raj' })`), false);
  assert.equal(c.run('db.settings.company'), '');
});

// ── 2. first job in one screen ─────────────────────────────────────
test('home is the first-job screen until a job exists', () => {
  const c = loadClient();
  c.run('db.jobs = []');
  assert.equal(c.run('ownerHome()'), 'start');
  c.run(`createFirstJob({ code: 'flg-2210', opType: 'turning', cost: 420, corners: 4 })`);
  assert.equal(c.run('ownerHome()'), 'dash');
});

test('createFirstJob builds the job, its tool with inserts loaded, and no log when no batch', () => {
  const c = loadClient();
  c.run('db.jobs = []');
  c.run(`createFirstJob({ code: 'flg-2210', customer: 'Kirloskar PO 4471', opType: 'turning',
    machine: 'LT-01', insert: 'CNMG 120408 TFX-P25', cost: 420, corners: 4, operator: 'Raj' })`);
  const job = JSON.parse(c.run('JSON.stringify(db.jobs[0])'));
  assert.equal(job.componentCode, 'FLG-2210');
  assert.equal(job.customer, 'Kirloskar PO 4471');
  assert.equal(job.status, 'active');
  const st = job.operations[0].stations[0];
  assert.equal(st.opType, 'turning');
  assert.equal(st.name, 'Turning', 'station named after the operation when no name given');
  assert.equal(st.machine, 'LT-01');
  assert.equal(st.insertCostPer, 420);
  assert.equal(st.cuttingCornersPerInsert, 4);
  assert.equal(st.insertSets.length, 1);
  assert.equal(st.insertSets[0].corners[0].status, 'active');
  assert.equal(job.productionLog.length, 0);
});

test('createFirstJob with a first batch logs it against the live corner', () => {
  const c = loadClient();
  c.run('db.jobs = []');
  c.run(`createFirstJob({ code: 'HSG-0817', opType: 'face_milling', cost: 1900, corners: 4, firstQty: 120, operator: 'Raj', machine: 'VMC-01' })`);
  const job = JSON.parse(c.run('JSON.stringify(db.jobs[0])'));
  assert.equal(job.productionLog.length, 1);
  assert.equal(job.productionLog[0].qty, 120);
  assert.equal(job.productionLog[0].qtyGood, 120);
  assert.equal(job.productionLog[0].operator, 'Raj');
  assert.equal(job.operations[0].stations[0].insertSets[0].corners[0].componentsMade, 120);
});

test('createFirstJob refuses a missing code or cost and clamps the batch', () => {
  const c = loadClient();
  c.run('db.jobs = []');
  assert.equal(c.run(`createFirstJob({ code: '', opType: 'turning', cost: 420 })`), null);
  assert.equal(c.run(`createFirstJob({ code: 'X1', opType: 'turning', cost: 0 })`), null);
  assert.equal(c.run('db.jobs.length'), 0);
  c.run(`createFirstJob({ code: 'X1', opType: 'turning', cost: 420, firstQty: 99999 })`);
  assert.equal(c.run('db.jobs[0].productionLog[0].qty'), 9999);
});

// ── PIN moves to the first operator ────────────────────────────────
test('adding the first operator asks for a PIN first and adds nobody yet', () => {
  const c = loadClient();
  c.run(`db.settings.ownerPinHash = null; db.settings.operators = [];`);
  assert.equal(c.run(`needsPinForOperator()`), true);
  c.run(`db.settings.ownerPinHash = 'x'`);
  assert.equal(c.run(`needsPinForOperator()`), false);
});

test('the "PIN not set" warning only appears once operators exist', () => {
  const c = loadClient();
  c.run(`db.settings.ownerPinHash = null; db.settings.operators = [];`);
  const has = () => c.run(`computeDashData().attention.some(a => /PIN/.test(a.msg))`);
  assert.equal(has(), false);
  c.run(`db.settings.operators = [{ id: 'o1', name: 'Ravi' }]`);
  assert.equal(has(), true);
});

// ── 3. phone navigation ────────────────────────────────────────────
test('owner bottom bar has Jobs, Log, Dashboard, Team, More', () => {
  const c = loadClient();
  c.run(`db.settings.deviceRole = 'owner'`);
  assert.equal(c.run(`bottomNavItems().map(i => i.label).join(',')`), 'Jobs,Log,Dashboard,Team,More');
});

test('operator bottom bar has Jobs, Log, Shift proof', () => {
  const c = loadClient();
  c.run(`db.settings.deviceRole = 'operator'`);
  assert.equal(c.run(`bottomNavItems().map(i => i.label).join(',')`), 'Jobs,Log,Shift proof');
});

test('Log targets only active jobs, newest activity first', () => {
  const c = loadClient();
  c.run('db.jobs = []');
  // A1 was set up an hour ago and never logged; B2 was logged just now.
  c.run(`createFirstJob({ code: 'A1', opType: 'turning', cost: 100 });
         db.jobs[0].createdAt = new Date(Date.now() - 3600000).toISOString();`);
  c.run(`createFirstJob({ code: 'B2', opType: 'turning', cost: 100, firstQty: 10 });
         db.jobs[1].createdAt = new Date(Date.now() - 7200000).toISOString();`);
  c.run(`createFirstJob({ code: 'C3', opType: 'turning', cost: 100 }); db.jobs[2].status = 'complete';`);
  assert.equal(c.run(`logTargets().map(j => j.componentCode).join(',')`), 'B2,A1');
});
