import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { configureIllustratedMaterial,createIllustratedBinding } from '../dist/illustrated-materials.js';

test('painted materials preserve owned colours, emissive gear and skinned/instanced shader transforms',()=>{
  const material=new THREE.MeshStandardMaterial({color:0x754630,emissive:0x2756ab,emissiveIntensity:1.8});material.name='Skin';
  const original=material.color.clone(),emissive=material.emissive.clone();
  configureIllustratedMaterial(material,'actor');const callback=material.onBeforeCompile,key=material.customProgramCacheKey();
  configureIllustratedMaterial(material,'actor');assert.equal(material.onBeforeCompile,callback);assert.equal(material.customProgramCacheKey(),key);
  assert.ok(material.color.equals(original));assert.ok(material.emissive.equals(emissive));assert.equal(material.emissiveIntensity,1.8);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('#include <skinning_vertex>'));assert.ok(shader.vertexShader.includes('paintVertex=instanceMatrix*paintVertex'));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'));
  for(const uniform of Object.values(shader.uniforms)){
    const value=uniform.value;
    if(typeof value==='number')assert.ok(Number.isFinite(value));
    else assert.ok([value.x,value.y,value.z].every(Number.isFinite));
  }
  // Material.clone copies userData but not onBeforeCompile; it must still be configured.
  const copy=configureIllustratedMaterial(material.clone(),'actor'),copyShader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};copy.onBeforeCompile(copyShader);
  assert.ok(copyShader.uniforms.uPaintRange);assert.ok(copy.color.equals(original));material.dispose();copy.dispose();
});

test('scenery bindings share geometry, own one material per source and restore safely on disposal',()=>{
  const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:0x357153}),root=new THREE.Group();
  const first=new THREE.Mesh(geometry,material),second=new THREE.InstancedMesh(geometry,material,2);root.add(first,second);
  let originalDisposed=0;material.addEventListener('dispose',()=>originalDisposed++);
  const binding=createIllustratedBinding(root);assert.equal(binding.count,1);assert.equal(first.material,second.material);assert.notEqual(first.material,material);
  assert.equal(first.geometry,geometry);assert.equal(second.geometry,geometry);
  binding.enable(false);assert.equal(first.material,material);binding.enable(true);assert.notEqual(first.material,material);
  let copiesDisposed=0;first.material.addEventListener('dispose',()=>copiesDisposed++);binding.dispose();
  assert.equal(first.material,material);assert.equal(second.material,material);assert.equal(copiesDisposed,1);assert.equal(originalDisposed,0);
  geometry.dispose();material.dispose();
});
