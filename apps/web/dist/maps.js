// Geography and course generation are independent of rendering and the inventory.
export const MAPS = Object.freeze([
  Object.freeze({id:'maracaibo',name:'Lago de Maracaibo',shortName:'Maracaibo',region:'ZULIA · LAGO',description:'El puente en el horizonte, una orilla más limpia.',coordinate:'10° N / 71° O',seed:57,sky:0xbfe8e9,bridge:true}),
  Object.freeze({id:'orinoco',name:'Río Orinoco',shortName:'Orinoco',region:'DELTA AMACURO · DELTA',description:'Entre caños y copas verdes, cada residuo cuenta.',coordinate:'9° N / 61° O',seed:819,sky:0xe4e8cb,bridge:false}),
]);
// Every released course version can be rebuilt exactly: surf-mvp-1 (900 m) and
// surf-mvp-2 (1800 m) lay the trash on one snaking line; surf-mvp-3 keeps the
// surf-mvp-2 course and lays it out in sections (see sectionTrash).
const VERSIONS=Object.freeze({
  'surf-mvp-1':{length:900,layout:'line'},
  'surf-mvp-2':{length:1800,layout:'line'},
  'surf-mvp-3':{length:1800,layout:'sections'},
});
export const COURSE_VERSIONS=Object.freeze(Object.keys(VERSIONS));
export const courseLength=version=>VERSIONS[version].length;
export const COURSE_VERSION='surf-mvp-3';
export const COURSE_LENGTH=VERSIONS[COURSE_VERSION].length, COURSE_WIDTH=15;
// Same spacing for any length: rows are added until the surf-mvp-1 margin before
// the finish. The epsilon keeps exact multiples (900 m) from flooring one short.
const fill=(length,first,margin,step)=>Math.floor((length-margin+first)/step+1e-6)+1;
// Islands instead reach at least 61 m past the finish, as in surf-mvp-1, so the
// finish line keeps banks on both sides.
const cover=(length,first,beyond,step)=>Math.ceil((length+beyond+first)/step-1e-6)+1;
export const findMap=id=>MAPS.find(map=>map.id===id)||MAPS[0];
export function createCourse(id,version=COURSE_VERSION) {
  const {length,layout}=VERSIONS[version]??VERSIONS[COURSE_VERSION];
  const map=findMap(id);let seed=map.seed;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const delta=map.id==='orinoco';
  const islands=Array.from({length:cover(length,28,61,43)},(_,i)=>{
    const side=i%2?1:-1;
    return {side,x:side*((delta?48:39)+random()*(delta?14:15)),z:28-i*43,radius:(delta?9:8)+random()*(delta?4:6)};
  });
  const obstacles=Array.from({length:fill(length,-42,52,15.2)},(_,i)=>({x:(random()-.5)*27,z:-42-i*15.2,radius:i%3?1.8:1.15,rotation:i%3?random()*6:0}));
  const clearX=(x,z,margin,depth)=>{
    const safe=value=>!obstacles.some(o=>Math.abs(o.z-z)<depth&&Math.abs(o.x-value)<o.radius+margin);
    if(safe(x))return x;
    // Search both sides, rather than swapping into another obstacle.
    return [-11,11,-7,7,0].find(safe)??x;
  };
  const lifesavers=Array.from({length:fill(length,-85,104,79)},(_,i)=>{
    const z=-85-i*79,x=[3,-7,8,-2,11,-9,4,-5,9,0][i%10]*(delta?-1:1);
    const nextX=delta?clearX(x,z,2.2,5):obstacles.some(o=>Math.abs(o.z-z)<5&&Math.abs(o.x-x)<4)?(x>0?-6:6):x;
    return {x:nextX,z};
  });
  const trash=[];
  const add=(x,z,kind)=>trash.push({x,z,kind,rotation:random()*Math.PI,phase:random()*6});
  add(5.2,-6,0);add(.8,-19,1);add(5.2,-30,2);
  const rows=fill(length,-35,43.3,8.3);
  if(layout==='sections')sectionTrash(rows,delta,random,obstacles,add);
  else for(let i=0;i<rows;i++) {
    const z=-35-i*8.3;
    const x=Math.max(-13,Math.min(15.5,(delta?-2:3)+Math.sin(i*(delta?.25:.32))*11+(random()-.5)*3));
    const nextX=delta?clearX(x,z,2.5,3):obstacles.some(o=>Math.abs(o.z-z)<3&&Math.abs(o.x-x)<o.radius+2.5)?(x>0?-10:10):x;
    add(nextX,z,i%3);
  }
  return {id:map.id,islands,obstacles,lifesavers,trash,seed};
}

// surf-mvp-3: one snaking line let the leader collect almost everything. The
// same 208 slots (8.3 m apart) are grouped in 66 m sections of 8 pieces, each
// with a pattern a single surfer cannot sweep: lanes are 7-9 units apart and a
// lane change costs about 13 m, so whoever takes another lane finds its own
// pieces. A cove pays the detour to the bank with scrap (6 coins, plastic 4).
// Kinds: 0 bottle, 1 pipe (scrap), 2 wrapper.
const SECTION=8;
const PATTERNS={
  // Two parallel lanes, one scrap in each.
  fork:shift=>[[0,-7,0],[0,7,2],[2,-7,1],[2,7,0],[4,-7,2],[4,7,1],[6,-7,0],[6,7,2]].map(([slot,x,kind])=>[slot,x+shift,kind]),
  // Three staggered lanes 3/3/2; the short lane carries the most scrap.
  trident:shift=>[[0,-9,0],[1,0,2],[2,9,1],[3,-9,2],[4,0,1],[5,9,1],[6,-9,0],[7,0,2]].map(([slot,x,kind])=>[slot,x+shift,kind]),
  // Five pieces packed against one bank (four scrap) against three plastic in the centre.
  cove:(shift,side)=>[[0,shift,0],[3,shift,2],[6,shift,0],[1,side*12,1],[2,side*12,1],[3,side*12,0],[4,side*12,1],[5,side*12,1]],
  // A short stretch of the old line keeps some flow between choices.
  snake:(shift,side,i0,delta)=>Array.from({length:SECTION},(_,k)=>[k,(delta?-2:3)+Math.sin((i0+k)*(delta?.25:.32))*9,(i0+k)%3]),
};
function sectionTrash(rows,delta,random,obstacles,add) {
  const blocked=(x,z)=>obstacles.some(o=>Math.abs(o.z-z)<3&&Math.abs(o.x-x)<o.radius+2.5);
  const clamp=x=>Math.max(-13,Math.min(13,x));
  // Move a piece off an obstacle along its own lane direction first.
  const clear=(x,z)=>blocked(x,z)?[x+4,x-4,x+8,x-8].map(clamp).find(value=>!blocked(value,z))??x:x;
  let previous='';
  for(let i0=0;i0<rows;i0+=SECTION) {
    let name=i0+SECTION>rows?'snake':['fork','trident','cove','snake'][Math.floor(random()*4)];
    if(name==='snake'&&previous==='snake')name='fork';
    previous=name;
    const shift=(random()-.5)*4,side=random()<.5?-1:1;
    const pieces=PATTERNS[name](shift,side,i0,delta).filter(([slot])=>i0+slot<rows).sort((a,b)=>a[0]-b[0]);
    for(const [slot,x,kind] of pieces) {
      const z=-35-(i0+slot)*8.3;
      add(clear(clamp(x),z),z,kind);
    }
  }
}
