import { WATER_GLSL,WATER_AMPLITUDE } from './water-surface.js';
import { ART_PALETTES,SUN_DIRECTION } from './art-direction.js';

const PAINT_NOISE=`
float paintHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float paintNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(paintHash(i),paintHash(i+vec2(1.,0.)),f.x),mix(paintHash(i+vec2(0.,1.)),paintHash(i+vec2(1.,1.)),f.x),f.y);
}
`;

export function createIllustratedWater(THREE,parent,delta=false){
  const palette=ART_PALETTES[delta?'orinoco':'maracaibo'];
  const time={value:0},deep={value:new THREE.Color(palette.deep)},shallow={value:new THREE.Color(palette.shallow)};
  const geometry=new THREE.PlaneGeometry(1000,2400,64,180);geometry.rotateX(-Math.PI/2);
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.65,metalness:0});
  material.envMapIntensity=0;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{uWaterTime:time,uDeep:deep,uShallow:shallow});
    shader.vertexShader=`uniform float uWaterTime;varying vec2 vWater;${WATER_GLSL}\n${shader.vertexShader}`.replace('#include <begin_vertex>',`
      vec3 transformed=vec3(position);vWater=vec2(position.x,position.z-700.);
      transformed.y+=waterHeight(vWater,uWaterTime);
    `);
    shader.fragmentShader=`uniform float uWaterTime;uniform vec3 uDeep;uniform vec3 uShallow;varying vec2 vWater;${WATER_GLSL}\n${PAINT_NOISE}\n${shader.fragmentShader}`
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        vec2 drift=vec2(uWaterTime*.06,-uWaterTime*.20);
        vec2 warp=vec2(paintNoise(vWater*.13+drift),paintNoise(vWater*.19-drift));
        vec2 strokes=vWater*vec2(.38,1.25)+warp*1.35+drift;
        float pigmentField=paintNoise(strokes);
        float detail=paintNoise(strokes*2.2+vec2(3.7,9.2));
        float shore=smoothstep(13.,37.,abs(vWater.x));
        float pigment=.18+smoothstep(.28,.75,pigmentField)*.27+shore*.25;
        vec3 paintedBase=mix(uDeep*.90,uShallow,pigment);
        float lightStroke=smoothstep(.67,.84,detail)*smoothstep(.36,.68,pigmentField);
        paintedBase=mix(paintedBase,uShallow*1.26,lightStroke*.27);
        diffuseColor.rgb*=paintedBase;
      `).replace('#include <normal_fragment_begin>',`
        #include <normal_fragment_begin>
        vec2 slopes=waterSlope(vWater,uWaterTime);
        normal=normalize(mat3(viewMatrix)*vec3(-slopes.x*2.8,1.,-slopes.y*2.8));
      `).replace('#include <opaque_fragment>',`
        outgoingLight-=reflectedLight.directSpecular+reflectedLight.indirectSpecular;
        // Retain lit volume/shadows while keeping deliberate broad pigments.
        outgoingLight=mix(outgoingLight,diffuseColor.rgb*.88,.22);
        vec3 eye=normalize(cameraPosition-vec3(vWater.x,-.15+waterHeight(vWater,uWaterTime),vWater.y));
        vec3 halfSun=normalize(normalize(vec3(${SUN_DIRECTION.join(',')}))+eye);
        vec3 glintNormal=normalize(vec3(-slopes.x*2.8,1.,-slopes.y*2.8));
        float sunDot=max(dot(glintNormal,halfSun),0.);
        float fleck=paintNoise(vWater*vec2(2.1,3.8)+warp*2.4+drift);
        float glint=smoothstep(.48,.82,fleck)*pow(sunDot,75.);
        // Broad horizontal strokes follow the projected solar direction. This
        // is a painted reflection, alongside the physically aligned fine glints.
        float forwardDistance=max(0.,cameraPosition.z-vWater.y);
        float reflectionWidth=1.5+forwardDistance*.012;
        float reflectionCenter=cameraPosition.x+forwardDistance*${SUN_DIRECTION[0]/-SUN_DIRECTION[2]};
        float reflectionShift=(paintNoise(vec2(vWater.y*.35,uWaterTime*.10))*2.-1.)*reflectionWidth*.35;
        float reflectionLane=1.-smoothstep(reflectionWidth*.50,reflectionWidth*1.08,abs(vWater.x-reflectionCenter+reflectionShift));
        float reflectionBrush=paintNoise(vWater*vec2(.8,3.1)+warp*1.2+drift);
        float reflectionBreak=paintNoise(vWater*vec2(2.7,4.8)-drift);
        float nearFade=smoothstep(5.,25.,forwardDistance);
        float paintedGlint=reflectionLane*smoothstep(.48,.72,reflectionBrush)*smoothstep(.25,.7,reflectionBreak)*(.35+pow(sunDot,14.)*.40)*nearFade;
        glint=max(glint*.60,paintedGlint*.85);
        outgoingLight=mix(outgoingLight,vec3(2.2,1.48,.38),glint*.72);
        outgoingLight+=vec3(1.0,.53,.10)*pow(sunDot,18.)*.018;
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=> 'compunube-illustrated-water-v2-strokes';
  const water=new THREE.Mesh(geometry,material);water.name='LagoonWater';water.position.set(0,-.15,-700);
  geometry.computeBoundingBox();geometry.boundingBox.min.y-=WATER_AMPLITUDE;geometry.boundingBox.max.y+=WATER_AMPLITUDE;
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=WATER_AMPLITUDE;parent.add(water);
  return {water,time};
}
