import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { CHARACTERS } from '../dist/appearance.js';
import { BOARD_WATERLINE_OFFSET } from '../dist/surf-motion.js';

async function load(name){
  const bytes=await readFile(new URL(`../dist/assets/${name}.glb`,import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
const boards=Object.fromEntries(await Promise.all(['coral','manglar','sol'].map(async id=>[id,(await load(`board-${id}`)).scene])));
const characters=await Promise.all(CHARACTERS.map(character=>load(`surfer-${character.id}`)));

test('all three actual hulls meet the water instead of hovering over it',()=>{
  const ray=new THREE.Raycaster(new THREE.Vector3(0,-2,0),new THREE.Vector3(0,1,0));
  for(const [id,board] of Object.entries(boards)){
    board.updateMatrixWorld(true);
    const hull=[];board.traverse(mesh=>{if(mesh.isMesh&&mesh.material.name==='BoardColor')hull.push(mesh);});
    const hits=ray.intersectObjects(hull,true);assert.ok(hits.length,`${id}: missing central hull`);
    const clearance=hits[0].point.y+BOARD_WATERLINE_OFFSET;
    assert.ok(clearance>=-.001&&clearance<.025,`${id}: central hull ${clearance}m from water`);
  }
});

test('all deck artwork remains inside the real board and just above its surface',()=>{
  const ray=new THREE.Raycaster(),point=new THREE.Vector3(),direction=new THREE.Vector3(0,-1,0);
  for(const [id,board] of Object.entries(boards)){
    board.updateMatrixWorld(true);let deck;board.traverse(mesh=>{if(mesh.isMesh&&mesh.material.name==='BoardColor')deck=mesh;});
    const artwork=board.getObjectByName(`DeckArtwork-${id}`);
    assert.ok(artwork,`${id}: inspect the actual deck inlays`);let checked=0;
    artwork.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const positions=mesh.geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++){
        point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
        ray.set(new THREE.Vector3(point.x,2,point.z),direction);
        const hits=ray.intersectObject(deck,true);
        assert.ok(hits.length,`${id}: artwork falls outside the board`);
        const clearance=point.y-hits[0].point.y;
        assert.ok(clearance>.001&&clearance<.002,`${id}: artwork is buried in, or floating above, the deck (${clearance})`);
        checked++;
      }
    });
    assert.ok(checked>100);
  }
});

test('the complete board, including its pad and graphics, does not cut through the four characters soles',()=>{
  const ray=new THREE.Raycaster(),vertex=new THREE.Vector3(),direction=new THREE.Vector3(0,-1,0);
  for(const [id,board] of Object.entries(boards)){
    board.updateMatrixWorld(true);let checked=0;
    for(const source of characters){
      source.scene.updateMatrixWorld(true);const mesh=source.scene.getObjectByName('Skin');mesh.skeleton.update();
      for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
        mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);
        if(vertex.y<.29||vertex.y>.315)continue;
        ray.set(new THREE.Vector3(vertex.x,1,vertex.z),direction);
        const hits=ray.intersectObject(board,true);
        assert.ok(hits.length,`${id}: missing support under the sole`);
        assert.ok(hits[0].point.y<=vertex.y+.0005,`${id}: raised decoration or traction pad cuts into the foot`);
        checked++;
      }
    }
    assert.ok(checked>100);
  }
});
