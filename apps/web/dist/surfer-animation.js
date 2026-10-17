import * as THREE from './vendor/three.module.js';
import { clone } from './vendor/addons/utils/SkeletonUtils.js';
import { NET_GRIPS,NET_LEFT_ANGLE,netHandGrip } from './mechanics.js';
import { HAIR_STYLES,SKIN_TONES,HAIR_COLORS,findCharacter,restoreAppearance } from './appearance.js';
import { configureIllustratedMaterial } from './illustrated-materials.js';

const loops = ['SurfIdle','TurnLeft','TurnRight','Boost','Jump'];
const events = ['Scoop','Land','Hit'];
const eventSpecs=[['Scoop','catchTimer',.75],['Land','landingTimer',.55],['Hit','hit',1.15]];
export const selectSurferAsset=(assets,character)=>assets[findCharacter(character).id]||assets.default;

// Solve in world space so the same grip works on both sides of a moving board.
function aim(bone, child, target) {
  const {start,from,to,world,delta,parent}=bone.userData.aimScratch;
  bone.getWorldPosition(start);
  child.getWorldPosition(from).sub(start).normalize();
  to.copy(target).sub(start).normalize();
  bone.getWorldQuaternion(world).premultiply(delta.setFromUnitVectors(from,to));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(parent).invert().multiply(world));
  bone.updateWorldMatrix(false,true);
}
function solveChain(chain,target,hint,stretch=false) {
  const {upper,lower,end}=chain;
  const {start,direction,bend,elbow,reachable,temp}=chain.scratch;
  upper.getWorldPosition(start); direction.copy(target).sub(start);
  const distance=direction.length(); direction.normalize();
  const factor=stretch ? Math.max(1,distance/(chain.a+chain.b-.02)) : 1;
  const a=chain.a*factor,b=chain.b*factor,d=THREE.MathUtils.clamp(distance,.04,a+b-.001);
  const along=(a*a-b*b+d*d)/(2*d), height=Math.sqrt(Math.max(0,a*a-along*along));
  bend.copy(hint).addScaledVector(direction,-hint.dot(direction)).normalize();
  elbow.copy(start).addScaledVector(direction,along).addScaledVector(bend,height);
  reachable.copy(start).addScaledVector(direction,d);
  // Extra reach belongs to joint translations. Scaling the parent also inflated
  // sleeves, cuffs and palms, and distorted their overlap with the torso.
  upper.scale.set(1,1,1); upper.updateWorldMatrix(false,true);
  aim(upper,lower,elbow);
  lower.position.copy(upper.worldToLocal(temp.copy(elbow))); lower.updateWorldMatrix(false,true);
  aim(lower,end,reachable);
  end.position.copy(lower.worldToLocal(temp.copy(reachable))); end.updateWorldMatrix(false,true);
}

export function createSurferAnimation(asset, color, hairstyle='swept', appearance={}) {
  const avatar=clone(asset.scene);
  const alignedGrip=Boolean(avatar.getObjectByName('CartoonSurfer')?.userData.grip_frame);
  const poleAxis=new THREE.Vector3().fromArray(NET_GRIPS.R).sub(new THREE.Vector3().fromArray(NET_GRIPS.L)).normalize();
  const poleUp=new THREE.Vector3(0,1,0).addScaledVector(poleAxis,-poleAxis.y).normalize();
  const poleFrame=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(poleAxis,poleUp,new THREE.Vector3().crossVectors(poleAxis,poleUp)));
  const ownedMaterials=new Set();
  const copies=new Map();
  avatar.traverse(o=>{
    if(!o.isMesh)return;
    const name=o.material.name;
    if(o.material.isMeshStandardMaterial){
      if(!copies.has(o.material))copies.set(o.material,configureIllustratedMaterial(o.material.clone(),'actor'));
      o.material=copies.get(o.material);ownedMaterials.add(o.material);
      if(color&&name==='OutfitColor')o.material.color.set(color);
      if(name==='Skin')o.material.roughness=.64;
      else if(name.startsWith('Hair-'))o.material.roughness=.78;
    }
    o.castShadow=!o.material.transparent;o.receiveShadow=true;
  });
  let currentAppearance={...restoreAppearance(appearance),character:findCharacter(appearance.character).id};
  function setAppearance(value={}) {
    currentAppearance={...restoreAppearance({...currentAppearance,...value}),character:findCharacter(value.character??currentAppearance.character).id};
    const skinColor=new THREE.Color(SKIN_TONES.find(tone=>tone.id===currentAppearance.skin).color);
    const hairColor=new THREE.Color(HAIR_COLORS.find(tone=>tone.id===currentAppearance.hairColor).color);
    const morph=findCharacter(currentAppearance.character).morph;
    avatar.traverse(o=>{
      if(!o.isMesh)return;
      const name=o.material.name;
      if(name==='Skin')o.material.color.copy(skinColor);
      else if(name==='Cheeks')o.material.color.copy(skinColor).lerp(new THREE.Color('#d36f61'),.25);
      else if(name==='Brows')o.material.color.copy(hairColor).multiplyScalar(.65);
      else if(name.startsWith('Hair-'))o.material.color.copy(hairColor);
      if(o.morphTargetInfluences)for(const [target,index] of Object.entries(o.morphTargetDictionary))o.morphTargetInfluences[index]=target===morph?1:0;
    });
    avatar.userData.character=currentAppearance.character;
  }
  function setHair(style='swept') {
    const chosen=HAIR_STYLES.includes(style)?style:'swept';
    avatar.traverse(o=>{if(o.isMesh&&o.material.name.startsWith('Hair-'))o.visible=o.material.name===`Hair-${chosen}`;});
  }
  setAppearance(appearance);
  setHair(hairstyle);
  const mixer=new THREE.AnimationMixer(avatar), actions={};
  const chest=avatar.getObjectByName('Chest');
  const chestPose=chest?.quaternion.clone();
  const hips=avatar.getObjectByName('Hips'),hipsPose=hips?.quaternion.clone();
  const head=avatar.getObjectByName('Head'),headPose=head?.quaternion.clone();
  for(const clip of asset.animations) {
    const action=mixer.clipAction(clip); action.setEffectiveWeight(0);
    if(events.includes(clip.name)) {action.setLoop(THREE.LoopOnce,1); action.clampWhenFinished=true;}
    action.play(); actions[clip.name]=action;
  }
  for(const name of [...loops,...events]) if(!actions[name]) throw Error(`Falta la animación ${name}`);
  avatar.updateMatrixWorld(true);
  const chains=[];
  for(const suffix of ['L','R']) for(const kind of ['arm','leg']) {
    const names=kind==='arm' ? ['UpperArm_','Forearm_','Hand_'] : ['Thigh_','Shin_','Foot_'];
    const [upper,lower,end]=names.map(name=>avatar.getObjectByName(name+suffix));
    if(!upper||!lower||!end) throw Error(`Esqueleto incompleto: ${suffix}/${kind}`);
    for(const bone of [upper,lower]) bone.userData.aimScratch={start:new THREE.Vector3(),from:new THREE.Vector3(),to:new THREE.Vector3(),world:new THREE.Quaternion(),delta:new THREE.Quaternion(),parent:new THREE.Quaternion()};
    const start=upper.getWorldPosition(new THREE.Vector3()), elbow=lower.getWorldPosition(new THREE.Vector3()), foot=end.getWorldPosition(new THREE.Vector3());
    chains.push({kind,suffix,upper,lower,end,a:start.distanceTo(elbow),b:elbow.distanceTo(foot),target:avatar.worldToLocal(foot.clone()),
      scratch:Object.fromEntries(['start','direction','bend','elbow','reachable','temp','target','hint'].map(name=>[name,new THREE.Vector3()])),
      worldRotation:new THREE.Quaternion(),parentRotation:new THREE.Quaternion(),
      endRotation:end.getWorldQuaternion(new THREE.Quaternion()),rest:[upper,lower,end].map(b=>({b,position:b.position.clone(),quaternion:b.quaternion.clone(),scale:b.scale.clone()}))});
  }
  const weights=Object.fromEntries(loops.map(n=>[n,n==='SurfIdle'?1:0]));
  const eventWeights=Object.fromEntries(events.map(name=>[name,0]));
  function reset(phase=0) {
    for(const name of events)eventWeights[name]=0;
    for(const name of loops) {weights[name]=name==='SurfIdle'?1:0; actions[name].reset().setEffectiveWeight(weights[name]).play();}
    for(const name of events){actions[name].reset().setEffectiveWeight(0).play();actions[name].paused=true;}
    if(chest)chest.quaternion.copy(chestPose);
    if(hips)hips.quaternion.copy(hipsPose);
    if(head)head.quaternion.copy(headPose);
    mixer.setTime(0);
    if(chest)chestPose.copy(chest.quaternion);
    if(hips)hipsPose.copy(hips.quaternion);
    if(head)headPose.copy(head.quaternion);
    for(const name of loops) actions[name].time=phase%actions[name].getClip().duration;
  }
  function update(dt, state={}, net=null, motion=null) {
    if(chest)chest.quaternion.copy(chestPose);
    if(hips)hips.quaternion.copy(hipsPose);
    if(head)head.quaternion.copy(headPose);
    const turn=THREE.MathUtils.clamp(state.turn||0,-1,1);
    const air=state.jump>0?.9:0;
    const desired={TurnLeft:Math.max(0,-turn)*.8*(1-air),TurnRight:Math.max(0,turn)*.8*(1-air),Boost:state.boosting?.85*(1-air):0,Jump:air};
    const sum=Object.values(desired).reduce((a,b)=>a+b,0); desired.SurfIdle=Math.max(.05,1-sum);
    let total=0;
    for(const name of loops) {weights[name]=THREE.MathUtils.damp(weights[name],desired[name],10,dt);total+=weights[name];}
    let eventTotal=0;
    for(const [name,key,duration] of eventSpecs) {
      // Sample the authored clip at the actual gameplay phase, including skipped draw frames.
      const remaining=state[key]||0,progress=THREE.MathUtils.clamp(1-remaining/duration,0,1);
      if(dt>0){
        actions[name].time=progress*actions[name].getClip().duration;
        eventWeights[name]=THREE.MathUtils.damp(eventWeights[name],remaining>0?Math.sin(progress*Math.PI)*.65:0,18,dt);
      }
      actions[name].paused=true;
      eventTotal+=eventWeights[name];
    }
    const base=1/(1+eventTotal);
    for(const name of loops) actions[name].setEffectiveWeight(weights[name]/total*base);
    for(const name of events)actions[name].setEffectiveWeight(eventWeights[name]*base);
    mixer.update(dt);
    // Counterbalance above the hips so feet keep their targets on the board.
    const holdingSide=Math.cos((state.netAngle||0)/NET_LEFT_ANGLE*Math.PI);
    // The model faces -Z: turning toward its right (+X) requires negative yaw.
    if(hips){hipsPose.copy(hips.quaternion);hips.rotation.y-=alignedGrip?.32:holdingSide*.12;}
    if(chest){chestPose.copy(chest.quaternion);chest.rotation.z+=(motion?.lean??turn*.08)+holdingSide*.045;chest.rotation.y+=alignedGrip?(.19-holdingSide*.41):(-holdingSide*.22);chest.rotation.y-=(motion?.look||0)*.15;chest.rotation.x-=.16+(motion?.transfer||0)*.045;}
    if(head){headPose.copy(head.quaternion);head.rotation.y-=holdingSide*.16+(motion?.look||0)*.23;}
    for(const chain of chains) for(const rest of chain.rest) {rest.b.position.copy(rest.position);rest.b.quaternion.copy(rest.quaternion);rest.b.scale.copy(rest.scale);}
    avatar.updateWorldMatrix(true,true);
    for(const chain of chains) {
      const side=chain.suffix==='L'?-1:1;
      let target,hint;
      if(chain.kind==='leg') {
        target=avatar.localToWorld(chain.scratch.target.copy(chain.target));
        hint=alignedGrip?chain.scratch.hint.set(.85+side*.08,.05,-.40).transformDirection(avatar.matrixWorld):chain.scratch.hint.set(side*.15,.05,side<0?-1:1).transformDirection(avatar.matrixWorld);
      } else {
        const grip=netHandGrip(chain.suffix,state.netAngle||0,chain.scratch.target);
        target=net ? net.localToWorld(grip) : avatar.localToWorld(grip);
        hint=chain.scratch.hint.set(side,-.5,.4).transformDirection(avatar.matrixWorld);
      }
      solveChain(chain,target,hint,chain.kind==='arm');
      if(chain.kind==='leg') {
        const world=avatar.getWorldQuaternion(chain.worldRotation).multiply(chain.endRotation);
        chain.end.quaternion.copy(chain.end.parent.getWorldQuaternion(chain.parentRotation).invert().multiply(world));
      } else if(alignedGrip) {
        // Fingers were authored around game X. Align that grip frame with the
        // actual pole, including its pitch and its full right-to-left transfer.
        const world=(net||avatar).getWorldQuaternion(chain.worldRotation).multiply(poleFrame).multiply(chain.endRotation);
        chain.end.quaternion.copy(chain.end.parent.getWorldQuaternion(chain.parentRotation).invert().multiply(world));
      }
    }
    avatar.updateWorldMatrix(true,true);
  }
  function dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(avatar);
    const skeletons=new Set(); avatar.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);});
    for(const skeleton of skeletons) skeleton.dispose();
    for(const material of ownedMaterials) material.dispose();
  }
  reset();update(0);
  return {asset,avatar,mixer,actions,chains,update,reset,dispose,setHair,setAppearance};
}
