import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MAPS, findMap, createCourse} from '../dist/maps.js';

// Exercise the actual bridge functions without starting WebGL or substituting
// multiplayer simulation. Rendering/UI nodes are the only stubs in this fixture.
const source = readFileSync(new URL('../dist/game.js', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `No se encuentra el bloque real: ${from}`);
  return source.slice(start, end);
}
const controls = section('function pause()', 'function notify(');
const listeners = section('const controls = new Set(', 'for (const [id, key]');
const simulation = section('function simulate(dt)', 'function netReach(');
const networkFrame = section('function updateNetworkFrame(', 'function enterOnline(');
const mapSelection = section('function selectMap(', '// Finish gate');

function fixture() {
  let now = 100;
  const sent = [], cues = [], nodes = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden: false, setAttribute() {}});
    return nodes.get(id);
  };
  const c = {
    state: 'running', menuActive: false, suspended: false, raceId: 'race-online',
    elapsed: 12, countdown: 2, pausedFrom: 'running', networkRace: {receivedAt: 100},
    networkConnected: true, networkWasLive: false, networkReconnecting: false, networkResultReceived: false,
    networkNote: {hidden: true, textContent: ''}, networkPresentation: {frame() {return null;}},
    chaseView: {setPursuitVisible() {}}, chase: {},
    inputSeq: 0, jumpSeq: 0, requestedNetSide: 1, lastInputAt: -Infinity,
    player: {x: 3, z: -30, lives: 3, jump: 0, jumpVelocity: 0, netSide: 1, finishTime: null,
      disqualified: false, collected: 4, plastic: 3, metal: 1, energy: .7, boosting: false},
    keys: new Set(), performance: {now: () => now},
    onInput(value) {sent.push(structuredClone(value)); return true;},
    audio: {cue: name => cues.push(name), update() {}, unlock() {}},
    frameClock: {reset() {}}, host: {focus() {}}, updateUi() {}, $: element,
    onFinish() {throw Error('Online must not settle the local profile.');},
    document: {hidden: false, querySelector() {return null;}, addEventListener: (event, handler) => documentEvents.set(event, handler)},
    window: {addEventListener: (event, handler) => windowEvents.set(event, handler)},
    HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLButtonElement: class {},
    setCamera() {}, cameraMode: 'third',
  };
  vm.createContext(c); vm.runInContext(controls + '\n' + simulation + '\n' + listeners + '\n' + networkFrame, c);
  return {c, sent, cues, nodes, windowEvents, documentEvents, at(value) {now = value;}};
}

test('actual online simulate guard cannot advance physics, pickups or credit the local profile', () => {
  const {c} = fixture();
  const initial = structuredClone(c.player);
  c.player.z = -900; c.player.finishTime = 12; c.player.lives = 0; c.player.disqualified = true;
  const terminal = structuredClone(c.player);
  assert.doesNotThrow(() => c.simulate(30));
  assert.deepEqual(c.player, terminal); assert.equal(c.elapsed, 12); assert.equal(c.state, 'running');
  Object.assign(c.player, initial); c.keys.add('ShiftLeft'); c.keys.add('ArrowRight');
  c.simulate(1 / 60); assert.deepEqual(c.player, initial); assert.equal(c.elapsed, 12);
});

test('actual online jump and net changes send intentions without changing authoritative pose or inventory', () => {
  const {c, sent, cues} = fixture(), before = structuredClone(c.player);
  c.jump(); c.setNetSide(-1); c.jump();
  assert.deepEqual(c.player, before); assert.deepEqual(cues, []);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map(value => value.seq), [1, 2, 3]);
  assert.deepEqual(sent.map(value => value.jumpSeq), [1, 1, 2]);
  assert.deepEqual(sent.map(value => value.netSide), [1, -1, -1]);
  assert.ok(sent.every(value => value.raceId === 'race-online' && value.type === 'race.input' && value.protocolVersion === 1));
  assert.ok(sent.every(value => !('x' in value) && !('z' in value) && !('collected' in value) && !('lives' in value)));
});

test('actual online pause, blur and hidden-tab handlers release controls without pausing the shared race', () => {
  const {c, sent, windowEvents, documentEvents} = fixture();
  for (const release of [() => c.pause(), () => windowEvents.get('blur')(),
    () => {c.document.hidden = true; documentEvents.get('visibilitychange')();}]) {
    c.keys.add('ArrowRight'); c.keys.add('ShiftLeft'); release();
    assert.equal(c.keys.size, 0); assert.equal(c.state, 'running'); assert.equal(c.suspended, false);
    assert.equal(sent.at(-1).steer, 0); assert.equal(sent.at(-1).boost, false);
  }
  c.networkConnected = false; const count = sent.length;
  windowEvents.get('blur')(); assert.equal(sent.length, count);
});

test('actual input sender caps regular traffic at 20 Hz and rejects stale, disconnected and terminal gameplay input', () => {
  const {c, sent} = fixture();
  c.keys.add('ArrowRight'); c.keys.add('ShiftLeft');
  for (let now = 100; now < 1100; now += 1) c.sendNetworkInput(now);
  assert.equal(sent.length, 20); assert.ok(sent.every(value => value.steer === 1 && value.boost));
  c.lastInputAt = -Infinity;
  for (const {patch, now} of [{patch: {networkConnected: false}, now: 500}, {patch: {networkRace: {receivedAt: null}}, now: 500},
    {patch: {networkRace: {receivedAt: 0}}, now: 5000}, {patch: {state: 'countdown'}, now: 500}, {patch: {state: 'finished'}, now: 500}]) {
    const before = {networkConnected: c.networkConnected, networkRace: c.networkRace, state: c.state};
    Object.assign(c, patch); c.sendNetworkInput(now, true); Object.assign(c, before);
  }
  for (const terminal of [{disqualified: true}, {finishTime: 15}]) {
    const before = {...c.player}; Object.assign(c.player, terminal); c.sendNetworkInput(1000, true); Object.assign(c.player, before);
  }
  assert.equal(sent.length, 20);
});

test('actual keyboard handlers ignore UI fields, menus and repeats while releasing keys normally', () => {
  const {c, sent, windowEvents} = fixture();
  const keydown = (code, values = {}) => windowEvents.get('keydown')({code, target: {}, repeat: false, preventDefault() {}, ...values});
  c.menuActive = true; keydown('Space'); c.menuActive = false;
  c.suspended = true; keydown('Space'); c.suspended = false;
  keydown('Space', {target: new c.HTMLInputElement()});
  keydown('Space', {target: new c.HTMLButtonElement()});
  keydown('Space', {repeat: true}); assert.equal(sent.length, 0);
  keydown('Space'); assert.equal(sent.length, 1);
  keydown('ArrowRight'); assert.equal(c.keys.has('ArrowRight'), true);
  windowEvents.get('keyup')({code: 'ArrowRight'}); assert.equal(c.keys.has('ArrowRight'), false);
});

test('the same actual controls retain local jump physics and automatic pause when leaving the tab', () => {
  const {c, sent, cues, windowEvents} = fixture(); c.networkRace = null;
  c.jump(); assert.equal(c.player.jumpVelocity, 6); assert.deepEqual(cues, ['jump']); assert.equal(sent.length, 0);
  c.keys.add('ShiftLeft'); windowEvents.get('blur')();
  assert.equal(c.state, 'paused'); assert.equal(c.keys.size, 0); assert.equal(sent.length, 0);
  c.pause(); assert.equal(c.state, 'running');
});

test('actual network frames neutralize stale controls once and keep the shared race unpaused', () => {
  const {c, sent} = fixture(), frameSteps = [];
  c.player.playerId = 'self';
  c.networkRace.latest = {players: [{playerId: 'self', lastProcessedInputSeq: 8, lastProcessedJumpSeq: 4}]};
  c.networkPresentation.frame = (now, dt) => {
    frameSteps.push(dt); return {state: 'running', elapsedSeconds: 12, countdownSeconds: 0, pursuits: []};
  };
  c.keys.add('ArrowRight'); c.keys.add('ShiftLeft');
  c.updateNetworkFrame(100, .016);
  assert.equal(sent.length, 1); assert.equal(sent[0].seq, 9); assert.equal(sent[0].jumpSeq, 4);
  assert.equal(sent[0].steer, 1); assert.equal(sent[0].boost, true);
  c.updateNetworkFrame(3100, .1);
  assert.equal(sent.length, 2); assert.equal(sent[1].steer, 0); assert.equal(sent[1].boost, false);
  assert.equal(c.keys.size, 0); assert.equal(c.networkWasLive, false); assert.equal(c.state, 'running');
  c.updateNetworkFrame(3200, .1); c.updateNetworkFrame(8000, .1);
  assert.equal(sent.length, 2); assert.deepEqual(frameSteps, [.016, 0, 0, 0]);
  assert.match(c.networkNote.textContent, /Esperando/);
  // New confirmed snapshots can resume presentation on the same still-open
  // session, but released controls must not recover their previous held state.
  c.networkRace.receivedAt = 9000; c.updateNetworkFrame(9000, .016);
  assert.equal(sent.length, 3); assert.equal(sent[2].steer, 0); assert.equal(sent[2].boost, false);
  assert.equal(c.networkWasLive, true); assert.equal(c.state, 'running');
});

test('actual map selection restores local collision radii and positions after an online manifest', () => {
  const noop = () => {}, nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {dataset: {}, setAttribute() {}});
    return nodes.get(id);
  };
  const initial = createCourse('maracaibo');
  const entries = kind => initial[kind].map(item => ({...item, radius: 30,
    object: {position: {x: 64, z: -900}, rotation: {y: 0}}, model: {rotation: {y: 0}}}));
  const c = {MAPS, findMap, createCourse, activeMap: MAPS[0], environment: null,
    environments: Object.fromEntries(MAPS.map(map => [map.id, {root: {visible: true}}])),
    artDirection: {update: noop}, surfRadiance: {select: noop}, renderer: {setClearColor: noop},
    ART_PALETTES: Object.fromEntries(MAPS.map(map => [map.id, {sky: 0, haze: 0}])),
    scene: {fog: {color: {set: noop}}}, obstacles: entries('obstacles'), trash: entries('trash'), lifesavers: entries('lifesavers'),
    setWasteKind(item, kind) {item.kind = kind;}, pickupEffects: {update: noop},
    buoyKit: {sync: noop}, obstacleFoam: {sync: noop}, obstacleRocks: {sync: noop},
    document: {querySelector: node}, $: node, renderDirty: false,
  };
  vm.createContext(c); vm.runInContext(mapSelection, c);
  for (const map of MAPS) {
    c.obstacles.forEach(item => {item.radius = 30; item.x = 64; item.z = -900;});
    c.selectMap(map.id);
    const expected = createCourse(map.id);
    for (const kind of ['obstacles', 'trash', 'lifesavers']) {
      for (const [index, item] of c[kind].entries()) {
        assert.equal(item.x, expected[kind][index].x); assert.equal(item.z, expected[kind][index].z);
        assert.equal(item.object.position.x, item.x); assert.equal(item.object.position.z, item.z);
        if (kind === 'obstacles') assert.equal(item.radius, expected[kind][index].radius);
      }
    }
  }
});
