// Shared models: the race, recycling station and inventory portraits use these meshes.
export function createWasteModels(THREE) {
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .85, flatShading: true });
  const colors = [mat(0x6eb5dd), mat(0xf18c62), mat(0xf0b86c)];
  const metal = mat(0xd6e3dc), label = mat(0xfff7e6);
  const add = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); parent.add(mesh); return mesh;
  };
  return [0,1,2].map(kind => {
    const item = new THREE.Group();
    if (kind === 0) {
      const bottle = new THREE.Group(); item.add(bottle); bottle.rotation.z = Math.PI * .43;
      add(bottle, new THREE.CylinderGeometry(.24,.24,.9,9), colors[0]);
      add(bottle, new THREE.CylinderGeometry(.11,.24,.22,9), colors[0],0,.56);
      add(bottle, new THREE.CylinderGeometry(.105,.105,.16,8),metal,0,.74);
      add(bottle, new THREE.CylinderGeometry(.247,.247,.3,9),label);
    } else if (kind === 1) {
      // A hollow J-shaped scrap pipe, lying on the water with a readable hook.
      const pipe = new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.94,metalness:.12,side:THREE.DoubleSide});
      const inside = new THREE.MeshStandardMaterial({color:0x34474b,roughness:1,side:THREE.DoubleSide});
      const rust = mat(0x89512e), wornEdge = mat(0xb49b79);
      const path = new THREE.CurvePath();
      path.add(new THREE.LineCurve3(new THREE.Vector3(.3,0,-.72),new THREE.Vector3(.3,0,.2)));
      path.add(new THREE.CubicBezierCurve3(new THREE.Vector3(.3,0,.2),new THREE.Vector3(.3,0,.65),new THREE.Vector3(-.38,0,.65),new THREE.Vector3(-.38,0,.2)));
      path.add(new THREE.LineCurve3(new THREE.Vector3(-.38,0,.2),new THREE.Vector3(-.38,0,.01)));
      const tube = new THREE.TubeGeometry(path,48,.135,16,false);
      const positions = tube.attributes.position, shades = new Float32Array(positions.count*3);
      const rustDark = new THREE.Color(0x673b26), rustOrange = new THREE.Color(0xb96b35), exposed = new THREE.Color(0x889a96);
      const tint = new THREE.Color(), radial = new THREE.Vector3();
      for(let row=0;row<=48;row++) {
        const center=path.getPointAt(row/48);
        for(let side=0;side<=16;side++) {
          const index=row*17+side, angle=side/16*Math.PI*2;
          const wear=Math.sin(row*.48+Math.cos(angle)*2.7)+Math.cos(angle*3-row*.23)*.62;
          tint.copy(wear>.72 ? exposed : rustDark).lerp(rustOrange,wear>.72 ? .18 : .35+(Math.sin(row*1.7+angle*4)+1)*.24);
          tint.toArray(shades,index*3);
          // Broad dents deform the silhouette; leave the rims aligned with their lips.
          radial.fromBufferAttribute(positions,index).sub(center);
          const dent=Math.exp(-(((row-17)/5)**2))*Math.max(0,Math.sin(angle-.5))*.28;
          const scale=row===0||row===48 ? 1 : 1+Math.sin(row*.3+angle*3)*.055-dent;
          radial.multiplyScalar(scale).add(center); positions.setXYZ(index,radial.x,radial.y,radial.z);
        }
      }
      tube.setAttribute('color',new THREE.BufferAttribute(shades,3)); tube.computeVertexNormals();
      add(item,tube,pipe);
      add(item,new THREE.TubeGeometry(path,36,.09,12,false),inside);
      for (const [x,z] of [[.3,-.72],[-.38,.01]]) {
        add(item,new THREE.RingGeometry(.09,.135,12),wornEdge,x,0,z);
        add(item,new THREE.CircleGeometry(.089,12),inside,x,0,z+.1);
      }
      const coupling=add(item,new THREE.CylinderGeometry(.177,.177,.12,8,1,true),rust,.3,0,-.48); coupling.rotation.x=Math.PI/2;
      add(item,new THREE.TorusGeometry(.145,.014,5,12),wornEdge,.3,0,-.56);
    } else {
      add(item,new THREE.BoxGeometry(1.05,.08,.7),colors[2]).rotation.z = .1;
      add(item,new THREE.BoxGeometry(.4,.03,.55),label,0,.08);
      for (const x of [-.57,.57]) add(item,new THREE.BoxGeometry(.2,.06,.65),colors[2],x,.08).rotation.z = x > 0 ? -.4 : .4;
    }
    return item;
  });
}

export function createWasteDisplay(THREE, models, type) {
  const group = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1,1.9,.22,64),new THREE.MeshStandardMaterial({color:0x49bdb1,roughness:.9}));
  water.position.y=-.2; group.add(water);
  const pieces = type === 'plastic' ? [[0,-.45,.2,-.2],[2,.6,.17,.7]] : [[1,0,.12,0]];
  pieces.forEach(([kind,x,y,z],i) => {
    const waste = models[kind].clone(true); waste.position.set(x,y,z); waste.scale.setScalar(type === 'metal' ? 1.9 : 1.3); waste.rotation.y=type === 'metal' ? 2.7 : i ? -.5 : .35;
    waste.userData.floating = true; waste.userData.baseY=y; group.add(waste);
    const ripple = new THREE.Mesh(new THREE.RingGeometry(.64,.67,48),new THREE.MeshBasicMaterial({color:0xd8fff1,transparent:true,opacity:.7,side:THREE.DoubleSide}));
    ripple.rotation.x=-Math.PI/2; ripple.position.set(x,-.075,z); ripple.scale.set(1.3,.8,1); group.add(ripple);
  });
  return group;
}
