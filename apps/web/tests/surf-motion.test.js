import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfMotion } from '../dist/surf-motion.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';

test('successive collections keep the net continuous and a side change clears the bow',()=>{
  const motion=createSurfMotion(),state={catchTimer:.75,netAngle:0};
  for(let i=0;i<20;i++){state.catchTimer-=1/60;motion.update(1/60,state);}
  const before={...motion.pose};assert.ok(before.netPitch>.3);
  state.catchTimer=.75;motion.update(1/60,state);
  assert.ok(Math.abs(motion.pose.netPitch-before.netPitch)<.04,'A new pickup must not snap the raised net down');
  state.catchTimer=0;
  let clearance=0;
  for(let i=0;i<60;i++){state.netAngle=NET_LEFT_ANGLE*(1-Math.exp(-14*(i+1)/60));clearance=Math.max(clearance,motion.update(1/60,state).netHeight);}
  assert.ok(clearance>.04);assert.ok(motion.pose.netHeight<.002,'The net must return to water level after transfer');
  for(let i=0;i<120;i++)motion.update(1/60,state);
  assert.ok(Math.abs(motion.pose.netPitch)<1e-5);
});

test('motion is bounded, independent of a held-target draw rate, frozen on pause and resettable',()=>{
  const state={turn:1,netAngle:NET_LEFT_ANGLE/2,catchTimer:.45,boosting:true};
  const a=createSurfMotion(),b=createSurfMotion();
  for(let i=0;i<30;i++)a.update(1/30,state);
  for(let i=0;i<120;i++)b.update(1/120,state);
  for(const key of Object.keys(a.pose))assert.ok(Math.abs(a.pose[key]-b.pose[key])<1e-10,key);
  const before={...a.pose};a.update(0,{turn:-1,netAngle:0,catchTimer:0});assert.deepEqual(a.pose,before);
  for(let i=0;i<300;i++)a.update(.5,{turn:i%2?-1:1,jump:1,jumpVelocity:i%2?6:-6,catchTimer:.4});
  assert.ok(Object.values(a.pose).every(Number.isFinite));assert.ok(Math.abs(a.pose.boardPitch)<=.091);
  a.reset();assert.ok(Object.values(a.pose).every(value=>value===0));
});

test('landing contact compresses then rebounds without altering gameplay state',()=>{
  const motion=createSurfMotion(),state={x:7,z:-40,jump:0,jumpVelocity:0,landingTimer:.55};
  let lowest=0,highest=0;
  for(let i=0;i<=33;i++){
    state.landingTimer=Math.max(0,.55-i/60);const snapshot={...state};
    const pose=motion.update(1/60,state);lowest=Math.min(lowest,pose.boardHeight);highest=Math.max(highest,pose.boardHeight);
    assert.deepEqual(state,snapshot);assert.ok(pose.boardHeight>=-.055&&pose.boardHeight<=.022);
  }
  assert.ok(lowest<-.05);assert.ok(highest>.02);assert.equal(motion.pose.boardHeight,0);
  state.jump=.5;state.landingTimer=.3;assert.equal(motion.update(1/60,state).boardHeight,0,'Contact compression cannot occur in the air');
});
