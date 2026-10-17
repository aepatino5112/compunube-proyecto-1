// Shared horizon, directional sunlight and the water's illustrated solar reflection.
import { createPaintedClouds } from './painted-clouds.js';
export const SUN_DIRECTION=Object.freeze([.085,.20,-1]);
export const HORIZON_DISTANCE=430;
export const ART_PALETTES=Object.freeze({
  maracaibo:Object.freeze({sky:0x438fd9,haze:0xffd79e,deep:0x078d9e,shallow:0x51d5ce,coast:0x668c9b}),
  orinoco:Object.freeze({sky:0x9dbdc6,haze:0xf0dfb6,deep:0x687b53,shallow:0xb4ba74,coast:0x6b8265}),
});

export function composeSurfCamera(aspect,x,z,position,look,netBias=1) {
  const portrait=aspect<.85;
  position.set(x+(portrait?netBias*.45:2.35),portrait?4.1:2.75,z+(portrait?11.8:7.1));
  look.set(x+netBias*(portrait?.85:.45),portrait?.70:.90,z-(portrait?11:8.5));
}

export function createArtDirection(THREE,scene,bridge) {
  const root=new THREE.Group();root.name='DistantHorizon';scene.add(root);
  const direction=new THREE.Vector3(...SUN_DIRECTION).normalize();
  const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    uniforms:{uTop:{value:new THREE.Color()},uHaze:{value:new THREE.Color()},uSun:{value:direction}},
    vertexShader:'varying vec3 vSky; void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform vec3 uTop;uniform vec3 uHaze;uniform vec3 uSun;varying vec3 vSky;
      void main(){vec3 ray=normalize(vSky);float altitude=smoothstep(-.025,.24,ray.y);
      vec3 col=mix(uHaze,uTop,altitude);float alignment=max(dot(ray,uSun),0.);
      col=mix(col,vec3(1.50,.82,.30),pow(alignment,42.)*.55);
      float disk=smoothstep(cos(.033),cos(.029),alignment);
      col=mix(col,vec3(3.,2.6,.72),disk);gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(850,32,20),skyMaterial);sky.name='PaintedSky';sky.renderOrder=-1000;root.add(sky);
  createPaintedClouds(THREE,root);
  bridge.position.set(0,-.8,-HORIZON_DISTANCE);bridge.scale.set(1.20,1.42,1);bridge.rotation.y=-.25;root.add(bridge);
  bridge.traverse(part=>{
    if(!part.isMesh)return;
    part.material=part.material.clone();part.material.fog=false;part.material.roughness=.88;
    part.material.color.set(part.material.name==='Ivory'?0xb7c6c4:part.material.name==='Warm limestone'?0x859fa9:0x4e686c);
  });
  const vertices=[],indices=[];
  for(let i=0;i<=40;i++) {
    const x=-650+i*32.5,y=3+Math.sin(i*.53)*2+Math.sin(i*.19+1)*3;
    vertices.push(x,-12,-HORIZON_DISTANCE-25,x,y,-HORIZON_DISTANCE-25);
    if(i<40){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
  const coast=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x78948b,side:THREE.DoubleSide,fog:false}));coast.name='FarCoast';root.add(coast);
  // Low-detail silhouettes are intentional at this distance: one shared batch
  // provides a cool, hazy depth layer below the bridge, without new obstacles.
  const cityGeometry=new THREE.BoxGeometry(1,1,1),cityColours=[],cityTone=new THREE.Color();
  const cityHaze=new THREE.Color(ART_PALETTES.maracaibo.haze);
  const cityLow=new THREE.Color(0x8595b6).lerp(cityHaze,.50),cityHigh=new THREE.Color(0xb1b6cc).lerp(cityHaze,.50),cityPosition=cityGeometry.getAttribute('position');
  for(let i=0;i<cityPosition.count;i++){
    cityTone.copy(cityLow).lerp(cityHigh,cityPosition.getY(i)+.5);cityColours.push(cityTone.r,cityTone.g,cityTone.b);
  }
  cityGeometry.setAttribute('color',new THREE.Float32BufferAttribute(cityColours,3));
  const city=new THREE.InstancedMesh(cityGeometry,new THREE.MeshBasicMaterial({vertexColors:true,fog:false}),24),cityPose=new THREE.Object3D();
  city.name='Far Maracaibo silhouettes';
  for(let i=0;i<24;i++){
    const block=i%8,center=[-175,-28,135][Math.floor(i/8)];
    const height=4+Math.abs(Math.sin(i*1.63))*10+(i%11===0?7:0);
    cityPose.position.set(center+(block-3.5)*9+Math.sin(i*.71)*3.5,height*.5,-HORIZON_DISTANCE-48-(i%3)*15);
    cityPose.scale.set(4+Math.abs(Math.sin(i*.74))*5,height,5+(i%3)*2);cityPose.updateMatrix();city.setMatrixAt(i,cityPose.matrix);
  }
  city.computeBoundingBox();city.computeBoundingSphere();root.add(city);
  const light=new THREE.DirectionalLight(0xffd69b,3.8),fill=new THREE.DirectionalLight(0xffefd9,1.9);
  scene.add(light,light.target,fill,fill.target);
  function update(z=0,mapId='maracaibo') {
    const palette=ART_PALETTES[mapId]||ART_PALETTES.maracaibo;
    root.position.z=z;bridge.visible=mapId==='maracaibo';city.visible=bridge.visible;
    skyMaterial.uniforms.uTop.value.set(palette.sky);skyMaterial.uniforms.uHaze.value.set(palette.haze);
    coast.material.color.set(palette.coast);
    light.position.set(SUN_DIRECTION[0]*200,SUN_DIRECTION[1]*200,z+SUN_DIRECTION[2]*200);light.target.position.set(0,0,z);
    fill.position.set(-35,45,z+80);fill.target.position.set(0,1,z);
  }
  update();return {root,bridge,sky,coast,light,fill,update};
}
