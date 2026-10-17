import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSurvival, freshChase, takeHit, tickProtection, recoverLife, advanceChase, resolveChaseContact, touchesPickup } from '../dist/survival.js';
const surfer = () => ({ ...freshSurvival(), index: 0, finishTime: null });
test('three separated hits disqualify; simultaneous hits only cost one life', () => {
  const s = surfer(); assert.ok(takeHit(s)); assert.equal(s.lives, 2);
  assert.equal(takeHit(s), false); assert.equal(s.lives, 2);
  tickProtection(s, 3); assert.ok(takeHit(s)); tickProtection(s, 3); assert.ok(takeHit(s));
  assert.equal(s.lives, 0); assert.equal(s.disqualified, true);
  tickProtection(s, 3); assert.equal(takeHit(s), false);
});
test('lifesavers are single-owner, do not exceed three or revive eliminated racers', () => {
  const s = surfer(), ring = { collectedBy: null };
  assert.equal(recoverLife(s, ring), false); assert.equal(ring.collectedBy, null);
  takeHit(s); assert.ok(recoverLife(s, ring)); assert.equal(s.lives, 3);
  const other = { ...surfer(), index: 1, lives: 1 };
  assert.equal(recoverLife(other, ring), false); assert.equal(other.lives, 1);
  s.lives = 0; s.disqualified = true;
  assert.equal(recoverLife(s, { collectedBy: null }), false);
});
test('slow movement closes the gap, boost opens it, and startup has grace', () => {
  const chase = freshChase(); advanceChase(chase, 0, 1, 2); assert.equal(chase.gap, 48);
  advanceChase(chase, 8, 1, 10); assert.ok(chase.gap < 48);
  const close = chase.gap; advanceChase(chase, 23, 1, 11); assert.ok(chase.gap > close);
});
test('octopus retreats after one hit, including during collision protection', () => {
  for (const protectedByRock of [false, true]) {
    const s = surfer(); if (protectedByRock) takeHit(s);
    const chase = { gap: 3.5, retreat: 0 };
    resolveChaseContact(chase, s); assert.equal(s.lives, 2); assert.equal(chase.retreat, 3);
    assert.equal(resolveChaseContact(chase, s), false);
    advanceChase(chase, 0, 1, 20); assert.ok(chase.gap > 10);
  }
});
test('fast crossings still collect lifesavers; finished racers cannot lose or gain lives', () => {
  assert.ok(touchesPickup({x:0,z:0},{x:0,z:-10},{x:1,z:-5}));
  assert.equal(touchesPickup({x:0,z:0},{x:0,z:-10},{x:4,z:-5}),false);
  const s = { ...surfer(), lives: 2, finishTime: 55 };
  assert.equal(takeHit(s),false); assert.equal(recoverLife(s,{collectedBy:null}),false);
});
