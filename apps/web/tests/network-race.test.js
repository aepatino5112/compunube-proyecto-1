import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkRace } from '../dist/network-race.js';
import { COURSE_LENGTH } from '../dist/maps.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';
import { makeNetworkStart as startFixture, makeNetworkSnapshot as snapshotFixture } from './helpers/network-fixtures.js';

test('network race sanitizes immutable start, honors manifest positions and orders self first', () => {
  const raw = startFixture(); raw.course.trash[0].x = 12.125; raw.extra = 'ignored';
  const race = createNetworkRace({ start: raw, selfPlayerId: 'self' });
  assert.equal(race.start.course.trash[0].x, 12.125);
  assert.deepEqual(race.members.map(entry => entry.playerId), ['self', 'rival']);
  assert.deepEqual(race.start.members.map(entry => entry.playerId), ['rival', 'self']);
  assert.equal(race.start.extra, undefined); assert.equal(race.sample(), null);
  raw.course.trash[0].x = 0; raw.members[1].equipment.board = 'sol';
  assert.equal(race.start.course.trash[0].x, 12.125); assert.equal(race.members[0].equipment.board, 'coral');
  assert.throws(() => { race.members[0].equipment.board = 'sol'; }, TypeError);
});

test('incompatible courses, duplicate IDs, missing self and unavailable appearance fail before rendering', () => {
  const cases = [
    raw => { raw.protocolVersion = 2; }, raw => { raw.course.mapId = 'caroni'; },
    raw => { raw.course.lateralLimitMeters = 18; }, raw => { raw.course.lengthMeters = 900; },
    raw => { raw.course.trash.pop(); }, raw => { raw.course.obstacles[0].id = raw.course.trash[0].id; },
    raw => { raw.members[1].playerId = 'rival'; }, raw => { raw.members.pop(); },
    raw => { raw.members[1].equipment.board = 'inexistente'; }, raw => { raw.members[1].appearance.skin = 'purple'; },
    raw => { raw.course.obstacles[0].x = NaN; }, raw => { raw.members[1].ready = 'yes'; },
    raw => { raw.course.trash[0].x = 1e200; }, raw => { raw.course.obstacles[0].z = -1801; },
    raw => { raw.course.lifesavers[0].z = 51; },
    raw => { delete raw.course.trash[0]; }, raw => { delete raw.members[0]; },
  ];
  for (const change of cases) {
    const start = startFixture(); change(start);
    assert.throws(() => createNetworkRace({ start, selfPlayerId: 'self' }), TypeError);
  }
});

test('snapshot acceptance is atomic, rejects stale/wrong race and does not retain input DTO references', () => {
  const start = startFixture(), race = createNetworkRace({ start, selfPlayerId: 'self' });
  const first = snapshotFixture(start, 10); assert.equal(race.push(first, 1000), true);
  assert.equal(race.receivedAt, 1000);
  first.players[0].x = 14; first.trash[0].collectedBy = 'rival';
  assert.equal(race.latest.players[1].x, 0); assert.equal(race.latest.trash[0].collectedBy, null);
  for (const bad of [snapshotFixture(start, 10), snapshotFixture(start, 9), { ...snapshotFixture(start, 11), raceId: 'other' }]) {
    assert.equal(race.push(bad, 1100), false); assert.ok(race.error); assert.equal(race.latest.tick, 10);
    assert.equal(race.receivedAt, 1000);
  }
  assert.equal(race.push(snapshotFixture(start, 11), 1100), true); assert.equal(race.error, null);
});

test('invalid numbers, duplicate players and incomplete or unknown ownership cannot enter snapshot buffer', () => {
  const start = startFixture(), race = createNetworkRace({ start, selfPlayerId: 'self' });
  const cases = [
    raw => { raw.tick = '1'; }, raw => { raw.tick = 1.5; }, raw => { raw.elapsedSeconds = Infinity; },
    raw => { raw.players[0].x = NaN; }, raw => { raw.players[0].energy = 1.1; },
    raw => { raw.players[0].z = -1e200; }, raw => { raw.players[0].z = 51; },
    raw => { raw.players[0].lives = 4; }, raw => { raw.players[0].netSide = 0; },
    raw => { raw.players[0].netAngle = NET_LEFT_ANGLE + 1; }, raw => { raw.players[0].plastic = 1; },
    raw => { raw.players[1].playerId = raw.players[0].playerId; }, raw => { raw.players.pop(); },
    raw => { raw.trash.pop(); }, raw => { raw.lifesavers.pop(); },
    raw => { raw.trash[0].itemId = 'trash:unknown'; }, raw => { raw.trash[1].itemId = raw.trash[0].itemId; },
    raw => { raw.trash[0].collectedBy = 'outsider'; }, raw => { raw.pursuits[0].targetPlayerId = 'outsider'; },
    raw => { delete raw.players[0]; }, raw => { delete raw.trash[0]; },
  ];
  for (const change of cases) {
    const snapshot = snapshotFixture(start); change(snapshot);
    assert.equal(race.push(snapshot, 1000), false); assert.equal(race.latest, null); assert.ok(race.error);
  }
  assert.equal(race.push(snapshotFixture(start), NaN), false);
  assert.equal(race.push(snapshotFixture(start), 1000), true);
});

test('interpolation delays only poses and clamps both ends without replaying ownership or counters', () => {
  const start = startFixture(); let time = 1000;
  const race = createNetworkRace({ start, selfPlayerId: 'self', now: () => time, interpolationMs: 100 });
  const first = snapshotFixture(start, 1), second = snapshotFixture(start, 2);
  const a = first.players[1], b = second.players[1];
  Object.assign(a, { x: 2, z: -10, speed: 10, turn: -.5, netAngle: 0, jump: 0, jumpVelocity: 4 });
  Object.assign(b, { x: 10, z: -30, speed: 20, turn: .5, netAngle: NET_LEFT_ANGLE, jump: 2, jumpVelocity: -4, energy: .8, netSide: -1, collected: 1, plastic: 1, lives: 2, catchTimer: .7, protection: 2 });
  second.trash[0].collectedBy = 'self';
  assert.equal(race.push(first), true); time = 1100; assert.equal(race.push(second), true);
  const middle = race.sample(1150), self = middle.players[0];
  assert.equal(self.x, 6); assert.equal(self.z, -20); assert.equal(self.speed, 15); assert.equal(self.turn, 0);
  assert.equal(self.netAngle, NET_LEFT_ANGLE / 2); assert.equal(self.jump, 1); assert.equal(self.jumpVelocity, 0);
  assert.equal(self.energy, .8); assert.equal(self.lives, 2); assert.equal(self.netSide, -1); assert.equal(self.collected, 1);
  assert.equal(self.catchTimer, .7); assert.equal(middle.trash[0].collectedBy, 'self'); assert.equal(middle.tick, 2);
  assert.ok(Math.abs(middle.elapsedSeconds - .075) < 1e-12);
  assert.equal(race.sample(0).players[0].x, 2); assert.equal(race.sample(9999).players[0].x, 10);
  middle.players[0].x = 99; middle.trash[0].collectedBy = null;
  assert.equal(race.latest.players[0].x, 10); assert.equal(race.latest.trash[0].collectedBy, 'self');
});

test('reconnect clears visual history but preserves tick watermark and confirmed objects', () => {
  const start = startFixture(), race = createNetworkRace({ start, selfPlayerId: 'self' });
  const first = snapshotFixture(start, 4); first.trash[0].collectedBy = 'rival';
  assert.equal(race.push(first, 1000), true); race.resetBuffer();
  assert.equal(race.sample(2000).trash[0].collectedBy, 'rival');
  assert.equal(race.push(snapshotFixture(start, 3), 2000), false);
  const second = snapshotFixture(start, 5); second.players[1].x = 10;
  assert.equal(race.push(second, 2000), true); assert.equal(race.sample(2000).players[0].x, 10);
  assert.equal(race.push(snapshotFixture(start, 6), 1999), false);
});

test('coincident receive times do not divide by zero and finished state is confirmed immediately', () => {
  const start = startFixture(), race = createNetworkRace({ start, selfPlayerId: 'self' });
  race.push(snapshotFixture(start, 1), 1000);
  const last = snapshotFixture(start, 2); last.state = 'ended';
  Object.assign(last.players[1], { state: 'finished', finishTimeSeconds: 55, z: -COURSE_LENGTH });
  assert.equal(race.push(last, 1000), true);
  const sample = race.sample(1000);
  assert.equal(sample.state, 'ended'); assert.equal(sample.players[0].state, 'finished');
  assert.equal(sample.players[0].finishTimeSeconds, 55); assert.equal(sample.players[0].z, -COURSE_LENGTH);
});

test('terminal participants snap to authoritative pose even inside the interpolation delay', () => {
  for (const state of ['finished', 'disqualified', 'left']) {
    const start = startFixture(), race = createNetworkRace({ start, selfPlayerId: 'self' });
    const first = snapshotFixture(start, 1), last = snapshotFixture(start, 2);
    Object.assign(first.players[1], { x: 3, z: -850, speed: 16, turn: .5, netAngle: .2, jump: 1, jumpVelocity: -2 });
    Object.assign(last.players[1], { state, x: 8, z: state === 'finished' ? -900 : -870, speed: 0, turn: 0, netAngle: 1, jump: 0, jumpVelocity: 0, lives: state === 'disqualified' ? 0 : 3, finishTimeSeconds: state === 'finished' ? 55 : null });
    assert.equal(race.push(first, 1000), true); assert.equal(race.push(last, 1100), true);
    const pose = race.sample(1100).players[0];
    for (const field of ['x', 'z', 'speed', 'turn', 'netAngle', 'jump', 'jumpVelocity']) assert.equal(pose[field], last.players[1][field]);
  }
});
