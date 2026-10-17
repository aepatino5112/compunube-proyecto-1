import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createBuoyKit } from '../dist/buoys.js';

function originalBuoy(white) {
  const group=new THREE.Group(),color=new THREE.MeshStandardMaterial();
  for(const [geometry,material,x,y,angle] of [
    [new THREE.CylinderGeometry(.5,.68,.7,10),color,0,.25,0],
    [new THREE.CylinderGeometry(.43,.5,.28,10),white,0,.7,0],
    [new THREE.CylinderGeometry(.07,.07,1.4,6),white,0,1.4,0],
    [new THREE.BoxGeometry(.75,.45,.025),color,.35,1.9,-.25],
  ]){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,0);mesh.rotation.y=angle;group.add(mesh);}
  return group;
}

test('buoy batching preserves the authored silhouette, colours and map transforms',()=>{
  const scene=new THREE.Scene(),white=new THREE.MeshStandardMaterial({color:0xfff7e6}),kit=createBuoyKit(THREE,scene,white);
  const group=kit.add(-20,-12,0xff8c6d,.72);group.rotation.y=.2;kit.sync();
  const original=originalBuoy(white);original.position.copy(group.position);original.scale.copy(group.scale);original.rotation.copy(group.rotation);original.updateMatrixWorld(true);
  const expected=new THREE.Box3().setFromObject(original,true),actual=new THREE.Box3(),point=new THREE.Vector3();
  for(const mesh of kit.meshes){
    const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++)actual.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(matrix));
  }
  assert.ok(expected.min.distanceTo(actual.min)<1e-5);assert.ok(expected.max.distanceTo(actual.max)<1e-5);
  const color=new THREE.Color();kit.meshes[0].getColorAt(0,color);assert.equal(color.getHex(),0xff8c6d);
  const geometries=kit.meshes.map(mesh=>mesh.geometry);
  group.position.set(9,0,-88);kit.sync();
  for(const [index,mesh] of kit.meshes.entries()){
    const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
    assert.equal(matrix.elements[12],9);assert.equal(matrix.elements[14],-88);
    assert.equal(mesh.geometry,geometries[index]);assert.ok(mesh.boundingSphere.radius>0);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  }
  for(let i=0;i<71;i++)kit.add(i,8-i*12,0xf4c662);kit.sync();
  assert.equal(kit.root.children.filter(mesh=>mesh.isInstancedMesh).length,2);
  assert.ok(kit.meshes.every(mesh=>mesh.count===72));
});
