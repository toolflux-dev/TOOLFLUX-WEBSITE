const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas, subEvent, standalonePayment, post, get } = require('./helpers/gas');

const findSub = (env, email) => env.rows('_Subscriptions').find(r => String(r[0]).toLowerCase() === email) || null;

test('wrong secret is rejected and logged', () => {
  const env = loadGas();
  assert.equal(post(env, subEvent('subscription.charged', { email: 'a@x.com' }), 'wrong'), 'unauthorized');
  assert.equal(findSub(env, 'a@x.com'), null);
  assert.match(env.rows('_WebhookLog')[0][3], /REJECTED/);
});

test('missing wh_secret is rejected with the fix hint', () => {
  const env = loadGas();
  assert.equal(post(env, subEvent('subscription.charged', { email: 'a@x.com' }), ''), 'unauthorized');
  assert.match(env.rows('_WebhookLog')[0][3], /wh_secret/);
});

test('subscription.charged activates with current_end + 2 day expiry', () => {
  const env = loadGas();
  assert.match(post(env, subEvent('subscription.charged', { email: 'a@x.com' })), /created: active/);
  const row = findSub(env, 'a@x.com');
  assert.equal(row[1], 'active');
  assert.equal(row[3], 'sub_A');
  const days = (new Date(row[2]) - Date.now()) / 86400000;
  assert.ok(days > 31 && days < 33, 'expiry ' + days.toFixed(1) + ' days');
});

test('standalone payment.captured (Wix sale) grants nothing', () => {
  const env = loadGas();
  assert.match(post(env, standalonePayment('buyer@x.com')), /ignored: standalone payment/);
  assert.equal(findSub(env, 'buyer@x.com'), null);
});

test('a plan that is not ours is ignored', () => {
  const env = loadGas();
  assert.match(post(env, subEvent('subscription.charged', { email: 'o@x.com', planId: 'plan_OTHER' })), /ignored: different plan/);
  assert.equal(findSub(env, 'o@x.com'), null);
});

test('replayed payment is rejected', () => {
  const env = loadGas();
  const ev = subEvent('subscription.charged', { email: 'a@x.com', payId: 'pay_FIXED' });
  post(env, ev);
  assert.match(post(env, ev), /duplicate/);
});

test('cancellation drops the customer to read-only', () => {
  const env = loadGas();
  post(env, subEvent('subscription.charged', { email: 'a@x.com' }));
  assert.match(post(env, subEvent('subscription.cancelled', { email: 'a@x.com', payId: null })), /updated: cancelled/);
  assert.equal(findSub(env, 'a@x.com')[1], 'cancelled');
});

test('activation after a real charge returns a TF token', () => {
  const env = loadGas();
  post(env, subEvent('subscription.charged', { email: 'a@x.com' }));
  const act = get(env, { action: 'activate', email: 'a@x.com' });
  assert.equal(act.valid, true);
  assert.match(act.token, /^TF[0-9A-F]{64}$/);
});

test('whlog requires the webhook secret', () => {
  const env = loadGas();
  post(env, subEvent('subscription.charged', { email: 'a@x.com' }));
  assert.equal(get(env, { action: 'whlog', wh_secret: 'nope' }).error, 'Unauthorized');
  assert.ok(get(env, { action: 'whlog', wh_secret: env.secret }).deliveries.length > 0);
});
