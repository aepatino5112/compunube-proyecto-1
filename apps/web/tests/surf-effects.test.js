import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { sampleWater, WATER_BASE, WATER_AMPLITUDE } from '../dist/water-surface.js';
import { createWake, createPickupEffects, createLandingRipple,createBoardContactFoam } from '../dist/surf-effects.js';

test('board contact foam follows all racers, omits airborne/eliminated boards and reuses its batch',()=>{
  const foam=createBoardContactFoam(THREE,new THREE.Scene(),4);
  const racers=Array.from({length:4},(_,i)=>({x:i*5,z:-10,speed:16,jump:0,group:new THREE.Group()}));
  const buffer=foam.mesh.instanceMatrix.array,matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(let tick=0;tick<80;tick++){
    racers.forEach((r,i)=>{r.z=-tick*.3-i;r.group.rotation.y=i*.13;});
    foam.update(racers,tick/60);assert.equal(foam.mesh.count,4);
    foam.mesh.getMatrixAt(2,matrix);point.setFromMatrixPosition(matrix);
    assert.ok(Math.abs(point.x-racers[2].x)<1e-5&&Math.abs(point.z-racers[2].z)<1e-5);
  }
  const frozen=buffer.slice();foam.update(racers,79/60);assert.deepEqual(buffer,frozen);
  assert.equal(foam.mesh.instanceMatrix.array,buffer);assert.ok(buffer.every(Number.isFinite));
  racers[0].jump=1;racers[1].disqualified=true;racers[2].speed=0;
  foam.update(racers,2);assert.equal(foam.mesh.count,1);
  foam.mesh.getMatrixAt(0,matrix);point.setFromMatrixPosition(matrix);assert.equal(point.x,15);
  foam.update(racers,3,true);assert.equal(foam.time.value,0);
  foam.reset();assert.equal(foam.mesh.count,0);
  racers[0].jump=0;foam.update(racers,4);assert.equal(foam.mesh.count,2);
  racers[0].finishTime=4;foam.update(racers,5);assert.equal(foam.mesh.count,1,'Finished boards emit no new contact foam');
  assert.throws(()=>foam.update([...racers,racers[0]],4));
});

test('landing foam stays at its contact point, follows the water and expires',()=>{
  const ripple=createLandingRipple(THREE,new THREE.Scene());ripple.trigger(3,-50);ripple.update(.55,1);
  const initialScale=ripple.mesh.scale.x;
  ripple.update(.25,1.3);
  assert.equal(ripple.mesh.position.x,3);assert.equal(ripple.mesh.position.z,-50);
  assert.equal(ripple.mesh.position.y,sampleWater(3,-50,1.3).height+.032);assert.ok(ripple.mesh.scale.x>initialScale);
  const frozen=ripple.mesh.position.toArray();ripple.update(.25,1.3);assert.deepEqual(ripple.mesh.position.toArray(),frozen);
  ripple.update(0,2);assert.equal(ripple.mesh.visible,false);
  ripple.trigger(-8,-90);ripple.update(.55,2);assert.equal(ripple.mesh.position.x,-8);assert.equal(ripple.mesh.position.z,-90);
  ripple.update(.4,2,true);assert.equal(ripple.mesh.visible,false);
  ripple.reset();assert.equal(ripple.mesh.material.opacity,0);assert.equal(ripple.mesh.visible,false);
});

test('floating objects sample the bounded surface and analytic slopes match height gradients',()=>{
  for(let t=0;t<8;t+=.7)for(let z=0;z>-900;z-=31) {
    const p=sampleWater(7,z,t),delta=.0001;
    assert.ok(Math.abs(p.height-WATER_BASE)<=WATER_AMPLITUDE+1e-9);
    const dx=(sampleWater(7+delta,z,t).height-sampleWater(7-delta,z,t).height)/(2*delta);
    const dz=(sampleWater(7,z+delta,t).height-sampleWater(7,z-delta,t).height)/(2*delta);
    assert.ok(Math.abs(dx-p.dx)<1e-7);assert.ok(Math.abs(dz-p.dz)<1e-7);
  }
});

test('foam retains the travelled curve, freezes with the race, fades and resets without reallocating',()=>{
  const scene=new THREE.Scene(),wake=createWake(THREE,scene);
  const buffer=wake.geometry.attributes.position.array;
  const racer={x:0,z:0,speed:16.4,turn:0,jump:0,disqualified:false};
  for(let i=0;i<120;i++) {racer.x=Math.sin(i/24)*5;racer.z=-i*.3;wake.update(racer,i/60,true);}
  assert.ok(wake.count<=46);assert.equal(wake.geometry.attributes.position.array,buffer);
  assert.ok(buffer.every(Number.isFinite));
  const previous={...wake.samples[15]};
  assert.ok(Math.abs(previous.x-racer.x)>.2,'Older foam should retain a previous lateral position');
  const paused=buffer.slice();wake.update(racer,119/60,false);assert.deepEqual(buffer,paused);
  racer.jump=2;racer.x=12;racer.z-=4;wake.update(racer,2.1,true);
  assert.deepEqual(wake.samples[15],previous,'An airborne board must not emit water foam');
  wake.update(racer,10,false);assert.ok(wake.geometry.attributes.aFoam.array.every(x=>x===0));
  wake.reset();assert.equal(wake.count,0);assert.equal(wake.root.visible,false);
  racer.jump=0;wake.update(racer,11,true);assert.equal(wake.geometry.drawRange.count,0);
  racer.z-=1;wake.update(racer,11.1,true,true);
  assert.ok(wake.geometry.attributes.aFoam.array.some(x=>x>0));
  wake.update(racer,15,false,true);
  assert.ok(wake.geometry.attributes.aFoam.array.every(x=>x===0),'Reduced motion still expires old foam');
  const count=wake.count;racer.finishTime=15;racer.z-=1;wake.update(racer,15.1,true);
  assert.equal(wake.count,count,'Crossing the finish stops emission and lets existing foam fade');
});

test('material cues stay on the water while models bob, and collecting leaves no pickup ghost',()=>{
  const effects=createPickupEffects(THREE),scene=new THREE.Scene();
  const items=[0,1].map(kind=>{
    const object=new THREE.Group(),model=new THREE.Group();object.add(model);
    return {object,model,signal:effects.attach(object,kind),kind,x:3,z:-20,phase:1};
  });
  const a=items[0],b=items[1];effects.update(a,1);effects.update(b,1);
  assert.notEqual(a.signal.halo.material.color.getHex(),b.signal.halo.material.color.getHex());
  assert.equal(a.object.position.y,sampleWater(a.x,a.z,1).height);
  assert.equal(a.signal.halo.position.y,.10);assert.notEqual(a.model.rotation.z,0);
  const frozen=a.model.rotation.toArray();effects.update(a,1);assert.deepEqual(a.model.rotation.toArray(),frozen);
  a.object.visible=false;effects.burst(a,scene);effects.updateBursts(.2,1.2);
  assert.equal(a.object.visible,false);assert.ok(scene.children.some(o=>o.visible));
  effects.updateBursts(1,2);assert.ok(scene.children.every(o=>!o.visible));
});

test('foam pattern stays with its water positions and the ribbon does not bridge a jump',()=>{
  const wake=createWake(THREE,new THREE.Scene());
  const racer={x:0,z:0,speed:16,turn:0,jump:0,disqualified:false};
  for(let i=0;i<8;i++){racer.z=-i;wake.update(racer,i/60,true);}
  const olderZ=wake.samples[2].z,olderUV=wake.geometry.attributes.uv.getY(4);
  racer.z-=1;wake.update(racer,8/60,true);
  assert.equal(wake.samples[3].z,olderZ);
  assert.equal(wake.geometry.attributes.uv.getY(6),olderUV);
  racer.z-=.1;wake.update(racer,8.5/60,true);
  const position=wake.geometry.attributes.position;
  assert.ok(Math.abs((position.getZ(0)+position.getZ(1))/2-(racer.z+1.65))<1e-5,'Head follows the stern between stored samples');
  racer.jump=2;racer.z-=8;wake.update(racer,.5,true);
  racer.jump=0;racer.z-=8;wake.update(racer,1,true);
  const drawn=wake.geometry.index.array.slice(0,wake.geometry.drawRange.count);
  assert.ok(!drawn.includes(0)&&!drawn.includes(1),'There must be no segment across the airborne path');
  racer.z-=1;wake.update(racer,1.1,true);
  assert.deepEqual([...wake.geometry.index.array.slice(0,6)],[0,1,2,1,3,2],'New water contact emits a separate wake');
});

test('wake starts at the rotated stern and stays on the sampled water when steering',()=>{
  const wake=createWake(THREE,new THREE.Scene()),group=new THREE.Group();
  const racer={x:3,z:-10,turn:1,speed:16,jump:0,group};group.rotation.y=-.2;
  wake.update(racer,0,true);racer.z-=1;wake.update(racer,.1,true);
  const p=wake.geometry.attributes.position;
  assert.ok(Math.abs((p.getX(0)+p.getX(1))/2-(racer.x+Math.sin(-.2)*1.65))<1e-5);
  assert.ok(Math.abs((p.getZ(0)+p.getZ(1))/2-(racer.z+Math.cos(-.2)*1.65))<1e-5);
  for(let i=0;i<4;i++)assert.ok(Math.abs(p.getY(i)-sampleWater(p.getX(i),p.getZ(i),.1).height-.032)<1e-6);
});
