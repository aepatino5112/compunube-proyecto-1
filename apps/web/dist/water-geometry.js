// Spend water vertices where boards, pickups and shoreline foam meet the
// surface. The outer columns retain the full horizon without a dense 1 km grid.
const columns=[-500,-300,-160,-96,...Array.from({length:33},(_,i)=>-64+i*4),96,160,300,500];

export function createWaterGeometry(THREE) {
  const geometry=new THREE.PlaneGeometry(1000,2400,columns.length-1,600);
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<positions.count;i++){
    const x=columns[i%columns.length];
    positions.setX(i,x);uv.setX(i,(x+500)/1000);
  }
  return geometry;
}
