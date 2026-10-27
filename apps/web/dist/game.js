// Local simulation or authoritative online presentation, selected at entry.
import { collectTrash } from './collection.js';
import { createWasteModels, createWasteDisplay } from './waste-models.js';
import { NET_LEFT_ANGLE, netContact, refillBoost, spendBoost } from './mechanics.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { freshSurvival, freshChase, tickProtection, takeHit, recoverLife, advanceChase, resolveChaseContact, touchesPickup } from './survival.js';
import { createChaseView } from './chase-view.js';
import { createSurferAnimation,selectSurferAsset } from './surfer-animation.js';
import { CHARACTERS,raceRoster } from './appearance.js';
import { createEnvironment } from './environment.js';
import { createEquipmentKit } from './equipment.js';
import { CATALOG, findItem } from './economy.js';
import { createFrameClock } from './frame-clock.js';
import { createGameAudio, mountAudioControls } from './audio.js';
import { MAPS, findMap, createCourse, COURSE_LENGTH, COURSE_WIDTH } from './maps.js';
import { sampleWater } from './water-surface.js';
import { createPickupEffects, createWake, createLandingRipple,createBoardContactFoam } from './surf-effects.js';
import { createRenderDiagnostics } from './render-diagnostics.js';
import { createBuoyKit } from './buoys.js';
import { createSurfMotion, advanceNetAngle,applyNetPose,BOARD_WATERLINE_OFFSET,sampleBoardPoint } from './surf-motion.js';
import { createContactFoam } from './contact-foam.js';
import { createNetworkRace } from './network-race.js';
import { createNetworkPresentation } from './network-presentation.js';
import { createArtDirection, ART_PALETTES, composeSurfCamera } from './art-direction.js';
import { createRockKit, ROCK_NAMES } from './rock-kit.js';
import { configureIllustratedMaterial } from './illustrated-materials.js';
import { configureSurfShadows,markShadowReceivers,createSurfRadiance,configureSurfRenderer,createSurfAmbient } from './visual-lighting.js';
const diagnostics=createRenderDiagnostics();
let renderDirty=true,lastRenderedState=null,cameraChanged=false;
const $ = (id) => document.getElementById(id);
const audio = createGameAudio(); mountAudioControls(audio);
let THREE;
try { THREE = await import('./vendor/three.module.js'); }
catch (error) { $('error').hidden = false; console.error(error); throw error; }

const host = $('world');
const networkNote=document.createElement('p');networkNote.className='network-note';networkNote.hidden=true;networkNote.setAttribute('role','status');host.after(networkNote);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
} catch (error) { $('error').hidden = false; console.error(error); throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xbfe8e9);
configureSurfRenderer(THREE,renderer);
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe8e9, 140, 410);
const camera = new THREE.PerspectiveCamera(48, 1, .1, 1100);
createSurfAmbient(THREE,scene);
const material = (color, extras = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, flatShading: true, ...extras });
const white = material(0xfff7e6);
const mesh = (geometry, mat, parent, x = 0, y = 0, z = 0) => {
  const object = new THREE.Mesh(geometry, mat); object.position.set(x, y, z); parent.add(object); return object;
};
const initialCourse=createCourse('maracaibo');
let seed = initialCourse.seed;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const LENGTH = COURSE_LENGTH, WIDTH = COURSE_WIDTH;
let assets;
const gearItems = CATALOG.filter(item => ['board','net'].includes(item.type));
const assetNames=['maracaibo-bridge','palm','octopus','palafito','mangrove','canoe','delta-tree',...ROCK_NAMES,...gearItems.map(item=>`${item.type}-${item.id}`),'shore-study','shore-mangrove',...CHARACTERS.map(character=>`surfer-${character.id}`)];
try {
  assets = await Promise.all(assetNames.map(name => new GLTFLoader().loadAsync(`/assets/${name}.glb`)));
} catch (error) { $('error').hidden = false; console.error('No se pudieron cargar los modelos del juego', error); throw error; }
const byAssetName=Object.fromEntries(assetNames.map((name,i)=>[name,assets[i]]));
const [bridgeAsset,palmAsset,octopusAsset,surferAsset,houseAsset,mangroveAsset,boatAsset,treeAsset]=['maracaibo-bridge','palm','octopus','surfer-nico','palafito','mangrove','canoe','delta-tree'].map(name=>byAssetName[name]);
const rockAssets=ROCK_NAMES.map(name=>byAssetName[name]);
const surferAssets={default:surferAsset,...Object.fromEntries(CHARACTERS.map(character=>[character.id,byAssetName[`surfer-${character.id}`]]))};
const shoreAssets={village:byAssetName['shore-study'],mangrove:byAssetName['shore-mangrove']};
const equipmentAssets=Object.fromEntries(gearItems.map(item=>[item.id,byAssetName[`${item.type}-${item.id}`]]));
const chaseView = createChaseView(THREE, scene, octopusAsset, host, renderer);
let chase = freshChase();
const bridge=bridgeAsset.scene,artDirection=createArtDirection(THREE,scene,bridge);
const surfShadows=configureSurfShadows(THREE,renderer,artDirection);
const surfRadiance=createSurfRadiance(THREE,renderer,scene,artDirection);
// The landmark is a distant backdrop; racers never cross its deck or pass it.
const birds = [];
for (let i = 0; i < 12; i++) {
  const bird = new THREE.Group(), wings = [];
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(side * 1.6, -.2); shape.lineTo(side * .55, .28); shape.closePath();
    const wing = mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xfaf4dd, side: THREE.DoubleSide }), bird);
    wing.rotation.x = -Math.PI / 2; wings.push(wing);
  }
  scene.add(bird); birds.push({ object: bird, wings, x: -35 + i * 7, z: -60 - i * 70, phase: i * .7 });
}

// Both banks are built once and share imported geometry. Only the chosen one renders.
const environments=Object.fromEntries(MAPS.map(map=>[map.id,createEnvironment(THREE,scene,{islands:createCourse(map.id).islands,palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset,rockAssets,shoreAssets,mapId:map.id})]));
for(const environment of Object.values(environments))markShadowReceivers(environment.root);
let activeMap=MAPS[0],environment=environments[activeMap.id];
environments.orinoco.root.visible=false;

// Every obstacle gets foam; two of every three are rocks and the third a buoy,
// which shares the kit with the lane markers placed every 35 m on both sides.
const OBSTACLE_CAPACITY=Math.max(...MAPS.map(map=>createCourse(map.id).obstacles.length));
const LANE_BUOYS=2*Math.ceil((LENGTH+38)/35);
const buoyKit=createBuoyKit(THREE,scene,white,LANE_BUOYS+Math.ceil(OBSTACLE_CAPACITY/3)+1);
const buoy=(x,z,color,size=1)=>buoyKit.add(x,z,color,size);
for (let z = 8; z > -LENGTH - 30; z -= 35) { buoy(-20, z, 0xff8c6d, .72); buoy(20, z, 0xff8c6d, .72); }

const obstacles = [];
const obstacleFoam=createContactFoam(THREE,scene,OBSTACLE_CAPACITY);
const obstacleRocks=createRockKit(THREE,scene,rockAssets,OBSTACLE_CAPACITY-Math.ceil(OBSTACLE_CAPACITY/3));
for (let i = 0; i < initialCourse.obstacles.length; i++) {
  const {x,z,rotation}=initialCourse.obstacles[i];
  if (i % 3) {
    const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
    group.rotation.y=rotation;
    obstacles.push({ object: group, x, z, radius: 1.8 });
  } else {
    const object = buoy(x, z, 0xf4c662); obstacles.push({ object, x, z, radius: 1.15 });
  }
}

// Shared, finite lifesavers. Full-health racers leave them for someone else.
const lifesavers = [];
for (let i = 0; i < initialCourse.lifesavers.length; i++) {
  const {x,z}=initialCourse.lifesavers[i];
  const group = new THREE.Group(); group.position.set(x, .3, z); scene.add(group);
  for (let part = 0; part < 8; part++) {
    const ring = mesh(new THREE.TorusGeometry(.85, .22, 8, 8, Math.PI / 4), part % 2 ? material(0xff8867) : white, group);
    ring.rotation.x = Math.PI / 2; ring.rotation.z = part * Math.PI / 4;
  }
  const marker = nameSprite('+ ♥', '#285d4d'); marker.position.y = 1.8; marker.scale.set(1.8, .6, 1); group.add(marker);
  lifesavers.push({ object: group, x, z, collectedBy: null });
}

// Floating waste is collectible; rocks and course buoys remain obstacles.
const trash = [];
const trashKinds = ['Botella', 'Tubo', 'Envoltorio'];
const wasteModels = createWasteModels(THREE);
const equipmentKit = createEquipmentKit(equipmentAssets,wasteModels);
const pickupEffects=createPickupEffects(THREE);
function addTrash({x,z,kind,rotation,phase}) {
  const group = new THREE.Group(); scene.add(group); group.position.set(x, .23, z);
  const item = wasteModels[kind].clone(true); group.add(item); item.rotation.y = rotation;
  item.scale.setScalar(1.2);
  const signal=pickupEffects.attach(group,kind);
  const entry={ object: group, model:item,signal,x,z,kind,phase,collectedBy:null };
  pickupEffects.update(entry,0,true);trash.push(entry);
}
initialCourse.trash.forEach(addTrash);

function setWasteKind(item,kind) {
  if(item.kind===kind)return;
  item.object.remove(item.model);item.model=wasteModels[kind].clone(true);item.model.scale.setScalar(1.2);item.object.add(item.model);
  item.object.remove(item.signal.halo,item.signal.ring);item.signal.ring.material.dispose();item.signal=pickupEffects.attach(item.object,kind);item.kind=kind;
}

function selectMap(id) {
  activeMap=findMap(id);environment=environments[activeMap.id];
  for(const [key,env] of Object.entries(environments))env.root.visible=key===activeMap.id;
  artDirection.update(0,activeMap.id);
  surfRadiance.select(activeMap.id);
  renderer.setClearColor(ART_PALETTES[activeMap.id].sky);scene.fog.color.set(ART_PALETTES[activeMap.id].haze);
  const course=createCourse(activeMap.id);
  // Reuse the finite pickups and obstacle meshes; switching maps allocates no GPU objects.
  for(const key of ['obstacles','lifesavers','trash']) {
    const objects={obstacles,lifesavers,trash}[key];
    objects.forEach((item,i)=>{
      const data=course[key][i];item.x=data.x;item.z=data.z;
      item.object.position.x=data.x;item.object.position.z=data.z;
      if(key==='obstacles')item.radius=data.radius;
      if(key==='trash') {setWasteKind(item,data.kind);item.phase=data.phase;item.model.rotation.y=data.rotation;pickupEffects.update(item,0,true);}
      if(key==='obstacles'&&i%3)item.object.rotation.y=data.rotation;
    });
  }
  $('race').setAttribute('aria-label',`Carrera en ${activeMap.name}`);
  buoyKit.sync();renderDirty=true;
  obstacleFoam.sync(obstacles.map((item,i)=>({x:item.x,z:item.z,rx:i%3?2.15:.95,rz:i%3?1.85:.95,angle:course.obstacles[i].rotation,kind:i%3?0:2})));
  obstacleRocks.sync(course.obstacles.filter((_,i)=>i%3).map(item=>({x:item.x,z:item.z,angle:item.rotation})));
  document.querySelector('.playground').setAttribute('aria-label',`Carrera en ${activeMap.name}`);
  document.querySelector('.location strong').textContent=activeMap.name;
  document.querySelector('.location .eyebrow').textContent=`VENEZUELA / ${activeMap.region}`;
  document.querySelector('.topbar').dataset.raceLocation=`${activeMap.name.toUpperCase()} / CARRERA LOCAL`;
}

// Finish gate and checkerboard banner.
const finish = new THREE.Group(); finish.position.z = -LENGTH; scene.add(finish);
for (const x of [-19, 19]) mesh(new THREE.CylinderGeometry(.24, .24, 8, 10), white, finish, x, 4);
for (let x = -19; x < 19; x += 2) {
  for (let y = 0; y < 2; y++) mesh(new THREE.BoxGeometry(2, .9, .1), material((Math.round((x + 19) / 2) + y) % 2 ? 0x285e54 : 0xfff8e7), finish, x + 1, 6.6 + y * .9);
}

function nameSprite(text, color) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');ctx.font='bold 27px Arial';ctx.textAlign='center';
  ctx.lineWidth=5;ctx.strokeStyle='#24483dcc';ctx.strokeText(text,128,46);ctx.fillStyle='#fff6df';ctx.fillText(text,128,46);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false }));
  sprite.scale.set(1.6, .50, 1); sprite.position.y = 3.6; return sprite;
}
function makeSurfer(name, color, x, z, index) {
  const group = new THREE.Group(); scene.add(group);
  const board = equipmentKit.board(['coral','sol','manglar','coral'][index]); group.add(board);
  const body = new THREE.Group(); group.add(body);
  const character=CHARACTERS[[0,2,1,3][index]];
  const animation = createSurferAnimation(selectSurferAsset(surferAssets,character.id), color, character.hair, {...character,character:character.id}); body.add(animation.avatar);
  const net = equipmentKit.net(['red-base','red-reuso','red-marea','red-base'][index]); body.add(net.group);
  const nameLabel=index!==0?nameSprite(name.toUpperCase(),color):null;
  if(nameLabel)group.add(nameLabel);
  const shadow = mesh(new THREE.CircleGeometry(.85, 16), new THREE.MeshBasicMaterial({ color: 0x347f79, transparent: true, opacity: .17, depthWrite: false }), scene);
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1, 2.2, 1);
  const wakeEffect=createWake(THREE,scene),wake=wakeEffect.root;
  const shield = mesh(new THREE.TorusGeometry(1.1, .035, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffe9a4, transparent: true, opacity: .8, depthWrite: false }), group, 0, .4);
  shield.name = 'ProtectionRing'; shield.rotation.x = Math.PI / 2; shield.visible = false;
  const landingRipple=createLandingRipple(THREE,scene),landing=landingRipple.mesh;
  // Preserve the opponents' established phase when replacing the old wake decoration.
  for(let i=0;i<36;i++)random();
  return { name, nameLabel, color, index, group, board, body, animation, motion:createSurfMotion(), net, shadow, wake,wakeEffect, shield, landing,landingRipple, landingTimer: 0, landingX:x,landingZ:z,landingPending:false, ...freshSurvival(), startX: x, startZ: z, x, z, speed: 0, turn: 0, netSide: 1, netAngle: 0, energy: 0, boosting: false, jump: 0, jumpVelocity: 0, hit: 0, collected: 0, plastic: 0, metal: 0, catchTimer: 0, dripped: false, phase: random() * 6, finishTime: null };
}
const surfers = [makeSurfer('Tú', '#ef795e', 3, 0, 0), makeSurfer('Amara', '#4e97b3', -5, -3, 1), makeSurfer('Luna', '#e66f8b', 7, -7, 2), makeSurfer('Samuel', '#8cb440', -10, -10, 3)];
const boardFoam=createBoardContactFoam(THREE,scene,surfers.length);
const player = surfers[0], keys = new Set();
let state = 'ready', cameraMode = 'third', countdown = 3, elapsed = 0, visualTime = 0, lastUi = 0, toastTimer = 0;
let menuActive = true, suspended = false, raceId = '', onFinish = () => {};
let networkRace=null,networkPresentation=null,networkConnected=false,networkResultReceived=false,onInput=()=>false;
let inputSeq=0,jumpSeq=0,requestedNetSide=1,lastInputAt=-Infinity;
let networkWasLive=false,networkReconnecting=false;
const frameClock = createFrameClock();
let pausedFrom = 'running';
const cameraTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3();
camera.position.set(3, 11, 19);
function setCamera(mode) {
  renderDirty=true;cameraChanged=true;
  cameraMode = mode;
  // From above, the deck must not hide pickups or racers passing underneath.
  bridge.traverse(object=>{
    if(!object.isMesh) return;
    const top=mode==='top';object.material.transparent=top;object.material.opacity=top?.20:1;
    object.material.depthWrite=!top;object.material.needsUpdate=true;
  });
  for (const id of ['third', 'top']) { $(id).classList.toggle('active', id === mode); $(id).setAttribute('aria-pressed', String(id === mode)); }
  $('view-tag').textContent = 'CÁMARA / ' + (mode === 'third' ? 'TERCERA PERSONA' : 'VISTA CENITAL');
}
function updateUi() {
  const order = surfers.filter(s=>!s.networkHidden).sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
    if (a.finishTime !== null) return -1;
    if (b.finishTime !== null) return 1;
    return a.z - b.z;
  });
  $('leaderboard').replaceChildren(...order.map((s,i)=>{
    const row=document.createElement('li');
    row.innerHTML=`<span class="rank">${i+1}</span><span class="surfer-dot"></span><span class="surfer-name"></span><span class="surfer-type"></span><span class="surfer-collected"></span>`;
    row.querySelector('.surfer-dot').style.background=s.color;row.querySelector('.surfer-dot').textContent=s.name[0]||'';
    row.querySelector('.surfer-name').textContent=s.name;
    row.querySelector('.surfer-type').textContent=s.index?(networkRace?s.controller==='bot'?'Simulado':'Jugador':'Simulado'):'Tu tabla';
    row.querySelector('.surfer-collected').textContent=String(s.collected);return row;
  }));
  $('position').innerHTML = player.disqualified ? '<small>DESC.</small>' : `${Math.max(1,order.indexOf(player)+1)}<small>/ ${order.length}</small>`;
  const t = Math.floor(elapsed); $('timer').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  $('progress').style.width = `${Math.min(100, -player.z / LENGTH * 100)}%`;
  $('distance-label').textContent = player.z < -1 ? `${Math.min(LENGTH, Math.floor(-player.z))} m` : 'SALIDA';
  $('boost-level').style.width = `${player.energy * 100}%`;
  $('boost-percent').textContent = `${Math.round(player.energy * 100)}%`;
  const useBoostHint = matchMedia('(max-width:700px)').matches ? 'Mantén ⚡ para usarlo' : 'Mantén Shift para usarlo';
  $('boost-status').textContent = state === 'finished' ? 'Carga restante de la carrera' : state === 'paused' ? 'Impulso en pausa' : state === 'running' && player.boosting ? '¡Impulso activo!' : player.energy > 0 ? useBoostHint : 'Recoge basura para cargar';
  $('pause').disabled = !!networkRace||!['countdown','running','paused'].includes(state);
  $('boost').classList.toggle('boosting', state === 'running' && player.boosting);
  $('touch-boost').disabled = state !== 'running' || player.energy <= 0;
  $('touch-boost').setAttribute('aria-pressed', String(state === 'running' && player.boosting));
  for (const [id, side] of [['net-left', -1], ['net-right', 1]]) {
    $(id).setAttribute('aria-pressed', String(player.netSide === side)); $(id).classList.toggle('selected', player.netSide === side);
  }
  $('trash-count').textContent = player.collected;
  $('race-plastic').textContent = player.plastic; $('race-metal').textContent = player.metal;
  $('cleanup-total').textContent = surfers.reduce((total, s) => total + s.collected, 0);
  $('trash-summary').textContent = `${trash.filter(item => item.collectedBy !== null).length} / ${trash.length} residuos retirados del agua`;
}
function reset() {
  renderDirty=true;cameraChanged=true;camera.fov=48;camera.updateProjectionMatrix();
  pickupEffects.reset();boardFoam.reset();
  frameClock.reset(); pausedFrom = 'running';
  audio.update('menu');
  keys.clear(); state = 'ready'; elapsed = 0; countdown = 3; toastTimer = 0;
  $('start').hidden=false;
  for(const drop of drops) drop.life=0;
  droplets.count=0;
  chase = freshChase(); chaseView.reset();
  for (const s of surfers) {
    s.wakeEffect.reset();
    s.motion.reset();s.landingRipple.reset();s.landingPending=false;s.landingX=s.startX;s.landingZ=s.startZ;
    Object.assign(s, { ...freshSurvival(), sprayTime: 0, sprayIndex: 0, landingTimer: 0, x: s.startX, z: s.startZ, speed: 0, turn: 0, netSide: 1, netAngle: 0, energy: 0, boosting: false, jump: 0, jumpVelocity: 0, hit: 0, collected: 0, plastic: 0, metal: 0, catchTimer: 0, finishTime: null });
    s.group.rotation.set(0,0,0); s.body.rotation.set(0,0,0); s.net.group.rotation.set(0,0,0); s.net.catchVisual.visible = false; s.shield.visible = false;
    s.net.group.position.set(0,0,0); s.dripped = false;
    s.animation.reset(s.phase); s.animation.update(0,s,s.net.group);
  }
  for (const item of lifesavers) { item.collectedBy = null; item.object.visible = true; }
  for (const item of trash) { item.collectedBy = null; item.object.visible = true; }
  $('collection-hud').classList.remove('collected');
  $('card').hidden = false; $('results-room').hidden = true; $('card-label').textContent = 'UNA CARRERA POR EL AGUA MÁS LIMPIA'; $('card-title').textContent = 'Surfea y recoge.';
  $('card-text').innerHTML = 'Z: red izquierda · X: red derecha.<br>Cada residuo carga tu impulso. Úsalo con Shift.';
  $('start').innerHTML = 'Probar la carrera <span>↗</span>';
  $('race-hud').hidden = true; $('boost').hidden = true; $('countdown').hidden = true; $('toast').hidden = true;
  $('pause').textContent = 'Ⅱ'; $('pause').setAttribute('aria-label', 'Pausar carrera'); updateUi();
}
function start() {
  if(networkRace)return;
  if (state === 'finished') reset();
  if (state !== 'ready') return;
  raceId = crypto.randomUUID(); suspended = false;
  frameClock.reset();
  audio.unlock(); audio.update('countdown');
  state = 'countdown'; countdown = 3; $('card').hidden = true; $('countdown').hidden = false; $('countdown').textContent = '3';
  $('race-hud').hidden = false; $('boost').hidden = false; host.focus({ preventScroll: true });
}
function pause() {
  if(networkRace){keys.clear();sendNetworkInput(performance.now(),true,true);return;}
  if (!['countdown','running','paused'].includes(state)) return;
  if (state === 'paused') state = pausedFrom;
  else { pausedFrom = state; state = 'paused'; }
  frameClock.reset(); keys.clear();
  audio.update(state);
  $('pause').textContent = state === 'paused' ? '▶' : 'Ⅱ'; $('pause').setAttribute('aria-label', state === 'paused' ? 'Continuar carrera' : 'Pausar carrera');
  $('countdown').hidden = !['countdown','paused'].includes(state);
  $('countdown').textContent = state === 'paused' ? 'Pausa' : String(Math.max(1, Math.ceil(countdown)));
  updateUi();
  if (state !== 'paused') { audio.unlock(); host.focus({preventScroll:true}); }
}
function jump() { if(networkRace){if(state==='running'&&networkLive()) {jumpSeq++;sendNetworkInput(performance.now(),true);}return;} if (state === 'running' && player.jump <= 0) { player.jumpVelocity = 6; audio.cue('jump'); } }
function setNetSide(side) { if(networkRace){requestedNetSide=side;sendNetworkInput(performance.now(),true);}else player.netSide=side;updateUi(); }
function networkLive(now=performance.now()) {return !!networkRace&&networkConnected&&networkRace.receivedAt!==null&&now-networkRace.receivedAt<3000;}
function sendNetworkInput(now,force=false,neutral=false) {
  if(!networkRace||!networkConnected||(!neutral&&(!networkLive(now)||state!=='running'||player.disqualified||player.finishTime!==null))||(!force&&now-lastInputAt<50))return;
  lastInputAt=now;
  onInput({type:'race.input',protocolVersion:1,raceId,seq:++inputSeq,
    steer:neutral?0:Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA')),
    boost:!neutral&&(keys.has('ShiftLeft')||keys.has('ShiftRight')),netSide:requestedNetSide,jumpSeq});
}
function releaseInput() { keys.clear();if(networkRace)sendNetworkInput(performance.now(),true,true);else if(['running','countdown'].includes(state))pause(); }
function notify(text) { $('toast').textContent = text; $('toast').hidden = false; toastTimer = 1.8; }
$('third').addEventListener('click', () => setCamera('third')); $('top').addEventListener('click', () => setCamera('top'));
$('start').addEventListener('click', start); $('pause').addEventListener('click', pause);
$('net-left').addEventListener('click', () => setNetSide(-1)); $('net-right').addEventListener('click', () => setNetSide(1));
const controls = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyZ', 'KeyX', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyP']);
window.addEventListener('keydown', (e) => {
  if (menuActive || suspended || document.querySelector('dialog[open]')) return;
  if (!controls.has(e.code) || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.target instanceof HTMLButtonElement && e.code === 'Space') return;
  e.preventDefault(); keys.add(e.code);
  if (!e.repeat) {
    if (e.code === 'Space') jump();
    if (e.code === 'KeyZ') setNetSide(-1); if (e.code === 'KeyX') setNetSide(1);
    if (e.code === 'KeyC') setCamera(cameraMode === 'third' ? 'top' : 'third'); if (e.code === 'KeyP') pause();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if(document.hidden)releaseInput(); });
for (const [id, key] of [['left', 'ArrowLeft'], ['right', 'ArrowRight'], ['touch-boost', 'ShiftLeft']]) {
  $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); $(id).setPointerCapture(e.pointerId); keys.add(key); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $(id).addEventListener(event, () => keys.delete(key));
}
$('jump').addEventListener('pointerdown', (e) => { e.preventDefault(); jump(); });
function resize() { if (!host.clientWidth || !host.clientHeight) return; camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight);renderDirty=true;cameraChanged=true; }
new ResizeObserver(() => { resize(); chaseView.resize(); }).observe(host); resize();

function showHit(s, cause) {
  s.hit = 1.15; s.speed *= .45; s.boosting = false;
  if (!s.index) {
    audio.cue('hit');
    chaseView.feedback();
    notify(cause === 'octopus' ? 'El pulpo te alcanzó · −1 vida. ¡Se está alejando!' : 'Choque · −1 vida. Busca un salvavidas.');
  }
}

// Rubber band for the simulated rivals: one more than this far ahead of the
// player neither hunts trash nor boosts, so a leader cannot sweep the course
// before the player gets there. Rivals near the player still compete.
const RIVAL_LEAD = 35;
function simulate(dt) {
  if(networkRace)return;
  elapsed += dt;
  const steer = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  const wantsBoost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  for (const s of surfers) {
    if (s.finishTime !== null || s.disqualified) continue;
    s.hit = Math.max(0, s.hit - dt);
    s.catchTimer = Math.max(0, s.catchTimer - dt);
    tickProtection(s, dt); s.landingTimer = Math.max(0, s.landingTimer - dt);
    const boardStart = { x: s.x, z: s.z };
    let desiredTurn = steer;
    const reachStart = netReach(s);
    const farAhead = s.index > 0 && s.z < player.z - RIVAL_LEAD;
    if (s.index) {
      let target = Math.sin(elapsed * .36 + s.phase) * 10;
      const wasteAhead = !farAhead && trash.find(item => item.collectedBy === null && item.z < s.z - 3 && item.z > s.z - 20 && Math.abs(item.x - s.x) < 7);
      if (wasteAhead) { s.netSide = wasteAhead.x >= s.x ? 1 : -1; target = THREE.MathUtils.clamp(wasteAhead.x - s.netSide * 2.05, -WIDTH, WIDTH); }
      const lifeAhead = s.lives < 3 && lifesavers.find(item => item.collectedBy === null && item.z < s.z && item.z > s.z - 26);
      if (lifeAhead) target = lifeAhead.x;
      const ahead = obstacles.find(o => o.z < s.z && o.z > s.z - 22 && Math.abs(o.x - s.x) < 3);
      if (ahead) target = THREE.MathUtils.clamp(ahead.x + (s.x >= ahead.x ? 4.5 : -4.5), -WIDTH, WIDTH);
      desiredTurn = THREE.MathUtils.clamp((target - s.x) * .55, -1, 1);
    }
    s.netAngle = advanceNetAngle(s.netAngle,s.netSide,dt);
    const wasBoosting = s.boosting;
    const boost = spendBoost(s.energy, dt, s.index ? !farAhead && (s.energy >= .8 || (s.boosting && s.energy > 0)) : wantsBoost);
    s.energy = boost.energy; s.boosting = boost.boosting;
    if (!s.index && s.boosting && !wasBoosting) audio.cue('boost');
    s.turn = THREE.MathUtils.damp(s.turn, desiredTurn, 8, dt);
    s.x = THREE.MathUtils.clamp(s.x + s.turn * 10 * dt, -WIDTH, WIDTH);
    const cruisingSpeed = s.index ? 15.4 + s.index * .15 + Math.sin(elapsed * .5 + s.phase) * .65 : 16.4;
    const baseSpeed = s.boosting ? cruisingSpeed * 1.4 : cruisingSpeed;
    s.speed = THREE.MathUtils.damp(s.speed, s.hit > 0 ? baseSpeed * .5 : baseSpeed, 3, dt);
    s.z -= s.speed * dt;
    if (s.jumpVelocity !== 0 || s.jump > 0) { s.jumpVelocity -= 16 * dt; s.jump = Math.max(0, s.jump + s.jumpVelocity * dt); if (s.jump <= 0) { s.jumpVelocity = 0; s.landingTimer = .55;s.landingX=s.x;s.landingZ=s.z;s.landingPending=true;s.landingRipple.trigger(s.x,s.z); } }
    if (s.protection <= 0 && s.jump < .75) {
      const obstacle = obstacles.find(o => Math.abs(o.z - s.z) < o.radius + .7 && Math.abs(o.x - s.x) < o.radius + .45);
      if (obstacle && takeHit(s)) showHit(s, 'obstacle');
    }
    if (s.disqualified) continue;
    if (s.jump < .55) for (const item of lifesavers) {
      if (touchesPickup(boardStart, s, item) && recoverLife(s, item)) {
        item.object.visible = false;
        if (!s.index) { audio.cue('life'); notify('Salvavidas · +1 vida'); chaseView.feedback(true); }
      }
    }
    const pickedUp = collectTrash(trash, reachStart, netReach(s), s.index, s.jump);
    if (pickedUp.length) {
      s.collected += pickedUp.length; s.catchTimer = .75; s.dripped = false;
      for (const item of pickedUp) { if (item.kind === 1) s.metal++; else s.plastic++; }
      const previousEnergy = s.energy;
      s.energy = refillBoost(s.energy, pickedUp.length);
      for (const item of pickedUp) {item.object.visible = false;if(!reducedMotion.matches)pickupEffects.burst(item,scene);}
      s.net.catchVisual.children.forEach((model, kind) => { model.visible = kind === pickedUp[0].kind; });
      if (!s.index) {
        audio.cue('collect',pickedUp[0].kind);
        const gained = Math.round((s.energy - previousEnergy) * 100);
        notify(`+${pickedUp.length} ${pickedUp.length === 1 ? trashKinds[pickedUp[0].kind].toLowerCase() + (pickedUp[0].kind === 0 ? ' recogida' : ' recogido') : 'residuos recogidos'} · ${gained > 0 ? `+${gained}% impulso` : 'impulso lleno'}`);
        $('collection-hud').classList.remove('collected'); void $('collection-hud').offsetWidth; $('collection-hud').classList.add('collected');
      }
    }
    if (s.z <= -LENGTH) { s.z = -LENGTH; s.finishTime = elapsed; s.speed=0; s.boosting=false; }
  }
  if (!player.disqualified && player.finishTime === null) {
    advanceChase(chase, player.speed, dt, elapsed);
    if (resolveChaseContact(chase, player)) showHit(player, 'octopus');
  }
  if (player.disqualified) {
    audio.cue('out');
    state = 'finished'; keys.clear(); player.boosting = false; updateUi();
    $('card').hidden = false; $('card-label').textContent = 'SIN VIDAS · DESCALIFICADO'; $('card-title').textContent = 'La próxima ola es tuya.';
    $('card-text').textContent = `Llegaste a ${Math.floor(-player.z)} m. Lo recogido en esta carrera no se guarda. Esquiva, busca salvavidas y usa el impulso para alejar al pulpo.`;
    $('result-save-note').textContent = 'Tu inventario anterior se conserva.';
    $('start').innerHTML = 'Intentar de nuevo <span>↗</span>';
    $('start').focus({ preventScroll: true });
    $('toast').hidden = true; return;
  }
  if (player.finishTime !== null) {
    audio.cue('finish');
    state = 'finished'; updateUi(); const rank = surfers.filter(s => s !== player && s.finishTime !== null && s.finishTime < player.finishTime).length + 1;
    $('card').hidden = false; $('card-label').textContent = `CARRERA COMPLETADA · LLEGASTE ${rank}º`; $('card-title').textContent = `${player.collected} ${player.collected === 1 ? 'residuo' : 'residuos'} menos.`;
    $('card-text').textContent = `Recuperaste ${player.plastic} de plástico y ${player.metal} de chatarra. Llévalos a la tienda para canjear o al taller para fabricar tu próxima red.`;
    $('start').innerHTML = 'Volver al agua <span>↗</span>';
    onFinish({ raceId, plastic: player.plastic, metal: player.metal });
    $('start').focus({ preventScroll: true });
  }
}
function netReach(s) {
  return netContact(s.x, s.z, s.turn, s.netAngle);
}
// A bounded pool shares geometry/material and never changes the course random seed.
const droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(.045,6,4), new THREE.MeshBasicMaterial({color:0xe0fff2}),48);
droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); droplets.frustumCulled=false; scene.add(droplets);
const drops=Array.from({length:48},()=>({life:0,position:new THREE.Vector3(),velocity:new THREE.Vector3()}));
const dropMatrix=new THREE.Object3D(); let dropCursor=0;
const floatingSurface={},boardSurface={},sprayPoint={};
function releaseDrops(net) {
  const at=net.head.getWorldPosition(new THREE.Vector3());
  for(let i=0;i<8;i++) {
    const drop=drops[dropCursor++%drops.length],angle=i*Math.PI/4;
    drop.life=.48+i*.015; drop.size=1; drop.position.copy(at); drop.position.y-=.45;
    drop.position.x+=Math.cos(angle)*.35; drop.position.z+=Math.sin(angle)*.35;
    drop.velocity.set(Math.cos(angle)*.4,-.25,Math.sin(angle)*.4);
  }
}
function releaseBoardSpray(s,dt) {
  if(reducedMotion.matches||!dt||state!=='running'||s.disqualified||s.finishTime!==null||s.jump>.18||s.speed<4)return;
  const turn=Math.abs(s.turn),rate=(turn>.2?turn*18:0)+(s.boosting?18:0);
  if(!rate){s.sprayTime=0;return;}
  s.sprayTime+=dt*rate;
  while(s.sprayTime>=1) {
    s.sprayTime-=1;
    const index=s.sprayIndex++,side=turn>.2?Math.sign(s.turn):(index%2?1:-1);
    const variation=(index%5)/5,drop=drops[dropCursor++%drops.length];
    drop.life=.48;drop.size=1.4;
    sampleBoardPoint(s,side*.58,.9,sprayPoint);
    drop.position.set(sprayPoint.x,sampleWater(sprayPoint.x,sprayPoint.z,visualTime,floatingSurface).height+.07,sprayPoint.z);
    const yaw=s.group.rotation.y,c=Math.cos(yaw),sn=Math.sin(yaw),vx=side*(1.3+variation*1.2),vz=2.4+variation;
    drop.velocity.set(c*vx+sn*vz,1.1+variation*.7,-sn*vx+c*vz);
  }
}
function releaseLandingSpray(s) {
  const height=sampleWater(s.landingX,s.landingZ,visualTime,floatingSurface).height+.12;
  for(let i=0;i<10;i++) {
    const angle=i*Math.PI*2/10,drop=drops[dropCursor++%drops.length];
    drop.life=.42;drop.size=1.25;
    drop.position.set(s.landingX+Math.cos(angle)*.6,height,s.landingZ+Math.sin(angle)*.9);
    drop.velocity.set(Math.cos(angle)*2,1.5+(i%3)*.25,Math.sin(angle)*2);
  }
}
function updateDrops(dt) {
  let count=0;
  for(const drop of drops) {
    drop.life=Math.max(0,drop.life-dt);
    if(!drop.life) continue;
    drop.velocity.y-=dt*5; drop.position.addScaledVector(drop.velocity,dt);
    if(drop.position.y<sampleWater(drop.position.x,drop.position.z,reducedMotion.matches?0:visualTime,floatingSurface).height+.015) {drop.life=0;continue;}
    const size=(drop.size||1)*Math.min(1,drop.life/.12);
    dropMatrix.position.copy(drop.position); dropMatrix.scale.set(.8*size,1.6*size,.8*size); dropMatrix.updateMatrix();
    droplets.setMatrixAt(count++,dropMatrix.matrix);
  }
  droplets.count=count; droplets.instanceMatrix.needsUpdate=true;
}
let previous = performance.now(),lastRenderMs=0;
function animate(now) {
  requestAnimationFrame(animate);
  const updateBegin=performance.now();
  const frameGap=Math.max(0,(now-previous)/1000);
  const frameDt = Math.min(frameGap,.1); previous = now;
  diagnostics.frame(now,frameGap*1000,menuActive?'menú':state);
  if(networkRace&&!menuActive)updateNetworkFrame(now,frameDt);
  const tick = frameClock.tick(now,!networkRace && !menuActive && !suspended && ['countdown','running'].includes(state),step => {
    if (state === 'countdown') {
      countdown -= step; $('countdown').textContent = String(Math.max(1, Math.ceil(countdown)));
      if (countdown <= 1e-9) { state = 'running'; $('countdown').hidden = true; }
    } else if (state === 'running') simulate(step);
    return state === 'countdown' || state === 'running';
  });
  if (tick.stalled) {
    console.info(`Carrera pausada: ${Math.round(frameGap*1000)} ms entre fotogramas; dibujo anterior ${lastRenderMs.toFixed(1)} ms (${document.visibilityState}).`);
    pause(); notify('Carrera en pausa. Continúa cuando estés listo.');
  }
  const dt = networkRace?(networkLive(now)?frameDt:0):tick.dt;
  audio.update(menuActive||suspended?'menu':state,player.boosting);
  if(state==='running'&&!suspended&&chase.gap<15&&chase.retreat===0)audio.cue('danger');
  if (!suspended && state !== 'paused' && state !== 'finished') visualTime += dt;
  if (menuActive) { renderPreview(frameDt); return; }
  if (suspended) return;
  if(['paused','finished'].includes(state)&&lastRenderedState===state&&!renderDirty)return;
  const poseDt = state === 'paused' || state === 'finished' ? 0 : dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
  // Animation follows consumed gameplay time; pauses and long stalls freeze poses.
  environment.update(visualTime,reducedMotion.matches,player.z);
  artDirection.update(player.z,activeMap.id);
  obstacleFoam.update(visualTime,reducedMotion.matches);
  for (const bird of birds) {
    bird.object.position.set(bird.x + Math.sin(visualTime * .16 + bird.phase) * 13, 15 + Math.sin(visualTime * .4 + bird.phase), bird.z);
    bird.object.rotation.y = Math.cos(visualTime * .16 + bird.phase) * .5;
    bird.wings.forEach((wing, i) => wing.rotation.y = Math.sin(visualTime * 3.4 + bird.phase) * .35 * (i ? 1 : -1));
  }
  for (const s of surfers) {
    if(s.networkHidden||(networkRace&&!networkRace.latest)){s.group.visible=false;s.shadow.visible=false;s.shield.visible=false;s.wake.visible=false;s.landing.visible=false;continue;}
    s.shadow.visible=true;
    const waterTime=reducedMotion.matches?0:visualTime;
    sampleWater(s.x,s.z,waterTime,boardSurface);
    const motion=s.motion.update(poseDt,s);
    const bob = reducedMotion.matches?0:Math.sin(visualTime * 2.2 + s.phase) * .01;
    s.group.position.set(s.x, boardSurface.height+BOARD_WATERLINE_OFFSET+bob+s.jump+motion.boardHeight, s.z);
    const hitRecoil = s.hit > 0 ? Math.sin((1.15 - s.hit) * Math.PI * 3) * s.hit * .10 : 0;
    s.group.rotation.z = THREE.MathUtils.damp(s.group.rotation.z,s.disqualified ? -.65 : -s.turn * .30 + hitRecoil-boardSurface.dx,10,poseDt);
    s.group.rotation.y = -s.turn * .2;
    s.group.rotation.x = THREE.MathUtils.damp(s.group.rotation.x,boardSurface.dz+motion.boardPitch,10,poseDt);
    s.body.rotation.z=0;
    if (state !== 'running') s.netAngle = advanceNetAngle(s.netAngle,s.netSide,poseDt);
    applyNetPose(s.net.group,s.netAngle,motion);
    s.animation.update(poseDt,s,s.net.group,motion);
    if(s.catchTimer>0 && motion.scoop>.6 && !s.dripped && poseDt>0) {
      s.dripped=true; if(!reducedMotion.matches) releaseDrops(s.net);
    }
    s.net.catchVisual.visible = s.catchTimer > 0;
    s.group.visible = true;
    s.shield.visible = s.protection > 0 && !s.disqualified && state !== 'finished';
    s.shield.scale.setScalar(1 + Math.sin(visualTime * 3) * .05);
    s.landingRipple.update(s.landingTimer,waterTime,s.disqualified);
    s.shadow.position.set(s.x, boardSurface.height+.035, s.z); s.shadow.scale.setScalar(1 + s.jump * .12); s.shadow.scale.y *= 2.2;
    s.wakeEffect.update(s,visualTime,state==='running'&&poseDt>0,reducedMotion.matches);
    if(s.landingPending&&poseDt>0){s.landingPending=false;if(!reducedMotion.matches&&!s.disqualified)releaseLandingSpray(s);}
    releaseBoardSpray(s,poseDt);
  }
  boardFoam.update(surfers,visualTime,reducedMotion.matches);
  updateDrops(poseDt);
  pickupEffects.updateBursts(poseDt,reducedMotion.matches?0:visualTime);
  for (const item of trash) {
    if (item.collectedBy !== null) continue;
    pickupEffects.update(item,reducedMotion.matches?0:visualTime,reducedMotion.matches);
  }
  for (const item of lifesavers) if (item.collectedBy === null) {
    sampleWater(item.x,item.z,reducedMotion.matches?0:visualTime,floatingSurface);
    item.object.position.y = floatingSurface.height+.30;
    item.object.rotation.z = reducedMotion.matches?0:Math.sin(visualTime + item.z) * .08;
  }
  chaseView.update(player, chase, state, dt);
  if (cameraMode === 'third') {
    composeSurfCamera(camera.aspect,player.x,player.z,cameraTarget,lookTarget,Math.cos(player.netAngle/NET_LEFT_ANGLE*Math.PI));
  }
  else { cameraTarget.set(player.x * .2, 46, player.z + 3); lookTarget.set(player.x * .2, 0, player.z - 4); }
  if(cameraChanged&&['countdown','paused','finished'].includes(state))camera.position.copy(cameraTarget);
  else camera.position.lerp(cameraTarget,1-Math.exp(-dt*(camera.aspect<.85?10:4)));
  if(cameraMode==='third'){
    camera.position.z=cameraTarget.z;
    const maxLateralLag=camera.aspect<.85?.25:.5;
    camera.position.x=THREE.MathUtils.clamp(camera.position.x,cameraTarget.x-maxLateralLag,cameraTarget.x+maxLateralLag);
  }
  cameraChanged=false;camera.lookAt(lookTarget);
  const targetFov = cameraMode === 'third' && state === 'running' && player.boosting ? 52 : 48;
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, dt); camera.updateProjectionMatrix();
  const renderBegin=performance.now();
  surfShadows.invalidate();
  renderer.render(scene, camera);
  const mainEnd=performance.now(),mainCalls=renderer.info.render.calls,mainTriangles=renderer.info.render.triangles;
  chaseView.render(player.group);
  lastRenderMs=performance.now()-renderBegin;
  lastRenderedState=state;renderDirty=false;
  diagnostics.record(renderBegin-updateBegin,mainEnd-renderBegin,lastRenderMs-(mainEnd-renderBegin),mainCalls+renderer.info.render.calls,mainTriangles+renderer.info.render.triangles);
  if (now - lastUi > 120) { updateUi(); lastUi = now; }
}
function equipSurfer(s,equipment) {
  const asset=selectSurferAsset(surferAssets,equipment.character);
  if(s.animation.asset!==asset){
    s.body.remove(s.animation.avatar);s.animation.dispose();
    s.animation=createSurferAnimation(asset,findItem(equipment.outfit)?.color,equipment.hair,equipment);s.body.add(s.animation.avatar);
  }
  if(s.board.userData.equipmentId!==equipment.board){s.group.remove(s.board);equipmentKit.dispose(s.board);s.board=equipmentKit.board(equipment.board);s.group.add(s.board);}
  if(s.net.group.userData.equipmentId!==equipment.net){s.body.remove(s.net.group);equipmentKit.dispose(s.net.group);s.net=equipmentKit.net(equipment.net);s.body.add(s.net.group);}
  paint(s.group,equipment);s.animation.setHair(equipment.hair);s.animation.setAppearance(equipment);
}
function setSurferName(s,name) {
  s.name=name;if(!s.nameLabel)return;
  s.group.remove(s.nameLabel);s.nameLabel.material.map.dispose();s.nameLabel.material.dispose();
  s.nameLabel=nameSprite(name,s.color);s.group.add(s.nameLabel);
}
function clearNetworkRace() {
  networkRace=null;networkPresentation=null;networkConnected=false;networkResultReceived=false;networkWasLive=false;networkReconnecting=false;
  networkNote.hidden=true;$('restart').hidden=false;chaseView.setPursuitVisible(true);
  for(const s of surfers){s.networkHidden=false;s.playerId=null;s.controller=s.index?'bot':'human';s.shadow.visible=true;}
}
function updateNetworkFrame(now,dt) {
  if(networkResultReceived)return;
  const live=networkLive(now);
  if(!live&&networkWasLive){keys.clear();sendNetworkInput(now,true,true);}networkWasLive=live;
  const snapshot=networkPresentation.frame(now,live?dt:0);
  if(snapshot){
    state=snapshot.state==='ended'?'finished':snapshot.state;elapsed=snapshot.elapsedSeconds;visualTime=elapsed;countdown=snapshot.countdownSeconds;
    const pursuit=snapshot.pursuits.find(item=>item.targetPlayerId===player.playerId);
    chaseView.setPursuitVisible(!!pursuit);if(pursuit)Object.assign(chase,pursuit);
    const self=networkRace.latest.players.find(item=>item.playerId===player.playerId);
    inputSeq=Math.max(inputSeq,self.lastProcessedInputSeq);jumpSeq=Math.max(jumpSeq,self.lastProcessedJumpSeq);
    $('countdown').hidden=state!=='countdown';$('countdown').textContent=String(Math.max(1,Math.ceil(countdown)));
  }
  const message=networkReconnecting?'Reconectando… La carrera sigue para los demás; tienes 15 s para volver.':!networkConnected?'Se perdió la conexión. Puedes volver al club.':!snapshot?'Conectando con la carrera…':!networkLive(now)?'Esperando la conexión con la carrera…':state==='finished'?'Esperando el resultado confirmado de la sala…':player.finishTime!==null?'Llegaste. Esperando a los demás surfistas…':player.disqualified?'Sin vidas. Esperando el resultado de la sala…':'';
  networkNote.hidden=!message;networkNote.textContent=message;
  sendNetworkInput(now);
}
function enterOnline({start,selfPlayerId}) {
  // Validate everything before changing the local game or its inventory.
  const race=createNetworkRace({start,selfPlayerId});
  networkRace=null;selectMap(race.start.course.mapId);reset();
  networkRace=race;networkConnected=true;networkResultReceived=false;networkWasLive=false;inputSeq=0;jumpSeq=0;requestedNetSide=1;lastInputAt=-Infinity;
  raceId=race.start.raceId;menuActive=false;suspended=false;state='countdown';elapsed=0;visualTime=0;
  for(const key of ['obstacles','trash','lifesavers']){
    const objects={obstacles,trash,lifesavers}[key];
    race.start.course[key].forEach((data,i)=>{
      const item=objects[i];Object.assign(item,{id:data.id,x:data.x,z:data.z});item.object.position.x=data.x;item.object.position.z=data.z;
      if(key==='obstacles')item.radius=data.radius;
      if(key==='trash'){
        setWasteKind(item,data.kind);
        item.kind=data.kind;item.phase=data.phase;item.model.rotation.y=data.rotation;
      }
    });
  }
  for(const item of [...trash,...lifesavers])item.object.visible=false;
  buoyKit.sync();obstacleRocks.sync(obstacles.filter((_,i)=>i%3).map(item=>({x:item.x,z:item.z,angle:0})));
  obstacleFoam.sync(obstacles.map((item,i)=>({x:item.x,z:item.z,rx:i%3?2.15:.95,rz:i%3?1.85:.95,kind:i%3?0:2})));
  surfers.forEach(s=>{s.networkHidden=true;s.disqualified=true;});
  race.members.forEach((member,i)=>{
    const s=surfers[i];s.networkHidden=false;s.disqualified=false;s.playerId=member.playerId;s.controller=member.controller;setSurferName(s,i?member.displayName:'Tú');
    equipSurfer(s,{...member.equipment,...member.appearance});
  });
  networkPresentation=createNetworkPresentation({race,actors:surfers,trash,lifesavers,onEvent(event,s,item){
    if(event.kind==='trash.collected'){
      s.net.catchVisual.children.forEach((model,i)=>model.visible=i===item.kind);
      if(!reducedMotion.matches)pickupEffects.burst(item,scene);if(s===player)audio.cue('collect',item.kind);
    }else if(s===player&&event.kind==='life.collected'){audio.cue('life');chaseView.feedback(true);}
    else if(s===player&&event.kind==='player.hit'){audio.cue('hit');chaseView.feedback();}
  }});
  $('card').hidden=true;$('start').hidden=true;$('race-hud').hidden=false;$('boost').hidden=false;$('countdown').hidden=true;$('restart').hidden=true;
  document.querySelector('.topbar').dataset.raceLocation=`${activeMap.name.toUpperCase()} / CON AMIGOS`;
  networkNote.hidden=false;networkNote.textContent='Conectando con la carrera…';chaseView.setPursuitVisible(false);
  audio.unlock();resize();updateUi();renderDirty=true;cameraChanged=true;host.focus({preventScroll:true});return true;
}
function settlementText(local) {
  if(local.outcome!=='finished')return 'Esta carrera no acredita materiales. Tu equipo anterior se conserva.';
  const amount=`${local.credited.plastic} de plástico y ${local.credited.metal} de chatarra`;
  return `Recuperaste ${local.collected.plastic} de plástico y ${local.collected.metal} de chatarra. `+(local.settlementState==='confirmed'
    ?`Tu perfil online ya recibió ${amount}.`:`La sala registró ${amount} para tu perfil online; la acreditación está pendiente y se confirmará sin duplicarse.`);
}
let onlineResult=null;
function applyOnlineResult(result) {
  const local=networkPresentation?.result(result);if(!local)return false;onlineResult=local;
  networkResultReceived=true;state='finished';keys.clear();player.boosting=false;player.speed=0;networkNote.hidden=true;
  $('card').hidden=false;$('countdown').hidden=true;$('start').hidden=true;$('results-room').hidden=false;
  $('card-label').textContent=local.outcome==='finished'?`CARRERA CON AMIGOS · ${local.rank}º LUGAR`:'CARRERA CON AMIGOS · FINALIZADA';
  $('card-title').textContent=local.outcome==='finished'?'Una buena ola compartida.':'La próxima ola es tuya.';
  $('card-text').textContent=settlementText(local);
  $('result-save-note').textContent=local.settlementState==='confirmed'?'Resultado de la sala y acreditación confirmados por el servicio.':'Resultado confirmado por la sala. La acreditación del perfil online está pendiente.';
  $('results-menu').focus({preventScroll:true});renderDirty=true;updateUi();return true;
}
// Menu and race share models and named material slots, so previews match equipment.
const previewHost = $('avatar-preview');
const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
configureSurfRenderer(THREE,previewRenderer);
previewHost.append(previewRenderer.domElement);
const previewScene = new THREE.Scene(), previewCamera = new THREE.PerspectiveCamera(35, 1, .1, 100);
previewScene.add(new THREE.HemisphereLight(0xfff8de, 0x83aa89, 2.2));
const studioLight = new THREE.DirectionalLight(0xfff0d4, 2.5); studioLight.position.set(-3, 6, -5); previewScene.add(studioLight);
const plinth = mesh(new THREE.CylinderGeometry(2.4, 2.5, .1, 64), material(0xadcdb1), previewScene, 0, -.13);
const recyclingDisplays = Object.fromEntries(['plastic','metal'].map(type => [type, createWasteDisplay(THREE,wasteModels,type)]));
const wasteImages = {};
// Reuse the preview renderer to photograph the actual game meshes once.
for (const kind of ['plastic','metal']) {
  const photoScene = new THREE.Scene();
  photoScene.add(new THREE.HemisphereLight(0xfffae8,0x509e99,2));
  const photoLight = new THREE.DirectionalLight(0xfff1d4,2); photoLight.position.set(-3,5,4); photoScene.add(photoLight);
  photoScene.add(recyclingDisplays[kind].clone(true));
  const photoCamera = new THREE.PerspectiveCamera(35,1.5,.1,20); photoCamera.position.set(2.8,3.8,4.2); photoCamera.lookAt(0,0,0);
  previewRenderer.setSize(240,160); previewRenderer.render(photoScene,photoCamera);
  wasteImages[kind] = previewRenderer.domElement.toDataURL('image/png');
}
const equipmentImages = {};
for(const character of CHARACTERS) {
  const photoScene=new THREE.Scene();photoScene.add(new THREE.HemisphereLight(0xfffae8,0x509e99,1.9));
  const light=new THREE.DirectionalLight(0xfff1d4,2.5);light.position.set(-3,5,-4);photoScene.add(light);
  const actor=createSurferAnimation(selectSurferAsset(surferAssets,character.id),'#ef795e',character.hair,{...character,character:character.id});photoScene.add(actor.avatar);
  const camera=new THREE.PerspectiveCamera(32,1.3,.1,20);camera.position.set(.8,2.8,-3.5);camera.lookAt(0,2.35,0);
  previewRenderer.setSize(260,200);previewRenderer.render(photoScene,camera);
  equipmentImages[character.id]=previewRenderer.domElement.toDataURL('image/png');actor.dispose();
}
for(const item of CATALOG.filter(item=>item.type==='hair')) {
  const photoScene=new THREE.Scene();photoScene.add(new THREE.HemisphereLight(0xfffae8,0x509e99,2));
  const light=new THREE.DirectionalLight(0xfff1d4,2.5);light.position.set(-3,5,-4);photoScene.add(light);
  const actor=createSurferAnimation(surferAsset,'#ef795e',item.id);photoScene.add(actor.avatar);
  const camera=new THREE.PerspectiveCamera(30,1.5,.1,20);camera.position.set(1.2,2.7,2.1);camera.lookAt(0,2.56,0);
  previewRenderer.setSize(240,160);previewRenderer.render(photoScene,camera);
  equipmentImages[item.id]=previewRenderer.domElement.toDataURL('image/png');actor.dispose();
}
for (const item of gearItems) {
  const photoScene = new THREE.Scene();
  photoScene.add(new THREE.HemisphereLight(0xfffae8,0x509e99,2.2));
  const light = new THREE.DirectionalLight(0xfff1d4,2.5); light.position.set(-3,5,-4); photoScene.add(light);
  const object = item.type === 'board' ? equipmentKit.board(item.id) : equipmentKit.net(item.id).group;
  const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()); object.position.sub(center); photoScene.add(object);
  const photoCamera = new THREE.PerspectiveCamera(35,1.5,.1,30);
  photoCamera.position.set(...(item.type === 'board' ? [2.9,5.5,4.6] : [2.5,3.8,-5.4])); photoCamera.lookAt(0,0,0);
  previewRenderer.setSize(300,200); previewRenderer.render(photoScene,photoCamera);
  equipmentImages[item.id] = previewRenderer.domElement.toDataURL('image/png');
  equipmentKit.dispose(object);
}
let previewObject, previewType, previewTime = 0, previewAnimation, previewNet, previewBack=true;
const previewView=$('preview-view');
previewView.addEventListener('click',()=>{previewBack=!previewBack;positionPreviewCamera();});
function positionPreviewCamera() {
  if(previewType==='surfer') {
    previewCamera.position.set(previewBack?-3.8:4.3,3.1,previewBack?6.2:-6.2);previewCamera.lookAt(0,1.15,0);
  }
  previewView.textContent=previewBack?'Ver de frente ↻':'Ver de espalda ↻';
  previewView.setAttribute('aria-label',previewBack?'Ver surfista de frente':'Ver surfista de espalda');
}
let previewMaterials = new Set();
function paint(root, equipment) {
  const slots = { BoardColor: findItem(equipment.board)?.color, OutfitColor: findItem(equipment.outfit)?.color, NetColor: findItem(equipment.net)?.color };
  root.traverse(o => { if (o.isMesh && slots[o.material.name]) o.material.color.set(slots[o.material.name]); });
}
function updatePreview(equipment, type = 'surfer') {
  if (previewObject) {
    previewScene.remove(previewObject);
    previewAnimation?.dispose(); previewAnimation=null; previewNet=null;
    for(const mat of previewMaterials) mat.dispose(); previewMaterials.clear();
  }
  previewType = type;
  previewView.hidden=type!=='surfer';
  if(type==='surfer') {
    previewObject=new THREE.Group(); previewObject.add(equipmentKit.board(equipment.board,false));
    previewAnimation=createSurferAnimation(selectSurferAsset(surferAssets,equipment.character),undefined,equipment.hair,equipment);
    previewObject.add(previewAnimation.avatar);
    previewNet=equipmentKit.net(equipment.net,false).group; previewObject.add(previewNet);
  } else previewObject = recyclingDisplays[type] ? recyclingDisplays[type].clone(true) : type === 'board' ? equipmentKit.board(equipment.board,false) : equipmentKit.net(equipment.net,false).group;
  previewObject.position.set(0, 0, 0); previewObject.rotation.set(0, 0, 0); previewObject.visible = true;
  const materials = new Map();
  previewObject.traverse(o => {
    if(o.material) {if(!materials.has(o.material)) materials.set(o.material,configureIllustratedMaterial(o.material.clone(),o.material.userData.compPaintPreset||'equipment')); o.material=materials.get(o.material); if(o.material.transparent)o.material.depthWrite=false;previewMaterials.add(o.material);}
    if (['CaughtWaste','ProtectionRing'].includes(o.name)) o.visible = false;
  });
  paint(previewObject, equipment); previewScene.add(previewObject);
  if (type === 'net') {
    const center = new THREE.Box3().setFromObject(previewObject).getCenter(new THREE.Vector3()); previewObject.position.sub(center); previewObject.position.y += .8;
  }
  plinth.visible = type !== 'net' && !recyclingDisplays[type];
  if (recyclingDisplays[type]) { previewCamera.position.set(3.5,3.6,5.3); previewCamera.lookAt(0,0,0); }
  else if (type === 'net') { previewCamera.position.set(3,2.3,-4.8); previewCamera.lookAt(0,.8,0); }
  else {
    previewCamera.position.set(type === 'board' ? 2.9 : 4.3, type === 'board' ? 5.5 : 3.1, type === 'board' ? 4.6 : -6.2);
    previewCamera.lookAt(0, type === 'board' ? 0 : 1.15, 0);
  }
  positionPreviewCamera();
  resizePreview();
}
function resizePreview() {
  if (!previewHost.clientWidth || !previewHost.clientHeight) return;
  previewCamera.aspect = previewHost.clientWidth / previewHost.clientHeight; previewCamera.updateProjectionMatrix();
  previewRenderer.setSize(previewHost.clientWidth, previewHost.clientHeight);
}
new ResizeObserver(resizePreview).observe(previewHost);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function renderPreview(dt) {
  previewTime += dt;
  if (previewObject && !reducedMotion.matches) previewObject.rotation.y = Math.sin(previewTime * .45) * (previewType === 'board' ? .12 : .07);
  previewAnimation?.update(reducedMotion.matches ? 0 : dt,{},previewNet);
  if (previewObject && recyclingDisplays[previewType]) previewObject.children.forEach((o,i) => {
    if (o.userData.floating) { o.position.y=o.userData.baseY + (reducedMotion.matches ? 0 : Math.sin(previewTime*1.5+i)*.065); o.rotation.z=reducedMotion.matches ? 0 : Math.sin(previewTime*1.2+i)*.045; }
  });
  previewRenderer.render(previewScene, previewCamera);
}
// Photograph both real destinations once, using the existing rendering context.
const mapPhotoCamera=new THREE.PerspectiveCamera(48,16/9,.1,1100);
mapPhotoCamera.position.set(10,17,-30);mapPhotoCamera.lookAt(0,6,-200);
const mapPhotoSize=renderer.getSize(new THREE.Vector2()),mapPhotoRatio=renderer.getPixelRatio();
const photoHidden=[octopusAsset.scene,boardFoam.mesh,...birds.map(b=>b.object),...surfers.flatMap(s=>[s.group,s.shadow,s.wake,s.landing])];
const photoVisibility=photoHidden.map(object=>object.visible);
photoHidden.forEach(object=>object.visible=false);
renderer.setPixelRatio(1);renderer.setSize(640,360);
const mapImages={};
for(const map of MAPS) {
  selectMap(map.id);surfShadows.invalidate();renderer.render(scene,mapPhotoCamera);
  mapImages[map.id]=renderer.domElement.toDataURL('image/jpeg',.85);
}
selectMap('maracaibo');
photoHidden.forEach((object,index)=>object.visible=photoVisibility[index]);
renderer.setPixelRatio(mapPhotoRatio);renderer.setSize(mapPhotoSize.x,mapPhotoSize.y);
// Prepare race-only effects before enabling Play, including the initially hidden wakes.
await renderer.compileAsync(scene,camera);
export const game = {
  mapImages,
  wasteImages,
  equipmentImages,
  get state() { return state; },
  get mode() { return networkRace?'online':'local'; },
  set onFinish(handler) { onFinish = handler; },
  set onInput(handler) { onInput = handler; },
  preview: updatePreview,
  equip(equipment) {
    equipSurfer(player,equipment);
    const roster=raceRoster(equipment.character);
    for(const rival of surfers.slice(1)){
      const character=roster[rival.index];
      rival.controller='bot';if(rival.name!==character.name)setSurferName(rival,character.name);
      equipSurfer(rival,{...character,character:character.id,board:['coral','sol','manglar','coral'][rival.index],net:['red-base','red-reuso','red-marea','red-base'][rival.index],outfit:'costero'});
      rival.body.traverse(object=>{if(object.isMesh&&object.material.name==='OutfitColor')object.material.color.set(rival.color);});
    }
    renderDirty=true;
  },
  enter(mapId='maracaibo') { clearNetworkRace();selectMap(mapId); menuActive = false; suspended = false; reset(); start(); resize(); },
  enterOnline,
  applySnapshot(snapshot) {
    if(!networkRace||networkResultReceived)return false;
    const now=performance.now(),recovering=networkRace.receivedAt!==null&&now-networkRace.receivedAt>=3000;
    if(!networkRace.push(snapshot,now))return false;
    if(recovering){networkRace.resetBuffer();for(const s of surfers){s.wakeEffect.reset();s.motion.reset();}keys.clear();cameraChanged=true;}
    renderDirty=true;return true;
  },
  applyEvent(event) {return networkPresentation?.event(event)??false;},
  applyResult:applyOnlineResult,
  /** A later race.ended only moves settlementState pending -> confirmed. */
  applySettlement(result) {
    const own=result?.participants?.find(item=>item.playerId===onlineResult?.playerId);
    if(!onlineResult||result.raceId!==networkRace?.start.raceId||own?.settlementState!=='confirmed')return false;
    onlineResult={...onlineResult,settlementState:'confirmed'};
    $('card-text').textContent=settlementText(onlineResult);
    $('result-save-note').textContent='Resultado de la sala y acreditación confirmados por el servicio.';return true;
  },
  setConnectionState(status) {
    if(!networkRace||networkResultReceived)return;
    networkConnected=status==='racing';networkReconnecting=status==='reconnecting';
    if(!networkConnected){
      keys.clear();networkNote.hidden=false;
      networkNote.textContent=status==='reconnecting'?'Reconectando… La carrera sigue para los demás; tienes 15 s para volver.':'Se perdió la conexión. Puedes volver al club.';
    }
    renderDirty=true;
  },
  exit() { clearNetworkRace();onlineResult=null;menuActive = true; suspended = false; reset(); },
  suspend(value) { if(networkRace){keys.clear();sendNetworkInput(performance.now(),true,true);return;}suspended = value; frameClock.reset(); audio.update(value?'menu':state); keys.clear(); },
};
reset(); requestAnimationFrame(animate);
