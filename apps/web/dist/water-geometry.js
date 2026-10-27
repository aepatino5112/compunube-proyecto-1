// Spend water vertices where boards, pickups and shoreline foam meet the
// surface. The outer columns retain the full horizon without a dense 1 km grid.
const columns=[-500,-300,-160,-96,...Array.from({length:33},(_,i)=>-64+i*4),96,160,300,500];

// The 2.4 km plane starts centred 700 m ahead (500 m behind the start) and
// follows the view in whole 4 m rows, so a course of any length keeps 500 m of
// water behind the camera and 1.9 km ahead. Its vertices stay on the same world
// lattice and the shaders read world Z, so the waves never shift when it moves.
export const WATER_ROW=4, WATER_START_Z=-700;
export function followWater(water,viewZ=0) {
  water.position.z=WATER_START_Z+Math.min(0,Math.round(viewZ/WATER_ROW)*WATER_ROW);
}

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
