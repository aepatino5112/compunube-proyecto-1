import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import { createWaterGeometry } from '../dist/water-geometry.js';
import { createIllustratedWater } from '../dist/illustrated-water.js';
import { createWater } from '../dist/environment.js';
import { WATER_BASE,WATER_AMPLITUDE,WAVES,sampleWater } from '../dist/water-surface.js';

// Read the actual indexed faces. An analytic wave at a contact point is not
// what the GPU displays between the displaced vertices of that face.
function makeSurfaceSampler(geometry,offsetZ=-700) {
  const positions=geometry.attributes.position,index=geometry.index;
  const {widthSegments:gx,heightSegments:gz}=geometry.parameters,stride=gx+1;
  const xs=Array.from({length:stride},(_,i)=>positions.getX(i));
  const zStart=positions.getZ(0)+offsetZ,zEnd=positions.getZ(gz*stride)+offsetZ;
  function probe(x,z) {
    let low=0,high=gx;
    while(high-low>1){const mid=(low+high)>>1;if(xs[mid]<=x)low=mid;else high=mid;}
    const row=(z-zStart)/(zEnd-zStart)*gz,iz=Math.max(0,Math.min(gz-1,Math.floor(row)));
    const u=(x-xs[low])/(xs[low+1]-xs[low]),v=row-iz;
    const face=(iz*gx+low)*6+(u+v<=1?0:3);
    const a=index.getX(face),b=index.getX(face+1),c=index.getX(face+2);
    const ax=positions.getX(a),az=positions.getZ(a)+offsetZ,bx=positions.getX(b),bz=positions.getZ(b)+offsetZ,cx=positions.getX(c),cz=positions.getZ(c)+offsetZ;
    const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    const wa=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denominator;
    const wb=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denominator;
    return {a,b,c,wa,wb,wc:1-wa-wb,x,z};
  }
  const heights=new Float64Array(positions.count);
  function atTime(time) {
    for(let i=0;i<positions.count;i++)heights[i]=sampleWater(positions.getX(i),positions.getZ(i)+offsetZ,time).height;
  }
  function height(point){return point.wa*heights[point.a]+point.wb*heights[point.b]+point.wc*heights[point.c];}
  return {probe,atTime,height};
}

test('water concentrates a bounded mesh in the contact corridor while keeping the existing horizon',()=>{
  const geometry=createWaterGeometry(THREE),positions=geometry.attributes.position,index=geometry.index;
  geometry.computeBoundingBox();
  assert.equal(geometry.boundingBox.min.x,-500);assert.equal(geometry.boundingBox.max.x,500);
  assert.equal(geometry.boundingBox.min.z,-1200);assert.equal(geometry.boundingBox.max.z,1200);
  assert.ok(positions.count<=25000,'contact refinement must not densely tessellate the whole horizon');
  assert.ok(index.count/3<=50000,'water keeps a bounded vertex workload per camera');
  assert.ok(index.array.every(vertex=>vertex<positions.count));
  for(const attribute of ['position','normal','uv'])assert.ok(geometry.attributes[attribute].array.every(Number.isFinite));
  assert.ok(geometry.attributes.uv.array.every(value=>value>=0&&value<=1));
  const columns=geometry.parameters.widthSegments+1;
  for(let i=0;i<columns-1;i++)if(positions.getX(i)>=-64&&positions.getX(i+1)<=64){
    assert.ok(positions.getX(i+1)-positions.getX(i)<=4);
  }
  for(let row=0;row<geometry.parameters.heightSegments;row++){
    assert.ok(positions.getZ((row+1)*columns)-positions.getZ(row*columns)<=4.001);
  }
});

test('triangulated water differs by less than 1.5 cm from analytic contacts throughout the race and both banks',()=>{
  const geometry=createWaterGeometry(THREE),surface=makeSurfaceSampler(geometry),probes=[];
  const positions=geometry.attributes.position,index=geometry.index;
  let allTimeBound=0;
  for(let i=0;i<index.count;i+=3){
    const vertices=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    if(vertices.some(vertex=>Math.abs(positions.getX(vertex))>64))continue;
    let bound=0;
    for(const wave of WAVES){
      const phases=vertices.map(vertex=>positions.getX(vertex)*wave.x+positions.getZ(vertex)*wave.z);
      // Linear interpolation cancels the first derivative. With |sin''|<=1,
      // the remaining error is <= amplitude * phase variance / 2, and that
      // variance is <= phase range squared / 4 for any barycentric weights.
      bound+=wave.amplitude*(Math.max(...phases)-Math.min(...phases))**2/8;
    }
    allTimeBound=Math.max(allTimeBound,bound);
  }
  assert.ok(allTimeBound<.015,`the conservative contact bound reaches ${(allTimeBound*100).toFixed(3)} cm`);
  const edge=z=>27.8+1.6*Math.sin(z*.025)+.85*Math.cos(z*.047+.8);
  for(let z=0;z>=-900;z-=1){
    for(let x=-18;x<=18;x+=.5)probes.push(surface.probe(x,z));
    for(const side of [-1,1]){
      for(let x=24;x<=45;x++)probes.push(surface.probe(side*x,z));
      for(const offset of [-.45,.2,.9])probes.push(surface.probe(side*(edge(z)+offset),z));
    }
  }
  let maxError=0;
  for(const time of [0,.5,2,5,13,29,60]){
    surface.atTime(time);
    for(const point of probes){
      const error=Math.abs(surface.height(point)-sampleWater(point.x,point.z,time).height);
      maxError=Math.max(maxError,error);
    }
  }
  assert.ok(maxError<.015,`water face/contact separation reaches ${(maxError*100).toFixed(3)} cm`);
});

test('illustrated and classic water use the contact mesh with unchanged world coordinates and displaced bounds',()=>{
  for(const look of ['illustrated','classic']){
    const parent=new THREE.Group();
    const {water}=look==='illustrated'?createIllustratedWater(THREE,parent):createWater(THREE,parent,false,look);
    assert.deepEqual(water.position.toArray(),[0,WATER_BASE,-700]);
    assert.equal(water.geometry.attributes.position.count,24641);
    assert.equal(water.geometry.index.count/3,48000);
    assert.ok(water.geometry.boundingBox.min.y<=-WATER_AMPLITUDE);
    assert.ok(water.geometry.boundingBox.max.y>=WATER_AMPLITUDE);
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
    water.material.onBeforeCompile(shader);
    // World Z: the mesh translation follows the view (followWater), the waves do not.
    assert.match(shader.vertexShader,/vWater\s*=\s*vec2\(position.x,\s*position.z\s*\+\s*modelMatrix\[3\]\.z\)/);
  }
});

test('water follows the view in whole rows, so any course length keeps water ahead and behind',async()=>{
  const { followWater, WATER_ROW, WATER_START_Z } = await import('../dist/water-geometry.js');
  const { COURSE_LENGTH } = await import('../dist/maps.js');
  const water={position:{z:0}};
  for(const viewZ of [0,25,-1,-3.9,-437.25,-900,-COURSE_LENGTH]){
    followWater(water,viewZ);
    assert.equal(Math.abs((water.position.z-WATER_START_Z)%WATER_ROW),0,'vertices keep the same world lattice');
    assert.ok(water.position.z+1200>=Math.min(0,viewZ)+500-WATER_ROW,'500 m of water behind the view');
    assert.ok(water.position.z-1200<=viewZ-1500,'well past the 410 m fog ahead of the view');
  }
  followWater(water,10);assert.equal(water.position.z,WATER_START_Z,'the start keeps the original placement');
});
