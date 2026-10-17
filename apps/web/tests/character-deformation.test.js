import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { CHARACTERS } from '../dist/appearance.js';
import { createSurferAnimation } from '../dist/surfer-animation.js';
import { applyNetPose,createSurfMotion } from '../dist/surf-motion.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';

const assets=Object.fromEntries(await Promise.all(CHARACTERS.map(async character=>{
  const bytes=await readFile(new URL(`../dist/assets/surfer-${character.id}.glb`,import.meta.url));
  return [character.id,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')];
})));
const point=new THREE.Vector3(),start=new THREE.Vector3(),axis=new THREE.Vector3(),offset=new THREE.Vector3();
function radius(vertex,a,b){
  axis.copy(b).sub(a).normalize();offset.copy(vertex).sub(a);
  return offset.addScaledVector(axis,-offset.dot(axis)).length();
}
function sample(actor,net,state){
  actor.reset();const motion=createSurfMotion();
  for(let frame=0;frame<45;frame++){
    const visual=motion.update(1/60,state);applyNetPose(net,state.netAngle||0,visual);
    actor.update(1/60,state,net,visual);
  }
  actor.avatar.updateWorldMatrix(true,true);
  actor.avatar.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update();});
}

test('reaching the pole on either side preserves authored upper-arm thickness through jump, boost and collection',()=>{
  for(const character of CHARACTERS){
    const asset=assets[character.id];asset.scene.updateMatrixWorld(true);
    const source=asset.scene.getObjectByName('Skin');source.skeleton.update();
    const actor=createSurferAnimation(asset,'#ef795e',character.hair,{...character,character:character.id});
    const net=new THREE.Group(),root=new THREE.Group();root.add(actor.avatar,net);
    const mesh=actor.avatar.getObjectByName('Skin'),joints=source.geometry.getAttribute('skinIndex'),weights=source.geometry.getAttribute('skinWeight');
    for(const chain of actor.chains.filter(chain=>chain.kind==='arm')){
      const name='UpperArm_'+chain.suffix;
      const a=asset.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
      const b=asset.scene.getObjectByName('Forearm_'+chain.suffix).getWorldPosition(new THREE.Vector3());
      const vertices=[];
      for(let i=0;i<weights.count;i++){
        let influence=0;
        for(let slot=0;slot<4;slot++)if(source.skeleton.bones[joints.getComponent(i,slot)]?.name===name)influence+=weights.getComponent(i,slot);
        if(influence<.99999)continue;
        source.getVertexPosition(i,point);point.applyMatrix4(source.matrixWorld);
        vertices.push({index:i,radius:radius(point,a,b)});
      }
      assert.ok(vertices.length>12,`${character.id}/${name}: need actual contour samples`);
      for(const netAngle of [0,NET_LEFT_ANGLE*.5,NET_LEFT_ANGLE])for(const pose of [{},{jump:1},{boosting:true},{catchTimer:.4}]){
        sample(actor,net,{...pose,netAngle});
        const a=chain.upper.getWorldPosition(new THREE.Vector3()),b=chain.lower.getWorldPosition(new THREE.Vector3());
        for(const vertex of vertices){
          mesh.getVertexPosition(vertex.index,point);point.applyMatrix4(mesh.matrixWorld);
          assert.ok(Math.abs(radius(point,a,b)-vertex.radius)<.0001,`${character.id}/${name}: limb inflates while reaching`);
        }
      }
    }
    actor.dispose();
  }
});

test('sewn short panels share deforming boundary vertices instead of separating into overlapping shells',()=>{
  const fabrics={nico:['Nico navy lycra','Warm cream'],luna:['Luna indigo sport shorts','Luna lavender technical panel'],samuel:['Samuel long boardshorts','Samuel fitted lagoon lycra']};
  for(const [id,[cloth,panel]] of Object.entries(fabrics)){
    const actor=createSurferAnimation(assets[id],'#ef795e'),net=new THREE.Group(),root=new THREE.Group();root.add(actor.avatar,net);
    const boundaries=new Map(),pairs=[];
    actor.avatar.traverse(mesh=>{
      if(!mesh.isSkinnedMesh||![cloth,panel].includes(mesh.material.name))return;
      const positions=mesh.geometry.getAttribute('position');
      for(let index=0;index<positions.count;index++){
        point.fromBufferAttribute(positions,index);
        const key=point.toArray().map(value=>value.toFixed(6)).join(',');
        if(!boundaries.has(key))boundaries.set(key,[]);
        boundaries.get(key).push({mesh,index});
      }
    });
    for(const entries of boundaries.values()){
      const a=entries.find(entry=>entry.mesh.material.name===cloth),b=entries.find(entry=>entry.mesh.material.name===panel);
      if(a&&b)pairs.push([a,b]);
    }
    assert.ok(pairs.length>=16,`${id}: coloured insets must share the cloth's actual boundary`);
    for(const netAngle of [0,NET_LEFT_ANGLE])for(const pose of [{jump:1},{catchTimer:.4},{boosting:true}]){
      sample(actor,net,{...pose,netAngle});
      for(const [a,b] of pairs){
        a.mesh.getVertexPosition(a.index,start);start.applyMatrix4(a.mesh.matrixWorld);
        b.mesh.getVertexPosition(b.index,point);point.applyMatrix4(b.mesh.matrixWorld);
        assert.ok(start.distanceTo(point)<.00001,`${id}: fabric seam separates in motion`);
      }
    }
    actor.dispose();
  }
});

test('vest walls face outward at rest instead of folding back under the armholes',()=>{
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),radial=new THREE.Vector3();
  for(const character of CHARACTERS){
    const source=assets[character.id];source.scene.updateMatrixWorld(true);let checked=0;
    source.scene.traverse(mesh=>{
      if(!mesh.isMesh||mesh.material.name!=='OutfitColor')return;
      const positions=mesh.geometry.getAttribute('position'),index=mesh.geometry.index,count=index?.count||positions.count;
      for(let i=0;i<count;i+=3){
        a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        const height=(a.y+b.y+c.y)/3,span=Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y);
        normal.copy(b).sub(a).cross(radial.copy(c).sub(a));
        // Ignore the tiny tubes in decorative piping; evaluate the torso wall.
        if(height<1.65||height>2.3||span<.015||normal.length()*.5<.00008)continue;
        radial.copy(a).add(b).add(c).multiplyScalar(1/3);radial.y=0;radial.z-=.03;
        assert.ok(normal.normalize().dot(radial.normalize())>0,`${character.id}: garment wall folds inside out near ${height.toFixed(3)} m`);
        checked++;
      }
    });
    assert.ok(checked>200,`${character.id}: evaluate the real torso wall`);
  }
});
