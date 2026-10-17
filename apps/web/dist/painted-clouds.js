export function createPaintedClouds(THREE,parent) {
  const sphere=new THREE.SphereGeometry(1,16,10),source=sphere.getAttribute('position');
  const positions=[],colors=[],indices=[],tone=new THREE.Color();
  const shade=new THREE.Color(0xa4bad8),cream=new THREE.Color(0xffefd1);
  // One reusable cluster with an uneven contour and a warm painted underside.
  const lobes=[[-5,0,0,3.6,2.5,2.2],[-2,1.5,.3,3.7,3.6,2.6],[1.3,3,0,3.8,4.6,2.8],[4.6,1.0,.5,3.8,2.9,2.4],[7,0,0,2.5,1.9,1.8],[-.7,-1.0,.6,5.9,1.5,2.4]];
  for(const [x,y,z,rx,ry,rz] of lobes){
    const offset=positions.length/3;
    for(let i=0;i<source.count;i++){
      const py=y+source.getY(i)*ry;
      positions.push(x+source.getX(i)*rx,py,z+source.getZ(i)*rz);
      tone.copy(shade).lerp(cream,THREE.MathUtils.smoothstep(py,-2,4.5));colors.push(tone.r,tone.g,tone.b);
    }
    for(const i of sphere.index.array)indices.push(offset+i);
  }
  sphere.dispose();
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);
  const placements=[[-155,76,-330,3.8,-.08],[-65,42,-250,1.8,.04],[95,72,-355,3.0,.10],[173,43,-280,2.8,-.07],[-260,45,-270,3.0,.08],[275,96,-440,4.5,-.12]];
  const clouds=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,fog:false}),placements.length);
  clouds.name='Painted horizon clouds';const pose=new THREE.Object3D();
  placements.forEach(([x,y,z,scale,tilt],i)=>{pose.position.set(x,y,z);pose.rotation.set(0,0,tilt);pose.scale.setScalar(scale);pose.updateMatrix();clouds.setMatrixAt(i,pose.matrix);});
  clouds.computeBoundingBox();clouds.computeBoundingSphere();parent.add(clouds);return clouds;
}
