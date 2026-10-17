import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameClock } from '../dist/frame-clock.js';
import { collectTrash } from '../dist/collection.js';
import { netContact, refillBoost } from '../dist/mechanics.js';
import { freshChase, advanceChase } from '../dist/survival.js';

function run(fps) {
  const clock=createFrameClock(),chase=freshChase();let time=0,speed=0,z=0,energy=0;
  const waste=Array.from({length:8},(_,i)=>({x:5.05,z:-6-i*11,collectedBy:null}));
  clock.tick(0,true,()=>{});
  for(let frame=1;frame<=fps*12;frame++) clock.tick(frame*1000/fps,true,dt=>{
    time+=dt;const start=netContact(3,z,0,0);
    speed=16.4+(speed-16.4)*Math.exp(-3*dt);z-=speed*dt;
    energy=refillBoost(energy,collectTrash(waste,start,netContact(3,z,0,0),0,0).length);
    advanceChase(chase,speed,dt,time);
  });
  return {time,speed,z,energy,gap:chase.gap,owners:waste.map(i=>i.collectedBy)};
}
test('10, 15, 30, 60 and 120 fps produce the same elapsed time, motion and pickups',()=>{
  const baseline=run(60);
  assert.ok(Math.abs(baseline.time-12)<1e-8);assert.ok(baseline.z < -190);
  assert.equal(baseline.energy,1);assert.ok(baseline.owners.every(i=>i===0));
  for(const fps of [10,15,30,120]) assert.deepEqual(run(fps),baseline);
});
test('pauses discard accumulated time and do not consume boost or chase distance',()=>{
  const clock=createFrameClock();let updates=0;
  clock.tick(0,true,()=>updates++);clock.tick(8,true,()=>updates++);
  clock.tick(2000,false,()=>updates++);clock.tick(2010,true,()=>updates++);
  assert.equal(updates,0);clock.tick(2020,true,()=>updates++);assert.equal(updates,1);
  clock.reset();clock.tick(12000,true,()=>updates++);assert.equal(updates,1);
});
test('long stalls request a pause without advancing or accumulating catch-up work',()=>{
  const clock=createFrameClock();let time=0;
  clock.tick(0,true,dt=>time+=dt);
  const stalled=clock.tick(4000,true,dt=>time+=dt);
  assert.equal(stalled.stalled,true);assert.equal(time,0);
  clock.tick(4017,true,dt=>time+=dt);assert.ok(Math.abs(time-1/60)<1e-9);
});
test('finishing inside an update stops the remaining steps of that render frame',()=>{
  const clock=createFrameClock();let updates=0;
  clock.tick(0,true,()=>{});
  clock.tick(100,true,()=>{updates++;return false;});
  assert.equal(updates,1);
  clock.tick(110,true,()=>updates++);assert.equal(updates,1);
});
