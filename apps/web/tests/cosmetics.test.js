import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { CATALOG,freshProfile,restoreProfile,transact } from '../dist/economy.js';
import { createSurferAnimation } from '../dist/surfer-animation.js';
import { advanceNetAngle } from '../dist/surf-motion.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';
import { CHARACTERS,HAIR_STYLES,SKIN_TONES,HAIR_COLORS } from '../dist/appearance.js';

const bytes=await readFile(new URL('../dist/assets/surfer.glb',import.meta.url));
const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');

test('old profiles retain inventory and gain a valid hairstyle; styles and all seven nets persist',()=>{
  const old={version:1,coins:150,plastic:30,metal:20,owned:['sol','red-marea'],equipped:{board:'sol',net:'red-marea',outfit:'costero'}};
  const restored=restoreProfile(old);assert.equal(restored.coins,150);assert.equal(restored.equipped.net,'red-marea');assert.equal(restored.equipped.hair,'swept');
  for(const style of HAIR_STYLES){
    const result=transact(restored,{type:'equip',id:style});assert.equal(result.error,null);
    assert.equal(restoreProfile(JSON.parse(JSON.stringify(result.profile))).equipped.hair,style);
    assert.equal(result.profile.coins,150);assert.equal(result.profile.plastic,30);
  }
  assert.equal(CATALOG.filter(item=>item.type==='net').length,7);
  for(const item of CATALOG.filter(item=>item.type==='net'&&item.recipe)){
    const before={...freshProfile(),plastic:item.recipe.plastic,metal:item.recipe.metal};
    const crafted=transact(before,{type:'craft',id:item.id});assert.equal(crafted.error,null);
    assert.equal(crafted.profile.plastic,0);assert.equal(crafted.profile.metal,0);
    const duplicate=transact(crafted.profile,{type:'craft',id:item.id});assert.ok(duplicate.error);assert.equal(duplicate.profile,crafted.profile);
    const equipped=transact(crafted.profile,{type:'equip',id:item.id});assert.equal(equipped.error,null);
    assert.equal(restoreProfile(equipped.profile).equipped.net,item.id);
    assert.ok(!['speed','reach','boost','capacity'].some(key=>key in item),'Cosmetics must not carry gameplay modifiers');
  }
});

test('legacy inventory survives migration and appearance choices persist without spending materials',()=>{
  const old={version:1,coins:150,plastic:30,metal:20,owned:['sol','red-marea'],equipped:{board:'sol',net:'red-marea',outfit:'costero'}};
  let profile=restoreProfile(old);
  assert.equal(profile.equipped.character,'nico');assert.deepEqual(profile.appearance,{skin:'medium',hairColor:'brown'});
  for(const character of CHARACTERS){
    const selected=transact(profile,{type:'equip',id:character.id});assert.equal(selected.error,null);profile=selected.profile;
    assert.equal(profile.equipped.character,character.id);assert.equal(profile.equipped.hair,character.hair);
    assert.deepEqual(profile.appearance,{skin:character.skin,hairColor:character.hairColor});
    for(const [field,choices] of [['skin',SKIN_TONES],['hairColor',HAIR_COLORS]])for(const choice of choices){
      const result=transact(profile,{type:'appearance',field,value:choice.id});assert.equal(result.error,null);profile=result.profile;
      assert.equal(restoreProfile(JSON.parse(JSON.stringify(profile))).appearance[field],choice.id);
    }
    assert.equal(profile.coins,150);assert.equal(profile.plastic,30);assert.equal(profile.metal,20);
    assert.equal(profile.equipped.board,'sol');assert.equal(profile.equipped.net,'red-marea');
  }
  for(const action of [{type:'appearance',field:'skin',value:'invalid'},{type:'appearance',field:'speed',value:'light'},{type:'appearance',field:'hairColor',value:null}]){
    const result=transact(profile,action);assert.ok(result.error);assert.equal(result.profile,profile);
  }
  const damaged=restoreProfile({...profile,appearance:{skin:'invalid',hairColor:'invalid'},equipped:{...profile.equipped,character:'invalid'}});
  assert.deepEqual(damaged.appearance,{skin:'medium',hairColor:'brown'});assert.equal(damaged.equipped.character,'nico');
});

test('character morphs are authored geometry and stay independent through animation and color changes',()=>{
  const a=createSurferAnimation(asset,undefined,'ponytail',{character:'luna',skin:'light',hairColor:'blonde'});
  const b=createSurferAnimation(asset,undefined,'afro',{character:'amara',skin:'deep',hairColor:'black'});
  const skin=actor=>actor.avatar.getObjectByName('Skin');
  const first=skin(a),second=skin(b),source=asset.scene.getObjectByName('Skin');
  assert.equal(first.geometry,second.geometry);assert.notEqual(first.material,second.material);assert.notEqual(first.material,source.material);
  assert.notEqual(first.morphTargetInfluences,second.morphTargetInfluences);
  const position=first.geometry.getAttribute('position'),morphs=first.geometry.morphAttributes.position;
  for(const character of CHARACTERS.filter(item=>item.morph)){
    const index=first.morphTargetDictionary[character.morph];assert.ok(Number.isInteger(index));
    assert.ok(morphs[index].array.some((value,i)=>Math.abs(value-(first.geometry.morphTargetsRelative?0:position.array[i]))>1e-4),`${character.name} needs a real shape change`);
  }
  const initial=second.morphTargetInfluences.slice(),otherColor=second.material.color.clone(),sourceColor=source.material.color.clone();
  a.setAppearance({character:'samuel',skin:'warm',hairColor:'copper'});
  for(let i=0;i<60;i++)a.update(1/60,{turn:1,catchTimer:.5});
  assert.equal(first.morphTargetInfluences[first.morphTargetDictionary.Samuel],1);
  assert.equal(first.morphTargetInfluences[first.morphTargetDictionary.Luna],0);
  assert.deepEqual(second.morphTargetInfluences,initial);assert.ok(second.material.color.equals(otherColor));assert.ok(source.material.color.equals(sourceColor));
  assert.ok(first.material.color.equals(new THREE.Color(SKIN_TONES.find(item=>item.id==='warm').color)));
  a.dispose();b.setHair('ponytail');b.setAppearance({hairColor:'blue'});
  assert.equal(second.morphTargetInfluences[second.morphTargetDictionary.Amara],1);b.dispose();
});

test('five real hair silhouettes switch independently without duplicating geometry or altering the rig',()=>{
  const a=createSurferAnimation(asset,undefined,'swept'),b=createSurferAnimation(asset,undefined,'curls');
  const meshes=actor=>{const all=[];actor.avatar.traverse(o=>{if(o.isMesh&&o.material.name.startsWith('Hair-'))all.push(o);});return all;};
  const first=meshes(a),second=meshes(b);assert.equal(first.length,5);assert.equal(second.length,5);
  const bone=a.avatar.getObjectByName('Head').quaternion.clone();
  for(const style of ['swept','curls','bun','ponytail','afro']){
    a.setHair(style);assert.deepEqual(first.filter(o=>o.visible).map(o=>o.material.name),[`Hair-${style}`]);
    assert.deepEqual(second.filter(o=>o.visible).map(o=>o.material.name),['Hair-curls']);
    assert.ok(bone.equals(a.avatar.getObjectByName('Head').quaternion));
  }
  first.forEach((mesh,i)=>assert.equal(mesh.geometry,second[i].geometry));
  a.setHair('invalid');assert.equal(first.filter(o=>o.visible)[0].material.name,'Hair-swept');a.dispose();b.dispose();
});

test('side transfer is continuous on reversal, freezes on pause and matches elapsed time across frame rates',()=>{
  let a=0,b=0;
  for(let i=0;i<30;i++)a=advanceNetAngle(a,-1,1/30);
  for(let i=0;i<120;i++)b=advanceNetAngle(b,-1,1/120);
  assert.ok(Math.abs(a-b)<1e-10);assert.ok(Math.abs(a-NET_LEFT_ANGLE)<.001);
  const halfway=advanceNetAngle(0,-1,.12),reversed=advanceNetAngle(halfway,1,1/120);
  assert.ok(reversed>0&&reversed<halfway);assert.ok(halfway-reversed<.1);
  assert.equal(advanceNetAngle(reversed,-1,0),reversed);
});
