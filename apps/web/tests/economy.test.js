import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, restoreProfile, transact } from '../dist/economy.js';

test('a finished race credits each material once, and survives persistence', () => {
  const action = { type: 'finish', raceId: 'race-1', plastic: 12, metal: 7 };
  const { profile, error } = transact(freshProfile(), action);
  assert.equal(error, null); assert.equal(profile.plastic, 12); assert.equal(profile.metal, 7);
  const restored = restoreProfile(JSON.parse(JSON.stringify(profile)));
  const duplicate = transact(restored, action);
  assert.ok(duplicate.error); assert.deepEqual(duplicate.profile, profile); assert.equal(profile.races, 1);
});
test('crafting and recycling compete for the same finite material', () => {
  const initial = { ...freshProfile(), plastic: 6, metal: 3 };
  const crafted = transact(initial, { type: 'craft', id: 'red-reuso' });
  assert.equal(crafted.error, null); assert.equal(crafted.profile.plastic, 0); assert.equal(crafted.profile.metal, 0);
  assert.equal(crafted.profile.equipped.net, 'red-base');
  assert.ok(transact(crafted.profile, { type: 'exchange', material: 'metal', amount: 1 }).error);
  const equipped = transact(crafted.profile, { type: 'equip', id: 'red-reuso' });
  assert.equal(equipped.profile.equipped.net, 'red-reuso');
  const recycled = transact(initial, { type: 'exchange', material: 'plastic', amount: 6 });
  assert.equal(recycled.profile.coins, 24);
  const failed = transact(recycled.profile, { type: 'craft', id: 'red-reuso' });
  assert.ok(failed.error); assert.deepEqual(failed.profile, recycled.profile);
  assert.equal(initial.plastic, 6);
});
test('buy, ownership and equip are distinct, failed transactions spend nothing', () => {
  let profile = { ...freshProfile(), coins: 60 };
  const bought = transact(profile, { type: 'buy', id: 'manglar' });
  assert.equal(bought.profile.coins, 0); assert.equal(bought.profile.equipped.board, 'coral');
  assert.ok(bought.profile.owned.includes('manglar'));
  assert.ok(transact(bought.profile, { type: 'buy', id: 'manglar' }).error);
  assert.ok(transact(bought.profile, { type: 'equip', id: 'sol' }).error);
  profile = transact(bought.profile, { type: 'equip', id: 'manglar' }).profile;
  assert.equal(profile.equipped.board, 'manglar');
  assert.ok(transact(profile, { type: 'buy', id: 'brisa' }).error);
});
test('negative, fractional, invalid and excessive exchanges cannot grant money', () => {
  const profile = { ...freshProfile(), plastic: 5 };
  for (const amount of [-2, 0, .5, NaN, Infinity, 6]) {
    const result = transact(profile, { type: 'exchange', material: 'plastic', amount });
    assert.ok(result.error); assert.deepEqual(result.profile, profile);
  }
  assert.ok(transact(profile, { type: 'exchange', material: 'coins', amount: 1 }).error);
});
test('malformed saves restore a valid equipped inventory', () => {
  const restored = restoreProfile({ version: 1, coins: -10, plastic: '50', metal: 3, owned: ['fake', 'manglar'], equipped: { board: 'fake', net: 'manglar' }, settled: 'bad' });
  assert.equal(restored.coins, 0); assert.equal(restored.plastic, 0); assert.equal(restored.metal, 3);
  assert.equal(restored.equipped.board, 'coral'); assert.equal(restored.equipped.net, 'red-base');
  assert.ok(!restored.owned.includes('fake'));
});
