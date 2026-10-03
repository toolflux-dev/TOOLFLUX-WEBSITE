const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, subEvent, post, get, okResponse, SOLO } = require('./helpers/gas');

const PROPS = { PLAN_ID_SHOP: 'plan_SHOP', PLAN_ID_WORKS: 'plan_WORKS', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' };

// A shop with an active subscription on planId, linked to shop id 'shop-1'
function shopOn(planId, email = 'o@x.com') {
  const env = loadGas({ props: PROPS, fetch: () => okResponse({}) });
  post(env, subEvent('subscription.charged', { email, planId, subId: 'sub_' + planId }));
  get(env, { action: 'activate', email, shop: 'shop-1' });
  return env;
}

let n = 0;
function push(env, deviceId, shop = 'shop-1') {
  const body = { role: 'operator', shopId: shop, events: [{ id: 'ev' + (++n), kind: 'production' }] };
  if (deviceId !== undefined) body.deviceId = deviceId;
  return post(env, body);
}
const pull = (env, device, shop = 'shop-1') => get(env, { action: 'pull', shop, device });

test('Solo admits one operator device and refuses a second', () => {
  const env = shopOn(SOLO);
  assert.equal(push(env, 'dev1'), 'events-received');
  assert.equal(push(env, 'dev2'), 'over-limit');
  assert.equal(env.rows('_ShopEvents').length, 1);
});

test('pull tells the refused device it is over the limit', () => {
  const env = shopOn(SOLO);
  push(env, 'dev1');
  assert.equal(pull(env, 'dev2').overLimit, true);
  assert.notEqual(pull(env, 'dev1').overLimit, true);
});

test('pull keeps serving the master to an over-limit device', () => {
  const env = shopOn(SOLO);
  env.gs.writeMaster(env.ss, 'shop-1', JSON.stringify({ jobs: [{ id: 'j1' }] }));
  push(env, 'dev1');
  const m = pull(env, 'dev2');
  assert.equal(m.overLimit, true);
  assert.equal(m.jobs[0].id, 'j1');
});

test('Shop admits five devices and refuses the sixth', () => {
  const env = shopOn('plan_SHOP');
  for (let i = 1; i <= 5; i++) assert.equal(push(env, 'dev' + i), 'events-received');
  assert.equal(push(env, 'dev6'), 'over-limit');
});

test('a shop with no linked subscription (trial) is not limited', () => {
  const env = loadGas({ props: PROPS });
  for (let i = 1; i <= 7; i++) assert.equal(push(env, 'dev' + i, 'trial-shop'), 'events-received');
});

test('builds without a deviceId count as one legacy device', () => {
  const env = shopOn(SOLO);
  assert.equal(push(env, undefined), 'events-received');
  assert.equal(push(env, undefined), 'events-received');
  assert.equal(push(env, 'dev1'), 'over-limit');
});

test('downgrade: only the earliest device keeps syncing', () => {
  const env = shopOn('plan_WORKS');
  ['dev1', 'dev2', 'dev3'].forEach(d => push(env, d));
  // Customer switches to Solo on a new subscription
  post(env, subEvent('subscription.charged', { email: 'o@x.com', planId: SOLO, subId: 'sub_SOLO2' }));
  assert.equal(push(env, 'dev1'), 'events-received');
  assert.equal(push(env, 'dev2'), 'over-limit');
  assert.equal(push(env, 'dev3'), 'over-limit');
});

test('a device idle for 30+ days frees its place', () => {
  const env = shopOn(SOLO);
  push(env, 'dev1');
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  env.ss.getSheetByName('_ShopDevices').getRange(2, 4).setValue(old);
  assert.equal(push(env, 'dev2'), 'events-received');
});
