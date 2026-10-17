// Broad painted gradients and a restrained warm rim, retaining glTF colours,
// emissive finishes, skinning, instancing and the standard shadow pipeline.
import { SUN_DIRECTION } from './art-direction.js';
const configured=new WeakSet();
export function configureIllustratedMaterial(material,preset='scenery') {
  if(!material.isMeshStandardMaterial||configured.has(material))return material;
  configured.add(material);material.userData.compPaintPreset=preset;
  if(material.map&&material.alphaTest>0)material.alphaToCoverage=true;
  material.userData.compPainted=true;
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey();
  const actor=preset==='actor',equipment=preset==='equipment';
  const range=actor?3.2:equipment?1.6:9;
  const strength=actor?.08:equipment?.08:.20;
  const rim=material.metalness>.4?.045:actor?.32:.10;
  const lift=actor?(['Skin','Cheeks'].includes(material.name)?.18:material.name.startsWith('Hair-')?.10:.02):0;
  const grouping=material.metalness>.4?0:actor?.40:equipment?.18:.28;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms.uPaintRange={value:range};shader.uniforms.uPaintStrength={value:strength};shader.uniforms.uPaintRim={value:rim};shader.uniforms.uPaintLift={value:lift};
    shader.uniforms.uPaintGrouping={value:grouping};shader.uniforms.uPaintSun={value:{x:SUN_DIRECTION[0],y:SUN_DIRECTION[1],z:SUN_DIRECTION[2]}};
    shader.vertexShader=`varying vec3 vPaintPosition;\n${shader.vertexShader}`.replace('#include <project_vertex>',`
      vec4 paintVertex=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        paintVertex=instanceMatrix*paintVertex;
      #endif
      vPaintPosition=(modelMatrix*paintVertex).xyz;
      #include <project_vertex>
    `);
    shader.fragmentShader=`varying vec3 vPaintPosition;uniform float uPaintRange;uniform float uPaintStrength;uniform float uPaintRim;uniform float uPaintLift;uniform float uPaintGrouping;uniform vec3 uPaintSun;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        float paintHeight=smoothstep(0.,uPaintRange,vPaintPosition.y);
        float paintBrush=sin(vPaintPosition.x*1.17+vPaintPosition.z*.73)*sin(vPaintPosition.y*2.1+vPaintPosition.z*.41);
        diffuseColor.rgb*=mix(1.-uPaintStrength,1.+uPaintStrength*.4,paintHeight)+paintBrush*uPaintStrength*.045;
      `).replace('#include <opaque_fragment>',`
        vec3 paintDiffuse=reflectedLight.directDiffuse+reflectedLight.indirectDiffuse;
        float paintIrradiance=dot(paintDiffuse,vec3(.2126,.7152,.0722))/max(.015,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
        float paintValue=.42+.44*smoothstep(.22,.82,paintIrradiance)+.14*smoothstep(.82,1.35,paintIrradiance);
        vec3 paintTint=mix(vec3(${actor?'.96,.84,.80':'.78,.90,1.04'}),vec3(1.12,.98,.78),smoothstep(.28,1.10,paintIrradiance));
        vec3 paintGrouped=diffuseColor.rgb*paintTint*paintValue+reflectedLight.directSpecular+reflectedLight.indirectSpecular+totalEmissiveRadiance;
        outgoingLight=mix(outgoingLight,paintGrouped,uPaintGrouping);
        float paintEdge=pow(1.-max(dot(normal,normalize(vViewPosition)),0.),3.);
        float paintSunFacing=smoothstep(-.15,.60,dot(normal,normalize(mat3(viewMatrix)*uPaintSun)));
        outgoingLight+=diffuseColor.rgb*uPaintLift;
        outgoingLight+=diffuseColor.rgb*vec3(2.0,.90,.32)*paintEdge*paintSunFacing*uPaintRim;
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=>`${cache}|compunube-painted-v2-value-groups|${preset}`;
  return material;
}

// Scenery geometry remains shared. This binding owns only its material copies
// and restores them when disposed, including repeated instances of one asset.
export function createIllustratedBinding(root,preset='scenery') {
  const meshes=[],copies=new Map();
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.material?.isMeshStandardMaterial||mesh.name==='LagoonWater')return;
    const original=mesh.material;
    if(!copies.has(original))copies.set(original,configureIllustratedMaterial(original.clone(),preset));
    meshes.push({mesh,original,painted:copies.get(original)});
  });
  function enable(value=true){for(const entry of meshes)entry.mesh.material=value?entry.painted:entry.original;}
  enable();
  return {enable,dispose(){enable(false);for(const material of copies.values())material.dispose();copies.clear();},get count(){return copies.size;}};
}
