import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { createArtDirection, ART_PALETTES, composeSurfCamera } from './art-direction.js';
import { createEnvironment } from './environment.js';
import { createRockKit, ROCK_NAMES } from './rock-kit.js';
import { createCourse } from './maps.js';
import { createContactFoam } from './contact-foam.js';
import { createWasteModels } from './waste-models.js';
import { createPickupEffects } from './surf-effects.js';
import { createEquipmentKit } from './equipment.js';
import { createSurferAnimation } from './surfer-animation.js';
import { sampleWater } from './water-surface.js';
import { BOARD_WATERLINE_OFFSET } from './surf-motion.js';
import { CHARACTERS } from './appearance.js';
import { configureSurfShadows,markShadowReceivers,createSurfRadiance,configureSurfRenderer,createSurfAmbient } from './visual-lighting.js';

const $=id=>document.getElementById(id),host=$('viewer');
try{
  const names=['maracaibo-bridge','palm','mangrove','palafito','canoe','delta-tree',...ROCK_NAMES,'surfer-amara','board-coral','net-red-base','shore-study','shore-mangrove'];
  const assets=await Promise.all(names.map(name=>new GLTFLoader().loadAsync(`./assets/${name}.glb`)));
  const [bridge,palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset]=assets,rockAssets=assets.slice(6,10);
  const shoreAssets={village:assets.at(-2),mangrove:assets.at(-1)};
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(ART_PALETTES.maracaibo.haze,140,410);
  createSurfAmbient(THREE,scene);
  const art=createArtDirection(THREE,scene,bridge.scene);
  const environments=Object.fromEntries(['maracaibo','orinoco'].map(mapId=>[mapId,createEnvironment(THREE,scene,{islands:createCourse(mapId).islands,palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset,rockAssets,shoreAssets,mapId})]));
  for(const env of Object.values(environments))markShadowReceivers(env.root);
  const rockCount=createCourse('maracaibo').obstacles.filter((_,i)=>i%3).length;
  const rocks=createRockKit(THREE,scene,rockAssets,rockCount),foam=createContactFoam(THREE,scene,rockCount);
  const gallery=new THREE.Group();gallery.name='RockContactSheet';scene.add(gallery);
  const displayRocks=createRockKit(THREE,gallery,rockAssets,4);
  displayRocks.sync(ROCK_NAMES.map((_,i)=>({x:(i-1.5)*3.5,y:0,z:-2,variant:i,angle:.4+i*.3})));
  const wasteModels=createWasteModels(THREE),pickupEffects=createPickupEffects(THREE),wasteGroup=new THREE.Group();scene.add(wasteGroup);
  const entries=createCourse('maracaibo').trash.map(item=>{
    const object=new THREE.Group(),model=wasteModels[item.kind].clone(true);object.add(model);model.scale.setScalar(1.2);wasteGroup.add(object);
    return {object,model,signal:pickupEffects.attach(object,item.kind),collectedBy:null};
  });
  const kit=createEquipmentKit({coral:assets[11],'red-base':assets[12]},wasteModels),racer=new THREE.Group();scene.add(racer);
  const character=CHARACTERS.find(item=>item.id==='amara');
  const animation=createSurferAnimation(assets[10],'#ef795e','afro',{...character,character:'amara'}),net=kit.net();racer.add(kit.board(),animation.avatar,net.group);animation.update(0,{},net.group);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));configureSurfRenderer(THREE,renderer);host.append(renderer.domElement);
  const surfShadows=configureSurfShadows(THREE,renderer,art);
  const radiance=createSurfRadiance(THREE,renderer,scene,art);
  const camera=new THREE.PerspectiveCamera(48,1,.1,1100),surface={},position=new THREE.Vector3(),look=new THREE.Vector3();let distance=0,showRocks=false;
  function chooseMap(){
    const mapId=$('map').value,course=createCourse(mapId);
    radiance.select(mapId);
    $('map-intro').textContent=mapId==='maracaibo'?'Maracaibo: manglares, palafitos y una costa continua bajo el puente.':'Orinoco: agua verde dorada, bosque del delta y luz desde el horizonte.';
    document.querySelectorAll('[data-palette]').forEach(swatch=>swatch.style.setProperty('--color',`#${new THREE.Color(ART_PALETTES[mapId][swatch.dataset.palette]).getHexString()}`));
    const placements=course.obstacles.filter((_,i)=>i%3).map(item=>({x:item.x,z:item.z,angle:item.rotation}));rocks.sync(placements);
    foam.sync(placements.map(item=>({...item,rx:2.15,rz:1.85})));
    course.trash.forEach((item,i)=>{
      const entry=entries[i];entry.model.rotation.y=item.rotation;
      Object.assign(entry,item);
      entry.object.position.set(item.x,.23,item.z);pickupEffects.update(entry,6,true);
    });
    for(const [id,env]of Object.entries(environments))env.root.visible=id===mapId;
    scene.fog.color.set(ART_PALETTES[mapId].haze);render();
  }
  function render(){
    const mapId=$('map').value,z=showRocks?0:-distance;
    art.update(z,mapId);environments[mapId].update(6,false,z);foam.update(6);
    gallery.visible=showRocks;wasteGroup.visible=!showRocks;racer.visible=!showRocks;
    rocks.batches.forEach(batch=>batch.mesh.visible=!showRocks);foam.mesh.visible=!showRocks;
    sampleWater(0,z,6,surface);racer.position.set(0,surface.height+BOARD_WATERLINE_OFFSET,z);
    if(showRocks){camera.position.set(5,7,13);camera.lookAt(0,.4,-2);}
    else{composeSurfCamera(camera.aspect,0,z,position,look);camera.position.copy(position);camera.lookAt(look);}
    surfShadows.invalidate();renderer.render(scene,camera);
    $('frame-label').textContent=showRocks?'Rocas de Blender · cuatro siluetas':`${mapId==='maracaibo'?'Maracaibo':'Orinoco'} · ${distance} m · vista de composición`;
    host.setAttribute('aria-label',showRocks?'Cuatro modelos de roca de Blender':`Paisaje 3D de ${mapId==='maracaibo'?'Maracaibo':'Orinoco'}, a ${distance} metros`);
    $('status').textContent=showRocks?'De izquierda a derecha: basalto · arenisca · fracturada · laja · modelos reales':`Listo · ${distance} m · ${mapId==='maracaibo'?'puente delante, a 430 m del jugador':'paisaje del delta'}`;
  }
  function resize(){renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();render();}
  document.querySelectorAll('[data-distance]').forEach(button=>button.addEventListener('click',()=>{
    distance=Number(button.dataset.distance);showRocks=false;$('rocks').setAttribute('aria-pressed','false');
    document.querySelectorAll('[data-distance]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();
  }));
  $('rocks').addEventListener('click',()=>{showRocks=!showRocks;$('rocks').setAttribute('aria-pressed',String(showRocks));render();});
  $('map').addEventListener('change',chooseMap);document.querySelectorAll('button,select').forEach(control=>control.disabled=false);
  chooseMap();new ResizeObserver(resize).observe(host);resize();
}catch(error){$('status').textContent='No se pudo preparar el paisaje.';console.error(error);}
