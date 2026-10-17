import { WATER_GLSL, WATER_BASE, WATER_AMPLITUDE } from './water-surface.js';

// One shared batch follows the same water surface as boards and pickups.
export function createContactFoam(THREE,parent,capacity,color=0xf1fff0) {
  const geometry=new THREE.PlaneGeometry(2.5,2.5,8,8);geometry.rotateX(-Math.PI/2);
  const phase=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);
  const kind=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);
  geometry.setAttribute('aContactPhase',phase);geometry.setAttribute('aContactKind',kind);
  geometry.computeBoundingBox();
  geometry.boundingBox.min.y=WATER_BASE-WATER_AMPLITUDE;geometry.boundingBox.max.y=WATER_BASE+WATER_AMPLITUDE+.065;
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=Math.abs(WATER_BASE)+WATER_AMPLITUDE+.065;
  const time={value:0},material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uContactTime=time;
    shader.vertexShader=`uniform float uContactTime; attribute float aContactPhase; attribute float aContactKind; varying vec2 vContact; varying float vContactPhase; varying float vContactKind; ${WATER_GLSL}\n${shader.vertexShader}`
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvContact=position.xz;vContactPhase=aContactPhase;vContactKind=aContactKind;')
      .replace('#include <project_vertex>',`
        vec4 contactWorld=modelMatrix*instanceMatrix*vec4(transformed,1.);
        contactWorld.y=${WATER_BASE.toFixed(3)}+waterHeight(contactWorld.xz,uContactTime)+.06;
        vec4 mvPosition=viewMatrix*contactWorld;
        gl_Position=projectionMatrix*mvPosition;
      `);
    shader.fragmentShader=`uniform float uContactTime; varying vec2 vContact; varying float vContactPhase; varying float vContactKind;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>',`#include <color_fragment>
        float angle=atan(vContact.y,vContact.x);
        float shore=step(.5,vContactKind)*(1.-step(1.5,vContactKind));
        float outline=1.+shore*(.075*sin(angle*3.)+.045*cos(angle*5.)+.025*sin(angle*7.));
        float radius=length(vContact)/outline;
        float swell=sin(uContactTime*.9+vContactPhase+angle*3.)*.025;
        float inner=mix(.70,.82,shore)+swell;
        float edge=sin(angle*19.+vContactPhase)*.016+cos(angle*31.-vContactPhase)*.011;
        float band=smoothstep(inner+edge,inner+.055+edge,radius)*(1.-smoothstep(inner+.16+edge,inner+.27+edge,radius));
        float broken=.43+.57*smoothstep(-.5,.65,sin(angle*8.+vContactPhase+uContactTime*.45));
        float wash=.68+.22*sin(uContactTime*1.1+vContactPhase+radius*14.);
        diffuseColor.a*=band*broken*wash*mix(1.,.78,shore);
        if(diffuseColor.a<.015)discard;
      `);
  };
  material.customProgramCacheKey=()=> 'compunube-contact-foam-v2-painted';
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='ContactFoam';mesh.count=0;mesh.renderOrder=1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);parent.add(mesh);
  const pose=new THREE.Object3D();
  function sync(placements) {
    if(placements.length>capacity)throw Error('La espuma excede la capacidad del recorrido');
    placements.forEach((item,i)=>{
      pose.position.set(item.x,0,item.z);pose.rotation.set(0,item.angle||0,0);pose.scale.set(item.rx,1,item.rz);pose.updateMatrix();
      mesh.setMatrixAt(i,pose.matrix);phase.setX(i,i*2.39996);kind.setX(i,item.kind||0);
    });
    mesh.count=placements.length;mesh.instanceMatrix.needsUpdate=true;phase.needsUpdate=true;kind.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();
  }
  function update(visualTime,reduced=false){time.value=reduced?0:visualTime;}
  return {mesh,time,sync,update};
}
