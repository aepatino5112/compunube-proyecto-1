import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, findMap, createCourse, COURSE_LENGTH, COURSE_WIDTH, COURSE_VERSION } from '../dist/maps.js';

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

test('surf-mvp-2 keeps the surf-mvp-1 spacing, and every released version can be rebuilt',()=>{
  for(const map of MAPS) {
    const v1=createCourse(map.id,'surf-mvp-1'),v2=createCourse(map.id,'surf-mvp-2');
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

test('the 3D scene builds one object per course obstacle and lifesaver, not a fixed count',async()=>{
  // surf-mvp-2 shipped with loops fixed at 54/10: online races were rejected and
  // the second half of a local race had no obstacles or lifesavers.
  const {readFile}=await import('node:fs/promises');
  const game=await readFile(new URL('../dist/game.js',import.meta.url),'utf8');
  assert.match(game,/i < initialCourse\.obstacles\.length;/);
  assert.match(game,/i < initialCourse\.lifesavers\.length;/);
  assert.doesNotMatch(game,/for \(let i = 0; i < \d+; i\+\+\) \{\n\s*const \{[^}]*\}=initialCourse\./);
});

// Longest chain of pieces one surfer can collect: lateral 10 u/s at the 16.4 u/s
// cruise, net capture radius 1.25 (Go's rules), ignoring obstacles.
function bestLine(items) {
  const sorted=[...items].sort((a,b)=>b.z-a.z),best=sorted.map(()=>1),prev=sorted.map(()=>-1);
  for(let j=0;j<sorted.length;j++)for(let i=0;i<j;i++){
    const reach=10/16.4*(sorted[i].z-sorted[j].z)+2.5;
    if(Math.abs(sorted[j].x-sorted[i].x)<=reach&&best[i]+1>best[j]){best[j]=best[i]+1;prev[j]=i;}
  }
  const line=new Set();for(let k=best.indexOf(Math.max(...best));k>=0;k=prev[k])line.add(sorted[k]);
  return line;
}

test('surf-mvp-3 trash rewards other lines: no single line sweeps the course',()=>{
  assert.equal(COURSE_VERSION,'surf-mvp-3');
  for(const map of MAPS){
    const shares=version=>{
      const trash=createCourse(map.id,version).trash,first=bestLine(trash);
      return [first.size/trash.length,bestLine(trash.filter(item=>!first.has(item))).size/trash.length];
    };
    const [lineFirst,lineSecond]=shares('surf-mvp-2'),[first,second]=shares('surf-mvp-3');
    assert.ok(lineFirst>.85&&lineSecond<.15,`surf-mvp-2 was one line (${lineFirst}, ${lineSecond})`);
    assert.ok(first<=.65,`${map.id}: the best line takes ${(first*100).toFixed(0)} %`);
    assert.ok(second>=.28,`${map.id}: the second surfer can still take ${(second*100).toFixed(0)} %`);
    const trash=createCourse(map.id).trash;
    assert.ok(trash.every(item=>Math.abs(item.x)<=13),'every piece stays inside the reachable channel');
    const metal=trash.filter(item=>item.kind===1).length/trash.length;
    assert.ok(metal>.3&&metal<.4,`scrap share ${metal} keeps the economy`);
  }
});
