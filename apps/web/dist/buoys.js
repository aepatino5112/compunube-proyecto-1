import { mergeGeometries } from './vendor/addons/utils/BufferGeometryUtils.js';

// Two shared batches replace the four meshes previously drawn for every buoy.
export function createBuoyKit(THREE,scene,white,capacity=128) {
  const pose=new THREE.Object3D(),placements=[],root=new THREE.Group();root.name='CourseBuoys';scene.add(root);
  function part(geometry,x,y,z=0,angle=0) {
    pose.position.set(x,y,z);pose.rotation.set(0,angle,0);pose.scale.setScalar(1);pose.updateMatrix();
    return geometry.applyMatrix4(pose.matrix);
  }
  function merge(parts){const geometry=mergeGeometries(parts);for(const part of parts)part.dispose();return geometry;}
  const colorGeometry=merge([
    part(new THREE.CylinderGeometry(.5,.68,.7,10),0,.25),
    part(new THREE.BoxGeometry(.75,.45,.025),.35,1.9,0,-.25),
  ]);
  const whiteGeometry=merge([
    part(new THREE.CylinderGeometry(.43,.5,.28,10),0,.7),
    part(new THREE.CylinderGeometry(.07,.07,1.4,6),0,1.4),
  ]);
  const colorMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85,flatShading:true});
  const meshes=[new THREE.InstancedMesh(colorGeometry,colorMaterial,capacity),new THREE.InstancedMesh(whiteGeometry,white,capacity)];
  for(const mesh of meshes){mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(mesh);}
  function add(x,z,color,size=1) {
    if(placements.length>=capacity)throw Error('El recorrido excede la capacidad configurada de boyas');
    const object=new THREE.Group();object.position.set(x,0,z);object.scale.setScalar(size);scene.add(object);
    meshes[0].setColorAt(placements.length,new THREE.Color(color));placements.push(object);return object;
  }
  function sync() {
    placements.forEach((object,index)=>{object.updateWorldMatrix(true,false);for(const mesh of meshes)mesh.setMatrixAt(index,object.matrixWorld);});
    for(const mesh of meshes){mesh.count=placements.length;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}
    if(meshes[0].instanceColor)meshes[0].instanceColor.needsUpdate=true;
  }
  return {add,sync,root,meshes,placements};
}
