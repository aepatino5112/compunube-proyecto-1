import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { createEquipmentKit } from './equipment.js';
import { createWasteModels } from './waste-models.js';
import { createSurferAnimation,selectSurferAsset } from './surfer-animation.js';
import { configureSurfRenderer } from './visual-lighting.js';
import { createSurfMotion,advanceNetAngle,applyNetPose,BOARD_WATERLINE_OFFSET } from './surf-motion.js';
import { CATALOG } from './economy.js';
import { CHARACTERS,SKIN_TONES,HAIR_COLORS } from './appearance.js';
import { createLandingRipple } from './surf-effects.js';
import { NET_LEFT_ANGLE } from './mechanics.js';
import { sampleWater } from './water-surface.js';
import { createReviewCameraFit } from './review-camera.js';

const $=id=>document.getElementById(id),host=$('viewer'),loader=new GLTFLoader();
const gestures={scoop:{title:'Recogida seguida',detail:'La red mantiene su movimiento al recoger otro residuo.'},transfer:{title:'Cambio Z / X',detail:'La red se eleva al cruzar; las manos siguen el mango.'},jump:{title:'Salto y aterrizaje',detail:'Flexión al caer y una onda que queda en el punto de contacto.'},turn:{title:'Giro e impulso',detail:'La tabla se inclina y el cuerpo compensa el movimiento.'}};
let gesture='scoop';
try {
  const netItems=CATALOG.filter(item=>item.type==='net'),boardItems=CATALOG.filter(item=>item.type==='board');
  const names=[...boardItems.map(item=>`board-${item.id}`),...netItems.map(item=>`net-${item.id}`),...CHARACTERS.map(character=>`surfer-${character.id}`)];
  const assets=await Promise.all(names.map(name=>loader.loadAsync(`./assets/${name}.glb`)));
  const byName=Object.fromEntries(names.map((name,i)=>[name,assets[i]])),avatar=byName['surfer-nico'],netAssets=netItems.map(item=>byName[`net-${item.id}`]);
  const surferAssets={default:avatar,...Object.fromEntries(CHARACTERS.map(character=>[character.id,byName[`surfer-${character.id}`]]))};
  const kit=createEquipmentKit({...Object.fromEntries(boardItems.map(item=>[item.id,byName[`board-${item.id}`]])),...Object.fromEntries(netItems.map((item,i)=>[item.id,netAssets[i]]))},createWasteModels(THREE));
  $('board-design').innerHTML=boardItems.map(item=>`<option value="${item.id}">${item.name}</option>`).join('');
  $('net-design').innerHTML=netItems.map(item=>`<option value="${item.id}">${item.name}</option>`).join('');
  for(const [id,items] of [['character-design',CHARACTERS],['skin-design',SKIN_TONES],['color-design',HAIR_COLORS],['hair-design',CATALOG.filter(item=>item.type==='hair')]]){
    $(id).innerHTML=items.map(item=>`<option value="${item.id}">${item.name}</option>`).join('');
  }
  $('skin-design').value='medium';$('color-design').value='brown';
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xc6e4db);
  scene.add(new THREE.HemisphereLight(0xfff6dc,0x678f83,2.2));
  const sun=new THREE.DirectionalLight(0xfff1d9,2.6);sun.position.set(-3,7,-4);scene.add(sun);
  const fill=new THREE.DirectionalLight(0xe3f2ed,1.1);fill.position.set(-2,5,6);scene.add(fill);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
  configureSurfRenderer(THREE,renderer);host.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(36,1,.1,50),racer=new THREE.Group();scene.add(racer);
  const fitCamera=createReviewCameraFit(camera);
  let animation=createSurferAnimation(avatar,'#ef795e');const motion=createSurfMotion();let net=kit.net(),board=kit.board();
  racer.add(board,animation.avatar,net.group);
  const geometry=new THREE.PlaneGeometry(24,24,48,48);geometry.rotateX(-Math.PI/2);
  const water=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x54b7b2,roughness:.45,metalness:.08}));scene.add(water);
  const ripple=createLandingRipple(THREE,scene),surface={};
  function stateAt(t){
    const state={x:0,z:0,speed:16,turn:0,netAngle:0,jump:0,jumpVelocity:0,catchTimer:0,landingTimer:0,hit:0,boosting:false};
    if(gesture==='scoop'){
      const start=t<.6?.15:.6;state.catchTimer=t>=start?Math.max(0,.75-(t-start)):0;
    } else if(gesture==='transfer'){
      const held=advanceNetAngle(0,-1,Math.max(0,Math.min(t,1)-.15));
      state.netAngle=t<=1?held:advanceNetAngle(held,1,t-1);
    } else if(gesture==='jump'){
      const airTime=t-.2;
      if(airTime>0&&airTime<.75){state.jump=6*airTime-8*airTime*airTime;state.jumpVelocity=6-16*airTime;}
      if(t>=.95){state.landingTimer=Math.max(0,.55-(t-.95));state.z=-(t-.95)*4;}
    } else {state.turn=Math.sin(t*Math.PI);state.boosting=t>=.7&&t<1.4;}
    return state;
  }
  function render(){
    const fraction=Number($('phase').value)/100,target=fraction*1.8,steps=Math.round(target*120);
    animation.reset();motion.reset();ripple.reset();net.group.rotation.set(0,0,0);net.group.position.set(0,0,0);racer.rotation.set(0,0,0);
    let state=stateAt(0),visual=motion.pose;
    for(let i=0;i<=steps;i++){
      const t=i/120,dt=i?1/120:0;state=stateAt(t);visual=motion.update(dt,state);
      applyNetPose(net.group,state.netAngle,visual);
      racer.rotation.set(visual.boardPitch, -state.turn*.2,-state.turn*.3);
      sampleWater(state.x,state.z,t,surface);racer.position.set(state.x,surface.height+BOARD_WATERLINE_OFFSET+state.jump+visual.boardHeight,state.z);
      animation.update(dt,state,net.group,visual);
    }
    net.catchVisual.visible=state.catchTimer>0;net.catchVisual.children.forEach((model,i)=>model.visible=i===0);
    ripple.trigger(0,0);ripple.update(state.landingTimer,target);
    const positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++)positions.setY(i,sampleWater(positions.getX(i),positions.getZ(i),target,surface).height);
    positions.needsUpdate=true;geometry.computeVertexNormals();
    const view=$('view').value;
    fitCamera(racer,view);renderer.render(scene,camera);
    $('pose-name').textContent=gestures[gesture].title;$('pose-detail').textContent=gestures[gesture].detail;
    $('moment').textContent=`${Math.round(fraction*100)} %`;
    $('ready').textContent=`Listo · ${gestures[gesture].title} · ${target.toFixed(2)} s`;
    host.setAttribute('aria-label',`${gestures[gesture].title}, momento ${Math.round(fraction*100)} %, vista ${view}`);
  }
  function resize(){renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();render();}
  document.querySelectorAll('[data-gesture]').forEach(button=>button.addEventListener('click',()=>{
    gesture=button.dataset.gesture;document.querySelectorAll('[data-gesture]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();
  }));
  $('phase').addEventListener('input',render);$('view').addEventListener('change',render);
  $('hair-design').addEventListener('change',()=>{animation.setHair($('hair-design').value);render();});
  $('character-design').addEventListener('change',()=>{
    const character=CHARACTERS.find(item=>item.id===$('character-design').value);
    const source=selectSurferAsset(surferAssets,character.id);
    if(animation.asset!==source){racer.remove(animation.avatar);animation.dispose();animation=createSurferAnimation(source,'#ef795e',character.hair,{...character,character:character.id});racer.add(animation.avatar);}
    animation.setAppearance({...character,character:character.id});animation.setHair(character.hair);
    $('skin-design').value=character.skin;$('color-design').value=character.hairColor;$('hair-design').value=character.hair;render();
  });
  $('skin-design').addEventListener('change',()=>{animation.setAppearance({skin:$('skin-design').value});render();});
  $('color-design').addEventListener('change',()=>{animation.setAppearance({hairColor:$('color-design').value});render();});
  $('net-design').addEventListener('change',()=>{racer.remove(net.group);kit.dispose(net.group);net=kit.net($('net-design').value);racer.add(net.group);render();});
  $('board-design').addEventListener('change',()=>{racer.remove(board);kit.dispose(board);board=kit.board($('board-design').value);racer.add(board);render();});
  for(const [id,delta] of [['previous',-10],['next',10]])$(id).addEventListener('click',()=>{$('phase').value=String(THREE.MathUtils.clamp(Number($('phase').value)+delta,0,100));render();});
  document.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);new ResizeObserver(resize).observe(host);resize();
} catch(error){$('ready').textContent='No se pudo preparar la vista de movimiento.';console.error(error);}
