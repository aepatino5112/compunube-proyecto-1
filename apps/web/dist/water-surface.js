// One wave definition for GPU water, floating waste and board contact.
export const WATER_BASE=-.15;
export const WAVES=Object.freeze([
  Object.freeze({x:.11,z:.16,speed:-.95,amplitude:.085}),
  Object.freeze({x:.21,z:-.09,speed:.6,amplitude:.045}),
  Object.freeze({x:.075,z:.06,speed:.4,amplitude:.06}),
]);
export const WATER_AMPLITUDE=WAVES.reduce((sum,w)=>sum+w.amplitude,0);
export function sampleWater(x,z,time,out={}) {
  let height=WATER_BASE,dx=0,dz=0;
  for(const wave of WAVES) {
    const phase=x*wave.x+z*wave.z+time*wave.speed;
    height+=Math.sin(phase)*wave.amplitude;
    const slope=Math.cos(phase)*wave.amplitude;dx+=slope*wave.x;dz+=slope*wave.z;
  }
  out.height=height;out.dx=dx;out.dz=dz;return out;
}
const f=n=>Number(n).toFixed(5);
export const WATER_GLSL=`
  float waterHeight(vec2 p, float t) {return ${WAVES.map(w=>`${f(w.amplitude)}*sin(dot(p,vec2(${f(w.x)},${f(w.z)}))+t*${f(w.speed)})`).join('+')};}
  vec2 waterSlope(vec2 p,float t) {return ${WAVES.map(w=>`vec2(${f(w.x)},${f(w.z)})*${f(w.amplitude)}*cos(dot(p,vec2(${f(w.x)},${f(w.z)}))+t*${f(w.speed)})`).join('+')};}
`;
