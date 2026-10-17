import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { decodePNG,loadGLBFixture } from './helpers/gltf-fixture.js';
import { createIllustratedBinding } from '../dist/illustrated-materials.js';
import { markAmbientOccluders } from '../dist/illustrated-postprocessing.js';

test('the foliage atlas has four painted regions and real transparent space',async()=>{
  const png=decodePNG(await readFile(new URL('../art/textures/foliage-atlas-v1.png',import.meta.url)));
  assert.equal(png.width,png.height);assert.equal(png.width%2,0);
  const half=png.width/2;
  for(let tile=0;tile<4;tile++){
    let opaque=0,clear=0;
    for(let y=0;y<half;y++)for(let x=0;x<half;x++){
      const alpha=png.data[((y+Math.floor(tile/2)*half)*png.width+x+(tile%2)*half)*4+3];
      if(alpha>115)opaque++;if(alpha===0)clear++;
    }
    assert.ok(opaque>half*half*.15&&opaque<half*half*.90);
    assert.ok(clear>half*half*.08,'the texture must contain actual alpha, not a painted background');
  }
});

test('both exported banks contain one masked atlas batch with safe UV cells and shared resources',async()=>{
  for(const name of ['shore-study','shore-mangrove']){
    const asset=await loadGLBFixture(name),foliage=[];
    asset.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.name==='Study painted foliage')foliage.push(mesh);});
    assert.equal(foliage.length,1);
    const mesh=foliage[0],material=mesh.material;
    assert.ok(material.alphaTest>.4);assert.equal(material.transparent,false);assert.equal(material.side,THREE.DoubleSide);
    assert.ok(material.map.image.width>1&&material.map.image.data.some((value,i)=>i%4===3&&value===0));
    const uv=mesh.geometry.attributes.uv,cells=new Set(),index=mesh.geometry.index.array;
    assert.ok(uv.array.every(Number.isFinite));
    for(let i=0;i<index.length;i+=3){
      const faceCells=[];
      for(let j=0;j<3;j++){
        const u=uv.getX(index[i+j]),v=uv.getY(index[i+j]);
        assert.ok(u>0&&u<1&&v>0&&v<1);
        const cell=Math.floor(u*2)+2*Math.floor(v*2);cells.add(cell);faceCells.push(cell);
      }
      assert.equal(new Set(faceCells).size,1,'a curved card must not sample neighbouring atlas cells');
    }
    assert.equal(cells.size,4);
    const sourceGeometry=mesh.geometry,sourceMap=material.map,binding=createIllustratedBinding(asset.scene);
    assert.equal(mesh.geometry,sourceGeometry);assert.equal(mesh.material.map,sourceMap);assert.equal(mesh.material.alphaToCoverage,true);
    markAmbientOccluders(asset.scene);const depth=new THREE.Layers();depth.set(1);
    assert.equal(mesh.layers.test(depth),false,'masked foliage must not become solid quads in the generic normal prepass');
    binding.dispose();assert.equal(mesh.material,material);assert.equal(mesh.material.map,sourceMap);
  }
});
