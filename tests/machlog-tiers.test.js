const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, subEvent, post, get, okResponse, SOLO } = require('./helpers/gas');

const PLAN_PROPS = { PLAN_ID_SHOP: 'plan_SHOP', PLAN_ID_WORKS: 'plan_WORKS' };
const findSub = (env, email) => env.rows('_Subscriptions').find(r => String(r[0]).toLowerCase() === email) || null;

test('plan ids map to tiers', () => {
  const { gs } = loadGas({ props: PLAN_PROPS });
  assert.equal(gs.tierForPlan(SOLO), 'solo');
  assert.equal(gs.tierForPlan('plan_SHOP'), 'shop');
  assert.equal(gs.tierForPlan('plan_WORKS'), 'works');
  assert.equal(gs.tierForPlan('plan_OTHER'), '');
  assert.equal(gs.tierForPlan(''), '');
});

test('an unset Shop plan id maps nothing', () => {
  const { gs } = loadGas();
  assert.equal(gs.planIdForTier('shop'), '');
  assert.equal(gs.tierForPlan(''), '');
});

test('device limits per tier', () => {
  const { gs } = loadGas();
  assert.equal(gs.TIER_DEVICE_LIMIT.solo, 1);
  assert.equal(gs.TIER_DEVICE_LIMIT.shop, 5);
  assert.ok(gs.TIER_DEVICE_LIMIT.works >= 1e9);
});

test('webhook accepts Shop and Works plans', () => {
  const env = loadGas({ props: PLAN_PROPS });
  assert.match(post(env, subEvent('subscription.charged', { email: 's@x.com', planId: 'plan_SHOP' })), /created: active/);
  assert.match(post(env, subEvent('subscription.charged', { email: 'w@x.com', planId: 'plan_WORKS', subId: 'sub_W' })), /created: active/);
});
