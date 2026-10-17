import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { createArtDirection,ART_PALETTES,composeSurfCamera } from './art-direction.js';
import { NET_LEFT_ANGLE } from './mechanics.js';
import { configureSurfShadows,createSurfRadiance,configureSurfRenderer,createSurfAmbient } from './visual-lighting.js';
import { createIllustratedPostprocessing,markAmbientOccluders } from './illustrated-postprocessing.js';
import { createWater } from './environment.js';
import { createSurferAnimation } from './surfer-animation.js';
import { createEquipmentKit } from './equipment.js';
import { createWasteModels } from './waste-models.js';
import { createPickupEffects,createWake,createBoardContactFoam } from './surf-effects.js';
import { createSurfMotion,advanceNetAngle,applyNetPose,BOARD_WATERLINE_OFFSET } from './surf-motion.js';
import { sampleWater } from './water-surface.js';
import { CHARACTERS } from './appearance.js';
import { createRockKit,ROCK_NAMES } from './rock-kit.js';
import { createContactFoam } from './contact-foam.js';
import { createIllustratedBinding } from './illustrated-materials.js';

const $=id=>document.getElementById(id),host=$('viewer');
try{
  const names=['surfer-amara','surfer-amara-v6','shore-study','maracaibo-bridge','board-coral','net-red-base',...ROCK_NAMES,'surfer-nico','surfer-luna','surfer-samuel','board-sol','board-manglar','net-red-reuso','net-red-marea'];
  const loaded=await Promise.all(names.map(name=>new GLTFLoader().loadAsync(`./assets/${name}.glb`)));
  const byName=Object.fromEntries(names.map((name,i)=>[name,loaded[i]]));
  const [pilot,before,shore,bridge,board,netAsset]=loaded,rockAssets=ROCK_NAMES.map(name=>byName[name]);
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(ART_PALETTES.maracaibo.haze,95,410);
  const art=createArtDirection(THREE,scene,bridge.scene);createSurfAmbient(THREE,scene);
  const water=createWater(THREE,scene,false,'illustrated');
  const shoreGroup=new THREE.Group();scene.add(shoreGroup);
  for(const [x,z,angle] of [[-21,-26,0],[21,-32,Math.PI]]){
    const bank=shore.scene.clone(true);bank.position.set(x,0,z);bank.rotation.y=angle;shoreGroup.add(bank);
  }
  createIllustratedBinding(shoreGroup);
  const placements=[[-10,-7,2.3],[-10,-22,2.9],[-12,-39,1.2],[11,-12,1.9],[10,-28,2.4],[12,-44,1.8]].map(([x,z,scale],i)=>({x,z,scale,angle:i*.7,variant:i%4}));
  const rocks=createRockKit(THREE,scene,rockAssets,placements.length);rocks.sync(placements);
  rocks.batches.forEach(batch=>createIllustratedBinding(batch.mesh));
  const foam=createContactFoam(THREE,scene,placements.length+2);
  foam.sync([...placements.map(item=>({...item,rx:item.scale*2,rz:item.scale*1.8})),{x:-21,z:-26,rx:9.1,rz:24.2,kind:1},{x:21,z:-32,rx:9.1,rz:24.2,kind:1}]);
  const waste=createWasteModels(THREE),kit=createEquipmentKit({coral:board,sol:byName['board-sol'],manglar:byName['board-manglar'],'red-base':netAsset,'red-reuso':byName['net-red-reuso'],'red-marea':byName['net-red-marea']},waste),signals=createPickupEffects(THREE);
  const character=CHARACTERS.find(item=>item.id==='amara'),racer=new THREE.Group();scene.add(racer);
  const net=kit.net();racer.add(kit.board(),net.group);
  let actor=createSurferAnimation(pilot,'#ef795e','afro',{...character,character:'amara'});racer.add(actor.avatar);
  const motion=createSurfMotion(),wake=createWake(THREE,scene),surface={};
  const rivals=[
    {id:'nico',x:-5,z:-12,color:'#4e97b3',board:'sol',net:'red-reuso',side:0},
    {id:'luna',x:5.5,z:-22,color:'#e66f8b',board:'manglar',net:'red-marea',side:NET_LEFT_ANGLE},
    {id:'samuel',x:-2.4,z:-32,color:'#8cb440',board:'coral',net:'red-base',side:0},
  ].map((spec,i)=>{
    const character=CHARACTERS.find(item=>item.id===spec.id),group=new THREE.Group(),net=kit.net(spec.net);
    const animation=createSurferAnimation(byName[`surfer-${character.id}`],spec.color,character.hair,{...character,character:character.id});
    group.add(kit.board(spec.board),animation.avatar,net.group);scene.add(group);
    return {...spec,group,net,animation,motion:createSurfMotion(),wake:createWake(THREE,scene),
      state:{x:0,z:0,speed:16,turn:0,netAngle:spec.side,jump:0,group},phase:i*.7};
  });
  const boardFoam=createBoardContactFoam(THREE,scene,4);
  const contactRacer={x:0,z:0,speed:16,jump:0,group:racer},contactRacers=[contactRacer,...rivals.map(rival=>rival.state)];
  const pickups=[[3.5,-22,0],[-4,-34,1]].map(([x,z,kind],i)=>{
    const object=new THREE.Group(),model=waste[kind].clone(true);object.add(model);scene.add(object);object.position.set(x,0,z);model.scale.setScalar(1.2);
    return {x,z,kind,object,model,phase:i,signal:signals.attach(object,kind),collectedBy:null};
  });
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));configureSurfRenderer(THREE,renderer);host.append(renderer.domElement);
  const surfShadows=configureSurfShadows(THREE,renderer,art);
  createSurfRadiance(THREE,renderer,scene,art);
  function enableShadows(root){root.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=!mesh.material.transparent;mesh.receiveShadow=true;}});}
  scene.traverse(mesh=>{if(mesh.isMesh&&mesh!==art.sky&&!art.root.getObjectById(mesh.id)){mesh.castShadow=!mesh.material.transparent;mesh.receiveShadow=true;}});
  water.water.castShadow=false;water.water.receiveShadow=true;
  const camera=new THREE.PerspectiveCamera(48,1,.1,1100);
  markAmbientOccluders(scene,[water.water,art.sky]);
  const finish=createIllustratedPostprocessing(renderer,scene,camera);
  const cameraPosition=new THREE.Vector3(),cameraLook=new THREE.Vector3();
  let view='race',playing=false,time=0,last=null;
  function poseAt(t,dt){
      const turn=Math.sin(t*2.1)*.22;
      const state={x:Math.sin(t*2.1)*.25,z:-t*16,speed:16,turn,netAngle:advanceNetAngle(0,t>1.2?-1:1,Math.max(0,t-1.2)),catchTimer:0,jump:0};
      const visual=motion.update(dt,state);applyNetPose(net.group,state.netAngle,visual);racer.userData.netAngle=state.netAngle;
      racer.position.set(state.x,sampleWater(state.x,state.z,t,surface).height+BOARD_WATERLINE_OFFSET+visual.boardHeight,state.z);
      racer.rotation.set(visual.boardPitch,-turn*.2,-turn*.22);actor.update(dt,state,net.group,visual);wake.update(state,t,true);
      contactRacer.x=state.x;contactRacer.z=state.z;
      for(const rival of rivals){
        const s=rival.state;s.x=rival.x+Math.sin(t*1.1+rival.phase)*.25;s.z=state.z+rival.z;s.turn=Math.sin(t*1.1+rival.phase)*.13;
        const visual=rival.motion.update(dt,s);applyNetPose(rival.net.group,s.netAngle,visual);
        rival.group.position.set(s.x,sampleWater(s.x,s.z,t,surface).height+BOARD_WATERLINE_OFFSET+visual.boardHeight,s.z);
        rival.group.rotation.set(visual.boardPitch,-s.turn*.2,-s.turn*.22);
        rival.animation.update(dt,s,rival.net.group,visual);rival.wake.update(s,t,true);
      }
  }
  function render(fraction=Number($('phase').value)/100,dt=null){
    const target=fraction*2.4;
    for(const rival of rivals)rival.state.disqualified=view!=='race';
    if(dt===null){
      actor.reset();motion.reset();wake.reset();
      for(const rival of rivals){rival.animation.reset(rival.phase);rival.motion.reset();rival.wake.reset();}
      const steps=Math.round(target*120);
      for(let i=0;i<=steps;i++)poseAt(i/120,i?1/120:0);
    }else{
      poseAt(target,dt);
    }
    water.time.value=target;art.update(racer.position.z,'maracaibo');
    foam.update(target);pickups.forEach(item=>signals.update(item,target));
    const shoreView=view==='shore';racer.visible=!shoreView;wake.root.visible=!shoreView;boardFoam.mesh.visible=!shoreView;
    for(const rival of rivals){
      rival.group.visible=view==='race';rival.wake.root.visible=view==='race'&&rival.wake.count>1;
      rival.state.disqualified=view!=='race';
    }
    boardFoam.update(contactRacers,target);
    const z=racer.position.z,portrait=camera.aspect<.85;
    if(view==='race'){
      composeSurfCamera(camera.aspect,racer.position.x,z,cameraPosition,cameraLook,Math.cos(racer.userData.netAngle/NET_LEFT_ANGLE*Math.PI));
      camera.position.copy(cameraPosition);camera.lookAt(cameraLook);
    }
    else if(shoreView){camera.position.set(-8,6.6,-20);camera.lookAt(-21,3.1,-29);}
    else{camera.position.set(view==='rear'?-3.4:3.4,3.5,z+(view==='rear'?6.0:-6.0));camera.lookAt(0,1.4,z);}
    surfShadows.invalidate();finish.render();$('moment').textContent=`${Math.round(fraction*100)} %`;
    $('stamp').textContent=shoreView?'Maracaibo · palafito y manglar':`${$('model').value==='pilot'?'Amara actual':'Amara anterior'} · ${view==='race'?'escena de referencia':view==='rear'?'vista posterior':'vista frontal'}`;
    host.setAttribute('aria-label',shoreView?'Palafito y manglar de Maracaibo, escena 3D':`Escena 3D de Maracaibo, ${$('stamp').textContent}`);
  }
  function resize(){renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();finish.resize(host.clientWidth,host.clientHeight);render();}
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
    view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();
  });
  $('model').addEventListener('change',()=>{
    racer.remove(actor.avatar);actor.dispose();actor=createSurferAnimation($('model').value==='pilot'?pilot:before,'#ef795e','afro',{...character,character:'amara'});racer.add(actor.avatar);enableShadows(actor.avatar);markAmbientOccluders(actor.avatar);render();
  });
  $('volume-toggle').addEventListener('click',()=>{
    finish.setEnabled(!finish.enabled);$('volume-toggle').setAttribute('aria-pressed',String(finish.enabled));
    $('volume-toggle').textContent=finish.enabled?'Volumen activado':'Volumen desactivado';render();
  });
  $('phase').addEventListener('input',()=>{playing=false;$('play-motion').setAttribute('aria-pressed','false');$('play-motion').textContent='Animar escena';render();});
  $('reference-toggle').addEventListener('click',()=>{
    const showing=$('accepted-reference').hidden;
    $('accepted-reference').hidden=!showing;$('study-pair').classList.toggle('comparing',showing);
    $('reference-toggle').setAttribute('aria-pressed',String(showing));
    $('reference-toggle').textContent=showing?'Cerrar comparación':'Comparar con la imagen';
  });
  $('play-motion').addEventListener('click',()=>{playing=!playing;time=Number($('phase').value)/100;last=null;$('play-motion').setAttribute('aria-pressed',String(playing));$('play-motion').textContent=playing?'Pausar escena':'Animar escena';});
  function animate(now){
    if(playing&&!document.hidden){
      const dt=Math.min(last===null?0:(now-last)/1000,.05),next=time+dt/2.4;
      if(next>=1){actor.reset();motion.reset();wake.reset();for(const rival of rivals){rival.animation.reset(rival.phase);rival.motion.reset();rival.wake.reset();}}
      time=next%1;$('phase').value=String(Math.round(time*100));render(time,dt);
    }
    last=now;requestAnimationFrame(animate);
  }
  document.addEventListener('visibilitychange',()=>{last=null;});
  document.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);
  $('status').textContent='Listo · modelos de Blender, agua y agarres compartidos con el juego · comparación desde la misma cámara';
  new ResizeObserver(resize).observe(host);resize();requestAnimationFrame(animate);
}catch(error){$('status').textContent='No se pudo preparar la escena piloto.';console.error(error);}
