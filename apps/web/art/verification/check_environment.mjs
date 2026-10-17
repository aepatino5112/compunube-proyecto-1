// Verify authored transforms and lane clearance on the actual exported assets.
import assert from 'node:assert/strict';
import * as THREE from '../../dist/vendor/three.module.js';
import { createEnvironment } from '../../dist/environment.js';
import { MAPS, createCourse } from '../../dist/maps.js';
import { ROCK_NAMES } from '../../dist/rock-kit.js';
import { loadGLBFixture } from '../../tests/helpers/gltf-fixture.js';

const load=loadGLBFixture;
const [palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset]=await Promise.all(['palm','mangrove','palafito','canoe','delta-tree'].map(load));
const [village,mangrove]=await Promise.all(['shore-study','shore-mangrove'].map(load));
const shoreAssets={village,mangrove};
const rockAssets=await Promise.all(ROCK_NAMES.map(load));
for(const map of MAPS) {
const islands=createCourse(map.id).islands;
const scene=new THREE.Scene(),env=createEnvironment(THREE,scene,{islands,palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset,rockAssets,shoreAssets,mapId:map.id});
const matrix=new THREE.Matrix4(),box=new THREE.Box3();let batches=0,triangles=0,clearance=Infinity;
env.root.traverse(mesh=>{
  if(!mesh.isMesh) return;
  const positions=mesh.geometry.getAttribute('position');assert.ok(positions.array.every(Number.isFinite));
  if(!mesh.isInstancedMesh) return;
  batches++; triangles+=(mesh.geometry.index?.count || positions.count)/3*mesh.count;
  assert.ok(mesh.boundingSphere && Number.isFinite(mesh.boundingSphere.radius));
  mesh.geometry.computeBoundingBox();
  for(let i=0;i<mesh.count;i++) {
    mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));
    if(mesh.userData.shoreVariant||['Sandbanks','GrassBanks','HouseColor','Honey wood','Cream trim','Terracotta roof','Window shade','Mangrove bark','Mangrove canopy 0','Mangrove canopy 1','Mangrove canopy 2','BoatColor'].includes(mesh.name)||mesh.name.startsWith('Delta ')) {
      box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
      const distance=box.min.x>0?box.min.x:-box.max.x;clearance=Math.min(clearance,distance);
      assert.ok(distance>18,`${mesh.name} overlaps the channel: ${distance}`);
    }
  }
});
assert.ok(batches<30);env.update(12);env.update(12);env.update(0,true);
const viewTriangles={};
for(const distance of [0,450,900]){
  env.update(12,false,-distance);let visibleTriangles=0;
  env.root.traverse(mesh=>{if(mesh.isInstancedMesh)visibleTriangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*mesh.count;});
  viewTriangles[distance]=visibleTriangles;
}
console.log(JSON.stringify({map:map.id,instancedBatches:batches,instancedTriangles:triangles,viewTriangles,shoreClearance:Math.round(clearance*100)/100},null,2));
}
