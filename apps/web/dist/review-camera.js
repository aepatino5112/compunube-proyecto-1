import * as THREE from './vendor/three.module.js';

// Review pages draw on demand. Measure the actual pose (including skinning),
// excluding hidden hair variants, so a jump or tool change cannot crop it.
export function createReviewCameraFit(camera){
  const bounds=new THREE.Box3(),vertex=new THREE.Vector3(),center=new THREE.Vector3();
  const direction=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();
  const offset=new THREE.Vector3(),worldUp=new THREE.Vector3(0,1,0),skeletons=new Set();
  let points=new Float64Array(65536),count=0;
  return function fit(root,view='rear',padding=1.13){
    bounds.makeEmpty();skeletons.clear();count=0;root.updateWorldMatrix(true,true);
    root.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      if(mesh.isSkinnedMesh&&!skeletons.has(mesh.skeleton)){mesh.skeleton.update();skeletons.add(mesh.skeleton);}
      const positions=mesh.geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++){
        mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);bounds.expandByPoint(vertex);
        if(count+3>points.length){const grown=new Float64Array(points.length*2);grown.set(points);points=grown;}
        points[count++]=vertex.x;points[count++]=vertex.y;points[count++]=vertex.z;
      }
    });
    if(bounds.isEmpty())return bounds;
    bounds.getCenter(center);
    direction.set(view==='side'?1:.52,view==='side'?.25:.36,view==='side'?0:view==='front'?-1:1).normalize();
    right.crossVectors(worldUp,direction).normalize();up.crossVectors(direction,right).normalize();
    const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov*.5)),tanX=tanY*camera.aspect;
    let distance=0;
    // Use occupied points, not the empty corners of a box enclosing both the
    // character and net. This keeps the figure readable on a narrow pane.
    for(let i=0;i<count;i+=3){
      offset.set(points[i]-center.x,points[i+1]-center.y,points[i+2]-center.z);
      const depth=offset.dot(direction);
      distance=Math.max(distance,depth+Math.abs(offset.dot(right))*padding/tanX,depth+Math.abs(offset.dot(up))*padding/tanY);
    }
    camera.position.copy(center).addScaledVector(direction,distance+.08);camera.lookAt(center);camera.updateWorldMatrix(true,false);
    return bounds;
  };
}
