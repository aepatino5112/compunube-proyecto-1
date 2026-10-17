import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { CHARACTERS } from './appearance.js';
import { createSurferAnimation } from './surfer-animation.js';
import { createEquipmentKit } from './equipment.js';
import { configureSurfRenderer,createSurfAmbient } from './visual-lighting.js';
import { createSurfMotion,advanceNetAngle,applyNetPose } from './surf-motion.js';
import { NET_LEFT_ANGLE } from './mechanics.js';

const $=id=>document.getElementById(id),host=$('viewer');
const descriptions={nico:'Hombros amplios · mangas cortas · bermudas',luna:'Paneles lavanda · coleta agrupada · short deportivo',amara:'Chaleco coral · afro · postura atlética',samuel:'Lycra teal · bermudas · rizos agrupados'};
try{
  const names=[...CHARACTERS.map(character=>`surfer-${character.id}`),'board-coral','net-red-base'];
  const loaded=await Promise.all(names.map(name=>new GLTFLoader().loadAsync(`./assets/${name}.glb`)));
  const byName=Object.fromEntries(names.map((name,i)=>[name,loaded[i]]));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e8e1d0');createSurfAmbient(THREE,scene);
  const sun=new THREE.DirectionalLight('#ffddb1',3.2);sun.position.set(-5,9,-7);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-13,right:13,top:7,bottom:-7,near:.1,far:40});sun.shadow.normalBias=.025;scene.add(sun);
  const fill=new THREE.DirectionalLight('#fff1dd',1.9);fill.position.set(0,5,9);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:'#dedcca',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.10;floor.receiveShadow=true;scene.add(floor);
  const kit=createEquipmentKit({coral:byName['board-coral'],'red-base':byName['net-red-base']});
  const actors=CHARACTERS.map((character,i)=>{
    const group=new THREE.Group(),net=kit.net(),animation=createSurferAnimation(byName[`surfer-${character.id}`],'#ef795e',character.hair,{...character,character:character.id});
    const board=kit.board();board.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}});
    group.add(board,animation.avatar,net.group);scene.add(group);
    return {character,group,net,animation,motion:createSurfMotion(),x:(i-1.5)*3.75};
  });
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));configureSurfRenderer(THREE,renderer);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;host.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(37,1,.1,100);let view='rear';
  $('names').innerHTML=CHARACTERS.map(character=>`<article data-character="${character.id}"><h2>${character.name}</h2><p>${descriptions[character.id]}</p></article>`).join('');
  function render(){
    const selected=$('character').value,all=selected==='all',target=Number($('phase').value)/100*1.5;
    for(const actor of actors){
      actor.group.visible=all||selected===actor.character.id;
      actor.group.position.set(all?actor.x*(view==='front'?-1:1):0,0,0);
      actor.animation.reset();actor.motion.reset();
      const steps=Math.round(target*120);
      for(let i=0;i<=steps;i++){
        const time=i/120,dt=i?1/120:0,state={turn:0,netAngle:advanceNetAngle(0,-1,time),jump:0};
        const motion=actor.motion.update(dt,state);applyNetPose(actor.net.group,state.netAngle,motion);actor.animation.update(dt,state,actor.net.group,motion);
      }
    }
    const bias=all?Math.cos(advanceNetAngle(0,-1,target)/NET_LEFT_ANGLE*Math.PI)*1.1:0;
    const distance=all?Math.max(11.5,24/Math.max(.5,camera.aspect)):7.8;
    const lookX=all?bias:.25;
    camera.position.set(all?bias:view==='front'?-2.1:2.1,all?3.8:3.1,view==='front'?-distance:distance);camera.lookAt(lookX,all?1.3:1.2,0);
    renderer.render(scene,camera);
    const character=actors.find(actor=>actor.character.id===selected)?.character;
    $('stamp').textContent=`${all?'El club':character.name} · vista ${view==='front'?'frontal':'posterior'}`;
    $('moment').textContent=target>.65?'Izquierda':target<.04?'Derecha':'Cambiando';
    $('status').textContent='Listo · mueve el control para revisar las manos y el cambio de lado.';
    host.setAttribute('aria-label',`${all?'Nico, Luna, Amara y Samuel':character.name}, vista ${view==='front'?'frontal':'posterior'}`);
    $('names').hidden=!all;
  }
  function resize(){renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();render();}
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();});
  $('phase').addEventListener('input',render);$('character').addEventListener('change',render);window.addEventListener('resize',resize);resize();
}catch(error){$('status').textContent='No se pudo preparar el club. Recarga para volver a intentarlo.';console.error(error);}
