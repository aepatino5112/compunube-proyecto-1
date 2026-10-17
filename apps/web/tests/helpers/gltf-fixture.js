// CPU-only PNG decoding for real textured GLBs in Node. Browser rendering still
// uses the unmodified GLTFLoader/ImageBitmapLoader and is checked separately.
import { readFile } from 'node:fs/promises';
import pngjs from '../vendor/pngjs/lib/png.js';
import * as THREE from '../../dist/vendor/three.module.js';
import { GLTFLoader } from '../../dist/vendor/addons/loaders/GLTFLoader.js';

export function decodePNG(bytes){return pngjs.PNG.sync.read(Buffer.from(bytes),{checkCRC:true});}

export async function loadGLBFixture(name) {
  const bytes=await readFile(new URL(`../../dist/assets/${name}.glb`,import.meta.url));
  const loader=new GLTFLoader();
  loader.register(parser=>({
    name:'CompunubeCPUTextureFixture',
    async loadTexture(index){
      const definition=parser.json.textures[index],image=parser.json.images[definition.source];
      if(image.mimeType!=='image/png'||image.bufferView===undefined)throw Error('The fixture expects embedded PNG textures');
      const raw=await parser.getDependency('bufferView',image.bufferView),png=decodePNG(raw);
      const texture=new THREE.DataTexture(png.data,png.width,png.height,THREE.RGBAFormat);
      texture.name=definition.name||image.name||'';texture.flipY=false;
      texture.userData.fixtureSourceBytes=raw.byteLength;texture.needsUpdate=true;
      return texture;
    },
  }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
