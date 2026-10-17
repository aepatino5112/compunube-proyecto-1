import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/addons/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

// The normal prepass includes opaque models only. Water, skies and translucent
// signals keep their own shaders and never become flat AO occluders.
export function markAmbientOccluders(root,excluded=[]) {
  const exclusions=new Set(excluded);
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const eligible=!exclusions.has(mesh)&&materials.every(material=>!material.transparent&&material.alphaTest<=0&&!material.isShaderMaterial&&!material.isMeshBasicMaterial);
    if(eligible)mesh.layers.enable(1);else mesh.layers.disable(1);
  });
}

export function createIllustratedPostprocessing(renderer,scene,camera) {
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  const composer=new EffectComposer(renderer,target);
  const ao=new GTAOPass(scene,camera,1,1,undefined,
    {radius:.55,thickness:.35,distanceFallOff:1.2,scale:1,samples:12},
    {radius:4,samples:12,depthPhi:4,normalPhi:3});
  const normals=ao.normalRenderTarget;
  ao.setGBuffer(normals.depthTexture,normals.texture);
  ao.blendIntensity=.65;
  composer.addPass(new RenderPass(scene,camera));composer.addPass(ao);composer.addPass(new OutputPass());
  const clearColor=new THREE.Color();let enabled=true;
  function resize(width,height) {
    composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(width,height);
    const ratio=renderer.getPixelRatio()*.65;
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    normals.setSize(w,h);ao.setSize(w,h);
  }
  function render() {
    if(!enabled){renderer.render(scene,camera);return;}
    const layers=camera.layers.mask,override=scene.overrideMaterial,background=scene.background;
    const previousTarget=renderer.getRenderTarget(),autoClear=renderer.autoClear,alpha=renderer.getClearAlpha(),shadows=renderer.shadowMap.enabled;
    renderer.getClearColor(clearColor);
    try{
      camera.layers.set(1);scene.overrideMaterial=ao.normalMaterial;scene.background=null;
      renderer.shadowMap.enabled=false;
      renderer.setRenderTarget(normals);renderer.autoClear=true;renderer.setClearColor(0x7777ff,1);
      renderer.render(scene,camera);
    }finally{
      camera.layers.mask=layers;scene.overrideMaterial=override;scene.background=background;
      renderer.shadowMap.enabled=shadows;
      renderer.autoClear=autoClear;renderer.setClearColor(clearColor,alpha);renderer.setRenderTarget(previousTarget);
    }
    composer.render();
  }
  function dispose(){ao.gtaoMaterial.dispose();ao.blendMaterial.dispose();composer.passes.forEach(pass=>pass.dispose());composer.dispose();}
  return {render,resize,dispose,setEnabled(value){enabled=value;},get enabled(){return enabled;}};
}
