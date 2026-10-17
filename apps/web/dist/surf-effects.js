import { sampleWater } from './water-surface.js';
import { createContactFoam } from './contact-foam.js';
import { sampleBoardPoint } from './surf-motion.js';

export function createBoardContactFoam(THREE,scene,capacity) {
  const foam=createContactFoam(THREE,scene,capacity,0xf8fff7),contacts=[];
  const entries=Array.from({length:capacity},()=>({x:0,z:0,rx:.82,rz:2.18,angle:0,kind:0}));
  foam.mesh.name='BoardContactFoam';
  function update(racers,time,reduced=false) {
    if(racers.length>capacity)throw Error('La espuma excede el número de surfistas');
    contacts.length=0;
    for(let i=0;i<racers.length;i++){
      const racer=racers[i];
      if(racer.speed<=2||racer.jump>=.18||racer.disqualified||racer.finishTime!=null)continue;
      const entry=entries[i];entry.x=racer.x;entry.z=racer.z;entry.angle=racer.group?.rotation.y||0;contacts.push(entry);
    }
    foam.sync(contacts);foam.update(time,reduced);
  }
  return {mesh:foam.mesh,time:foam.time,update,reset(){contacts.length=0;foam.sync(contacts);}};
}

export const MATERIAL_SIGNALS=Object.freeze({plastic:{color:0x59d6ff,label:'Plástico'},metal:{color:0xffae69,label:'Chatarra'}});

export function createLandingRipple(THREE,scene) {
  const mesh=new THREE.Mesh(new THREE.RingGeometry(.85,1,32),new THREE.MeshBasicMaterial({color:0xf3ffdf,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;mesh.visible=false;scene.add(mesh);
  let x=0,z=0;const surface={};
  function trigger(contactX,contactZ){x=contactX;z=contactZ;}
  function update(timer,time,disqualified=false){
    mesh.visible=timer>0&&!disqualified;if(!mesh.visible)return;
    mesh.position.set(x,sampleWater(x,z,time,surface).height+.032,z);
    mesh.scale.setScalar(1+(1-timer/.55)*2.8);mesh.material.opacity=timer*.65;
  }
  function reset(){mesh.visible=false;mesh.material.opacity=0;x=0;z=0;}
  return {mesh,trigger,update,reset};
}

export function createPickupEffects(THREE) {
  const geometry=new THREE.PlaneGeometry(3.4,3.4);geometry.rotateX(-Math.PI/2);
  const materials={};
  for(const [type,signal] of Object.entries(MATERIAL_SIGNALS)) {
    const material=new THREE.MeshBasicMaterial({color:signal.color,transparent:true,opacity:.85,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
    // A diffuse pool of light, with a soft rim. No light per pickup or full-screen bloom.
    material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vPickupUV;')
        .replace('#include <color_fragment>',`#include <color_fragment>
          float radius=length(vPickupUV-.5)*2.;
          float glow=pow(max(0.,1.-radius),1.4)*.70;
          float rim=(smoothstep(.64,.74,radius)-smoothstep(.77,.94,radius))*.56;
          diffuseColor.a*=glow+rim;
          if(diffuseColor.a<.008)discard;
        `);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vPickupUV;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvPickupUV=uv;');
    };
    material.customProgramCacheKey=()=> 'compunube-pickup-glow-v1';materials[type]=material;
  }
  const ringGeometry=new THREE.RingGeometry(.99,1.035,48);ringGeometry.rotateX(-Math.PI/2);
  const bursts=Array.from({length:12},()=>{
    const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(ringGeometry,material);mesh.visible=false;return {mesh,life:0,x:0,z:0};
  });let cursor=0;
  function burst(item,scene) {
    const p=bursts[cursor++%bursts.length];p.life=.5;p.x=item.x;p.z=item.z;
    p.mesh.material.color.set(MATERIAL_SIGNALS[item.signal.type].color);
    if(!p.mesh.parent)scene.add(p.mesh);p.mesh.visible=true;
  }
  function updateBursts(dt,time) {
    for(const p of bursts) {
      p.life=Math.max(0,p.life-dt);p.mesh.visible=p.life>0;
      if(!p.life)continue;
      const progress=1-p.life/.5;
      p.mesh.position.set(p.x,sampleWater(p.x,p.z,time,surface).height+.09,p.z);
      p.mesh.scale.setScalar(.65+progress*1.7);p.mesh.material.opacity=(1-progress)*.75;
    }
  }
  function reset(){for(const p of bursts){p.life=0;p.mesh.visible=false;}}
  function attach(group,kind) {
    const type=kind===1?'metal':'plastic';
    const halo=new THREE.Mesh(geometry,materials[type]);halo.name=`${type}-halo`;group.add(halo);
    // Dashed amber ring complements the colour difference; plastic has a continuous rim.
    const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:MATERIAL_SIGNALS[type].color,transparent:true,opacity:.6,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
    if(type==='metal') {
      ring.material.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vSignalXZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSignalXZ=position.xz;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vSignalXZ;').replace('#include <color_fragment>','#include <color_fragment>\nif(sin(atan(vSignalXZ.y,vSignalXZ.x)*6.)<0.)discard;');
      };ring.material.customProgramCacheKey=()=> 'compunube-metal-dashes-v1';
    }
    ring.name=`${type}-rim`;group.add(ring);
    return {halo,ring,type};
  }
  const surface={};
  function update(item,time,reduced=false) {
    sampleWater(item.x,item.z,time,surface);
    const {object,model,signal,phase,kind}=item;
    object.position.y=surface.height;
    // The cue stays on the water; only the physical waste rocks and bobs.
    model.position.y=(kind===2?.12:.22)+(reduced?0:Math.sin(time*1.65+phase)*.045);
    model.rotation.x=reduced?0:Math.sin(time*1.2+phase)*.10;
    model.rotation.z=reduced?0:Math.cos(time*1.45+phase)*.13;
    const pulse=reduced?1:1+Math.sin(time*1.8+phase)*.04;
    signal.halo.position.y=.10;signal.halo.scale.setScalar(pulse);
    signal.ring.position.y=.115;signal.ring.rotation.y=reduced?0:Math.sin(time*.45+phase)*.08;
  }
  return {attach,update,burst,updateBursts,reset};
}

// World-space history keeps foam behind the course actually travelled, including turns.
export function createWake(THREE,scene) {
  const capacity=46,stride=.45,lifetime=2.3;
  const samples=Array.from({length:capacity},()=>({x:0,z:0,time:-Infinity,turn:0,speed:0,distance:0,connected:false}));
  const positions=new Float32Array(capacity*2*3),alpha=new Float32Array(capacity*2),uv=new Float32Array(capacity*2*2),indices=new Uint16Array((capacity-1)*6);
  for(let i=0;i<capacity;i++) {
    uv.set([0,i/(capacity-1),1,i/(capacity-1)],i*4);
  }
  const geometry=new THREE.BufferGeometry();
  const attribute=new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage);
  const opacity=new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage);
  const uvAttribute=new THREE.BufferAttribute(uv,2).setUsage(THREE.DynamicDrawUsage);
  const indexAttribute=new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',attribute);geometry.setAttribute('aFoam',opacity);geometry.setAttribute('uv',uvAttribute);geometry.setIndex(indexAttribute);
  const material=new THREE.MeshBasicMaterial({color:0xfff4df,transparent:true,opacity:1,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
  const timeUniform={value:0};
  material.onBeforeCompile=shader=>{
    shader.uniforms.uFoamTime=timeUniform;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aFoam;varying float vFoam;varying vec2 vFoamUV;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvFoam=aFoam;vFoamUV=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uFoamTime;varying float vFoam;varying vec2 vFoamUV;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        float side=abs(vFoamUV.x-.5)*2.;
        float edgeCenter=.64+.08*sin(vFoamUV.y*73.+vFoamUV.x*5.)+.04*sin(vFoamUV.y*151.);
        float edges=1.-smoothstep(.065,.26,abs(side-edgeCenter));
        float broken=.68+.32*pow(sin(vFoamUV.y*110.+uFoamTime*.4+vFoamUV.x*12.)*.5+.5,2.);
        float flecks=smoothstep(.58,.83,sin(vFoamUV.y*97.+vFoamUV.x*27.)*sin(vFoamUV.y*153.-vFoamUV.x*19.)*.5+.5);
        float center=(1.-smoothstep(.15,.76,side))*(.20+flecks*.53);
        diffuseColor.a*=vFoam*(edges*broken+center);
        if(diffuseColor.a<.008)discard;
      `);
  };
  material.customProgramCacheKey=()=> 'compunube-wake-history-v2-painted';
  const root=new THREE.Group(),ribbon=new THREE.Mesh(geometry,material);root.name='SurfWake';ribbon.frustumCulled=false;root.add(ribbon);scene.add(root);
  let count=0,lastX=0,lastZ=0,distance=0,detached=true;
  const head={x:0,z:0,time:0,distance:0,speed:0};
  const surface={},stern={};
  function reset() {count=0;distance=0;detached=true;alpha.fill(0);opacity.needsUpdate=true;geometry.setDrawRange(0,0);root.visible=false;}
  function update(racer,time,active,reduced=false) {
    timeUniform.value=reduced?0:time;root.visible=count>1;
    if(active&&!racer.disqualified&&racer.finishTime==null&&racer.jump<.18&&racer.speed>2) {
      sampleBoardPoint(racer,0,1.65,stern);
      const {x,z}=stern;
      const travel=count?Math.hypot(x-lastX,z-lastZ):0;
      if(!count||travel>=stride||detached) {
        distance+=travel;
        for(let i=Math.min(count,capacity-1);i>0;i--)Object.assign(samples[i],samples[i-1]);
        Object.assign(samples[0],{x,z,time,turn:racer.turn,speed:racer.speed,distance,connected:count>0&&!detached&&travel<3});
        count=Math.min(count+1,capacity);lastX=x;lastZ=z;
      }
      Object.assign(head,{x,z,time,speed:racer.speed,distance:distance+Math.hypot(x-lastX,z-lastZ)});
      detached=false;
    } else if(active) {
      detached=true;
    }
    // The sampled ribbon remains in world space and conforms to the moving surface.
    for(let i=0;i<count;i++) {
      const p=i===0?head:samples[i];
      const older=i<count-1&&samples[i].connected?samples[i+1]:p;
      const newer=i>0&&samples[i-1].connected?(i===1?head:samples[i-1]):p;
      const dx=older.x-newer.x,dz=older.z-newer.z,length=Math.hypot(dx,dz)||1;
      const sideX=dz/length,sideZ=-dx/length;
      const age=Math.max(0,time-p.time),fade=Math.max(0,1-age/lifetime);
      const width=.65+age*(p.speed>19?1.5:1.15);
      uv[i*4+1]=uv[i*4+3]=p.distance*.035;
      for(let side=0;side<2;side++) {
        const x=p.x+sideX*width*(side?1:-1),z=p.z+sideZ*width*(side?1:-1);
        sampleWater(x,z,reduced?0:time,surface);
        const index=i*2+side;
        positions.set([x,surface.height+.032,z],index*3);
        alpha[index]=Math.pow(fade,1.25)*(i===count-1?0:1)*(p.speed>19?.98:.92)*(reduced?.65:1);
      }
    }
    let indexCount=0;
    for(let i=0;i<count-1;i++)if(samples[i].connected) {
      indices.set([i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2],indexCount);indexCount+=6;
    }
    geometry.setDrawRange(0,indexCount);attribute.needsUpdate=true;opacity.needsUpdate=true;uvAttribute.needsUpdate=true;indexAttribute.needsUpdate=true;
    root.visible=count>1;
  }
  reset();return {root,reset,update,geometry,samples,get count(){return count;}};
}
