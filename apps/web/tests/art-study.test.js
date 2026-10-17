import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createWater } from '../dist/environment.js';
import { WATER_AMPLITUDE } from '../dist/water-surface.js';
import { loadGLBFixture } from './helpers/gltf-fixture.js';

test('pilot shore exports finite material batches and a bounded bank',async()=>{
  const asset=await loadGLBFixture('shore-study');
  let count=0;
  asset.scene.traverse(mesh=>{
    if(!mesh.isMesh)return;count++;
    for(const name of ['position','normal','color'])assert.ok(mesh.geometry.getAttribute(name).array.every(Number.isFinite));
    const positions=mesh.geometry.getAttribute('position');
    for(const index of mesh.geometry.index?.array||[])assert.ok(index<positions.count);
  });
  assert.ok(count>0&&count<=12,'The complete composed shore should remain batched instead of drawing every leaf separately');
  const bounds=new THREE.Box3().setFromObject(asset.scene);
  assert.ok(bounds.min.x>-12&&bounds.max.x<12);assert.ok(bounds.min.z>-30&&bounds.max.z<30);
  assert.ok(bounds.max.y<12&&bounds.max.y>7);
});

test('study water shares physical displacement and distinct shader programs with the existing maps',()=>{
  const scene=new THREE.Scene(),original=createWater(THREE,scene),pilot=createWater(THREE,scene,false,'study'),painted=createWater(THREE,scene,false,'illustrated');
  assert.notEqual(original.water.material.customProgramCacheKey(),pilot.water.material.customProgramCacheKey());
  assert.notEqual(pilot.water.material.customProgramCacheKey(),painted.water.material.customProgramCacheKey());
  for(const {water} of [original,pilot,painted]){
    assert.ok(water.geometry.boundingBox.min.y<=-WATER_AMPLITUDE);
    assert.ok(water.geometry.boundingBox.max.y>=WATER_AMPLITUDE);
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>\n#include <normal_fragment_begin>\n#include <opaque_fragment>'};
    water.material.onBeforeCompile(shader);
    assert.ok(shader.vertexShader.includes('waterHeight(vWater,uWaterTime)'));
    assert.ok(shader.fragmentShader.includes('waterSlope(vWater,uWaterTime)'));
    assert.ok(!shader.fragmentShader.includes('undefined'));
    assert.doesNotMatch(shader.fragmentShader,/\bfloat\s+patch\b/,'patch is reserved by the WebGL GLSL compiler');
    water.geometry.dispose();water.material.dispose();
  }
});
