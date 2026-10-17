import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createContactFoam } from '../dist/contact-foam.js';
import { WATER_BASE, WATER_AMPLITUDE } from '../dist/water-surface.js';
import { createCourse, MAPS } from '../dist/maps.js';

test('foam keeps one finite batch through both courses without moving collisions or replacing buffers',()=>{
  const foam=createContactFoam(THREE,new THREE.Scene(),54),geometry=foam.mesh.geometry,matrices=foam.mesh.instanceMatrix.array;
  const matrix=new THREE.Matrix4();
  for(const map of MAPS){
    const course=createCourse(map.id),before=structuredClone(course.obstacles);
    foam.sync(course.obstacles.map((item,i)=>({x:item.x,z:item.z,rx:i%3?2.15:.95,rz:i%3?1.85:.95,angle:item.rotation,kind:i%3?0:2})));
    assert.equal(foam.mesh.count,54);assert.equal(foam.mesh.geometry,geometry);assert.equal(foam.mesh.instanceMatrix.array,matrices);
    assert.deepEqual(course.obstacles,before);
    course.obstacles.forEach((item,i)=>{foam.mesh.getMatrixAt(i,matrix);assert.ok(Math.abs(matrix.elements[12]-item.x)<1e-5);assert.ok(Math.abs(matrix.elements[14]-item.z)<5e-5);assert.ok(matrix.elements.every(Number.isFinite));});
    assert.ok(Number.isFinite(foam.mesh.boundingSphere.radius));
    assert.ok(foam.mesh.boundingBox.min.y<=WATER_BASE-WATER_AMPLITUDE);
    assert.ok(foam.mesh.boundingBox.max.y>=WATER_BASE+WATER_AMPLITUDE+.06);
  }
  assert.equal(foam.mesh.material.depthWrite,false);assert.equal(foam.mesh.material.forceSinglePass,true);
  foam.update(12);assert.equal(foam.time.value,12);foam.update(12);assert.equal(foam.time.value,12);
  foam.update(30,true);assert.equal(foam.time.value,0);
  assert.throws(()=>foam.sync(Array(55).fill({x:0,z:0,rx:1,rz:1})),/capacidad/);
});
