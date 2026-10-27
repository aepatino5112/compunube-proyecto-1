import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { createArtDirection, HORIZON_DISTANCE, SUN_DIRECTION, composeSurfCamera } from '../dist/art-direction.js';
import { createRockKit, ROCK_NAMES } from '../dist/rock-kit.js';
import { createCourse, MAPS } from '../dist/maps.js';

async function load(name){const bytes=await readFile(new URL(`../dist/assets/${name}.glb`,import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}

test('the real landmark remains ahead and inside the race camera from start to finish',async()=>{
  const asset=await load('maracaibo-bridge'),scene=new THREE.Scene(),art=createArtDirection(THREE,scene,asset.scene);
  const camera=new THREE.PerspectiveCamera(48,16/9,.1,1100),frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),box=new THREE.Box3();
  const position=new THREE.Vector3(),look=new THREE.Vector3();
  for(const aspect of [16/9,390/772])for(const distance of [0,250,450,700,900])for(const x of [-15,0,15]){
    const z=-distance;art.update(z,'maracaibo');scene.updateMatrixWorld(true);
    camera.aspect=aspect;camera.updateProjectionMatrix();composeSurfCamera(aspect,x,z,position,look);camera.position.copy(position);camera.lookAt(look);camera.updateMatrixWorld(true);
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    box.setFromObject(art.bridge,true);assert.ok(box.max.z<z-350);assert.ok(frustum.intersectsBox(box));
    assert.equal(art.bridge.getWorldPosition(new THREE.Vector3()).z,z-HORIZON_DISTANCE);
    const lightDirection=art.light.position.clone().sub(art.light.target.position).normalize();
    assert.ok(lightDirection.distanceTo(new THREE.Vector3(...SUN_DIRECTION).normalize())<1e-10);
  }
  const geometry=art.sky.geometry,transform=art.root.matrixWorld.clone();art.update(-900);scene.updateMatrixWorld(true);
  assert.deepEqual(art.root.matrixWorld.elements,transform.elements);assert.equal(art.sky.geometry,geometry);
  art.update(0,'orinoco');assert.equal(art.bridge.visible,false);
  for(const aspect of [16/9,390/772]){
    camera.aspect=aspect;camera.updateProjectionMatrix();composeSurfCamera(aspect,0,0,position,look);camera.position.copy(position);camera.lookAt(look);camera.updateMatrixWorld(true);
    const sunPoint=new THREE.Vector3(...SUN_DIRECTION).normalize().multiplyScalar(850).project(camera);
    assert.ok(Math.abs(sunPoint.x)<1&&Math.abs(sunPoint.y)<1,'the sun must fit the desktop and portrait camera');
  }
});

test('four coloured Blender rocks fit the collision envelope and batch both unmodified courses',async()=>{
  const assets=await Promise.all(ROCK_NAMES.map(load)),silhouettes=[];
  for(const asset of assets){
    asset.scene.updateMatrixWorld(true);let meshes=0;
    asset.scene.traverse(mesh=>{
      if(!mesh.isMesh)return;meshes++;
      assert.ok(mesh.geometry.attributes.color,'the exported strata need vertex colours');
      assert.ok(mesh.geometry.attributes.color.array.every(Number.isFinite));
      const positions=mesh.geometry.attributes.position,point=new THREE.Vector3();
      for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);assert.ok(point.length()<3);assert.ok(Math.hypot(point.x,point.z)<=1.8);}
      assert.ok(positions.array.every(Number.isFinite));silhouettes.push([...positions.array].slice(0,30).join(','));
    });assert.equal(meshes,1);
  }
  assert.equal(new Set(silhouettes).size,4);
  const rocks=createCourse('maracaibo').obstacles.filter((_,i)=>i%3).length;
  const kit=createRockKit(THREE,new THREE.Scene(),assets,rocks),buffers=kit.batches.map(b=>b.mesh.instanceMatrix.array);
  for(const map of MAPS){
    const course=createCourse(map.id),before=structuredClone(course);
    kit.sync(course.obstacles.filter((_,i)=>i%3).map(item=>({x:item.x,z:item.z,angle:item.rotation})));
    assert.equal(kit.batches.length,4);assert.equal(kit.batches.reduce((n,b)=>n+b.mesh.count,0),rocks);
    kit.batches.forEach((batch,i)=>{assert.equal(batch.mesh.instanceMatrix.array,buffers[i]);assert.ok(batch.mesh.boundingSphere.radius>0);assert.ok(batch.mesh.instanceMatrix.array.every(Number.isFinite));});
    assert.deepEqual(course,before);
  }
});
