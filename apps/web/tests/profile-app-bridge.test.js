import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createOnlineProfileStore} from '../dist/online-profile.js';
import {freshProfile,transact} from '../dist/economy.js';

// Exercise the real app boundaries, without bootstrapping WebGL or replacing
// server confirmation with the local economy. Only DOM/render/storage are stubs.
const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function section(from,to){const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
const bridge=section('function persist()', 'function setPage(');
const exchange=section("$('exchange-form').addEventListener('submit'", "for (const button of document.querySelectorAll('[data-material]'))");
const subscription=section('onlineProfiles.subscribe(state=>','game.onInput=');
function confirmed(rev=1,patch={}){const {settled,...profile}=freshProfile();return {playerId:'account',profileRevision:rev,profile:{...profile,coins:80,plastic:20,metal:12},...patch};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(perform){
  let counter=0;const sent=[],writes=[],messages=[],renders=[];
  const onlineProfiles=createOnlineProfileStore({adapter:{getProfile:async()=>confirmed(),performAction:async request=>{sent.push(request);return perform(request);}},requestIdFactory:()=>`op-${++counter}`});
  const nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',value:'',handlers:{},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;}});return nodes.get(id);};
  $('race').hidden=true;$('exchange-material').value='plastic';$('exchange-amount').value='2';
  const offlineProfile={...freshProfile(),coins:150,plastic:36,metal:22};
  const c={offlineProfile,profile:offlineProfile,progressMode:'local',progressGeneration:0,storageAvailable:true,STORAGE:'compunube.profile.v1',onlineProfiles,transact,$,
    game:{mode:'local'},localStorage:{setItem(key,value){writes.push({key,profile:JSON.parse(value)});}},render(){renders.push(c.profile);},message:text=>messages.push(text),
    materialName:type=>type==='plastic'?'plástico':'chatarra',updateExchange(){},Number,JSON};
  vm.createContext(c);vm.runInContext(bridge+'\n'+exchange+'\n'+subscription,c);
  return {c,$,onlineProfiles,sent,writes,messages,renders,submit:()=>$('exchange-form').handlers.submit({preventDefault(){}})};
}

test('actual app persists only the offline wallet and online selection requires a confirmed profile',async()=>{
  const h=fixture();assert.equal(h.c.setProgressMode('online'),false);
  await h.onlineProfiles.load();h.c.setProgressMode('online');h.c.persist();
  assert.equal(h.c.profile.coins,80);assert.equal(h.writes[0].profile.coins,150);
  assert.equal(h.$('progress-scope').textContent,'ONLINE');
  h.c.setProgressMode('local');assert.equal(h.c.profile.coins,150);h.onlineProfiles.dispose();
});

test('actual app waits for confirmation, blocks double submits and never spends or saves online balances locally',async()=>{
  const reply=deferred(),h=fixture(()=>reply.promise);await h.onlineProfiles.load();h.c.setProgressMode('online');
  const first=h.c.commit({type:'buy',id:'manglar'},'Comprado');
  assert.equal(h.c.onlineReadOnly(),true);assert.equal(h.c.profile.coins,80);
  assert.equal(await h.c.commit({type:'buy',id:'sol'}),false);await Promise.resolve();assert.equal(h.sent.length,1);
  const data=confirmed(2,{requestId:h.sent[0].requestId});data.profile.coins=20;data.profile.owned.push('manglar');reply.resolve(data);
  assert.equal(await first,true);assert.equal(h.c.profile.coins,20);assert.equal(h.c.offlineProfile.coins,150);assert.equal(h.writes.length,0);
  h.onlineProfiles.dispose();
});

test('actual exchange never shows a successful receipt for a rejected or uncertain operation',async()=>{
  for(const failure of [{code:'INSUFFICIENT_MATERIALS'},new Error('reply lost')]){
    const h=fixture(async()=>{throw failure;});await h.onlineProfiles.load();h.c.setProgressMode('online');await h.submit();
    assert.equal(h.$('exchange-receipt').hidden,true);assert.equal(h.c.profile.plastic,20);assert.equal(h.c.offlineProfile.plastic,36);assert.equal(h.writes.length,0);
    h.onlineProfiles.dispose();
  }
});

test('actual exchange confirmation cannot paint a receipt or switch wallet after the user selects local',async()=>{
  const reply=deferred(),h=fixture(()=>reply.promise);await h.onlineProfiles.load();h.c.setProgressMode('online');
  const pending=h.submit();await Promise.resolve();h.c.setProgressMode('local');
  const data=confirmed(2,{requestId:h.sent[0].requestId});data.profile.plastic=18;data.profile.coins=88;reply.resolve(data);await pending;
  assert.equal(h.c.progressMode,'local');assert.equal(h.c.profile.coins,150);assert.equal(h.$('exchange-receipt').hidden,true);
  assert.equal(h.onlineProfiles.state.profile.coins,88);assert.equal(h.writes.length,0);h.onlineProfiles.dispose();
});

test('actual confirmed exchange uses server data and can show its receipt only in the original context',async()=>{
  const h=fixture(async request=>{const data=confirmed(2,{requestId:request.requestId});data.profile.plastic=18;data.profile.coins=88;return data;});
  await h.onlineProfiles.load();h.c.setProgressMode('online');await h.submit();
  assert.equal(h.$('exchange-receipt').hidden,false);assert.match(h.$('exchange-receipt').textContent,/confirmado por el servicio/);
  assert.equal(h.c.profile.plastic,18);assert.equal(h.c.offlineProfile.plastic,36);assert.equal(h.writes.length,0);h.onlineProfiles.dispose();
});

test('actual result boundary never credits online races locally and credits a local result once to its own wallet',async()=>{
  const h=fixture();await h.onlineProfiles.load();h.c.setProgressMode('online');
  h.c.game.mode='online';assert.equal(h.c.settleLocalRace({raceId:'remote',plastic:50,metal:20}),false);
  assert.equal(h.writes.length,0);h.c.game.mode='local';
  assert.equal(h.c.settleLocalRace({raceId:'local',plastic:2,metal:1}),true);
  assert.equal(h.c.profile.plastic,20);assert.equal(h.c.offlineProfile.plastic,38);assert.equal(h.writes[0].profile.plastic,38);
  assert.equal(h.c.settleLocalRace({raceId:'local',plastic:2,metal:1}),false);assert.equal(h.writes.length,1);h.onlineProfiles.dispose();
});

test('actual profile pushes update the active wallet without rebuilding race actors and cannot cross identities',async()=>{
  const h=fixture();await h.onlineProfiles.load();h.c.setProgressMode('online');h.$('race').hidden=false;h.c.game.mode='online';
  const count=h.renders.length;const data=confirmed(3);data.profile.coins=250;
  assert.equal(h.onlineProfiles.accept(data),true);assert.equal(h.c.profile.coins,250);assert.equal(h.renders.length,count);assert.equal(h.writes.length,0);
  assert.equal(h.onlineProfiles.accept(confirmed(4,{playerId:'other'})),false);assert.equal(h.c.profile.coins,250);h.onlineProfiles.dispose();
});
