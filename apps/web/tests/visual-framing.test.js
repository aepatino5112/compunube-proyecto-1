import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { composeSurfCamera } from '../dist/art-direction.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';
import { applyNetPose,BOARD_WATERLINE_OFFSET } from '../dist/surf-motion.js';
import { WATER_BASE,WATER_AMPLITUDE } from '../dist/water-surface.js';
import { createSurferAnimation } from '../dist/surfer-animation.js';
import { createEquipmentKit } from '../dist/equipment.js';
import { CHARACTERS } from '../dist/appearance.js';
import { markAmbientOccluders } from '../dist/illustrated-postprocessing.js';

async function load(name){
  const bytes=await readFile(new URL(`../dist/assets/${name}.glb`,import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}

test('all four real club characters and raised net fit the race camera on both sides at desktop and portrait sizes',async()=>{
  const [board,netAsset,...sources]=await Promise.all(['board-coral','net-red-base',...CHARACTERS.map(character=>`surfer-${character.id}`)].map(load));
  const kit=createEquipmentKit({coral:board,'red-base':netAsset});
  for(const [index,character] of CHARACTERS.entries()){
  const net=kit.net(),actor=createSurferAnimation(sources[index],'#ef795e',character.hair,{...character,character:character.id});
  const root=new THREE.Group();root.add(actor.avatar,kit.board(),net.group);
  const position=new THREE.Vector3(),look=new THREE.Vector3(),vertex=new THREE.Vector3();
  for(const aspect of [16/9,2.1,390/772])for(const x of [-15,0,15])for(const side of [0,NET_LEFT_ANGLE])for(const height of [0,1.1])for(const lag of [-1,0,1]){
    const camera=new THREE.PerspectiveCamera(48,aspect,.1,1100),state={x,z:-450,netAngle:side,jump:height,turn:0};
    // Lowest trough while planted, highest crest at the jump apex.
    root.position.set(x,WATER_BASE+(height?WATER_AMPLITUDE:-WATER_AMPLITUDE)+BOARD_WATERLINE_OFFSET+height,-450);applyNetPose(net.group,side);
    actor.reset();for(let frame=0;frame<30;frame++)actor.update(1/60,state,net.group);
    root.updateMatrixWorld(true);
    composeSurfCamera(aspect,x,state.z,position,look,Math.cos(side/NET_LEFT_ANGLE*Math.PI));
    camera.position.copy(position);camera.position.x+=lag*(aspect<.85?.25:.5);camera.lookAt(look);camera.updateMatrixWorld(true);
    root.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      if(mesh.isSkinnedMesh)mesh.skeleton.update();
      for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
        mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld).project(camera);
        assert.ok(Math.abs(vertex.x)<1&&Math.abs(vertex.y)<1&&vertex.z>-1&&vertex.z<1,`${mesh.name} clips at aspect ${aspect}, side ${side}, jump ${height}: ${vertex.toArray()}`);
      }
    });
  }
  actor.dispose();kit.dispose(net.group);
  }
});

test('AO depth excludes translucent cues, skies and animated water without removing them from colour rendering',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry();
  const body=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()),water=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
  const cue=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({transparent:true})),cloud=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  scene.add(body,water,cue,cloud);markAmbientOccluders(scene,[water]);
  const colour=new THREE.Layers(),depth=new THREE.Layers();depth.set(1);
  assert.ok(body.layers.test(depth));
  for(const mesh of [water,cue,cloud]){assert.equal(mesh.layers.test(depth),false);assert.ok(mesh.layers.test(colour));assert.equal(mesh.visible,true);}
  body.material.transparent=true;markAmbientOccluders(body);assert.equal(body.layers.test(depth),false);
});
