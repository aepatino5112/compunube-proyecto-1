// Local sunlight and fill shadows are reused by both views of the same scene.
export function configureSurfRenderer(THREE,renderer){
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NeutralToneMapping;
  renderer.toneMappingExposure=1.0;
}

export function createSurfAmbient(THREE,scene){
  const light=new THREE.HemisphereLight(0xc5e8ff,0x23697b,.95);
  scene.add(light);return light;
}
export function configureSurfShadows(THREE,renderer,art) {
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;
  const light=art.light;light.castShadow=true;light.shadow.mapSize.set(2048,2048);
  const camera=light.shadow.camera;
  camera.left=-30;camera.right=30;camera.top=30;camera.bottom=-30;camera.near=1;camera.far=360;camera.updateProjectionMatrix();
  light.shadow.bias=-.00015;light.shadow.normalBias=.025;
  if(art.fill){
    art.fill.castShadow=true;art.fill.shadow.mapSize.set(1024,1024);
    const fillCamera=art.fill.shadow.camera;
    fillCamera.left=-24;fillCamera.right=24;fillCamera.top=24;fillCamera.bottom=-24;fillCamera.near=1;fillCamera.far=240;fillCamera.updateProjectionMatrix();
    art.fill.shadow.bias=-.00015;art.fill.shadow.normalBias=.025;
  }
  return {invalidate(){renderer.shadowMap.needsUpdate=true;}};
}

export function markShadowReceivers(root) {
  root.traverse(mesh=>{if(mesh.isMesh&&!mesh.material?.transparent)mesh.receiveShadow=true;});
}
import { ART_PALETTES } from './art-direction.js';

// Generated once per palette, rather than re-rendering the entire course for
// reflections. Shared PBR materials get a soft sky reflection at their roughness.
export function createSurfRadiance(THREE,renderer,scene,art) {
  const generator=new THREE.PMREMGenerator(renderer),source=new THREE.Scene();
  const material=art.sky.material.clone(),sky=new THREE.Mesh(art.sky.geometry,material);sky.scale.setScalar(.01);source.add(sky);
  const targets={};
  try{
    for(const [id,palette] of Object.entries(ART_PALETTES)){
      material.uniforms.uTop.value.set(palette.sky);material.uniforms.uHaze.value.set(palette.haze);
      targets[id]=generator.fromScene(source,.025,.1,100,{size:128});
    }
  }finally{generator.dispose();material.dispose();}
  const previous=scene.environment,previousIntensity=scene.environmentIntensity;
  scene.environmentIntensity=.40;
  function select(id){scene.environment=(targets[id]||targets.maracaibo).texture;}
  select('maracaibo');
  return {select,dispose(){scene.environment=previous;scene.environmentIntensity=previousIntensity;Object.values(targets).forEach(target=>target.dispose());}};
}
