import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import * as survival from '../dist/survival.js';
import * as mechanics from '../dist/mechanics.js';
import { collectTrash } from '../dist/collection.js';
import { advanceNetAngle } from '../dist/surf-motion.js';
import { createFrameClock } from '../dist/frame-clock.js';
import { createCourse, COURSE_LENGTH as LENGTH, COURSE_WIDTH as WIDTH } from '../dist/maps.js';

// Execute the actual game functions without importing its WebGL bootstrap.
// Only presentation objects are stubbed: this does not measure rendering or FPS.
const source = readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `No se encuentra el bloque real: ${from}`);
  return source.slice(start, end);
}
const simulation = section('function showHit(', '// A bounded pool');
const lifecycle = section('function reset()', 'function jump()');

function fixture(map = 'maracaibo', clearObstacles = false) {
  const course = createCourse(map);
  let seed = course.seed;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rotation = () => ({ set() {} });
  const surfers = [3, -5, 7, -10].map((x, index) => {
    for (let i = 0; i < 36; i++) random();
    return {
      ...survival.freshSurvival(), index, x, z: [0, -3, -7, -10][index],
      startX: x, startZ: [0, -3, -7, -10][index], phase: random() * 6,
      speed: 0, turn: 0, netSide: 1, netAngle: 0, energy: 0, boosting: false,
      jump: 0, jumpVelocity: 0, hit: 0, collected: 0, plastic: 0, metal: 0,
      catchTimer: 0, dripped: false, finishTime: null, landingTimer: 0,
      group: { rotation: rotation() }, body: { rotation: rotation() },
      net: { group: { rotation: rotation(), position: { set() {} } },
        catchVisual: { visible: false, children: Array.from({ length: 3 }, () => ({ visible: false })) } },
      shield: { visible: false }, wakeEffect: { reset() {} }, motion: { reset() {} },
      landingRipple: { trigger() {}, reset() {} }, animation: { reset() {}, update() {} },
    };
  });
  const nodes = new Map(), results = [];
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { classList: { remove() {}, add() {} }, offsetWidth: 0, focus() {}, setAttribute() {} });
    return nodes.get(id);
  };
  const context = {
    THREE, crypto, ...survival, ...mechanics, advanceNetAngle, collectTrash, LENGTH, WIDTH,
    state: 'running', elapsed: 0, countdown: 3, visualTime: 0, toastTimer: 0, networkRace:null,
    player: surfers[0], surfers, keys: new Set(), chase: survival.freshChase(),
    trash: course.trash.map(item => ({ ...item, collectedBy: null, object: { visible: true } })),
    lifesavers: course.lifesavers.map(item => ({ ...item, collectedBy: null, object: { visible: true } })),
    obstacles: clearObstacles ? [] : course.obstacles, reducedMotion: { matches: true },
    pickupEffects: { reset() {}, burst() {} }, boardFoam: { reset() {} },
    audio: { cue() {}, update() {}, unlock() {} }, chaseView: { feedback() {}, reset() {} },
    notify() {}, updateUi() {}, $: element, host: { focus() {} },
    trashKinds: ['Botella', 'Tubo', 'Envoltorio'], raceId: 'audit-race',
    onFinish(result) { results.push(result); }, camera: { fov: 48, updateProjectionMatrix() {} },
    frameClock: createFrameClock(), pausedFrom: 'running', suspended: false,
    drops: [{ life: 0 }], droplets: { count: 0 }, renderDirty: false, cameraChanged: false,
  };
  vm.createContext(context);
  vm.runInContext(simulation + '\n' + lifecycle, context);
  return { context, results, nodes };
}

function runCleanRace(map, fps) {
  const f = fixture(map, true), { context: c } = f, clock = createFrameClock();
  clock.tick(0, true, () => {});
  for (let frame = 1; frame <= fps * 75; frame++) {
    clock.tick(frame * 1000 / fps, c.state === 'running', dt => {
      c.simulate(dt);
      return c.state === 'running';
    });
  }
  return f;
}

test('actual simulation reaches both finish lines once and preserves finite shared pickups at 15/60 FPS', () => {
  for (const map of ['maracaibo', 'orinoco']) {
    const baseline = runCleanRace(map, 60), slower = runCleanRace(map, 15);
    for (const { context: c, results } of [baseline, slower]) {
      assert.equal(c.state, 'finished');
      assert.equal(c.player.z, -LENGTH);
      assert.ok(c.elapsed > 50 && c.elapsed < 60);
      assert.equal(results.length, 1);
      assert.equal(results[0].plastic, c.player.plastic);
      assert.equal(results[0].metal, c.player.metal);
      assert.equal(c.surfers.reduce((sum, racer) => sum + racer.collected, 0), c.trash.filter(item => item.collectedBy !== null).length);
      assert.ok(c.surfers.reduce((sum, racer) => sum + racer.collected, 0) <= 103);
      for (const racer of c.surfers.filter(racer => racer.finishTime !== null)) assert.equal(racer.boosting, false);
    }
    assert.equal(slower.context.elapsed, baseline.context.elapsed);
    assert.equal(slower.context.player.collected, baseline.context.player.collected);
  }
});

test('actual obstacle elimination does not settle a result and reset restores the same finite course', () => {
  for (const map of ['maracaibo', 'orinoco']) {
    const { context: c, results } = fixture(map);
    c.player.lives = 1;
    c.obstacles = [{ x: c.player.x, z: c.player.z, radius: 1.8 }];
    c.simulate(1 / 60);
    assert.equal(c.player.lives, 0);
    assert.equal(c.player.disqualified, true);
    assert.equal(c.state, 'finished');
    assert.equal(results.length, 0);
    c.trash[0].collectedBy = 0; c.trash[0].object.visible = false;
    c.drops[0].life = 1; c.droplets.count = 1; c.keys.add('ShiftLeft');
    c.reset();
    assert.equal(c.state, 'ready'); assert.equal(c.elapsed, 0); assert.equal(c.keys.size, 0);
    assert.equal(c.drops[0].life, 0); assert.equal(c.droplets.count, 0);
    assert.ok(c.trash.every(item => item.collectedBy === null && item.object.visible));
    assert.ok(c.surfers.every(racer => racer.lives === 3 && !racer.disqualified && racer.finishTime === null && racer.collected === 0 && racer.x === racer.startX && racer.z === racer.startZ));
  }
});

test('actual pause resumes countdown in place, releases inputs and retry creates a new race id', () => {
  const { context: c, nodes } = fixture();
  c.reset(); c.start(); const firstId = c.raceId;
  c.countdown = 1.4; c.keys.add('ArrowRight'); c.pause();
  assert.equal(c.state, 'paused'); assert.equal(c.pausedFrom, 'countdown');
  assert.equal(c.keys.size, 0); assert.equal(nodes.get('countdown').textContent, 'Pausa');
  c.pause();
  assert.equal(c.state, 'countdown'); assert.equal(c.countdown, 1.4);
  c.state = 'running'; c.pause(); c.pause(); assert.equal(c.state, 'running');
  c.state = 'finished'; c.start();
  assert.equal(c.state, 'countdown'); assert.notEqual(c.raceId, firstId);
});
