import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { createSurferAnimation,selectSurferAsset } from '../dist/surfer-animation.js';
import { NET_LEFT_ANGLE,NET_GRIPS,netHandGrip } from '../dist/mechanics.js';
import { createSurfMotion,applyNetPose } from '../dist/surf-motion.js';
import { CHARACTERS,raceRoster } from '../dist/appearance.js';

const bytes=await readFile(new URL('../dist/assets/surfer.glb',import.meta.url));
const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const pilotBytes=await readFile(new URL('../dist/assets/surfer-amara.glb',import.meta.url));
const pilot=await new GLTFLoader().parseAsync(pilotBytes.buffer.slice(pilotBytes.byteOffset,pilotBytes.byteOffset+pilotBytes.byteLength),'');
const currentAssets={default:asset,amara:pilot,...Object.fromEntries(await Promise.all(['nico','luna','samuel'].map(async id=>{
  const bytes=await readFile(new URL(`../dist/assets/surfer-${id}.glb`,import.meta.url));
  return [id,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')];
})))};
function fixture(character) {
  const animation=createSurferAnimation(selectSurferAsset(currentAssets,character?.id),'#ef795e',character?.hair,{...character,character:character?.id}),root=new THREE.Group(),net=new THREE.Group();
  root.add(animation.avatar,net); root.position.set(3,.2,-50);root.rotation.set(.025,.15,-.2);
  return {animation,root,net};
}
function pose(animation) {return animation.chains.map(c=>[...c.end.getWorldPosition(new THREE.Vector3()).toArray(),...c.upper.quaternion.toArray()]);}

test('each playable character gets three different opponents, including restored invalid selections',()=>{
  for(const id of [...CHARACTERS.map(character=>character.id),'unknown',undefined]){
    const roster=raceRoster(id);
    assert.equal(roster.length,4);assert.equal(new Set(roster.map(character=>character.id)).size,4);
    assert.equal(roster[0].id,CHARACTERS.some(character=>character.id===id)?id:'nico');
    assert.deepEqual(roster.map(character=>character.id).sort(),CHARACTERS.map(character=>character.id).sort());
  }
});

test('handover exchanges the real near/far anchors and keeps palms apart during the crossing',()=>{
  const left=new THREE.Vector3(),right=new THREE.Vector3();
  for(const suffix of ['L','R']){
    assert.deepEqual(netHandGrip(suffix,0,new THREE.Vector3()).toArray(),[...NET_GRIPS[suffix]]);
    const opposite=suffix==='L'?'R':'L';
    netHandGrip(suffix,NET_LEFT_ANGLE,left);
    left.toArray().forEach((value,i)=>assert.ok(Math.abs(value-NET_GRIPS[opposite][i])<1e-12));
  }
  let previous=null;
  for(let i=0;i<=200;i++){
    const angle=NET_LEFT_ANGLE*i/200;netHandGrip('L',angle,left);netHandGrip('R',angle,right);
    assert.ok(left.distanceTo(right)>.14,'Regripping palms must not occupy the same point');
    if(previous)assert.ok(left.distanceTo(previous)<.018,'Handover must remain continuous');
    previous=left.clone();
  }
});

test('GLB exports complete clips and independent weighted skeletons',()=>{
  const a=createSurferAnimation(asset,'#ff0000'),b=createSurferAnimation(asset,'#0000ff');
  const first=a.avatar.getObjectByName('Skin'),second=b.avatar.getObjectByName('Skin');
  assert.ok(first.isSkinnedMesh);assert.equal(first.skeleton.bones.length,15);
  a.avatar.traverse(mesh=>{
    if(!mesh.isSkinnedMesh) return;
    const weights=mesh.geometry.getAttribute('skinWeight'),joints=mesh.geometry.getAttribute('skinIndex');
    for(let i=0;i<weights.count;i++) {
      assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-6);
      for(const joint of [joints.getX(i),joints.getY(i),joints.getZ(i),joints.getW(i)]) assert.ok(joint<mesh.skeleton.bones.length);
    }
  });
  assert.notEqual(first.skeleton,second.skeleton);assert.notEqual(a.chains[0].upper,b.chains[0].upper);
  assert.equal(first.geometry,second.geometry);
  const before=b.avatar.getObjectByName('Chest').quaternion.clone();
  for(let i=0;i<30;i++) a.update(1/60,{turn:1,boosting:true});
  assert.ok(b.avatar.getObjectByName('Chest').quaternion.equals(before));
  assert.notEqual(a.avatar.getObjectByName('OutfitColor').material,b.avatar.getObjectByName('OutfitColor').material);
  a.dispose();b.dispose();
});

test('Amara pilot has blended joints, complete clips and independent colour/hair resources',()=>{
  assert.equal(selectSurferAsset({default:asset,amara:pilot},'amara'),pilot);
  assert.equal(selectSurferAsset({default:asset,amara:pilot},'luna'),asset);
  assert.equal(selectSurferAsset({default:asset},'amara'),asset);
  assert.deepEqual(pilot.animations.map(clip=>clip.name).sort(),asset.animations.map(clip=>clip.name).sort());
  const a=fixture(CHARACTERS[2]),b=fixture(CHARACTERS[2]);
  const first=a.animation.avatar.getObjectByName('Skin'),second=b.animation.avatar.getObjectByName('Skin');
  assert.equal(first.skeleton.bones.length,15);assert.equal(first.geometry,second.geometry);assert.notEqual(first.material,second.material);
  let blended=0;
  a.animation.avatar.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const positions=mesh.geometry.getAttribute('position'),weights=mesh.geometry.getAttribute('skinWeight'),joints=mesh.geometry.getAttribute('skinIndex');
    assert.ok(positions.array.every(Number.isFinite));
    for(let i=0;i<weights.count;i++){
      const values=[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)];
      assert.ok(Math.abs(values.reduce((sum,value)=>sum+value,0)-1)<1e-6);
      if(values.filter(value=>value>0).length>1)blended++;
      for(const index of [joints.getX(i),joints.getY(i),joints.getZ(i),joints.getW(i)])assert.ok(index<mesh.skeleton.bones.length);
    }
  });
  assert.ok(blended>100,'The pilot must blend continuous joints instead of binding every vertex to one bone');
  const original=second.material.color.clone();a.animation.setAppearance({skin:'light',hairColor:'blue'});a.animation.setHair('ponytail');
  assert.ok(second.material.color.equals(original));
  const visible=[];a.animation.avatar.traverse(mesh=>{if(mesh.isMesh&&mesh.visible&&mesh.material.name.startsWith('Hair-'))visible.push(mesh.material.name);});
  assert.deepEqual(visible,['Hair-ponytail']);a.animation.dispose();b.animation.update(1/60,{},b.net);b.animation.dispose();
});

test('Amara carries finite local vertex paint across all clothing and hair variants',()=>{
  assert.equal(pilot.scene.getObjectByName('CartoonSurfer').userData.grip_frame,'game-X / pole aligned / fingers wrap at anchor');
  pilot.scene.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const colours=mesh.geometry.getAttribute('color');
    assert.equal(colours.count,mesh.geometry.getAttribute('position').count);
    const values=[];
    for(let i=0;i<colours.count;i++)values.push(colours.getX(i),colours.getY(i),colours.getZ(i));
    assert.ok(values.every(value=>Number.isFinite(value)&&value>=.45&&value<=1));
    assert.ok(Math.max(...values)-Math.min(...values)>.015,`${mesh.name} needs painted form, not a constant replacement colour`);
  });
});

test('the adult silhouette lengthens the planted legs and reduces the hair mass while preserving foot height and stagger',async()=>{
  const bytes=await readFile(new URL('../dist/assets/surfer-amara-v6.glb',import.meta.url));
  const previous=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  pilot.scene.updateMatrixWorld(true);previous.scene.updateMatrixWorld(true);
  const position=new THREE.Vector3();
  const beforeHip=previous.scene.getObjectByName('Hips').getWorldPosition(position).y;
  const currentHip=pilot.scene.getObjectByName('Hips').getWorldPosition(position).y;
  assert.ok(currentHip>beforeHip*1.15,'Leg proportions must change visibly, not only garment decorations');
  for(const suffix of ['L','R']){
    const oldFoot=previous.scene.getObjectByName('Foot_'+suffix).getWorldPosition(new THREE.Vector3());
    const newFoot=pilot.scene.getObjectByName('Foot_'+suffix).getWorldPosition(position);
    assert.ok(Math.abs(newFoot.y-oldFoot.y)<1e-6&&Math.abs(newFoot.z-oldFoot.z)<1e-6);
    assert.ok(Math.abs(newFoot.x)<Math.abs(oldFoot.x),'Feet must sit further inside the deck to allow a transverse stance');
  }
  const oldHair=new THREE.Box3().setFromObject(previous.scene.getObjectByName('Hair-afro')).getSize(new THREE.Vector3());
  const newHair=new THREE.Box3().setFromObject(pilot.scene.getObjectByName('Hair-afro')).getSize(new THREE.Vector3());
  assert.ok(newHair.x<oldHair.x*.92&&newHair.z<oldHair.z*.95,'The head/hair must occupy less width relative to the shoulders');
});

test('authored Amara fingers keep their grip axis aligned with the pole through reversals and pause',()=>{
  const {animation,root,net}=fixture(CHARACTERS[2]),motion=createSurfMotion();
  const localAxis=new THREE.Vector3(...NET_GRIPS.R).sub(new THREE.Vector3(...NET_GRIPS.L)).normalize();
  const axis=new THREE.Vector3(),actual=new THREE.Vector3(),rotation=new THREE.Quaternion();
  const state={netAngle:0,turn:0,catchTimer:0};
  for(let frame=0;frame<160;frame++){
    const t=frame/159;state.netAngle=NET_LEFT_ANGLE*Math.sin(t*Math.PI);state.turn=Math.sin(t*4);
    state.catchTimer=frame>60&&frame<90?.75-(frame-60)/60:0;
    const visual=motion.update(1/60,state);applyNetPose(net,state.netAngle,visual);
    animation.update(1/60,state,net,visual);root.updateMatrixWorld(true);
    axis.copy(localAxis).transformDirection(net.matrixWorld);
    for(const chain of animation.chains.filter(chain=>chain.kind==='arm')){
      chain.end.getWorldQuaternion(rotation).multiply(chain.endRotation.clone().invert());
      actual.set(1,0,0).applyQuaternion(rotation);
      assert.ok(actual.dot(axis)>.99999,`${chain.suffix} grip rotates away from the shaft at frame ${frame}`);
      assert.ok(chain.end.getWorldPosition(actual).distanceTo(net.localToWorld(netHandGrip(chain.suffix,state.netAngle,new THREE.Vector3())))<.012);
    }
  }
  const before=animation.chains.filter(chain=>chain.kind==='arm').map(chain=>chain.end.getWorldQuaternion(new THREE.Quaternion()));
  for(let i=0;i<8;i++)animation.update(0,state,net,motion.pose);
  animation.chains.filter(chain=>chain.kind==='arm').forEach((chain,i)=>{
    const after=chain.end.getWorldQuaternion(new THREE.Quaternion()).toArray();
    before[i].toArray().forEach((value,j)=>assert.ok(Math.abs(value-after[j])<1e-10));
  });
  animation.dispose();
});

test('the surfer looks toward the held net, rather than counter-rotating away from it',()=>{
  const actor=createSurferAnimation(pilot,'#ef795e','afro',{character:'amara'}),net=new THREE.Group();
  const root=new THREE.Group();root.add(actor.avatar,net);
  const rest=pilot.scene.getObjectByName('Head').getWorldQuaternion(new THREE.Quaternion()).invert();
  const forward=new THREE.Vector3(),rotation=new THREE.Quaternion();
  for(const [angle,side] of [[0,1],[NET_LEFT_ANGLE,-1]]){
    actor.reset();applyNetPose(net,angle);
    for(let i=0;i<45;i++)actor.update(1/60,{netAngle:angle},net);
    actor.avatar.getObjectByName('Head').getWorldQuaternion(rotation).multiply(rest);
    forward.set(0,0,-1).applyQuaternion(rotation);
    assert.ok(forward.x*side>.20,`${side}: facing away from the held tool`);
  }
  actor.dispose();
});

test('feet stay on the board and hands follow both sides through poses',()=>{
  for(const character of CHARACTERS){
  const {animation,root,net}=fixture(character);
  for(const side of [0,NET_LEFT_ANGLE]) for(const state of [{},{turn:-1},{turn:1},{boosting:true},{jump:1},{landingTimer:.4},{catchTimer:.5},{hit:.7}]) {
    state.netAngle=side;applyNetPose(net,side,{netPitch:state.catchTimer?.42:0,netHeight:state.catchTimer?.1:0});
    for(let i=0;i<30;i++) animation.update(1/60,state,net);
    root.updateMatrixWorld(true);
    for(const chain of animation.chains) {
      const target=chain.kind==='leg' ? animation.avatar.localToWorld(chain.target.clone()) : net.localToWorld(netHandGrip(chain.suffix,side,new THREE.Vector3()));
      const error=target.distanceTo(chain.end.getWorldPosition(new THREE.Vector3()));
      assert.ok(error<.012,`${chain.kind}/${chain.suffix}: ${error} at side ${side}`);
      assert.ok(chain.upper.quaternion.toArray().every(Number.isFinite));
    }
  }
  animation.dispose();
  }
});

test('equal elapsed time produces matching motion at different frame rates',()=>{
  const a=fixture(),b=fixture();
  for(let i=0;i<30;i++) a.animation.update(1/30,{turn:1,boosting:true},a.net);
  for(let i=0;i<120;i++) b.animation.update(1/120,{turn:1,boosting:true},b.net);
  const first=pose(a.animation),second=pose(b.animation);
  for(let i=0;i<first.length;i++) for(let j=0;j<first[i].length;j++) assert.ok(Math.abs(first[i][j]-second[i][j])<1e-5);
  a.animation.dispose();b.animation.dispose();
});

test('pause freezes the pose; reset restores the starting animation',()=>{
  const {animation,net}=fixture();
  for(let i=0;i<30;i++) animation.update(1/60,{turn:-1,catchTimer:.5},net);
  const before=pose(animation),time=animation.mixer.time;
  animation.update(0,{turn:-1,catchTimer:.5},net);
  assert.equal(animation.mixer.time,time);assert.deepEqual(pose(animation),before);
  animation.reset();animation.update(0,{},net);
  assert.ok(Math.abs(animation.actions.SurfIdle.getEffectiveWeight()-1)<1e-8);
  assert.equal(animation.actions.Scoop.getEffectiveWeight(),0);
  animation.dispose();
});

test('event clips follow gameplay timers and moving net grips stay attached through interruptions',()=>{
  const {animation,root,net}=fixture(),motion=createSurfMotion();
  const state={turn:1,catchTimer:.75,landingTimer:0,hit:0,netAngle:0};
  for(let i=0;i<100;i++){
    state.netAngle=NET_LEFT_ANGLE*(1-Math.exp(-i/10));state.turn=Math.sin(i/20);
    if(i===22)state.catchTimer=.75;
    if(i===65)state.landingTimer=.55;
    const visual=motion.update(1/60,state);applyNetPose(net,state.netAngle,visual);
    animation.update(1/60,state,net,visual);root.updateMatrixWorld(true);
    if(state.catchTimer>0)assert.ok(Math.abs(animation.actions.Scoop.time/animation.actions.Scoop.getClip().duration-(1-state.catchTimer/.75))<1e-8);
    if(state.landingTimer>0)assert.ok(Math.abs(animation.actions.Land.time/animation.actions.Land.getClip().duration-(1-state.landingTimer/.55))<1e-8);
    for(const chain of animation.chains){
      const target=chain.kind==='leg'?animation.avatar.localToWorld(chain.target.clone()):net.localToWorld(netHandGrip(chain.suffix,state.netAngle,new THREE.Vector3()));
      assert.ok(target.distanceTo(chain.end.getWorldPosition(new THREE.Vector3()))<.012);
    }
    state.catchTimer=Math.max(0,state.catchTimer-1/60);state.landingTimer=Math.max(0,state.landingTimer-1/60);
  }
  const head=animation.avatar.getObjectByName('Head').quaternion.clone(),chest=animation.avatar.getObjectByName('Chest').quaternion.clone();
  // Freezing does not repeatedly add the procedural torso/head offsets.
  for(let i=0;i<10;i++)animation.update(0,state,net,motion.pose);
  assert.ok(head.angleTo(animation.avatar.getObjectByName('Head').quaternion)<1e-7);
  assert.ok(chest.angleTo(animation.avatar.getObjectByName('Chest').quaternion)<1e-7);
  animation.dispose();
});
