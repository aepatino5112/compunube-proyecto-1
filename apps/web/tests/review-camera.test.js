import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';
import { CHARACTERS } from '../dist/appearance.js';
import { createSurferAnimation } from '../dist/surfer-animation.js';
import { createEquipmentKit } from '../dist/equipment.js';
import { NET_LEFT_ANGLE } from '../dist/mechanics.js';
import { applyNetPose,BOARD_WATERLINE_OFFSET } from '../dist/surf-motion.js';
import { sampleWater } from '../dist/water-surface.js';
import { createReviewCameraFit } from '../dist/review-camera.js';

async function load(name){
  const bytes=await readFile(new URL(`../dist/assets/${name}.glb`,import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}

test('the motion viewer contains the actual posed character, board and tool in rear/front/side views, including a jump on a narrow pane',async()=>{
  const [board,base,wide,...characters]=await Promise.all(['board-coral','net-red-base','net-red-sol',...CHARACTERS.map(character=>`surfer-${character.id}`)].map(load));
  const kit=createEquipmentKit({coral:board,'red-base':base,'red-sol':wide});
  const camera=new THREE.PerspectiveCamera(36,1,.1,50),fit=createReviewCameraFit(camera),vertex=new THREE.Vector3();
  for(const [index,character] of CHARACTERS.entries())for(const netId of ['red-base','red-sol']){
    const root=new THREE.Group(),net=kit.net(netId),board=kit.board();
    const actor=createSurferAnimation(characters[index],'#ef795e',character.hair,{...character,character:character.id});
    root.add(board,actor.avatar,net.group);
    for(const state of [{jump:1.1,netAngle:0},{netAngle:NET_LEFT_ANGLE*.5},{netAngle:NET_LEFT_ANGLE,catchTimer:.4}]){
      root.position.set(.3,sampleWater(.3,-3.2,1).height+BOARD_WATERLINE_OFFSET+(state.jump||0),-3.2);root.rotation.set(-.06,.08,-.12);
      actor.reset();applyNetPose(net.group,state.netAngle,{netPitch:state.catchTimer?.45:.1,netHeight:.22});
      for(let i=0;i<35;i++)actor.update(1/60,state,net.group);
      for(const aspect of [16/9,607/520,390/772])for(const view of ['rear','front','side']){
        camera.aspect=aspect;camera.updateProjectionMatrix();fit(root,view);
        root.traverseVisible(mesh=>{
          if(!mesh.isMesh)return;if(mesh.isSkinnedMesh)mesh.skeleton.update();
          for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
            mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld).project(camera);
            assert.ok(Math.abs(vertex.x)<.92&&Math.abs(vertex.y)<.92&&vertex.z>-1&&vertex.z<1,`${character.id}/${netId}/${view}/${aspect}: ${mesh.name} cropped`);
          }
        });
      }
    }
    actor.dispose();kit.dispose(board);kit.dispose(net.group);
  }
});
