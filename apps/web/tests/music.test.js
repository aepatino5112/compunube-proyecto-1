import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMusic, MUSIC_TRACKS } from '../dist/audio.js';

// Media element stand-in: play() can be refused, as browsers do before a gesture.
function harness({ refuse = false } = {}) {
  const elements = [];
  let tick = null, refusing = refuse;
  class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; this.volume = 1; this.plays = 0; elements.push(this); }
    play() { this.plays++; if (refusing) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const music = createMusic(FakeAudio, MUSIC_TRACKS, fn => { tick = fn; return 1; });
  const settle = () => { for (let i = 0; i < 30; i++) tick?.(); };
  return { music, elements, settle, allow() { refusing = false; }, byKey: key => elements.find(e => e.src === MUSIC_TRACKS[key]) };
}

test('every music track ships with the web client and is credited', async () => {
  const credits = await readFile(new URL('../dist/assets/music/CREDITS.txt', import.meta.url), 'utf8');
  for (const path of Object.values(MUSIC_TRACKS)) {
    await readFile(new URL(`../dist/${path}`, import.meta.url));
    assert.ok(credits.includes(path.split('/').pop().replace('-final', '').replace(/\.(ogg|mp3)$/, '')), path);
  }
});

test('changing screens crossfades to the new track and pauses the old one', () => {
  const h = harness();
  h.music.play('home'); h.settle();
  assert.equal(h.byKey('home').paused, false); assert.ok(Math.abs(h.byKey('home').volume - .32) < 1e-9);
  h.music.play('maracaibo'); h.settle();
  assert.equal(h.byKey('home').volume, 0); assert.equal(h.byKey('home').paused, true);
  assert.equal(h.byKey('maracaibo').paused, false); assert.ok(h.byKey('maracaibo').volume > .3);
  h.music.play('maracaibo'); assert.equal(h.elements.length, 2, 'the same track is not restarted');
});

test('the sound switch silences and resumes the music', () => {
  const h = harness();
  h.music.play('menu'); h.settle();
  h.music.setEnabled(false); h.settle();
  assert.equal(h.byKey('menu').paused, true); assert.equal(h.byKey('menu').volume, 0);
  h.music.setEnabled(true); h.settle();
  assert.equal(h.byKey('menu').paused, false);
});

test('music refused before a gesture starts on the next unlock', async () => {
  const h = harness({ refuse: true });
  h.music.play('home'); await Promise.resolve();
  assert.equal(h.byKey('home').paused, true);
  h.allow(); h.music.unlock(); h.settle();
  assert.equal(h.byKey('home').paused, false); assert.equal(h.byKey('home').plays, 2);
});
