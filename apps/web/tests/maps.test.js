import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, findMap, createCourse, COURSE_LENGTH, COURSE_WIDTH } from '../dist/maps.js';

test('Each destination resets to a deterministic, finite course with usable pickups',()=>{
  for(const map of MAPS) {
    const course=createCourse(map.id);assert.deepEqual(course,createCourse(map.id));
    assert.equal(COURSE_LENGTH,1800);assert.equal(course.obstacles.length,113);assert.equal(course.trash.length,211);assert.equal(course.lifesavers.length,21);
    for(const pickup of [...course.trash,...course.lifesavers]) {
      assert.ok(pickup.z<0&&pickup.z>-COURSE_LENGTH);
      assert.ok(Math.abs(pickup.x)<=COURSE_WIDTH+1);
      assert.ok(!course.obstacles.some(o=>Math.abs(o.z-pickup.z)<3&&Math.abs(o.x-pickup.x)<o.radius+2));
    }
    course.trash[0].collectedBy=0;
    assert.equal(createCourse(map.id).trash[0].collectedBy,undefined);
  }
  assert.notDeepEqual(createCourse('maracaibo').obstacles,createCourse('orinoco').obstacles);
  assert.equal(findMap('deleted-destination').id,'maracaibo');
});

test('surf-mvp-2 keeps the surf-mvp-1 spacing, and 900 m still rebuilds surf-mvp-1',()=>{
  for(const map of MAPS) {
    const v1=createCourse(map.id,900),v2=createCourse(map.id);
    assert.deepEqual([v1.obstacles.length,v1.trash.length,v1.lifesavers.length,v1.islands.length],[54,103,10,24]);
    const gaps=items=>items.slice(1).map((item,i)=>+(items[i].z-item.z).toFixed(6));
    assert.deepEqual(new Set(gaps(v2.obstacles)),new Set(gaps(v1.obstacles)));
    assert.deepEqual(new Set(gaps(v2.lifesavers)),new Set(gaps(v1.lifesavers)));
    // Same margin before the finish line as surf-mvp-1.
    assert.ok(Math.abs((900+v1.obstacles.at(-1).z)-(1800+v2.obstacles.at(-1).z))<15.2);
    assert.ok(Math.abs((900+v1.trash.at(-1).z)-(1800+v2.trash.at(-1).z))<8.3);
  }
});

test('the home screen announces the current course length',async()=>{
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,new RegExp(`<span>${COURSE_LENGTH} m · 3 vidas</span>`));
});
