import { WATER_GLSL,WATER_BASE,WATER_AMPLITUDE } from './water-surface.js';

const edge=z=>27.8+1.6*Math.sin(z*.025)+.85*Math.cos(z*.047+.8);
const SEGMENTS=90,START=100,END=-1500;
// The narrow foam needs enough samples to follow the shortest water wave.
// The broader land keeps its original mesh and channel silhouette.
const FOAM_SEGMENTS=400,FOAM_LIFT=.032;

export function createCoastalRibbon(THREE,parent) {
  const positions=[],colors=[],indices=[];
  const profile=[[0,-.40,0x879367],[1.2,.06,0xd7b570],[6,.23,0xdcc079],[15,.48,0x9cb455],[140,1.0,0x618335]];
  for(const side of [-1,1]){
    const base=positions.length/3;
    for(let row=0;row<=SEGMENTS;row++){
      const z=START+(END-START)*row/SEGMENTS;
      for(const [offset,y,hex]of profile){
        positions.push(side*(edge(z)+offset),y,z);
        const color=new THREE.Color(hex);color.multiplyScalar(.95+.05*Math.sin(z*.042+offset*.2));colors.push(color.r,color.g,color.b);
      }
    }
    for(let row=0;row<SEGMENTS;row++)for(let column=0;column<profile.length-1;column++){
      const a=base+row*profile.length+column,b=a+1,c=a+profile.length,d=c+1;
      if(side<0)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const land=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1}));land.name='ContinuousCoast';parent.add(land);
  const plants=createGroundPlants(THREE,parent);
  const foamPositions=[],uvs=[],foamIndices=[];
  for(const side of [-1,1]){
    const base=foamPositions.length/3;
    for(let row=0;row<=FOAM_SEGMENTS;row++){
      const z=START+(END-START)*row/FOAM_SEGMENTS;
      for(const [column,offset]of [-.45,.9].entries()){
        foamPositions.push(side*(edge(z)+offset),0,z);uvs.push(column,z);
      }
    }
    for(let row=0;row<FOAM_SEGMENTS;row++){
      const a=base+row*2,b=a+1,c=a+2,d=a+3;foamIndices.push(a,b,c,b,d,c);
    }
  }
  const foamGeometry=new THREE.BufferGeometry();foamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(foamPositions,3));
  foamGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));foamGeometry.setIndex(foamIndices);foamGeometry.computeVertexNormals();
  foamGeometry.computeBoundingBox();foamGeometry.boundingBox.min.y=WATER_BASE+FOAM_LIFT-WATER_AMPLITUDE;foamGeometry.boundingBox.max.y=WATER_BASE+FOAM_LIFT+WATER_AMPLITUDE;
  foamGeometry.computeBoundingSphere();foamGeometry.boundingSphere.radius+=Math.abs(WATER_BASE+FOAM_LIFT)+WATER_AMPLITUDE;
  const time={value:0},material=new THREE.MeshBasicMaterial({color:0xeaffed,transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uCoastTime=time;
    shader.vertexShader=`uniform float uCoastTime;varying vec2 vCoastUv;${WATER_GLSL}\n${shader.vertexShader}`.replace('#include <begin_vertex>',`
      vec3 transformed=vec3(position);vCoastUv=uv;
      transformed.y=${WATER_BASE.toFixed(3)}+waterHeight(position.xz,uCoastTime)+${FOAM_LIFT.toFixed(3)};
    `);
    shader.fragmentShader=`uniform float uCoastTime;varying vec2 vCoastUv;\n${shader.fragmentShader}`.replace('#include <color_fragment>',`
      #include <color_fragment>
      float scallop=.10*sin(vCoastUv.y*1.3-uCoastTime*.6);
      float across=vCoastUv.x+scallop;
      float band=smoothstep(0.,.18,across)*(1.-smoothstep(.52,1.,across));
      float fleck=.35+.65*smoothstep(.15,.85,sin(vCoastUv.y*2.4+sin(vCoastUv.y*.31)+uCoastTime*.4)*.5+.5);
      diffuseColor.a*=band*fleck;
    `);
  };
  material.customProgramCacheKey=()=> 'compunube-coastal-foam-v2-water-contact';
  const foam=new THREE.Mesh(foamGeometry,material);foam.name='ContinuousCoastFoam';parent.add(foam);
  return {land,foam,plants,update(visualTime,reducedMotion=false){time.value=reducedMotion?0:visualTime;}};
}

function createGroundPlants(THREE,parent) {
  const positions=[],colors=[],indices=[];
  for(let leaf=0;leaf<7;leaf++){
    const angle=leaf*Math.PI*2/7,base=positions.length/3;
    for(let row=0;row<5;row++){
      const t=row/4,r=t*(.8+.15*Math.sin(leaf*1.9)),width=Math.max(.008,.19*Math.sin(t*Math.PI));
      const y=t*.40+.40*Math.sin(t*Math.PI);
      for(const side of [-1,0,1]){
        positions.push(Math.cos(angle)*r-Math.sin(angle)*width*side,y+(side===0?.065:0),Math.sin(angle)*r+Math.cos(angle)*width*side);
        const color=new THREE.Color(side===0?0xadc94e:leaf%2?0x699d30:0x82af37);color.multiplyScalar(.76+.24*t);colors.push(color.r,color.g,color.b);
      }
    }
    for(let row=0;row<4;row++)for(let side=0;side<2;side++){
      const a=base+row*3+side,b=a+1,c=a+3,d=c+1;indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const plants=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}),160);
  plants.name='CoastalGroundPlants';const pose=new THREE.Object3D();
  for(let i=0;i<160;i++){
    const side=i%2?1:-1,z=80-Math.floor(i/2)*14.8,offset=8.2+(Math.sin(i*7.1)*.5+.5)*7;
    pose.position.set(side*(edge(z)+offset),.23+(offset-6)*.027,z);
    pose.rotation.set(0,i*2.37,0);pose.scale.setScalar(.75+(Math.sin(i*2.9)*.5+.5)*.65);pose.updateMatrix();plants.setMatrixAt(i,pose.matrix);
  }
  plants.computeBoundingBox();plants.computeBoundingSphere();parent.add(plants);return plants;
}
