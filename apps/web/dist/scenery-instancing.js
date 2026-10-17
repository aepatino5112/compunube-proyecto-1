// Keep the authored glTF mesh transforms, with geometry shared across placements.
export function instanceScenery(THREE,asset,placements,parent) {
  const batches=[],pose=new THREE.Object3D(),world=new THREE.Matrix4();
  if(!placements.length)return batches;
  asset.updateMatrixWorld(true);
  asset.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,placements.length);
    batch.castShadow=mesh.material.name.startsWith('Study ')&&mesh.material.name!=='Study warm sand';
    batch.name=mesh.name;parent.add(batch);
    placements.forEach((item,index)=>{
      pose.position.set(item.x,item.y,item.z);pose.rotation.set(0,item.angle||0,0);
      const scale=item.scale||1;pose.scale.set(item.sx||scale,item.sy||scale,item.sz||scale);
      pose.updateMatrix();world.multiplyMatrices(pose.matrix,mesh.matrixWorld);batch.setMatrixAt(index,world);
      if(item.color&&['HouseColor','BoatColor'].includes(mesh.material.name))batch.setColorAt(index,new THREE.Color(item.color));
    });
    batch.computeBoundingBox();batch.computeBoundingSphere();batches.push(batch);
  });
  return batches;
}
