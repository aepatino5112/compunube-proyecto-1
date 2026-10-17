import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { CHARACTERS,HAIR_STYLES } from '../dist/appearance.js';
import { createSurferAnimation,selectSurferAsset } from '../dist/surfer-animation.js';

const assets=Object.fromEntries(await Promise.all(CHARACTERS.map(async character=>{
  const bytes=await readFile(new URL(`../dist/assets/surfer-${character.id}.glb`,import.meta.url));
  return [character.id,await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')];
})));

test('the club exports distinct skinned clothing and silhouettes without losing hair choices or independent materials',()=>{
  const requiredClips=['Boost','Hit','Jump','Land','Scoop','SurfIdle','TurnLeft','TurnRight'],shapes=[];
  for(const character of CHARACTERS){
    const source=assets[character.id];assert.equal(selectSurferAsset({...assets,default:assets.nico},character.id),source);
    assert.deepEqual(source.animations.map(clip=>clip.name).sort(),requiredClips);
    assert.ok(source.scene.getObjectByName('CartoonSurfer').userData.grip_frame);
    const actor=createSurferAnimation(source,'#ef795e',character.hair,{...character,character:character.id});
    const peer=createSurferAnimation(source,'#749dcc','afro',{...character,character:character.id});
    const skin=actor.avatar.getObjectByName('Skin'),other=peer.avatar.getObjectByName('Skin');
    assert.equal(skin.skeleton.bones.length,15);assert.equal(skin.geometry,other.geometry);assert.notEqual(skin.material,other.material);assert.notEqual(skin.skeleton,other.skeleton);
    actor.avatar.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;
      const geometry=mesh.geometry,positions=geometry.getAttribute('position'),weights=geometry.getAttribute('skinWeight'),colours=geometry.getAttribute('color');
      assert.ok(positions.array.every(Number.isFinite));assert.equal(colours.count,positions.count);assert.ok(colours.array.every(Number.isFinite));
      for(let i=0;i<weights.count;i++)assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-6,`${character.id}: normalized clothing weights`);
    });
    for(const style of HAIR_STYLES){
      actor.setHair(style);const visible=[];
      actor.avatar.traverse(mesh=>{if(mesh.isMesh&&mesh.visible&&mesh.material.name.startsWith('Hair-'))visible.push(mesh.material.name);});
      assert.deepEqual(visible,[`Hair-${style}`]);
    }
    const fixedMaterials=[];actor.avatar.traverse(mesh=>{if(mesh.isMesh&&!mesh.material.name.startsWith('Hair-'))fixedMaterials.push(mesh.material.name);});
    if(character.id!=='amara')assert.ok(fixedMaterials.some(name=>name.startsWith(character.name+' ')),`${character.name}: authored clothing must be distinct from the shared base`);
    actor.setHair(character.hair);actor.avatar.updateMatrixWorld(true);
    shapes.push(new THREE.Box3().setFromObject(actor.avatar,true).getSize(new THREE.Vector3()).toArray().map(value=>value.toFixed(3)).join(','));
    const before=other.material.color.clone();actor.setAppearance({skin:'deep',hairColor:'blue'});actor.update(1/60,{turn:.8});assert.ok(other.material.color.equals(before));
    actor.dispose();peer.update(1/60,{});peer.dispose();
  }
  assert.equal(new Set(shapes).size,4,'All four silhouettes must be independently authored');
});
