import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { createEquipmentKit } from '../dist/equipment.js';
import { createSurferAnimation } from '../dist/surfer-animation.js';
import { CATALOG, freshProfile, restoreProfile, transact } from '../dist/economy.js';
import { NET_LEFT_ANGLE,netHandGrip } from '../dist/mechanics.js';
import { applyNetPose } from '../dist/surf-motion.js';

async function load(name) {
  const bytes = await readFile(new URL(`../dist/assets/${name}.glb`,import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
const items=CATALOG.filter(i=>['board','net'].includes(i.type));
const assets=Object.fromEntries(await Promise.all(items.map(async i=>[i.id,await load(`${i.type}-${i.id}`)])));
const kit=createEquipmentKit(assets), surfer=await load('surfer'),amara=await load('surfer-amara');
const club=[amara,...await Promise.all(['nico','luna','samuel'].map(id=>load(`surfer-${id}`)))];

test('equipped designs survive crafting, purchases and an existing v1 save',()=>{
  let profile={...freshProfile(),coins:500,plastic:50,metal:25};
  for(const action of [{type:'buy',id:'manglar'},{type:'craft',id:'red-marea'},{type:'equip',id:'manglar'},{type:'equip',id:'red-marea'}]) {
    const result=transact(profile,action);assert.equal(result.error,null);profile=result.profile;
  }
  const restored=restoreProfile(JSON.parse(JSON.stringify(profile)));
  assert.deepEqual(restored.equipped,{board:'manglar',net:'red-marea',outfit:'costero',hair:'swept',character:'nico'});
  assert.equal(restored.coins,200);assert.equal(restored.plastic,0);assert.equal(restored.metal,0);
  const board=kit.board(restored.equipped.board), net=kit.net(restored.equipped.net);
  assert.equal(board.userData.equipmentId,'manglar');
  assert.equal(net.group.userData.equipmentId,'red-marea');
  kit.dispose(board);kit.dispose(net.group);
});

test('changing gear releases only owned materials and keeps other actors intact',()=>{
  for(const item of items) {
    const a=item.type==='board'?kit.board(item.id):kit.net(item.id).group;
    const b=item.type==='board'?kit.board(item.id):kit.net(item.id).group;
    const slot=item.type==='board'?'BoardColor':'NetColor';let first,second;
    a.traverse(o=>{if(o.material?.name===slot)first=o;});b.traverse(o=>{if(o.material?.name===slot)second=o;});
    assert.equal(first.geometry,second.geometry);assert.notEqual(first.material,second.material);
    let released=0,otherReleased=0,geometryReleased=0;
    first.material.addEventListener('dispose',()=>released++);
    second.material.addEventListener('dispose',()=>otherReleased++);
    first.geometry.addEventListener('dispose',()=>geometryReleased++);
    kit.dispose(a);kit.dispose(a);
    assert.equal(released,1);assert.equal(otherReleased,0);assert.equal(geometryReleased,0);
    assert.equal(second.material.color.getHexString(),item.color.slice(1));kit.dispose(b);
  }
});

test('all authored nets keep the pickup anchor and both IK grips during a scoop',()=>{
  for(const source of [surfer,...club]){
  const animation=createSurferAnimation(source),body=new THREE.Group();body.add(animation.avatar);
  for(const item of items.filter(i=>i.type==='net')) {
    const net=kit.net(item.id);body.add(net.group);net.group.updateMatrixWorld(true);
    const contact=net.head.getWorldPosition(new THREE.Vector3());
    assert.ok(contact.distanceTo(new THREE.Vector3(2.05,.34,-1.4))<1e-6);
    for(const side of [0,NET_LEFT_ANGLE*.25,NET_LEFT_ANGLE*.5,NET_LEFT_ANGLE*.75,NET_LEFT_ANGLE]) {
      applyNetPose(net.group,side,{netPitch:.42,netHeight:.1});
      for(let i=0;i<30;i++)animation.update(1/60,{catchTimer:.5,netAngle:side},net.group);
      const oldHead=new THREE.Vector3(2.05,.34,-1.4).applyEuler(new THREE.Euler(.42,side,0)).add(new THREE.Vector3(0,.1,0));
      assert.ok(net.head.getWorldPosition(new THREE.Vector3()).distanceTo(oldHead)<1e-6,`${item.id}: changing reach must not change the pickup head`);
      for(const chain of animation.chains.filter(c=>c.kind==='arm')) {
        const target=net.group.localToWorld(netHandGrip(chain.suffix,side,new THREE.Vector3()));
        assert.ok(target.distanceTo(chain.end.getWorldPosition(new THREE.Vector3()))<.012,item.id);
      }
    }
    body.remove(net.group);kit.dispose(net.group);
  }
  animation.dispose();
  }
});

test('each board supports the planted feet and exports finite geometry',()=>{
  // Raycasts validate the deck below the real foot placements, including concave tails.
  const ray=new THREE.Raycaster();
  for(const item of items.filter(i=>i.type==='board')) {
    const board=kit.board(item.id);board.updateMatrixWorld(true);
    const supports=[];
    for(const actor of [surfer,...club]){
      actor.scene.updateMatrixWorld(true);
      for(const suffix of ['L','R']){
        const foot=actor.scene.getObjectByName('Foot_'+suffix).getWorldPosition(new THREE.Vector3());supports.push([foot.x,foot.z]);
      }
    }
    // Validate the actual rotated adult soles, not just the ankle anchors.
    for(const source of club){
    const skin=source.scene.getObjectByName('Skin'),vertex=new THREE.Vector3();
    for(let i=0;i<skin.geometry.getAttribute('position').count;i++){
      skin.getVertexPosition(i,vertex).applyMatrix4(skin.matrixWorld);
      if(vertex.y>=.29&&vertex.y<=.345)supports.push([vertex.x,vertex.z]);
    }
    }
    for(const [x,z] of supports) {
      ray.set(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0));
      const deck=ray.intersectObject(board,true).filter(hit=>hit.object.material.name==='BoardColor');
      assert.ok(deck.length>0,`${item.id}: unsupported foot`);
      assert.ok(deck[0].point.y>.29 && deck[0].point.y<.35,`${item.id}: deck height`);
    }
    board.traverse(o=>{if(o.isMesh)assert.ok(o.geometry.getAttribute('position').array.every(Number.isFinite));});
    kit.dispose(board);
  }
});
