import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkRace } from '../dist/network-race.js';
import { createNetworkPresentation } from '../dist/network-presentation.js';
import { makeNetworkStart, makeNetworkSnapshot } from './helpers/network-fixtures.js';

function setup() {
  const start = makeNetworkStart(), race = createNetworkRace({ start, selfPlayerId: 'self' });
  const actors = Array.from({ length: 4 }, () => ({ x: 0, z: 0, jump: 0, collected: 0, plastic: 0, metal: 0, catchTimer: 0, landingTimer: 0, landings: [] }));
  for (const actor of actors) actor.landingRipple = { trigger(x, z) { actor.landings.push({ x, z }); } };
  const items = entries => entries.map(({ x, z }) => ({ x, z, collectedBy: null, object: { visible: true } }));
  const trash = items(start.course.trash), lifesavers = items(start.course.lifesavers), effects = [];
  const presentation = createNetworkPresentation({ race, actors, trash, lifesavers, onEvent: (event, actor, item) => effects.push({ event, actor, item }) });
  return { start, race, actors, trash, lifesavers, effects, presentation };
}
function resultFixture(start) {
  return {
    raceId: start.raceId,
    participants: start.members.map(({ playerId }, index) => ({
      playerId, outcome: 'finished', rank: index + 1, finishTimeSeconds: 54 + index,
      collected: { plastic: 2, metal: 1 }, credited: { plastic: 2, metal: 1 }, settlementId: `settlement:${playerId}`,
    })),
  };
}

test('network presentation binds self to slot zero, hides empty slots and uses complete confirmed ownership', () => {
  const { start, race, actors, trash, lifesavers, presentation } = setup();
  assert.equal(actors[0].playerId, 'self'); assert.equal(actors[1].playerId, 'rival');
  assert.equal(actors[2].networkHidden, true); assert.equal(actors[3].networkHidden, true);
  assert.equal(presentation.frame(1000), null);
  const snapshot = makeNetworkSnapshot(start);
  Object.assign(snapshot.players[1], { x: 10, z: -12, collected: 1, plastic: 1 });
  snapshot.trash[0].collectedBy = 'self'; snapshot.lifesavers[0].collectedBy = 'rival';
  assert.equal(race.push(snapshot, 1000), true); presentation.frame(1000);
  assert.equal(actors[0].x, 10); assert.equal(actors[0].z, -12); assert.equal(actors[0].collected, 1);
  assert.equal(trash[0].collectedBy, 'self'); assert.equal(trash[0].object.visible, false);
  assert.equal(lifesavers[0].collectedBy, 'rival'); assert.equal(lifesavers[0].object.visible, false);
  assert.ok(trash.slice(1).every(item => item.object.visible));
  assert.ok(lifesavers.slice(1).every(item => item.object.visible));
});

test('events deduplicate visual effects and never claim pickups, change lives or award materials', () => {
  const { start, race, actors, trash, lifesavers, effects, presentation } = setup();
  race.push(makeNetworkSnapshot(start), 1000); presentation.frame(1000);
  const base = { raceId: start.raceId, tick: 1, playerId: 'self' };
  const collected = { ...base, eventId: 'collect:1', kind: 'trash.collected', itemId: start.course.trash[0].id, material: 'plastic' };
  assert.equal(presentation.event(collected), true); assert.equal(presentation.event(collected), false);
  assert.equal(effects.length, 1); assert.equal(effects[0].actor, actors[0]); assert.equal(effects[0].item, trash[0]);
  assert.equal(actors[0].catchTimer, .75); assert.equal(actors[0].collected, 0); assert.equal(actors[0].plastic, 0);
  assert.equal(trash[0].collectedBy, null); assert.equal(trash[0].object.visible, true);
  assert.equal(presentation.event({ ...base, eventId: 'life:1', kind: 'life.collected', itemId: start.course.lifesavers[0].id, lives: 3 }), true);
  assert.equal(lifesavers[0].collectedBy, null); assert.equal(lifesavers[0].object.visible, true); assert.equal(actors[0].lives, 3);
  assert.equal(presentation.event({ ...base, eventId: 'hit:1', kind: 'player.hit', cause: 'obstacle', lives: 2 }), true);
  assert.equal(actors[0].lives, 3);
  const next = makeNetworkSnapshot(start, 2); next.trash[0].collectedBy = 'self';
  Object.assign(next.players[1], { collected: 1, plastic: 1, lives: 2 });
  race.push(next, 1050); presentation.frame(1050);
  assert.equal(actors[0].collected, 1); assert.equal(actors[0].plastic, 1); assert.equal(actors[0].lives, 2); assert.equal(trash[0].object.visible, false);
});

test('unrecognized events cannot reach visual callbacks', () => {
  const { start, effects, presentation } = setup();
  const valid = { raceId: start.raceId, eventId: 'event', tick: 1, playerId: 'self', kind: 'trash.collected', itemId: start.course.trash[0].id, material: 'plastic' };
  for (const patch of [{ raceId: 'wrong' }, { playerId: 'other' }, { tick: NaN }, { tick: 1.2 }, { itemId: 'absent' }, { kind: 'profile.award' }]) {
    assert.equal(presentation.event({ ...valid, ...patch }), false);
  }
  assert.equal(effects.length, 0);
});

test('network result validates participant identities and returns self once without mutating race counters or inventory', () => {
  const { start, race, actors, trash, effects, presentation } = setup();
  race.push(makeNetworkSnapshot(start), 1000); presentation.frame(1000);
  const result = resultFixture(start);
  const wrong = structuredClone(result); wrong.participants[0].playerId = 'other'; assert.equal(presentation.result(wrong), null);
  const duplicate = structuredClone(result); duplicate.participants[0].playerId = 'self'; assert.equal(presentation.result(duplicate), null);
  const partial = structuredClone(result); partial.participants.pop(); assert.equal(presentation.result(partial), null);
  const self = presentation.result(result);
  assert.equal(self.playerId, 'self'); assert.equal(self.settlementId, 'settlement:self');
  assert.deepEqual(self.credited, { plastic: 2, metal: 1 });
  assert.equal(presentation.result(result), null); assert.equal(actors[0].collected, 0); assert.equal(actors[0].plastic, 0);
  assert.ok(trash.every(item => item.collectedBy === null)); assert.equal(effects.length, 0);
  self.credited.plastic = 99; assert.equal(result.participants[1].credited.plastic, 2);
});

test('malformed settlement IDs and impossible result totals are rejected before accepting the result', () => {
  for (const mutate of [
    result => { result.participants[0].settlementId = {}; },
    result => { delete result.participants[0].settlementId; },
    result => { result.participants[0].collected = { plastic: 103, metal: 103 }; },
  ]) {
    const { start, presentation } = setup(), result = resultFixture(start); mutate(result);
    assert.equal(presentation.result(result), null);
  }
});

test('absence of snapshots does not predict motion, consume energy or fabricate pickups', () => {
  const { start, race, actors, trash, presentation } = setup();
  const first = makeNetworkSnapshot(start, 1), second = makeNetworkSnapshot(start, 2);
  Object.assign(second.players[1], { z: -30, energy: .5, boosting: true });
  race.push(first, 1000); race.push(second, 1050); presentation.frame(2000, .1);
  const confirmed = { x: actors[0].x, z: actors[0].z, energy: actors[0].energy, collected: actors[0].collected };
  presentation.frame(60000, 10);
  assert.deepEqual({ x: actors[0].x, z: actors[0].z, energy: actors[0].energy, collected: actors[0].collected }, confirmed);
  assert.ok(trash.every(item => item.collectedBy === null));
  race.resetBuffer(); presentation.frame(60050, .05); assert.equal(actors[0].z, -30);
});

test('terminal poses snap without rendering a finished player in the air or a left player in the scene', () => {
  const { start, race, actors, presentation } = setup();
  const first = makeNetworkSnapshot(start, 1), second = makeNetworkSnapshot(start, 2);
  first.players[1].jump = 1;
  Object.assign(second.players[1], { state: 'finished', z: -900, speed: 0, jump: 0, finishTimeSeconds: 55 });
  second.players[0].state = 'left';
  race.push(first, 1000); presentation.frame(1000);
  race.push(second, 1100); presentation.frame(1100);
  assert.equal(actors[0].z, -900); assert.equal(actors[0].jump, 0); assert.equal(actors[0].finishTime, 55);
  assert.equal(actors[1].networkHidden, true); assert.equal(actors[1].disqualified, true);
});

test('visual event and resume timers decay between snapshots instead of resetting every render', () => {
  const { start, race, actors, presentation } = setup();
  race.push(makeNetworkSnapshot(start), 1000); presentation.frame(1000);
  presentation.event({ raceId: start.raceId, tick: 1, eventId: 'catch:timer', playerId: 'self', kind: 'trash.collected', itemId: start.course.trash[0].id, material: 'plastic' });
  presentation.frame(1050, .05);
  assert.ok(Math.abs(actors[0].catchTimer - .7) < 1e-12);
  const resumed = makeNetworkSnapshot(start, 2);
  Object.assign(resumed.players[1], { catchTimer: .5, landingTimer: .4 });
  race.push(resumed, 1100); presentation.frame(1100);
  assert.equal(actors[0].catchTimer, .5); assert.equal(actors[0].landingTimer, .4);
  presentation.frame(1200, .1);
  assert.ok(Math.abs(actors[0].catchTimer - .4) < 1e-12);
  assert.ok(Math.abs(actors[0].landingTimer - .3) < 1e-12);
});
