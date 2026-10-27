import { WATER_GLSL, WATER_AMPLITUDE } from './water-surface.js';
import { createContactFoam } from './contact-foam.js';
import { ART_PALETTES, SUN_DIRECTION } from './art-direction.js';
import { createRockKit } from './rock-kit.js';
import { createIllustratedWater } from './illustrated-water.js';
import { createIllustratedBinding } from './illustrated-materials.js';
import { instanceScenery as instanceAsset } from './scenery-instancing.js';
import { createIllustratedShore } from './illustrated-shore.js';
import { createWaterGeometry, followWater, WATER_START_Z } from './water-geometry.js';
import { COURSE_LENGTH } from './maps.js';
// Decorative scenery uses its own deterministic variation, never the course RNG.
const variation = (index) => Math.sin(index * 12.9898 + 4.17) * .5 + .5;

function islandGeometry(THREE) {
  const positions=[0,.95,0], indices=[], segments=40;
  const rings=[[.34,.86],[.66,.50],[.89,.08],[1,-.12]];
  for(const [radius,height] of rings) for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2;
    const edge=1+.075*Math.sin(a*3)+.045*Math.cos(a*5)+.025*Math.sin(a*7);
    positions.push(Math.cos(a)*radius*edge,height,Math.sin(a)*radius*edge);
  }
  for(let i=0;i<segments;i++) indices.push(0,1+(i+1)%segments,1+i);
  for(let ring=0;ring<rings.length-1;ring++) for(let i=0;i<segments;i++) {
    const a=1+ring*segments+i,b=1+ring*segments+(i+1)%segments,c=a+segments,d=b+segments;
    indices.push(a,b,c,b,d,c);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createWater(THREE,parent,delta=false,look='classic') {
  if(look==='illustrated')return createIllustratedWater(THREE,parent,delta);
  const palette=ART_PALETTES[delta?'orinoco':'maracaibo'];
  const study=look==='study';
  const time={value:0}, shallow={value:new THREE.Color(study?0x54d1cb:palette.shallow)}, deep={value:new THREE.Color(study?0x1a8daa:palette.deep)};
  const geometry=createWaterGeometry(THREE);
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.36,metalness:0});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{uWaterTime:time,uShallow:shallow,uDeep:deep});
    shader.vertexShader=`uniform float uWaterTime; varying vec2 vWater; ${WATER_GLSL}
${shader.vertexShader}`.replace('#include <begin_vertex>',`
      vec3 transformed = vec3(position);
      vWater = vec2(position.x, position.z + modelMatrix[3].z);
      transformed.y += waterHeight(vWater,uWaterTime);
    `);
    shader.fragmentShader=`uniform float uWaterTime; uniform vec3 uShallow; uniform vec3 uDeep; varying vec2 vWater; ${WATER_GLSL}
${shader.fragmentShader}`.replace('#include <color_fragment>',`
      #include <color_fragment>
      float bank = smoothstep(18.0,65.0,abs(vWater.x));
      float band = sin(vWater.y*.045 + sin(vWater.x*.055))*.5+.5;
      ${study?'float paint=sin(vWater.x*.54+vWater.y*.32+sin(vWater.x*.23-vWater.y*.40)*1.4+uWaterTime*.16)*.5+.5;':''}
      diffuseColor.rgb *= mix(uDeep,uShallow,${study?'.10 + bank*.46 + smoothstep(.25,.8,paint)*.30':'.22 + bank*.55 + band*.065'});
      float ripple = sin(vWater.y*${study?'.40':'.66'} + sin(vWater.x*.21 + uWaterTime*.24)*2.0 - uWaterTime*1.15);
      float stroke = smoothstep(${study?'.84,.97':'.92,.985'},ripple);
      float broken = smoothstep(.35,.75,sin(vWater.x*.42 + vWater.y*.13 + uWaterTime*.25)*.5+.5);
      float swell = waterHeight(vWater,uWaterTime);
      diffuseColor.rgb *= .95 + swell*.48;
      diffuseColor.rgb = mix(diffuseColor.rgb, uShallow*1.3, stroke*broken*${study?'.29':'.18'});
    `).replace('#include <normal_fragment_begin>',`
      #include <normal_fragment_begin>
      vec2 slope=waterSlope(vWater,uWaterTime);
      // Exaggerated small ripples bring illustrated highlights into the foreground.
      slope+=vec2(.035*cos(vWater.x*.85+vWater.y*.48-uWaterTime*1.4),.025*cos(vWater.y*.95+vWater.x*.36-uWaterTime));
      normal=normalize(mat3(viewMatrix)*vec3(-slope.x*3.5,1.,-slope.y*3.5));
    `).replace('#include <opaque_fragment>',`
      vec2 solarSlope=waterSlope(vWater,uWaterTime);
      solarSlope+=vec2(.024*cos(vWater.x*.85+vWater.y*.48-uWaterTime*1.4),.018*cos(vWater.y*.95+vWater.x*.36-uWaterTime));
      vec3 solarNormal=normalize(vec3(-solarSlope.x*3.5,1.,-solarSlope.y*3.5));
      vec3 solarEye=normalize(cameraPosition-vec3(vWater.x,-.15+waterHeight(vWater,uWaterTime),vWater.y));
      vec3 solarHalf=normalize(normalize(vec3(${SUN_DIRECTION.join(',')}))+solarEye);
      float spec=max(dot(solarNormal,solarHalf),0.);
      float shimmer=.08+.92*smoothstep(.72,.95,sin(vWater.x*${study?'1.9':'2.7'}+vWater.y*${study?'1.3':'1.7'}+uWaterTime)*.5+.5);
      // Painted glints replace broad white specular glare that obscures pickups.
      outgoingLight-=reflectedLight.directSpecular+reflectedLight.indirectSpecular;
      outgoingLight+=vec3(1.,.72,.35)*(pow(spec,${study?'88.':'140.'})*shimmer*${study?'.56':'.36'}+pow(spec,14.)*${study?'.04':'.015'});
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> `compunube-cartoon-water-v3-sun-${look}`;
  const water=new THREE.Mesh(geometry,material); water.name='LagoonWater';water.position.set(0,-.15,WATER_START_Z);
  // Bounds include the shader displacement, so both cameras can cull safely.
  geometry.computeBoundingBox();geometry.boundingBox.min.y-=WATER_AMPLITUDE;geometry.boundingBox.max.y+=WATER_AMPLITUDE;
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=WATER_AMPLITUDE;parent.add(water);
  return {water,time};
}

export function createEnvironment(THREE,scene,{islands,palmAsset,mangroveAsset,houseAsset,boatAsset,treeAsset,rockAssets,shoreAssets,mapId='maracaibo'}) {
  const delta=mapId==='orinoco';
  const root=new THREE.Group();root.name=delta?'OrinocoScenery':'MaracaiboScenery';scene.add(root);
  const {water,time}=createWater(THREE,root,delta,'illustrated');
  if(!delta&&shoreAssets){
    const {shoreFoam,layout,setView,coast}=createIllustratedShore(THREE,root,{islands,shoreAssets,boatAsset,rockAssets});
    addAtmosphere(THREE,root,false);
    const illustrated=createIllustratedBinding(root);
    return {root,water,shoreFoam,illustrated,layout,update(visualTime,reducedMotion=false,viewZ){time.value=reducedMotion?0:visualTime;followWater(water,viewZ);shoreFoam.update(visualTime,reducedMotion);coast.update(visualTime,reducedMotion);setView(viewZ);}};
  }
  const geometry=islandGeometry(THREE),pose=new THREE.Object3D();
  const surface=(color)=>new THREE.MeshStandardMaterial({color,roughness:.95});
  const shore=new THREE.InstancedMesh(geometry,surface(delta?0xd0bb7b:0xf4dca7),islands.length);
  const grass=new THREE.InstancedMesh(geometry,surface(delta?0x70954e:0x7ba966),islands.length);
  const shallows=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color:delta?0xb6ba7d:0x93d9c8,transparent:true,opacity:.45,depthWrite:false}),islands.length);
  shore.name='Sandbanks';grass.name='GrassBanks';shallows.name='ShallowEdges';root.add(shore,grass,shallows);
  const palms=[],mangroves=[],houses=[],boats=[],stones=[],tufts=[],trees=[];
  const houseColors=[0xffbd87,0x91cbd1,0xe4bb73,0xb3cfa1];
  islands.forEach((island,i)=>{
    const {x,z,radius,side}=island;
    pose.position.set(x,-.35,z);pose.rotation.set(0,Math.sin(i)*.22,0);pose.scale.set(radius,1.35,radius*1.65);pose.updateMatrix();shore.setMatrixAt(i,pose.matrix);
    pose.position.y=.03;pose.scale.set(radius*1.16,.025,radius*1.90);pose.updateMatrix();shallows.setMatrixAt(i,pose.matrix);
    pose.position.set(x+side*1.5,.31,z-1);pose.scale.set(radius*.72,2.3,radius*1.21);pose.updateMatrix();grass.setMatrixAt(i,pose.matrix);
    for(let j=0;j<2;j++) palms.push({x:x+side*(j*3+1),y:1.2,z:z-5+j*10,scale:1.05+variation(i*7+j)*.4,angle:i*.7+j});
    for(let j=0;j<5;j++) {
      const a=(j/5)*Math.PI*2;
      mangroves.push({x:x+Math.cos(a)*radius*.87,y:.01,z:z+Math.sin(a)*radius*1.4,scale:.65+variation(i*13+j)*.35,angle:a});
      stones.push({x:x+Math.cos(a)*radius*.95,z:z+Math.sin(a)*radius*1.5,scale:.4+variation(i*5+j)*.4});
      tufts.push({x:x+Math.cos(a)*radius*.71,z:z+Math.sin(a)*radius*1.2,angle:a});
    }
    if(delta) for(let j=0;j<6;j++) {
      const a=j/6*Math.PI*2;
      trees.push({x:x+Math.cos(a)*radius*.45,y:1.1,z:z+Math.sin(a)*radius*.8,angle:a+i,scale:.9+variation(i*19+j)*.45});
    }
    if(i%3===0) {
      const angle=side>0?-Math.PI/2:Math.PI/2;
      if(!delta) houses.push({x:x-side*radius*.73,y:0,z:z+5,angle,scale:1.25,color:houseColors[(i/3)%4]});
      boats.push({x:x-side*(radius*.75+6),y:.01,z:z+9,angle:angle+.3,scale:.9,color:houseColors[((i/3)+2)%4]});
    }
  });
  for(const batch of [shore,grass,shallows]) {batch.computeBoundingBox();batch.computeBoundingSphere();}
  const shoreFoam=createContactFoam(THREE,root,islands.length,delta?0xf2f1cd:0xe9ffed);
  shoreFoam.sync(islands.map((island,i)=>({x:island.x,z:island.z,rx:island.radius*1.13,rz:island.radius*1.65*1.13,angle:Math.sin(i)*.22,kind:1})));
  instanceAsset(THREE,palmAsset.scene,palms,root);
  instanceAsset(THREE,mangroveAsset.scene,mangroves,root);
  if(houses.length) instanceAsset(THREE,houseAsset.scene,houses,root);
  instanceAsset(THREE,boatAsset.scene,boats,root);
  if(delta && treeAsset) {
    // A second bank layer creates a continuous forest silhouette outside the lane.
    // Outer tree rows every 13 m, to about 100 m past the finish.
    for(let i=0,rows=Math.ceil((137+COURSE_LENGTH)/13);i<rows;i++) for(const side of [-1,1]) trees.push({x:side*(82+variation(i*11)*18),y:0,z:35-i*13,angle:i*.43,scale:1.5+variation(i*23)*.65});
    instanceAsset(THREE,treeAsset.scene,trees,root);
  }
  const rocks=createRockKit(THREE,root,rockAssets,stones.length);
  rocks.sync(stones.map((item,i)=>({...item,y:0,angle:i*.7})));
  // Low reed clumps add shore detail without new models or collision objects.
  const blade=new THREE.BufferGeometry();blade.setAttribute('position',new THREE.Float32BufferAttribute([-.12,0,0,.12,0,0,.08,1.25,0],3));blade.computeVertexNormals();
  const reeds=new THREE.InstancedMesh(blade,new THREE.MeshStandardMaterial({color:0x9eb85c,side:THREE.DoubleSide,roughness:1}),tufts.length*4);
  tufts.forEach((item,i)=>{for(let j=0;j<4;j++){pose.position.set(item.x+Math.sin(j)*.22,.5,item.z+Math.cos(j)*.22);pose.rotation.set(0,item.angle+j,.15*Math.sin(j));pose.scale.setScalar(.7+variation(i+j)*.5);pose.updateMatrix();reeds.setMatrixAt(i*4+j,pose.matrix);}});
  reeds.computeBoundingSphere();root.add(reeds);
  addAtmosphere(THREE,root,delta);
  const illustrated=createIllustratedBinding(root);
  return {root,water,shoreFoam,illustrated,update(visualTime,reducedMotion=false,viewZ){time.value=reducedMotion?0:visualTime;followWater(water,viewZ);shoreFoam.update(visualTime,reducedMotion);}};
}

function addAtmosphere(THREE,root,delta) {
  const pose=new THREE.Object3D();
  // Sparse broken rings reinforce the illustrated water near the racing canal.
  const count=Math.ceil((40+COURSE_LENGTH)/9.4);
  const ripples=new THREE.InstancedMesh(new THREE.TorusGeometry(1,.014,4,18,Math.PI*.75),new THREE.MeshBasicMaterial({color:delta?0xe3e6b3:0xc6f5de,transparent:true,opacity:.24,depthWrite:false}),count);
  for(let i=0;i<count;i++) {
    pose.position.set(Math.sin(i*31.7)*30,.015,20-i*9.4);pose.rotation.set(-Math.PI/2,0,Math.sin(i)*.2);pose.scale.set(1.2+i%4*.5,.45,1);pose.updateMatrix();ripples.setMatrixAt(i,pose.matrix);
  }
  ripples.computeBoundingSphere();root.add(ripples);
}
