// Geography and course generation are independent of rendering and the inventory.
export const MAPS = Object.freeze([
  Object.freeze({id:'maracaibo',name:'Lago de Maracaibo',shortName:'Maracaibo',region:'ZULIA · LAGO',description:'El puente en el horizonte, una orilla más limpia.',coordinate:'10° N / 71° O',seed:57,sky:0xbfe8e9,bridge:true}),
  Object.freeze({id:'orinoco',name:'Río Orinoco',shortName:'Orinoco',region:'DELTA AMACURO · DELTA',description:'Entre caños y copas verdes, cada residuo cuenta.',coordinate:'9° N / 61° O',seed:819,sky:0xe4e8cb,bridge:false}),
]);
export const COURSE_LENGTH=900, COURSE_WIDTH=15;
export const findMap=id=>MAPS.find(map=>map.id===id)||MAPS[0];
export function createCourse(id) {
  const map=findMap(id);let seed=map.seed;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const delta=map.id==='orinoco';
  const islands=Array.from({length:24},(_,i)=>{
    const side=i%2?1:-1;
    return {side,x:side*((delta?48:39)+random()*(delta?14:15)),z:28-i*43,radius:(delta?9:8)+random()*(delta?4:6)};
  });
  const obstacles=Array.from({length:54},(_,i)=>({x:(random()-.5)*27,z:-42-i*15.2,radius:i%3?1.8:1.15,rotation:i%3?random()*6:0}));
  const clearX=(x,z,margin,depth)=>{
    const safe=value=>!obstacles.some(o=>Math.abs(o.z-z)<depth&&Math.abs(o.x-value)<o.radius+margin);
    if(safe(x))return x;
    // Search both sides, rather than swapping into another obstacle.
    return [-11,11,-7,7,0].find(safe)??x;
  };
  const lifesavers=Array.from({length:10},(_,i)=>{
    const z=-85-i*79,x=[3,-7,8,-2,11,-9,4,-5,9,0][i]*(delta?-1:1);
    const nextX=delta?clearX(x,z,2.2,5):obstacles.some(o=>Math.abs(o.z-z)<5&&Math.abs(o.x-x)<4)?(x>0?-6:6):x;
    return {x:nextX,z};
  });
  const trash=[];
  const add=(x,z,kind)=>trash.push({x,z,kind,rotation:random()*Math.PI,phase:random()*6});
  add(5.2,-6,0);add(.8,-19,1);add(5.2,-30,2);
  for(let i=0;i<100;i++) {
    const z=-35-i*8.3;
    const x=Math.max(-13,Math.min(15.5,(delta?-2:3)+Math.sin(i*(delta?.25:.32))*11+(random()-.5)*3));
    const nextX=delta?clearX(x,z,2.5,3):obstacles.some(o=>Math.abs(o.z-z)<3&&Math.abs(o.x-x)<o.radius+2.5)?(x>0?-10:10):x;
    add(nextX,z,i%3);
  }
  return {id:map.id,islands,obstacles,lifesavers,trash,seed};
}
