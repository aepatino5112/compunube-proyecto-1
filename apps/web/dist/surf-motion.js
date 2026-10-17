import { NET_LEFT_ANGLE,NET_GRIPS } from './mechanics.js';

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const mirrorPoleYaw=2*Math.atan2(NET_GRIPS.R[0]-NET_GRIPS.L[0],NET_GRIPS.L[2]-NET_GRIPS.R[2]);

// The Blender hull starts at local y=.10; leave one centimetre of clearance
// at rest, rather than raising the entire board 25 cm above its sampled water.
export const BOARD_WATERLINE_OFFSET=-.09;

// Visual anchors follow the yaw of the board, independently of pickup physics.
export function sampleBoardPoint(racer,localX,localZ,out={}) {
  const yaw=racer.group?.rotation.y??-(racer.turn||0)*.2,c=Math.cos(yaw),s=Math.sin(yaw);
  out.x=racer.x+c*localX+s*localZ;
  out.z=racer.z-s*localX+c*localZ;
  return out;
}

// The shaft's axis does not pass through the board origin. Rotate its visual
// orientation around the head so left-side grips mirror the right-side reach.
// Compensation retains exactly the existing swept pickup head, including pitch.
export function applyNetPose(group,angle=0,pose={}){
  const pitch=pose.netPitch||0,yaw=angle+(mirrorPoleYaw-NET_LEFT_ANGLE)*smooth(angle/NET_LEFT_ANGLE);
  const x=2.05*(Math.cos(angle)-Math.cos(yaw))-1.4*(Math.sin(angle)-Math.sin(yaw));
  const z=-2.05*(Math.sin(angle)-Math.sin(yaw))-1.4*(Math.cos(angle)-Math.cos(yaw));
  group.rotation.set(pitch,yaw,0);
  group.position.set(x,(pose.netHeight||0)-Math.sin(pitch)*z,Math.cos(pitch)*z);
}
export function advanceNetAngle(angle,side,dt) {
  return dt>0?(side<0?NET_LEFT_ANGLE:0)+(angle-(side<0?NET_LEFT_ANGLE:0))*Math.exp(-8*dt):angle;
}

export function scoopEnvelope(timer) {
  if(timer<=0)return 0;
  const progress=clamp(1-timer/.75);
  return smooth(progress/.24)*(1-smooth((progress-.52)/.48));
}

// Exact critically damped response for a held target. No Euler instability on slow frames.
function spring(channel,target,rate,dt) {
  const offset=channel.value-target,step=channel.velocity+rate*offset,decay=Math.exp(-rate*dt);
  channel.value=target+(offset+step*dt)*decay;
  channel.velocity=(channel.velocity-rate*step*dt)*decay;
}

// Presentation only: never changes the simulated net contact, jump or board position.
export function createSurfMotion() {
  const channels=Object.fromEntries(['scoop','transfer','lean','pitch'].map(name=>[name,{value:0,velocity:0}]));
  const pose={scoop:0,transfer:0,lean:0,netHeight:0,netPitch:0,boardHeight:0,boardPitch:0,look:0};
  function reset(){for(const channel of Object.values(channels)){channel.value=0;channel.velocity=0;}for(const name of Object.keys(pose))pose[name]=0;}
  function update(dt,state={}) {
    if(dt<=0)return pose;
    const scoop=scoopEnvelope(state.catchTimer||0),crossing=Math.sin(clamp((state.netAngle||0)/NET_LEFT_ANGLE)*Math.PI);
    const airborne=state.jump>0;
    const landing=state.landingTimer>0&&!airborne?clamp(1-state.landingTimer/.55):1;
    const sink=landing<.36?-.055*Math.sin(Math.PI*landing/.36):.022*Math.sin(Math.PI*(landing-.36)/.64);
    const landingPitch=.045*Math.sin(landing*Math.PI*2)*(1-landing);
    spring(channels.scoop,scoop,28,dt);
    spring(channels.transfer,crossing,24,dt);
    spring(channels.lean,clamp(state.turn||0,-1,1)*.08,18,dt);
    spring(channels.pitch,airborne?-clamp((state.jumpVelocity||0)/6,-1,1)*.09:(state.boosting?-.045:0)+landingPitch,20,dt);
    pose.scoop=clamp(channels.scoop.value);pose.transfer=clamp(channels.transfer.value);
    pose.lean=channels.lean.value;pose.netHeight=.12*pose.scoop+.28*pose.transfer;
    pose.netPitch=.45*pose.scoop+.16*pose.transfer;
    pose.boardHeight=state.landingTimer>0&&!airborne?sink:0;pose.boardPitch=channels.pitch.value;
    pose.look=(pose.scoop+.7*pose.transfer)*(1-2*clamp((state.netAngle||0)/NET_LEFT_ANGLE));
    return pose;
  }
  return {pose,update,reset};
}
