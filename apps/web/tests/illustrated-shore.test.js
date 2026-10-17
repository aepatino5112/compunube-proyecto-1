import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createIllustratedShore } from '../dist/illustrated-shore.js';
import { createCoastalRibbon } from '../dist/coastal-ribbon.js';
import { createShoreLayout,SHORE_CLEARANCE,shoreVisible } from '../dist/shore-layout.js';
import { createCourse } from '../dist/maps.js';
import { ROCK_NAMES } from '../dist/rock-kit.js';
import { WATER_BASE,WATER_AMPLITUDE,sampleWater } from '../dist/water-surface.js';
import { loadGLBFixture } from './helpers/gltf-fixture.js';

const load=loadGLBFixture;

test('coastal foam stays just above the shared water level, with continuous samples and conservative bounds',()=>{
  const coast=createCoastalRibbon(THREE,new THREE.Group()),geometry=coast.foam.geometry;
  const positions=geometry.attributes.position,index=geometry.index;
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
  coast.foam.material.onBeforeCompile(shader);
  const displacement=shader.vertexShader.match(/transformed\.y=(-?[\d.]+)\+waterHeight\(position\.xz,uCoastTime\)\+([\d.]+);/);
  assert.ok(displacement,'the shoreline must use the shared water function and a small contact offset');
  const base=Number(displacement[1]),lift=Number(displacement[2]);
  assert.equal(base,WATER_BASE,'wave amplitude alone is not the absolute water level');
  assert.ok(lift>0&&lift<.05,'foam must sit at the surface rather than hover above it');
  assert.ok(geometry.boundingBox.min.y<=WATER_BASE+lift-WATER_AMPLITUDE);
  assert.ok(geometry.boundingBox.max.y>=WATER_BASE+lift+WATER_AMPLITUDE);
  for(let i=0;i<positions.count;i++){
    assert.ok(Math.abs(positions.getX(i))>SHORE_CLEARANCE);
    for(const time of [0,2.4,19]){
      const water=sampleWater(positions.getX(i),positions.getZ(i),time);
      const foamY=base+(water.height-WATER_BASE)+lift;
      assert.ok(foamY>=geometry.boundingBox.min.y&&foamY<=geometry.boundingBox.max.y);
      assert.ok(Math.abs(foamY-water.height-lift)<1e-12);
    }
  }
  let smallestZ=Infinity,largestZ=-Infinity;
  for(let i=0;i<index.count;i+=3){
    const zs=[index.getX(i),index.getX(i+1),index.getX(i+2)].map(vertex=>{
      assert.ok(vertex<positions.count,'every shoreline face must reference an existing vertex');
      return positions.getZ(vertex);
    });
    smallestZ=Math.min(smallestZ,...zs);largestZ=Math.max(largestZ,...zs);
    assert.ok(Math.max(...zs)-Math.min(...zs)<=4.001,'long triangles visibly cut across the water waves');
  }
  assert.equal(smallestZ,-1500);assert.equal(largestZ,100);
  assert.equal(coast.land.geometry.index.count/3,1440,'extra water sampling must not change the broader terrain');
  assert.equal(index.count/3,1600,'contact refinement keeps a bounded mesh cost');
  assert.equal(coast.foam.material.forceSinglePass,true,'a thin double-sided sheet does not need two transparent draws');
});

test('composed banks preserve the course, keep real GLB scenery out of the channel and share geometry',async()=>{
  const [village,mangrove,boatAsset,...rockAssets]=await Promise.all(['shore-study','shore-mangrove','canoe',...ROCK_NAMES].map(load));
  const shoreAssets={village,mangrove},bounds={};
  for(const [variant,asset]of Object.entries(shoreAssets)){
    asset.scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(asset.scene,true);
    bounds[variant]={minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z};
    let meshes=0,hasHouse=false;
    asset.scene.traverse(mesh=>{
      if(!mesh.isMesh)return;meshes++;
      for(const attribute of ['position','normal','color'])assert.ok(mesh.geometry.attributes[attribute].array.every(Number.isFinite));
      hasHouse||=mesh.material.name.includes('house');
    });
    assert.ok(meshes>0&&meshes<=12);
    assert.equal(hasHouse,variant==='village','the mangrove bank must not export village buildings');
  }
  const course=createCourse('maracaibo'),before=structuredClone(course),parent=new THREE.Group();
  const shore=createIllustratedShore(THREE,parent,{islands:course.islands,shoreAssets,boatAsset,rockAssets});
  parent.updateMatrixWorld(true);
  assert.deepEqual(course,before);
  assert.deepEqual(shore.layout,createShoreLayout(course.islands,bounds));
  assert.equal(shore.layout.banks.length,course.islands.length);
  assert.equal(new Set(shore.layout.banks.map(bank=>bank.variant)).size,2);
  assert.ok(shore.layout.forest.length>0);
  assert.equal(new Set(shore.layout.forest.map(bank=>bank.side)).size,2,'the outer forest needs depth on both banks');
  const matrix=new THREE.Matrix4(),box=new THREE.Box3(),sourceGeometries=new Set();
  for(const asset of Object.values(shoreAssets))asset.scene.traverse(mesh=>{if(mesh.isMesh)sourceGeometries.add(mesh.geometry);});
  shore.root.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    assert.ok(Number.isFinite(mesh.boundingSphere.radius));
    if(!mesh.userData.shoreVariant)return;
    assert.ok(sourceGeometries.has(mesh.geometry),'placements must reuse their imported geometry');
    mesh.geometry.computeBoundingBox();
    for(let index=0;index<mesh.count;index++){
      mesh.getMatrixAt(index,matrix);matrix.premultiply(mesh.matrixWorld);
      assert.ok(matrix.elements.every(Number.isFinite));
      box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
      const clearance=box.min.x>0?box.min.x:-box.max.x;
      assert.ok(clearance>=SHORE_CLEARANCE-.0001,`decorative bank crosses its clearance: ${clearance}`);
    }
  });
  const coastPositions=shore.coast.land.geometry.attributes.position;
  for(let i=0;i<coastPositions.count;i++)assert.ok(Math.abs(coastPositions.getX(i))>SHORE_CLEARANCE);
  assert.ok(shore.coast.land.geometry.attributes.normal.array.every(Number.isFinite));
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
  shore.coast.foam.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('waterHeight(position.xz,uCoastTime)'));
  shore.coast.update(10);assert.equal(shader.uniforms.uCoastTime.value,10);
  shore.coast.update(10);assert.equal(shader.uniforms.uCoastTime.value,10);
  shore.coast.update(10,true);assert.equal(shader.uniforms.uCoastTime.value,0);
  const batches=[];shore.root.traverse(mesh=>{if(mesh.userData.shoreVariant)batches.push({mesh,buffer:mesh.instanceMatrix.array});});
  assert.ok(shore.layout.backdrop.every(bank=>bank.z<-900),'finish scenery must remain outside the course');
  const placements=[...shore.layout.banks,...shore.layout.forest,...shore.layout.backdrop];
  for(const viewZ of [0,-450,-900,0]){
    shore.setView(viewZ);const center=Math.floor(viewZ/24)*24;
    for(const {mesh,buffer}of batches){
      assert.equal(mesh.instanceMatrix.array,buffer,'view changes must not allocate replacement buffers');
      assert.equal(mesh.count,placements.filter(bank=>bank.variant===mesh.userData.shoreVariant&&shoreVisible(bank,center)).length);
      assert.ok(buffer.slice(0,mesh.count*16).every(Number.isFinite));
    }
  }
  assert.ok(batches.some(({mesh})=>mesh.count<placements.filter(bank=>bank.variant===mesh.userData.shoreVariant).length),'a view window should omit distant banks');
  const foamMatrices=shore.shoreFoam.mesh.instanceMatrix.array;
  shore.shoreFoam.update(10);shore.shoreFoam.update(10);shore.shoreFoam.update(0,true);
  assert.equal(shore.shoreFoam.mesh.instanceMatrix.array,foamMatrices);
});
