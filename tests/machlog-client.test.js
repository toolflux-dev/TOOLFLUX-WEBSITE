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
