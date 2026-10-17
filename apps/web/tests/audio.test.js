import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAudio } from '../dist/audio.js';

test('unavailable audio is harmless to racing, muting and sound events',async()=>{
  const audio=createGameAudio(null);
  await audio.unlock();audio.update('running',true);audio.cue('collect',1);
  audio.setEnabled(false);assert.equal(audio.enabled,false);
  audio.update('paused');audio.setEnabled(true);assert.equal(audio.enabled,true);
  await audio.unlock();audio.cue('finish');
});
test('a rejected audio context cannot reject starting a race or force audio while muted',async()=>{
  let created=0;
  class BlockedAudio {constructor(){created++;throw new Error('Audio blocked');}}
  const audio=createGameAudio(BlockedAudio);audio.setEnabled(false);
  await audio.unlock();assert.equal(created,0);
  audio.setEnabled(true);await assert.doesNotReject(audio.unlock());
  assert.equal(created,1);audio.update('running');audio.cue('boost');
});
