const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, TOKEN } = require('./helpers/client');

function licensed(c, tier) {
  c.run(`db.settings.license = { token: '${TOKEN}', email: 'o@x.com',
    expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    lastVerified: new Date().toISOString() ${tier ? `, tier: '${tier}'` : ''} };`);
}

// Arrays built inside the vm belong to another realm, so deepStrictEqual
// rejects them on prototype identity — compare as JSON or value by value.
test('TIERS mirror the server limits and prices', () => {
  const c = loadClient();
  assert.equal(c.run('JSON.stringify([TIERS.solo.price, TIERS.shop.price, TIERS.works.price])'), '[299,799,2499]');
  assert.equal(c.run('JSON.stringify([TIERS.solo.devices, TIERS.shop.devices])'), '[1,5]');
  assert.equal(c.run('TIERS.works.devices'), Infinity);
  assert.equal(c.run(`TIER_ORDER.join(',')`), 'solo,shop,works');
});

test('trial runs at Works level', () => {
  const c = loadClient();
  c.run('db.settings.license = null; db.settings.trialStartedAt = new Date().toISOString();');
  assert.equal(c.run('getTier()'), 'works');
});

test('a licence carries its tier; one from before tiers is Solo', () => {
  const c = loadClient();
  licensed(c, 'shop');
  assert.equal(c.run('getTier()'), 'shop');
  licensed(c, null);
  assert.equal(c.run('getTier()'), 'solo');
});

test('sanitizeLicense keeps a known tier and drops a bogus one', () => {
  const c = loadClient();
  licensed(c, 'works');
  assert.equal(c.run('sanitizeLicense(db.settings.license).tier'), 'works');
  licensed(c, 'platinum');
  assert.equal(c.run('sanitizeLicense(db.settings.license).tier'), null);
});

test('canAddOperator follows the tier limit', () => {
  const c = loadClient();
  licensed(c, 'solo');
  c.run('db.settings.operators = [];');
  assert.equal(c.run('canAddOperator()'), true);
  c.run(`db.settings.operators = [{ id: 'a', name: 'Ravi' }];`);
  assert.equal(c.run('canAddOperator()'), false);
});

test('nextTierFor picks the smallest tier that fits', () => {
  const c = loadClient();
  assert.equal(c.run('nextTierFor(0)'), 'solo');
  assert.equal(c.run('nextTierFor(1)'), 'solo');
  assert.equal(c.run('nextTierFor(2)'), 'shop');
  assert.equal(c.run('nextTierFor(6)'), 'works');
});

test('subscribeLabel formats the price', () => {
  const c = loadClient();
  assert.equal(c.run(`subscribeLabel('works')`), 'Subscribe — Works ₹2,499 / month');
});

test('licenseQuery carries email and shop id', () => {
  const c = loadClient();
  const q = c.run(`licenseQuery('o@x.com')`);
  assert.match(q, /^&email=o%40x\.com&shop=[A-Za-z0-9_-]+$/);
});

test('licenseFromActivation keeps a known tier, defaults to Solo', () => {
  const c = loadClient();
  assert.equal(c.run(`licenseFromActivation({ token: '${TOKEN}', tier: 'shop' }, 'o@x.com').tier`), 'shop');
  assert.equal(c.run(`licenseFromActivation({ token: '${TOKEN}' }, 'o@x.com').tier`), 'solo');
  assert.equal(c.run(`licenseFromActivation({ token: '${TOKEN}', tier: 'x' }, 'o@x.com').tier`), 'solo');
});

test('verification adopts a changed tier and sends the shop id', async () => {
  const c = loadClient();
  licensed(c, 'solo');
  c.run(`db.settings.license.lastVerified = new Date(Date.now() - 5 * 86400000).toISOString();`);
  c.ctx.__nextJson = { valid: true, tier: 'works', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() };
  c.run('verifyLicenseIfNeeded(true)');
  await c.flush(); await c.flush();
  assert.equal(c.run('db.settings.license.tier'), 'works');
  assert.match(c.fetchCalls[0].url, /&shop=/);
});

function operator(c) {
  c.run(`db.settings.deviceRole = 'operator'; db.settings.shopId = 'shop-1';
         db.outbox = [{ id: 'e1', kind: 'production', jobId: 'j', entry: { id: 'e1' } }];`);
}

test('operator upload carries this device id', () => {
  const c = loadClient();
  operator(c);
  c.run('operatorSyncTick()');
  const push = c.fetchCalls.find(f => f.opts.method === 'POST');
  const body = JSON.parse(push.opts.body);
  assert.equal(body.deviceId, c.run('db.settings.installId'));
});

test('operator pull asks as this device', () => {
  const c = loadClient();
  operator(c);
  c.run('operatorSyncTick()');
  const pull = c.fetchCalls.find(f => /action=pull/.test(f.url));
  assert.match(pull.url, new RegExp('&device=' + c.run('db.settings.installId')));
});

test('an over-limit pull flags the device and keeps its queue', async () => {
  const c = loadClient();
  operator(c);
  c.ctx.__nextJson = { overLimit: true, jobs: [] };
  c.run('operatorSyncTick()');
  await c.flush(); await c.flush();
  assert.equal(c.run('db.settings.overLimit'), true);
  assert.equal(c.run('syncStatusInfo().state'), 'blocked');
  assert.equal(c.run('db.outbox.length'), 1);
});

test('a later normal pull clears the flag', async () => {
  const c = loadClient();
  operator(c);
  c.run('db.settings.overLimit = true;');
  c.ctx.__nextJson = { jobs: [] };
  c.run('operatorSyncTick()');
  await c.flush(); await c.flush();
  assert.equal(c.run('db.settings.overLimit'), false);
});
