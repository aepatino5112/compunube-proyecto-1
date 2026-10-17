// Decoration has its own deterministic variation and never consumes course RNG.
const variation=index=>.5+.5*Math.sin(index*12.9898+4.17);
export const SHORE_CLEARANCE=24;

export function createShoreLayout(islands,bounds) {
  const banks=islands.map((island,index)=>{
    const variant=index%6===0||index%6===3?'village':'mangrove';
    const sx=island.radius/8.3*.90,sz=island.radius*1.65/22*(1+variation(index*23)*.18);
    const sy=1.12+variation(index*17)*.32;
    const angle=(island.side>0?Math.PI:0)+(variation(index*11)-.5)*.10;
    const extent=projectedExtent(bounds[variant],sx,sz,angle);
    const x=island.side*Math.max(Math.abs(island.x)-7,SHORE_CLEARANCE+extent);
    return {variant,x,y:0,z:island.z,side:island.side,sx,sy,sz,angle,rx:8.3*sx,rz:22*sz};
  });
  // A staggered outer layer gives depth through gaps in the closer shore.
  const forest=banks.map((bank,i)=>{
    const sx=.9+variation(i*5)*.2;
    return {...bank,variant:'mangrove',x:bank.side*(57+variation(i*31)*9),z:bank.z-43,
      sx,sy:1.55+variation(i*7)*.25,sz:1.20,rx:8.3*sx,rz:22*1.20};
  });
  // Continue the scenery past the finish so the horizon keeps its composition.
  // These banks belong only to the backdrop, outside the 900 m race course.
  const backdrop=[];
  for(const side of [-1,1]){
    const last=banks.filter(bank=>bank.side===side).at(-1);if(!last)continue;
    for(let i=1;i<=4;i++)backdrop.push({...last,variant:'mangrove',z:last.z-i*86,sy:1.20+variation(i*9+side)*.25});
  }
  return {banks,forest,backdrop};
}

// Covers the main view (fog ends at 410 m) and the 180 m rear camera.
export function shoreVisible(bank,viewZ) {
  const reach=bank.rz+12;
  return bank.z+reach>=viewZ-430&&bank.z-reach<=viewZ+200;
}

function projectedExtent(bounds,sx,sz,angle) {
  const x=Math.max(Math.abs(bounds.minX),Math.abs(bounds.maxX));
  const z=Math.max(Math.abs(bounds.minZ),Math.abs(bounds.maxZ));
  return x*sx*Math.abs(Math.cos(angle))+z*sz*Math.abs(Math.sin(angle));
}

export function shorePoint(bank,x,z) {
  const c=Math.cos(bank.angle),s=Math.sin(bank.angle);
  return {x:bank.x+x*c+z*s,z:bank.z-x*s+z*c};
}
