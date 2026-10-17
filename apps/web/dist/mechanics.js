export const BOOST_PER_ITEM = .2;
export const BOOST_DRAIN_PER_SECOND = .25;
export const NET_LEFT_ANGLE = 2 * Math.atan2(2.05, 1.4);
// Grip sleeves on the Blender pole, moved in front of the vest; pickup head stays fixed.
export const NET_GRIPS = Object.freeze({L:Object.freeze([.18,1.3685,-.601]),R:Object.freeze([.796,1.0297,-.8642])});

// Hands exchange near/far grips as the pole crosses the bow. One hand lifts
// briefly over the other; the gameplay pickup point and gear anchors stay fixed.
export function netHandGrip(suffix,angle=0,out={}) {
  const t=Math.max(0,Math.min(1,(angle/NET_LEFT_ANGLE-.18)/.64)),blend=t*t*(3-2*t);
  const from=NET_GRIPS[suffix],to=NET_GRIPS[suffix==='L'?'R':'L'];
  out.x=from[0]+(to[0]-from[0])*blend;
  out.y=from[1]+(to[1]-from[1])*blend+(suffix==='L'?.17:-.025)*Math.sin(blend*Math.PI)**2;
  out.z=from[2]+(to[2]-from[2])*blend;
  return out;
}

export function netContact(x, z, turn, netAngle) {
  const angle = netAngle - turn * .2;
  return { x: x + 2.05 * Math.cos(angle) - 1.4 * Math.sin(angle), z: z - 2.05 * Math.sin(angle) - 1.4 * Math.cos(angle) };
}
export function refillBoost(energy, count) {
  return Math.min(1, energy + count * BOOST_PER_ITEM);
}
export function spendBoost(energy, dt, requested) {
  const boosting = requested && energy > 0;
  return { energy: boosting ? Math.max(0, energy - dt * BOOST_DRAIN_PER_SECOND) : energy, boosting };
}
