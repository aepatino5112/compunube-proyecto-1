// Broad painted gradients and a restrained warm rim, retaining glTF colours,
// emissive finishes, skinning, instancing and the standard shadow pipeline.
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
  const rim=material.metalness>.4?.045:actor?.20:.10;
  const lift=actor?(['Skin','Cheeks'].includes(material.name)?.16:material.name.startsWith('Hair-')?.12:.02):0;
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms.uPaintRange={value:range};shader.uniforms.uPaintStrength={value:strength};shader.uniforms.uPaintRim={value:rim};shader.uniforms.uPaintLift={value:lift};
    shader.vertexShader=`varying vec3 vPaintPosition;\n${shader.vertexShader}`.replace('#include <project_vertex>',`
      vec4 paintVertex=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        paintVertex=instanceMatrix*paintVertex;
      #endif
      vPaintPosition=(modelMatrix*paintVertex).xyz;
      #include <project_vertex>
    `);
    shader.fragmentShader=`varying vec3 vPaintPosition;uniform float uPaintRange;uniform float uPaintStrength;uniform float uPaintRim;uniform float uPaintLift;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        float paintHeight=smoothstep(0.,uPaintRange,vPaintPosition.y);
        float paintBrush=sin(vPaintPosition.x*1.17+vPaintPosition.z*.73)*sin(vPaintPosition.y*2.1+vPaintPosition.z*.41);
        diffuseColor.rgb*=mix(1.-uPaintStrength,1.+uPaintStrength*.4,paintHeight)+paintBrush*uPaintStrength*.045;
      `).replace('#include <opaque_fragment>',`
        float paintEdge=pow(1.-max(dot(normal,normalize(vViewPosition)),0.),3.);
        outgoingLight+=diffuseColor.rgb*uPaintLift;
        outgoingLight+=diffuseColor.rgb*vec3(1.35,.88,.45)*paintEdge*uPaintRim;
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=>`${cache}|compunube-painted-v1|${preset}`;
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
