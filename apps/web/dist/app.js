import { game } from './game.js';
import { CATALOG, findItem, freshProfile, restoreProfile, transact } from './economy.js';
import { MAPS, findMap } from './maps.js';
import { CHARACTERS,SKIN_TONES,HAIR_COLORS } from './appearance.js';
import { createMultiplayerClient } from './multiplayer-client.js';
import { mountMultiplayerLobby } from './multiplayer-lobby.js';
import { backendAdapter,profileAdapter } from './backend-config.js';
import { createOnlineProfileStore } from './online-profile.js';
import { mountProfilePanel } from './profile-panel.js';

const $ = id => document.getElementById(id);
const STORAGE = 'compunube.profile.v1';
let offlineProfile = freshProfile(), storageAvailable = true;
try { offlineProfile = restoreProfile(JSON.parse(localStorage.getItem(STORAGE))); } catch { storageAvailable = false; }
let profile=offlineProfile,progressMode='local',progressGeneration=0;
const onlineProfiles=createOnlineProfileStore({adapter:profileAdapter});
let page = 'home', category = 'board', selected = profile.equipped.board, recipe = 'red-reuso', messageTimer;
const equipment = () => ({...profile.equipped,...profile.appearance});
for (const image of document.querySelectorAll('[data-waste-image]')) image.src = game.wasteImages[image.dataset.wasteImage];
let selectedMap=MAPS[0];
try { selectedMap=findMap(localStorage.getItem('compunube.map.v1')); } catch {}
// Mi progreso reopens on the view last used: online when it was online and the
// service answers, local otherwise (and on a first visit).
const PROGRESS_MODE='compunube.progress-mode.v1';
function rememberProgressMode(mode){try{localStorage.setItem(PROGRESS_MODE,mode);}catch{}}
function rememberedProgressMode(){try{return localStorage.getItem(PROGRESS_MODE);}catch{return null;}}
const mapImage=document.querySelector('.map-feature .map-art');
$('map-options').innerHTML=MAPS.map(map=>`<button type="button" data-map="${map.id}" aria-label="Elegir ${map.name}" aria-pressed="false"><img src="${game.mapImages[map.id]}" alt=""><span><strong>${map.shortName}</strong><small>${map.id==='orinoco'?'Caños y bosque':'Puente y palafitos'}</small></span><i aria-hidden="true">✓</i></button>`).join('');
function renderMap() {
  mapImage.src=game.mapImages[selectedMap.id];
  $('map-name').textContent=selectedMap.name;$('map-region').textContent=selectedMap.region;
  $('map-description').textContent=selectedMap.description;
  for(const button of document.querySelectorAll('[data-map]'))button.setAttribute('aria-pressed',String(button.dataset.map===selectedMap.id));
  $('play').innerHTML=`Jugar en ${selectedMap.shortName} <span>↗</span>`;
}
$('map-options').addEventListener('click',event=>{
  const button=event.target.closest('[data-map]');if(!button)return;
  selectedMap=findMap(button.dataset.map);
  try { localStorage.setItem('compunube.map.v1',selectedMap.id); } catch {}
  renderMap();
});
renderMap();
const materialName = type => type === 'plastic' ? 'plástico' : 'chatarra';
function message(text) { clearTimeout(messageTimer); $('app-message').textContent = text; $('app-message').hidden = false; messageTimer = setTimeout(() => $('app-message').hidden = true, 4500); }
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(offlineProfile)); storageAvailable = true; }
  catch { storageAvailable = false; }
  updateProgressStatus();
  if(game.mode==='local')$('result-save-note').textContent = storageAvailable ? 'Los materiales de esta carrera ya están guardados.' : 'Materiales disponibles en esta sesión. El navegador no permite guardarlos.';
}
function onlineReadOnly(){return progressMode==='online'&&onlineProfiles.state.status!=='ready';}
function updateProgressStatus(){
  const online=progressMode==='online',status=onlineProfiles.state.status;
  $('progress-scope').textContent=online?'ONLINE':'LOCAL';
  $('profile-open').setAttribute('aria-label',`Mi progreso: ${online?'online':'local'}`);
  $('save-status').textContent=online?(status==='ready'?'Progreso online confirmado por el servicio':status==='pending'?'Confirmando el cambio online…':status==='uncertain'?'Cambio online por confirmar · abre Mi progreso':'Última confirmación online · consulta Mi progreso'):
    storageAvailable?'Progreso local guardado en este navegador':'Guardado no disponible · progreso local en esta sesión';
  const waiting=online&&status!=='ready';
  $('profile-operation').hidden=!waiting;
  $('profile-operation-text').textContent=status==='pending'?'Estamos confirmando tu cambio. Tus saldos siguen mostrando la última confirmación.':status==='uncertain'?'Falta confirmar el último cambio. Consulta la misma operación antes de hacer otra.':'Actualiza tu perfil para volver a realizar cambios online.';
  for(const id of ['shop-panel','workshop-panel'])$(id).setAttribute('aria-busy',String(online&&['loading','pending'].includes(status)));
}
function setProgressMode(next){
  if(!['local','online'].includes(next)||next==='online'&&(!onlineProfiles.state.profile||onlineProfiles.state.status!=='ready'))return false;
  if(next!==progressMode){progressMode=next;progressGeneration++;$('exchange-receipt').hidden=true;}
  profile=next==='online'?onlineProfiles.state.profile:offlineProfile;
  rememberProgressMode(next);
  if($('race').hidden)render();else updateProgressStatus();
  return true;
}
async function commit(action, text) {
  if(progressMode==='online'){
    const context=progressGeneration,playerId=onlineProfiles.state.playerId;
    const success=await onlineProfiles.transact(action);
    if(context!==progressGeneration||progressMode!=='online'||playerId!==onlineProfiles.state.playerId)return success;
    profile=onlineProfiles.state.profile;
    if($('race').hidden)render();
    if(!success){message(onlineProfiles.state.error?.message||'Espera la confirmación del cambio online.');return false;}
    if(text)message(text);return true;
  }
  const result = transact(offlineProfile, action);
  if (result.error) { message(result.error); return false; }
  offlineProfile=result.profile;profile=offlineProfile;persist();render();
  if (text) message(text);
  return true;
}
function settleLocalRace(result){
  if(game.mode!=='local')return false;
  const settled=transact(offlineProfile,{type:'finish',...result});
  if(settled.error){message(settled.error);return false;}
  offlineProfile=settled.profile;if(progressMode==='local')profile=offlineProfile;
  persist();if($('race').hidden)render();return true;
}
function setPage(next) {
  page = next;
  $('materials-popover').hidden = true; $('materials-button').setAttribute('aria-expanded', 'false');
  render();
}
function updateExchange() {
  const material = $('exchange-material').value, amount = Number($('exchange-amount').value), available = profile[material];
  $('exchange-available').textContent = `${available} ${available === 1 ? 'disponible' : 'disponibles'}`;
  $('exchange-amount').max = Math.max(1, available);
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= available;
  const reward = valid ? amount * (material === 'plastic' ? 4 : 6) : 0;
  $('exchange-value').textContent = `${reward} monedas`;
  $('exchange-give').textContent = `${valid ? amount : 0} de ${materialName(material)}`;
  $('exchange-image').src = game.wasteImages[material];
  $('exchange-action').textContent = available === 0 ? 'Primero, una vuelta al agua' : `Reciclar por ${reward} monedas`;
  $('exchange-balance').textContent = valid ? `Te quedarán ${available - amount} de ${materialName(material)} · Tu saldo: ${profile.coins + reward} monedas` : `En tu mochila: ${available} de ${materialName(material)}`;
  $('exchange-note').textContent = available === 0 ? 'Termina una carrera para guardar los materiales que recojas.' : valid ? 'Los materiales entregados salen de tu mochila. Puedes guardar el resto para el taller.' : `Elige una cantidad entera entre 1 y ${available}.`;
  $('exchange-submit').disabled = !valid||onlineReadOnly();
  $('exchange-max').disabled = available === 0;
  $('exchange-max').textContent = material === 'plastic' ? 'Todo mi plástico' : 'Toda mi chatarra';
  $('exchange-less').disabled = !Number.isSafeInteger(amount) || amount <= 1;
  $('exchange-more').disabled = !Number.isSafeInteger(amount) || amount >= available;
  for (const type of ['plastic','metal']) $('stock-' + type).textContent = profile[type];
  for (const button of document.querySelectorAll('[data-material]')) button.setAttribute('aria-pressed', String(button.dataset.material === material));
}
function actionMarkup(item, craft = false) {
  const owned = profile.owned.includes(item.id), equipped = profile.equipped[item.type] === item.id;
  const afford = craft ? profile.plastic >= item.recipe?.plastic && profile.metal >= item.recipe?.metal : profile.coins >= item.price;
  const action = owned ? 'equip' : craft ? 'craft' : 'buy';
  const text = equipped ? 'Equipado ✓' : owned ? 'Equipar' : craft ? 'Fabricar esta red' : `Comprar · ${item.price} ◈`;
  const missing = craft && !owned ? [['plastic', 'plástico'], ['metal', 'chatarra']].filter(([type]) => profile[type] < item.recipe[type]).map(([type, name]) => `${item.recipe[type] - profile[type]} de ${name}`).join(' y ') : '';
  // Only say what the player can act on: what is still missing.
  const note = owned ? '' : craft ? missing ? `Te faltan ${missing}.` : '' : afford ? '' : `Te faltan ${item.price - profile.coins} ◈.`;
  return `<button class="primary" data-action="${action}" data-id="${item.id}" ${onlineReadOnly()||equipped || (!owned && !afford) ? 'disabled' : ''}>${text}<span>↗</span></button>${note?`<p class="detail-note">${note}</p>`:''}`;
}
// Selecting an item only changes which card is marked: lists, images and the 3D
// views are rebuilt when their content really changes, so the shop does not blink.
const renderedHtml = new WeakMap();
function setHtml(element, html) { if (renderedHtml.get(element) !== html) { element.innerHTML = html; renderedHtml.set(element, html); } }
function markSelected(container, key, value) {
  for (const button of container.querySelectorAll(`[data-${key}]`)) {
    const on = button.dataset[key] === value; button.classList.toggle('selected', on); button.setAttribute('aria-pressed', String(on));
  }
}
const ITEM_KINDS={board:'Tabla',outfit:'Ropa',hair:'Peinado',net:'Red',character:'Personaje'};
// Name and story of the selected item, presented as a card: kind and rarity,
// the name in the display face and its description as a short quote.
function itemHero(item) {
  return `<div class="item-hero"><span class="item-kind">${ITEM_KINDS[item.type]}${item.rarity?` · ${item.rarity}`:''}</span><h3>${item.name}</h3><p class="item-story">${item.description}</p></div>`;
}
function renderShop() {
  const exchange = category === 'exchange';
  const characters=category==='character';
  $('character-panel').hidden=!characters;
  $('shop-items').hidden = exchange||characters; $('item-detail').hidden = exchange||characters; $('exchange-panel').hidden = !exchange;
  for (const button of document.querySelectorAll('[data-category]')) button.setAttribute('aria-pressed', String(button.dataset.category === category));
  if (exchange) { updateExchange(); return; }
  if(characters){selected=profile.equipped.character;renderCharacters();return;}
  const items = CATALOG.filter(item => item.type === category);
  if (!items.some(item => item.id === selected)) selected = profile.equipped[category];
  setHtml($('shop-items'), items.map(item => `<button class="item-card" data-item="${item.id}" aria-pressed="false"><span class="item-state">${profile.equipped[item.type] === item.id ? '✓' : ''}</span><span class="item-art" aria-hidden="true">${['board','hair'].includes(category) ? `<img class="equipment-photo board-photo" src="${game.equipmentImages[item.id]}" alt="">` : `<span class="shirt-icon" style="--item-color:${item.color}"></span>`}</span><strong>${item.name}</strong><small>${profile.equipped[item.type] === item.id ? 'Equipado' : profile.owned.includes(item.id) ? 'En tu equipo' : `${item.price} ◈`}</small></button>`).join(''));
  markSelected($('shop-items'), 'item', selected);
  const item = findItem(selected);
  setHtml($('item-detail'), `${itemHero(item)}${actionMarkup(item)}`);
}
function renderCharacters() {
  setHtml($('character-items'),CHARACTERS.map(character=>`<button type="button" class="character-card" data-character="${character.id}" aria-label="Elegir ${character.name}" aria-pressed="${profile.equipped.character===character.id}"><img src="${game.equipmentImages[character.id]}" alt=""><span><strong>${character.name}</strong><small>${character.gender}</small></span><i aria-hidden="true">${profile.equipped.character===character.id?'✓':'↗'}</i></button>`).join(''));
  const character=findItem(profile.equipped.character);
  $('character-description').textContent=character.description;
  for(const [id,choices,field] of [['skin-options',SKIN_TONES,'skin'],['hair-color-options',HAIR_COLORS,'hairColor']]) {
    $(id).innerHTML=choices.map(tone=>`<button type="button" class="color-choice" data-appearance="${field}" data-value="${tone.id}" aria-label="${field==='skin'?'Tono de piel':'Color de cabello'}: ${tone.name}" aria-pressed="${profile.appearance[field]===tone.id}" style="--swatch:${tone.color}"><span aria-hidden="true"></span><small>${tone.name}</small></button>`).join('');
  }
}
function renderWorkshop() {
  setHtml($('workshop-items'), CATALOG.filter(item => item.type === 'net').map(item => `<button class="recipe-card" data-recipe="${item.id}" aria-pressed="false"><img class="equipment-photo net-photo" src="${game.equipmentImages[item.id]}" alt=""><span><strong>${item.name} <i class="rarity">${item.rarity}</i></strong><small>${item.recipe ? `${item.recipe.plastic} plástico + ${item.recipe.metal} chatarra` : 'Tu herramienta inicial'}</small></span><span class="recipe-state">${profile.equipped.net === item.id ? 'Equipada ✓' : profile.owned.includes(item.id) ? 'Fabricada' : '↗'}</span></button>`).join(''));
  markSelected($('workshop-items'), 'recipe', recipe);
  const item = findItem(recipe);
  const materials = item.recipe && !profile.owned.includes(item.id) ? `<p class="detail-note">Tienes / necesitas</p><div class="recipe-materials">${[['plastic', 'Plástico'], ['metal', 'Chatarra']].map(([type, name]) => `<div class="${profile[type] < item.recipe[type] ? 'missing' : ''}"><img class="recipe-waste" src="${game.wasteImages[type]}" alt=""><span>${name}</span><strong>${profile[type]} / ${item.recipe[type]}</strong></div>`).join('')}</div>` : '';
  setHtml($('recipe-detail'), `${itemHero(item)}${materials}${actionMarkup(item, !!item.recipe)}`);
}
let lastEquipKey = '', lastPreviewKey = '';
function render() {
  // Cards are rebuilt when a selection changes; keep keyboard navigation and the
  // workshop scroll position on that selection instead of returning to the body.
  const focused = document.activeElement;
  const focusKeys = focused?.dataset && ['item', 'recipe', 'character', 'appearance', 'value', 'id'].filter(key => focused.dataset[key] !== undefined).map(key => [key, focused.dataset[key]]);
  const recipeScroll = $('workshop-items').scrollTop;
  $('coins').textContent = profile.coins; $('wallet-plastic').textContent = profile.plastic; $('wallet-metal').textContent = profile.metal;
  for (const type of ['board', 'outfit', 'net']) $('equipped-' + type).textContent = findItem(profile.equipped[type]).name;
  for (const name of ['home', 'shop', 'workshop']) $(name + '-panel').hidden = page !== name;
  for (const button of document.querySelectorAll('[data-page]')) button.setAttribute('aria-pressed', String(button.dataset.page === page));
  const headings = { home: ['BUENAS OLAS. MEJORES HUELLAS.', 'Tu próxima buena ola'], shop: ['CADA RECORRIDO TIENE SU ESTILO.', 'Hazlo a tu manera'], workshop: ['RECUPERAR ES SOLO EL COMIENZO.', 'Una segunda vida'] };
  $('page-kicker').textContent = headings[page][0]; $('page-title').innerHTML = headings[page][1] + '<span>.</span>';
  renderShop(); renderWorkshop();
  const item = page === 'shop' && category !== 'exchange' ? findItem(selected) : page === 'workshop' ? findItem(recipe) : null;
  const palette = equipment(); if (item) palette[item.type] = item.id;
  const recycling = page === 'shop' && category === 'exchange';
  document.querySelector('.studio').classList.toggle('recycling-studio',recycling);
  $('recycle-steps').hidden = !recycling;
  const equipKey = JSON.stringify(equipment());
  if (equipKey !== lastEquipKey) { lastEquipKey = equipKey; game.equip(equipment()); }
  const previewType = recycling ? $('exchange-material').value : item?.type === 'board' ? 'board' : item?.type === 'net' ? 'net' : 'surfer';
  const previewKey = JSON.stringify([palette, previewType]);
  if (previewKey !== lastPreviewKey) { lastPreviewKey = previewKey; game.preview(palette, previewType); }
  $('preview-badge').textContent = item ? (profile.owned.includes(item.id) ? 'EN TU EQUIPO' : 'VISTA PREVIA') : 'TU SURFISTA';
  $('preview-kicker').textContent = item ? 'DEL CLUB AL AGUA' : 'LISTO PARA VOLVER AL AGUA';
  $('preview-title').textContent = item ? item.name : findItem(profile.equipped.character).name;
  $('preview-description').textContent = item ? 'El mismo modelo que llevarás al equiparlo. Elige tu estilo y encuentra tu ritmo.' : 'Lo que recoges hoy puede ser parte de tu equipo mañana.';
  if (recycling) {
    const plastic = $('exchange-material').value === 'plastic';
    $('preview-badge').textContent = 'RESCATADO DEL AGUA';
    $('preview-kicker').textContent = 'MENOS BASURA. MÁS POSIBILIDADES.';
    $('preview-title').textContent = plastic ? 'Una botella. Otra oportunidad.' : 'Un tubo. Un nuevo comienzo.';
    $('preview-description').textContent = plastic ? 'Botellas y envoltorios suman a tu reserva de plástico.' : 'Los tubos que recoges suman a tu reserva de chatarra.';
    $('page-kicker').textContent = 'LO QUE RECOGES, CUENTA.';
    $('page-title').innerHTML = 'Del agua a tu próxima aventura<span>.</span>';
  }
  $('avatar-preview').setAttribute('aria-label',recycling ? `Vista 3D de ${materialName($('exchange-material').value)} flotando en el agua` : 'Vista previa 3D del surfista y su equipo');
  if (focusKeys?.length && !document.contains(focused)) {
    const candidates = [...document.querySelectorAll('[data-item], [data-recipe], [data-character], [data-appearance], [data-id]')];
    const replacement = candidates.find(button => !button.disabled && focusKeys.every(([key, value]) => button.dataset[key] === value))
      || candidates.find(button => !button.disabled && focusKeys.some(([key, value]) => key === 'id' && [button.dataset.item, button.dataset.recipe].includes(value)));
    replacement?.focus({ preventScroll: true });
  }
  $('workshop-items').scrollTop = recipeScroll;
  for(const button of document.querySelectorAll('[data-character],[data-appearance]'))button.disabled=onlineReadOnly();
  updateProgressStatus();
}
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => setPage(button.dataset.page));
for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => { category = button.dataset.category; render(); });
$('shop-items').addEventListener('click', event => { const button = event.target.closest('[data-item]'); if (button) { selected = button.dataset.item; render(); } });
$('character-items').addEventListener('click',event=>{const button=event.target.closest('[data-character]');if(button&&button.dataset.character!==profile.equipped.character)commit({type:'equip',id:button.dataset.character});});
$('character-panel').addEventListener('click',event=>{const button=event.target.closest('[data-appearance]');if(button)commit({type:'appearance',field:button.dataset.appearance,value:button.dataset.value});});
$('workshop-items').addEventListener('click', event => { const button = event.target.closest('[data-recipe]'); if (button) { recipe = button.dataset.recipe; render(); } });
for (const id of ['item-detail', 'recipe-detail']) $(id).addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const item = findItem(button.dataset.id), type = button.dataset.action;
  commit({ type, id: item.id }, type === 'equip' ? `${item.name}: listo para tu próxima carrera.` : `${item.name} ya es tuyo. Ahora puedes equiparlo.`);
});
$('exchange-form').addEventListener('submit', async event => {
  event.preventDefault(); const amount = Number($('exchange-amount').value), material = $('exchange-material').value;
  const context=progressGeneration,mode=progressMode;
  $('exchange-receipt').hidden=true;
  if (await commit({ type: 'exchange', material, amount })&&context===progressGeneration&&mode===progressMode&&$('exchange-material').value===material) {
    $('exchange-receipt').hidden = false;
    $('exchange-receipt').textContent = mode==='online'?`✓ Canje confirmado por el servicio: ${amount} de ${materialName(material)}. Tu saldo online está actualizado.`:`✓ ¡Bien recuperado! ${amount} de ${materialName(material)} → +${amount * (material === 'plastic' ? 4 : 6)} monedas. Ya están en tu saldo.`;
    $('exchange-amount').value = Math.max(1, Math.min(amount,profile[material])); updateExchange();
  }
});
for (const button of document.querySelectorAll('[data-material]')) button.addEventListener('click', () => {
  $('exchange-material').value=button.dataset.material; $('exchange-amount').value=1; $('exchange-receipt').hidden=true; render();
});
$('exchange-amount').addEventListener('input', () => { $('exchange-receipt').hidden=true; updateExchange(); });
for (const [id,delta] of [['exchange-less',-1],['exchange-more',1]]) $(id).addEventListener('click', () => {
  $('exchange-amount').value=Math.max(1,Math.min(profile[$('exchange-material').value],Number($('exchange-amount').value)+delta)); $('exchange-receipt').hidden=true; updateExchange();
});
$('exchange-workshop').addEventListener('click', () => setPage('workshop'));
$('exchange-max').addEventListener('click', () => { $('exchange-amount').value = profile[$('exchange-material').value]; $('exchange-receipt').hidden = true; updateExchange(); });
$('change-equipment').addEventListener('click', () => { category = 'board'; selected = profile.equipped.board; setPage('shop'); });
$('materials-button').addEventListener('click', () => { $('materials-popover').hidden = !$('materials-popover').hidden; $('materials-button').setAttribute('aria-expanded', String(!$('materials-popover').hidden)); });

document.addEventListener('click', event => { if (!event.target.closest('.wallet')) { $('materials-popover').hidden = true; $('materials-button').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => { if (event.code === 'Escape') { $('materials-popover').hidden = true; $('materials-button').setAttribute('aria-expanded', 'false'); } });

function enterRace() {
  setProgressMode('local');
  $('menu').hidden = true; $('race').hidden = false; document.body.classList.add('racing');
  $('materials-popover').hidden = true; $('materials-button').setAttribute('aria-expanded', 'false'); game.equip(equipment()); game.enter(selectedMap.id); window.scrollTo(0, 0);
}
function leaveRace() {
  if(game.mode==='online')multiplayer.leave();
  game.exit(); $('race').hidden = true; $('menu').hidden = false; document.body.classList.remove('racing'); setPage('home'); $('play').focus();
}
game.onFinish = settleLocalRace;
$('play').addEventListener('click', enterRace);
$('results-menu').addEventListener('click', leaveRace);
// RF-035: the room returns to LOBBY after the settled result; staying keeps the
// membership and reopens the lobby to confirm profile and Reduce again.
$('results-room').addEventListener('click', () => {
  game.exit(); $('race').hidden = true; $('menu').hidden = false; document.body.classList.remove('racing'); setPage('home');
  if (multiplayer.state.status === 'room') lobby.open(); else $('play').focus();
});
let cancelDialog = () => {};
function dialog(title, content, actions = '', onCancel = () => {}) {
  cancelDialog = onCancel; $('dialog-title').textContent = title; $('dialog-content').innerHTML = content; $('dialog-actions').innerHTML = actions; $('info-dialog').showModal();
}
$('close-dialog').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('close', () => { cancelDialog(); cancelDialog = () => {}; });
function confirmRaceChange(restart) {
  if(game.mode==='online'){
    dialog('¿Volvemos al club?', '<p>La sala seguirá su curso. Si sales, el servicio de partidas decidirá el resultado de tu participación.</p>', '<button class="secondary" id="keep-racing">Seguir</button><button class="primary" id="confirm-leave">Salir de la sala</button>');
    game.suspend(true);
    $('keep-racing').addEventListener('click',()=>$('info-dialog').close());
    $('confirm-leave').addEventListener('click',()=>{$('info-dialog').close();leaveRace();});return;
  }
  if (game.state === 'finished' || game.state === 'ready') { restart ? enterRace() : leaveRace(); return; }
  game.suspend(true);
  dialog(restart ? '¿Volvemos a la salida?' : '¿Volvemos al club?', `<p>Los materiales se guardan al cruzar la meta. Si ${restart ? 'reinicias' : 'sales'} ahora, lo recogido en esta carrera no se añadirá a tu inventario.</p>`, `<button class="secondary" id="keep-racing">Seguir</button><button class="primary" id="confirm-leave">${restart ? 'Reiniciar carrera' : 'Salir de la carrera'}</button>`, () => game.suspend(false));
  $('keep-racing').addEventListener('click', () => $('info-dialog').close());
  $('confirm-leave').addEventListener('click', () => { $('info-dialog').close(); restart ? enterRace() : leaveRace(); });
}
$('leave-race').addEventListener('click', () => confirmRaceChange(false)); $('restart').addEventListener('click', () => confirmRaceChange(true));
$('controls-help').addEventListener('click', () => dialog('Encuentra tu ritmo.', '<ul><li><b>← → o A / D</b> para girar.</li><li><b>Z / X</b> para llevar la red a izquierda o derecha.</li><li><b>Espacio</b> para saltar obstáculos.</li><li><b>Shift</b> para gastar el impulso que cargas al recoger.</li><li><b>P</b> para pausar. En móvil, usa los botones en pantalla.</li></ul><p><b>Plástico:</b> halo azul con aro continuo. <b>Chatarra:</b> halo naranja con aro segmentado. Acerca la red a los residuos: se recogen al contacto.</p><p>Empiezas con <b>3 vidas</b>. Los choques y el pulpo restan una; los salvavidas recuperan una (máximo 3). Tras un golpe tendrás protección. Mira la vista trasera y usa el impulso cuando el pulpo se acerque. Termina la carrera para guardar tus materiales; una descalificación no suma recursos.</p>'));
$('credits-help').addEventListener('click', () => dialog('Créditos de la música', '<ul><li><b>Inicio:</b> «Summer Adventure», de Flixberry Entertainment. Licencia <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</li><li><b>Club y salas:</b> «Racing Game Menu», de MintoDog (CC0).</li><li><b>Lago de Maracaibo:</b> «Sunny City», de MintoDog (CC0).</li><li><b>Río Orinoco:</b> «Joyful Jungle», de MintoDog (CC0).</li></ul><p>Música publicada en <a href="https://opengameart.org" target="_blank" rel="noopener">OpenGameArt.org</a>.</p>'));
$('three-r-help').addEventListener('click', () => dialog('Tres R. Una buena costumbre.', '<p><b>Reciclar.</b> Clasifica lo recogido: botellas y envoltorios son plástico; tubos metálicos, chatarra. Canjéalos por monedas.</p><p><b>Reutilizar.</b> Guarda materiales y transfórmalos en una nueva red en el taller.</p><p><b>Reducir.</b> La mejor basura es la que no se genera. Reutiliza tu equipo y evita productos de un solo uso fuera del juego. Su mecánica propia llegará en una siguiente etapa.</p>'));

// Title screen: Surf Club over the Maracaibo course in motion, and three ways in.
function showTitle() {
  // Visible from the first paint as a loader; the buttons open once the game is ready.
  $('title-screen').classList.remove('is-loading'); $('title-screen').removeAttribute('aria-busy');
  for (const id of ['title-play', 'title-friends', 'title-club']) $(id).disabled = false;
  $('title-screen').hidden = false; $('menu').inert = true; document.querySelector('.topbar').inert = true;
  game.title($('title-world')); $('title-play').focus({ preventScroll: true });
}
function hideTitle() {
  if ($('title-screen').hidden) return;
  $('title-screen').hidden = true; game.title(null); $('menu').inert = false; document.querySelector('.topbar').inert = false;
}
$('title-play').addEventListener('click', () => { hideTitle(); $('play').click(); });
$('title-friends').addEventListener('click', () => { hideTitle(); $('play-friends').click(); });
$('title-club').addEventListener('click', () => { hideTitle(); setPage('home'); $('play').focus({ preventScroll: true }); });
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (!$('race').hidden) confirmRaceChange(false); else { setPage('home'); showTitle(); } });
const multiplayer=createMultiplayerClient({adapter:backendAdapter,callbacks:{
  onStart(data){
    if(profileAdapter&&(!onlineProfiles.state.profile||data.selfPlayerId!==onlineProfiles.state.playerId))return false;
    hideTitle();game.enterOnline(data);
    $('menu').hidden=true;$('race').hidden=false;document.body.classList.add('racing');
    $('materials-popover').hidden=true;$('materials-button').setAttribute('aria-expanded','false');window.scrollTo(0,0);
    requestAnimationFrame(()=>$('world').focus({preventScroll:true}));return true;
  },
  onSnapshot:snapshot=>game.applySnapshot(snapshot),
  onEvent:event=>game.applyEvent(event),
  onResult(result){if(!game.applyResult(result))throw new Error('Resultado incompatible');},
  onConnection:status=>game.setConnectionState(status),
  onProfile:data=>onlineProfiles.accept(data),
  // Go republishes race.ended once Rust confirmed the credit: show it and read
  // the confirmed profile instead of adding anything locally.
  onSettlement(result){game.applySettlement(result);if(onlineProfiles.state.status==='ready')void onlineProfiles.load();},
}});
const roomProfile=()=>profileAdapter?onlineProfiles.state.profile:offlineProfile;
const lobby=mountMultiplayerLobby({client:multiplayer,getEquipment:()=>({...roomProfile()?.equipped}),getAppearance:()=>({...roomProfile()?.appearance}),
  getDisplayName:()=>findItem(roomProfile()?.equipped.character)?.name||'Surfista',getMap:()=>selectedMap,onLocalRace:enterRace,
  getProfileRevision:()=>onlineProfiles.state.profileRevision});
const profilePanel=mountProfilePanel({store:onlineProfiles,getMode:()=>progressMode,setMode:setProgressMode});
$('profile-open').addEventListener('click',()=>profilePanel.open());
$('profile-operation-open').addEventListener('click',()=>profilePanel.open());
$('play-friends').addEventListener('click',async()=>{
  if(backendAdapter){
    if(!profileAdapter){message('Falta conectar el perfil del servicio antes de entrar a una sala.');profilePanel.open();return;}
    if(onlineProfiles.state.status!=='ready'&&!(await onlineProfiles.load())){profilePanel.open();return;}
    if(!setProgressMode('online')){profilePanel.open();return;}
  }
  lobby.open();
});
onlineProfiles.subscribe(state=>{
  if(progressMode==='online'){
    if(state.profile)profile=state.profile;
    else{progressMode='local';progressGeneration++;profile=offlineProfile;}
    if($('race').hidden)render();else updateProgressStatus();
  }
});
game.onInput=input=>multiplayer.sendInput(input);
// Unloading only closes the channel: an explicit exit uses the leave buttons.
window.addEventListener('pagehide',()=>multiplayer.detach());
// Reentry after a reload (G61): with a still-valid session Go rebinds the room
// and replays its state; the online profile is loaded before the race resumes.
if(backendAdapter&&profileAdapter)void multiplayer.resume(async playerId=>{
  if(onlineProfiles.state.status!=='ready'&&!(await onlineProfiles.load()))return false;
  return onlineProfiles.state.playerId===playerId&&setProgressMode('online');
}).then(resumed=>{if(resumed){hideTitle();if(multiplayer.state.status==='room')lobby.open();}})
  .then(async()=>{
    if(progressMode==='online'||rememberedProgressMode()!=='online')return;
    if(onlineProfiles.state.status==='ready'||await onlineProfiles.load())setProgressMode('online');
  });
// A later visit restores the profile without creating demo coins or materials.
persist(); render();
$('play').disabled = false;
$('loading-status').hidden = true;
$('menu').removeAttribute('aria-busy');
$('menu').inert = false;
document.querySelector('.topbar').inert = false;
showTitle();
