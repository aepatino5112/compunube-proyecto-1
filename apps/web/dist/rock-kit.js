export const ROCK_NAMES=Object.freeze(['rock-basalt','rock-sandstone','rock-split','rock-slab']);

// Authored variants share GPU geometry; map switches only replace instance matrices.
export function createRockKit(THREE,parent,assets,capacity) {
  const batches=[],pose=new THREE.Object3D(),world=new THREE.Matrix4();
  assets.forEach((asset,variant)=>{
    asset.scene.updateMatrixWorld(true);
    asset.scene.traverse(part=>{
      if(!part.isMesh)return;
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,capacity);
      mesh.castShadow=true;mesh.receiveShadow=true;
      mesh.name=`RockVariant${variant}`;mesh.count=0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);parent.add(mesh);
      batches.push({mesh,variant,local:part.matrixWorld.clone()});
    });
  });
  function sync(placements) {
    if(placements.length>capacity)throw Error('El kit de rocas excede su capacidad');
    for(const batch of batches) {
      let count=0;
      placements.forEach((item,i)=>{
        if((item.variant??i%assets.length)!==batch.variant)return;
        pose.position.set(item.x,item.y||0,item.z);pose.rotation.set(0,item.angle||0,0);
        pose.scale.setScalar(item.scale||1);pose.updateMatrix();
        world.multiplyMatrices(pose.matrix,batch.local);batch.mesh.setMatrixAt(count++,world);
      });
      batch.mesh.count=count;batch.mesh.instanceMatrix.needsUpdate=true;
      batch.mesh.computeBoundingBox();batch.mesh.computeBoundingSphere();
    }
  }
  return {batches,sync};
}
