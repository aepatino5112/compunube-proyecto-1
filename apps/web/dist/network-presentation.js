// Maps authoritative IDs to reusable visual slots. It never runs gameplay or
// credits a profile. Interpolated transforms come from network-race.js.
export function createNetworkPresentation({race,actors,trash,lifesavers,onEvent=()=>{}}) {
  const byPlayer=new Map(race.members.map((member,i)=>[member.playerId,actors[i]]));
  const trashById=new Map(race.start.course.trash.map((item,i)=>[item.id,trash[i]]));
  const lifeById=new Map(race.start.course.lifesavers.map((item,i)=>[item.id,lifesavers[i]]));
  const events=new Map();let eventFloor=-1,settled=false,lastTick=-1;
  const fields=['x','z','speed','turn','netSide','netAngle','energy','boosting','jump','jumpVelocity','lives','protection','hit','collected','plastic','metal'];
  actors.forEach((actor,i)=>{actor.networkHidden=i>=race.members.length;actor.playerId=race.members[i]?.playerId;});
  function frame(now,dt=0) {
    const snapshot=race.sample(now);if(!snapshot)return null;
    const changed=snapshot.tick!==lastTick;lastTick=snapshot.tick;
    for(const source of snapshot.players){
      const actor=byPlayer.get(source.playerId),wasAirborne=actor.jump>0;
      for(const field of fields)actor[field]=source[field];
      actor.disqualified=['disqualified','left','dnf'].includes(source.state);actor.reconnecting=source.state==='reconnecting';
      actor.networkHidden=source.state==='left';actor.finishTime=source.finishTimeSeconds;
      actor.catchTimer=changed&&source.catchTimer!==undefined?source.catchTimer:Math.max(0,(actor.catchTimer||0)-dt);
      actor.landingTimer=changed&&source.landingTimer!==undefined?source.landingTimer:Math.max(0,(actor.landingTimer||0)-dt);
      if(wasAirborne&&source.jump===0&&!actor.disqualified){
        actor.landingTimer=.55;actor.landingPending=true;actor.landingX=actor.x;actor.landingZ=actor.z;
        actor.landingRipple?.trigger(actor.x,actor.z);
      }
    }
    for(const [items,lookup] of [[snapshot.trash,trashById],[snapshot.lifesavers,lifeById]]){
      for(const source of items){const item=lookup.get(source.itemId);item.collectedBy=source.collectedBy;item.object.visible=source.collectedBy===null;}
    }
    return snapshot;
  }
  function event(message) {
    if(!message||message.raceId!==race.start.raceId||typeof message.eventId!=='string'||!message.eventId||message.eventId.length>128||!Number.isSafeInteger(message.tick)||message.tick<0||message.tick<=eventFloor||events.has(message.eventId)||!byPlayer.has(message.playerId))return false;
    const actor=byPlayer.get(message.playerId);
    const item=message.kind==='trash.collected'?trashById.get(message.itemId):message.kind==='life.collected'?lifeById.get(message.itemId):null;
    if(!['trash.collected','life.collected','player.hit','player.finished','player.disqualified'].includes(message.kind)||((message.kind==='trash.collected'||message.kind==='life.collected')&&!item))return false;
    if(message.kind==='player.hit'&&!['obstacle','octopus'].includes(message.cause))return false;
    if(message.kind==='trash.collected'&&!['plastic','metal'].includes(message.material))return false;
    if(['life.collected','player.hit'].includes(message.kind)&&(!Number.isInteger(message.lives)||message.lives<0||message.lives>3))return false;
    if(message.kind==='player.finished'&&(!Number.isFinite(message.finishTimeSeconds)||message.finishTimeSeconds<0))return false;
    events.set(message.eventId,message.tick);
    if(events.size>1024){const [id,tick]=events.entries().next().value;events.delete(id);eventFloor=Math.max(eventFloor,tick);}
    if(message.kind==='trash.collected'){actor.catchTimer=.75;actor.dripped=false;}
    // Effects are the only consequence here. Counters and ownership wait for a snapshot.
    onEvent(message,actor,item);return true;
  }
  function result(message) {
    if(settled||!message||message.raceId!==race.start.raceId||!Array.isArray(message.participants)||message.participants.length!==byPlayer.size)return null;
    const ids=new Set();let totalCollected=0;
    for(const item of message.participants){
      if(!item||!byPlayer.has(item.playerId)||ids.has(item.playerId)||!['finished','disqualified','left','dnf'].includes(item.outcome))return null;
      if(item.settlementState!==undefined&&!['pending','confirmed'].includes(item.settlementState))return null;
      ids.add(item.playerId);
      for(const type of ['plastic','metal'])if(!Number.isSafeInteger(item.collected?.[type])||item.collected[type]<0||item.collected[type]>trash.length||!Number.isSafeInteger(item.credited?.[type])||item.credited[type]<0||item.credited[type]>item.collected[type])return null;
      totalCollected+=item.collected.plastic+item.collected.metal;if(totalCollected>trash.length)return null;
      if(item.settlementId!==null&&(typeof item.settlementId!=='string'||!item.settlementId.trim()))return null;
      if(item.outcome!=='finished'&&(item.credited.plastic||item.credited.metal||item.rank!==null||item.finishTimeSeconds!==null))return null;
      if(item.outcome==='finished'&&(!Number.isInteger(item.rank)||item.rank<1||item.rank>byPlayer.size||!Number.isFinite(item.finishTimeSeconds)||item.finishTimeSeconds<0))return null;
    }
    const local=message.participants.find(item=>item.playerId===race.members[0].playerId);
    settled=true;return structuredClone(local);
  }
  return {byPlayer,frame,event,result};
}
