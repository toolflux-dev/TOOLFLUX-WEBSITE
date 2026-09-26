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

const KEY_PROPS = Object.assign({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'secret_x' }, PLAN_PROPS);
const mintOk = () => okResponse({ id: 'sub_NEW', short_url: 'https://rzp.io/i/abc' });

test('subscribe mints on the requested tier plan', () => {
  const env = loadGas({ props: KEY_PROPS, fetch: mintOk });
  const res = get(env, { action: 'subscribe', email: 'a@x.com', tier: 'shop' });
  assert.equal(res.ok, true);
  const body = JSON.parse(env.fetchCalls[0].payload);
  assert.equal(body.plan_id, 'plan_SHOP');
  assert.equal(body.notes.tier, 'shop');
});

test('subscribe without a tier defaults to Solo (older app builds)', () => {
  const env = loadGas({ props: KEY_PROPS, fetch: mintOk });
  get(env, { action: 'subscribe', email: 'a@x.com' });
  assert.equal(JSON.parse(env.fetchCalls[0].payload).plan_id, SOLO);
});

test('subscribe rejects an unknown tier', () => {
  const env = loadGas({ props: KEY_PROPS, fetch: mintOk });
  const res = get(env, { action: 'subscribe', email: 'a@x.com', tier: 'gold' });
  assert.equal(res.ok, false);
  assert.equal(env.fetchCalls.length, 0);
});

test('subscribe refuses a tier whose plan id is not configured', () => {
  const env = loadGas({ props: { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' }, fetch: mintOk });
  const res = get(env, { action: 'subscribe', email: 'a@x.com', tier: 'works' });
  assert.equal(res.ok, false);
  assert.equal(env.fetchCalls.length, 0);
});

function tierChangeEnv(fetchImpl) {
  const env = loadGas({ props: KEY_PROPS, fetch: fetchImpl });
  post(env, subEvent('subscription.charged', { email: 'a@x.com', subId: 'sub_A' }));                        // Solo
  post(env, subEvent('subscription.charged', { email: 'a@x.com', subId: 'sub_B', planId: 'plan_SHOP' }));   // → Shop
  return env;
}

test('new subscription replaces the stored one and cancels it at Razorpay', () => {
  const env = tierChangeEnv();
  const row = findSub(env, 'a@x.com');
  assert.equal(row[1], 'active');
  assert.equal(row[3], 'sub_B');
  assert.equal(row[4], 'plan_SHOP');
  const cancel = env.fetchCalls.find(c => /\/subscriptions\/sub_A\/cancel$/.test(c.url));
  assert.ok(cancel, 'expected a cancel call for sub_A');
  assert.equal(cancel.method, 'post');
});

test("the old subscription's cancel event does not lock the shop out", () => {
  const env = tierChangeEnv();
  const res = post(env, subEvent('subscription.cancelled', { email: 'a@x.com', subId: 'sub_A', payId: null }));
  assert.match(res, /ignored: superseded subscription sub_A/);
  assert.equal(findSub(env, 'a@x.com')[1], 'active');
});

test('a late renewal on the old subscription neither switches back nor cancels the new one', () => {
  const env = tierChangeEnv();
  post(env, subEvent('subscription.charged', { email: 'a@x.com', subId: 'sub_A' }));
  assert.equal(findSub(env, 'a@x.com')[3], 'sub_B');
  assert.equal(env.fetchCalls.filter(c => /sub_B\/cancel/.test(c.url)).length, 0);
});

test('a cancel for a subscription id we never stored is ignored', () => {
  const env = tierChangeEnv();
  assert.match(post(env, subEvent('subscription.halted', { email: 'a@x.com', subId: 'sub_Z', payId: null })), /ignored/);
  assert.equal(findSub(env, 'a@x.com')[1], 'active');
});

test('cancelling the current subscription still works', () => {
  const env = tierChangeEnv();
  assert.match(post(env, subEvent('subscription.cancelled', { email: 'a@x.com', subId: 'sub_B', payId: null })), /updated: cancelled/);
});

test('a failed Razorpay cancel is surfaced in the webhook log', () => {
  const env = tierChangeEnv(url => (/\/cancel$/.test(url)
    ? { getResponseCode: () => 400, getContentText: () => '{"error":{}}' }
    : okResponse({})));
  const last = env.rows('_WebhookLog').pop();
  assert.match(last[3], /CANCEL FAILED/);
});
