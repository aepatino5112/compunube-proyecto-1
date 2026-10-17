import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, findMap, createCourse, COURSE_LENGTH, COURSE_WIDTH } from '../dist/maps.js';

test('Each destination resets to a deterministic, finite course with usable pickups',()=>{
  for(const map of MAPS) {
    const course=createCourse(map.id);assert.deepEqual(course,createCourse(map.id));
    assert.equal(course.trash.length,103);assert.equal(course.lifesavers.length,10);
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
